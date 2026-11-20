// Small personal patches to the engine's own files (self-repair plan, stage 6 and section 6, method 4).
//
// Settings, skills and add-ons come first; a patch is the last resort, for a small change that only the
// engine's own files can make. A patch is a file in falcon-agent/engine-patches/<name>.patch, inside
// Falcon, so it is made in a workshop copy, judged by the tests and the reviewer, approved by the owner,
// and kept as one of his changes through Falcon's updates (stage 4).
//
// An engine update replaces the engine's files, so the patches are put back at each start of Falcon and
// after each engine update. Whether a patch is in place is read from the files themselves (Git can tell
// if a patch is applied, can be applied, or no longer fits), so nothing is lost when the engine is
// reinstalled behind Falcon's back. A copy of each applied patch is kept in ~/.falcon/engine-patches, so
// one the owner switches off can be taken out again.
//
// To make one, the writer asks for a second copy of the engine inside the workshop (.engine-copy): its
// own program files, the libraries shared with the real engine through a link. The writer changes the
// copy; Falcon turns the difference into the patch and starts the copy beside the real engine, with its
// own settings and port, to make sure it still answers.
import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const PATCHES_DIR = path.join('falcon-agent', 'engine-patches');
export const COPY_DIR = '.engine-copy';
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
// Parts of the engine package that are not needed to run it, or are shared instead of copied.
const NOT_COPIED = new Set(['node_modules', 'docs', '.git']);

function runGit(git, args, { cwd, input } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
    for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name];
    // Git must not take a folder above for a repository: in one, "apply" would read the paths from its top.
    if (cwd) env.GIT_CEILING_DIRECTORIES = path.dirname(path.resolve(cwd));
    const child = execFile(git, args, { cwd, env, windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout || ''), err: String(stderr || '') });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

/** The patches in a copy of Falcon: [{ name, file }]. */
export function listPatches(appRoot) {
  const dir = path.join(appRoot, PATCHES_DIR);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.patch')); } catch { return []; }
  return files.map((f) => ({ name: f.slice(0, -'.patch'.length), file: path.join(dir, f) })).filter((p) => NAME.test(p.name)).sort((a, b) => a.name.localeCompare(b.name));
}

// Git applies a patch in a folder that is not a repository when the folder has none above it either;
// --unidiff-zero is never used, so every hunk is checked against its context.
const applyArgs = (file, ...more) => ['apply', '--whitespace=nowarn', ...more, file];

/** 'applied', 'fits', or 'no-fit' for one patch against the engine's files. */
export async function patchState({ git, engineDir, file }) {
  if ((await runGit(git, applyArgs(file, '--reverse', '--check'), { cwd: engineDir })).code === 0) return 'applied';
  if ((await runGit(git, applyArgs(file, '--check'), { cwd: engineDir })).code === 0) return 'fits';
  return 'no-fit';
}

function readState(home) {
  try { return JSON.parse(fs.readFileSync(path.join(home, '.falcon', 'engine-patches', 'state.json'), 'utf8')); } catch { return { applied: {}, told: {} }; }
}
function writeState(home, state) {
  const dir = path.join(home, '.falcon', 'engine-patches');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
}
const hashOf = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

/**
 * Makes the engine's files match the patches Falcon has now: takes out the ones he no longer has (or that
 * changed), and puts in the ones that are missing. Returns { changed, applied, failed: [{ name, error }],
 * newlyFailed } — "changed" is true when engine files were written, so the engine must start again.
 */
export async function syncPatches({ git, appRoot, engineDir, home = os.homedir(), engineVersion = '' }) {
  const result = { changed: false, applied: [], failed: [], newlyFailed: [] };
  if (!git || !engineDir || !fs.existsSync(engineDir)) return result;
  const state = readState(home);
  state.applied ||= {};
  state.told ||= {};
  const wanted = new Map(listPatches(appRoot).map((p) => [p.name, { ...p, hash: hashOf(fs.readFileSync(p.file, 'utf8')) }]));
  if (!wanted.size && !Object.keys(state.applied).length) return result;      // the usual case: nothing to do
  const keptDir = path.join(home, '.falcon', 'engine-patches', 'applied');
  fs.mkdirSync(keptDir, { recursive: true });

  // 1. Take out the patches that were switched off, removed, or changed since they were applied.
  for (const [name, hash] of Object.entries(state.applied)) {
    if (wanted.get(name)?.hash === hash) continue;
    const kept = path.join(keptDir, `${name}.patch`);
    if (fs.existsSync(kept) && (await patchState({ git, engineDir, file: kept })) === 'applied') {
      if ((await runGit(git, applyArgs(kept, '--reverse'), { cwd: engineDir })).code === 0) result.changed = true;
    }
    delete state.applied[name];
    fs.rmSync(kept, { force: true });
  }
  // 2. Put in the patches that are missing (after an engine update all of them are).
  for (const p of wanted.values()) {
    const now = await patchState({ git, engineDir, file: p.file });
    if (now === 'fits') {
      const r = await runGit(git, applyArgs(p.file), { cwd: engineDir });
      if (r.code !== 0) { result.failed.push({ name: p.name, error: r.err.trim().split('\n')[0] || 'it could not be applied' }); continue; }
      result.changed = true;
    } else if (now === 'no-fit') {
      result.failed.push({ name: p.name, error: 'it does not fit this version of the engine' });
      const key = `${p.name}@${engineVersion}`;
      if (!state.told[key]) { state.told[key] = true; result.newlyFailed.push(p.name); }
      delete state.applied[p.name];
      continue;
    }
    fs.copyFileSync(p.file, path.join(keptDir, `${p.name}.patch`));
    state.applied[p.name] = p.hash;
    result.applied.push(p.name);
  }
  writeState(home, state);
  return result;
}

const MANIFEST = '.falcon-copy.json';

async function copyEngineFiles(from, to) {
  fs.mkdirSync(to, { recursive: true });
  if (process.platform === 'win32') {
    // Robocopy copies the 17,000 small files about twice as fast as Node. Codes below 8 mean success.
    const code = await new Promise((resolve) => execFile('robocopy', [from, to, '/E', '/MT:16', '/XD', ...[...NOT_COPIED].map((n) => path.join(from, n)), '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { windowsHide: true, timeout: 10 * 60000 }, (err) => resolve(err ? (typeof err.code === 'number' ? err.code : 16) : 0)));
    if (code < 8) return;
  }
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (NOT_COPIED.has(entry.name)) continue;
    fs.cpSync(path.join(from, entry.name), path.join(to, entry.name), { recursive: true, dereference: false, preserveTimestamps: true });
  }
}

// Every file of a copy, with its size and time: [relative path with /] -> "size:mtime".
function filesOf(root) {
  const out = {};
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!rel && (NOT_COPIED.has(entry.name) || entry.name === MANIFEST)) continue;
      const full = path.join(dir, entry.name);
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, r);
      else if (entry.isFile()) { const s = fs.statSync(full); out[r] = `${s.size}:${Math.round(s.mtimeMs)}`; }
    }
  };
  walk(root, '');
  return out;
}

/**
 * A second copy of the engine in a workshop: its own program files, the libraries shared with the real
 * engine through a link. A list of its files, as copied, shows later which ones the writer changed.
 */
export async function makeEngineCopy({ engineDir, dir }) {
  const copy = path.join(dir, COPY_DIR);
  if (fs.existsSync(path.join(copy, MANIFEST))) return { ok: true, copy, existed: true };
  try {
    fs.rmSync(copy, { recursive: true, force: true });
    await copyEngineFiles(engineDir, copy);
    const libs = path.join(engineDir, 'node_modules');
    if (fs.existsSync(libs)) fs.symlinkSync(libs, path.join(copy, 'node_modules'), 'junction');
    fs.writeFileSync(path.join(copy, MANIFEST), JSON.stringify({ engineDir, files: filesOf(copy) }));
  } catch (err) {
    return { ok: false, error: `The engine could not be copied: ${err.message}` };
  }
  // The workshop's own Git must not see the copy.
  try { fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), `\n/${COPY_DIR}/\n`); } catch { /* not a clone */ }
  return { ok: true, copy };
}

/** Removes a workshop's engine copy. The link to the real engine's libraries is taken away first, on its own. */
export function removeEngineCopy(dir) {
  const copy = path.join(dir, COPY_DIR);
  const libs = path.join(copy, 'node_modules');
  try { if (fs.lstatSync(libs).isSymbolicLink()) fs.unlinkSync(libs); } catch { /* no link */ }
  try { if (fs.existsSync(libs) && !fs.lstatSync(libs).isSymbolicLink()) fs.rmdirSync(libs); } catch { /* a junction Node does not see as a link */ }
  if (fs.existsSync(libs)) return false;          // never delete through to the real engine
  fs.rmSync(copy, { recursive: true, force: true, maxRetries: 5 });
  return true;
}

/** The files the writer changed, added or removed in the engine copy: [relative path with /]. */
export function changedInCopy(dir) {
  const copy = path.join(dir, COPY_DIR);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(copy, MANIFEST), 'utf8')); } catch { return []; }
  const now = filesOf(copy);
  const names = new Set([...Object.keys(manifest.files), ...Object.keys(now)]);
  return [...names].filter((n) => manifest.files[n] !== now[n]).sort();
}

/**
 * The writer's change to the engine copy, as a patch against the engine's package folder ('' when none).
 * Only the changed files go into a small temporary repository, so the patch is made in a moment.
 */
export async function patchFromCopy({ git, dir, home = os.homedir() }) {
  const copy = path.join(dir, COPY_DIR);
  const changed = changedInCopy(dir);
  if (!changed.length) return '';
  const { engineDir } = JSON.parse(fs.readFileSync(path.join(copy, MANIFEST), 'utf8'));
  const repo = fs.mkdtempSync(path.join(home, '.falcon', 'patch-'));
  try {
    const put = (from, rel) => {
      const to = path.join(repo, ...rel.split('/'));
      fs.rmSync(to, { force: true });
      if (fs.existsSync(from)) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
    };
    const who = ['-c', 'user.name=Falcon', '-c', 'user.email=falcon@localhost', '-c', 'core.autocrlf=false'];
    await runGit(git, ['init', '-q'], { cwd: repo });
    for (const rel of changed) put(path.join(engineDir, ...rel.split('/')), rel);
    await runGit(git, [...who, 'add', '-A'], { cwd: repo });
    await runGit(git, [...who, 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'engine'], { cwd: repo });
    for (const rel of changed) put(path.join(copy, ...rel.split('/')), rel);
    await runGit(git, [...who, 'add', '-A'], { cwd: repo });
    const r = await runGit(git, [...who, 'diff', '--cached', '--no-color', '--no-ext-diff', '--binary', '--no-renames'], { cwd: repo });
    return r.code === 0 ? r.out : '';
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

/** Lines changed by a patch: small ones only are permitted (plan section 6). */
export function patchSize(text) {
  return String(text).split('\n').filter((l) => /^[+-](?![+-]{2} )/.test(l)).length;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

/**
 * Starts the engine copy beside the real engine, with its own empty settings and its own port, and waits
 * until it answers; then stops it. { ok, ms, error }.
 */
export async function checkEngineCopyStarts({ copy, node = process.execPath, home = os.homedir(), timeoutMs = 180000 }) {
  const stateDir = path.join(home, '.falcon', 'engine-copy-check');
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.mkdirSync(stateDir, { recursive: true });
  const port = await freePort();
  const token = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(path.join(stateDir, 'openclaw.json'), JSON.stringify({
    gateway: { mode: 'local', port, bind: 'loopback', auth: { mode: 'token', token }, http: { endpoints: { chatCompletions: { enabled: true } } } },
  }, null, 2));
  const env = { ...process.env, OPENCLAW_STATE_DIR: stateDir, NODE_NO_WARNINGS: '1' };
  for (const name of ['OPENCLAW_CONFIG_PATH', 'OPENCLAW_PROFILE', 'OPENCLAW_HOME', 'OPENCLAW_WINDOWS_TASK_NAME', 'OPENCLAW_GATEWAY_PORT', 'OPENCLAW_GATEWAY_TOKEN', 'NODE_TEST_CONTEXT']) delete env[name];
  const started = Date.now();
  const child = spawn(node, [path.join(copy, 'dist', 'index.js'), 'gateway', 'run', '--port', String(port), '--auth', 'token', '--token', token, '--bind', 'loopback'], { cwd: stateDir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const keep = (b) => { log = (log + b).slice(-4000); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  let exited = false;
  child.on('exit', () => { exited = true; });
  try {
    while (Date.now() - started < timeoutMs && !exited) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) });
        if (r.ok) return { ok: true, ms: Date.now() - started };
      } catch { /* not yet */ }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const last = log.trim().split('\n').filter((l) => /error|fail|cannot|throw/i.test(l)).slice(-2).join(' ') || log.trim().split('\n').slice(-2).join(' ');
    return { ok: false, ms: Date.now() - started, error: (exited ? 'The engine copy stopped: ' : 'The engine copy did not answer: ') + last.slice(0, 400) };
  } finally {
    if (!exited) {
      if (process.platform === 'win32') await new Promise((resolve) => execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => resolve()));
      else child.kill('SIGTERM');
    }
  }
}
