import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ps');

/**
 * Runs one of our PowerShell scripts and returns its JSON result.
 * Arguments are passed as separate values, never glued into a command string.
 */
export function runPs(script, args = {}, { timeoutMs = 30000 } = {}) {
  const argv = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(PS_DIR, script)];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || value === '') continue;
    argv.push(`-${key}`, String(value));
  }
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', argv, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      const line = stdout.trim().split(/\r?\n/).pop() || '';
      let result;
      try { result = JSON.parse(line); } catch {
        return reject(new Error(err?.message || stderr.trim() || `Unexpected output from ${script}`));
      }
      if (!result.ok) return reject(new Error(result.error || `${script} failed`));
      resolve(result);
    });
  });
}
