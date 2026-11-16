// Talks to the engine Falcon runs on: finds it, runs its commands, reads its local address.
// Works on Windows and macOS.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WINDOWS = process.platform === 'win32';
const ENGINE_HOME = path.join(os.homedir(), '.openclaw');
const SAFE_ARG = /^[\w@:\\/.=,~+\- ]*$/;

/** Port and access token of the local engine, or null when it has never been set up. */
export function readGateway() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(ENGINE_HOME, 'openclaw.json'), 'utf8'));
    return { port: config.gateway?.port || 18789, token: config.gateway?.auth?.token || '' };
  } catch {
    return null;
  }
}

// The window may have started before the engine was installed, so its PATH can be stale:
// besides PATH, look in the places a per-user install normally lands.
function candidateDirs() {
  const dirs = [];
  const home = os.homedir();
  if (WINDOWS) {
    try {
      const found = execFileSync('where.exe', ['openclaw.cmd'], { encoding: 'utf8', windowsHide: true });
      for (const line of found.split(/\r?\n/)) if (line.trim()) dirs.push(path.dirname(line.trim()));
    } catch { /* not on PATH */ }
    dirs.push(
      path.dirname(process.execPath),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'),
      path.join(home, '.local', 'bin'),
      path.join(process.env.APPDATA || '', 'npm'),
      path.join(ENGINE_HOME, 'bin'),
    );
  } else {
    dirs.push(
      ...(process.env.PATH || '').split(':').filter(Boolean),
      path.dirname(process.execPath),
      path.join(ENGINE_HOME, 'bin'),
      path.join(home, '.local', 'bin'),
      path.join(home, '.npm-global', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
    );
  }
  return [...new Set(dirs)];
}

/** How to start the engine's command line, without a shell wherever possible. */
export function findEngine() {
  if (!WINDOWS) {
    for (const dir of candidateDirs()) {
      const file = path.join(dir, 'openclaw');
      if (fs.existsSync(file)) return { command: file, prefix: [], pathDirs: candidateDirs() };
    }
    return null;
  }
  for (const dir of candidateDirs()) {
    const entry = path.join(dir, 'node_modules', 'openclaw', 'dist', 'index.js');
    if (fs.existsSync(entry)) return { command: process.execPath, prefix: [entry] };
  }
  for (const dir of candidateDirs()) {
    if (fs.existsSync(path.join(dir, 'openclaw.cmd'))) {
      return { command: 'cmd.exe', prefix: ['/d', '/s', '/c', path.join(dir, 'openclaw.cmd')], viaShell: true };
    }
  }
  return null;
}

function childEnv(extraDirs = []) {
  const env = { ...process.env, NODE_NO_WARNINGS: '1' };
  if (!WINDOWS) env.PATH = [...new Set([path.dirname(process.execPath), ...extraDirs, ...(env.PATH || '').split(':')])].join(':');
  return env;
}

function collect(child, timeoutMs, input, onLine) {
  return new Promise((resolve) => {
    let out = '';
    let tail = '';
    // Hands each finished line to onLine as it arrives, so the window can show what is happening.
    const take = (chunk) => {
      out += chunk;
      if (!onLine) return;
      const lines = (tail + chunk).split(/\r\n|\r|\n/);
      tail = lines.pop();
      for (const line of lines) { try { onLine(line); } catch { /* a display problem must not stop the work */ } }
    };
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, out: err.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, out }); });
    child.stdin.end(input ?? '');
  });
}

/** Runs one engine command and resolves with its exit code and output. Never rejects. */
export function runEngine(args, { input, timeoutMs = 180000, onLine } = {}) {
  const engine = findEngine();
  if (!engine) return Promise.resolve({ code: -1, out: 'The engine is not installed.' });
  if (engine.viaShell && !args.every((a) => SAFE_ARG.test(a))) {
    return Promise.resolve({ code: -1, out: 'Refused to run a command with unusual characters.' });
  }
  const child = spawn(engine.command, [...engine.prefix, ...args], { windowsHide: true, env: childEnv(engine.pathDirs) });
  return collect(child, timeoutMs, input, onLine);
}

/** Downloads and runs the engine's official installer for this kind of computer. */
export function installEngine({ timeoutMs = 1200000, onLine } = {}) {
  const child = WINDOWS
    ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      '& ([scriptblock]::Create((Invoke-RestMethod https://openclaw.ai/install.ps1))) -NoOnboard'], { windowsHide: true })
    : spawn('/bin/bash', ['-c', 'curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard'], { env: childEnv() });
  return collect(child, timeoutMs, undefined, onLine);
}

/** True when the engine answers on its local chat address. */
export async function engineReady() {
  const gateway = readGateway();
  if (!gateway) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${gateway.port}/v1/models`, {
      headers: { Authorization: `Bearer ${gateway.token}` },
      signal: AbortSignal.timeout(4000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
