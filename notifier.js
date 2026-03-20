const SEV_ORDER = { danger: 0, warning: 1, neutral: 2, positive: 3 };

// Risk score → Discord embed color (hex int)
function riskColor(score) {
  if (score >= 80) return 0x57f287; // green
  if (score >= 60) return 0xfee75c; // yellow
  if (score >= 40) return 0xed4245; // red
  return 0x9b59b6;                  // purple = critical
}

function sortedFindings(findings) {
  return [...(findings || [])].sort(
    (a, b) => (SEV_ORDER[a.severity] ?? 4) - (SEV_ORDER[b.severity] ?? 4)
  );
}

// ── Plain text (WhatsApp, Slack, Telegram fallback) ───────────────────────────

export function buildNotificationText(result) {
  const { query, analysis, totalCalls, timestamp } = result;
  const findings = sortedFindings(analysis?.findings);
  const recommendations = analysis?.recommendations || [];
  const riskScore = analysis?.riskScore ?? '?';
  const riskLabel = analysis?.riskLabel || 'UNKNOWN';
  const summary = analysis?.summary || '';

  const topFinding = findings[0];

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

// ── Discord rich embed ────────────────────────────────────────────────────────

function buildDiscordEmbed(result) {
  const { query, analysis, totalCalls, timestamp } = result;
  const findings = sortedFindings(analysis?.findings);
  const riskScore = analysis?.riskScore ?? 0;
  const riskLabel = analysis?.riskLabel || 'UNKNOWN';
  const summary = analysis?.summary || '';
  const title = analysis?.title || 'Nansen Investigation Report';

  const fields = [
    { name: 'Risk Score', value: `**${riskScore}/100 — ${riskLabel}**`, inline: true },
    { name: 'Queries Run', value: String(totalCalls || 0), inline: true },
  ];

  for (const f of findings.slice(0, 3)) {
    const sevIcon = f.severity === 'danger' ? '🔴' : f.severity === 'warning' ? '🟡' : f.severity === 'positive' ? '🟢' : '⚪';
    const val = f.detail ? `${sevIcon} ${f.detail.slice(0, 200)}` : `${sevIcon} ${f.title}`;
    fields.push({ name: f.title || 'Finding', value: val, inline: false });
  }

  const recs = (analysis?.recommendations || []).slice(0, 2);
  if (recs.length) {
    fields.push({
      name: 'Recommendations',
      value: recs.map((r, i) => `${i + 1}. ${r}`).join('\n'),
      inline: false,
    });
  }

  const dateStr = timestamp ? timestamp.replace('T', ' ').slice(0, 19) + ' UTC' : '';

  return {
    username: 'Nansen Radar',
    embeds: [{
      title: `NANSEN RADAR — ${title.slice(0, 50)}`,
      description: summary.slice(0, 400) || `Query: ${query.slice(0, 300)}`,
      color: riskColor(riskScore),
      fields,
      footer: { text: `${dateStr}` },
    }],
  };
}

// ── Telegram MarkdownV2 ───────────────────────────────────────────────────────

function escTg(str) {
  // Telegram MarkdownV2 requires escaping these chars
  return String(str).replace(/[_*[\]()~`>#+=|{}.!-]/g, c => '\\' + c);
}

function buildTelegramMarkdown(result) {
  const { query, analysis, totalCalls, timestamp } = result;
  const findings = sortedFindings(analysis?.findings);
  const riskScore = analysis?.riskScore ?? '?';
  const riskLabel = analysis?.riskLabel || 'UNKNOWN';
  const summary = analysis?.summary || '';

  const scoreEmoji = riskScore >= 80 ? '🟢' : riskScore >= 60 ? '🟡' : riskScore >= 40 ? '🔴' : '🟣';

  const lines = [
    `*NANSEN RADAR ALERT* ${scoreEmoji}`,
    '',
    `*Risk:* ${escTg(`${riskScore}/100 — ${riskLabel}`)}`,
    `*Query:* ${escTg(query.slice(0, 200))}`,
    '',
    escTg(summary.slice(0, 500)),
  ];

  if (findings.length) {
    lines.push('', '*Findings:*');
    for (const f of findings.slice(0, 3)) {
      const icon = f.severity === 'danger' ? '🔴' : f.severity === 'warning' ? '🟡' : f.severity === 'positive' ? '🟢' : '⚪';
      lines.push(`${icon} ${escTg(f.title)}`);
      if (f.detail) lines.push(`  _${escTg(f.detail.slice(0, 150))}_`);
    }
  }

  const recs = (analysis?.recommendations || []).slice(0, 2);
  if (recs.length) {
    lines.push('', '*Recommendations:*');
    recs.forEach((r, i) => lines.push(`${i + 1}\\. ${escTg(r)}`));
  }

  const dateStr = timestamp ? timestamp.replace('T', ' ').slice(0, 19) + ' UTC' : '';
  lines.push('', `_${escTg(dateStr)} \\| ${escTg(totalCalls || 0)} queries_`);

  return lines.join('\n');
}

// ── Channel senders ───────────────────────────────────────────────────────────

async function sendDiscord(webhookUrl, result) {
  const embed = buildDiscordEmbed(result);
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(embed),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord webhook ${res.status}: ${body.slice(0, 100)}`);
  }
}

async function sendSlack(webhookUrl, result) {
  const text = buildNotificationText(result);
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

async function sendTelegram(botToken, chatId, result) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  let text, parse_mode;
  try {
    text = buildTelegramMarkdown(result);
    parse_mode = 'MarkdownV2';
  } catch {
    text = buildNotificationText(result);
    parse_mode = undefined;
  }

  const body = { chat_id: chatId, text };
  if (parse_mode) body.parse_mode = parse_mode;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // Retry without markdown if parse failed
    if (parse_mode) {
      const plain = buildNotificationText(result);
      const retry = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: plain }),
      });
      if (!retry.ok) {
        const b = await retry.text();
        throw new Error(`Telegram API ${retry.status}: ${b.slice(0, 100)}`);
      }
      return;
    }
    const errBody = await res.text();
    throw new Error(`Telegram API ${res.status}: ${errBody.slice(0, 100)}`);
  }
}

async function sendViaOpenClaw(platform, to, result) {
  const base = process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789';
  const text = buildNotificationText(result);
  const res = await fetch(`${base}/${platform}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenClaw ${platform} ${res.status}: ${body.slice(0, 100)}`);
  }
}

async function sendWhatsApp(phoneNumber, result, openclawBaseUrl) {
  const base = openclawBaseUrl || process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789';
  const text = buildNotificationText(result);
  const res = await fetch(`${base}/whatsapp/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: phoneNumber, text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenClaw WhatsApp ${res.status}: ${body.slice(0, 100)}`);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function sendNotifications(notifySpecs, result) {
  if (!notifySpecs?.length) return;

  for (const spec of notifySpecs) {
    try {
      if (spec.type === 'discord') {
        await sendDiscord(spec.url, result);
        console.log(`\x1b[90m  Notified: discord\x1b[0m`);
      } else if (spec.type === 'slack') {
        await sendSlack(spec.url, result);
        console.log(`\x1b[90m  Notified: slack\x1b[0m`);
      } else if (spec.type === 'telegram') {
        await sendTelegram(spec.botToken, spec.chatId, result);
        console.log(`\x1b[90m  Notified: telegram\x1b[0m`);
      } else if (spec.type === 'whatsapp') {
        await sendWhatsApp(spec.phone, result, spec.openclawBaseUrl);
        console.log(`\x1b[90m  Notified: whatsapp\x1b[0m`);
      } else if (spec.type === 'openclaw') {
        await sendViaOpenClaw(spec.platform, spec.to, result);
        console.log(`\x1b[90m  Notified: openclaw/${spec.platform} → ${spec.to}\x1b[0m`);
      } else {
        console.warn(`\x1b[33m  Unknown notify type: ${spec.type}\x1b[0m`);
      }
    } catch (err) {
      console.error(`\x1b[31m  Notification failed (${spec.type}): ${err.message}\x1b[0m`);
    }
  }
}
