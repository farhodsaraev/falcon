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
import { COPY_DIR, PATCHES_DIR, checkEngineCopyStarts, makeEngineCopy, patchFromCopy, patchSize, patchState, removeEngineCopy } from './enginepatch.js';
import { findGit } from './git.js';

// A personal patch to the engine's own files must stay small (plan section 6).
export const MAX_PATCH_LINES = 200;

const WINDOWS = process.platform === 'win32';
export const CODEX_VERSION = '0.171.0';     // the version tried in the trial of 2026-11-20
const MAX_REQUEST = 2000;
const MAX_LOG = 400;

const falconDir = (home) => path.join(home, '.falcon');
export const toolsDir = (home = os.homedir()) => path.join(falconDir(home), 'tools');
const codexJs = (home) => path.join(toolsDir(home), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');

// ---- What a repair really cost ----
// The provider reports what it billed when it can. It reports 0 when the owner's own OpenAI key pays through
// OpenRouter (BYOK), and Codex reports nothing at all. Then the cost is worked out from the text each step
// used and the prices OpenRouter publishes for every model (OpenAI's own prices too). Tried on a real repair:
// 13.0 cents worked out against 13.01 cents billed.
const PRICES_URL = 'https://openrouter.ai/api/v1/models';
let priceList = null;
export async function priceFor(model, { fetchFn = fetch } = {}) {
  const id = String(model || '').replace(/^openrouter\//, '');
  const wanted = id.includes('/') ? id : `openai/${id}`;
  try {
    priceList ??= fetchFn(PRICES_URL, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).then((j) => j.data || []);
    const found = (await priceList).find((m) => m.id === wanted);
    if (!found?.pricing) return null;
    const p = found.pricing;
    return { input: Number(p.prompt) || 0, output: Number(p.completion) || 0, cacheRead: Number(p.input_cache_read ?? p.prompt) || 0, cacheWrite: Number(p.input_cache_write ?? p.prompt) || 0 };
  } catch { priceList = null; return null; }
}
/** US dollars for some use of a model: { input (fresh), output, cacheRead, cacheWrite } tokens at those prices. */
export function costOf(use, price) {
  if (!price) return 0;
  return (use.input || 0) * price.input + (use.output || 0) * price.output + (use.cacheRead || 0) * price.cacheRead + (use.cacheWrite || 0) * price.cacheWrite;
}

// What Codex says when its commands could not run (the protected command runner was blocked).
const CODEX_BLOCKED = /command (service|runner)[^.]{0,40}(did not|didn.t) respond|could(n.t| not) (inspect|run|execute)[^.]{0,60}(command|shell|test)/i;

/** What a repair usually costs with this model, said plainly. */
export function estimate(choice) {
  const strong = /sol|sonnet|opus/i.test(String(choice?.model || ''));
  return strong
    ? { low: 0.5, high: 3, text: 'about 50 cents to 3 US dollars on your own key' }
    : { low: 0.2, high: 2, text: 'about 20 cents to 2 US dollars on your own key' };
}

// One install at a time per Falcon: a repair started during the background install waits for it.
const installing = new Map();

/** Whether Codex is ready, being installed, or not there: 'ready' | 'installing' | 'missing'. */
export function codexState(home = os.homedir()) {
  if (fs.existsSync(codexJs(home))) return 'ready';
  return installing.has(path.resolve(home)) ? 'installing' : 'missing';
}

/**
 * Codex, installed into Falcon's own tools folder (OpenAI key only). It is about 500 MB, so it is not part
 * of Falcon's download: Falcon installs it in the background as soon as an OpenAI key is there, and a
 * repair that comes first installs it, or waits for the install already running.
 */
export function ensureCodex({ home = os.homedir(), node = process.execPath, onLine = () => {}, run = runProgram } = {}) {
  if (fs.existsSync(codexJs(home))) return Promise.resolve({ ok: true, codex: codexJs(home) });
  const key = path.resolve(home);
  if (installing.has(key)) { onLine('Waiting for the coding tool (Codex) to finish installing'); return installing.get(key); }
  const job = installCodex({ home, node, onLine, run }).finally(() => installing.delete(key));
  installing.set(key, job);
  return job;
}

async function installCodex({ home, node, onLine, run }) {
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

const ENGINE_NOTE = `\nA copy of the engine that Falcon runs on is in the folder ${COPY_DIR}. Change it only if settings, a skill or an add-on cannot do what he asked, and keep that change small (at most ${MAX_PATCH_LINES} changed lines). Falcon turns your change there into a patch for the real engine. Never change ${COPY_DIR}/node_modules.`;

const WRITER_PROMPT = (request, extra = '') => `You are improving Falcon, a personal assistant program. His code is in this folder.
The owner asked: "${request}"
Make the smallest change that does what he asked, in the style of the code around it.
Add or update a test in the test folder that shows it works, and run the tests with: node --test test/
Work only inside this folder. Do not install anything and do not use the network.
Never put a password, key, token or code into any file.
If what he asked needs a new tool for the AI, make it an add-on for the engine in its own folder under falcon-agent/addons/<short-name> (lowercase words joined by hyphens): an openclaw.plugin.json manifest that lists the tool in contracts.tools, a package.json whose openclaw.extensions names ./index.js, and an index.js that exports { id, name, description, register(api) } and calls api.registerTool({ name, description, parameters (a JSON schema), async execute(id, params) { return { content: [{ type: 'text', text }] }; } }). falcon-agent/engine-addon is a small working example of the folder and manifest. Add a test for the add-on's own logic in the test folder. Falcon's setup already copies and loads every add-on in falcon-agent/addons by itself: do not change falcon-agent/install-falcon.mjs or its tests for an add-on.${extra}
When you are done, reply with one or two plain sentences saying what you changed.`;

const REVIEW_PROMPT = (request, diff) => `You review a change to Falcon, a personal assistant program, before his owner decides on it.
The owner asked: "${request}"
Facts about Falcon that the diff does not show: his setup copies and loads every add-on folder in falcon-agent/addons by itself, and puts every patch in falcon-agent/engine-patches into the engine by itself, at each start and after each engine update. Falcon's own checks already ran: all tests pass, this copy starts, and each add-on loads in the engine.
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
  // The engine's package folder (the command-line program is <package>/dist/index.js).
  const enginePackage = () => { const cli = engineCli(); return cli ? path.resolve(path.dirname(cli), '..') : null; };
  const check = {
    test: testWorkshop,
    starts: checkWorkshopStarts,
    addons: ({ dir, only }) => checkAddons({ dir, cli: engineCli(), node, home, only }),
    // A second copy of the engine for changes only its own files can make (enginepatch.js).
    engineCopy: async ({ dir }) => (enginePackage() ? makeEngineCopy({ engineDir: enginePackage(), dir }) : { ok: false, error: 'the engine is not installed here' }),
    patchFrom: ({ dir }) => patchFromCopy({ git: historyNow?.git || findGit({ home }), dir, home }),
    // The patch must fit the engine in use, and the engine copy with the change must start and answer.
    enginePatch: async ({ dir, file }) => {
      const engineDir = enginePackage();
      if (!engineDir) return { ok: false, error: 'the engine is not installed here' };
      const fits = await patchState({ git: historyNow?.git || findGit({ home }), engineDir, file });
      if (fits === 'no-fit') return { ok: false, error: 'it does not fit the engine that is installed' };
      const copy = path.join(dir, COPY_DIR);
      if (!fs.existsSync(copy)) return { ok: true };
      const started = await checkEngineCopyStarts({ copy, node, home });
      return started.ok ? { ok: true, ms: started.ms } : { ok: false, error: started.error };
    },
    ...checks,
  };
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
  function runStreaming(command, args, { cwd, env, onLine, timeoutMs = 25 * 60000, idleMs = 0 }) {
    return new Promise((resolve) => {
      child = spawn(command, args, { cwd, env, windowsHide: true, detached: !WINDOWS });
      let out = '';
      let tail = '';
      let heard = Date.now();
      let silent = false;
      const quiet = idleMs ? setInterval(() => { if (Date.now() - heard > idleMs) { silent = true; killTree(child); } }, 5000) : null;
      const take = (chunk) => {
        heard = Date.now();
        out += chunk;
        if (out.length > 4e6) out = out.slice(-2e6);
        const lines = (tail + chunk).split(/\r?\n/);
        tail = lines.pop();
        for (const line of lines) { try { onLine(line); } catch { /* display only */ } }
      };
      const timer = setTimeout(() => killTree(child), timeoutMs);
      child.stdout.on('data', (c) => take(String(c)));
      child.stderr.on('data', (c) => take(String(c)));
      child.on('error', (err) => { clearTimeout(timer); clearInterval(quiet); child = null; resolve({ code: -1, out: err.message }); });
      child.on('close', (code) => { clearTimeout(timer); clearInterval(quiet); child = null; resolve({ code: code ?? -1, out, silent }); });
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
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const result = await runStreaming(node, [codex.codex, 'exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write', '-c', 'windows.sandbox="unelevated"', '-m', choice.model, '-C', dir, WRITER_PROMPT(request, extra)], {
      cwd: dir, env, idleMs: 4 * 60000,   // blocked commands left Codex silent for 12 minutes
      onLine: (line) => {
        if (!line.startsWith('{')) { if (line.trim()) log(line.split(k.openai).join('***')); return; }
        let e; try { e = JSON.parse(line); } catch { return; }
        log(line.split(k.openai).join('***').slice(0, 2000));
        if (e.type === 'item.started' && e.item?.type === 'command_execution') step(codexStep(e.item.command));
        if (e.type === 'item.completed' && e.item?.type === 'agent_message') {
          said = String(e.item.text || '');
          // What Codex says it is doing, as a step, so a stall shows at once instead of a clock that runs on.
          const words = said.replace(/\s+/g, ' ').trim();
          if (words) step(`Codex: ${words.length > 110 ? `${words.slice(0, 107)}…` : words}`);
        }
        if (e.type === 'turn.completed' && e.usage) {
          // input_tokens counts the cached and newly cached parts too; they are billed at their own prices.
          const read = Number(e.usage.cached_input_tokens || 0);
          const write = Number(e.usage.cache_write_input_tokens || 0);
          tokens.input += Math.max(0, Number(e.usage.input_tokens || 0) - read - write);
          tokens.cacheRead += read;
          tokens.cacheWrite += write;
          tokens.output += Number(e.usage.output_tokens || 0);
        }
      },
    });
    // Codex does not say what it cost: worked out from its use of text and the published prices.
    const cost = costOf(tokens, await priceFor(choice.model));
    // Seen on a real PC (2026-11-21): Codex's protected commands hung and failed, so it could not read or
    // change anything. Then Falcon's engine does the work instead, with the same OpenAI key.
    if (!stopped && (result.silent || CODEX_BLOCKED.test(said))) return { ok: false, blocked: true, cost, estimated: true, said };
    if (stopped) return { ok: false, error: 'Stopped.', cost, estimated: true };
    return result.code === 0 ? { ok: true, said, tokens, cost, estimated: true } : { ok: false, cost, estimated: true, error: `Codex stopped with an error. ${result.out.split(k.openai).join('***').trim().split('\n').slice(-2).join(' ')}`.slice(0, 600), tokens };
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
    // The engine reports what the provider billed for this turn; 0 when the owner's own key paid (BYOK).
    let cost = Number(doc?.usage?.cost?.total) || 0;
    let estimated = false;
    const use = doc?.usage;
    if (!cost && use && (use.input || use.output || use.cacheRead)) {
      cost = costOf({ input: use.input, output: use.output, cacheRead: use.cacheRead, cacheWrite: use.cacheWrite }, await priceFor(model));
      estimated = cost > 0;
    }
    // OpenRouter checks the most a request could cost against the key's own spending limit, even when the
    // owner's OpenAI key pays (BYOK). Coding sends large requests, so a nearly used-up limit refuses them.
    if (provider === 'openrouter' && /status=402|billing error|can only afford|key's total limit/i.test(result.out)) {
      return { ok: false, cost, estimated, error: 'OpenRouter refused the work: your OpenRouter account or this key\'s spending limit is too low for coding. On openrouter.ai, add credit or raise the key\'s limit (with your own OpenAI key connected there, OpenAI still pays for the work), then try again.' };
    }
    return doc?.ok !== false && result.code === 0 ? { ok: true, said, cost, estimated } : { ok: false, cost, estimated, error: `The engine stopped with an error. ${String(doc?.error?.message || result.out.split(key).join('***').trim().split('\n').pop())}`.slice(0, 600) };
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

  // Codex for an OpenAI key, unless its commands are blocked on this computer; then Falcon's engine, which
  // takes the same key. Remembered until Falcon installs another Codex version.
  const blockedFile = path.join(falconDir(home), 'codex-blocked.json');
  const codexBlocked = () => { try { return JSON.parse(fs.readFileSync(blockedFile, 'utf8')).version === CODEX_VERSION; } catch { return false; } };
  const useEngine = (args) => { status.tool = 'Falcon\'s engine'; save(); return writeWithEngine({ ...args, choice: { ...args.choice, tool: 'Falcon\'s engine' } }); };
  const writer = write || (async (args) => {
    if (args.choice.provider !== 'openai') return writeWithEngine(args);
    if (codexBlocked()) return useEngine(args);
    const r = await writeWithCodex(args);
    if (!r.blocked) return r;
    try { fs.writeFileSync(blockedFile, JSON.stringify({ version: CODEX_VERSION, at: new Date().toISOString(), said: String(r.said || '').slice(0, 300) })); } catch { /* tried again next time */ }
    addCost(r);
    step('Codex could not run commands on this computer, so Falcon\'s engine is doing the work with the same OpenAI key');
    return useEngine(args);
  });
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
    // A patch to the engine's own files: small, fits the engine in use, and the changed engine starts.
    status.enginePatch = null;
    const patchFile = path.join(dir, PATCHES_DIR, `${status.id}.patch`);
    if (fs.existsSync(patchFile)) {
      const lines = patchSize(fs.readFileSync(patchFile, 'utf8'));
      if (lines > MAX_PATCH_LINES) {
        status.enginePatch = { ok: false, lines, error: `it changes ${lines} lines of the engine; at most ${MAX_PATCH_LINES} are permitted` };
        step('The change to the engine is too large');
        return false;
      }
      step('Starting a second copy of the engine with the change, beside the one in use');
      const r = await check.enginePatch({ dir, file: patchFile });
      status.enginePatch = { lines, ...r };
      step(r.ok ? 'The changed engine starts and answers' : 'The changed engine does not work');
      if (!r.ok) return false;
    }
    return true;
  }

  // The writer's change to the engine copy becomes falcon-agent/engine-patches/<repair>.patch.
  async function capturePatch(dir) {
    if (!status.engineCopy) return;
    const patch = await check.patchFrom({ dir });
    const file = path.join(dir, PATCHES_DIR, `${status.id}.patch`);
    if (patch.trim()) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, patch.endsWith('\n') ? patch : `${patch}\n`);
      step(`Made a patch for the engine (${patchSize(patch)} changed lines)`);
    } else fs.rmSync(file, { force: true });
  }

  async function diffOf(dir) {
    const h = historyNow;
    const r = await runGit(h.git, ['diff', '--no-color', '--no-ext-diff', status.base, 'HEAD'], { cwd: dir });
    return r.out;
  }

  // What the AI companies billed so far, where the tool reports it (Falcon's engine does; Codex does not).
  // A cost worked out from prices (not billed) makes the total "about".
  const addCost = (r) => { if (Number(r?.cost) > 0) { status.cost = (status.cost || 0) + Number(r.cost); if (r.estimated) status.costEstimated = true; save(); } };

  async function run(request, choice, context = '') {
    const id = status.id;
    try {
      phase('preparing', 'Making a separate workshop copy of Falcon');
      historyNow = await history();
      const ws = await createWorkshop({ history: historyNow, id, home });
      status.dir = ws.dir;
      status.base = ws.base;
      if (stopped) return finish('stopped');
      step('Making a second copy of the engine, for changes that only its own files can make');
      const copy = await check.engineCopy({ dir: ws.dir });
      status.engineCopy = Boolean(copy.ok);
      if (!copy.ok) log(`No engine copy: ${copy.error}`);
      if (stopped) return finish('stopped');

      phase('writing', choice.provider === 'openai' ? 'Codex is reading Falcon\'s code' : 'Reading Falcon\'s code');
      // Adapting an earlier change of the owner's to a newer Falcon: the writer sees that change.
      const earlier = context ? `\nThe owner made this change for an older version of Falcon; make the same change work in this version:\n${context}` : '';
      const engineNote = status.engineCopy ? ENGINE_NOTE : '';
      let written = await writer({ dir: ws.dir, request, choice, extra: earlier + engineNote, step, log });
      addCost(written);
      if (stopped) return finish('stopped');
      if (!written.ok) return finish('failed', { error: written.error });
      status.said = written.said || '';
      await capturePatch(ws.dir);
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
          ...(status.enginePatch && !status.enginePatch.ok ? [`The change to the engine cannot be used: ${status.enginePatch.error}.`] : []),
          ...(opinion.ok ? [] : opinion.problems.map((p) => `A reviewer found: ${p}`)),
        ];
        phase('fixing', 'Correcting what was found');
        written = await writer({ dir: ws.dir, request, choice, extra: `${engineNote}\nYour first attempt is already in the folder. Correct it:\n- ${reasons.join('\n- ')}`, step, log });
        addCost(written);
        if (stopped) return finish('stopped');
        if (!written.ok) return finish('failed', { error: written.error });
        if (written.said) status.said = written.said;
        await capturePatch(ws.dir);
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
            : addonBad ? `The add-on ${addonBad.id} does not load in the engine, so it cannot be used: ${addonBad.error || ''}`.trim()
              : `The change to the engine cannot be used: ${status.enginePatch?.error || 'it did not pass its checks'}.` });
      }
      finish('ready', { error: opinion.ok ? '' : 'The reviewer still has doubts: read them before you decide.' });
    } catch (err) {
      finish(stopped ? 'stopped' : 'failed', { error: String(err.message || err).slice(0, 600) });
    } finally {
      // The engine copy is large and only needed while the change is written and checked.
      if (status.dir) removeEngineCopy(status.dir);
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
