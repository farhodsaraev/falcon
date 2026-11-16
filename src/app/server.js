// Falcon's window server. Only this PC can reach it.
// It serves the window, runs first-time setup, relays the chat to the local engine,
// and shows the engine's approval requests so the user can answer them in the window.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
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
const KEY_SHAPE = /^[A-Za-z0-9_\-]{20,300}$/;
const SESSION_KEY = 'falcon-window';

function providerFor(key) {
  if (key.startsWith('sk-or-')) return ['openrouter-api-key', '--openrouter-api-key'];
  if (key.startsWith('sk-ant-')) return ['apiKey', '--anthropic-api-key'];
  return ['openai-api-key', '--openai-api-key'];
}

export async function startServer({ port = 0, engine = {} } = {}) {
  // `engine` lets tests replace the real engine with stand-ins.
  const installFalcon = async (options) => {
    const pack = await import(pathToFileURL(path.join(PACK_DIR, 'install-falcon.mjs')).href);
    return pack.installFalcon(options);
  };
  const api = { engineReady, findEngine, installEngine, installFalcon, readGateway, runEngine, fetch, ...engine };
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
      const [choice, flag] = providerFor(key);
      const onboard = await api.runEngine(['onboard', '--non-interactive', '--accept-risk', '--mode', 'local',
        '--auth-choice', choice, flag, key, '--gateway-bind', 'loopback', '--gateway-auth', 'token',
        '--install-daemon', '--agent-name', 'Falcon'], { timeoutMs: 600000 });
      if (onboard.code !== 0 || !api.readGateway()) {
        return { ok: false, error: 'The key could not be connected.', detail: onboard.out.slice(-600) };
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
