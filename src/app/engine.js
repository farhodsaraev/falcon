// Talks to the engine Falcon runs on: finds it, runs its commands, reads its local address.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

function candidateDirs() {
  const dirs = [];
  try {
    const found = execFileSync('where.exe', ['openclaw.cmd'], { encoding: 'utf8', windowsHide: true });
    for (const line of found.split(/\r?\n/)) if (line.trim()) dirs.push(path.dirname(line.trim()));
  } catch { /* not on PATH */ }
  dirs.push(
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'),
    path.join(process.env.APPDATA || '', 'npm'),
    path.join(ENGINE_HOME, 'bin'),
  );
  return dirs;
}

/** How to start the engine's command line: directly through Node when possible (no shell involved). */
export function findEngine() {
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

/** Runs one engine command and resolves with its exit code and output. Never rejects. */
export function runEngine(args, { input, timeoutMs = 180000 } = {}) {
  return new Promise((resolve) => {
    const engine = findEngine();
    if (!engine) return resolve({ code: -1, out: 'The engine is not installed.' });
    if (engine.viaShell && !args.every((a) => SAFE_ARG.test(a))) {
      return resolve({ code: -1, out: 'Refused to run a command with unusual characters.' });
    }
    const child = spawn(engine.command, [...engine.prefix, ...args], {
      windowsHide: true,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    let out = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, out: err.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, out }); });
    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
  });
}

/** Runs a PowerShell script file (used for the engine installer and the Falcon pack). */
export function runPowerShell(args, { timeoutMs = 900000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args],
      { windowsHide: true });
    let out = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, out: err.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, out }); });
  });
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
