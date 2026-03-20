import { exec } from 'node:child_process';

const SHELL = process.env.SHELL || 'bash';

function run(args, timeout = 30000) {
  const cmd = `nansen ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`;
  return new Promise((resolve) => {
    exec(cmd, { timeout, maxBuffer: 1024 * 1024 * 5, shell: SHELL }, (err, stdout, stderr) => {
      if (err) {
        resolve({ success: false, error: err.message, raw: (stderr || stdout).slice(0, 500) });
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed);
      } catch {
        resolve({ success: false, error: 'JSON parse failed', raw: (stderr || stdout).slice(0, 500) });
      }
    });
  });
}

export function parseCommandString(cmdStr) {
  const parts = cmdStr.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return parts.map(p => p.replace(/^"|"$/g, ''));
}

export async function executeNansenCommand(commandStr) {
  const args = parseCommandString(commandStr);

  if (args[0] === 'nansen') args.shift();

  const display = `nansen ${args.join(' ')}`;
  const start = Date.now();

  const result = await run(args);
  const elapsed = Date.now() - start;

  return {
    command: display,
    elapsed,
    success: result.success !== false,
    data: result.success !== false ? result : null,
    error: result.success === false ? (result.error || 'Unknown error') : null,
    raw: result.success === false ? (result.raw || null) : null,
  };
}

export async function runHealthCheck() {
  return new Promise((resolve) => {
    exec('nansen help', { timeout: 10000, shell: SHELL }, (err, stdout, stderr) => {
      const raw = (stdout || stderr || '').trim();
      if (err && !raw) {
        resolve({ ok: false, raw });
      } else {
        resolve({ ok: true, raw: raw || 'nansen CLI ready' });
      }
    });
  });
}

export async function executeBatch(commands, quiet = false) {
  const _out = quiet ? () => {} : (s) => process.stdout.write(s);

  _out(`\x1b[90m  Running ${commands.length} queries in parallel...\x1b[0m\n`);

  const settled = await Promise.allSettled(commands.map(cmd => executeNansenCommand(cmd)));

  const results = settled.map((s, i) => {
    const result = s.status === 'fulfilled' ? s.value : {
      command: commands[i],
      elapsed: 0,
      success: false,
      data: null,
      error: s.reason?.message || 'Unknown error',
      raw: null,
    };

    if (result.success) {
      _out(`\x1b[90m  ✓ ${result.command} \x1b[32m(${result.elapsed}ms)\x1b[0m\n`);
    } else {
      _out(`\x1b[90m  ✗ ${result.command} — ${result.error}\x1b[0m\n`);
      if (result.raw) {
        const hint = result.raw.trim().split('\n')[0];
        _out(`\x1b[90m    → ${hint}\x1b[0m\n`);
      }
    }

    return result;
  });

  return results;
}
