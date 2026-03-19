import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { investigate } from './agent.js';
import { sendNotifications } from './notifier.js';

const WATCH_DIR  = join(homedir(), '.nansen-radar');
const WATCH_FILE = join(WATCH_DIR, 'watches.json');
const WATCH_TMP  = join(WATCH_DIR, 'watches.json.tmp');

// ── Store ─────────────────────────────────────────────────────────────────────

export function loadWatches() {
  if (!existsSync(WATCH_FILE)) return [];
  try {
    return JSON.parse(readFileSync(WATCH_FILE, 'utf8'));
  } catch {
    return [];
  }
}

export function saveWatches(watches) {
  mkdirSync(WATCH_DIR, { recursive: true });
  writeFileSync(WATCH_TMP, JSON.stringify(watches, null, 2));
  renameSync(WATCH_TMP, WATCH_FILE);
}

export function addWatch(query, interval, notifySpecs = [], mode = null) {
  parseCronInterval(interval); // validate before saving

  const watch = {
    id: `watch_${Date.now()}`,
    query,
    interval,
    notify: notifySpecs,
    mode: mode || null,
    createdAt: new Date().toISOString(),
    lastRun: null,
    lastRiskScore: null,
  };

  const watches = loadWatches();
  watches.push(watch);
  saveWatches(watches);
  return watch;
}

export function removeWatch(id) {
  const watches = loadWatches();
  const idx = watches.findIndex(w => w.id === id);
  if (idx === -1) return false;
  watches.splice(idx, 1);
  saveWatches(watches);
  return true;
}

export function listWatches() {
  return loadWatches();
}

// ── Notify spec parsing ───────────────────────────────────────────────────────

export function parseNotifySpec(str) {
  if (str.startsWith('discord:')) {
    return { type: 'discord', url: str.slice('discord:'.length) };
  }
  if (str.startsWith('slack:')) {
    return { type: 'slack', url: str.slice('slack:'.length) };
  }
  if (str.startsWith('telegram:')) {
    const rest = str.slice('telegram:'.length);
    const colonIdx = rest.indexOf(':');
    if (colonIdx === -1) throw new Error(`telegram notify spec requires format: telegram:BOT_TOKEN:CHAT_ID`);
    return { type: 'telegram', botToken: rest.slice(0, colonIdx), chatId: rest.slice(colonIdx + 1) };
  }
  throw new Error(`Unknown notify type in "${str}". Supported: discord:URL | slack:URL | telegram:TOKEN:CHAT_ID`);
}

// ── Cron interval parsing ─────────────────────────────────────────────────────

export function parseCronInterval(expr) {
  const s = expr.trim().toLowerCase();

  // Human-friendly: "30m", "6h", "1d", "2h", "15m", "1day", "12hours", etc.
  let m = s.match(/^(\d+)\s*m(?:in(?:utes?)?)?$/);
  if (m) return parseInt(m[1], 10) * 60 * 1000;

  m = s.match(/^(\d+)\s*h(?:ours?)?$/);
  if (m) return parseInt(m[1], 10) * 60 * 60 * 1000;

  m = s.match(/^(\d+)\s*d(?:ays?)?$/);
  if (m) return parseInt(m[1], 10) * 24 * 60 * 60 * 1000;

  // Cron syntax: "*/N * * * *"  → every N minutes
  m = expr.match(/^\*\/(\d+) \* \* \* \*$/);
  if (m) return parseInt(m[1], 10) * 60 * 1000;

  // Cron syntax: "0 */N * * *"  → every N hours
  m = expr.match(/^0 \*\/(\d+) \* \* \*$/);
  if (m) return parseInt(m[1], 10) * 60 * 60 * 1000;

  // Cron syntax: "0 0 */N * *"  → every N days
  m = expr.match(/^0 0 \*\/(\d+) \* \*$/);
  if (m) return parseInt(m[1], 10) * 24 * 60 * 60 * 1000;

  throw new Error(
    `Unrecognised interval: "${expr}"\n` +
    `  Use a simple format like:  30m  |  6h  |  1d\n` +
    `  Or cron syntax:            "*/30 * * * *"  |  "0 */6 * * *"`
  );
}

// ── Daemon ────────────────────────────────────────────────────────────────────

export async function runDaemon(providerConfig) {
  const watches = loadWatches();

  if (!watches.length) {
    console.log('\n  No watches configured. Add one with --watch-add\n');
    process.exit(0);
  }

  console.log(`\n\x1b[1m  NANSEN RADAR DAEMON\x1b[0m — watching ${watches.length} token(s)\n`);

  for (const watch of watches) {
    const intervalMs = parseCronInterval(watch.interval);
    const humanInterval = formatInterval(intervalMs);
    console.log(`\x1b[90m  [${watch.id}] "${watch.query.slice(0, 60)}" — every ${humanInterval}\x1b[0m`);

    // Run immediately on daemon start
    runWatchJob(watch, providerConfig);

    // Then on interval
    setInterval(() => runWatchJob(watch, providerConfig), intervalMs);
  }

  console.log('');

  // Keep process alive
  process.stdin.resume();
}

async function runWatchJob(watch, providerConfig) {
  console.log(`\n\x1b[36m  [${watch.id}] Running watch job...\x1b[0m`);
  try {
    const result = await investigate(watch.query, providerConfig, watch.mode);
    await sendNotifications(watch.notify, result);

    // Persist last run metadata
    const watches = loadWatches();
    const idx = watches.findIndex(w => w.id === watch.id);
    if (idx !== -1) {
      watches[idx].lastRun = new Date().toISOString();
      watches[idx].lastRiskScore = result.analysis?.riskScore ?? null;
      saveWatches(watches);
    }

    console.log(`\x1b[32m  [${watch.id}] Done — risk score: ${result.analysis?.riskScore ?? '?'}/100\x1b[0m`);
  } catch (err) {
    console.error(`\x1b[31m  [${watch.id}] Job failed: ${err.message}\x1b[0m`);
  }
}

function formatInterval(ms) {
  if (ms < 60 * 60 * 1000) return `${ms / (60 * 1000)}m`;
  if (ms < 24 * 60 * 60 * 1000) return `${ms / (60 * 60 * 1000)}h`;
  return `${ms / (24 * 60 * 60 * 1000)}d`;
}
