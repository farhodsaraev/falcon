import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, newerVersion } from '../src/app/server.js';

test('versions are compared part by part', () => {
  assert.equal(newerVersion('2026.11.5', '2026.11.4'), true);
  assert.equal(newerVersion('2026.11.4', '2026.11.4'), false);
  assert.equal(newerVersion('2026.9.30', '2026.11.4'), false);
  assert.equal(newerVersion('0.3.0', '0.2.9'), true);
  assert.equal(newerVersion('0.10.0', '0.9.0'), true);
  assert.equal(newerVersion('', '0.2.0'), false);
});

// One Falcon with stand-ins for everything an update touches.
async function falcon({ mine, published, engineNow, installed = true, engineFails = false, offline = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-update-button-'));
  const did = [];
  let engine = engineNow;
  const server = await startServer({ engine: {
    fastLane: async () => null,
    directLine: null,
    profileFile: () => path.join(dir, 'profile.json'),
    readGateway: () => ({ port: 1, token: 'gw' }),
    findEngine: () => ({ command: 'node', prefix: [] }),
    engineReady: async () => true,
    appInfo: () => mine,
    engineVersion: () => engine,
    isInstalledCopy: () => installed,
    runInstaller: () => did.push('installer'),
    packStamp: () => 'stamp',
    installFalcon: async () => { did.push('re-taught'); return { ok: true }; },
    runEngine: async (args, { onLine } = {}) => {
      did.push(args.join(' '));
      if (args[0] === 'update') {
        onLine?.('Installing OpenClaw 2026.11.5');
        if (engineFails) return { code: 1, out: 'npm ERR! network\nOpenClaw update failed' };
        engine = args[2];
      }
      return { code: 0, out: '' };
    },
    fetch: async (url) => {
      if (offline) throw new Error('offline');
      assert.match(String(url), /raw\.githubusercontent\.com\/farhodsaraev\/falcon\/main\/package\.json$/);
      return new Response(JSON.stringify(published), { status: 200 });
    },
  } });
  const call = (method) => fetch(`http://127.0.0.1:${server.port}/api/update`, { method, headers: { 'Content-Type': 'application/json', 'X-Falcon-Token': server.token } }).then((r) => r.json());
  return { server, did, status: () => call('GET'), update: () => call('POST') };
}

test('Update: nothing newer means nothing to do, and no internet is said plainly', async () => {
  let f = await falcon({ mine: { version: '0.3.0', falconEngine: '2026.11.5' }, published: { version: '0.3.0', falconEngine: '2026.11.5' }, engineNow: '2026.11.5' });
  try {
    const status = await f.status();
    assert.deepEqual([status.falconNewer, status.engineNewer, status.latest], [false, false, '0.3.0']);
    assert.equal(status.engineTarget, undefined, 'the engine\'s version is not shown to the window');
    assert.deepEqual(await f.update(), { ok: true, restarting: false, engineUpdated: false });
    assert.deepEqual(f.did, []);
  } finally { await f.server.close(); }

  f = await falcon({ mine: { version: '0.3.0', falconEngine: '2026.11.5' }, published: {}, engineNow: '2026.11.5', offline: true });
  try {
    const status = await f.status();
    assert.deepEqual([status.falconNewer, status.engineNewer, status.latest], [false, false, null]);
  } finally { await f.server.close(); }
});

test('Update: the engine goes to the tested version only, Falcon is re-taught, then the installer brings the new Falcon', async () => {
  const f = await falcon({ mine: { version: '0.2.0' }, published: { version: '0.3.0', falconEngine: '2026.11.5' }, engineNow: '2026.11.4' });
  try {
    const status = await f.status();
    assert.deepEqual([status.falconNewer, status.engineNewer, status.canUpdateFalcon], [true, true, true]);
    const result = await f.update();
    assert.deepEqual(result, { ok: true, restarting: true, engineUpdated: true });
    assert.equal(f.did[0], 'update --tag 2026.11.5 --yes', 'the tested version, by name, never simply the latest');
    assert.ok(f.did.includes('gateway start'));
    assert.ok(f.did.includes('re-taught'));
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(f.did.at(-1), 'installer', 'the installer runs last, because it closes Falcon');
  } finally { await f.server.close(); }
});

test('Update: a copy run from its project folder updates only the engine, and a failed engine update changes nothing else', async () => {
  let f = await falcon({ mine: { version: '0.2.0' }, published: { version: '0.3.0', falconEngine: '2026.11.5' }, engineNow: '2026.11.4', installed: false });
  try {
    assert.deepEqual(await f.update(), { ok: true, restarting: false, engineUpdated: true });
    await new Promise((r) => setTimeout(r, 1000));
    assert.ok(!f.did.includes('installer'));
  } finally { await f.server.close(); }

  f = await falcon({ mine: { version: '0.2.0' }, published: { version: '0.3.0', falconEngine: '2026.11.5' }, engineNow: '2026.11.4', engineFails: true });
  try {
    const result = await f.update();
    assert.equal(result.ok, false);
    assert.match(result.error, /engine could not be updated/);
    assert.doesNotMatch(result.detail, /openclaw/i, 'the engine\'s name stays out of what the window shows');
    await new Promise((r) => setTimeout(r, 1000));
    assert.ok(!f.did.includes('installer') && !f.did.includes('re-taught'));
  } finally { await f.server.close(); }
});

test('Update: an odd engine version in the published description is ignored, not run', async () => {
  const f = await falcon({ mine: { version: '0.3.0' }, published: { version: '0.3.0', falconEngine: '2026.11.5; calc' }, engineNow: '2026.11.4' });
  try {
    assert.equal((await f.status()).engineNewer, false);
    await f.update();
    assert.deepEqual(f.did, []);
  } finally { await f.server.close(); }
});
