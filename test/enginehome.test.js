// The engine's folder and start-up name are Falcon's; an older install is moved over without losing anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { engineEnv, engineHome, moveEngineHome, newEngineHome, oldEngineHome } from '../src/app/enginehome.js';

const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-home-'));
const quiet = { settleMs: 1, windows: true, remember: () => {} };

function oldInstall(home) {
  const dir = oldEngineHome(home);
  fs.mkdirSync(path.join(dir, 'workspace'), { recursive: true });
  const escaped = JSON.stringify(dir).slice(1, -1);
  fs.writeFileSync(path.join(dir, 'openclaw.json'), `{ "agents": { "defaults": { "workspace": "${escaped}\\\\workspace" } }, "gateway": { "port": 18789 } }`);
  fs.writeFileSync(path.join(dir, '.env'), 'OPENROUTER_API_KEY=sk-test\n');
  return dir;
}

test('a fresh computer uses Falcon\'s folder and Falcon\'s start-up name', () => {
  const home = tempHome();
  assert.equal(engineHome(home, true), newEngineHome(home));
  const env = engineEnv({ PATH: 'x', OPENCLAW_PROFILE: 'dev' }, home, true);
  assert.equal(env.OPENCLAW_STATE_DIR, path.join(home, '.falcon', 'engine'));
  assert.equal(env.OPENCLAW_WINDOWS_TASK_NAME, 'Falcon Engine');
  assert.equal(env.OPENCLAW_PROFILE, undefined, 'a stray profile would pick another folder');
  assert.equal(env.PATH, 'x');
});

test('an install not moved yet keeps the engine\'s own folder and names until it is moved', () => {
  const home = tempHome();
  oldInstall(home);
  assert.equal(engineHome(home, true), oldEngineHome(home));
  const env = engineEnv({ OPENCLAW_STATE_DIR: 'stale' }, home, true);
  assert.equal(env.OPENCLAW_STATE_DIR, undefined);
  assert.equal(env.OPENCLAW_WINDOWS_TASK_NAME, undefined);
});

test('a Mac keeps the engine\'s own folder and names', () => {
  const home = tempHome();
  assert.equal(engineHome(home, false), oldEngineHome(home));
  assert.deepEqual(engineEnv({ A: '1' }, home, false), { A: '1' });
});

test('moving: the old start-up item goes, the folder moves whole, the new one is made under Falcon\'s name', async () => {
  const home = tempHome();
  const from = oldInstall(home);
  const calls = [];
  const runEngine = async (args, { env }) => { calls.push({ args: args.join(' '), dir: env.OPENCLAW_STATE_DIR, task: env.OPENCLAW_WINDOWS_TASK_NAME }); return { code: 0, out: '' }; };
  const result = await moveEngineHome({ runEngine, home, ...quiet });
  assert.equal(result, 'moved');
  const to = newEngineHome(home);
  assert.equal(fs.readFileSync(path.join(to, '.env'), 'utf8'), 'OPENROUTER_API_KEY=sk-test\n', 'keys kept');
  assert.ok(fs.existsSync(path.join(to, 'workspace')));
  // The settings name the new folder; the old place is only a link to it, so old records still open.
  assert.ok(fs.readFileSync(path.join(to, 'openclaw.json'), 'utf8').includes(JSON.stringify(to).slice(1, -1)));
  assert.ok(fs.lstatSync(from).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(from, '.env')));
  assert.deepEqual(calls.map((c) => c.args), ['gateway stop', 'gateway uninstall', 'gateway install --force', 'gateway start']);
  assert.equal(calls[1].task, undefined, 'the old item is taken down under its old name');
  assert.equal(calls[2].dir, to);
  assert.equal(calls[2].task, 'Falcon Engine');
  assert.equal(engineHome(home, true), to);
  // Once moved, nothing more to do.
  assert.equal(await moveEngineHome({ runEngine, home, ...quiet }), 'none');
});

test('moving: if the new start-up item cannot be made, everything is put back as it was', async () => {
  const home = tempHome();
  const from = oldInstall(home);
  const calls = [];
  const runEngine = async (args, { env }) => {
    calls.push(`${args.join(' ')} ${env.OPENCLAW_WINDOWS_TASK_NAME ? '(Falcon)' : '(old)'}`);
    return { code: args[1] === 'install' && env.OPENCLAW_WINDOWS_TASK_NAME ? 1 : 0, out: '' };
  };
  assert.equal(await moveEngineHome({ runEngine, home, ...quiet }), 'failed');
  assert.ok(fs.lstatSync(from).isDirectory() && !fs.lstatSync(from).isSymbolicLink(), 'the real folder is back');
  assert.equal(fs.readFileSync(path.join(from, '.env'), 'utf8'), 'OPENROUTER_API_KEY=sk-test\n');
  assert.ok(!fs.existsSync(newEngineHome(home)));
  assert.equal(engineHome(home, true), from);
  assert.deepEqual(calls.slice(-2), ['gateway install --force (old)', 'gateway start (old)']);
});

test('nothing to move on a fresh computer or a Mac', async () => {
  const runEngine = async () => { throw new Error('must not run'); };
  assert.equal(await moveEngineHome({ runEngine, home: tempHome(), ...quiet }), 'none');
  const home = tempHome();
  oldInstall(home);
  assert.equal(await moveEngineHome({ runEngine, home, ...quiet, windows: false }), 'none');
});
