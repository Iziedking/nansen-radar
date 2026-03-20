# OpenClaw Integration Setup Guide

Connect nansen-radar to WhatsApp, Telegram, and Discord so anyone can message in plain English and receive a full onchain risk report.

**How it works:**
```
User message (WhatsApp/Telegram/Discord)
  → OpenClaw gateway
  → OpenClaw agent reads BOOT.md → calls nansen-radar via exec
  → nansen-radar runs parallel Nansen queries + LLM analysis
  → formatted report sent back in chat
```

---

## Prerequisites

- [ ] Node.js 18+ (`node --version`)
- [ ] nansen-radar cloned and `.env` configured (see main README)
- [ ] Nansen CLI installed and authenticated:
  ```bash
  npm install -g nansen-cli
  nansen login --api-key YOUR_NANSEN_KEY
  ```
- [ ] OpenClaw installed:
  ```bash
  npm install -g openclaw
  openclaw --version
  ```

**Verify nansen-radar works before continuing:**
```bash
node index.js "Is KAITO safe? 0x98d0baa52b2d063e780de12f615f963fe8537553 on base" --quiet --stdout-json
```
Should print a single line of JSON. Fix any errors before proceeding.

---

## Step 1 — OpenClaw Initial Setup

```bash
openclaw setup
openclaw configure
```

In the configure wizard:
- **Gateway**: Local (this machine)
- **Model**: Anthropic Claude recommended, Ollama for free local
- **Channels**: configure at least one below

---

## Step 2 — Connect Your Platforms

### WhatsApp

1. In `openclaw configure` → **Channels** → **WhatsApp (QR link)**
2. A QR code appears in the terminal
3. On your phone: **WhatsApp → Settings → Linked Devices → Link a Device** → scan QR
4. Open dmPolicy to allow messages from any number:
   - In `~/.openclaw/openclaw.json`, set `channels.whatsapp.dmPolicy: "open"` and `allowFrom: ["*"]`

**Test:**
```bash
openclaw message send --target +YOUR_NUMBER --message "Hello from OpenClaw"
```

---

### Telegram

1. Open Telegram → search **@BotFather** → `/newbot` → copy the bot token
2. In `openclaw configure` → **Channels** → **Telegram (Bot API)** → paste token
3. Start a chat with your new bot in Telegram (search its username, press Start)
4. Get your Chat ID: send a message to the bot, then open `https://api.telegram.org/botYOUR_TOKEN/getUpdates` — find `"chat":{"id":XXXXXXXXX}`

**Test:**
```bash
openclaw message send --channel telegram --target YOUR_CHAT_ID --message "Hello from OpenClaw"
```

---

### Discord

1. Go to the Discord Developer Portal → New Application → Bot tab → Add Bot → copy token
2. Generate a bot invite URL (scopes: `bot`, permissions: `Send Messages`, `Read Message History`) → invite to your server
3. In `openclaw configure` → **Channels** → **Discord (Bot API)** → paste token

**Test:**
```bash
openclaw message send --channel discord --target YOUR_CHANNEL_ID --message "Hello from OpenClaw"
```

---

## Step 3 — Configure nansen-radar as a Tool

**3a. Get your absolute path:**
```bash
cd /path/to/nansen-radar && pwd
```

**3b. Copy the tool instructions into OpenClaw's workspace:**
```bash
cp openclaw/BOOT.md ~/.openclaw/workspace/BOOT.md
```

**3c. Update the path in BOOT.md:**
```bash
# Windows:
notepad ~/.openclaw/workspace/BOOT.md
# macOS/Linux:
nano ~/.openclaw/workspace/BOOT.md
```

Replace the example path with your actual absolute path:
```
# Windows Git Bash:
node /c/Users/yourname/projects/nansen-radar/index.js "QUERY" --quiet --stdout-json

# macOS/Linux:
node /home/yourname/projects/nansen-radar/index.js "QUERY" --quiet --stdout-json
```

**3d. Allow node to run without approval prompts:**
```bash
openclaw approvals allowlist add "node"
```

---

## Step 4 — Start the Gateway

**Foreground (shows logs — use for testing):**
```bash
openclaw gateway
```

**Background daemon:**
```bash
openclaw daemon start
```

**Health check:**
```bash
openclaw doctor
openclaw status
```

---

## Step 5 — Test the Full Flow

**Verify nansen-radar output:**
```bash
node index.js "Is KAITO safe? 0x98d0baa52b2d063e780de12f615f963fe8537553 on base" --quiet --stdout-json
```

**Test from WhatsApp:**
Send this from your phone to the linked number:
```
Is KAITO a good buy? 0x98d0baa52b2d063e780de12f615f963fe8537553 on base
```
You should get: `🔍 Investigating...` then the full report within ~60 seconds.

**Example queries:**
```
Is 0x98d0baa52b2d063e780de12f615f963fe8537553 on base safe to buy?
Analyze wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 on ethereum
Where is smart money moving on Solana right now?
Alert me if 0x98d0baa... on base moves 10%
My alerts
```

---

## Troubleshooting

**"Investigation failed — Nansen CLI not responding"**
```bash
nansen --version
nansen login --api-key KEY
```

**Path errors in exec**
- Check BOOT.md uses an absolute path with forward slashes
- Test directly: `node /your/path/to/nansen-radar/index.js --help`

**Gateway not routing messages:**
```bash
openclaw doctor
openclaw status
```

**WhatsApp disconnected:**
```bash
openclaw configure   # Channels → WhatsApp → re-scan QR
```

**Agent responding with generic answers instead of running nansen-radar:**
- Verify `~/.openclaw/workspace/BOOT.md` exists with the nansen-radar instructions
- Check the path inside BOOT.md is correct
- Restart: `openclaw daemon restart`

**LLM errors in nansen-radar:**
- Check `.env` keys are valid
- For Ollama: ensure `ollama serve` is running

---

## Running Everything Together

```bash
# Terminal 1: OpenClaw gateway
openclaw gateway

# Terminal 2: Ollama (only if using local LLM)
ollama serve

# Terminal 3: nansen-radar watch daemon (for scheduled alerts)
node index.js --watch-daemon
```
