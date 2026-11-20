// Falcon's add-ons (self-repair plan, stage 6): found in falcon-agent/addons by their manifest.
// Loading one is checked with the real engine by hand; here no engine is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ADDONS_DIR, checkAddon, checkAddons, listAddons } from '../src/app/addons.js';

function pretendApp() {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-addons-app-'));
  const put = (name, manifest) => {
    fs.mkdirSync(path.join(app, ADDONS_DIR, name), { recursive: true });
    if (manifest !== null) fs.writeFileSync(path.join(app, ADDONS_DIR, name, 'openclaw.plugin.json'), manifest);
  };
  put('coin', JSON.stringify({ id: 'falcon-coin', name: 'Coin' }));
  put('bad-id', JSON.stringify({ id: '../escape' }));
  put('broken', '{ not json');
  put('empty', null);
  return app;
}

test('only add-ons with a readable manifest and a safe id are listed', () => {
  const app = pretendApp();
  assert.deepEqual(listAddons(app).map((a) => [a.name, a.id]), [['coin', 'falcon-coin']]);
  assert.deepEqual(listAddons(path.join(app, 'nowhere')), []);
  fs.rmSync(app, { recursive: true, force: true });
});

test('without the engine the load check is skipped, not failed; "only" limits it to the add-ons a repair touched', async () => {
  const app = pretendApp();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-addons-home-'));
  assert.deepEqual(await checkAddon({ cli: null, addon: listAddons(app)[0], stateDir: path.join(home, 's') }), { ok: true, skipped: 'the engine is not installed here' });
  assert.deepEqual((await checkAddons({ dir: app, cli: null, home })).map((r) => [r.id, r.ok]), [['falcon-coin', true]]);
  assert.deepEqual(await checkAddons({ dir: app, cli: null, home, only: ['other'] }), []);
  fs.rmSync(app, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});
