import { join } from 'node:path';
import { homedir } from 'node:os';
import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { callLLM } from './llm.js';

const SESSION_DIR  = join(homedir(), '.nansen-radar');
const SESSION_FILE = join(SESSION_DIR, 'sessions.json');

// ── Shared helpers ────────────────────────────────────────────────────────────

const SEV_ORDER = { danger: 0, warning: 1, neutral: 2, positive: 3 };

function sortedFindings(findings) {
  return [...(findings || [])].sort(
    (a, b) => (SEV_ORDER[a.severity] ?? 4) - (SEV_ORDER[b.severity] ?? 4),
  );
}

function sevIcon(sev) {
  return { positive: '🟢', warning: '🟡', danger: '🔴', neutral: '⚪' }[sev] || '⚪';
}

function riskEmoji(score) {
  if (score >= 80) return '🟢';
  if (score >= 60) return '🟡';
  if (score >= 40) return '🔴';
  return '🟣';
}

// Bold helper per platform (returns plain text on Telegram — no MarkdownV2 risk)
function bold(text, platform) {
  if (platform === 'discord')  return `**${text}**`;
  if (platform === 'whatsapp') return `*${text}*`;
  return text; // Telegram: plain text (OpenClaw may not support parse_mode)
}

function italic(text, platform) {
  if (platform === 'discord')  return `*${text}*`;
  if (platform === 'whatsapp') return `_${text}_`;
  return text;
}

// ── SessionStore ──────────────────────────────────────────────────────────────

export class SessionStore {
  #map  = new Map();
  #timer;

  constructor() {
    this.#load();
    // Persist sessions to disk every 60 s (non-blocking)
    this.#timer = setInterval(() => this.#save(), 60_000);
    this.#timer.unref();
  }

  get(platform, from) {
    const key = `${platform}:${from}`;
    if (!this.#map.has(key)) {
      this.#map.set(key, {
        userId:        key,
        platform,
        from,
        welcomed:      false,
        lastSeen:      new Date().toISOString(),
        lastQuery:     null,
        lastRiskScore: null,
      });
    }
    return this.#map.get(key);
  }

  update(session, { query = null, riskScore = null } = {}) {
    session.lastSeen = new Date().toISOString();
    session.welcomed = true;
    if (query     != null) session.lastQuery     = query;
    if (riskScore != null) session.lastRiskScore = riskScore;
  }

  get size() { return this.#map.size; }

  flush() { this.#save(); }

  #load() {
    try {
      if (existsSync(SESSION_FILE)) {
        const data = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
        for (const [k, v] of Object.entries(data)) this.#map.set(k, v);
      }
    } catch {}
  }

  #save() {
    try {
      mkdirSync(SESSION_DIR, { recursive: true });
      const tmp = SESSION_FILE + '.tmp';
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.#map), null, 2));
      renameSync(tmp, SESSION_FILE);
    } catch {}
  }
}

// ── Intent Detection ──────────────────────────────────────────────────────────

const CLASSIFIER_SYSTEM = `You are the intent classifier for Nansen Radar, an AI-powered onchain intelligence agent.

Given a user message, return ONLY a raw JSON object. No markdown fences. No explanation. Start with { end with }.

Classify into exactly one type:
- analyze_token    user asks about a token's safety, risk, smart money flows, who is buying/selling, holder distribution, rug check
- analyze_wallet   user asks about a wallet's PnL, portfolio, trade history, labels, counterparties, profiling
- analyze_market   user wants market overview, smart money movements on a chain, trending tokens, chain activity
- set_alert        user wants price movement notifications for a token (keywords: alert, notify, watch, when price)
- list_alerts      user wants to see their active alerts or watches
- remove_alert     user wants to delete a specific alert by number
- greeting         user is saying hi, hello, starting a conversation, or just wants to introduce themselves
- help             user wants to know what the bot can do or see example commands
- unknown          none of the above

Extract these fields (null if not present):
- address     EVM hex address (0x... 40 hex chars) or Solana base58 address
- chain       blockchain name — infer from context: ethereum, base, solana, bnb, arbitrum, polygon, optimism, avalanche, linea, scroll, mantle, ronin, sei, sonic
- threshold   numeric percentage for price alert (e.g. "10%" → 10, "five percent" → 5)
- interval    check frequency string (default "1h"; parse "every 6 hours" → "6h", "daily" → "1d", "twice a day" → "12h")
- alertId     1-based integer for remove_alert intent ("remove alert 2" → 2)
- query       clean natural language query to run through the investigation engine — include address and chain

Return exactly this shape:
{"type":"analyze_token","address":null,"chain":null,"threshold":null,"interval":null,"alertId":null,"query":null}`;

// Stage 1: instant regex pre-filter for zero-cost trivial commands
const QUICK_INTENTS = [
  [/^(hi|hello|hey|start|yo|gm|sup|hola|oi|hii+)\b/i,           'greeting'],
  [/^help\b/i,                                                     'help'],
  [/^(my alerts?|show alerts?|list alerts?|alerts?\s*)$/i,        'list_alerts'],
  [/^(cancel|stop|nevermind|nvm)\s*$/i,                           'cancel'],
];

export async function detectIntent(text, session, providerConfig) {
  const trimmed = text.trim();

  // Stage 1 — instant, no API cost
  for (const [re, type] of QUICK_INTENTS) {
    if (re.test(trimmed)) return { type, params: {} };
  }

  // Stage 2 — LLM classifier (fast, ~1s, low token count)
  const ctx = session.lastQuery
    ? `\n[User previously asked: "${session.lastQuery.slice(0, 80)}" | Risk: ${session.lastRiskScore ?? '?'}/100]`
    : '';

  try {
    let raw = await callLLM(CLASSIFIER_SYSTEM, trimmed + ctx, providerConfig, 250);
    // Strip markdown fences if model wraps output (shouldn't, but some do)
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(raw);
    return { type: parsed.type || 'unknown', params: parsed };
  } catch {
    // LLM failure or malformed JSON → safe fallback
    return { type: 'unknown', params: {} };
  }
}

// ── Message Builders ──────────────────────────────────────────────────────────

export function buildWelcomeMessage(platform) {
  const b = (t) => bold(t, platform);
  const lines = [
    `👁️ ${b('NANSEN RADAR')} — Onchain Intelligence`,
    ``,
    `I'm your AI research agent powered by the Nansen CLI.`,
    `Real onchain data across 15+ chains. No guessing.`,
    ``,
    `${b('What I can do:')}`,
    ``,
    `📊 ${b('Token Analysis')}`,
    `Risk score · smart money signals · holder distribution`,
    ``,
    `👛 ${b('Wallet Analysis')}`,
    `PnL breakdown · trade history · counterparties`,
    ``,
    `🌊 ${b('Market Intelligence')}`,
    `Smart money flows · trending tokens by chain`,
    ``,
    `🔔 ${b('Price Alerts')}`,
    `Get notified when a token moves ±X%`,
    ``,
    `📋 ${b('Manage Alerts')}`,
    `View and remove your active price watches`,
    ``,
    `${b('Try asking:')}`,
    `• "Is 0x98d0... on base safe to buy?"`,
    `• "Analyze wallet 0xd8dA6BF... on ethereum"`,
    `• "What is smart money doing on Solana?"`,
    `• "Alert me if 0x98d0... moves 10%"`,
    ``,
    `Analysis takes ~60 seconds. Type ${b('help')} anytime.`,
  ];

  if (platform === 'discord') {
    return [
      `# 👁️ NANSEN RADAR — Onchain Intelligence`,
      ``,
      `I'm your AI research agent powered by the **Nansen CLI**. Real onchain data across 15+ chains.`,
      ``,
      `**📊 Token Analysis** — Risk score, smart money signals, holder distribution`,
      `**👛 Wallet Analysis** — PnL breakdown, trade history, counterparties`,
      `**🌊 Market Intelligence** — Smart money flows, trending tokens by chain`,
      `**🔔 Price Alerts** — Get notified when a token moves ±X%`,
      `**📋 Manage Alerts** — \`my alerts\` · \`remove alert 2\``,
      ``,
      `**Try asking:**`,
      `> "Is 0x98d0... on base safe to buy?"`,
      `> "Analyze wallet 0xd8dA6BF... on ethereum"`,
      `> "What is smart money doing on Solana?"`,
      `> "Alert me if 0x98d0... moves 10%"`,
      ``,
      `*Analysis takes ~60 seconds. Type \`help\` anytime.*`,
    ].join('\n');
  }

  return lines.join('\n');
}

export function buildHelpMessage(platform) {
  const b = (t) => bold(t, platform);

  if (platform === 'discord') {
    return [
      `# 👁️ NANSEN RADAR — Help`,
      ``,
      `**📊 Token Analysis**`,
      `> "Is [address] on [chain] safe to buy?"`,
      `> "Rug check KAITO on base"`,
      `> "Who is buying [address] on ethereum?"`,
      `> "Smart money signals for [address] on base"`,
      ``,
      `**👛 Wallet Analysis**`,
      `> "Analyze wallet [address] on ethereum"`,
      `> "What's the PnL on [address]?"`,
      `> "Profile this wallet: [address] on solana"`,
      ``,
      `**🌊 Market Intelligence**`,
      `> "What is smart money doing on Solana?"`,
      `> "Show trending tokens on Base"`,
      `> "Smart money flows on ethereum today"`,
      ``,
      `**🔔 Price Alerts**`,
      `> "Alert me if [address] on base moves 10%"`,
      `> "Notify me when this drops 5% on ethereum"`,
      `> "Watch [address] on solana — alert at 15%"`,
      ``,
      `**📋 Manage Alerts**`,
      `> \`my alerts\` — see active watches`,
      `> \`remove alert 2\` — delete by number`,
      ``,
      `*Powered by Nansen CLI · 15+ chains · Analysis ~60 seconds*`,
    ].join('\n');
  }

  return [
    `👁️ ${b('NANSEN RADAR — Help')}`,
    ``,
    `${b('📊 Token Analysis')}`,
    `"Is [address] on [chain] safe to buy?"`,
    `"Rug check KAITO on base"`,
    `"Who is buying [address] on ethereum?"`,
    ``,
    `${b('👛 Wallet Analysis')}`,
    `"Analyze wallet [address] on ethereum"`,
    `"What's the PnL on [address]?"`,
    `"Profile this wallet: [address] on solana"`,
    ``,
    `${b('🌊 Market Intelligence')}`,
    `"What is smart money doing on Solana?"`,
    `"Show trending tokens on Base"`,
    ``,
    `${b('🔔 Price Alerts')}`,
    `"Alert me if [address] on base moves 10%"`,
    `"Notify me when this drops 5%"`,
    ``,
    `${b('📋 Manage Alerts')}`,
    `"My alerts" — see active watches`,
    `"Remove alert 2" — delete by number`,
    ``,
    `Powered by Nansen CLI · 15+ chains`,
  ].join('\n');
}

export function buildAckMessage() {
  return '🔍 Investigating... Running Nansen queries across the chain. This takes ~60 seconds. Hang tight.';
}

export function buildAnalysisReply(result, platform) {
  const { analysis, totalCalls, timestamp } = result;
  const findings = sortedFindings(analysis?.findings);
  const score    = analysis?.riskScore ?? '?';
  const label    = analysis?.riskLabel || 'UNKNOWN';
  const title    = analysis?.title     || 'Investigation Complete';
  const summary  = (analysis?.summary  || '').slice(0, 400);
  const emoji    = riskEmoji(score);
  const recs     = (analysis?.recommendations || []).slice(0, 2);
  const dateStr  = timestamp ? timestamp.slice(0, 10) : '';
  const calls    = totalCalls || 0;
  const b        = (t) => bold(t, platform);

  const suggestions = buildFollowUpSuggestions(result, platform);

  if (platform === 'discord') {
    const lines = [
      `## 🔭 ${title}`,
      ``,
      `**Risk: ${score}/100 — ${label}** ${emoji}`,
      summary,
      ``,
      `**Findings:**`,
    ];
    for (const f of findings.slice(0, 5)) {
      lines.push(`${sevIcon(f.severity)} **${f.title}**`);
      if (f.detail) lines.push(`> ${f.detail.slice(0, 160)}`);
      if (f.dataPoints?.length) {
        lines.push(`> \`${f.dataPoints.slice(0, 2).join(' · ')}\``);
      }
    }
    if (recs.length) {
      lines.push(``, `**Recommendations:**`);
      recs.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
    }
    lines.push(``, `*📊 ${calls} Nansen queries · ${dateStr}*`);
    if (suggestions) lines.push(``, suggestions);
    return lines.join('\n');
  }

  // WhatsApp + Telegram (plain / WhatsApp markdown)
  const lines = [
    `🔭 ${b(title)}`,
    ``,
    `Risk: ${b(`${score}/100 — ${label}`)} ${emoji}`,
    summary,
    ``,
    `${b('Findings:')}`,
  ];
  for (const f of findings.slice(0, 5)) {
    lines.push(`${sevIcon(f.severity)} ${b(f.title)}`);
    if (f.detail) lines.push(`  ${f.detail.slice(0, 140)}`);
    if (f.dataPoints?.length) {
      lines.push(`  ${f.dataPoints.slice(0, 2).join(' · ')}`);
    }
  }
  if (recs.length) {
    lines.push(``, `${b('Recommendations:')}`);
    recs.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
  }
  lines.push(``, `📊 ${calls} Nansen queries · ${dateStr}`);
  if (suggestions) lines.push(``, suggestions);
  return lines.join('\n');
}

function buildFollowUpSuggestions(result, platform) {
  const score  = result.analysis?.riskScore;
  const intent = result.plan?.intent?.toLowerCase() || '';
  const isWallet = intent.includes('wallet') || intent.includes('portfolio');
  const b = (t) => bold(t, platform);

  let suggestions = [];

  if (isWallet) {
    suggestions = [
      '"Show me the counterparties for this wallet"',
      '"What tokens is this wallet currently holding?"',
    ];
  } else if (score != null && score < 50) {
    suggestions = [
      '"Alert me if this token moves 10%"',
      '"Who is currently buying this token?"',
    ];
  } else if (score != null && score >= 70) {
    suggestions = [
      '"Set a price alert if it moves 5%"',
      '"What else is smart money buying on this chain?"',
    ];
  } else {
    suggestions = [
      '"Who is buying this token?"',
      '"Alert me if the price moves 10%"',
    ];
  }

  if (platform === 'discord') {
    return `**💡 You can also ask:**\n` + suggestions.map(s => `> ${s}`).join('\n');
  }
  return `${b('💡 You can also ask:')}\n` + suggestions.map(s => `• ${s}`).join('\n');
}

export function buildAlertSetConfirmation(watch, platform) {
  const threshold = watch.priceAlertThreshold;
  const interval  = watch.interval;
  const query     = watch.query.slice(0, 60);
  const b         = (t) => bold(t, platform);

  if (platform === 'discord') {
    return [
      `✅ **Alert set!**`,
      ``,
      `**Token:** ${query}`,
      `**Trigger:** price moves ±${threshold}%`,
      `**Checks:** every ${interval}`,
      ``,
      `I'll send you a full risk report here when the threshold is hit.`,
      `To manage: \`my alerts\` · \`remove alert [number]\``,
    ].join('\n');
  }

  return [
    `✅ ${b('Alert set!')}`,
    ``,
    `Token: ${query}`,
    `Trigger: price moves ±${threshold}%`,
    `Checks: every ${interval}`,
    ``,
    `I'll send you a full risk report here when the threshold is hit.`,
    `To manage: "My alerts" or "Remove alert [number]"`,
  ].join('\n');
}

export function buildAlertListMessage(watches, platform) {
  const b = (t) => bold(t, platform);

  if (!watches.length) {
    return [
      `📋 ${b('No active alerts.')}`,
      ``,
      `To set one: "Alert me if [address] on [chain] moves 10%"`,
    ].join('\n');
  }

  const items = watches.map((w, i) => {
    const query     = w.query.slice(0, 55);
    const trigger   = w.priceAlertThreshold ? `±${w.priceAlertThreshold}%` : 'risk change';
    const lastRun   = w.lastRun ? w.lastRun.slice(0, 10) : 'never';
    const lastScore = w.lastRiskScore != null ? ` · risk ${w.lastRiskScore}/100` : '';
    return `${i + 1}. ${query}\n   Trigger: ${trigger} · every ${w.interval}${lastScore}\n   Last run: ${lastRun}`;
  });

  if (platform === 'discord') {
    return [
      `## 📋 Your Active Alerts (${watches.length})`,
      ``,
      items.map(s => `> ${s.replace(/\n/g, '\n> ')}`).join('\n\n'),
      ``,
      `To remove: \`remove alert [number]\``,
    ].join('\n');
  }

  return [
    `📋 ${b(`Your Active Alerts (${watches.length})`)}`,
    ``,
    items.join('\n\n'),
    ``,
    `To remove: "Remove alert [number]"`,
  ].join('\n');
}

export function buildAlertRemovedMessage(query, platform) {
  const q = (query || 'Alert').slice(0, 60);
  const b = (t) => bold(t, platform);
  if (platform === 'discord') return `🗑️ **Alert removed**\n> ${q}`;
  return `🗑️ ${b('Alert removed')}\n${q}`;
}

export function buildAlertMissingParamsMessage(platform) {
  const b = (t) => bold(t, platform);
  return [
    `📍 ${b('To set a price alert I need:')}`,
    ``,
    `1. A token address or name`,
    `2. A chain (ethereum, base, solana...)`,
    `3. A % threshold (e.g. "10%" or "5 percent")`,
    ``,
    `${b('Example:')} "Alert me if 0x98d0... on base moves 10%"`,
  ].join('\n');
}

export function buildUnknownMessage(platform) {
  const b = (t) => bold(t, platform);
  if (platform === 'discord') {
    return [
      `🤔 **I didn't quite catch that.**`,
      ``,
      `Try one of these:`,
      `> "Is [address] on [chain] safe to buy?"`,
      `> "Analyze wallet [address] on ethereum"`,
      `> "Smart money on Solana"`,
      `> "Alert me if [address] moves 10%"`,
      ``,
      `Type \`help\` to see all commands.`,
    ].join('\n');
  }
  return [
    `🤔 ${b("I didn't quite catch that.")}`,
    ``,
    `Try one of these:`,
    `• "Is [address] on [chain] safe to buy?"`,
    `• "Analyze wallet [address] on ethereum"`,
    `• "Smart money on Solana"`,
    `• "Alert me if [address] moves 10%"`,
    ``,
    `Type ${b('help')} to see all commands.`,
  ].join('\n');
}

export function buildErrorMessage(err, platform) {
  const msg  = err?.message?.slice(0, 160) || 'Unknown error';
  const hint = 'Check that nansen-radar is configured and the Nansen CLI is authenticated (nansen login --api-key KEY).';
  const b    = (t) => bold(t, platform);
  if (platform === 'discord') {
    return `❌ **Investigation failed**\n> ${msg}\n\n${hint}`;
  }
  return `❌ ${b('Investigation failed')}\n${msg}\n\n${hint}`;
}

export function buildCancelledMessage(platform) {
  return platform === 'discord'
    ? `⏹️ **No active investigation to cancel.** Just send a new query when you're ready.`
    : `⏹️ No active investigation to cancel. Just send a new query when you're ready.`;
}
