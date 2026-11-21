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

test('an add-on the writer makes is load-checked; one that does not load gets the reason in its correction', { skip, timeout: 120000 }, async () => {
  const { home, history } = pretendFalcon();
  const attempts = [];
  const checked = [];
  const repairs = createRepairs({
    home, history, keys: async () => ({ openrouter: 'k' }), engineCli: () => null,
    write: async ({ dir, extra }) => {
      attempts.push(extra);
      const addon = path.join(dir, 'falcon-agent', 'addons', 'coin');
      fs.mkdirSync(addon, { recursive: true });
      fs.writeFileSync(path.join(addon, 'openclaw.plugin.json'), JSON.stringify({ id: 'falcon-coin' }));
      fs.writeFileSync(path.join(addon, 'index.js'), attempts.length === 1 ? 'export default {\n' : 'export default {};\n');
      return { ok: true, said: 'Added a coin to flip.' };
    },
    review: async () => ({ ok: true, problems: [] }),
    check: {
      addons: async ({ dir, only }) => {
        checked.push(only);
        const good = fs.readFileSync(path.join(dir, 'falcon-agent', 'addons', 'coin', 'index.js'), 'utf8').includes('{};');
        return [{ id: 'falcon-coin', ok: good, tools: good ? ['flip_coin'] : [], error: good ? undefined : 'SyntaxError' }];
      },
    },
  });
  repairs.start('Let me flip a coin', CHOICE, { agreed: true });
  const done = await until(repairs, ['ready', 'failed']);
  assert.equal(done.phase, 'ready', done.error);
  assert.equal(attempts.length, 2, 'one correction');
  assert.match(attempts[1], /The add-on falcon-coin does not load in the engine: SyntaxError/);
  assert.deepEqual(checked[0], ['coin'], 'only the add-on the repair touched is checked');
  assert.deepEqual(done.addons.map((a) => a.tools), [['flip_coin']]);
});

test('a change to the engine copy becomes a patch in Falcon, is checked, and gets one correction; a too-large one is refused', { skip, timeout: 120000 }, async () => {
  const { home, history } = pretendFalcon();
  const attempts = [];
  const checked = [];
  let made = null;
  const smallPatch = (word) => `diff --git a/dist/greeting.js b/dist/greeting.js\n--- a/dist/greeting.js\n+++ b/dist/greeting.js\n@@ -1 +1 @@\n-old\n+${word}\n`;
  const repairs = createRepairs({
    home, history, keys: async () => ({ openrouter: 'k' }), engineCli: () => null,
    write: async ({ dir, extra }) => {
      attempts.push(extra);
      fs.writeFileSync(path.join(dir, 'src', 'app', 'greeting.js'), "export const greeting = () => 'Hello, engine';\n");
      return { ok: true, said: 'Changed the engine greeting.' };
    },
    review: async ({ diff }) => ({ ok: /engine-patches/.test(diff), problems: [] }),
    check: {
      engineCopy: async ({ dir }) => { made = dir; return { ok: true }; },
      patchFrom: async () => smallPatch(attempts.length === 1 ? 'broken' : 'fixed'),
      enginePatch: async ({ file }) => {
        const text = fs.readFileSync(file, 'utf8');
        checked.push(text);
        return /fixed/.test(text) ? { ok: true } : { ok: false, error: 'The engine copy stopped: SyntaxError' };
      },
    },
  });
  repairs.start('Change how the engine greets', CHOICE, { agreed: true });
  const done = await until(repairs, ['ready', 'failed']);
  assert.equal(done.phase, 'ready', done.error);
  assert.ok(made, 'an engine copy was asked for');
  assert.match(attempts[0], /A copy of the engine that Falcon runs on is in the folder \.engine-copy/);
  assert.match(attempts[1], /The change to the engine cannot be used: The engine copy stopped: SyntaxError/);
  assert.equal(checked.length, 2);
  assert.ok(done.diff.some((f) => f.file === `falcon-agent/engine-patches/${done.id}.patch`), 'the patch is part of the change');
  assert.equal(done.enginePatch.ok, true);
  repairs.refuse();

  const big = createRepairs({
    home, history, keys: async () => ({ openrouter: 'k' }), engineCli: () => null,
    write: async ({ dir }) => { fs.writeFileSync(path.join(dir, 'src', 'app', 'greeting.js'), "export const greeting = () => 'Hello, big';\n"); return { ok: true }; },
    review: async () => ({ ok: true, problems: [] }),
    check: {
      engineCopy: async () => ({ ok: true }),
      patchFrom: async () => `diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,300 +1,300 @@\n${'-a\n+b\n'.repeat(150)}`,
      enginePatch: async () => { throw new Error('a too-large patch must not be started'); },
    },
  });
  big.start('Rewrite the engine', CHOICE, { agreed: true });
  const refused = await until(big, ['ready', 'failed']);
  assert.equal(refused.phase, 'failed');
  assert.match(refused.error, /changes 300 lines of the engine; at most 200 are permitted/);
});

test('Codex is installed once: a repair started during the background install waits for it', async () => {
  const { codexState, ensureCodex } = await import('../src/app/repair.js');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-codex-'));
  let installs = 0;
  let finish;
  const run = async (command, args) => {
    installs += 1;
    await new Promise((resolve) => { finish = resolve; });
    const prefix = args[args.indexOf('--prefix') + 1];
    const bin = path.join(prefix, 'node_modules', '@openai', 'codex', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'codex.js'), '');
    return { code: 0, out: '' };
  };
  assert.equal(codexState(home), 'missing');
  const background = ensureCodex({ home, run });
  const lines = [];
  const repair = ensureCodex({ home, run, onLine: (l) => lines.push(l) });
  assert.equal(codexState(home), 'installing');
  assert.match(lines.join(), /Waiting for the coding tool \(Codex\)/);
  await sleep(50);
  finish();
  assert.deepEqual([(await background).ok, (await repair).ok], [true, true]);
  assert.equal(installs, 1, 'installed once');
  assert.equal(codexState(home), 'ready');
  assert.equal((await ensureCodex({ home, run })).ok, true);
  assert.equal(installs, 1, 'not again once it is there');
  fs.rmSync(home, { recursive: true, force: true });
});

test('the real cost: worked out from the text used and the published prices when nothing is billed', async () => {
  const { costOf, priceFor } = await import('../src/app/repair.js');
  const published = { data: [{ id: 'openai/gpt-6.1-terra', pricing: { prompt: '0.000001', completion: '0.000005', input_cache_read: '0.00000005', input_cache_write: '0.00000125' } }] };
  const fetchFn = async () => ({ json: async () => published });
  const price = await priceFor('gpt-6.1-terra', { fetchFn });
  assert.deepEqual(price, { input: 0.000001, output: 0.000005, cacheRead: 0.00000005, cacheWrite: 0.00000125 });
  assert.deepEqual(await priceFor('openrouter/openai/gpt-6.1-terra', { fetchFn }), price, 'the same model through OpenRouter');
  assert.equal(await priceFor('openai/unknown-model', { fetchFn }), null);
  // A real step of the engine: billed 0.13011505 US dollars.
  const cost = costOf({ input: 99, output: 4958, cacheRead: 1040471, cacheWrite: 42562 }, price);
  assert.ok(Math.abs(cost - 0.13011505) < 0.0002, String(cost));
  assert.equal(costOf({ input: 5 }, null), 0, 'no price, no guess');
});
