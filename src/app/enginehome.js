// Where the engine Falcon runs on keeps its settings, memory and keys, and the name its start-up item
// carries. Both are Falcon's: the folder is ~/.falcon/engine and the start-up item is "Falcon Engine".
// The engine is still the real, unchanged OpenClaw (MIT licence, credited in the README and NOTICE):
// it supports both choices through its own settings, so its updates keep working.
//
// Computers set up before this change keep their engine in ~/.openclaw until moveEngineHome() moves it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WINDOWS = process.platform === 'win32';
export const ENGINE_TASK = 'Falcon Engine';
const IDENTITY = { OPENCLAW_WINDOWS_TASK_NAME: ENGINE_TASK, OPENCLAW_LAUNCHD_LABEL: 'ai.falcon.engine', OPENCLAW_SYSTEMD_UNIT: 'falcon-engine' };
// Settings the engine reads from its surroundings that choose its folder and its start-up item.
const ENGINE_KEYS = ['OPENCLAW_STATE_DIR', 'OPENCLAW_CONFIG_PATH', 'OPENCLAW_PROFILE', ...Object.keys(IDENTITY)];

export const newEngineHome = (home = os.homedir()) => path.join(home, '.falcon', 'engine');
export const oldEngineHome = (home = os.homedir()) => path.join(home, '.openclaw');

/** True when the folder is a real folder, not the link left behind after a move. */
function realFolder(dir) {
  try { return fs.lstatSync(dir).isDirectory(); } catch { return false; }
}

/** The engine's folder on this computer: Falcon's own, unless an older install has not been moved yet. */
export function engineHome(home = os.homedir(), windows = WINDOWS) {
  // Windows only for now: that is where Falcon's customers are and where this was tested. A Mac keeps
  // the engine's own folder and names.
  if (!windows) return oldEngineHome(home);
  const fresh = newEngineHome(home);
  if (fs.existsSync(fresh) || !realFolder(oldEngineHome(home))) return fresh;
  return oldEngineHome(home);
}

/** True once the engine lives in Falcon's folder (always, on a computer set up after this change). */
export const isMoved = (home = os.homedir(), windows = WINDOWS) => engineHome(home, windows) === newEngineHome(home);

/** The surroundings to run an engine command in, so it uses Falcon's folder and Falcon's names. */
export function engineEnv(base = process.env, home = os.homedir(), windows = WINDOWS) {
  const env = { ...base };
  if (!windows) return env;
  for (const key of ENGINE_KEYS) delete env[key];
  if (!isMoved(home, windows)) return env;    // an unmoved install keeps the engine's own defaults until it is moved
  return { ...env, OPENCLAW_STATE_DIR: newEngineHome(home), ...IDENTITY };
}

/** The same, as the engine had it before: for taking down the old start-up item during the move. */
function oldEnv(base = process.env) {
  const env = { ...base };
  for (const key of ENGINE_KEYS) delete env[key];
  return env;
}

// Windows: remember the folder and the name for this user, so engine commands typed by hand, and the
// engine's own updater, use them too. Removed again by Falcon's uninstaller.
function rememberForUser(home) {
  if (!WINDOWS) return;
  const want = { OPENCLAW_STATE_DIR: newEngineHome(home), OPENCLAW_WINDOWS_TASK_NAME: ENGINE_TASK };
  for (const [name, value] of Object.entries(want)) {
    try {
      const now = execFileSync('reg.exe', ['query', 'HKCU\\Environment', '/v', name], { encoding: 'utf8', windowsHide: true });
      if (now.includes(value)) continue;
    } catch { /* not set yet */ }
    try { execFileSync('setx.exe', [name, value], { windowsHide: true, stdio: 'ignore' }); } catch { /* engine commands from Falcon still get it */ }
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Paths inside the engine's settings file point at its folder; point them at the new one. */
function repointSettings(file, from, to) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  const escaped = (p) => JSON.stringify(p).slice(1, -1);
  const next = text.split(escaped(from)).join(escaped(to)).split(from.replace(/\\/g, '/')).join(to.replace(/\\/g, '/'));
  if (next !== text) fs.writeFileSync(file, next);
}

/**
 * Moves an engine set up before this change from ~/.openclaw into ~/.falcon/engine, and its start-up
 * item from "OpenClaw Gateway" to "Falcon Engine". Nothing is lost: the folder is moved whole, and a
 * hidden link stays at the old place, because the engine's own records still name old paths (seen on a
 * real install: hundreds in its database). If anything goes wrong, everything is put back as it was.
 *
 * @returns {Promise<'none'|'moved'|'failed'>}
 */
export async function moveEngineHome({ runEngine, engineReady = async () => true, home = os.homedir(), log = () => {}, settleMs = 2000, windows = WINDOWS, remember = rememberForUser } = {}) {
  const from = oldEngineHome(home);
  const to = newEngineHome(home);
  if (!windows) return 'none';
  if (isMoved(home, windows)) {
    if (fs.existsSync(path.join(to, 'openclaw.json'))) remember(home);
    return 'none';
  }
  log('Moving the engine into Falcon\'s folder');
  const old = { env: oldEnv() };
  // Take down the old start-up item first: it would start the engine from the old place again.
  await runEngine(['gateway', 'stop'], { ...old, timeoutMs: 120000 });
  await runEngine(['gateway', 'uninstall'], { ...old, timeoutMs: 120000 });
  // The engine may need a moment to let go of its files.
  let moved = false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  for (let i = 0; i < 30 && !moved; i++) {
    try { fs.renameSync(from, to); moved = true; } catch { await wait(settleMs); }
  }
  const putBack = async () => {
    log('Putting the engine back where it was');
    try { if (fs.lstatSync(from).isSymbolicLink()) fs.rmdirSync(from); } catch { /* no link made */ }
    try { if (realFolder(to) && !fs.existsSync(from)) fs.renameSync(to, from); } catch { /* left where it is */ }
    await runEngine(['gateway', 'install', '--force'], { ...old, timeoutMs: 300000 });
    await runEngine(['gateway', 'start'], { ...old, timeoutMs: 120000 });
    return 'failed';
  };
  if (!moved) return putBack();
  try {
    fs.symlinkSync(to, from, 'junction');
    if (WINDOWS) { try { execFileSync('attrib.exe', ['+h', '+s', from, '/L'], { windowsHide: true, stdio: 'ignore' }); } catch { /* visible, still works */ } }
  } catch { /* old paths in the engine's records may not open; its settings below are repointed anyway */ }
  repointSettings(path.join(to, 'openclaw.json'), from, to);
  const env = engineEnv(process.env, home, windows);
  const installed = await runEngine(['gateway', 'install', '--force'], { env, timeoutMs: 300000 });
  if (installed.code !== 0) return putBack();
  await runEngine(['gateway', 'start'], { env, timeoutMs: 120000 });
  remember(home);
  // A busy computer can take minutes to start the engine; Falcon's window already waits for that.
  for (let i = 0; i < 90 && !await engineReady(); i++) await wait(settleMs);
  log('The engine now lives in Falcon\'s folder');
  return 'moved';
}
