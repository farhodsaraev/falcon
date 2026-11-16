// Falcon's window server. Only this PC can reach it.
// It serves the window, runs first-time setup, relays the chat to the local engine,
// and shows the engine's approval requests so the user can answer them in the window.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { engineReady, findEngine, installEngine, readGateway, runEngine } from './engine.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const UI_DIR = path.join(root, 'ui');
const PACK_DIR = path.join(root, 'falcon-agent');
const UI_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/renderer.js': ['renderer.js', 'text/javascript; charset=utf-8'],
  '/bridge.js': ['bridge.js', 'text/javascript; charset=utf-8'],
};
const PROFILE_FILE = path.join(os.homedir(), '.falcon', 'profile.json');
const KEY_SHAPE = /^[A-Za-z0-9_\-]{20,300}$/;
const SESSION_KEY = 'falcon-window';
const BRIEFING_NAME = 'falcon-morning-briefing';

// Which AI model Falcon thinks with, per kind of key. Chosen by running scripts/quality-check.mjs:
// these followed Falcon's safety rules every time (never typing a dictated password, asking before
// deleting). The engine's own default for an OpenAI key costs about ten times more, and OpenAI's
// cheapest model typed a password it was told not to. The engine's default stays as the fallback.
function providerFor(key) {
  if (key.startsWith('sk-or-')) return ['openrouter-api-key', '--openrouter-api-key', 'openrouter/anthropic/claude-haiku-5.5'];
  if (key.startsWith('sk-ant-')) return ['apiKey', '--anthropic-api-key', null];
  return ['openai-api-key', '--openai-api-key', 'openai/gpt-6.1-terra'];
}

export async function startServer({ port = 0, engine = {} } = {}) {
  // `engine` lets tests replace the real engine with stand-ins.
  const installFalcon = async (options) => {
    const pack = await import(pathToFileURL(path.join(PACK_DIR, 'install-falcon.mjs')).href);
    return pack.installFalcon(options);
  };
  const workspaceDir = () => path.join(os.homedir(), '.openclaw', 'workspace');
  const api = { engineReady, findEngine, installEngine, installFalcon, readGateway, runEngine, fetch, workspaceDir, profileFile: () => PROFILE_FILE, ...engine };
  const token = crypto.randomBytes(24).toString('hex');
  const clients = new Set();
  const shownApprovals = new Set();
  let chatsInFlight = 0;
  let pollerRunning = false;
  let setupRunning = false;

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
    fs.mkdirSync(path.dirname(telegramFile()), { recursive: true });
    fs.writeFileSync(telegramFile(), JSON.stringify({ chat }));
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
  async function setup({ key, accepted }) {
    const step = (text) => broadcast('setup', { text });
    if (!accepted) return { ok: false, error: 'Please tick the box to continue.' };

    if (!api.findEngine()) {
      step('Installing the engine. This takes a few minutes…');
      const install = await api.installEngine();
      if (!api.findEngine()) return { ok: false, error: 'The engine could not be installed.', detail: install.out.slice(-600) };
    }

    if (!api.readGateway()) {
      if (!KEY_SHAPE.test(key || '')) return { ok: false, error: 'That does not look like an API key.' };
      step('Connecting your AI key…');
      const [choice, flag, preferred] = providerFor(key);
      const onboard = await api.runEngine(['onboard', '--non-interactive', '--accept-risk', '--mode', 'local',
        '--auth-choice', choice, flag, key, '--gateway-bind', 'loopback', '--gateway-auth', 'token',
        '--install-daemon', '--agent-name', 'Falcon'], { timeoutMs: 600000 });
      if (onboard.code !== 0 || !api.readGateway()) {
        return { ok: false, error: 'The key could not be connected.', detail: onboard.out.slice(-600) };
      }
      if (preferred) {
        // Keep whatever the engine picked as the fallback, so Falcon still answers if our choice is refused.
        const current = (await api.runEngine(['models', 'status', '--plain'], { timeoutMs: 60000 })).out.trim().split(/\r?\n/).pop() || '';
        const chosen = await api.runEngine(['models', 'set', preferred], { timeoutMs: 60000 });
        if (chosen.code === 0 && /^[\w.~-]+\/[\w./:~-]+$/.test(current) && current !== preferred) {
          await api.runEngine(['models', 'fallbacks', 'add', current], { timeoutMs: 60000 });
        }
      }
    }

    step('Starting…');
    await api.runEngine(['gateway', 'start'], { timeoutMs: 120000 });

    step('Teaching Falcon his manners…');
    const notes = [];
    try {
      await api.installFalcon({ runEngine: api.runEngine, log: (line) => notes.push(line) });
    } catch (err) {
      return { ok: false, error: 'Falcon could not be installed.', detail: `${err.message}\n${notes.join('\n')}`.slice(-600) };
    }

    step('Waking Falcon…');
    for (let i = 0; i < 30; i++) {
      if (await api.engineReady()) return { ok: true };
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return { ok: false, error: 'Falcon did not wake up. Please restart the computer and try again.' };
  }

  // ---- Chat: relay to the engine and stream the answer back ----
  async function chat(text, res) {
    const gateway = api.readGateway();
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    chatsInFlight++;
    pollApprovals();
    try {
      const upstream = await api.fetch(`http://127.0.0.1:${gateway.port}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gateway.token}`,
          'x-openclaw-session-key': SESSION_KEY,
        },
        body: JSON.stringify({ model: 'openclaw/default', stream: true, messages: [{ role: 'user', content: text }] }),
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
            if (delta) send('delta', { text: delta });
          } catch { /* keep-alive or partial line */ }
        }
      }
      send('done', {});
    } catch {
      send('error', { text: 'I have lost my connection, sir. Please try again in a moment.' });
    } finally {
      chatsInFlight--;
      res.end();
    }
  }

  const routes = {
    'GET /api/state': async () => {
      const configured = Boolean(api.readGateway());
      let ready = configured && await api.engineReady();
      if (configured && !ready && !setupRunning) {
        // Set up before but asleep (for example after a restart): wake it quietly.
        await api.runEngine(['gateway', 'start'], { timeoutMs: 120000 });
        await api.runEngine(['config', 'set', 'gateway.http.endpoints.chatCompletions.enabled', 'true']);
        ready = await api.engineReady();
      }
      return { configured, ready };
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
      return { ok: true, callMe: profile.callMe };
    },

    // ---- AI keys: add or replace one later. The key travels on standard input, never on a command line. ----
    'POST /api/key': async (body) => {
      const key = String(body.key || '').trim();
      if (!KEY_SHAPE.test(key)) return { ok: false, error: 'That does not look like an API key.' };
      const provider = key.startsWith('sk-or-') ? 'openrouter' : key.startsWith('sk-ant-') ? 'anthropic' : 'openai';
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
      const names = { openrouter: 'OpenRouter', anthropic: 'Anthropic', openai: 'OpenAI' };
      return { ok: true, provider: names[provider] };
    },

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
      return result.code === 0 ? { ok: true } : { ok: false, error: 'Telegram did not accept that token.' };
    },
    'POST /api/telegram/pair': async (body) => {
      const code = String(body.code || '').trim().toUpperCase();
      if (!/^[A-Z0-9-]{4,20}$/.test(code)) return { ok: false, error: 'That does not look like a pairing code.' };
      // Note who is asking before approving, so Falcon later knows which chat to write to first.
      const pending = await api.runEngine(['pairing', 'list', '--channel', 'telegram', '--json'], { timeoutMs: 60000 });
      const result = await api.runEngine(['pairing', 'approve', 'telegram', code, '--notify'], { timeoutMs: 60000 });
      if (result.code !== 0) return { ok: false, error: 'That code was not recognised. Send your bot a new message and use the newest code.' };
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
        req.on('close', () => clients.delete(res));
        return;
      }
      if (!sameToken(req.headers['x-falcon-token'])) {
        return routes[`${req.method} ${url.pathname}`] || url.pathname === '/api/chat'
          ? send(401, { error: 'Unauthorized' }) : send(404, { error: 'Not found' });
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

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    token,
    close: () => new Promise((resolve) => {
      for (const res of clients) res.end();
      server.close(resolve);
      server.closeAllConnections?.();
    }),
  };
}
