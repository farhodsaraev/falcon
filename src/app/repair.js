// Falcon repairs or extends himself when the owner asks in his window (self-repair plan, stage 3).
//
// One repair, start to finish:
//   1. A workshop copy of Falcon is made (workshop.js); the Falcon in use is not touched.
//   2. The writer changes the copy: Codex with an OpenAI key, or Falcon's engine with only an OpenRouter key.
//   3. Falcon's automatic tests run in the copy, and the copy must start.
//   4. A reviewer, a different AI model, reads the change. If it finds a problem, the writer gets one
//      chance to correct it, and the tests run again.
//   5. The result waits for the owner: Approve switches it in (with the watchdog's way back), Refuse
//      throws the copy away. Nothing is switched in without his yes.
// Every step is reported as it happens, for the Workshop window.
import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkWorkshopStarts, createWorkshop, removeWorkshop, runGit, saveWorkshop, switchToWorkshop, testWorkshop } from './workshop.js';
import { dropChange, recordChange } from './personal.js';
import { ADDONS_DIR, checkAddons } from './addons.js';

const WINDOWS = process.platform === 'win32';
export const CODEX_VERSION = '0.171.0';     // the version tried in the trial of 2026-11-20
const MAX_REQUEST = 2000;
const MAX_LOG = 400;

const falconDir = (home) => path.join(home, '.falcon');
export const toolsDir = (home = os.homedir()) => path.join(falconDir(home), 'tools');
const codexJs = (home) => path.join(toolsDir(home), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');

/** What a repair usually costs with this model, said plainly. */
export function estimate(choice) {
  const strong = /sol|sonnet|opus/i.test(String(choice?.model || ''));
  return strong
    ? { low: 0.5, high: 3, text: 'about 50 cents to 3 US dollars on your own key' }
    : { low: 0.2, high: 2, text: 'about 20 cents to 2 US dollars on your own key' };
}

/** Codex, installed into Falcon's own tools folder the first time it is needed (OpenAI key only). */
export async function ensureCodex({ home = os.homedir(), node = process.execPath, onLine = () => {}, run = runProgram } = {}) {
  if (fs.existsSync(codexJs(home))) return { ok: true, codex: codexJs(home) };
  const npm = path.join(path.dirname(node), WINDOWS ? 'npm.cmd' : 'npm');
  if (!fs.existsSync(npm)) return { ok: false, error: 'Node.js has no npm here, so Codex cannot be installed.' };
  fs.mkdirSync(toolsDir(home), { recursive: true });
  onLine('Installing the coding tool (Codex), once');
  const r = await run(WINDOWS ? 'cmd.exe' : npm, [...(WINDOWS ? ['/d', '/s', '/c', npm] : []), 'install', '--prefix', toolsDir(home), `@openai/codex@${CODEX_VERSION}`, '--no-audit', '--no-fund', '--loglevel=error'], { timeoutMs: 10 * 60000 });
  if (r.code !== 0 || !fs.existsSync(codexJs(home))) return { ok: false, error: `Codex could not be installed. ${String(r.out).trim().split('\n').slice(-2).join(' ')}` };
  return { ok: true, codex: codexJs(home) };
}

function runProgram(command, args, { cwd, env, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, env, windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, out: `${stdout || ''}${stderr || ''}` }));
  });
}

/** One of Codex's commands, in the owner's words. */
export function codexStep(command) {
  const c = String(command || '');
  const named = (c.match(/[\w.-]+\.(?:js|mjs|ps1|css|html|md|json)\b/) || [''])[0];
  if (/node(\.exe)?["']?\s+--test|npm (run )?test/i.test(c)) return 'Running the tests';
  if (/\b(rg|grep|Select-String|findstr)\b/i.test(c)) return 'Searching Falcon\'s code';
  if (/\b(Set-Content|Out-File|WriteAllText|apply_patch|writeFileSync|Add-Content)\b/i.test(c)) return named ? `Changing ${named}` : 'Changing a file';
  if (/\b(Get-Content|cat|type|ReadAllText|sed -n|head|tail)\b/i.test(c)) return named ? `Reading ${named}` : 'Reading a file';
  if (/\bgit\b/i.test(c)) return 'Checking the changes';
  if (/\b(ls|dir|Get-ChildItem|rg --files)\b/i.test(c)) return 'Looking through the folders';
  return 'Working on the code';
}

/** The change as files with their changed lines, for the window: [{ file, added, removed, lines: [[sign, text]] }]. */
export function readDiff(text, maxLines = 400) {
  const files = [];
  let current = null;
  let shown = 0;
  for (const line of String(text || '').split('\n')) {
    const header = /^diff --git a\/(.+?) b\//.exec(line);
    if (header) { current = { file: header[1], added: 0, removed: 0, lines: [] }; files.push(current); continue; }
    if (!current || /^(index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(line)) continue;
    const sign = line[0];
    if (sign === '@') { if (shown < maxLines) current.lines.push(['@', line.replace(/^@@[^@]*@@ ?/, '')]); continue; }
    if (sign === '+') current.added++;
    if (sign === '-') current.removed++;
    if ((sign === '+' || sign === '-' || sign === ' ') && shown < maxLines) { current.lines.push([sign, line.slice(1)]); shown++; }
  }
  return files;
}

/** The last whole JSON document in a program's output, which may print log lines (with braces) before it. */
export function lastJson(out) {
  const text = String(out || '');
  const end = text.lastIndexOf('}');
  if (end < 0) return null;
  for (let start = text.lastIndexOf('\n{', end); start >= 0; start = text.lastIndexOf('\n{', start - 1)) {
    try { return JSON.parse(text.slice(start + 1, end + 1)); } catch { /* an earlier brace */ }
  }
  try { return JSON.parse(text.slice(text.indexOf('{'), end + 1)); } catch { return null; }
}

function killTree(child) {
  if (!child?.pid) return;
  if (WINDOWS) execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } } }
}

const WRITER_PROMPT = (request, extra = '') => `You are improving Falcon, a personal assistant program. His code is in this folder.
The owner asked: "${request}"
Make the smallest change that does what he asked, in the style of the code around it.
Add or update a test in the test folder that shows it works, and run the tests with: node --test test/
Work only inside this folder. Do not install anything and do not use the network.
Never put a password, key, token or code into any file.
If what he asked needs a new tool for the AI, make it an add-on for the engine in its own folder under falcon-agent/addons/<short-name> (lowercase words joined by hyphens): an openclaw.plugin.json manifest that lists the tool in contracts.tools, a package.json whose openclaw.extensions names ./index.js, and an index.js that exports { id, name, description, register(api) } and calls api.registerTool({ name, description, parameters (a JSON schema), async execute(id, params) { return { content: [{ type: 'text', text }] }; } }). falcon-agent/engine-addon is a small working example of the folder and manifest. Add a test for the add-on's own logic in the test folder.${extra}
When you are done, reply with one or two plain sentences saying what you changed.`;

const REVIEW_PROMPT = (request, diff) => `You review a change to Falcon, a personal assistant program, before his owner decides on it.
The owner asked: "${request}"
The change, as a diff:
${diff.slice(0, 60000)}

Reply with JSON only, nothing else: {"ok": true or false, "problems": ["..."]}
A problem is something that makes the change wrong, unsafe, harmful to the owner's computer or data, or not what he asked. Style alone is not a problem. Write each problem in one plain sentence.`;

/**
 * The repairs of one Falcon. Dependencies are passed in so checks can use stand-ins.
 * @param {object} o
 * @param {Function} o.history       () => Promise<history> (openHistory, made after ensuring Git)
 * @param {Function} o.keys          () => Promise<{ openai?: string, openrouter?: string }>
 * @param {Function} o.engineCli     () => path of the engine's command-line program (index.js), or null
 * @param {Function} [o.onChange]    (status) => void, called on every change
 * @param {Function} [o.write]       stand-in for the writer: ({ dir, request, choice, extra, step, signal }) => Promise<{ ok, said?, error?, tokens? }>
 * @param {Function} [o.review]      stand-in for the reviewer: ({ request, diff, choice }) => Promise<{ ok, problems }>
 * @param {Function} [o.switchTo]    stand-in for switchToWorkshop
 */
export function createRepairs({ home = os.homedir(), node = process.execPath, history, keys, engineCli, onChange = () => {}, write, review, switchTo = switchToWorkshop, check: checks = {} }) {
  // The checks a change must pass; add-ons are loaded in a private copy of the engine (addons.js).
  const check = { test: testWorkshop, starts: checkWorkshopStarts, addons: ({ dir, only }) => checkAddons({ dir, cli: engineCli(), node, home, only }), ...checks };
  const recordDir = path.join(falconDir(home), 'repairs');
  let status = null;
  let child = null;
  let stopped = false;
  let historyNow = null;

  const save = () => {
    try { fs.mkdirSync(recordDir, { recursive: true }); fs.writeFileSync(path.join(recordDir, `${status.id}.json`), JSON.stringify(status, null, 2)); } catch { /* the window still has it */ }
    try { onChange(status); } catch { /* display only */ }
  };
  const phase = (name, text) => { status.phase = name; if (text) step(text); else save(); };
  const step = (text) => {
    const last = status.steps.at(-1);
    if (last && last.text === text && !last.done) return;
    if (last && !last.done) last.done = Date.now();
    status.steps.push({ text, at: Date.now() });
    save();
  };
  const log = (line) => { status.log.push(String(line).slice(0, 2000)); if (status.log.length > MAX_LOG) status.log.splice(0, status.log.length - MAX_LOG); };
  const finish = (name, extra = {}) => {
    const last = status.steps.at(-1);
    if (last && !last.done) last.done = Date.now();
    Object.assign(status, { phase: name, endedAt: Date.now() }, extra);
    save();
  };

  // ---- The writers ----
  function runStreaming(command, args, { cwd, env, onLine, timeoutMs = 25 * 60000 }) {
    return new Promise((resolve) => {
      child = spawn(command, args, { cwd, env, windowsHide: true, detached: !WINDOWS });
      let out = '';
      let tail = '';
      const take = (chunk) => {
        out += chunk;
        if (out.length > 4e6) out = out.slice(-2e6);
        const lines = (tail + chunk).split(/\r?\n/);
        tail = lines.pop();
        for (const line of lines) { try { onLine(line); } catch { /* display only */ } }
      };
      const timer = setTimeout(() => killTree(child), timeoutMs);
      child.stdout.on('data', (c) => take(String(c)));
      child.stderr.on('data', (c) => take(String(c)));
      child.on('error', (err) => { clearTimeout(timer); child = null; resolve({ code: -1, out: err.message }); });
      child.on('close', (code) => { clearTimeout(timer); child = null; resolve({ code: code ?? -1, out }); });
      child.stdin.end();
    });
  }

  async function writeWithCodex({ dir, request, choice, extra }) {
    const k = await keys();
    if (!k.openai) return { ok: false, error: 'There is no OpenAI key for Codex.' };
    const codex = await ensureCodex({ home, node, onLine: step });
    if (!codex.ok) return codex;
    const codexHome = path.join(falconDir(home), 'codex-home');
    fs.mkdirSync(codexHome, { recursive: true });
    const env = { ...process.env, CODEX_HOME: codexHome, CODEX_API_KEY: k.openai, OPENAI_API_KEY: k.openai, NODE_NO_WARNINGS: '1' };
    delete env.NODE_TEST_CONTEXT;
    let said = '';
    const tokens = { input: 0, output: 0 };
    const result = await runStreaming(node, [codex.codex, 'exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write', '-c', 'windows.sandbox="unelevated"', '-m', choice.model, '-C', dir, WRITER_PROMPT(request, extra)], {
      cwd: dir, env,
      onLine: (line) => {
        if (!line.startsWith('{')) { if (line.trim()) log(line.split(k.openai).join('***')); return; }
        let e; try { e = JSON.parse(line); } catch { return; }
        log(line.split(k.openai).join('***').slice(0, 2000));
        if (e.type === 'item.started' && e.item?.type === 'command_execution') step(codexStep(e.item.command));
        if (e.type === 'item.completed' && e.item?.type === 'agent_message') said = String(e.item.text || '');
        if (e.type === 'turn.completed' && e.usage) { tokens.input += Number(e.usage.input_tokens || 0); tokens.output += Number(e.usage.output_tokens || 0); }
      },
    });
    if (stopped) return { ok: false, error: 'Stopped.' };
    return result.code === 0 ? { ok: true, said, tokens } : { ok: false, error: `Codex stopped with an error. ${result.out.split(k.openai).join('***').trim().split('\n').slice(-2).join(' ')}`.slice(0, 600), tokens };
  }

  // The engine's own coding part, in a private settings folder of its own, with the key given only to it.
  async function engineTurn({ dir, prompt, model, provider, timeoutS = 1500 }) {
    const k = await keys();
    const key = provider === 'openai' ? k.openai : k.openrouter;
    const cli = engineCli();
    if (!key) return { ok: false, error: `There is no ${provider === 'openai' ? 'OpenAI' : 'OpenRouter'} key.` };
    if (!cli) return { ok: false, error: 'The engine is not installed.' };
    const state = path.join(falconDir(home), 'repair-engine');
    fs.mkdirSync(state, { recursive: true });
    const env = { ...process.env, NODE_NO_WARNINGS: '1', [provider === 'openai' ? 'OPENAI_API_KEY' : 'OPENROUTER_API_KEY']: key };
    for (const name of ['OPENCLAW_STATE_DIR', 'OPENCLAW_CONFIG_PATH', 'OPENCLAW_PROFILE', 'OPENCLAW_HOME', 'NODE_TEST_CONTEXT']) delete env[name];
    // A new settings folder knows no models until it has looked them up once (seen in the trial).
    const marker = path.join(state, `models-${provider}.done`);
    if (!fs.existsSync(marker)) {
      await runProgram(node, [cli, 'models', 'list', '--refresh', '--provider', provider], { cwd: state, env: { ...env, OPENCLAW_STATE_DIR: state }, timeoutMs: 180000 });
      try { fs.writeFileSync(marker, new Date().toISOString()); } catch { /* looked up again next time */ }
    }
    const result = await runStreaming(node, [cli, 'agent', 'exec', '--isolated', '--auth-env-only', '--state-dir', state, '--cwd', dir, '--model', model, '--json', '--timeout', String(timeoutS), prompt], {
      cwd: dir, env, onLine: (line) => { if (line.trim()) log(line.split(key).join('***')); },
    });
    if (stopped) return { ok: false, error: 'Stopped.' };
    const doc = lastJson(result.out);
    const said = String(doc?.final || (doc?.payloads || []).map((p) => p.text).join(' ') || '').trim();
    // The engine reports what the provider billed for this turn.
    const cost = Number(doc?.usage?.cost?.total) || 0;
    return doc?.ok !== false && result.code === 0 ? { ok: true, said, cost } : { ok: false, cost, error: `The engine stopped with an error. ${String(doc?.error?.message || result.out.split(key).join('***').trim().split('\n').pop())}`.slice(0, 600) };
  }

  async function writeWithEngine({ dir, request, choice, extra }) {
    step('Falcon\'s engine is working on the change');
    return engineTurn({ dir, prompt: WRITER_PROMPT(request, extra), model: `${choice.provider}/${choice.model}`, provider: choice.provider });
  }

  // The reviewer: a different model from the writer, through Falcon's engine.
  async function reviewWithEngine({ request, diff, choice }) {
    const k = await keys();
    let provider; let model;
    if (k.openrouter) { provider = 'openrouter'; model = /haiku/i.test(choice.model) ? 'openrouter/openai/gpt-6.1-terra' : 'openrouter/anthropic/claude-haiku-5.5'; }
    else if (k.openai) { provider = 'openai'; model = /sol/i.test(choice.model) ? 'openai/gpt-6.1-terra' : 'openai/gpt-6.1-sol'; }
    else return { ok: true, problems: [], skipped: 'no key for a second opinion' };
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-review-'));
    try {
      const r = await engineTurn({ dir: empty, prompt: REVIEW_PROMPT(request, diff), model, provider, timeoutS: 600 });
      if (!r.ok) return { ok: true, problems: [], skipped: r.error, cost: r.cost };
      const found = JSON.parse(r.said.slice(r.said.indexOf('{'), r.said.lastIndexOf('}') + 1));
      return { ok: found.ok !== false, problems: (Array.isArray(found.problems) ? found.problems : []).map(String).slice(0, 8), model: model.split('/').pop(), cost: r.cost };
    } catch {
      return { ok: true, problems: [], skipped: 'the second opinion could not be read' };
    } finally { fs.rmSync(empty, { recursive: true, force: true }); }
  }

  const writer = write || ((args) => (args.choice.provider === 'openai' ? writeWithCodex(args) : writeWithEngine(args)));
  const reviewer = review || reviewWithEngine;

  async function checkCopy(dir) {
    phase('testing', 'Running Falcon\'s tests in the workshop');
    const tests = await check.test({ dir, node });
    status.tests = tests;
    step(tests.ok ? `All ${tests.pass} tests pass` : `${tests.fail} of ${tests.tests} tests fail`);
    if (!tests.ok) return false;
    step('Checking that this copy of Falcon starts');
    const starts = await check.starts({ dir, node });
    status.starts = starts.ok;
    if (!starts.ok) { step('This copy does not start'); return false; }
    // An add-on made or changed here must load in the engine, with the tools it promises.
    const touched = (await runGit(historyNow.git, ['diff', '--name-only', status.base, 'HEAD'], { cwd: dir })).out.split('\n')
      .map((f) => f.trim().replace(/\\/g, '/')).filter((f) => f.startsWith(`${ADDONS_DIR.replace(/\\/g, '/')}/`)).map((f) => f.split('/')[2]).filter(Boolean);
    if (touched.length) {
      step('Loading the new add-on in a private copy of the engine');
      const loaded = await check.addons({ dir, only: [...new Set(touched)] });
      status.addons = loaded;
      const bad = loaded.filter((a) => !a.ok);
      step(bad.length ? `The add-on ${bad[0].id} does not load` : `The add-on loads, with ${loaded.flatMap((a) => a.tools || []).length || 'no'} new tools`);
      if (bad.length) return false;
    }
    return true;
  }

  async function diffOf(dir) {
    const h = historyNow;
    const r = await runGit(h.git, ['diff', '--no-color', '--no-ext-diff', status.base, 'HEAD'], { cwd: dir });
    return r.out;
  }

  // What the AI companies billed so far, where the tool reports it (Falcon's engine does; Codex does not).
  const addCost = (r) => { if (Number(r?.cost) > 0) { status.cost = (status.cost || 0) + Number(r.cost); save(); } };

  async function run(request, choice, context = '') {
    const id = status.id;
    try {
      phase('preparing', 'Making a separate workshop copy of Falcon');
      historyNow = await history();
      const ws = await createWorkshop({ history: historyNow, id, home });
      status.dir = ws.dir;
      status.base = ws.base;
      if (stopped) return finish('stopped');

      phase('writing', choice.provider === 'openai' ? 'Codex is reading Falcon\'s code' : 'Reading Falcon\'s code');
      // Adapting an earlier change of the owner's to a newer Falcon: the writer sees that change.
      const earlier = context ? `\nThe owner made this change for an older version of Falcon; make the same change work in this version:\n${context}` : '';
      let written = await writer({ dir: ws.dir, request, choice, extra: earlier, step, log });
      addCost(written);
      if (stopped) return finish('stopped');
      if (!written.ok) return finish('failed', { error: written.error });
      status.said = written.said || '';
      if (!await saveWorkshop({ git: historyNow.git, dir: ws.dir, message: `Repair: ${request}`.slice(0, 200) })) return finish('failed', { error: 'The writer changed nothing.' });
      let good = await checkCopy(ws.dir);
      status.diff = readDiff(await diffOf(ws.dir));
      if (stopped) return finish('stopped');

      phase('reviewing', 'A second AI model is reviewing the change');
      let opinion = await reviewer({ request, diff: await diffOf(ws.dir), choice });
      addCost(opinion);
      status.review = opinion;
      if (stopped) return finish('stopped');
      // One chance to correct: failing tests, a copy that does not start, or problems the reviewer found.
      if (!good || !opinion.ok) {
        const reasons = [
          ...(!status.tests?.ok ? [`These tests fail: ${(status.tests?.failing || []).slice(0, 5).join('; ') || 'see the test output'}.`] : []),
          ...(status.tests?.ok && status.starts === false ? ['Falcon does not start with this change.'] : []),
          ...((status.addons || []).filter((a) => !a.ok).map((a) => `The add-on ${a.id} does not load in the engine: ${a.error}`)),
          ...(opinion.ok ? [] : opinion.problems.map((p) => `A reviewer found: ${p}`)),
        ];
        phase('fixing', 'Correcting what was found');
        written = await writer({ dir: ws.dir, request, choice, extra: `\nYour first attempt is already in the folder. Correct it:\n- ${reasons.join('\n- ')}`, step, log });
        addCost(written);
        if (stopped) return finish('stopped');
        if (!written.ok) return finish('failed', { error: written.error });
        if (written.said) status.said = written.said;
        await saveWorkshop({ git: historyNow.git, dir: ws.dir, message: `Repair, corrected: ${request}`.slice(0, 200) });
        good = await checkCopy(ws.dir);
        status.diff = readDiff(await diffOf(ws.dir));
        if (good) {
          phase('reviewing', 'The second AI model is reviewing the correction');
          opinion = await reviewer({ request, diff: await diffOf(ws.dir), choice });
          addCost(opinion);
          status.review = opinion;
        }
      }
      if (stopped) return finish('stopped');
      if (!good) {
        const addonBad = (status.addons || []).find((a) => !a.ok);
        return finish('failed', { error: !status.tests?.ok ? 'Falcon\'s tests still fail with this change, so it cannot be used.'
          : status.starts === false ? 'This copy of Falcon does not start, so it cannot be used.'
            : `The add-on ${addonBad?.id || ''} does not load in the engine, so it cannot be used: ${addonBad?.error || ''}`.trim() });
      }
      finish('ready', { error: opinion.ok ? '' : 'The reviewer still has doubts: read them before you decide.' });
    } catch (err) {
      finish(stopped ? 'stopped' : 'failed', { error: String(err.message || err).slice(0, 600) });
    }
  }

  return {
    estimate,
    status: () => status,
    busy: () => Boolean(status && ['preparing', 'writing', 'testing', 'reviewing', 'fixing', 'switching'].includes(status.phase)),

    /** Starts a repair. The owner has seen the estimate (`agreed`). */
    start(request, choice, { agreed = false, context = '', replaces = '' } = {}) {
      const text = String(request || '').replace(/\s+/g, ' ').trim();
      if (!text) return { ok: false, error: 'Say what Falcon should fix or add.' };
      if (text.length > MAX_REQUEST) return { ok: false, error: 'Please say it in fewer words.' };
      if (!choice) return { ok: false, error: 'Falcon needs an OpenAI or OpenRouter key for coding. Add one in Settings, AI key.' };
      if (!agreed) return { ok: false, error: 'Please agree to the estimated cost first.' };
      if (this.busy()) return { ok: false, error: 'A repair is already in progress.' };
      if (status?.phase === 'ready') return { ok: false, error: 'A finished repair is waiting for your decision. Approve or refuse it first.' };
      stopped = false;
      const id = `repair-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString('hex')}`;
      status = { id, request: text, model: choice.label, provider: choice.provider, tool: choice.tool, estimate: estimate(choice).text, phase: 'preparing', steps: [], log: [], diff: [], startedAt: Date.now(), replaces: String(replaces || '') };
      context = String(context || '').slice(0, 60000);
      save();
      run(text, choice, context);
      return { ok: true, id };
    },

    stop() {
      if (!this.busy()) return { ok: false, error: 'Nothing is in progress.' };
      stopped = true;
      killTree(child);
      if (status.dir) removeWorkshop({ id: status.id, home });
      finish('stopped');
      return { ok: true };
    },

    /** The owner's yes: switch the change in. The watchdog starts the new Falcon and goes back if he does not start. */
    async approve({ oldPid = process.pid } = {}) {
      if (status?.phase !== 'ready') return { ok: false, error: 'There is no finished repair to approve.' };
      phase('switching', 'Switching to the new version of Falcon');
      const r = await switchTo({ history: historyNow, id: status.id, home, oldPid });
      if (!r.ok) { finish('ready', { error: r.error }); return r; }
      finish('approved', { switched: r.commit });
      // Kept as one of the owner's own changes, so updates do not lose it (personal.js).
      try {
        await recordChange({ history: historyNow, base: status.base, commit: r.commit, title: status.request, home });
        if (status.replaces) dropChange(status.replaces, home);
      } catch { /* the change is in place; it is only not listed */ }
      return { ok: true };
    },

    refuse() {
      if (status?.phase !== 'ready' && status?.phase !== 'failed') return { ok: false, error: 'There is nothing to refuse.' };
      if (status.dir) removeWorkshop({ id: status.id, home });
      finish('refused');
      return { ok: true };
    },
  };
}
