import { NANSEN_COMMANDS, SUPPORTED_CHAINS, CLAUDE_MODEL, MAX_COMMANDS_PER_STEP } from './config.js';

const API_URL = 'https://api.anthropic.com/v1/messages';

async function callClaude(systemPrompt, userMessage, apiKey) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.content.map(b => b.text || '').join('');
  return text;
}

function buildCommandReference() {
  return NANSEN_COMMANDS.map(c => {
    const req = c.requires.length ? `Required: ${c.requires.join(', ')}` : 'No required flags';
    const opt = c.optional.length ? `Optional: ${c.optional.join(', ')}` : '';
    return `• ${c.command}\n  ${c.description}\n  ${req}${opt ? '\n  ' + opt : ''}\n  Returns: ${c.returns}`;
  }).join('\n\n');
}

const PLANNER_SYSTEM = `You are an onchain intelligence agent. You investigate crypto problems using Nansen CLI commands.

Available commands:
${buildCommandReference()}

Supported chains: ${SUPPORTED_CHAINS.join(', ')}

Your job: given a user's question or problem, return a JSON array of nansen CLI commands to execute.

Rules:
- Return ONLY valid JSON. No markdown, no explanation. Just a JSON object.
- Maximum ${MAX_COMMANDS_PER_STEP} commands per batch.
- Each command must be a complete nansen CLI string ready to execute.
- Use --limit to keep responses manageable (10-30 rows).
- Use --fields when you only need specific columns.
- For token-specific queries, you need the token contract address. If the user gives a symbol, use "research search entities --query <symbol>" first to resolve it.
- For wallet investigations, use profiler commands.
- For market-wide scans, use screener and smart-money commands.
- Think about what data actually answers the user's question.

Response format:
{
  "intent": "one sentence describing what the user wants to know",
  "plan": ["nansen research ...", "nansen research ..."],
  "reasoning": "why these specific queries answer the question"
}`;

export async function planInvestigation(query, apiKey) {
  const response = await callClaude(PLANNER_SYSTEM, query, apiKey);

  try {
    const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse plan: ${response.slice(0, 300)}`);
  }
}

const ANALYST_SYSTEM = `You are an onchain intelligence analyst. You receive raw data from Nansen CLI queries and produce a structured investigation report.

Your job: analyze the data, find patterns, spot risks, and give actionable insights.

Rules:
- Return ONLY valid JSON. No markdown.
- Be specific with numbers — cite actual values from the data.
- Identify red flags, green flags, and notable patterns.
- If data is missing or a query failed, note it but don't fabricate.
- Give a risk score from 0-100 (0 = extremely dangerous, 100 = very safe).
- Provide concrete recommendations, not generic advice.

Response format:
{
  "title": "Short report title",
  "summary": "2-3 sentence executive summary",
  "riskScore": 72,
  "riskLabel": "MODERATE|LOW RISK|HIGH RISK|CRITICAL",
  "findings": [
    {
      "category": "Smart Money|Holder Risk|Liquidity|Market Activity|Wallet Profile|Derivatives",
      "severity": "positive|neutral|warning|danger",
      "title": "Short finding title",
      "detail": "Detailed explanation with specific numbers from the data",
      "dataPoints": ["key: value", "key: value"]
    }
  ],
  "recommendations": [
    "Specific actionable recommendation"
  ],
  "needsMoreData": false,
  "followUpCommands": []
}

If you determine more data is needed to answer the question properly, set needsMoreData to true and provide followUpCommands with additional nansen CLI commands to run.`;

export async function analyzeResults(query, plan, executionResults, apiKey) {
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

  const response = await callClaude(ANALYST_SYSTEM, userMsg, apiKey);

  try {
    const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse analysis: ${response.slice(0, 300)}`);
  }
}
