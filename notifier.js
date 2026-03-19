const SEV_ORDER = { danger: 0, warning: 1, neutral: 2, positive: 3 };

export function buildNotificationText(result) {
  const { query, analysis, totalCalls, timestamp } = result;
  const findings = analysis?.findings || [];
  const recommendations = analysis?.recommendations || [];
  const riskScore = analysis?.riskScore ?? '?';
  const riskLabel = analysis?.riskLabel || 'UNKNOWN';
  const summary = analysis?.summary || '';

  const topFinding = [...findings]
    .sort((a, b) => (SEV_ORDER[a.severity] ?? 4) - (SEV_ORDER[b.severity] ?? 4))[0];

  const recLines = recommendations.slice(0, 3)
    .map((r, i) => `  ${i + 1}. ${r}`)
    .join('\n');

  const lines = [
    'NANSEN RADAR ALERT',
    '',
    `Query: ${query}`,
    `Risk Score: ${riskScore}/100 — ${riskLabel}`,
    '',
    summary,
  ];

  if (topFinding) {
    lines.push('', `Top Finding: ${topFinding.title}`);
    if (topFinding.detail) lines.push(`  ${topFinding.detail.slice(0, 200)}`);
  }

  if (recLines) {
    lines.push('', 'Recommendations:', recLines);
  }

  const dateStr = timestamp ? timestamp.replace('T', ' ').slice(0, 19) + ' UTC' : '';
  lines.push('', `Investigated: ${dateStr} | ${totalCalls || 0} queries run`);

  return lines.join('\n');
}

export async function sendNotifications(notifySpecs, result) {
  if (!notifySpecs?.length) return;
  const text = buildNotificationText(result);

  for (const spec of notifySpecs) {
    try {
      if (spec.type === 'discord') {
        await sendDiscord(spec.url, text);
        console.log(`\x1b[90m  Notified: discord\x1b[0m`);
      } else if (spec.type === 'slack') {
        await sendSlack(spec.url, text);
        console.log(`\x1b[90m  Notified: slack\x1b[0m`);
      } else if (spec.type === 'telegram') {
        await sendTelegram(spec.botToken, spec.chatId, text);
        console.log(`\x1b[90m  Notified: telegram\x1b[0m`);
      } else {
        console.warn(`\x1b[33m  Unknown notify type: ${spec.type}\x1b[0m`);
      }
    } catch (err) {
      console.error(`\x1b[31m  Notification failed (${spec.type}): ${err.message}\x1b[0m`);
    }
  }
}

async function sendDiscord(webhookUrl, text) {
  const content = text.length > 2000 ? text.slice(0, 1997) + '...' : text;
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Nansen Radar', content }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord webhook ${res.status}: ${body.slice(0, 100)}`);
  }
}

async function sendSlack(webhookUrl, text) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Slack webhook ${res.status}: ${body.slice(0, 100)}`);
  }
}

async function sendTelegram(botToken, chatId, text) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API ${res.status}: ${body.slice(0, 100)}`);
  }
}
