#!/usr/bin/env node

import { investigate } from './agent.js';
import { generateReport } from './report.js';
import { buildProviderConfig } from './llm.js';
import { addWatch, removeWatch, listWatches, runDaemon, parseNotifySpec } from './watcher.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env file if present (no npm dependency required)
function loadEnv() {
  const envPath = fileURLToPath(new URL('.env', import.meta.url));
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

const USAGE = `
  nansen-radar — AI-powered onchain due diligence agent

  Describe your question in plain English. The agent investigates using
  Nansen onchain data and your configured LLM (set once in .env).

  ── QUICK START ──────────────────────────────────────────────────────

  1. Edit .env and set LLM_PROVIDER + model (ollama is free)
  2. node index.js "Is this token safe? 0xC02...6Cc2 on ethereum"

  ── INVESTIGATE ──────────────────────────────────────────────────────

    node index.js "<your question>"
    node index.js "<question>" --mode token
    node index.js "<question>" --mode wallet
    node index.js "<question>" --mode market
    node index.js "<question>" --no-open        (skip auto browser open)
    node index.js "<question>" --json           (also save raw JSON)

  Override provider for a single run (without changing .env):
    node index.js "<question>" --provider ollama
    node index.js "<question>" --provider gemini --model gemini-1.5-pro
    node index.js "<question>" --provider anthropic

  ── WATCH TOKENS (scheduled alerts) ─────────────────────────────────

    # Add a watch — alerts you on Discord/Slack/Telegram on a schedule
    node index.js --watch-add "<question>" --interval 6h --notify discord:WEBHOOK_URL

    # Interval can be: 30m | 6h | 12h | 1d | 2d  (simple and human-friendly)

    # Multiple notification channels at once
    node index.js --watch-add "<question>" --interval 6h \\
      --notify discord:WEBHOOK_URL \\
      --notify telegram:BOT_TOKEN:CHAT_ID \\
      --notify slack:WEBHOOK_URL

    node index.js --watch-list                  (see all watches)
    node index.js --watch-remove <id>           (remove a watch)
    node index.js --watch-daemon                (start scheduler — keep running)

  ── NOTIFICATION FORMATS ─────────────────────────────────────────────

    discord:https://discord.com/api/webhooks/ID/TOKEN
    slack:https://hooks.slack.com/services/ID/TOKEN
    telegram:BOT_TOKEN:CHAT_ID

  ── PROVIDER SETUP (set in .env — no need to type every time) ────────

    LLM_PROVIDER=ollama        FREE  — local Ollama (install: winget install Ollama.Ollama)
    LLM_PROVIDER=gemini        FREE  — Google Gemini free tier (needs GEMINI_API_KEY)
    LLM_PROVIDER=openrouter    FREE  — OpenRouter free models (needs OPENROUTER_API_KEY)
    LLM_PROVIDER=anthropic     PAID  — Claude (needs ANTHROPIC_API_KEY)
    LLM_PROVIDER=openclaw      FREE* — OpenClaw gateway routing to Ollama/Gemini

    LLM_MODEL=llama3.2         Override the model for any provider

  ── EXAMPLES ─────────────────────────────────────────────────────────

    node index.js "Is WETH safe to hold? 0xC02...6Cc2 on ethereum"
    node index.js "Where is smart money moving on Solana this week?" --mode market
    node index.js "Investigate this wallet: 0xd8dA...96045 on ethereum" --mode wallet

    node index.js --watch-add "0xC02...6Cc2 on ethereum" --interval 6h \\
      --notify "discord:https://discord.com/api/webhooks/123/abc"
    node index.js --watch-daemon

    --help    Show this message
`;

function parseArgs(argv) {
  const args = { open: true, notify: [] };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--no-open') {
      args.open = false;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--query' && argv[i + 1]) {
      args.query = argv[++i];
    } else if (arg === '--mode' && argv[i + 1]) {
      args.mode = argv[++i];
    } else if (arg === '--output' && argv[i + 1]) {
      args.output = argv[++i];
    } else if (arg === '--watch-add') {
      args.watchAdd = true;
    } else if (arg === '--watch-list') {
      args.watchList = true;
    } else if (arg === '--watch-remove' && argv[i + 1]) {
      args.watchRemove = argv[++i];
    } else if (arg === '--watch-daemon') {
      args.watchDaemon = true;
    } else if (arg === '--interval' && argv[i + 1]) {
      args.interval = argv[++i];
    } else if (arg === '--notify' && argv[i + 1]) {
      args.notify.push(argv[++i]);
    } else if (arg === '--provider' && argv[i + 1]) {
      args.provider = argv[++i];
    } else if (arg === '--model' && argv[i + 1]) {
      args.model = argv[++i];
    } else if (!arg.startsWith('--') && !args.query) {
      args.query = arg;
    }
  }

  return args;
}

function openFile(filepath) {
  const platform = process.platform;
  try {
    if (platform === 'darwin') execSync(`open "${filepath}"`);
    else if (platform === 'win32') {
      try { execSync(`cmd /c start msedge "${filepath}"`, { stdio: 'ignore' }); }
      catch { try { execSync(`cmd /c start chrome "${filepath}"`, { stdio: 'ignore' }); }
      catch { execSync(`cmd /c start "" "${filepath}"`); } }
    }
    else execSync(`xdg-open "${filepath}"`);
  } catch {
    console.log(`\x1b[90m  Open manually: ${filepath}\x1b[0m`);
  }
}

function printWatchTable(watches) {
  if (!watches.length) {
    console.log('\n  No watches configured.\n');
    return;
  }
  console.log('\n  Active watches:\n');
  for (const w of watches) {
    const last = w.lastRun ? w.lastRun.slice(0, 16).replace('T', ' ') : 'never';
    const score = w.lastRiskScore != null ? `${w.lastRiskScore}/100` : '—';
    console.log(`  \x1b[36m${w.id}\x1b[0m`);
    console.log(`    Query:    ${w.query.slice(0, 70)}`);
    console.log(`    Interval: ${w.interval}`);
    console.log(`    Notify:   ${w.notify.map(n => n.type).join(', ') || 'none'}`);
    console.log(`    Last run: ${last} | Score: ${score}`);
    console.log('');
  }
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }

  // Build provider config (validates env vars, throws with helpful messages)
  let providerConfig;
  try {
    providerConfig = buildProviderConfig({ provider: args.provider, model: args.model });
  } catch (err) {
    // For watch-list and watch-remove, no LLM needed
    if (!args.watchList && !args.watchRemove) {
      console.error(`\n  Error: ${err.message}\n`);
      process.exit(1);
    }
  }

  // ── Watch subcommands ─────────────────────────────────────────────────────

  if (args.watchList) {
    printWatchTable(listWatches());
    return;
  }

  if (args.watchRemove) {
    const removed = removeWatch(args.watchRemove);
    if (removed) {
      console.log(`\n  \x1b[32m✓ Removed watch: ${args.watchRemove}\x1b[0m\n`);
    } else {
      console.error(`\n  Watch not found: ${args.watchRemove}\n`);
      process.exit(1);
    }
    return;
  }

  if (args.watchAdd) {
    if (!args.query) {
      console.error('\n  --watch-add requires a query (positional arg or --query)\n');
      process.exit(1);
    }
    if (!args.interval) {
      console.error('\n  --watch-add requires --interval (e.g. "0 */6 * * *")\n');
      process.exit(1);
    }
    let notifySpecs = [];
    try {
      notifySpecs = args.notify.map(parseNotifySpec);
    } catch (err) {
      console.error(`\n  Invalid --notify: ${err.message}\n`);
      process.exit(1);
    }
    try {
      const watch = addWatch(args.query, args.interval, notifySpecs, args.mode || null);
      console.log(`\n  \x1b[32m✓ Watch added: ${watch.id}\x1b[0m`);
      console.log(`\x1b[90m  Query:    ${watch.query}\x1b[0m`);
      console.log(`\x1b[90m  Interval: ${watch.interval}\x1b[0m`);
      console.log(`\x1b[90m  Notify:   ${notifySpecs.map(n => n.type).join(', ') || 'none'}\x1b[0m`);
      console.log(`\n  Start the daemon: node index.js --watch-daemon\n`);
    } catch (err) {
      console.error(`\n  Error: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }

  if (args.watchDaemon) {
    await runDaemon(providerConfig);
    return;
  }

  // ── Standard investigation ────────────────────────────────────────────────

  if (!args.query) {
    console.log(USAGE);
    process.exit(1);
  }

  try {
    const result = await investigate(args.query, providerConfig, args.mode);

    const html = generateReport(result);
    const reportsDir = fileURLToPath(new URL('./reports', import.meta.url));
    const slug = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outPath = resolve(args.output || `${reportsDir}/report-${slug}.html`);
    mkdirSync(dirname(outPath), { recursive: true });
    console.log(`\x1b[90m  Saving to: ${outPath}\x1b[0m`);
    writeFileSync(outPath, html);
    console.log(`\x1b[32m  ✓ Report saved:\x1b[0m ${outPath}`);

    if (args.json) {
      const jsonPath = outPath.replace(/\.html$/, '.json');
      writeFileSync(jsonPath, JSON.stringify(result, null, 2));
      console.log(`\x1b[90m  JSON saved: ${jsonPath}\x1b[0m`);
    }

    if (args.open) {
      openFile(outPath);
    }

    console.log('');
  } catch (err) {
    console.error(`\n\x1b[31m  Error: ${err.message}\x1b[0m\n`);
    process.exit(1);
  }
}

main();
