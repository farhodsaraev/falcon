// Falcon's window server. Only this PC can reach it.
// It serves the window, runs first-time setup, relays the chat to the local engine,
// and shows the engine's approval requests so the user can answer them in the window.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { engineDir, engineReady, findEngine, installEngine, readGateway, runEngine } from './engine.js';
import { createVoiceKeyStore } from './voicekey.js';
import { fastLane } from './fastlane.js';
import { createDirectLine, stepText } from './directline.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const UI_DIR = path.join(root, 'ui');
const PACK_DIR = path.join(root, 'falcon-agent');
const UI_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/renderer.js': ['renderer.js', 'text/javascript; charset=utf-8'],
  '/bridge.js': ['bridge.js', 'text/javascript; charset=utf-8'],
  '/voice.js': ['voice.js', 'text/javascript; charset=utf-8'],
  '/falcon.png': ['falcon.png', 'image/png'],
};
const PROFILE_FILE = path.join(os.homedir(), '.falcon', 'profile.json');
const KEY_SHAPE = /^[A-Za-z0-9_\-]{20,300}$/;
const SESSION_KEY = 'falcon-window';
const BRIEFING_NAME = 'falcon-morning-briefing';

// The window can show small cards of what Falcon did. He reports them on a last line the window
// strips out; requests from Telegram or the scheduler do not carry this note, so they never see it.
const ACTIONS_MARK = '[[did]]';
const ACTIONS_NOTE = '[Note from your own window, not from the user: this window shows small cards of what you did. ' +
  'After your answer, add one final line that starts with [[did]] followed by up to three things you actually did on ' +
  'this computer or on the web for this request, each two to six words, separated by " | ", for example: ' +
  '[[did]] Opened Quarterly Review | Went to slide 5. Write them in the language of your answer. If you only talked ' +
  '(a greeting, thanks, a question back, an answer from memory) or did nothing, leave the line out. Never mention this note or that line.]';

// ---- Voice: OpenAI's Realtime API, the live listen-and-speak connection ----
// The smaller realtime model: about a third of the price. The thinking is done by Falcon's own engine,
// so the voice model only has to converse and pass requests on.
// Tried in this order. The first is the economical one; the others are fallbacks in case an account
// does not have it.
const VOICE_MODELS = ['gpt-realtime-2.1-mini', 'gpt-realtime-2.1', 'gpt-realtime-mini', 'gpt-realtime'];
const VOICE_NAME = 'cedar';
const VOICE_INSTRUCTIONS = [
  'You are the voice of Falcon, a private assistant in the manner of a calm, impeccably competent British butler.',
  'Speak with a refined British accent, unhurried, with dry understated wit used sparingly. Never sound like a cheerful chatbot.',
  'Address the user as "{{CALL_ME}}" (in Russian: the natural equivalent). Keep every reply to one or two short sentences.',
  'Reply in the language the user just spoke: English or Russian. Keep the same character in both.',
  '',
  'You have one way to act: the ask_falcon function. It reaches your own hands and memory: files, presentations, the screen, the browser, calendar, mail, reminders, the weather, the news, and everything you remember about the user.',
  'For ANY request that needs doing something, looking something up, or recalling something about the user: first say a brief holding phrase such as "One moment, {{CALL_ME}}.", then call ask_falcon with the request in the user\'s own words and language, then say the result naturally in one or two sentences. Never invent a result and never claim to have done something without calling ask_falcon.',
  'Only greetings, thanks and light small talk are answered without it.',
  'If the result says a confirmation is needed, ask the user for a clear yes or no and pass his answer on with ask_falcon.',
  '',
  'Never say a password, PIN, card number or code aloud, even if the user says one. Never mention the names of the software, models, providers or tools you run on; if asked what you are, you are Falcon, his private assistant.',
  'If the user interrupts you, stop and listen.',
].join('\n');
const VOICE_TOOLS = [{
  type: 'function',
  name: 'ask_falcon',
  description: 'Do something on the user\'s computer or look something up: files, presentations, screen, browser and web, calendar, mail, reminders, weather, news, memory about the user. Returns what happened, in words.',
  parameters: {
    type: 'object',
    properties: { request: { type: 'string', description: 'The user\'s request, complete and in his own words and language.' } },
    required: ['request'],
  },
}];

// Which AI model Falcon thinks with, per kind of key. Chosen by running scripts/quality-check.mjs:
// these followed Falcon's safety rules every time (never typing a dictated password, asking before
// deleting). The engine's own default for an OpenAI key costs about ten times more, and OpenAI's
// cheapest model typed a password it was told not to. The engine's default stays as the fallback.
//
// A key says which company it belongs to (by how it starts), never which model. So the user picks the
// model from a short list, with the tested one preselected. `id` is the name at the provider itself and
// is used to check the model really exists for this key; `model` is the engine's name for it.
const PROVIDERS = {
  openai: {
    name: 'OpenAI', authChoice: 'openai-api-key', keyFlag: '--openai-api-key', voice: true,
    models: [
      { id: 'gpt-6.1-terra', model: 'openai/gpt-6.1-terra', label: 'GPT-6.1 Terra', note: 'Recommended. Passed every safety and quality check.', tested: true },
      { id: 'gpt-6.1-sol', model: 'openai/gpt-6.1-sol', label: 'GPT-6.1 Sol', note: 'More capable, about twice the price. Not yet put through the checks.' },
      { id: 'gpt-6-luna', model: 'openai/gpt-6-luna', label: 'GPT-6 Luna', note: 'Cheapest. Less careful with the safety rules. Not recommended.' },
    ],
  },
  anthropic: {
    name: 'Anthropic', authChoice: 'apiKey', keyFlag: '--anthropic-api-key', voice: false,
    models: [
      { id: 'claude-haiku-5-5', model: 'anthropic/claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Recommended. Low cost; followed the safety rules in testing.', tested: true },
      { id: 'claude-sonnet-5-5', model: 'anthropic/claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'More capable, about twenty times the price. Not yet put through the checks.' },
      { id: 'claude-opus-5-5', model: 'anthropic/claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Most capable and most expensive. Not yet put through the checks.' },
    ],
  },
  openrouter: {
    name: 'OpenRouter', authChoice: 'openrouter-api-key', keyFlag: '--openrouter-api-key', voice: false,
    models: [
      { id: 'anthropic/claude-haiku-5.5', model: 'openrouter/anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', note: 'Recommended. Low cost; followed the safety rules in testing.', tested: true },
      { id: 'openai/gpt-6.1-terra', model: 'openrouter/openai/gpt-6.1-terra', label: 'GPT-6.1 Terra', note: 'Crisper answers, about ten times the price. Passed every check.', tested: true },
      { id: 'anthropic/claude-sonnet-5.5', model: 'openrouter/anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', note: 'More capable, about twenty times the price. Not yet put through the checks.' },
    ],
  },
};

/** Which company a key belongs to, from how it starts. */
export function recogniseKey(key) {
  if (/^sk-or-/.test(key)) return 'openrouter';
  if (/^sk-ant-/.test(key)) return 'anthropic';
  if (/^sk-/.test(key)) return 'openai';
  return null;
}

const GOOGLE_KEY_SHAPE = /^AIza[A-Za-z0-9_-]{30,60}$/;

/** One value from the engine's private settings file (NAME=value lines), or ''. */
export function readEnvKey(file, name) {
  try {
    const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : '';
  } catch { return ''; }
}

/** Sets one value in that file, keeping the other lines, readable only by this user. */
export function writeEnvKey(file, name, value) {
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith(`${name}=`)); } catch { /* new file */ }
  lines.push(`${name}=${value}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
}

/**
 * A last safety net for what Falcon says in his window. His rules tell him to speak of "my settings" and
 * never to name what he runs on; a smaller model sometimes slips, so the name is put into his own words here.
 */
export function ownWords(text) {
  return String(text ?? '').replace(/\b(the\s+)?open[- ]?claw\b(?:'s)?/gi, (match, the) => (the ? 'my own' : 'Falcon'));
}

/**
 * Makes one line of installer output fit to show in the window: no colour codes, no AI keys,
 * no name of the engine, not too long. Returns '' for lines not worth showing.
 */
export function progressLine(line) {
  const text = String(line ?? '')
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\bsk-[\w-]{6,}/g, 'sk-…')
    .replace(/\bAIza[\w-]{6,}/g, 'AIza…')
    .replace(/\b\d{6,}:[\w-]{20,}/g, '…')
    .replace(/open[- ]?claw/gi, 'engine')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/[\p{L}\p{N}]/u.test(text)) return '';
  return text.length > 140 ? `${text.slice(0, 139)}…` : text;
}

/**
 * @param {object} [options]
 * @param {Function} [options.onIdle]  called when Falcon's window has been gone for `idleMs`, or the user
 *                                     pressed Quit; the launcher stops Falcon then
 */
/** A fingerprint of Falcon's rules and skills as shipped with this copy of the app. */
export function packStamp(dir = PACK_DIR) {
  const hash = crypto.createHash('sha256');
  const walk = (folder, rel) => {
    let entries = [];
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full, `${rel}${entry.name}/`);
      // Line endings differ between a download and a copy of the project; the fingerprint must not.
      else { hash.update(`${rel}${entry.name}\n`); hash.update(fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n')); }
    }
  };
  walk(dir, '');
  return hash.digest('hex').slice(0, 16);
}

/** The last few lines of an installer's output, fit to show the user when a step failed. */
export function failureLines(out) {
  return String(out ?? '').split(/\r?\n/).map(progressLine).filter(Boolean).slice(-4).join('\n');
}

const uninstallerPath = () => path.join(root, 'installer', process.platform === 'win32' ? 'uninstall.ps1' : 'uninstall.sh');

export async function startServer({ port = 0, engine = {}, onIdle = () => {}, idleMs = 30000 } = {}) {
  // How long one request may take before the window gives up on it.
  const CHAT_LIMIT_MS = engine.chatLimitMs ?? 10 * 60000;
  // `engine` lets tests replace the real engine with stand-ins.
  const installFalcon = async (options) => {
    const pack = await import(pathToFileURL(path.join(PACK_DIR, 'install-falcon.mjs')).href);
    return pack.installFalcon(options);
  };
  const workspaceDir = () => path.join(os.homedir(), '.openclaw', 'workspace');
  const setupSearch = async (options) => {
    const pack = await import(pathToFileURL(path.join(PACK_DIR, 'install-falcon.mjs')).href);
    return pack.setupSearch(options);
  };
  const scoutProgressFile = () => path.join(os.homedir(), '.falcon', 'scout-progress.json');
  const scoutFolder = () => {
    const desktop = [path.join(os.homedir(), 'Desktop'), path.join(os.homedir(), 'OneDrive', 'Desktop')].find((p) => fs.existsSync(p)) || os.homedir();
    return path.join(desktop, 'Falcon Scout');
  };
  const openPath = (file) => {
    const child = process.platform === 'win32' ? spawn('explorer.exe', [file], { detached: true, stdio: 'ignore' })
      : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [file], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  };
  const envFile = () => path.join(os.homedir(), '.openclaw', '.env');
  const api = { fastLane, packStamp, engineReady, findEngine, installEngine, installFalcon, setupSearch, readGateway, runEngine, fetch, workspaceDir, envFile, scoutProgressFile, scoutFolder, openPath, profileFile: () => PROFILE_FILE, voiceKey: createVoiceKeyStore(), ...engine };
  // His direct line to the engine (see directline.js). A stand-in engine may pass its own, or null for none.
  if (!('directLine' in engine)) api.directLine = createDirectLine({ readGateway: () => api.readGateway() });
  // The engine's first Telegram reply to a new user bypasses Falcon's add-on, so Falcon puts his own words
  // into it in the engine's files: at every start (engine updates bring the old text back) and after setup.
  const ownPairingText = async () => {
    try {
      const dir = engineDir(api.findEngine());
      if (!dir) return;
      const { patchPairingText } = await import(pathToFileURL(path.join(PACK_DIR, 'engine-addon', 'pairing.js')).href);
      patchPairingText(dir);
    } catch { /* the engine keeps its own wording; nothing else depends on this */ }
  };
  ownPairingText();
  const token = crypto.randomBytes(24).toString('hex');
  const clients = new Set();
  const shownApprovals = new Set();
  let chatsInFlight = 0;
  let pollerRunning = false;
  let setupRunning = false;
  // Falcon stops when his window is gone: once it has connected, if no window is connected for
  // `idleMs` (a reload reconnects in a moment) and nothing is running, he stops by himself.
  let windowSeen = false;
  let idleTimer = null;
  const fastNotes = [];            // what the fast lane did since the AI last heard from the window
  let refreshing = false;
  let refreshChecked = false;
  const busy = () => setupRunning || refreshing || chatsInFlight > 0;
  const callMeNow = () => { try { return JSON.parse(fs.readFileSync(api.profileFile(), 'utf8')).callMe || 'sir'; } catch { return 'sir'; } };

  // ---- Updates: Falcon's rules and skills live in the engine's workspace, written at first setup.
  // When a newer copy of the app is installed over an existing one, write them again (and pre-approve
  // any new skills), once, quietly, the first time the engine is seen running. Without this an update
  // changed the window but never Falcon's behaviour.
  const stampFile = () => path.join(path.dirname(api.profileFile()), 'pack.json');
  const writeStamp = (stamp) => {
    try {
      fs.mkdirSync(path.dirname(stampFile()), { recursive: true });
      fs.writeFileSync(stampFile(), JSON.stringify({ stamp, at: new Date().toISOString() }));
    } catch { /* tried again at the next start */ }
  };
  async function refreshPack() {
    if (refreshChecked || refreshing || setupRunning) return;
    refreshChecked = true;
    const now = api.packStamp();
    let had = '';
    try { had = JSON.parse(fs.readFileSync(stampFile(), 'utf8')).stamp; } catch { /* installed before stamps existed */ }
    if (had === now) return;
    refreshing = true;
    try {
      const result = await api.installFalcon({ runEngine: api.runEngine, log: () => {} });
      if (result?.ok !== false) writeStamp(now);   // otherwise: try again at the next start
    } catch { /* try again at the next start */ } finally { refreshing = false; }
  }
  function watchForGoodbye() {
    clearTimeout(idleTimer);
    if (!windowSeen || clients.size > 0) return;
    idleTimer = setTimeout(() => {
      if (clients.size > 0) return;
      if (busy()) { watchForGoodbye(); return; }
      onIdle('window-closed');
    }, idleMs);
    idleTimer.unref?.();
  }
  // Waking the engine: at most one start at a time, and then give it time to come up.
  const WAKE_PATIENCE_MS = engine.wakePatienceMs ?? 5 * 60000;
  let waking = false;
  let lastWake = 0;

  const broadcast = (event, data) => {
    for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // ---- Approvals: while Falcon is working, ask the engine what is waiting for a yes ----
  async function pollApprovals() {
    if (pollerRunning) return;
    pollerRunning = true;
    try {
      while (chatsInFlight > 0) {
        const { code, out } = await api.runEngine(['approvals', 'pending', '--json'], { timeoutMs: 30000 });
        if (code === 0) {
          try {
            const start = out.indexOf('{');
            for (const item of JSON.parse(out.slice(start)).approvals || []) {
              if (shownApprovals.has(item.id)) continue;
              shownApprovals.add(item.id);
              broadcast('approval', { id: item.id, summary: item.summary || 'Run a command', kind: item.kind || 'exec' });
            }
          } catch { /* unreadable answer: try again next round */ }
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    } finally {
      pollerRunning = false;
    }
  }

  // Which Telegram chat is the user's own: remembered from pairing, or found from his first message to Falcon.
  const telegramFile = () => path.join(path.dirname(api.profileFile()), 'telegram.json');
  function saveTelegramChat(chat) {
    let before = null;
    try { before = JSON.parse(fs.readFileSync(telegramFile(), 'utf8')).chat; } catch { /* first time */ }
    fs.mkdirSync(path.dirname(telegramFile()), { recursive: true });
    fs.writeFileSync(telegramFile(), JSON.stringify({ chat }));
    // Make it the engine's default Telegram chat too, so Falcon can send him a file or a note on Telegram
    // from any door (his window, voice) without knowing the number.
    if (String(before) !== String(chat)) {
      api.runEngine(['config', 'set', 'channels.telegram.defaultTo', String(chat)], { timeoutMs: 120000 }).catch(() => {});
    }
  }
  async function telegramChat() {
    try {
      const saved = JSON.parse(fs.readFileSync(telegramFile(), 'utf8')).chat;
      if (/^-?\d{5,}$/.test(saved)) return saved;
    } catch { /* not saved yet */ }
    const { code, out } = await api.runEngine(['sessions', '--json', '--limit', 'all'], { timeoutMs: 60000 });
    if (code !== 0) return null;
    try {
      const parsed = JSON.parse(out.slice(out.search(/[[{]/)));
      const sessions = Array.isArray(parsed) ? parsed : (parsed.sessions || []);
      for (const session of sessions) {
        const text = JSON.stringify(session);
        if (!/telegram/i.test(text)) continue;
        const chat = /telegram[^"]*?:(-?\d{5,})/i.exec(text)?.[1] || /"(?:to|chatId|peerId|from)"\s*:\s*"?(?:telegram:)?(-?\d{5,})/i.exec(text)?.[1];
        if (chat) { saveTelegramChat(chat); return chat; }
      }
    } catch { /* unreadable list */ }
    return null;
  }

  async function briefingJobs() {
    const { code, out } = await api.runEngine(['cron', 'list', '--all', '--json'], { timeoutMs: 60000 });
    if (code !== 0) return [];
    try { return (JSON.parse(out.slice(out.indexOf('{'))).jobs || []).filter((job) => job.name === BRIEFING_NAME); } catch { return []; }
  }

  // ---- First-time setup ----
  async function setup({ key, accepted, model }) {
    // Seconds each step usually takes, measured on clean machines by the install test; the window shows the time left.
    const USUAL = { engine: process.platform === 'win32' ? 360 : 90, key: 60, start: 10, manners: 45, wake: 15 };
    const ORDER = ['engine', 'key', 'start', 'manners', 'wake'];
    const step = (text, name) => broadcast('setup', { text, left: ORDER.slice(ORDER.indexOf(name)).reduce((sum, n) => sum + USUAL[n], 0) });
    // The real lines the installers print, shown under the step so the wait is not a blank spinner.
    const detail = (line) => { const text = progressLine(line); if (text) broadcast('setup', { detail: text }); };
    if (!accepted) return { ok: false, error: 'Please tick the box to continue.' };

    if (!api.findEngine()) {
      step('Installing the engine. This takes a few minutes…', 'engine');
      const install = await api.installEngine({ onLine: detail });
      if (!api.findEngine()) return { ok: false, error: 'The engine could not be installed.', detail: failureLines(install.out) };
    }

    if (!api.readGateway()) {
      if (!KEY_SHAPE.test(key || '')) return { ok: false, error: 'That does not look like an API key.' };
      step('Connecting your AI key…', 'key');
      const provider = PROVIDERS[recogniseKey(key)];
      if (!provider) return { ok: false, error: 'I do not recognise this kind of key. OpenAI, Anthropic and OpenRouter keys are supported.' };
      if (provider.voice) await api.voiceKey.set(key).catch(() => {});
      // An OpenRouter key also gives Falcon web search; the settings step below switches it on.
      if (provider === PROVIDERS.openrouter) writeEnvKey(api.envFile(), 'OPENROUTER_API_KEY', key);
      const preferred = (provider.models.find((m) => m.model === model) || provider.models[0]).model;
      const onboard = await api.runEngine(['onboard', '--non-interactive', '--accept-risk', '--mode', 'local',
        '--auth-choice', provider.authChoice, provider.keyFlag, key, '--gateway-bind', 'loopback', '--gateway-auth', 'token',
        '--install-daemon', '--agent-name', 'Falcon'], { timeoutMs: 600000, onLine: detail });
      if (onboard.code !== 0 || !api.readGateway()) {
        return { ok: false, error: 'The key could not be connected.', detail: failureLines(onboard.out) };
      }
      {
        // Keep whatever the engine picked as the fallback, so Falcon still answers if our choice is refused.
        const current = (await api.runEngine(['models', 'status', '--plain'], { timeoutMs: 60000 })).out.trim().split(/\r?\n/).pop() || '';
        const chosen = await api.runEngine(['models', 'set', preferred], { timeoutMs: 60000 });
        if (chosen.code === 0 && /^[\w.~-]+\/[\w./:~-]+$/.test(current) && current !== preferred) {
          await api.runEngine(['models', 'fallbacks', 'add', current], { timeoutMs: 60000 });
        }
      }
    }

    step('Starting…', 'start');
    await ownPairingText();   // the engine was just installed: its files hold the original wording
    await api.runEngine(['gateway', 'start'], { timeoutMs: 120000 });

    step('Teaching Falcon his manners…', 'manners');
    const notes = [];
    try {
      await api.installFalcon({ runEngine: api.runEngine, log: (line) => { notes.push(line); detail(line); } });
    } catch (err) {
      return { ok: false, error: 'Falcon could not be installed.', detail: failureLines(`${err.message}\n${notes.join('\n')}`) };
    }

    step('Waking Falcon…', 'wake');
    for (let i = 0; i < 30; i++) {
      if (await api.engineReady()) { writeStamp(api.packStamp()); return { ok: true }; }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return { ok: false, error: 'Falcon did not wake up. Please restart the computer and try again.' };
  }

  // ---- Chat: relay to the engine and stream the answer back ----
  // The window's conversation. When the user changes how he wants to be addressed, a fresh conversation
  // starts, because an old one full of "sir" keeps pulling a smaller model back to "sir". What Falcon
  // knows about the user lives in his notes, not in the conversation, so nothing is forgotten.
  function windowSession() {
    let callMe = 'sir';
    try { callMe = JSON.parse(fs.readFileSync(api.profileFile(), 'utf8')).callMe || 'sir'; } catch { /* default */ }
    return `${SESSION_KEY}-${crypto.createHash('sha256').update(callMe).digest('hex').slice(0, 8)}`;
  }

  async function chat(text, res) {
    const gateway = api.readGateway();
    const send = (event, data) => { if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    // The fast lane: a few very common requests are done at once, without the AI.
    try {
      chatsInFlight++;
      const quick = await api.fastLane(text, { packDir: PACK_DIR, callMe: callMeNow() });
      if (quick) {
        send('delta', { text: quick.reply });
        if (quick.actions?.length) send('actions', { items: quick.actions });
        send('done', {});
        res.end();
        fastNotes.push(quick.note);
        if (fastNotes.length > 12) fastNotes.shift();
        return;
      }
    } catch { /* the usual way, below */ } finally { chatsInFlight--; }
    // Tell the AI what was done meanwhile without it, so "open it" or "what is on this slide" still make sense.
    const meanwhile = fastNotes.length
      ? `[Note from your own window, not from the user: since your last reply you already carried out these quick requests yourself; they are done, do not repeat them. ${fastNotes.map((n, i) => `(${i + 1}) ${n}`).join(' ')}]\n\n`
      : '';
    fastNotes.length = 0;
    chatsInFlight++;
    // While Falcon scouts, pass the scan's progress on to the window, and the finished dossier.
    const chatStarted = Date.now();
    let lastProgress = '';
    let dossierSent = false;
    const watchScout = () => {
      try {
        const raw = fs.readFileSync(api.scoutProgressFile(), 'utf8');
        const progress = JSON.parse(raw);
        if (progress.at < chatStarted || raw === lastProgress) return;
        lastProgress = raw;
        send('scout', { name: progress.name, type: progress.type, stage: progress.stage, found: progress.found, sources: progress.sources });
        if (progress.dossier && !dossierSent) { dossierSent = true; send('dossier', { name: path.basename(progress.dossier) }); }
      } catch { /* no scout running */ }
    };
    const scoutTimer = setInterval(watchScout, 800);
    // The user pressed Stop (the window dropped the request), or it ran far too long: let go of the engine.
    const control = new AbortController();
    let tooLong = false;
    const limit = setTimeout(() => { tooLong = true; control.abort(); }, CHAT_LIMIT_MS);
    res.on('close', () => {
      if (res.writableEnded) return;
      control.abort();
      // Seen on the real engine: asked anything afterwards, he quietly picked the stopped job up again.
      if (!tooLong) fastNotes.push('the user pressed Stop on your previous request while you were working on it; it is cancelled, so do not continue or restart it unless he asks you to');
    });
    try {
      const content = `${meanwhile}${text}\n\n${ACTIONS_NOTE}`;
      let full = '';        // everything Falcon has written so far
      let passed = 0;       // how much of it has been sent on to the window
      // Pass the answer on as it arrives, but hold back the trailing "what I did" line and anything
      // that might be the start of it.
      const flush = (final) => {
        const marker = full.indexOf(ACTIONS_MARK);
        let safe = marker >= 0 ? marker : full.length;
        if (marker < 0 && !final) {
          // The ending may be the first few characters of the marker, still arriving.
          for (let start = Math.max(0, full.length - ACTIONS_MARK.length + 1); start < full.length; start++) {
            if (ACTIONS_MARK.startsWith(full.slice(start))) { safe = start; break; }
          }
        }
        // Hold back a word that is still arriving, so a name split across two pieces is still caught below.
        if (!final) safe -= /\S*$/.exec(full.slice(0, safe))[0].length;
        if (safe > passed) { send('delta', { text: ownWords(full.slice(passed, safe)) }); passed = safe; }
      };
      // First choice: his direct line. The answer arrives as it is written, each step is announced as it
      // starts, and Stop reaches the engine itself. Only a request that never got through goes the old way.
      let direct = false;
      if (api.directLine) {
        const russian = /[а-яё]/i.test(text);
        try {
          await api.directLine.chat({
            sessionKey: windowSession(), message: content, signal: control.signal,
            onDelta: (piece) => { full += piece; flush(false); },
            onStep: (step) => send('step', { text: stepText(step, russian) }),
          });
          direct = true;
        } catch (err) {
          if (err.started !== false || control.signal.aborted) throw err;
        }
      }
      if (!direct) {
        pollApprovals();
        const upstream = await api.fetch(`http://127.0.0.1:${gateway.port}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${gateway.token}`,
            'x-openclaw-session-key': windowSession(),
          },
          body: JSON.stringify({ model: 'openclaw/default', stream: true, messages: [{ role: 'user', content }] }),
          signal: control.signal,
        });
        if (!upstream.ok) throw new Error(`engine answered ${upstream.status}`);
        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of upstream.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let newline;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
            try {
              const delta = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content;
              if (delta) { full += delta; flush(false); }
            } catch { /* keep-alive or partial line */ }
          }
        }
      }
      flush(true);
      clearInterval(scoutTimer);
      watchScout();
      const marker = full.indexOf(ACTIONS_MARK);
      if (marker >= 0) {
        const items = full.slice(marker + ACTIONS_MARK.length).split('\n')[0].split('|')
          .map((item) => ownWords(item).replace(/[*_`[\]]/g, '').trim()).filter((item) => item.length > 2 && item.length <= 60).slice(0, 3);
        if (items.length) send('actions', { items });
      }
      send('done', {});
    } catch {
      send('error', { text: tooLong ? `That took too long, ${callMeNow()}, so I stopped. Please ask again, perhaps in smaller steps.`
        : `I have lost my connection, ${callMeNow()}. Please try again in a moment.` });
    } finally {
      clearTimeout(limit);
      clearInterval(scoutTimer);
      chatsInFlight--;
      res.end();
    }
  }

  const routes = {
    'GET /api/state': async () => {
      const configured = Boolean(api.readGateway());
      let ready = configured && await api.engineReady();
      // Set up before but asleep (for example after a restart): wake it quietly, once. The engine can take
      // minutes to start on a busy computer; starting it again meanwhile ran several copies that blocked
      // each other, so none of them ever answered.
      if (configured && !ready && !setupRunning && !waking && Date.now() - lastWake > WAKE_PATIENCE_MS) {
        waking = true;
        lastWake = Date.now();
        try {
          await api.runEngine(['gateway', 'start'], { timeoutMs: 120000 });
          await api.runEngine(['config', 'set', 'gateway.http.endpoints.chatCompletions.enabled', 'true']);
          ready = await api.engineReady();
        } finally {
          waking = false;
        }
      }
      if (ready) refreshPack().catch(() => {});
      return { configured, ready };
    },
    'GET /api/about': async () => {
      let version = '0.1.0';
      try { version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || version; } catch { /* default */ }
      return { version, build: api.packStamp().slice(0, 7) };
    },
    'POST /api/setup': async (body) => {
      if (setupRunning) return { ok: false, error: 'Setup is already running.' };
      setupRunning = true;
      try { return await setup(body); } finally { setupRunning = false; }
    },
    // ---- Who Falcon serves: a short profile he reads at the start of every conversation ----
    'GET /api/profile': async () => {
      try { return { done: true, ...JSON.parse(fs.readFileSync(api.profileFile(), 'utf8')) }; } catch { return { done: false }; }
    },
    'POST /api/profile': async (body) => {
      const clean = (value, max) => String(value || '').replace(/[\r\n]+/g, ' ').replace(/<!--|-->|[<>`]|falcon-profile:(start|end)/gi, '').trim().slice(0, max);
      const profile = {
        name: clean(body.name, 60),
        callMe: clean(body.callMe, 30) || 'sir',
        language: ['English', 'Russian'].includes(body.language) ? body.language : 'auto',
        about: clean(body.about, 400),
        skipped: body.skipped === true,
      };
      const lines = [];
      if (!profile.skipped) {
        const stamp = `<!-- observed: ${new Date().toISOString().slice(0, 10)} | status: active -->`;
        if (profile.name) lines.push(stamp, '', `- The user's name is ${profile.name}.`, '');
        lines.push(stamp, '', profile.callMe.toLowerCase() === 'sir'
          ? '- Always address the user as "sir" (in Russian: «сэр»).'
          : `- Always address the user as "${profile.callMe}" instead of "sir", in every language.`, '');
        if (profile.language !== 'auto') lines.push(stamp, '', `- Prefer ${profile.language} when the user's message does not make the language clear.`, '');
        if (profile.about) lines.push(stamp, '', `- About the user and his work, in his own words: ${profile.about}`, '');
      }
      const userFile = path.join(api.workspaceDir(), 'USER.md');
      if (fs.existsSync(path.dirname(userFile))) {
        const existing = fs.existsSync(userFile) ? fs.readFileSync(userFile, 'utf8') : '# USER.md\n';
        const without = existing.replace(/\r?\n*<!-- falcon-profile:start -->[\s\S]*?<!-- falcon-profile:end -->\r?\n*/g, '\n');
        const block = lines.length ? `\n\n<!-- falcon-profile:start -->\n## From the user's own introduction\n\n${lines.join('\n').trim()}\n<!-- falcon-profile:end -->\n` : '\n';
        fs.writeFileSync(userFile, without.trimEnd() + block);
      }
      fs.mkdirSync(path.dirname(api.profileFile()), { recursive: true });
      fs.writeFileSync(api.profileFile(), JSON.stringify(profile, null, 2));
      // Write the chosen form of address into Falcon's rules straight away.
      try { await api.installFalcon({ skipSettings: true, profileFile: api.profileFile(), workspace: api.workspaceDir(), log: () => {} }); } catch { /* rules are refreshed at the next start */ }
      return { ok: true, callMe: profile.callMe };
    },

    // ---- What kind of key is this, does its company accept it, and which models can it use? ----
    // The key is sent only to the company it belongs to, to ask for its list of models.
    'POST /api/key/inspect': async (body) => {
      const key = String(body.key || '').trim();
      const id = KEY_SHAPE.test(key) ? recogniseKey(key) : null;
      if (!id) return { ok: false, error: 'I do not recognise this key. OpenAI keys start with sk-, Anthropic keys with sk-ant-, OpenRouter keys with sk-or-.' };
      const provider = PROVIDERS[id];
      let accepted = null;          // null = could not check (for example, no internet)
      let available = null;
      try {
        const request = {
          openai: ['https://api.openai.com/v1/models', { Authorization: `Bearer ${key}` }],
          anthropic: ['https://api.anthropic.com/v1/models?limit=200', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }],
          openrouter: ['https://openrouter.ai/api/v1/key', { Authorization: `Bearer ${key}` }],
        }[id];
        const response = await api.fetch(request[0], { headers: request[1], signal: AbortSignal.timeout(15000) });
        accepted = response.ok ? true : (response.status === 401 || response.status === 403 ? false : null);
        if (response.ok && id !== 'openrouter') {
          available = new Set(((await response.json()).data || []).map((m) => m.id));
        }
      } catch { /* leave as "could not check" */ }
      if (accepted === false) return { ok: false, error: `${provider.name} does not accept this key. Check that it was copied completely.` };
      // Offer only the models this key can really use; if the list could not be read, offer them all.
      const models = provider.models.filter((m) => !available || available.has(m.id));
      return {
        ok: true, provider: provider.name, checked: accepted === true, voice: provider.voice,
        models: (models.length ? models : provider.models).map(({ model, label, note, tested }) => ({ model, label, note, tested: Boolean(tested) })),
      };
    },
    'GET /api/model': async () => {
      const current = (await api.runEngine(['models', 'status', '--plain'], { timeoutMs: 60000 })).out.trim().split(/\r?\n/).pop() || '';
      const known = Object.values(PROVIDERS).flatMap((p) => p.models).find((m) => m.model === current);
      return { model: current, label: known ? known.label : current.split('/').pop() };
    },

    // ---- AI keys: add or replace one later. The key travels on standard input, never on a command line. ----
    'POST /api/key': async (body) => {
      const key = String(body.key || '').trim();
      if (!KEY_SHAPE.test(key)) return { ok: false, error: 'That does not look like an API key.' };
      const provider = recogniseKey(key);
      if (!provider) return { ok: false, error: 'I do not recognise this kind of key.' };
      const save = () => api.runEngine(['models', 'auth', 'paste-api-key', '--provider', provider], { input: `${key}\n`, timeoutMs: 90000 });
      let result = await save();
      if (result.code !== 0) {
        // The engine was busy with its own files: pause it, save, and start it again.
        await api.runEngine(['gateway', 'stop'], { timeoutMs: 60000 });
        result = await save();
        await api.runEngine(['gateway', 'start'], { timeoutMs: 120000 });
      } else if (/gateway restart/i.test(result.out)) {
        await api.runEngine(['gateway', 'restart'], { timeoutMs: 120000 });
      }
      if (result.code !== 0) return { ok: false, error: 'The key could not be saved.' };
      if (PROVIDERS[provider].voice) await api.voiceKey.set(key).catch(() => {});
      if (provider === 'openrouter') {
        // The same key gives Falcon web search, through Perplexity.
        writeEnvKey(api.envFile(), 'OPENROUTER_API_KEY', key);
        await api.setupSearch({ step: async (what, args, input, { okIf } = {}) => {
          const { code, out } = await api.runEngine(args, { timeoutMs: 300000 });
          return code === 0 || Boolean(okIf && okIf.test(out));
        }, envFile: api.envFile() });
        await api.runEngine(['gateway', 'restart'], { timeoutMs: 120000 });
      }
      // Optionally make Falcon think with a model from this key straight away.
      const chosen = PROVIDERS[provider].models.find((m) => m.model === body.model);
      let thinking = null;
      if (chosen) {
        const set = await api.runEngine(['models', 'set', chosen.model], { timeoutMs: 60000 });
        if (set.code === 0) thinking = chosen.label;
      }
      return { ok: true, provider: PROVIDERS[provider].name, thinking };
    },

    // ---- Google search: a free Google AI Studio key lets Falcon search Google itself, instead of
    // clicking through a browser that Google often blocks. The key goes in the engine's own private
    // settings file, never on a command line.
    'GET /api/search': async () => {
      const google = Boolean(readEnvKey(api.envFile(), 'GEMINI_API_KEY'));
      const openrouter = Boolean(readEnvKey(api.envFile(), 'OPENROUTER_API_KEY'));
      // With neither key, search still works: through the free service setup switched on, or by itself
      // when Falcon thinks with an OpenAI model.
      let other = null;
      try {
        const config = JSON.parse(fs.readFileSync(path.join(path.dirname(api.envFile()), 'openclaw.json'), 'utf8'));
        const model = config.agents?.defaults?.model;
        const primary = String((typeof model === 'string' ? model : model?.primary) || '');
        if (config.tools?.web?.search?.provider === 'parallel-free') other = 'free';
        else if (/^openai\//.test(primary)) other = 'builtin';
      } catch { /* no settings to read */ }
      return { google, via: google ? 'google' : openrouter ? 'openrouter' : other };
    },
    'POST /api/search': async (body) => {
      const key = String(body.key || '').trim();
      if (!GOOGLE_KEY_SHAPE.test(key)) return { ok: false, error: 'That does not look like a Google key. It starts with AIza.' };
      try {
        const response = await api.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000) });
        if (response.status === 400 || response.status === 401 || response.status === 403) {
          return { ok: false, error: 'Google does not accept this key. Check that it was copied completely.' };
        }
      } catch { /* no internet right now: save it anyway */ }
      writeEnvKey(api.envFile(), 'GEMINI_API_KEY', key);
      const set = await api.runEngine(['config', 'set', 'tools.web.search.provider', 'gemini'], { timeoutMs: 60000 });
      if (set.code !== 0) return { ok: false, error: 'The key was saved, but Falcon could not switch to Google search.' };
      await api.runEngine(['gateway', 'restart'], { timeoutMs: 120000 });
      return { ok: true };
    },

    // ---- Scout: open a finished dossier. Only a file inside the "Falcon Scout" folder can be opened. ----
    'POST /api/dossier/open': async (body) => {
      const name = path.basename(String(body.name || ''));
      const file = path.join(api.scoutFolder(), name);
      if (!/\.html$/i.test(name) || !fs.existsSync(file)) return { ok: false, error: 'That dossier is no longer there.' };
      api.openPath(file);
      return { ok: true };
    },

    // ---- Quit: stop Falcon's window and background part (his engine keeps running for Telegram and briefings) ----
    // Removes Falcon from this computer by running his uninstaller on its own, then this window closes.
    'GET /api/uninstall': async () => ({ available: fs.existsSync(uninstallerPath()) }),
    'POST /api/uninstall': async (body) => {
      const script = uninstallerPath();
      if (!fs.existsSync(script)) return { ok: false, error: 'The uninstaller is missing. Run the install line again, then try once more.' };
      const keep = body.deleteData !== true;
      const child = process.platform === 'win32'
        ? spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-Quiet', keep ? '-KeepData' : '-DeleteData'],
          { detached: true, stdio: 'ignore', windowsHide: true })
        : spawn('/bin/bash', [script, '--yes', keep ? '--keep-data' : '--delete-data'], { detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true };
    },
    'POST /api/quit': async () => {
      setTimeout(() => onIdle('quit'), 300).unref?.();
      return { ok: true };
    },

    // ---- Voice ----
    'GET /api/voice': async () => ({ available: Boolean(await api.voiceKey.get()) }),

    // ---- Morning briefing: Falcon speaks first, once a day, in Telegram ----
    'GET /api/briefing': async () => {
      const job = (await briefingJobs())[0];
      const [minute, hour] = (job?.schedule?.expr || '0 8 * * *').split(' ');
      return { enabled: Boolean(job?.enabled), time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
    },
    'POST /api/briefing': async (body) => {
      const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(body.time || ''));
      if (body.enabled && !match) return { ok: false, error: 'Choose a time first.' };
      for (const job of await briefingJobs()) await api.runEngine(['cron', 'rm', job.id], { timeoutMs: 60000 });
      if (!body.enabled) return { ok: true, enabled: false };
      const chat = await telegramChat();
      if (!chat) return { ok: false, error: 'I do not know your Telegram chat yet. Send Falcon any message in Telegram, then try again.' };
      const added = await api.runEngine(['cron', 'add',
        '--name', BRIEFING_NAME,
        '--cron', `${Number(match[2])} ${Number(match[1])} * * *`,
        '--tz', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        '--message', 'It is time for the scheduled morning briefing. Give the user his morning briefing now, following your morning briefing rules. Write it as one short message.',
        '--announce', '--channel', 'telegram', '--to', chat, '--exact', '--json'], { timeoutMs: 90000 });
      return added.code === 0 ? { ok: true, enabled: true } : { ok: false, error: 'The briefing could not be scheduled.' };
    },
    'POST /api/briefing/now': async () => {
      const job = (await briefingJobs())[0];
      if (!job) return { ok: false, error: 'Switch the briefing on first.' };
      await api.runEngine(['cron', 'run', job.id, '--expect-final'], { timeoutMs: 240000 });
      // Believe the delivery record, not the exit code: wait until the newest run says what happened.
      for (let i = 0; i < 40; i++) {
        const { code, out } = await api.runEngine(['cron', 'runs', '--id', job.id, '--json', '--limit', '1'], { timeoutMs: 60000 });
        if (code === 0) {
          try {
            const entry = JSON.parse(out.slice(out.indexOf('{'))).entries?.[0];
            if (entry?.action === 'finished') {
              return entry.delivered === true || entry.deliveryStatus === 'delivered'
                ? { ok: true }
                : { ok: false, error: `Falcon wrote the briefing, but Telegram did not take it${entry.deliveryError ? `: ${String(entry.deliveryError).slice(0, 120)}` : '.'}` };
            }
          } catch { /* not finished writing yet */ }
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      return { ok: false, error: 'The briefing took too long. Please try again.' };
    },

    // ---- Connections ----
    'GET /api/connections': async () => {
      const { code, out } = await api.runEngine(['channels', 'list', '--json'], { timeoutMs: 40000 });
      let telegram = false;
      if (code === 0) {
        try { telegram = Boolean(JSON.parse(out.slice(out.indexOf('{'))).chat?.telegram); } catch { /* unknown */ }
      }
      return { telegram };
    },
    'POST /api/telegram/connect': async (body) => {
      const botToken = String(body.token || '').trim();
      if (!/^\d{6,12}:[A-Za-z0-9_-]{30,60}$/.test(botToken)) {
        return { ok: false, error: 'That does not look like a Telegram bot token. It looks like 123456789:AAE… and comes from @BotFather.' };
      }
      const result = await api.runEngine(['channels', 'add', '--channel', 'telegram', '--token', botToken], { timeoutMs: 90000 });
      if (result.code !== 0) return { ok: false, error: 'Telegram did not accept that token.' };
      // The running engine is meant to pick the token up by itself. On some Windows PCs that live reload is
      // refused ("operation not permitted"), so the token sat saved but unused and the bot never answered.
      // If Telegram is not live yet, restart the engine so it starts with the token.
      const live = async () => {
        const { code, out } = await api.runEngine(['channels', 'status', '--probe'], { timeoutMs: 90000 });
        // e.g. "- Telegram default: enabled, configured, running, … works"
        return code === 0 && /telegram[^\n]*\brunning\b/i.test(out);
      };
      if (await live()) return { ok: true };
      await api.runEngine(['gateway', 'restart'], { timeoutMs: 600000 });
      for (let i = 0; i < 30; i++) {
        if (await live()) return { ok: true, restarted: true };
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
      return { ok: false, error: 'The token is saved, but Falcon could not switch Telegram on. Restart the computer, then send your bot a message.' };
    },
    'POST /api/telegram/pair': async (body) => {
      const code = String(body.code || '').trim().toUpperCase();
      if (!/^[A-Z0-9-]{4,20}$/.test(code)) return { ok: false, error: 'That does not look like a pairing code.' };
      // Note who is asking before approving, so Falcon later knows which chat to write to first.
      // Generous waits: on a slow PC each of these took 20-30 seconds, and a cut-off wait was reported as a wrong code.
      const listPending = () => api.runEngine(['pairing', 'list', '--channel', 'telegram', '--json'], { timeoutMs: 180000 });
      const pending = await listPending();
      const waiting = (out) => String(out || '').toUpperCase().includes(`"${code}"`);
      const result = await api.runEngine(['pairing', 'approve', 'telegram', code, '--notify'], { timeoutMs: 180000 });
      if (result.code !== 0) {
        // The approval may have gone through even though the command did not say so in time.
        const wasWaiting = pending.code === 0 && waiting(pending.out);
        const after = wasWaiting ? await listPending() : null;
        if (!(after && after.code === 0 && !waiting(after.out))) {
          // The bot sends its code once and keeps it for an hour; messaging it again brings no new code.
          return { ok: false, error: 'That code was not recognised. Type the code exactly as the bot sent it in its first reply (it stays the same for an hour).' };
        }
      }
      try {
        const requests = Object.values(JSON.parse(pending.out.slice(pending.out.indexOf('{')))).find(Array.isArray) || [];
        const mine = requests.find((r) => JSON.stringify(r).toUpperCase().includes(code));
        const chat = mine && /"(?:id|senderId|chatId|from|peerId|userId)"\s*:\s*"?(-?\d{5,})/.exec(JSON.stringify(mine))?.[1];
        if (chat) saveTelegramChat(chat);
      } catch { /* the chat is learned from his first message instead */ }
      return { ok: true };
    },
    'POST /api/chrome/test': async () => {
      const result = await api.runEngine(['browser', '--browser-profile', 'user', 'tabs'], { timeoutMs: 45000 });
      return { ok: result.code === 0 };
    },
    'POST /api/approval': async (body) => {
      if (!/^[\w-]{8,64}$/.test(body.id || '') || !['allow-once', 'deny'].includes(body.decision)) {
        return { ok: false };
      }
      const result = await api.runEngine(['approvals', 'resolve', body.id, body.decision, '--json'], { timeoutMs: 30000 });
      return { ok: result.code === 0 };
    },
  };

  function readText(req) {
    return new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; if (raw.length > 200000) req.destroy(); });
      req.on('end', () => resolve(raw));
      req.on('error', reject);
    });
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; if (raw.length > 200000) req.destroy(); });
      req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
      req.on('error', reject);
    });
  }

  const sameToken = (value) => typeof value === 'string' && value.length === token.length &&
    crypto.timingSafeEqual(Buffer.from(value), Buffer.from(token));

  const server = http.createServer(async (req, res) => {
    const send = (status, data, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(type === 'application/json' ? JSON.stringify(data) : data);
    };
    try {
      const { port: actualPort } = server.address();
      if (![`127.0.0.1:${actualPort}`, `localhost:${actualPort}`].includes(req.headers.host)) return send(403, { error: 'Forbidden' });
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (req.method === 'GET' && UI_FILES[url.pathname]) {
        const [file, type] = UI_FILES[url.pathname];
        return send(200, fs.readFileSync(path.join(UI_DIR, file)), type);
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        if (!sameToken(url.searchParams.get('token'))) return send(401, { error: 'Unauthorized' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': connected\n\n');
        clients.add(res);
        windowSeen = true;
        clearTimeout(idleTimer);
        req.on('close', () => { clients.delete(res); watchForGoodbye(); });
        return;
      }
      // A finished dossier, shown inside Falcon's window. Only a page from the "Falcon Scout" folder;
      // the window shows it in a sandboxed frame, so the page cannot reach Falcon.
      if (req.method === 'GET' && url.pathname === '/api/dossier/view') {
        if (!sameToken(url.searchParams.get('token'))) return send(401, { error: 'Unauthorized' });
        const name = path.basename(String(url.searchParams.get('name') || ''));
        const file = path.join(api.scoutFolder(), name);
        if (!/\.html$/i.test(name) || !fs.existsSync(file)) return send(404, { error: 'Not found' });
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
        });
        return res.end(fs.readFileSync(file));
      }
      if (!sameToken(req.headers['x-falcon-token'])) {
        return routes[`${req.method} ${url.pathname}`] || url.pathname === '/api/chat' || url.pathname === '/api/voice/session'
          ? send(401, { error: 'Unauthorized' }) : send(404, { error: 'Not found' });
      }
      if (req.method === 'POST' && url.pathname === '/api/voice/session') {
        const key = await api.voiceKey.get();
        if (!key) return send(409, { error: 'Voice needs an OpenAI key. Add one under the gear icon.' });
        const offer = await readText(req);
        if (!offer.startsWith('v=')) return send(400, { error: 'Bad connection offer.' });
        let callMe = 'sir';
        try { callMe = JSON.parse(fs.readFileSync(api.profileFile(), 'utf8')).callMe || 'sir'; } catch { /* default */ }
        const instructions = VOICE_INSTRUCTIONS.replaceAll('{{CALL_ME}}', callMe);
        // Nobody could try this against the live service before release, so do not rely on one exact
        // request being accepted. Try the preferred voice model with the full settings; if the service
        // refuses the settings, connect with the bare minimum and let the window send the rest once the
        // line is open; if it refuses the model, try the next one.
        const attempts = [];
        for (const model of VOICE_MODELS) {
          attempts.push({ model, full: true }, { model, full: false });
        }
        let lastStatus = 0;
        let lastText = '';
        for (const attempt of attempts) {
          const session = { type: 'realtime', model: attempt.model, audio: { output: { voice: VOICE_NAME } } };
          if (attempt.full) Object.assign(session, { instructions, tools: VOICE_TOOLS, tool_choice: 'auto' });
          const form = new FormData();
          form.set('sdp', offer);
          form.set('session', JSON.stringify(session));
          let upstream;
          try {
            upstream = await api.fetch('https://api.openai.com/v1/realtime/calls', {
              method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(30000),
            });
          } catch {
            return send(502, { error: 'The voice service could not be reached. Check the internet connection.' });
          }
          const text = await upstream.text();
          if (upstream.ok) {
            // Tell the window whether it still has to send Falcon's voice settings itself.
            res.writeHead(200, {
              'Content-Type': 'application/sdp', 'Cache-Control': 'no-store',
              'X-Falcon-Voice-Model': attempt.model,
              'X-Falcon-Voice-Setup': attempt.full ? 'done' : 'pending',
            });
            return res.end(text);
          }
          lastStatus = upstream.status;
          lastText = text;
          // A wrong key or an empty account will not get better by trying again.
          if ([401, 403, 429].includes(upstream.status)) break;
        }
        let detail = '';
        try { detail = String(JSON.parse(lastText).error?.message || '').slice(0, 160); } catch { /* not JSON */ }
        const reason = lastStatus === 401 || lastStatus === 403 ? 'OpenAI did not accept the key for the live voice.'
          : lastStatus === 429 ? 'The OpenAI account is out of credit or over its limit.'
            : `The live voice service refused the connection${detail ? ` (${detail})` : ''}.`;
        return send(502, { error: reason });
      }
      if (req.method === 'GET' && url.pathname === '/api/voice/setup') {
        if (!sameToken(req.headers['x-falcon-token'])) return send(401, { error: 'Unauthorized' });
        let callMe = 'sir';
        try { callMe = JSON.parse(fs.readFileSync(api.profileFile(), 'utf8')).callMe || 'sir'; } catch { /* default */ }
        return send(200, { instructions: VOICE_INSTRUCTIONS.replaceAll('{{CALL_ME}}', callMe), tools: VOICE_TOOLS });

      }
      if (req.method === 'POST' && url.pathname === '/api/chat') {
        const body = await readJson(req);
        const text = String(body.text || '').trim().slice(0, 8000);
        if (!text) return send(400, { error: 'Empty message' });
        return chat(text, res);
      }
      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) return send(404, { error: 'Not found' });
      return send(200, await handler(req.method === 'POST' ? await readJson(req) : {}));
    } catch {
      if (!res.headersSent) send(500, { error: 'Something went wrong.' }); else res.end();
    }
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {
    port: server.address().port,
    token,
    close: () => new Promise((resolve) => {
      try { api.directLine?.close(); } catch { /* already closed */ }
      clearTimeout(idleTimer);
      for (const res of clients) res.end();
      server.close(resolve);
      server.closeAllConnections?.();
    }),
  };
}
