// Falcon's local history and his workshop (self-repair plan, stage 2).
//
// The local history is a private Git record of Falcon's own files on this PC, kept in ~/.falcon/history.
// It has no connection to GitHub. Its branches:
//   release   the version as installed
//   personal  release plus this PC's own changes; Falcon runs from it
//   workshop/<id>  one per change in progress
// A workshop is a separate full copy of Falcon in ~/.falcon/workshops/<id>, where a change is made and
// tested while the Falcon in use stays untouched. Only a tested change is switched in, and a watchdog
// that does not depend on the new code puts the last working version back if the new one does not start.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitEnv } from './git.js';
import { removeEngineCopy } from './enginepatch.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Falcon's own files, as his installers copy them. Anything else in his folder is not part of him.
export const TRACKED = ['src', 'ui', 'falcon-agent', 'installer', 'test', 'scripts', 'package.json', 'NOTICE', 'falcon.ico', 'falcon.png'];
const IDENTITY = ['-c', 'user.name=Falcon', '-c', 'user.email=falcon@localhost.invalid', '-c', 'commit.gpgsign=false'];
const SETTINGS = { 'core.autocrlf': 'false', 'core.longpaths': 'true', 'core.fsmonitor': 'false', 'gc.auto': '0' };
export const WORKSHOP_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

export const historyDir = (home = os.homedir()) => path.join(home, '.falcon', 'history');
export const workshopsDir = (home = os.homedir()) => path.join(home, '.falcon', 'workshops');

/** Runs Git and resolves with { code, out }. Never rejects. */
export function runGit(git, args, { cwd, timeoutMs = 120000, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(git, args, { cwd, env: gitEnv(), windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, out: `${stdout || ''}${stderr || ''}` }));
    if (input !== undefined) child.stdin.end(input);
  });
}

function tracked(appRoot) {
  return TRACKED.filter((name) => fs.existsSync(path.join(appRoot, name)));
}

/** The local history of the Falcon in use: Git pointed at Falcon's folder, kept outside it. */
export function openHistory({ git, appRoot, home = os.homedir() }) {
  const dir = historyDir(home);
  const h = (args, options) => runGit(git, ['--git-dir', dir, '--work-tree', appRoot, ...args], { cwd: appRoot, ...options });
  const must = async (args, what, options) => {
    const r = await h(args, options);
    if (r.code !== 0) throw new Error(`${what}: ${r.out.trim().split('\n').slice(-3).join(' ')}`);
    return r.out;
  };
  const head = async (ref = 'personal') => (await must(['rev-parse', '--verify', `${ref}^{commit}`], `reading ${ref}`)).trim();

  /** Makes the history on first use: the files as installed become "release" and "personal". */
  async function init(version = '') {
    if (fs.existsSync(path.join(dir, 'HEAD'))) return false;
    fs.mkdirSync(dir, { recursive: true });
    await must(['init', '--quiet', '--initial-branch=personal'], 'starting the local history');
    for (const [key, value] of Object.entries(SETTINGS)) await must(['config', key, value], 'setting up the local history');
    // A history that names no other place can never be sent anywhere.
    await must(['add', '--all', '--', ...tracked(appRoot)], 'recording Falcon\'s files');
    await must([...IDENTITY, 'commit', '--quiet', '--allow-empty', '-m', `Falcon ${version || ''} as installed`.replace(/\s+/g, ' ').trim()], 'recording Falcon\'s files');
    await must(['branch', 'release'], 'marking the release');
    return true;
  }

  /** Files changed outside the workshop (an update, or by hand) are recorded first, so nothing is lost. */
  async function sync(why = 'Falcon\'s files changed outside the workshop') {
    const status = await must(['status', '--porcelain', '--', ...tracked(appRoot)], 'reading Falcon\'s files');
    if (!status.trim()) return null;
    await must(['add', '--all', '--', ...tracked(appRoot)], 'recording Falcon\'s files');
    await must([...IDENTITY, 'commit', '--quiet', '-m', why], 'recording Falcon\'s files');
    return head();
  }

  return { dir, appRoot, git, run: h, head, init, sync };
}

/** A separate full copy of Falcon on its own branch, made from what is in use now. */
export async function createWorkshop({ history, id, home = os.homedir(), from = 'personal', sync = true }) {
  if (!WORKSHOP_ID.test(id)) throw new Error('A workshop name is lowercase letters, digits and hyphens.');
  if (!['personal', 'release'].includes(from)) throw new Error('A workshop starts from personal or release.');
  if (sync) await history.sync();
  const dir = path.join(workshopsDir(home), id);
  if (fs.existsSync(dir)) throw new Error(`A workshop named ${id} already exists.`);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const clone = await runGit(history.git, ['clone', '--quiet', '--no-hardlinks', '--branch', from, history.dir, dir], { cwd: path.dirname(dir), timeoutMs: 300000 });
  if (clone.code !== 0) throw new Error(`The workshop copy could not be made: ${clone.out.trim()}`);
  const w = (args, options) => runGit(history.git, args, { cwd: dir, ...options });
  for (const [key, value] of Object.entries(SETTINGS)) await w(['config', key, value]);
  await w(['remote', 'remove', 'origin']);       // the workshop names no other place either
  const branch = await w(['checkout', '--quiet', '-b', `workshop/${id}`]);
  if (branch.code !== 0) throw new Error(`The workshop branch could not be made: ${branch.out.trim()}`);
  return { id, dir, base: await history.head(from) };
}

/** Records everything changed in the workshop as one step, with a plain description. */
export async function saveWorkshop({ git, dir, message }) {
  const w = (args) => runGit(git, args, { cwd: dir });
  await w(['add', '--all']);
  const status = await w(['status', '--porcelain']);
  if (!status.out.trim()) return null;
  const done = await w([...IDENTITY, 'commit', '--quiet', '-m', String(message || 'A change made in the workshop').slice(0, 300)]);
  if (done.code !== 0) throw new Error(`The change could not be recorded: ${done.out.trim()}`);
  return (await w(['rev-parse', 'HEAD'])).out.trim();
}

/** Runs Falcon's automatic tests in the workshop. */
export function testWorkshop({ dir, node = process.execPath, timeoutMs = 15 * 60000 }) {
  return new Promise((resolve) => {
    let files = [];
    try { files = fs.readdirSync(path.join(dir, 'test')).filter((f) => f.endsWith('.test.js')).map((f) => path.join(dir, 'test', f)); } catch { /* no tests */ }
    if (!files.length) return resolve({ ok: false, tests: 0, pass: 0, fail: 0, failing: [], error: 'This copy of Falcon has no tests.' });
    // A test run started from inside another one would report to it instead of printing its results.
    const env = { ...process.env, NODE_NO_WARNINGS: '1' };
    delete env.NODE_TEST_CONTEXT;
    execFile(node, ['--test', ...files], { cwd: dir, windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env }, (err, stdout, stderr) => {
      const out = `${stdout || ''}${stderr || ''}`;
      const n = (key) => Number((out.match(new RegExp(`^ℹ ${key} (\\d+)`, 'm')) || [])[1] ?? -1);
      const failing = [...new Set([...out.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]))];
      const result = { tests: n('tests'), pass: n('pass'), fail: n('fail'), failing };
      resolve({ ...result, ok: !err && result.fail === 0 && result.pass > 0 });
    });
  });
}

/** Starts the workshop copy's window server on its own, checks that it answers, and stops it. */
export function checkWorkshopStarts({ dir, node = process.execPath, timeoutMs = 60000 }) {
  const server = path.join(dir, 'src', 'app', 'server.js');
  const probe = `
    const { pathToFileURL } = await import('node:url');
    const { startServer } = await import(pathToFileURL(process.argv[1]).href);
    const s = await startServer({ port: 0, engine: { startCheck: true } });
    const page = await (await fetch('http://127.0.0.1:' + s.port + '/')).text();
    const about = await (await fetch('http://127.0.0.1:' + s.port + '/api/about', { headers: { 'X-Falcon-Token': s.token } })).json();
    console.log(JSON.stringify({ page: page.includes('F A L C O N'), version: about.version }));
    await s.close();
    process.exit(0);`;
  return new Promise((resolve) => {
    execFile(node, ['--input-type=module', '-e', probe, server], { cwd: dir, windowsHide: true, timeout: timeoutMs, env: { ...process.env, NODE_NO_WARNINGS: '1' } }, (err, stdout, stderr) => {
      let seen = null;
      try { seen = JSON.parse(String(stdout).trim().split('\n').pop()); } catch { /* did not answer */ }
      resolve(seen?.page ? { ok: true, version: seen.version } : { ok: false, error: `${stderr || err?.message || 'it did not answer'}`.trim().split('\n').slice(0, 4).join(' ') });
    });
  });
}

/**
 * Switches the Falcon in use to a tested workshop change, and starts a watchdog that does not depend
 * on the new code. The watchdog starts the new Falcon and waits for him to answer; if he does not within
 * `waitMs`, it puts the last working version back and starts that. The caller then closes itself.
 *
 * @returns {Promise<{ok: boolean, job?: string, lastGood?: string, commit?: string, error?: string}>}
 */
export async function switchToWorkshop({ history, id, home = os.homedir(), node = process.execPath, start, windowFile = path.join(home, '.falcon', 'window.json'), waitMs = 60000, oldPid = 0, startEnv = {}, force = false }) {
  if (!WORKSHOP_ID.test(id)) return { ok: false, error: 'Unknown workshop.' };
  const dir = path.join(workshopsDir(home), id);
  const branch = `workshop/${id}`;
  // Bring the workshop's recorded change into the local history.
  const fetched = await history.run(['fetch', '--quiet', dir, `+${branch}:refs/heads/${branch}`]);
  if (fetched.code !== 0) return { ok: false, error: `The workshop change could not be brought over: ${fetched.out.trim()}` };
  await history.sync();
  const lastGood = await history.head('personal');
  const commit = await history.head(branch);
  if (commit === lastGood) return { ok: false, error: 'The workshop has no change to switch to.' };
  // Only a change made on top of the Falcon in use is switched in, never one that would undo other changes.
  // (orce: the owner's changes rebuilt on a new version, which is on top of the release instead; see personal.js.)
  const onTop = force ? { code: 0 } : await history.run(['merge-base', '--is-ancestor', lastGood, commit]);
  if (onTop.code !== 0) return { ok: false, error: 'The workshop was made from an older Falcon. Make the change again in a new workshop.' };

  // The watchdog runs from its own copy, made before any file changes.
  const falconHome = path.join(home, '.falcon');
  fs.mkdirSync(falconHome, { recursive: true });
  const watchdog = path.join(falconHome, 'watchdog.mjs');
  fs.copyFileSync(path.join(here, 'watchdog.mjs'), watchdog);
  const job = path.join(falconHome, 'switch.json');
  const resultFile = path.join(falconHome, 'switch-result.json');
  fs.rmSync(resultFile, { force: true });
  fs.writeFileSync(job, JSON.stringify({
    git: history.git, gitDir: history.dir, appRoot: history.appRoot, lastGood, commit, node,
    start: start || [path.join(history.appRoot, 'src', 'app', 'launch.js')], startEnv, windowFile, waitMs, oldPid, resultFile, since: Date.now(),
  }, null, 2));

  await history.run(['update-ref', 'refs/falcon/last-good', lastGood]);
  await history.run(['update-ref', 'refs/heads/personal', commit, lastGood]);
  const put = await history.run(['reset', '--quiet', '--hard', 'personal']);
  if (put.code !== 0) {
    await history.run(['update-ref', 'refs/heads/personal', lastGood]);
    await history.run(['reset', '--quiet', '--hard', 'personal']);
    return { ok: false, error: `The new files could not be put in place, so nothing was changed: ${put.out.trim()}` };
  }
  const child = spawn(node, [watchdog, job], { detached: true, stdio: 'ignore', windowsHide: true, cwd: falconHome });
  child.unref();
  return { ok: true, job, resultFile, lastGood, commit };
}

/** Removes a workshop copy. Its recorded change stays in the local history if it was brought over. */
export function removeWorkshop({ id, home = os.homedir() }) {
  if (!WORKSHOP_ID.test(id)) return false;
  // An engine copy links to the real engine's libraries: take the link away on its own first.
  if (!removeEngineCopy(path.join(workshopsDir(home), id))) return false;
  fs.rmSync(path.join(workshopsDir(home), id), { recursive: true, force: true, maxRetries: 5 });
  return true;
}
