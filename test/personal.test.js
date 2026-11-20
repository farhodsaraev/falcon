// Personal changes survive updates (self-repair plan, stage 4), on a tiny pretend Falcon: two changes of
// the owner's, then a new version arrives. No AI is used and the real Falcon is never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findGit } from '../src/app/git.js';
import { createWorkshop, openHistory, saveWorkshop, switchToWorkshop } from '../src/app/workshop.js';
import { adoptRelease, readChanges, rebuild, recordChange, setChanges, takeNotice } from '../src/app/personal.js';

const git = findGit();
const skip = !git && 'no Git on this computer';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SERVER = `import http from 'node:http';
export async function startServer({ port = 0 } = {}) {
  const server = http.createServer((req, res) => res.end(req.url === '/api/about' ? JSON.stringify({ version: '9' }) : '<h1>F A L C O N</h1>'));
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { port: server.address().port, token: 't', close: () => new Promise((resolve) => server.close(resolve)) };
}
`;
const LAUNCH = `import fs from 'node:fs';
import { startServer } from './server.js';
const s = await startServer();
fs.writeFileSync(process.env.FAKE_WINDOW_FILE, JSON.stringify({ port: s.port }));
setTimeout(() => process.exit(0), 15000);
`;
const GREETING = "export const greeting = () => 'Hello';\n";
const GREETING_TEST = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greeting } from '../src/app/greeting.js';\ntest('greets', () => assert.match(greeting(), /^(Hello|Good day)/));\n";

function pretendFalcon() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-personal-'));
  const app = path.join(home, 'app');
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(app, file)), { recursive: true }); fs.writeFileSync(path.join(app, file), text); };
  put('package.json', '{ "name": "falcon", "version": "1.0.0", "type": "module" }\n');
  put('src/app/server.js', SERVER);
  put('src/app/launch.js', LAUNCH);
  put('src/app/greeting.js', GREETING);
  put('src/app/colours.js', "export const colour = 'blue';\n");
  put('test/greeting.test.js', GREETING_TEST);
  const windowFile = path.join(home, 'window.json');
  const history = openHistory({ git, appRoot: app, home });
  // The real switch with its watchdog, starting the pretend Falcon; it waits for his answer.
  const switchTo = async (args) => {
    const r = await switchToWorkshop({ ...args, windowFile, waitMs: 10000, startEnv: { FAKE_WINDOW_FILE: windowFile }, oldPid: 0 });
    if (!r.ok) return r;
    for (let i = 0; i < 60 && !fs.existsSync(r.resultFile); i++) await sleep(500);
    return { ...r, result: JSON.parse(fs.readFileSync(r.resultFile, 'utf8')) };
  };
  return { home, app, put, history, switchTo };
}

// An approved repair, as Stage 3 makes one: changed in a workshop, switched in, kept as a personal change.
async function personalChange({ home, history, switchTo }, id, file, text, title) {
  const ws = await createWorkshop({ history, id, home });
  fs.writeFileSync(path.join(ws.dir, file), text);
  await saveWorkshop({ git, dir: ws.dir, message: title });
  const r = await switchTo({ history, id, home });
  assert.equal(r.ok, true, r.error);
  return recordChange({ history, base: ws.base, commit: r.commit, title, home });
}

const read = (app, file) => fs.readFileSync(path.join(app, file), 'utf8');

test('an update keeps both of the owner\'s changes, tested, and says so', { skip, timeout: 120000 }, async () => {
  const f = pretendFalcon();
  await f.history.init('1.0.0');
  await personalChange(f, 'one', 'src/app/greeting.js', "export const greeting = () => 'Hello, Farhod';\n", 'Greet me by name');
  await personalChange(f, 'two', 'src/app/colours.js', "export const colour = 'green';\n", 'Make it green');
  assert.equal(readChanges(f.home).length, 2);
  // The new version arrives, as the Update button installs it.
  f.put('package.json', '{ "name": "falcon", "version": "1.1.0", "type": "module" }\n');
  f.put('src/app/greeting.js', GREETING);
  f.put('src/app/colours.js', "export const colour = 'blue';\n");
  f.put('src/app/news.js', "export const news = 'new in 1.1';\n");
  const r = await adoptRelease({ history: f.history, home: f.home, switchTo: f.switchTo });
  assert.equal(r.kind, 'release');
  assert.equal(r.switched, true, r.error);
  assert.deepEqual(r.didNotFit, []);
  assert.match(read(f.app, 'src/app/greeting.js'), /Farhod/);
  assert.match(read(f.app, 'src/app/colours.js'), /green/);
  assert.match(read(f.app, 'src/app/news.js'), /new in 1\.1/, 'the new version is there too');
  assert.match(takeNotice(f.home), /updated to version 1\.1\.0, with your own 2 changes kept/);
  assert.equal(takeNotice(f.home), null, 'told once');
});

test('a change that no longer fits is switched off and named; the other is kept', { skip, timeout: 120000 }, async () => {
  const f = pretendFalcon();
  await f.history.init('1.0.0');
  const one = await personalChange(f, 'one', 'src/app/greeting.js', "export const greeting = () => 'Hello, Farhod';\n", 'Greet me by name');
  await personalChange(f, 'two', 'src/app/colours.js', "export const colour = 'green';\n", 'Make it green');
  f.put('package.json', '{ "name": "falcon", "version": "2.0.0", "type": "module" }\n');
  f.put('src/app/greeting.js', "export const greeting = () => 'Good day';\n");     // the same line, changed by the maker
  f.put('src/app/colours.js', "export const colour = 'blue';\n");
  const r = await adoptRelease({ history: f.history, home: f.home, switchTo: f.switchTo });
  assert.deepEqual(r.didNotFit, [one.id]);
  assert.equal(read(f.app, 'src/app/greeting.js'), "export const greeting = () => 'Good day';\n", 'the maker\'s new version wins');
  assert.match(read(f.app, 'src/app/colours.js'), /green/);
  const list = readChanges(f.home);
  assert.deepEqual(list.map((c) => [c.title, c.on, c.state]), [['Greet me by name', false, 'did-not-fit'], ['Make it green', true, 'applied']]);
  assert.match(takeNotice(f.home), /This one no longer fits and is switched off: “Greet me by name”/);
});

test('changes that break the new version are all switched off for it, and the new version runs', { skip, timeout: 120000 }, async () => {
  const f = pretendFalcon();
  await f.history.init('1.0.0');
  await personalChange(f, 'one', 'src/app/colours.js', "export const colour = 'green';\n", 'Make it green');
  f.put('package.json', '{ "name": "falcon", "version": "3.0.0", "type": "module" }\n');
  f.put('src/app/colours.js', "export const colour = 'blue';\n");      // the installer puts the maker's files back
  // The new version adds a test that the owner's change breaks.
  f.put('test/colour.test.js', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { colour } from '../src/app/colours.js';\ntest('colour is blue', () => assert.equal(colour, 'blue'));\n");
  const r = await adoptRelease({ history: f.history, home: f.home, switchTo: f.switchTo });
  assert.equal(r.allOff, true);
  assert.equal(read(f.app, 'src/app/colours.js'), "export const colour = 'blue';\n");
  assert.equal(readChanges(f.home)[0].state, 'tests-failed');
  assert.match(takeNotice(f.home), /did not work with it, so they are switched off for now: “Make it green”/);
});

test('the owner switches all his changes off for a test, and back on', { skip, timeout: 120000 }, async () => {
  const f = pretendFalcon();
  await f.history.init('1.0.0');
  await personalChange(f, 'one', 'src/app/colours.js', "export const colour = 'green';\n", 'Make it green');
  assert.equal(setChanges({ home: f.home, id: 'all', on: false }), true);
  let r = await rebuild({ history: f.history, home: f.home, switchTo: f.switchTo, oldPid: 0 });
  assert.equal(r.switched, true, r.error);
  assert.equal(read(f.app, 'src/app/colours.js'), "export const colour = 'blue';\n");
  assert.equal(readChanges(f.home)[0].state, 'off');
  assert.equal(setChanges({ home: f.home, id: 'all', on: true }), true);
  r = await rebuild({ history: f.history, home: f.home, switchTo: f.switchTo, oldPid: 0 });
  assert.match(read(f.app, 'src/app/colours.js'), /green/);
  assert.equal(setChanges({ home: f.home, id: '../x', on: true }), false, 'only a known change');
});

test('files edited by hand, with the same version, are simply recorded', { skip }, async () => {
  const f = pretendFalcon();
  await f.history.init('1.0.0');
  assert.equal((await adoptRelease({ history: f.history, home: f.home, switchTo: f.switchTo })).kind, 'none');
  f.put('src/app/colours.js', "export const colour = 'red';\n");
  assert.equal((await adoptRelease({ history: f.history, home: f.home, switchTo: f.switchTo })).kind, 'edited');
  assert.equal((await f.history.run(['status', '--porcelain'])).out.trim(), '');
});
