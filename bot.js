import { createServer } from 'node:http';
import { investigate } from './agent.js';
import { addWatch, removeWatch, listWatches } from './watcher.js';
import {
  SessionStore,
  detectIntent,
  buildWelcomeMessage,
  buildHelpMessage,
  buildAckMessage,
  buildAnalysisReply,
  buildAlertSetConfirmation,
  buildAlertListMessage,
  buildAlertRemovedMessage,
  buildAlertMissingParamsMessage,
  buildUnknownMessage,
  buildErrorMessage,
  buildCancelledMessage,
} from './conversation.js';

// ── State ─────────────────────────────────────────────────────────────────────

const sessions = new SessionStore();

// In-flight investigations keyed as "platform:from" — prevents duplicate runs
const inFlight = new Set();

// ── Core handler ──────────────────────────────────────────────────────────────

async function handleWebhook(body, providerConfig) {
  const { platform, from, text } = body;

  if (!text || typeof text !== 'string' || text.trim().length < 2) return;

  const session      = sessions.get(platform, from);
  const openclawBase = process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789';

  console.log(`\x1b[90m  [bot] ${platform}:${from} → ${text.slice(0, 80)}\x1b[0m`);

  // ── Classify intent (regex pre-filter + LLM) ───────────────────────────────
  let type, params;
  try {
    ({ type, params } = await detectIntent(text.trim(), session, providerConfig));
  } catch {
    type   = 'unknown';
    params = {};
  }
  console.log(`\x1b[90m  [bot] intent=${type}\x1b[0m`);

  // ── Route ──────────────────────────────────────────────────────────────────
  try {
    switch (type) {

      // ── Instant responses ─────────────────────────────────────────────────

      case 'greeting': {
        await sendReply(platform, from, openclawBase, buildWelcomeMessage(platform));
        sessions.update(session);
        break;
      }

      case 'help': {
        await sendReply(platform, from, openclawBase, buildHelpMessage(platform));
        sessions.update(session);
        break;
      }

      case 'cancel': {
        await sendReply(platform, from, openclawBase, buildCancelledMessage(platform));
        break;
      }

      // ── Investigations ────────────────────────────────────────────────────

      case 'analyze_token':
      case 'analyze_wallet':
      case 'analyze_market': {
        const key = `${platform}:${from}`;

        if (inFlight.has(key)) {
          await sendReply(platform, from, openclawBase,
            '⏳ I\'m already running an investigation for you. Please wait for it to finish.');
          return;
        }

        // First-time users get the welcome banner before their first result
        if (!session.welcomed) {
          await sendReply(platform, from, openclawBase, buildWelcomeMessage(platform));
        }

        const mode = type === 'analyze_wallet' ? 'wallet'
                   : type === 'analyze_market' ? 'market'
                   : 'token';

        const query = params.query
          || (params.address && params.chain ? `${params.address} on ${params.chain}` : null)
          || text.trim();

        // Ack immediately so user knows something is happening
        await sendReply(platform, from, openclawBase, buildAckMessage());

        inFlight.add(key);
        try {
          const result = await investigate(query, providerConfig, mode, /* quiet */ true);
          await sendReply(platform, from, openclawBase, buildAnalysisReply(result, platform));
          sessions.update(session, {
            query,
            riskScore: result.analysis?.riskScore ?? null,
          });
          console.log(`\x1b[32m  [bot] Investigation complete for ${key}\x1b[0m`);
        } finally {
          inFlight.delete(key);
        }
        break;
      }

      // ── Price alerts ──────────────────────────────────────────────────────

      case 'set_alert': {
        const threshold = params.threshold ? parseFloat(params.threshold) : null;
        const address   = params.address || null;
        const chain     = params.chain   || 'ethereum';
        const interval  = params.interval || '1h';

        if (!threshold || (!address && !params.query)) {
          await sendReply(platform, from, openclawBase, buildAlertMissingParamsMessage(platform));
          break;
        }

        const watchQuery = params.query
          || (address ? `${address} on ${chain}` : text.trim());

        // Notify spec routes the alert back to this same user via OpenClaw
        const notifySpec = { type: 'openclaw', platform, to: from };

        const watch = addWatch(watchQuery, interval, [notifySpec], 'token', threshold);
        await sendReply(platform, from, openclawBase, buildAlertSetConfirmation(watch, platform));
        sessions.update(session);
        break;
      }

      case 'list_alerts': {
        const userWatches = getUserWatches(platform, from);
        await sendReply(platform, from, openclawBase, buildAlertListMessage(userWatches, platform));
        sessions.update(session);
        break;
      }

      case 'remove_alert': {
        const userWatches = getUserWatches(platform, from);
        const idx         = params.alertId ? parseInt(params.alertId, 10) - 1 : -1;
        const target      = userWatches[idx];

        if (!target) {
          const msg = userWatches.length
            ? `Which alert? Reply "Remove alert [number]"\n\n${buildAlertListMessage(userWatches, platform)}`
            : buildAlertListMessage(userWatches, platform);
          await sendReply(platform, from, openclawBase, msg);
          break;
        }

        const removed = removeWatch(target.id);
        const reply   = removed
          ? buildAlertRemovedMessage(target.query, platform)
          : '⚠️ Could not remove that alert — it may have already been deleted.';
        await sendReply(platform, from, openclawBase, reply);
        sessions.update(session);
        break;
      }

      // ── Fallback ──────────────────────────────────────────────────────────

      default: { // 'unknown' + any unhandled types
        const msg = !session.welcomed
          ? buildWelcomeMessage(platform)
          : buildUnknownMessage(platform);
        await sendReply(platform, from, openclawBase, msg);
        sessions.update(session);
        break;
      }
    }
  } catch (err) {
    console.error(`\x1b[31m  [bot] Handler error (${platform}:${from}): ${err.message}\x1b[0m`);
    inFlight.delete(`${platform}:${from}`);
    try {
      await sendReply(platform, from, openclawBase, buildErrorMessage(err, platform));
    } catch {}
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getUserWatches(platform, from) {
  return listWatches().filter(w =>
    w.notify.some(n => n.type === 'openclaw' && n.platform === platform && n.to === from),
  );
}

async function sendReply(platform, to, openclawBase, text) {
  const res = await fetch(`${openclawBase}/${platform}/send`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ to, text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenClaw send (${platform}) ${res.status}: ${body.slice(0, 100)}`);
  }
}

// ── HTTP server ───────────────────────────────────────────────────────────────

export function startBotServer(providerConfig, port = 3456) {
  const server = createServer((req, res) => {

    if (req.method === 'POST' && req.url === '/webhook') {
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        // Always respond 200 immediately — processing is async
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));

        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          console.warn('\x1b[33m  [bot] Non-JSON webhook body\x1b[0m');
          return;
        }

        handleWebhook(body, providerConfig).catch(err => {
          console.error(`\x1b[31m  [bot] Unhandled: ${err.message}\x1b[0m`);
        });
      });

    } else if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, inFlight: inFlight.size, sessions: sessions.size }));

    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`\n\x1b[1m  NANSEN RADAR BOT\x1b[0m — Conversational Agent\n`);
    console.log(`\x1b[90m  Listening: http://127.0.0.1:${port}/webhook\x1b[0m`);
    console.log(`\x1b[90m  Health:    http://127.0.0.1:${port}/health\x1b[0m`);
    console.log(`\n\x1b[90m  Register in OpenClaw:\x1b[0m`);
    console.log(`\x1b[90m    openclaw webhook add --url http://127.0.0.1:${port}/webhook --platform whatsapp\x1b[0m`);
    console.log(`\x1b[90m    openclaw webhook add --url http://127.0.0.1:${port}/webhook --platform telegram\x1b[0m`);
    console.log(`\x1b[90m    openclaw webhook add --url http://127.0.0.1:${port}/webhook --platform discord\x1b[0m`);
    console.log(`\n\x1b[90m  Capabilities: token · wallet · market analysis · price alerts\x1b[0m\n`);
  });

  server.on('error', err => {
    console.error(`\x1b[31m  [bot] Server error: ${err.message}\x1b[0m`);
  });

  process.stdin.resume();
}
