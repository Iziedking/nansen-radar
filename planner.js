import { NANSEN_COMMANDS, SUPPORTED_CHAINS, MAX_COMMANDS_PER_STEP } from './config.js';
import { callLLM } from './llm.js';

// Robust JSON extractor — handles models that wrap output in markdown fences
// and fix common LLM JSON generation mistakes
function extractJSON(text) {
  // Try 1: strip all code fences then parse directly
  const stripped = text
    .replace(/^```[\w]*\s*/gm, '').replace(/^```\s*$/gm, '')
    .replace(/^~~~[\w]*\s*/gm, '').replace(/^~~~\s*$/gm, '')
    .trim();
  try { return JSON.parse(stripped); } catch {}

  // Try 2: pull the outermost { ... } block from raw text
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}

    // Try 3: repair common LLM JSON mistakes then parse
    const repaired = objMatch[0]
      // Missing comma between "value"\n  "key" or "value"\n  }
      .replace(/"(\s*)\n(\s*)"(?=[^:}])/g, '",\n$2"')
      // Missing comma between } or ] and next "key"
      .replace(/([}\]])\s*\n(\s*)"(?=[^:}])/g, '$1,\n$2"')
      // Trailing commas before } or ]
      .replace(/,(\s*[}\]])/g, '$1');
    try { return JSON.parse(repaired); } catch {}
  }

  return null;
}

// ── Command templates — model never generates these, code builds them ──────────

function buildTokenCommands(chain, address) {
  return [
    `nansen research token holders --chain ${chain} --token ${address} --limit 20`,
    `nansen research token who-bought-sold --chain ${chain} --token ${address}`,
    `nansen research smart-money netflow --chain ${chain} --token ${address}`,
    `nansen research token dex-trades --chain ${chain} --token ${address} --limit 20`,
    `nansen research token pnl-leaderboard --chain ${chain} --token ${address} --limit 20`,
  ];
}

function buildWalletCommands(chain, address) {
  return [
    `nansen research profiler labels --chain ${chain} --address ${address}`,
    `nansen research profiler pnl-summary --chain ${chain} --address ${address}`,
    `nansen research profiler transactions --chain ${chain} --address ${address} --limit 20`,
    `nansen research profiler counterparties --chain ${chain} --address ${address}`,
  ];
}

function buildMarketCommands(chain) {
  const c = chain || 'ethereum';
  return [
    `nansen research smart-money netflow --chain ${c}`,
    `nansen research token screener --chain ${c} --timeframe 24h --limit 20`,
    `nansen research smart-money dex-trades --chain ${c}`,
    `nansen research smart-money holdings --chain ${c}`,
  ];
}

// ── Classifier prompt — model only extracts parameters, never generates commands

const CLASSIFIER_SYSTEM = `You are a query classifier for a crypto research tool.

Your ONLY job: read the user's query and extract 4 fields. Nothing else.

CRITICAL: Respond with ONLY a JSON object. Start with { end with }. No markdown, no explanation.

Classification rules:
- queryType "TOKEN": user mentions a token name, contract address for a token, "safe to buy", "rug", "invest in"
- queryType "WALLET": user mentions "wallet", "portfolio", "holdings of address", "track this address"
- queryType "MARKET": no specific token/address — broad questions about trends, smart money, what to buy

Chain detection — use EXACT names only:
ethereum, solana, base, bnb, arbitrum, polygon, optimism, avalanche, linea, scroll, mantle, ronin, sei, sonic, hyperevm
Default to "ethereum" if chain is not mentioned.

Address: extract any 0x... or base58 address from the query. null if none.

Response format (fill in the values, keep the keys exactly):
{
  "intent": "one short sentence what user wants to know",
  "queryType": "TOKEN",
  "chain": "base",
  "address": "0x98d0baa52b2d063e780de12f615f963fe8537553",
  "reasoning": "one sentence why this classification"
}`;

const MODE_TO_TYPE = { token: 'TOKEN', wallet: 'WALLET', market: 'MARKET' };

export async function planInvestigation(query, providerConfig, mode) {
  // Step 1: Model only classifies + extracts parameters (never generates commands)
  const response = await callLLM(CLASSIFIER_SYSTEM, query, providerConfig);
  const parsed = extractJSON(response);
  if (!parsed) throw new Error(`Failed to parse plan: ${response.slice(0, 300)}`);

  // Step 2: Code builds the full command set from templates — reliable regardless of model size
  const queryType = (mode && MODE_TO_TYPE[mode]) || parsed.queryType || 'TOKEN';
  const chain = (parsed.chain || 'ethereum').toLowerCase().trim();
  const address = parsed.address || null;

  let plan;
  if (queryType === 'WALLET' && address) {
    plan = buildWalletCommands(chain, address);
  } else if (queryType === 'MARKET' || !address) {
    plan = buildMarketCommands(chain);
  } else {
    // TOKEN (default) — also handles cases where model misclassifies but address is present
    plan = buildTokenCommands(chain, address);
  }

  return {
    intent: parsed.intent || query,
    queryType,
    chain,
    address,
    plan,
    reasoning: parsed.reasoning || '',
  };
}

const ANALYST_SYSTEM = `You are an onchain intelligence analyst for degen crypto traders making real investment decisions. Analyze Nansen data and produce a structured risk report.

CRITICAL OUTPUT RULE: Respond with ONLY a raw JSON object. No markdown. No code fences. No explanation. Start with { and end with }. Nothing else.

MANDATORY FINDINGS RULE: You MUST produce between 3 and 5 findings. Never return an empty findings array. For every data axis that returned data, write one finding. If data is sparse, write what you can observe — low data volume is itself a finding (severity: "warning").

ANALYSIS RULES:
- Risk score: 0-100 (0 = extreme danger/rug, 100 = very safe). Be honest and decisive.
- Cite actual numbers from the data — never vague statements.
- Each "detail" field: under 120 characters. Include at least one number.
- Each "dataPoints" entry: under 60 characters.
- 2 recommendations max. Make them actionable and specific.

WHAT TO WRITE FINDINGS FOR (write one per axis if data exists):
1. SMART MONEY FLOW: Net accumulation or distribution? Exact USD figure. Severity: positive if accumulating, danger if distributing.
2. HOLDER CONCENTRATION: Top holders % of supply. Severity: danger if top wallet >10%, warning if top 10 >50%.
3. WHO IS BUYING/SELLING: Smart money funds or retail only? Severity: positive if smart money buying.
4. DEX ACTIVITY: Trade volume, number of trades. Thin volume = warning. High volume = positive signal.
5. PNL / PROFITABILITY: Are top holders profitable? Large unrealized gains = sell pressure risk (warning).

severity values: "positive" | "warning" | "danger" | "neutral"

RISK LABEL mapping:
- 80-100: LOW RISK
- 60-79: MODERATE
- 40-59: HIGH RISK
- 0-39: CRITICAL

Output this exact JSON structure:
{
  "title": "Short report title under 60 chars",
  "summary": "2 sentences. Lead with the verdict for a degen trader. Include the risk score.",
  "riskScore": 72,
  "riskLabel": "MODERATE",
  "findings": [
    {
      "category": "Smart Money",
      "severity": "positive",
      "title": "Finding title under 50 chars",
      "detail": "Specific detail with numbers, under 120 chars",
      "dataPoints": ["metric: value", "metric: value"]
    },
    {
      "category": "Holder Concentration",
      "severity": "warning",
      "title": "Second finding title",
      "detail": "Detail with numbers",
      "dataPoints": ["metric: value"]
    },
    {
      "category": "DEX Activity",
      "severity": "neutral",
      "title": "Third finding title",
      "detail": "Detail with numbers",
      "dataPoints": ["metric: value"]
    }
  ],
  "recommendations": ["Actionable recommendation 1", "Actionable recommendation 2"],
  "needsMoreData": false,
  "followUpCommands": []
}`;

// Maps whatever the model returns to our expected schema — handles field name variations
function normalizeAnalysis(raw) {
  if (!raw || typeof raw !== 'object') return null;

  // Search nested objects for our fields (model sometimes wraps in "report", "analysis", etc.)
  const flat = flattenObject(raw);

  const score = flat.riskScore ?? flat.risk_score ?? flat.score ?? flat.riskRating ?? flat.rating ?? 50;
  const label = flat.riskLabel ?? flat.risk_label ?? flat.riskLevel ?? flat.level ?? scoreToLabel(score);
  const findings = flat.findings ?? flat.signals ?? flat.risks ?? flat.issues ?? [];
  const recs = flat.recommendations ?? flat.recommendation ?? flat.actions ?? flat.actionItems ?? [];

  return {
    title:           flat.title ?? flat.reportTitle ?? 'Token Investigation Report',
    summary:         flat.summary ?? flat.overview ?? flat.description ?? '',
    riskScore:       typeof score === 'number' ? score : parseInt(score, 10) || 50,
    riskLabel:       label,
    findings:        Array.isArray(findings) ? findings.map(normalizeFinding) : [],
    recommendations: Array.isArray(recs) ? recs.map(r => (typeof r === 'string' ? r : r?.text ?? JSON.stringify(r))) : [],
    needsMoreData:   flat.needsMoreData ?? flat.needs_more_data ?? false,
    followUpCommands: flat.followUpCommands ?? flat.follow_up_commands ?? [],
  };
}

function flattenObject(obj, depth = 0) {
  if (depth > 3) return obj;
  let result = { ...obj };
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      Object.assign(result, flattenObject(val, depth + 1));
    }
  }
  return result;
}

function normalizeFinding(f) {
  if (typeof f === 'string') return { category: 'General', severity: 'neutral', title: f, detail: '', dataPoints: [] };
  return {
    category:   f.category ?? f.type ?? 'General',
    severity:   normalizeSeverity(f.severity ?? f.level ?? f.risk ?? 'neutral'),
    title:      f.title ?? f.name ?? f.finding ?? '',
    detail:     f.detail ?? f.description ?? f.details ?? '',
    dataPoints: Array.isArray(f.dataPoints) ? f.dataPoints : (Array.isArray(f.data_points) ? f.data_points : []),
  };
}

function normalizeSeverity(s) {
  const v = String(s).toLowerCase();
  if (v.includes('danger') || v.includes('critical') || v.includes('high') || v.includes('red')) return 'danger';
  if (v.includes('warn') || v.includes('medium') || v.includes('moderate') || v.includes('orange')) return 'warning';
  if (v.includes('pos') || v.includes('good') || v.includes('green') || v.includes('low')) return 'positive';
  return 'neutral';
}

function scoreToLabel(score) {
  if (score >= 80) return 'LOW RISK';
  if (score >= 60) return 'MODERATE';
  if (score >= 40) return 'HIGH RISK';
  return 'CRITICAL';
}

export async function analyzeResults(query, plan, executionResults, providerConfig, mode) {
  const dataBlock = executionResults.map(r => {
    if (r.success) {
      const trimmed = JSON.stringify(r.data).slice(0, 8000);
      return `Command: ${r.command}\nResult: ${trimmed}`;
    }
    return `Command: ${r.command}\nError: ${r.error}`;
  }).join('\n\n---\n\n');

  const userMsg = `Original question: ${query}

Investigation plan: ${plan.reasoning}

Data collected:
${dataBlock}

Analyze this data and produce the investigation report.`;

  const response = await callLLM(ANALYST_SYSTEM, userMsg, providerConfig, 8192);

  const parsed = extractJSON(response);
  if (!parsed) throw new Error(`Failed to parse analysis: ${response.slice(0, 300)}`);
  return normalizeAnalysis(parsed) || parsed;
}
