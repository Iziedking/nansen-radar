# Nansen Radar

Onchain intelligence agent for pre-trade due diligence. Powered by [Nansen CLI](https://github.com/nansen-ai/nansen-cli).

Ask a question in plain English. The agent plans an investigation, runs the right Nansen queries, analyzes the data, and produces a scored risk report.

---

## The Problem It Solves

A wallet recently swapped $50 million USDT for AAVE tokens and received $36,000 worth back a 99.9% loss absorbed by MEV attacks and protocol fees. The wallet had no intelligence on liquidity depth, token flow concentration, or on-chain routing risk before executing.

This is not rare. It is the default outcome for anyone moving size without reading the chain first.

Nansen Radar changes that. Before you swap, bridge, or enter a position, the agent queries smart money behavior, holder concentration, token flow patterns, and liquidity dynamics then tells you what the data says. If the route is compromised, the pool is thin, or whales are positioned against the trade, you know before you sign.

---

## What It Does

- Analyzes token safety, holder distribution, and concentration risk
- Detects smart money accumulation or distribution before it moves price
- Flags MEV-exposed routes and low-liquidity pools before you enter
- Identifies who bought, who sold, and what labeled wallets are holding
- Profiles wallet behavior and counterparty risk
- Monitors unusual transfer patterns, large outflows, and suspicious flow intelligence
- Covers derivatives; perp screener, open interest, and positioning data

The agent picks the right Nansen endpoints for your question. You do not configure anything you ask, it investigates.

---

## How It Works

```
User query (plain English)
        │
        ▼
Claude reads the full Nansen command schema
and writes an investigation plan
        │
        ▼
Agent executes 5–15 Nansen CLI queries
        │
        ▼
Claude analyzes all returned data,
identifies patterns and risk signals
        │
        ▼
If more data is needed, agent runs
targeted follow-up queries (max 4 rounds)
        │
        ▼
Final report: risk score, findings,
recommendations saved as HTML
```

---

## Prerequisites

**Nansen CLI**
```bash
npm install -g nansen-cli
nansen login --api-key <your-nansen-api-key>
```

**Claude API key**

Create a `.env` file in the project root:
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Or export it directly:
```bash
export ANTHROPIC_API_KEY=sk-ant-your-key-here
```

---

## Install

```bash
git https://github.com/Iziedking/nansen-radar.git
cd nansen-radar
```

No `npm install` needed. Zero external dependencies.

---

## Usage

```bash
node index.js "<your question>"
```

### Pre-swap intelligence

```bash
# Before swapping into a token
node index.js "I want to buy $50K of JUP on Solana — what are the risks?"

# Check liquidity and routing before a large trade
node index.js "Is there enough liquidity to swap 500 SOL into BONK without heavy slippage?"

# Check if smart money is exiting before you enter
node index.js "Is smart money accumulating or distributing PENDLE on ethereum right now?"
```

### Token safety

```bash
node index.js "Is this token safe? AetrqKMgn6Q5LCvRBShnu5DGM5qz4CSHURzUccgDpump on solana"
node index.js "Is 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 on ethereum safe to hold?"
```

### Wallet and counterparty analysis

```bash
node index.js "Who is behind this wallet: 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 on ethereum"
node index.js "What has this Solana wallet been trading recently?"
```

### Market intelligence

```bash
node index.js "Where is smart money rotating on Solana this week?"
node index.js "Is there unusual perp activity on ETH right now?"
node index.js "What tokens are smart money funds accumulating on Base?"
```

### Options

| Flag | Description |
|------|-------------|
| `--output <path>` | Custom output path (default: `reports/report-<timestamp>.html`) |
| `--json` | Also export raw JSON alongside the HTML report |
| `--no-open` | Do not auto-open the report in the browser |

Reports are saved to the `reports/` directory with a timestamp filename. Each run produces a separate file.

---

## Report Output

Each investigation produces a self-contained HTML report containing:

- **Risk score** — 0 to 100 with visual gauge, color-coded by severity
- **Executive summary** — plain-language assessment of the overall situation
- **Intelligence signals** — individual findings with severity levels and supporting data points
- **Action items** — specific, prioritized recommendations based on the findings

---

## Architecture

```
index.js      CLI entry point, .env loading, file output, browser open
agent.js      Investigation loop: plan → execute → analyze → follow-up
planner.js    Claude API integration: investigation planning and result analysis
nansen.js     Nansen CLI execution wrapper with bash shell routing
config.js     Command schema (22+ endpoints), supported chains, constants
report.js     Self-contained HTML report generator
```

**Investigation loop (agent.js):**

1. Sends the query to Claude with the full Nansen command schema
2. Claude returns a structured plan: intent, strategy, and specific commands
3. Agent runs each command via the Nansen CLI
4. Results are returned to Claude for analysis
5. Claude scores risk, surfaces findings, and determines if follow-up data is needed
6. Loop repeats up to 4 rounds if deeper investigation is warranted
7. Final HTML report is generated and saved

**Supported chains:** ethereum, solana, base, bnb, arbitrum, polygon, optimism, avalanche, linea, scroll, mantle, ronin, sei, sonic, hyperevm

---

## Stack

Pure ESM Node.js. Zero npm dependencies. Requires Node.js 18+.

Uses `child_process` to execute Nansen CLI commands and the native `fetch` API for Claude. No build step.

---

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key from console.anthropic.com |
| Nansen API key | Yes | Set via `nansen login --api-key <key>` |

---

