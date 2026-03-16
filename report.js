export function generateReport(investigation) {
  const { query, analysis, results, totalCalls, timestamp, plan } = investigation;
  const findings = analysis.findings || [];
  const recommendations = analysis.recommendations || [];

  const riskScore = analysis.riskScore ?? 0;
  const riskColor = riskScore >= 70 ? '#00d68f' : riskScore >= 40 ? '#ffb347' : '#ff4757';
  const riskGlow  = riskScore >= 70 ? 'rgba(0,214,143,0.18)' : riskScore >= 40 ? 'rgba(255,179,71,0.18)' : 'rgba(255,71,87,0.18)';

  const severityMeta = {
    positive: { color: '#00d68f', glow: 'rgba(0,214,143,0.12)', icon: '↑', label: 'Positive' },
    neutral:  { color: '#8b8da3', glow: 'rgba(139,141,163,0.10)', icon: '–', label: 'Neutral'  },
    warning:  { color: '#ffb347', glow: 'rgba(255,179,71,0.12)', icon: '⚠', label: 'Warning'  },
    danger:   { color: '#ff4757', glow: 'rgba(255,71,87,0.12)',  icon: '↓', label: 'Critical'  },
  };

  const findingsHtml = findings.map(f => {
    const meta = severityMeta[f.severity] || severityMeta.neutral;
    const chips = (f.dataPoints || []).map(d =>
      `<span class="chip">${escHtml(d)}</span>`).join('');
    return `
  <div class="finding" style="--sev-color:${meta.color};--sev-glow:${meta.glow}">
    <div class="finding-top">
      <span class="sev-pill" style="color:${meta.color};background:${meta.glow};border-color:${meta.color}33">
        <span class="sev-icon">${meta.icon}</span>${meta.label}
      </span>
      <span class="finding-cat">${escHtml(f.category)}</span>
    </div>
    <h3 class="finding-title">${escHtml(f.title)}</h3>
    <p class="finding-detail">${escHtml(f.detail)}</p>
    ${chips ? `<div class="chips">${chips}</div>` : ''}
  </div>`;
  }).join('');

  const recsHtml = recommendations.map((r, i) => `
  <div class="rec">
    <span class="rec-num">${String(i + 1).padStart(2, '0')}</span>
    <span class="rec-text">${escHtml(r)}</span>
  </div>`).join('');

  const scoreArc = buildScoreArc(riskScore, riskColor);
  const dateStr  = timestamp ? timestamp.split('T')[0] : '';
  const successCount = results.filter(r => r.success).length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Nansen Radar — ${escHtml(query.slice(0, 60))}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

*{margin:0;padding:0;box-sizing:border-box}

:root{
  --bg:       #07080d;
  --surface:  #0e0f18;
  --surface2: #13141f;
  --border:   #1c1e2e;
  --border2:  #252740;
  --text:     #e2e4f0;
  --muted:    #8b8da3;
  --dim:      #44465a;
  --accent:   #6366f1;
  --accent-bg:rgba(99,102,241,0.10);
}

body{
  font-family:'Inter',sans-serif;
  background:var(--bg);
  color:var(--text);
  min-height:100vh;
  line-height:1.6;
}

/* scanline texture */
body::before{
  content:'';
  position:fixed;inset:0;
  background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,255,255,0.012) 2px,rgba(255,255,255,0.012) 4px);
  pointer-events:none;z-index:0;
}

.wrap{
  position:relative;z-index:1;
  max-width:860px;margin:0 auto;padding:40px 24px 64px;
}

/* ── TOP BAR ─────────────────────────────────── */
.topbar{
  display:flex;align-items:center;justify-content:space-between;
  margin-bottom:36px;
}
.brand{display:flex;align-items:center;gap:10px}
.brand-mark{
  width:34px;height:34px;border-radius:8px;
  background:var(--accent);
  display:flex;align-items:center;justify-content:center;
  font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:500;color:#fff;
  letter-spacing:0.04em;
}
.brand-name{
  font-size:13px;font-weight:600;letter-spacing:0.14em;
  text-transform:uppercase;color:var(--muted);
}
.topbar-date{
  font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--dim);
}

/* ── QUERY ───────────────────────────────────── */
.query-card{
  background:var(--surface);
  border:1px solid var(--border);
  border-left:3px solid var(--accent);
  border-radius:10px;
  padding:20px 24px;
  margin-bottom:28px;
}
.query-label{
  font-size:10px;font-weight:600;letter-spacing:0.12em;
  text-transform:uppercase;color:var(--dim);margin-bottom:8px;
}
.query-text{font-size:19px;font-weight:500;line-height:1.45;color:var(--text)}

/* ── RISK HERO ───────────────────────────────── */
.hero{
  display:grid;grid-template-columns:200px 1fr;gap:0;
  background:var(--surface);border:1px solid var(--border);
  border-radius:14px;overflow:hidden;margin-bottom:28px;
  box-shadow:0 0 60px ${riskGlow};
}
.hero-gauge{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:32px 20px;
  border-right:1px solid var(--border);
  background:linear-gradient(135deg,var(--surface) 0%,var(--surface2) 100%);
}
.hero-stats{
  padding:28px 32px;
  display:flex;flex-direction:column;justify-content:center;gap:18px;
}
.risk-badge{
  display:inline-flex;align-items:center;gap:6px;
  padding:5px 14px;border-radius:100px;
  font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;
  background:${riskGlow};color:${riskColor};border:1px solid ${riskColor}44;
  width:fit-content;
}
.stat-row{display:flex;flex-direction:column;gap:2px}
.stat-label{font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--dim)}
.stat-value{font-size:14px;font-weight:500;color:var(--muted);line-height:1.4}

/* ── SUMMARY ─────────────────────────────────── */
.summary-card{
  background:var(--surface);
  border:1px solid var(--border);
  border-left:3px solid ${riskColor};
  border-radius:10px;padding:20px 24px;
  margin-bottom:36px;
}
.summary-text{font-size:15px;color:var(--muted);line-height:1.7}

/* ── SECTION HEADER ──────────────────────────── */
.section-hd{
  display:flex;align-items:center;gap:12px;
  margin-bottom:16px;
}
.section-hd-title{
  font-size:11px;font-weight:700;letter-spacing:0.12em;
  text-transform:uppercase;color:var(--dim);
}
.section-hd::after{content:'';flex:1;height:1px;background:var(--border)}

/* ── FINDINGS ────────────────────────────────── */
.findings{display:flex;flex-direction:column;gap:12px;margin-bottom:36px}

.finding{
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:12px;padding:20px 22px;
  transition:border-color .2s,box-shadow .2s;
}
.finding:hover{
  border-color:var(--sev-color);
  box-shadow:0 0 24px var(--sev-glow);
}
.finding-top{
  display:flex;align-items:center;justify-content:space-between;
  margin-bottom:10px;
}
.sev-pill{
  display:inline-flex;align-items:center;gap:5px;
  padding:3px 12px;border-radius:100px;
  font-size:11px;font-weight:600;letter-spacing:0.06em;
  border:1px solid transparent;
}
.sev-icon{font-size:12px}
.finding-cat{
  font-family:'JetBrains Mono',monospace;
  font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:0.1em;
}
.finding-title{font-size:16px;font-weight:600;margin-bottom:6px;color:var(--text)}
.finding-detail{font-size:13px;color:var(--muted);line-height:1.6}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.chip{
  font-family:'JetBrains Mono',monospace;font-size:11px;
  background:var(--bg);border:1px solid var(--border2);
  border-radius:5px;padding:3px 9px;color:var(--dim);
}

/* ── RECOMMENDATIONS ─────────────────────────── */
.recs{margin-bottom:48px}
.rec{
  display:flex;gap:16px;align-items:flex-start;
  padding:13px 0;border-bottom:1px solid var(--border);
}
.rec:last-child{border-bottom:none}
.rec-num{
  font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:500;
  color:var(--accent);min-width:28px;padding-top:1px;
}
.rec-text{font-size:14px;color:var(--muted);line-height:1.6}

/* ── FOOTER ──────────────────────────────────── */
.footer{
  text-align:center;padding-top:24px;border-top:1px solid var(--border);
  font-size:12px;color:var(--dim);
}
.footer a{color:var(--accent);text-decoration:none}
.footer a:hover{text-decoration:underline}

/* ── RESPONSIVE ──────────────────────────────── */
@media(max-width:600px){
  .hero{grid-template-columns:1fr}
  .hero-gauge{border-right:none;border-bottom:1px solid var(--border)}
  .wrap{padding:24px 16px 48px}
}
</style>
</head>
<body>
<div class="wrap">

  <div class="topbar">
    <div class="brand">
      <div class="brand-mark">NR</div>
      <div class="brand-name">Nansen Radar</div>
    </div>
    <div class="topbar-date">${escHtml(dateStr)}</div>
  </div>

  <div class="query-card">
    <div class="query-label">Investigation Query</div>
    <div class="query-text">${escHtml(query)}</div>
  </div>

  <div class="hero">
    <div class="hero-gauge">
      ${scoreArc}
    </div>
    <div class="hero-stats">
      <div class="risk-badge">${escHtml(analysis.riskLabel || 'UNKNOWN')}</div>
      <div class="stat-row">
        <span class="stat-label">API Queries</span>
        <span class="stat-value">${totalCalls} executed · ${successCount} succeeded</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Signals Found</span>
        <span class="stat-value">${findings.length} findings · ${recommendations.length} actions</span>
      </div>
      ${plan?.intent ? `<div class="stat-row">
        <span class="stat-label">Intent</span>
        <span class="stat-value">${escHtml(plan.intent)}</span>
      </div>` : ''}
    </div>
  </div>

  ${analysis.summary ? `
  <div class="summary-card">
    <p class="summary-text">${escHtml(analysis.summary)}</p>
  </div>` : ''}

  ${findings.length ? `
  <div class="section-hd"><span class="section-hd-title">Intelligence Signals</span></div>
  <div class="findings">${findingsHtml}</div>` : ''}

  ${recommendations.length ? `
  <div class="section-hd"><span class="section-hd-title">Action Items</span></div>
  <div class="recs">${recsHtml}</div>` : ''}

  <div class="footer">
    Powered by <a href="https://github.com/nansen-ai/nansen-cli" target="_blank">Nansen CLI</a>
    &nbsp;·&nbsp;
    Built for <a href="https://x.com/nansen_ai" target="_blank">#NansenCLI</a> Challenge
  </div>

</div>
</body>
</html>`;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildScoreArc(score, color) {
  const size = 160;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="#1c1e2e" stroke-width="${stroke}"/>
  <circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="${color}" stroke-width="${stroke}"
    stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
    stroke-linecap="round" transform="rotate(-90 ${size/2} ${size/2})"
    style="transition:stroke-dashoffset 1.2s cubic-bezier(.4,0,.2,1)"/>
  <text x="${size/2}" y="${size/2 - 4}" text-anchor="middle"
    font-family="Inter,sans-serif" font-size="40" font-weight="700" fill="${color}">${score}</text>
  <text x="${size/2}" y="${size/2 + 20}" text-anchor="middle"
    font-family="Inter,sans-serif" font-size="11" fill="#44465a" letter-spacing="0.12em">RISK SCORE</text>
</svg>`;
}
