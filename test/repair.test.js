// Repairs (self-repair plan, stage 3) on a tiny pretend Falcon, with a pretend writer and reviewer:
// no AI is used, nothing is spent, and the real Falcon is never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findGit } from '../src/app/git.js';
import { openHistory } from '../src/app/workshop.js';
import { codexStep, createRepairs, estimate, readDiff } from '../src/app/repair.js';

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
const CHOICE = { provider: 'openrouter', model: 'openai/gpt-6.1-terra', label: 'GPT-6.1 Terra', tool: 'Falcon\'s engine' };

function pretendFalcon() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-repair-'));
  const app = path.join(home, 'app');
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(app, file)), { recursive: true }); fs.writeFileSync(path.join(app, file), text); };
  put('package.json', '{ "name": "falcon", "version": "9.9.9", "type": "module" }\n');
  put('src/app/server.js', SERVER);
  put('src/app/greeting.js', "export const greeting = () => 'Hello';\n");
  put('test/greeting.test.js', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greeting } from '../src/app/greeting.js';\ntest('greets', () => assert.match(greeting(), /^Hello/));\n");
  let h = null;
  const history = async () => { if (!h) { h = openHistory({ git, appRoot: app, home }); await h.init(); } return h; };
  return { home, app, history };
}

async function until(repairs, phases, ms = 60000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (phases.includes(repairs.status()?.phase)) return repairs.status();
  throw new Error(`still ${repairs.status()?.phase}`);
}

test('a repair: written in a workshop copy, tested, started, reviewed, then waits for the owner\'s yes', { skip, timeout: 120000 }, async () => {
  const { home, app, history } = pretendFalcon();
  const seen = [];
  let switched = null;
  const repairs = createRepairs({
    home, history, keys: async () => ({ openrouter: 'k' }), engineCli: () => null, onChange: (s) => seen.push(s.phase),
    write: async ({ dir, step }) => {
      step('Changing greeting.js');
      fs.writeFileSync(path.join(dir, 'src', 'app', 'greeting.js'), "export const greeting = () => 'Hello, Farhod';\n");
      return { ok: true, said: 'He now greets by name.' };
    },
    review: async ({ diff }) => ({ ok: /Farhod/.test(diff), problems: [] }),
    switchTo: async (args) => { switched = args; return { ok: true, commit: 'abc' }; },
  });
  assert.equal(repairs.start('Greet me by name', CHOICE).ok, false, 'not without agreeing to the cost');
  assert.equal(repairs.start('Greet me by name', null, { agreed: true }).ok, false, 'not without a coding key');
  assert.equal(repairs.start('Greet me by name', CHOICE, { agreed: true }).ok, true);
  assert.equal(repairs.start('Something else', CHOICE, { agreed: true }).ok, false, 'one at a time');
  const done = await until(repairs, ['ready', 'failed']);
  assert.equal(done.phase, 'ready', done.error);
  assert.equal(done.tests.ok, true);
  assert.equal(done.starts, true);
  assert.equal(done.review.ok, true);
  assert.equal(done.said, 'He now greets by name.');
  assert.deepEqual(done.diff.map((f) => [f.file, f.added, f.removed]), [['src/app/greeting.js', 1, 1]]);
  assert.ok(done.steps.some((s) => s.text === 'Changing greeting.js'));
  assert.ok(['preparing', 'writing', 'testing', 'reviewing', 'ready'].every((p) => seen.includes(p)), seen.join(','));
  assert.equal(fs.readFileSync(path.join(app, 'src', 'app', 'greeting.js'), 'utf8'), "export const greeting = () => 'Hello';\n", 'the Falcon in use is untouched until approved');
  assert.equal(repairs.start('Another', CHOICE, { agreed: true }).ok, false, 'a finished repair waits for a decision first');
  const yes = await repairs.approve({ oldPid: 1 });
  assert.equal(yes.ok, true);
  assert.equal(switched.id, done.id);
  assert.equal(repairs.status().phase, 'approved');
  assert.ok(fs.existsSync(path.join(home, '.falcon', 'repairs', `${done.id}.json`)), 'a record is kept');
});

test('failing tests or a reviewer\'s problem get one correction; still failing, nothing can be approved', { skip, timeout: 120000 }, async () => {
  const { home, history } = pretendFalcon();
  const attempts = [];
  const repairs = createRepairs({
    home, history, keys: async () => ({ openrouter: 'k' }), engineCli: () => null,
    write: async ({ dir, extra }) => {
      attempts.push(extra);
      fs.writeFileSync(path.join(dir, 'src', 'app', 'greeting.js'), "export const greeting = () => 'Hi';\n");   // breaks the test both times
      return { ok: true, said: 'Changed the greeting.' };
    },
    review: async () => ({ ok: false, problems: ['It no longer says Hello.'] }),
    switchTo: async () => { throw new Error('must not switch'); },
  });
  repairs.start('Say hi', CHOICE, { agreed: true });
  const done = await until(repairs, ['ready', 'failed']);
  assert.equal(done.phase, 'failed');
  assert.equal(attempts.length, 2, 'one correction');
  assert.match(attempts[1], /These tests fail: greets/);
  assert.match(attempts[1], /A reviewer found: It no longer says Hello\./);
  assert.equal((await repairs.approve()).ok, false);
  assert.equal(repairs.refuse().ok, true);
  assert.ok(!fs.existsSync(done.dir), 'the workshop copy is thrown away');
});

test('Stop ends the work and throws the copy away', { skip, timeout: 60000 }, async () => {
  const { home, history } = pretendFalcon();
  let release;
  const repairs = createRepairs({
    home, history, keys: async () => ({ openrouter: 'k' }), engineCli: () => null,
    write: () => new Promise((resolve) => { release = () => resolve({ ok: false, error: 'Stopped.' }); }),
    review: async () => ({ ok: true, problems: [] }),
  });
  repairs.start('Do something long', CHOICE, { agreed: true });
  await until(repairs, ['writing']);
  assert.equal(repairs.stop().ok, true);
  release();
  await sleep(300);
  assert.equal(repairs.status().phase, 'stopped');
  assert.ok(!fs.existsSync(repairs.status().dir));
});

test('Codex\'s commands are named in plain words; the change is read as files and lines; the cost is said plainly', () => {
  assert.equal(codexStep('"powershell.exe" -Command \'node --test test/\''), 'Running the tests');
  assert.equal(codexStep('"powershell.exe" -Command \'rg -n "approve" .\''), 'Searching Falcon\'s code');
  assert.equal(codexStep('"powershell.exe" -Command \'Get-Content src/app/server.js | Select-Object -First 50\''), 'Reading server.js');
  assert.equal(codexStep('"powershell.exe" -Command \'Set-Content -Path src/app/greeting.js -Value x\''), 'Changing greeting.js');
  const files = readDiff('diff --git a/src/x.js b/src/x.js\nindex 1..2 100644\n--- a/src/x.js\n+++ b/src/x.js\n@@ -1,2 +1,2 @@\n keep\n-old\n+new\n');
  assert.deepEqual(files, [{ file: 'src/x.js', added: 1, removed: 1, lines: [['@', ''], [' ', 'keep'], ['-', 'old'], ['+', 'new']] }]);
  assert.match(estimate({ model: 'gpt-6.1-terra' }).text, /20 cents to 2 US dollars/);
  assert.match(estimate({ model: 'anthropic/claude-sonnet-5.5' }).text, /50 cents to 3 US dollars/);
});

test('the engine\'s answer is found after its log lines, with what the provider billed', async () => {
  const { lastJson } = await import('../src/app/repair.js');
  const out = '[agent/embedded] {"subsystem":"x"} started\nsomething { odd\n{\n  "ok": true,\n  "final": "Added mute.",\n  "usage": { "cost": { "total": 0.1192 } }\n}\n[state] closed\n';
  const doc = lastJson(out);
  assert.equal(doc.final, 'Added mute.');
  assert.equal(doc.usage.cost.total, 0.1192);
  assert.equal(lastJson('no json here'), null);
});
