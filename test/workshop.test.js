// The local history and the workshop (self-repair plan, stage 2), on a tiny pretend Falcon in a
// temporary folder: the real Falcon and his project folder are never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findGit } from '../src/app/git.js';
import { checkWorkshopStarts, createWorkshop, openHistory, removeWorkshop, runGit, saveWorkshop, switchToWorkshop, testWorkshop } from '../src/app/workshop.js';

const git = findGit();
const skip = !git && 'no Git on this computer';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SERVER = `import http from 'node:http';
export async function startServer({ port = 0 } = {}) {
  const server = http.createServer((req, res) => res.end(req.url === '/api/about' ? JSON.stringify({ version: '9.9.9' }) : '<h1>F A L C O N</h1>'));
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { port: server.address().port, token: 't', close: () => new Promise((resolve) => server.close(resolve)) };
}
`;
const LAUNCH = `import fs from 'node:fs';
import { startServer } from './server.js';
const s = await startServer();
fs.writeFileSync(process.env.FAKE_WINDOW_FILE, JSON.stringify({ port: s.port }));
setTimeout(() => process.exit(0), 20000);
`;

function pretendFalcon() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-ws-home-'));
  const app = path.join(home, 'app');
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(app, file)), { recursive: true }); fs.writeFileSync(path.join(app, file), text); };
  put('package.json', '{ "name": "falcon", "version": "9.9.9", "type": "module" }\n');
  put('src/app/server.js', SERVER);
  put('src/app/launch.js', LAUNCH);
  put('test/ok.test.js', "import { test } from 'node:test';\ntest('pretend Falcon works', () => {});\n");
  put('logs/today.log', 'not part of Falcon\n');
  return { home, app, history: openHistory({ git, appRoot: app, home }) };
}

async function waitFor(file, ms) {
  for (const until = Date.now() + ms; Date.now() < until; await sleep(500)) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* not yet */ }
  }
  return null;
}

test('the local history records Falcon\'s own files, names no other place, and keeps changes made outside', { skip }, async () => {
  const { app, history } = pretendFalcon();
  assert.equal(await history.init('9.9.9'), true);
  assert.equal(await history.init('9.9.9'), false, 'made once');
  const files = (await history.run(['ls-files'])).out.trim().split('\n').map((f) => f.trim());
  assert.ok(files.includes('src/app/server.js') && files.includes('package.json'));
  assert.ok(!files.some((f) => f.startsWith('logs/')), 'other things in his folder are not part of him');
  assert.equal((await history.run(['remote'])).out.trim(), '', 'no connection to GitHub or anywhere else');
  assert.equal(await history.head('release'), await history.head('personal'));
  fs.appendFileSync(path.join(app, 'package.json'), '\n');
  assert.ok(await history.sync('an update'));
  assert.equal(await history.sync(), null, 'nothing new the second time');
});

test('a workshop is a separate copy on its own branch; tests and a start check run there', { skip }, async () => {
  const { home, app, history } = pretendFalcon();
  await history.init();
  const ws = await createWorkshop({ history, id: 'fix-one', home });
  assert.ok(fs.existsSync(path.join(ws.dir, 'src', 'app', 'server.js')));
  assert.equal((await runGit(git, ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ws.dir })).out.trim(), 'workshop/fix-one');
  assert.equal((await runGit(git, ['remote'], { cwd: ws.dir })).out.trim(), '', 'the workshop names no other place');
  await assert.rejects(createWorkshop({ history, id: 'fix-one', home }), /already exists/);
  await assert.rejects(createWorkshop({ history, id: '../escape', home }), /lowercase/);

  assert.equal((await testWorkshop({ dir: ws.dir })).ok, true);
  assert.equal((await checkWorkshopStarts({ dir: ws.dir })).ok, true);
  // A change in the workshop leaves the Falcon in use untouched.
  fs.writeFileSync(path.join(ws.dir, 'test', 'ok.test.js'), "import { test } from 'node:test';\ntest('broken on purpose', () => { throw new Error('x'); });\n");
  fs.writeFileSync(path.join(ws.dir, 'src', 'app', 'server.js'), 'this is not JavaScript(\n');
  assert.ok(await saveWorkshop({ git, dir: ws.dir, message: 'a broken change' }));
  const tests = await testWorkshop({ dir: ws.dir });
  assert.equal(tests.ok, false);
  assert.deepEqual(tests.failing, ['broken on purpose']);
  assert.equal((await checkWorkshopStarts({ dir: ws.dir })).ok, false);
  assert.equal(fs.readFileSync(path.join(app, 'src', 'app', 'server.js'), 'utf8'), SERVER, 'the Falcon in use is untouched');
  assert.equal(removeWorkshop({ id: 'fix-one', home }), true);
  assert.ok(!fs.existsSync(ws.dir));
});

test('switching to a good change: the new Falcon starts and is kept', { skip, timeout: 60000 }, async () => {
  const { home, app, history } = pretendFalcon();
  await history.init();
  const ws = await createWorkshop({ history, id: 'good', home });
  fs.writeFileSync(path.join(ws.dir, 'src', 'app', 'server.js'), SERVER.replace('F A L C O N', 'F A L C O N, improved'));
  await saveWorkshop({ git, dir: ws.dir, message: 'a good change' });
  const windowFile = path.join(home, 'window.json');
  const r = await switchToWorkshop({ history, id: 'good', home, windowFile, waitMs: 15000, startEnv: { FAKE_WINDOW_FILE: windowFile } });
  assert.equal(r.ok, true, r.error);
  const result = await waitFor(r.resultFile, 30000);
  assert.equal(result?.ok, true, JSON.stringify(result));
  assert.match(fs.readFileSync(path.join(app, 'src', 'app', 'server.js'), 'utf8'), /improved/);
  assert.equal(await history.head('personal'), r.commit);
  assert.equal((await history.run(['rev-parse', 'refs/falcon/last-good'])).out.trim(), r.lastGood, 'the last working version is kept');
});

test('switching to a change that breaks the start: the last working version is put back within the wait', { skip, timeout: 90000 }, async () => {
  const { home, app, history } = pretendFalcon();
  await history.init();
  const before = await history.head();
  const ws = await createWorkshop({ history, id: 'bad', home });
  fs.writeFileSync(path.join(ws.dir, 'src', 'app', 'server.js'), 'this is not JavaScript(\n');
  await saveWorkshop({ git, dir: ws.dir, message: 'a change that breaks the start' });
  const windowFile = path.join(home, 'window.json');
  const started = Date.now();
  const r = await switchToWorkshop({ history, id: 'bad', home, windowFile, waitMs: 8000, startEnv: { FAKE_WINDOW_FILE: windowFile } });
  assert.equal(r.ok, true, r.error);
  const result = await waitFor(r.resultFile, 45000);
  assert.equal(result?.ok, false);
  assert.equal(result.rolledBack, true);
  assert.equal(result.backUp, true, 'the last working version started again');
  assert.ok(Date.now() - started < 45000);
  assert.equal(fs.readFileSync(path.join(app, 'src', 'app', 'server.js'), 'utf8'), SERVER, 'the working files are back');
  assert.equal(await history.head(), before);
});

test('a workshop made before other changes is not switched in, so nothing is undone', { skip }, async () => {
  const { home, app, history } = pretendFalcon();
  await history.init();
  const ws = await createWorkshop({ history, id: 'late', home });
  fs.writeFileSync(path.join(ws.dir, 'package.json'), '{ "name": "falcon", "version": "9.9.10", "type": "module" }\n');
  await saveWorkshop({ git, dir: ws.dir, message: 'a change' });
  fs.writeFileSync(path.join(app, 'NOTICE'), 'arrived with an update meanwhile\n');
  const r = await switchToWorkshop({ history, id: 'late', home, windowFile: path.join(home, 'w.json') });
  assert.equal(r.ok, false);
  assert.match(r.error, /older Falcon/);
  assert.ok(fs.existsSync(path.join(app, 'NOTICE')), 'the other change is still there');
});
