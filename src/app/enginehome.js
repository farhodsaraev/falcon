// Where the engine Falcon runs on keeps its settings, memory and keys, and the name of its start-up item.
// On Windows both are Falcon's: the files live in ~/.falcon/engine and the start-up item is "Falcon Engine".
//
// The engine is still the real, unchanged OpenClaw (MIT licence, credited in the README and NOTICE), so
// its updates keep working. It looks for its files at its standard place, ~/.openclaw, and from version
// 2026.11.6 it refuses to manage its start-up item when told to use another folder. So ~/.openclaw stays,
// as a hidden link to Falcon's folder: the engine finds its standard path, the files are Falcon's. The
// start-up name is a setting the engine provides (OPENCLAW_WINDOWS_TASK_NAME).
//
// Computers set up before this change keep a real ~/.openclaw folder until moveEngineHome() moves it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WINDOWS = process.platform === 'win32';
export const ENGINE_TASK = 'Falcon Engine';
// Settings the engine reads from its surroundings that would point it at another folder or start-up item.
const ENGINE_KEYS = ['OPENCLAW_STATE_DIR', 'OPENCLAW_CONFIG_PATH', 'OPENCLAW_PROFILE', 'OPENCLAW_HOME', 'OPENCLAW_WINDOWS_TASK_NAME'];

export const falconEngineDir = (home = os.homedir()) => path.join(home, '.falcon', 'engine');
const standardDir = (home = os.homedir()) => path.join(home, '.openclaw');

/** Where Falcon reads the engine's files: its standard path (a link to Falcon's folder once moved). */
export const engineHome = (home = os.homedir()) => standardDir(home);

function isLink(dir) {
  try { return fs.lstatSync(dir).isSymbolicLink(); } catch { return false; }
}
function isRealFolder(dir) {
  try { const s = fs.lstatSync(dir); return s.isDirectory() && !s.isSymbolicLink(); } catch { return false; }
}

/** True when the engine's files are in Falcon's folder (Windows only: a Mac keeps the engine's own). */
export const isMoved = (home = os.homedir(), windows = WINDOWS) => windows && isLink(standardDir(home));

/** The surroundings to run an engine command in: its standard path, and Falcon's start-up name once moved. */
export function engineEnv(base = process.env, home = os.homedir(), windows = WINDOWS) {
  if (!windows) return { ...base };
  const env = { ...base };
  for (const key of ENGINE_KEYS) delete env[key];
  // Before the move the start-up item still carries the engine's own name, so commands must find it by that.
  if (isMoved(home, windows)) env.OPENCLAW_WINDOWS_TASK_NAME = ENGINE_TASK;
  return env;
}

function hide(dir) {
  try { execFileSync('attrib.exe', ['+h', '+s', dir, '/L'], { windowsHide: true, stdio: 'ignore' }); } catch { /* visible, still works */ }
}

/**
 * A computer with no engine yet: make Falcon's folder and the hidden link to it before the engine is set
 * up, so the engine puts its files there from the start. Safe to call again.
 */
export function prepareEngineHome(home = os.homedir(), windows = WINDOWS) {
  if (!windows || fs.existsSync(standardDir(home)) || isLink(standardDir(home))) return false;
  fs.mkdirSync(falconEngineDir(home), { recursive: true });
  fs.symlinkSync(falconEngineDir(home), standardDir(home), 'junction');
  hide(standardDir(home));
  return true;
}

// Windows: the start-up name for this user, so engine commands typed by hand use it too; and no folder
// setting, which the engine would refuse (an earlier version of this change set one). Undone by the uninstaller.
function rememberForUser() {
  if (!WINDOWS) return;
  const read = (name) => { try { return execFileSync('reg.exe', ['query', 'HKCU\\Environment', '/v', name], { encoding: 'utf8', windowsHide: true }); } catch { return ''; } };
  if (read('OPENCLAW_STATE_DIR')) { try { execFileSync('reg.exe', ['delete', 'HKCU\\Environment', '/v', 'OPENCLAW_STATE_DIR', '/f'], { windowsHide: true, stdio: 'ignore' }); } catch { /* left */ } }
  if (!read('OPENCLAW_WINDOWS_TASK_NAME').includes(ENGINE_TASK)) {
    try { execFileSync('setx.exe', ['OPENCLAW_WINDOWS_TASK_NAME', ENGINE_TASK], { windowsHide: true, stdio: 'ignore' }); } catch { /* commands from Falcon still get it */ }
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Paths inside the engine's settings file that name one folder are made to name another. */
function repointSettings(file, from, to) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  const escaped = (p) => JSON.stringify(p).slice(1, -1);
  const next = text.split(escaped(from)).join(escaped(to));
  if (next !== text) fs.writeFileSync(file, next);
}

/**
 * Moves an engine set up before this change from a real ~/.openclaw folder into ~/.falcon/engine, leaves
 * a hidden link at ~/.openclaw, and renames its start-up item from "OpenClaw Gateway" to "Falcon Engine".
 * Nothing is lost: the folder is moved whole, and every path the engine has recorded still opens through
 * the link. If anything goes wrong, everything is put back as it was.
 *
 * Also tidies a computer moved by the first version of this change, whose start-up item was told to use
 * ~/.falcon/engine directly: the engine from 2026.11.6 refuses that, so the item is made again without it.
 *
 * @returns {Promise<'none'|'moved'|'tidied'|'failed'>}
 */
export async function moveEngineHome({ runEngine, engineReady = async () => true, home = os.homedir(), log = () => {}, settleMs = 2000, windows = WINDOWS, remember = rememberForUser } = {}) {
  if (!windows) return 'none';
  const from = standardDir(home);
  const to = falconEngineDir(home);
  const env = () => engineEnv(process.env, home, windows);
  const waitAwake = async () => { for (let i = 0; i < 90 && !await engineReady(); i++) await wait(settleMs); };

  if (isLink(from)) {
    remember();
    let script = '';
    try { script = fs.readFileSync(path.join(to, 'gateway.cmd'), 'utf8'); } catch { /* none */ }
    if (!/OPENCLAW_STATE_DIR=/i.test(script)) return 'none';
    log('Updating the engine\'s start-up item');
    // The engine refuses to remake its start-up item while it runs ("state database is busy", seen on a
    // real PC), so stop it first, as the move itself does, and always start it again afterwards.
    await runEngine(['gateway', 'stop', '--force'], { env: env(), timeoutMs: 120000 });
    // That first version also wrote Falcon's folder into the engine's settings; give them back the
    // standard path, which the rest of Falcon's setup names the workspace by.
    repointSettings(path.join(to, 'openclaw.json'), to, from);
    let made = { code: -1 };
    for (let i = 0; i < 3 && made.code !== 0; i++) {
      if (i) await wait(settleMs * 3);
      made = await runEngine(['gateway', 'install', '--force'], { env: env(), timeoutMs: 300000 });
    }
    await runEngine(['gateway', 'start'], { env: env(), timeoutMs: 120000 });
    await waitAwake();
    return made.code === 0 ? 'tidied' : 'failed';
  }
  if (!isRealFolder(from)) return 'none';    // no engine yet: setup prepares the folder (prepareEngineHome)
  if (fs.existsSync(to) && fs.readdirSync(to).length) return 'none';    // something already there: leave both alone

  log('Moving the engine into Falcon\'s folder');
  const before = { env: engineEnv(process.env, home, windows) };    // not moved yet: the engine's own name
  // Take down the old start-up item first: it would start the engine again from the old place.
  await runEngine(['gateway', 'stop', '--force'], { ...before, timeoutMs: 120000 });
  await runEngine(['gateway', 'uninstall'], { ...before, timeoutMs: 120000 });
  try { fs.rmdirSync(to); } catch { /* not there */ }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  // The engine may need a moment to let go of its files.
  let moved = false;
  for (let i = 0; i < 30 && !moved; i++) {
    try { fs.renameSync(from, to); moved = true; } catch { await wait(settleMs); }
  }
  const putBack = async () => {
    log('Putting the engine back where it was');
    // Remove only the link, never what it points to (Windows removes it as a folder, others as a file).
    if (isLink(from)) { try { fs.rmdirSync(from); } catch { try { fs.unlinkSync(from); } catch { /* left */ } } }
    try { if (isRealFolder(to) && !fs.existsSync(from)) fs.renameSync(to, from); } catch { /* left where it is */ }
    const back = { env: engineEnv(process.env, home, windows) };
    await runEngine(['gateway', 'install', '--force'], { ...back, timeoutMs: 300000 });
    await runEngine(['gateway', 'start'], { ...back, timeoutMs: 120000 });
    return 'failed';
  };
  if (!moved) return putBack();
  try {
    fs.symlinkSync(to, from, 'junction');
  } catch {
    return putBack();    // without the link the engine would not find its files
  }
  hide(from);
  const made = await runEngine(['gateway', 'install', '--force'], { env: env(), timeoutMs: 300000 });
  if (made.code !== 0) return putBack();
  await runEngine(['gateway', 'start'], { env: env(), timeoutMs: 120000 });
  remember();
  // A busy computer can take minutes to start the engine; Falcon's window already waits for that.
  await waitAwake();
  log('The engine now lives in Falcon\'s folder');
  return 'moved';
}
