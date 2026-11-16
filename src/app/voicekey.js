// Keeps the OpenAI key Falcon's voice needs, on this computer only.
// Windows: encrypted for this Windows user (DPAPI). macOS and Linux: a file only this user can read.
// The key is never written to a command line and never sent to the window.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WINDOWS = process.platform === 'win32';
const DPAPI = `
Add-Type -AssemblyName System.Security
$in = [Console]::In.ReadToEnd().Trim()
if ($args[0] -eq 'protect') {
  [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($in), $null, 'CurrentUser'))
} else {
  [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($in), $null, 'CurrentUser'))
}`;

function dpapi(mode, text) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `& { ${DPAPI} } ${mode}`], { windowsHide: true });
    let out = '';
    ps.stdout.on('data', (chunk) => { out += chunk; });
    ps.on('error', reject);
    ps.on('close', (code) => (code === 0 && out.trim() ? resolve(out.trim()) : reject(new Error('secure store failed'))));
    ps.stdin.end(text);
  });
}

export function createVoiceKeyStore(file = path.join(os.homedir(), '.falcon', 'voice.key')) {
  let cached;
  return {
    async get() {
      if (cached !== undefined) return cached;
      try {
        const stored = fs.readFileSync(file, 'utf8').trim();
        cached = stored ? (WINDOWS ? await dpapi('unprotect', stored) : stored) : null;
      } catch {
        cached = null;
      }
      return cached;
    },
    async set(key) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, WINDOWS ? await dpapi('protect', key) : key, { mode: 0o600 });
      if (!WINDOWS) fs.chmodSync(file, 0o600);
      cached = key;
    },
  };
}
