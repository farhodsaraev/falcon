// Personal changes: the repairs approved on this PC, kept so that updates do not lose them
// (self-repair plan, stage 4).
//
// Each approved repair is kept as one item: a plain title (the owner's request), the date, whether it is
// on, and the change itself as a patch in ~/.falcon/personal. Falcon runs from "personal": the installed
// version ("release") with the changes that are on put back on top.
//
// When a new version arrives (the Update button, or a reinstall), it becomes the new release, and the
// changes are put back on top of it in a workshop copy, one by one. A change that no longer fits is
// switched off. The tests must pass and the copy must start, or all changes are switched off for this
// version. Only then is the result switched in, with the watchdog's way back. The owner is told in plain
// words what did not fit, and can ask Falcon to adapt it (a repair, which he agrees to and pays for).
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitEnv } from './git.js';
import { checkWorkshopStarts, createWorkshop, removeWorkshop, runGit, testWorkshop, TRACKED } from './workshop.js';

const IDENTITY = ['-c', 'user.name=Falcon', '-c', 'user.email=falcon@localhost.invalid', '-c', 'commit.gpgsign=false'];
export const personalDir = (home = os.homedir()) => path.join(home, '.falcon', 'personal');
const listFile = (home) => path.join(personalDir(home), 'changes.json');
const noticeFile = (home) => path.join(personalDir(home), 'notice.json');
const CHANGE_ID = /^[a-f0-9]{12}$/;

export function readChanges(home = os.homedir()) {
  try { const list = JSON.parse(fs.readFileSync(listFile(home), 'utf8')); return Array.isArray(list) ? list : []; } catch { return []; }
}
function writeChanges(list, home) {
  fs.mkdirSync(personalDir(home), { recursive: true });
  fs.writeFileSync(listFile(home), JSON.stringify(list, null, 2));
}
const patchFile = (id, home) => path.join(personalDir(home), `${id}.patch`);

/** A plain-words notice for the owner, shown in his window the next time it connects. */
export function leaveNotice(text, home = os.homedir()) {
  try { fs.mkdirSync(personalDir(home), { recursive: true }); fs.writeFileSync(noticeFile(home), JSON.stringify({ text, at: new Date().toISOString() })); } catch { /* told next time */ }
}
/** The waiting notice, once: it is removed when read. */
export function takeNotice(home = os.homedir()) {
  try { const { text } = JSON.parse(fs.readFileSync(noticeFile(home), 'utf8')); fs.rmSync(noticeFile(home), { force: true }); return text || null; } catch { return null; }
}

/** Keeps an approved repair as a personal change: its patch from `base` to `commit` in the local history. */
export async function recordChange({ history, base, commit, title, home = os.homedir() }) {
  const diff = await history.run(['diff', '--binary', '--no-color', '--no-ext-diff', base, commit]);
  if (diff.code !== 0 || !diff.out.trim()) return null;
  const id = crypto.createHash('sha256').update(`${commit}${Date.now()}`).digest('hex').slice(0, 12);
  fs.mkdirSync(personalDir(home), { recursive: true });
  fs.writeFileSync(patchFile(id, home), diff.out.endsWith('\n') ? diff.out : `${diff.out}\n`);
  const entry = { id, title: String(title || 'A change').slice(0, 300), at: new Date().toISOString(), on: true, state: 'applied', commit };
  writeChanges([...readChanges(home), entry], home);
  return entry;
}

/** The version number in package.json at a commit of the local history, or in the folder in use. */
async function versionAt(history, ref) {
  const r = await history.run(['show', `${ref}:package.json`]);
  try { return String(JSON.parse(r.out).version || ''); } catch { return ''; }
}
function versionIn(appRoot) {
  try { return String(JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version || ''); } catch { return ''; }
}

/** Records the files in use as a new "release", without moving what Falcon runs from. */
async function commitRelease(history, version) {
  const index = path.join(history.dir, `release-index-${process.pid}`);
  const env = { ...gitEnv(), GIT_INDEX_FILE: index };
  const g = (args) => new Promise((resolve) => execFile(history.git, ['--git-dir', history.dir, '--work-tree', history.appRoot, ...args],
    { cwd: history.appRoot, env, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ code: err ? 1 : 0, out: `${stdout}${stderr}` })));
  try {
    const parent = (await g(['rev-parse', 'release'])).out.trim();
    await g(['read-tree', 'release']);
    const paths = TRACKED.filter((name) => fs.existsSync(path.join(history.appRoot, name)));
    if ((await g(['add', '--all', '--', ...paths])).code !== 0) throw new Error('the new version could not be recorded');
    const tree = (await g(['write-tree'])).out.trim();
    const made = await g([...IDENTITY, 'commit-tree', tree, '-p', parent, '-m', `Falcon ${version} as installed`]);
    const commit = made.out.trim();
    if (made.code !== 0 || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('the new version could not be recorded');
    await history.run(['update-ref', 'refs/heads/release', commit, parent]);
    return commit;
  } finally { fs.rmSync(index, { force: true }); }
}

/**
 * Builds "release + the changes that are on" in a workshop copy. A change that no longer fits is left out.
 * @returns {Promise<{ ws, applied: string[], didNotFit: string[] }>}
 */
export async function buildPersonal({ history, home = os.homedir(), id, on }) {
  const ws = await createWorkshop({ history, id, home, from: 'release', sync: false });
  const applied = [];
  const didNotFit = [];
  for (const change of on) {
    const patch = patchFile(change.id, home);
    const tried = fs.existsSync(patch) ? await runGit(history.git, ['apply', '--3way', '--index', '--whitespace=nowarn', patch], { cwd: ws.dir }) : { code: 1 };
    if (tried.code === 0) {
      await runGit(history.git, [...IDENTITY, 'commit', '--quiet', '-m', `Personal change: ${change.title}`.slice(0, 300)], { cwd: ws.dir });
      applied.push(change.id);
    } else {
      await runGit(history.git, ['reset', '--quiet', '--hard', 'HEAD'], { cwd: ws.dir });
      await runGit(history.git, ['clean', '-fdq'], { cwd: ws.dir });
      didNotFit.push(change.id);
    }
  }
  return { ws, applied, didNotFit };
}

/**
 * Puts the changes that are on back on top of the release, checks the result, and switches it in.
 * Used after a new version arrives, and when the owner switches changes on or off.
 * @returns {Promise<{ ok, switched?: boolean, applied, didNotFit, allOff?: boolean, error? }>}
 */
export async function rebuild({ history, home = os.homedir(), node = process.execPath, switchTo, check = { test: testWorkshop, starts: checkWorkshopStarts }, why = 'switch', oldPid = process.pid }) {
  const list = readChanges(home);
  const on = list.filter((c) => c.on);
  const id = `personal-${Date.now().toString(36)}`;
  let built = await buildPersonal({ history, home, id, on });
  let allOff = false;
  if (built.applied.length) {
    const tests = await check.test({ dir: built.ws.dir, node });
    const starts = tests.ok && (await check.starts({ dir: built.ws.dir, node })).ok;
    if (!starts) {
      // Together the changes break the new version: run it without them, and say so.
      removeWorkshop({ id, home });
      allOff = true;
      built = { ...(await buildPersonal({ history, home, id: `${id}-plain`, on: [] })), didNotFit: on.map((c) => c.id), applied: [] };
    }
  }
  // Record what happened to each change.
  for (const change of list) {
    if (!change.on) { change.state = 'off'; continue; }
    if (built.applied.includes(change.id)) change.state = 'applied';
    else { change.on = false; change.state = allOff ? 'tests-failed' : 'did-not-fit'; }
  }
  writeChanges(list, home);
  const wsId = path.basename(built.ws.dir);
  const result = await switchTo({ history, id: wsId, home, oldPid, force: true, why });
  return { ok: result.ok, error: result.error, switched: result.ok, applied: built.applied, didNotFit: built.didNotFit, allOff };
}

/**
 * At start: if a new version of Falcon was installed since he last ran, record it as the release and put
 * the owner's changes back on top. Manual edits are simply recorded (workshop.js sync).
 * @returns {Promise<{ kind: 'none'|'edited'|'release', ...result }>}
 */
export async function adoptRelease({ history, home = os.homedir(), switchTo, check, node }) {
  if (!fs.existsSync(path.join(history.dir, 'HEAD'))) return { kind: 'none' };
  const status = await history.run(['status', '--porcelain', '--', ...TRACKED.filter((name) => fs.existsSync(path.join(history.appRoot, name)))]);
  if (!status.out.trim()) return { kind: 'none' };
  const now = versionIn(history.appRoot);
  if (!now || now === await versionAt(history, 'personal')) {
    await history.sync('Falcon\'s files changed outside the workshop');
    return { kind: 'edited' };
  }
  await commitRelease(history, now);
  const on = readChanges(home).filter((c) => c.on);
  if (!on.length) {
    // Nothing of his own to put back: Falcon simply runs the new version.
    await history.run(['update-ref', 'refs/heads/personal', 'release']);
    await history.run(['reset', '--quiet', '--mixed', 'personal']);
    return { kind: 'release', switched: false, applied: [], didNotFit: [] };
  }
  const result = await rebuild({ history, home, switchTo, check, node, why: 'update' });
  const titles = (ids) => readChanges(home).filter((c) => ids.includes(c.id)).map((c) => `“${c.title}”`).join(', ');
  if (result.allOff) leaveNotice(`Falcon was updated to version ${now}. Your own changes did not work with it, so they are switched off for now: ${titles(result.didNotFit)}. You can ask Falcon to adapt them in the Workshop.`, home);
  else if (result.didNotFit.length) leaveNotice(`Falcon was updated to version ${now}. ${result.applied.length ? `${result.applied.length} of your own changes are back on. ` : ''}This one no longer fits and is switched off: ${titles(result.didNotFit)}. You can ask Falcon to adapt it in the Workshop.`, home);
  else leaveNotice(`Falcon was updated to version ${now}, with your own ${result.applied.length === 1 ? 'change' : `${result.applied.length} changes`} kept.`, home);
  return { kind: 'release', ...result };
}

/** Switches one change, or all of them, on or off (the owner's choice in the Workshop window). */
export function setChanges({ home = os.homedir(), id, on }) {
  if (id !== 'all' && !CHANGE_ID.test(String(id))) return false;
  const list = readChanges(home);
  let touched = 0;
  for (const change of list) {
    if (id !== 'all' && change.id !== id) continue;
    change.on = Boolean(on);
    touched++;
  }
  if (!touched) return false;
  writeChanges(list, home);
  return true;
}

/** The patch of one change, for asking Falcon to adapt it. */
export function changePatch(id, home = os.homedir()) {
  if (!CHANGE_ID.test(String(id))) return '';
  try { return fs.readFileSync(patchFile(id, home), 'utf8'); } catch { return ''; }
}

/** A change replaced by an adapted version (a new repair): it is removed from the list. */
export function dropChange(id, home = os.homedir()) {
  const list = readChanges(home).filter((c) => c.id !== id);
  writeChanges(list, home);
  try { fs.rmSync(patchFile(id, home), { force: true }); } catch { /* gone */ }
}
