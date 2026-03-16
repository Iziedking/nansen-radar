import { planInvestigation, analyzeResults } from './planner.js';
import { executeBatch, runHealthCheck } from './nansen.js';
import { MAX_AGENT_STEPS } from './config.js';

export async function investigate(query, apiKey) {
  const log = [];
  let allResults = [];
  let analysis = null;

  console.log(`\n\x1b[1m  NANSEN RADAR\x1b[0m — starting investigation\n`);
  console.log(`\x1b[90m  Query: ${query}\x1b[0m\n`);

  const health = await runHealthCheck();
  if (!health.ok) {
    throw new Error(
      `Nansen CLI is not responding or not authenticated.\n\n` +
      `  1. Install:      npm install -g nansen-cli\n` +
      `  2. Authenticate: nansen login --api-key <your-nansen-key>\n` +
      `  3. Verify:       nansen --version`
    );
  }
  console.log(`\x1b[90m  Nansen CLI: ${health.raw}\x1b[0m\n`);

  console.log(`\x1b[36m  ► Planning investigation...\x1b[0m`);
  const plan = await planInvestigation(query, apiKey);
  console.log(`\x1b[90m  Intent: ${plan.intent}\x1b[0m`);
  console.log(`\x1b[90m  Strategy: ${plan.reasoning}\x1b[0m`);
  console.log(`\x1b[90m  Commands: ${plan.plan.length}\x1b[0m\n`);

  log.push({ step: 'plan', intent: plan.intent, commands: plan.plan });

  for (let step = 0; step < MAX_AGENT_STEPS; step++) {
    const commands = step === 0 ? plan.plan : analysis.followUpCommands;

    if (!commands || !commands.length) break;

    const label = step === 0 ? 'Executing initial queries' : `Follow-up round ${step}`;
    console.log(`\x1b[36m  ► ${label}...\x1b[0m`);

    const results = await executeBatch(commands);
    allResults = allResults.concat(results);

    const succeeded = results.filter(r => r.success).length;
    const totalCalls = allResults.length;
    console.log(`\x1b[90m  ${succeeded}/${results.length} succeeded (${totalCalls} total calls)\x1b[0m\n`);

    log.push({
      step: `execute-${step}`,
      commands: commands.length,
      succeeded,
      totalCalls,
    });

    console.log(`\x1b[36m  ► Analyzing data...\x1b[0m`);
    analysis = await analyzeResults(query, plan, allResults, apiKey);
    console.log(`\x1b[90m  Risk: ${analysis.riskLabel} (${analysis.riskScore}/100)\x1b[0m`);
    console.log(`\x1b[90m  Findings: ${analysis.findings?.length || 0}\x1b[0m\n`);

    log.push({
      step: `analyze-${step}`,
      riskScore: analysis.riskScore,
      findings: analysis.findings?.length || 0,
      needsMore: analysis.needsMoreData,
    });

    if (!analysis.needsMoreData) break;
    if (!analysis.followUpCommands?.length) break;

    console.log(`\x1b[33m  Agent determined more data needed...\x1b[0m\n`);
  }

  return {
    query,
    plan,
    results: allResults,
    analysis,
    log,
    totalCalls: allResults.length,
    timestamp: new Date().toISOString(),
  };
}
