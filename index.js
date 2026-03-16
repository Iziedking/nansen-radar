#!/usr/bin/env node

import { investigate } from './agent.js';
import { generateReport } from './report.js';
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

  Uses Nansen CLI for data and Claude for reasoning.
  Describe your problem in plain English. The agent investigates.

  Usage:
    nansen-radar "<your question>"
    nansen-radar --query "<your question>" [options]

  Options:
    --query <text>       Investigation query (or pass as first arg)
    --output <path>      Output HTML report path (default: ./radar-report.html)
    --json               Also save raw JSON alongside HTML
    --no-open            Don't auto-open the report in browser
    --help               Show this message

  Environment:
    ANTHROPIC_API_KEY    Required — your Claude API key
    NANSEN_API_KEY       Required — set via nansen login or env var

  Examples:
    nansen-radar "Is this token safe? 0xC02...6Cc2 on ethereum"
    nansen-radar "Where is smart money moving on Solana this week?"
    nansen-radar "Investigate this wallet: 0xd8dA...96045 on ethereum"
    nansen-radar "I want to buy \$50K of JUP on Solana — what are the risks?"
`;

function parseArgs(argv) {
  const args = { open: true };

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
    } else if (arg === '--output' && argv[i + 1]) {
      args.output = argv[++i];
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

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }

  if (!args.query) {
    console.log(USAGE);
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('\n  Error: ANTHROPIC_API_KEY is required.\n  Add it to .env or export ANTHROPIC_API_KEY=sk-ant-...\n');
    process.exit(1);
  }

  try {
    const result = await investigate(args.query, apiKey);

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
