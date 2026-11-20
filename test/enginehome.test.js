// The engine's files and start-up name are Falcon's; an older install is moved over without losing anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { engineEnv, falconEngineDir, isMoved, moveEngineHome, prepareEngineHome } from '../src/app/enginehome.js';

const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-home-'));
const quiet = { settleMs: 1, windows: true, remember: () => {} };
const standard = (home) => path.join(home, '.openclaw');
const isLink = (dir) => { try { return fs.lstatSync(dir).isSymbolicLink(); } catch { return false; } };

function oldInstall(home) {
  const dir = standard(home);
  fs.mkdirSync(path.join(dir, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'openclaw.json'), '{ "gateway": { "port": 18789 } }');
  fs.writeFileSync(path.join(dir, '.env'), 'OPENROUTER_API_KEY=sk-test\n');
  return dir;
}
function recorder(fail = () => false) {
  const calls = [];
  const runEngine = async (args, { env }) => {
    calls.push({ args: args.join(' '), env });
    return { code: fail(args, env) ? 1 : 0, out: '' };
  };
  return { calls, runEngine };
}

test('a new computer: Falcon\'s folder is made first, with the standard path as a link to it', () => {
  const home = tempHome();
  assert.equal(prepareEngineHome(home, true), true);
  assert.ok(isLink(standard(home)));
  fs.writeFileSync(path.join(standard(home), 'openclaw.json'), '{}');
  assert.ok(fs.existsSync(path.join(falconEngineDir(home), 'openclaw.json')), 'the engine\'s files land in Falcon\'s folder');
  assert.equal(prepareEngineHome(home, true), false, 'nothing to do the second time');
  assert.equal(isMoved(home, true), true);
});

test('engine commands never point the engine at another folder; Falcon\'s start-up name once moved', () => {
  const home = tempHome();
  const stray = { PATH: 'x', OPENCLAW_STATE_DIR: 'C:\\elsewhere', OPENCLAW_PROFILE: 'dev', OPENCLAW_HOME: 'C:\\h' };
  const before = engineEnv(stray, home, true);
  assert.equal(before.OPENCLAW_STATE_DIR, undefined, 'the newest engine refuses its start-up item with another folder');
  assert.equal(before.OPENCLAW_PROFILE, undefined);
  assert.equal(before.OPENCLAW_HOME, undefined);
  assert.equal(before.OPENCLAW_WINDOWS_TASK_NAME, undefined, 'not moved: the old item keeps the engine\'s own name');
  assert.equal(before.PATH, 'x');
  prepareEngineHome(home, true);
  assert.equal(engineEnv(stray, home, true).OPENCLAW_WINDOWS_TASK_NAME, 'Falcon Engine');
});

test('a Mac keeps the engine\'s own folder and names', () => {
  const home = tempHome();
  assert.equal(prepareEngineHome(home, false), false);
  assert.deepEqual(engineEnv({ A: '1', OPENCLAW_STATE_DIR: 's' }, home, false), { A: '1', OPENCLAW_STATE_DIR: 's' });
});

test('moving: the old start-up item goes, the folder moves whole behind a link, the new item has Falcon\'s name', async () => {
  const home = tempHome();
  oldInstall(home);
  const { calls, runEngine } = recorder();
  assert.equal(await moveEngineHome({ runEngine, home, ...quiet }), 'moved');
  assert.ok(isLink(standard(home)));
  assert.equal(fs.readFileSync(path.join(falconEngineDir(home), '.env'), 'utf8'), 'OPENROUTER_API_KEY=sk-test\n', 'keys kept');
  assert.equal(fs.readFileSync(path.join(standard(home), '.env'), 'utf8'), 'OPENROUTER_API_KEY=sk-test\n', 'old paths still open');
  assert.deepEqual(calls.map((c) => c.args), ['gateway stop --force', 'gateway uninstall', 'gateway install --force', 'gateway start']);
  assert.equal(calls[1].env.OPENCLAW_WINDOWS_TASK_NAME, undefined, 'the old item is taken down under its old name');
  assert.equal(calls[2].env.OPENCLAW_WINDOWS_TASK_NAME, 'Falcon Engine');
  assert.ok(calls.every((c) => !c.env.OPENCLAW_STATE_DIR));
  assert.equal(await moveEngineHome({ runEngine, home, ...quiet }), 'none', 'once moved, nothing more to do');
});

test('moving: if the new start-up item cannot be made, everything is put back as it was', async () => {
  const home = tempHome();
  oldInstall(home);
  const { calls, runEngine } = recorder((args, env) => args[1] === 'install' && env.OPENCLAW_WINDOWS_TASK_NAME);
  assert.equal(await moveEngineHome({ runEngine, home, ...quiet }), 'failed');
  const s = fs.lstatSync(standard(home));
  assert.ok(s.isDirectory() && !s.isSymbolicLink(), 'the real folder is back');
  assert.equal(fs.readFileSync(path.join(standard(home), '.env'), 'utf8'), 'OPENROUTER_API_KEY=sk-test\n');
  assert.ok(!fs.existsSync(path.join(falconEngineDir(home), '.env')));
  assert.deepEqual(calls.slice(-2).map((c) => `${c.args} ${c.env.OPENCLAW_WINDOWS_TASK_NAME || '(old name)'}`),
    ['gateway install --force (old name)', 'gateway start (old name)']);
});

test('a computer moved by the first version: stopped, its settings given the standard path, its start-up item made again', async () => {
  const home = tempHome();
  prepareEngineHome(home, true);
  const engineDir = falconEngineDir(home);
  fs.writeFileSync(path.join(engineDir, 'gateway.cmd'), `set "OPENCLAW_STATE_DIR=${engineDir}"\r\n`);
  const named = (dir) => JSON.stringify({ agents: { defaults: { workspace: path.join(dir, 'workspace') } } });
  fs.writeFileSync(path.join(engineDir, 'openclaw.json'), named(engineDir));
  const { calls, runEngine } = recorder();
  assert.equal(await moveEngineHome({ runEngine, home, ...quiet }), 'tidied');
  // The engine refuses to remake its start-up item while it runs, so it is stopped first.
  assert.deepEqual(calls.map((c) => c.args), ['gateway stop --force', 'gateway install --force', 'gateway start']);
  assert.ok(calls.every((c) => c.env.OPENCLAW_WINDOWS_TASK_NAME === 'Falcon Engine' && !c.env.OPENCLAW_STATE_DIR));
  assert.equal(fs.readFileSync(path.join(engineDir, 'openclaw.json'), 'utf8'), named(standard(home)));
});

test('if the start-up item cannot be remade, it is tried again, and the engine is started again regardless', async () => {
  const home = tempHome();
  prepareEngineHome(home, true);
  fs.writeFileSync(path.join(falconEngineDir(home), 'gateway.cmd'), `set "OPENCLAW_STATE_DIR=${falconEngineDir(home)}"\r\n`);
  const { calls, runEngine } = recorder((args) => args[1] === 'install');
  assert.equal(await moveEngineHome({ runEngine, home, ...quiet }), 'failed');
  assert.deepEqual(calls.map((c) => c.args), ['gateway stop --force', 'gateway install --force', 'gateway install --force', 'gateway install --force', 'gateway start']);
});

test('nothing to move on a new computer, or on a Mac', async () => {
  const runEngine = async () => { throw new Error('must not run'); };
  assert.equal(await moveEngineHome({ runEngine, home: tempHome(), ...quiet }), 'none');
  const home = tempHome();
  oldInstall(home);
  assert.equal(await moveEngineHome({ runEngine, home, ...quiet, windows: false }), 'none');
});
