# nansen-radar

AI-powered onchain due diligence agent. Ask a question in plain English — it runs Nansen CLI queries, analyzes the data with an LLM, and gives you a risk score, findings, and recommendations. Use it from the terminal, schedule automated alerts, or chat with it directly from WhatsApp, Telegram, or Discord.

---

## Quick Start (5 minutes)

**1. Install Nansen CLI and authenticate**
```bash
npm install -g nansen-cli
nansen login --api-key <your-nansen-api-key>
```

**2. Install Ollama (free, local LLM — no API cost)**
```bash
# Windows
winget install Ollama.Ollama

# macOS / Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Pull a model
ollama pull llama3.2
```

**3. Clone and configure**
```bash
git clone https://github.com/your-username/nansen-radar
cd nansen-radar
cp .env.example .env
# .env already defaults to LLM_PROVIDER=ollama — no edits needed
```

**4. Investigate a token**
```bash
node index.js "Is this token safe to buy? 0x98d0baa52b2d063e780de12f615f963fe8537553 on base"
```

A browser opens with a full HTML report: risk score, findings, recommendations, radar chart.

---

## Free LLM Options

| Provider | Cost | Setup |
|---|---|---|
| **Ollama** (recommended) | Free, local | `winget install Ollama.Ollama` then `ollama pull llama3.2` |
| **Google Gemini** | Free tier | `GEMINI_API_KEY=...` in `.env`, set `LLM_PROVIDER=gemini` |
| **OpenRouter** | Free models available | `OPENROUTER_API_KEY=...` in `.env`, set `LLM_PROVIDER=openrouter` |
| **Anthropic Claude** | Paid, best quality | `ANTHROPIC_API_KEY=...` in `.env`, set `LLM_PROVIDER=anthropic` |

Set your provider once in `.env` — no flags needed at runtime.

**Model quality tip:** Larger models produce richer analysis. For Ollama:
- `llama3.2` — fast, lightweight, good for quick checks
- `qwen2.5:7b` — better reasoning, recommended for serious analysis
- `gemma3:12b` — best local quality

---

## Investigating Tokens, Wallets, and Markets

```bash
# Token analysis (mode auto-detected from address)
node index.js "Is this safe? 0x98d0baa... on base"

# Force mode explicitly
node index.js "0x98d0baa... on base" --mode token
node index.js "Investigate wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 on ethereum" --mode wallet
node index.js "Where is smart money moving on Solana?" --mode market

# Save raw JSON alongside the HTML report
node index.js "..." --json

# Skip auto browser open
node index.js "..." --no-open

# Override LLM for a single run
node index.js "..." --provider gemini --model gemini-1.5-pro
node index.js "..." --provider ollama --model qwen2.5:7b
```

---

## Chat Bot — WhatsApp, Telegram & Discord

Talk to nansen-radar directly from your favorite chat app in plain English. The bot understands natural language, maintains conversation context, runs full Nansen investigations, and lets you set price alerts — all without leaving the chat.

```
You:  "Is 0x98d0... on base safe to buy?"
Bot:  🔍 Investigating... Running Nansen queries. ~60 seconds. Hang tight.
Bot:  🔭 KAITO Token — Base Chain
      Risk: 31/100 — CRITICAL 🟣
      Smart money has been net selling for 3 days...

      Findings:
      🔴 Smart Money Distribution — $2.1M net outflow in 72h
      🔴 Holder Concentration — top wallet holds 18.4% of supply
      🟡 DEX Liquidity — thin pools, high slippage risk
      ...

      💡 You can also ask:
      • "Alert me if this token moves 10%"
      • "Who is currently buying this token?"
```

### What the bot understands

| You say | Bot does |
|---|---|
| "hi" / "hello" | Sends welcome message with capability overview |
| "help" | Shows full command examples |
| "Is 0x98d0... on base safe?" | Token risk analysis |
| "Analyze wallet 0xd8dA6... on ethereum" | Wallet PnL + trade history |
| "What is smart money doing on Solana?" | Market intelligence report |
| "Alert me if 0x98d0... moves 10%" | Creates price watch, notifies you when triggered |
| "My alerts" | Lists your active price watches |
| "Remove alert 2" | Cancels a watch by number |

The bot uses LLM-powered intent detection — it understands natural phrasing, crypto slang, contract addresses, chain names, and percentage thresholds from plain language.

### Setup (bot mode)

The bot uses OpenClaw's AI agent as the transport layer. When someone messages your linked WhatsApp/Telegram/Discord, OpenClaw's agent reads the nansen-radar instructions, runs the investigation via `exec`, and replies in-chat — no separate bot server needed.

**Step 1 — Install and configure OpenClaw**
```bash
npm install -g openclaw
openclaw setup
openclaw configure   # → connect WhatsApp / Telegram / Discord
```

**Step 2 — Copy the nansen-radar instructions into OpenClaw's workspace**
```bash
cp openclaw/BOOT.md ~/.openclaw/workspace/BOOT.md
```

Open `~/.openclaw/workspace/BOOT.md` and update the path to match your nansen-radar installation.

**Step 3 — Allow node to run without approval prompts**
```bash
openclaw approvals allowlist add "node"
```

**Step 4 — Start the gateway**
```bash
openclaw gateway
```

Message the bot from WhatsApp, Telegram, or Discord — it handles the welcome flow, intent detection, investigations, and price alerts automatically.

**Full platform setup guide (QR scan for WhatsApp, BotFather for Telegram, Discord bot invite):**
→ [openclaw/SETUP.md](./openclaw/SETUP.md)

---

## Price Alerts

Get notified when a token's price moves beyond a threshold. Works from the CLI or directly from chat.

**From the CLI:**
```bash
# Alert on Discord if price moves ±10%
node index.js --watch-add "0x98d0baa... on base" \
  --interval 1h \
  --price-alert 10 \
  --notify "discord:https://discord.com/api/webhooks/ID/TOKEN"

# Alert back to your WhatsApp number
node index.js --watch-add "0x98d0baa... on base" \
  --interval 1h \
  --price-alert 10 \
  --notify "whatsapp:+1234567890"

# Multiple channels simultaneously
node index.js --watch-add "0x98d0baa... on base" \
  --interval 6h \
  --price-alert 5 \
  --notify "discord:https://discord.com/api/webhooks/ID/TOKEN" \
  --notify "telegram:BOT_TOKEN:CHAT_ID"
```

**From chat (bot mode):**
```
"Alert me if 0x98d0... on base moves 10%"
→ Alert set! Checks every 1h. I'll notify you here when triggered.

"My alerts"
→ Your Active Alerts (2)
   1. 0x98d0... on base · Trigger: ±10% · every 1h
   2. WETH on ethereum · Trigger: ±5% · every 6h

"Remove alert 1"
→ 🗑️ Alert removed
```

When a price alert fires, the daemon sends a full risk report to the same chat where the alert was set.

**Manage from CLI:**
```bash
node index.js --watch-list
node index.js --watch-remove <id>
node index.js --watch-daemon   # start the scheduler
npm run daemon                 # same
```

**Interval formats:** `30m` | `6h` | `12h` | `1d` | `2d`

---

## Notification Channels

| Format | Delivery | Content |
|---|---|---|
| `discord:WEBHOOK_URL` | Rich embed with color-coded risk | Title, risk score, findings as fields |
| `slack:WEBHOOK_URL` | Plain text | Full report as text |
| `telegram:BOT_TOKEN:CHAT_ID` | MarkdownV2 formatted | Emoji-rich structured report |
| `whatsapp:+NUMBER` | Plain text via OpenClaw | Full report |
| `openclaw:PLATFORM:TARGET` | Via OpenClaw to any platform | Full report (used internally by bot alerts) |

---

## All CLI Flags

| Flag | Description |
|---|---|
| `--mode token\|wallet\|market` | Force investigation type (auto-detected if omitted) |
| `--provider <name>` | LLM provider: `ollama`, `anthropic`, `gemini`, `openrouter`, `openclaw` |
| `--model <name>` | Override model for this run |
| `--output <path>` | Custom output path for HTML report |
| `--json` | Also save raw JSON alongside HTML |
| `--no-open` | Don't auto-open browser |
| `--quiet` | Suppress all progress output (for scripting) |
| `--stdout-json` | Print result JSON to stdout instead of HTML (for piping) |
| `--watch-add <query>` | Add query to watch list |
| `--interval <expr>` | Watch interval: `30m`, `6h`, `1d` |
| `--price-alert <pct>` | Trigger alert if price moves ±N% since last check |
| `--notify <spec>` | Notification target (repeatable for multiple channels) |
| `--watch-list` | List all active watches |
| `--watch-remove <id>` | Remove a watch by ID |
| `--watch-daemon` | Start the watch scheduler daemon |
| `--bot` | Start the conversational bot webhook server |
| `--bot-port <port>` | Bot port (default: 3456) |

---

## Environment Variables (.env)

```bash
# LLM provider (pick one)
LLM_PROVIDER=ollama          # ollama | anthropic | gemini | openrouter | openclaw
LLM_MODEL=llama3.2           # overrides provider default

# Provider keys (only needed for the chosen provider)
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=...

# Ollama (optional overrides)
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2

# OpenClaw gateway (required for WhatsApp/Telegram/Discord bot)
OPENCLAW_BASE_URL=http://127.0.0.1:18789
```

Copy `.env.example` to `.env` — all options are included with comments.

---

## Architecture

Zero npm dependencies. Pure ESM Node.js ≥18. Uses only `child_process`, `fetch`, and native modules.

```
┌─────────────────────────────────────────────────────────────┐
│                     ENTRY POINTS                            │
│                                                             │
│  node index.js "query"     →  CLI investigation            │
│  node index.js --bot       →  Conversational bot server    │
│  node index.js --watch-*   →  Scheduled alert management   │
└────────────┬────────────────────────┬───────────────────────┘
             │                        │
             ▼                        ▼
       agent.js                  bot.js + conversation.js
  Investigation loop           Intent routing + session store
  plan → execute → analyze     detectIntent() → LLM classifier
             │                        │
             └──────────┬─────────────┘
                        ▼
                   planner.js
            LLM: plan + analyze results
                        │
                        ▼
                   nansen.js
          Run Nansen CLI commands in parallel
          (Promise.allSettled, 30s timeout)
                        │
                        ▼
              ┌─────────┴──────────┐
              ▼                    ▼
          report.js           notifier.js
      HTML report           Discord embed
      (self-contained)      Telegram MD
                            WhatsApp/OpenClaw
```

| File | Role |
|---|---|
| `index.js` | CLI entry, arg parsing, all mode dispatch |
| `agent.js` | Investigation loop (`plan → execute → analyze → loop`) |
| `planner.js` | LLM calls: investigation planning + result analysis |
| `nansen.js` | Nansen CLI wrapper, parallel batch execution |
| `llm.js` | Multi-provider LLM abstraction (anthropic/ollama/gemini/openrouter/openclaw) |
| `config.js` | Command registry (22+ Nansen commands), chains, constants |
| `report.js` | Self-contained HTML report with SVG radar chart |
| `notifier.js` | Webhook notifications (Discord embed, Telegram MarkdownV2, WhatsApp, OpenClaw) |
| `watcher.js` | Watch store, cron scheduler, price alert logic |
| `price.js` | CoinGecko price fetch for price alerts |
| `bot.js` | Conversational bot HTTP server, intent router |
| `conversation.js` | SessionStore, LLM intent classifier, platform-aware message builders |
