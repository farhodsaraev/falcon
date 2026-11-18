// Falcon's direct line to his engine: one standing local connection instead of a new web request (and a
// freshly started command-line program) for every question. Over it the answer arrives as it is written,
// every step he takes is announced as it happens, and a running request can really be stopped.
// If the line cannot be opened, the window falls back to the engine's web address, as before.
import path from 'node:path';

export class DirectLineUnavailable extends Error {}

const CONNECT_TIMEOUT_MS = 8000;

/**
 * @param {object} options
 * @param {Function} options.readGateway  () => { port, token } | null
 * @param {Function} [options.WebSocketImpl]
 */
export function createDirectLine({ readGateway, WebSocketImpl = globalThis.WebSocket, connectTimeoutMs = CONNECT_TIMEOUT_MS } = {}) {
  let ws = null;
  let ready = null;          // promise of an open, greeted connection
  let counter = 0;
  const pending = new Map(); // request id -> { resolve, reject, timer }
  const runs = new Map();    // run id -> (event, payload) => void

  function drop(reason) {
    const error = new DirectLineUnavailable(reason);
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(error); }
    pending.clear();
    for (const handler of [...runs.values()]) handler('closed', {});
    ready = null;
    try { ws?.close(); } catch { /* already closed */ }
    ws = null;
  }

  function send(method, params, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const id = `f${++counter}`;
      const timer = setTimeout(() => { pending.delete(id); reject(new DirectLineUnavailable(`${method} was not answered`)); }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      try { ws.send(JSON.stringify({ type: 'req', id, method, params })); } catch { clearTimeout(timer); pending.delete(id); reject(new DirectLineUnavailable('the line is closed')); }
    });
  }

  function connect() {
    if (ready) return ready;
    const gateway = readGateway();
    if (!gateway || !WebSocketImpl) return Promise.reject(new DirectLineUnavailable('the engine is not set up'));
    const attempt = new Promise((resolve, reject) => {
      const socket = new WebSocketImpl(`ws://127.0.0.1:${gateway.port}`);
      ws = socket;
      const timer = setTimeout(() => { if (ws === socket) drop('no answer'); reject(new DirectLineUnavailable('the engine did not answer on its direct line')); }, connectTimeoutMs);
      timer.unref?.();
      socket.onerror = () => { /* onclose follows */ };
      socket.onclose = () => { clearTimeout(timer); if (ws === socket) drop('the line closed'); reject(new DirectLineUnavailable('the line closed')); };
      socket.onmessage = (message) => {
        let frame;
        try { frame = JSON.parse(message.data); } catch { return; }
        if (frame.type === 'event' && frame.event === 'connect.challenge') {
          // A local helper program that holds the engine's own token: the engine's documented way for
          // software on the same computer. It asks only for what a conversation needs.
          send('connect', {
            minProtocol: 4, maxProtocol: 4,
            client: { id: 'gateway-client', version: '0.2.0', platform: process.platform, mode: 'backend' },
            role: 'operator', scopes: ['operator.read', 'operator.write'], caps: ['tool-events'], commands: [], permissions: {},
            auth: { token: gateway.token }, locale: 'en-US', userAgent: 'falcon-window',
          }, connectTimeoutMs).then(() => { clearTimeout(timer); resolve(); }, (err) => { clearTimeout(timer); if (ws === socket) drop('refused'); reject(err); });
          return;
        }
        if (frame.type === 'res') {
          const waiting = pending.get(frame.id);
          if (!waiting) return;
          pending.delete(frame.id);
          clearTimeout(waiting.timer);
          if (frame.ok) waiting.resolve(frame.payload);
          else waiting.reject(new DirectLineUnavailable(String(frame.error?.message || 'the engine refused the request')));
          return;
        }
        if (frame.type === 'event' && (frame.event === 'chat' || frame.event === 'agent')) {
          const handler = runs.get(frame.payload?.runId);
          if (handler) handler(frame.event, frame.payload);
        }
      };
    });
    ready = attempt;
    attempt.catch(() => { if (ready === attempt) ready = null; });
    return attempt;
  }

  /**
   * Sends one message into a conversation and resolves with the full answer when it is finished.
   * Throws DirectLineUnavailable (with `.started === false`) if the request never reached the engine,
   * so the caller may send it another way; an AbortError when `signal` stopped it.
   *   onDelta(text)          each new piece of the answer
   *   onStep({ name, args }) each tool he starts
   */
  async function chat({ sessionKey, message, onDelta = () => {}, onStep = () => {}, signal }) {
    try { await connect(); } catch (err) { err.started = false; throw err; }
    const runId = `falcon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    let full = '';
    let gap = false;
    let passage = '';      // what he has written since the last step
    let settle;
    const finished = new Promise((resolve, reject) => { settle = { resolve, reject }; });
    finished.catch(() => {});
    const stopped = () => Object.assign(new Error('stopped'), { name: 'AbortError' });
    runs.set(runId, (event, payload) => {
      if (event === 'closed') return settle.reject(Object.assign(new DirectLineUnavailable('the line closed while he was working'), { started: true }));
      if (event === 'agent') {
        if (payload.stream === 'tool' && payload.data?.phase === 'start') {
          // Words written before a step and words written after it are separate passages.
          if (full && !/\s$/.test(full)) gap = true;
          try { onStep({ name: payload.data.name, args: payload.data.args || {} }); } catch { /* display only */ }
        }
        return;
      }
      if (payload.state === 'delta' && payload.deltaText) {
        const piece = gap ? `\n\n${payload.deltaText}` : payload.deltaText;
        if (gap) passage = '';
        gap = false;
        passage += payload.deltaText;
        full += piece;
        try { onDelta(piece); } catch { /* display only */ }
      }
      else if (payload.state === 'final') {
        // The closing message carries the whole last passage: pass on whatever the pieces did not cover.
        const last = (payload.message?.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('');
        if (gap) passage = '';
        if (last && last !== passage && !(passage === '' && full.includes(last))) {
          const rest = last.startsWith(passage) ? last.slice(passage.length) : (full ? `\n\n${last}` : last);
          full += rest;
          try { onDelta(rest); } catch { /* display only */ }
        }
        settle.resolve(full);
      } else if (payload.state === 'aborted') settle.reject(stopped());
      else if (payload.state === 'error') settle.reject(Object.assign(new Error(String(payload.errorMessage || payload.error?.message || 'the engine reported an error')), { started: true }));
    });
    const onAbort = () => {
      send('chat.abort', { sessionKey, runId }, 10000).catch(() => {});
      // Do not wait for the engine to confirm before letting go of the window.
      setTimeout(() => settle.reject(stopped()), 1500).unref?.();
    };
    try {
      if (signal?.aborted) throw stopped();
      try { await send('chat.send', { sessionKey, message, idempotencyKey: runId }); } catch (err) { err.started = false; throw err; }
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      return await finished;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      runs.delete(runId);
    }
  }

  return { chat, connect, close: () => drop('closed'), connected: () => Boolean(ready && ws) };
}

/**
 * One line, in the user's own terms, for a step Falcon has just started. Never names the machinery:
 * it says what is being done for him, not which tool does it.
 */
export function stepText({ name, args = {} }, russian = false) {
  const say = (en, ru) => (russian ? ru : en);
  const short = (text, max = 48) => { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
  const host = (url) => { try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const file = (p) => path.win32.basename(String(p || '').replace(/\//g, '\\'));
  const command = String(args.command || '');
  switch (name) {
    case 'exec':
      if (/slides\.(ps1|mjs)/.test(command)) return say('Working on the presentation', 'Работаю с презентацией');
      if (/find-files\.(ps1|mjs)/.test(command)) return say('Looking for the file', 'Ищу файл');
      if (/read-file\.(ps1|mjs)/.test(command)) return say('Reading the file', 'Читаю файл');
      if (/share-file\.(ps1|mjs)/.test(command)) return say('Getting the file ready to send', 'Готовлю файл к отправке');
      if (/screenshot\.(ps1|mjs)/.test(command)) return say('Looking at the screen', 'Смотрю на экран');
      if (/make-document\.(ps1|mjs)/.test(command)) return say('Making the document', 'Создаю документ');
      if (/scout[\w.-]*\.(ps1|mjs)/.test(command)) return say('Scouting public sources', 'Изучаю открытые источники');
      if (/daily\.mjs/.test(command)) return say('Checking your day', 'Смотрю ваш день');
      if (/apps\.(ps1|mjs)/.test(command)) return say('Working in the app', 'Работаю в приложении');
      return say('Running a command', 'Выполняю команду');
    case 'web_search': return args.query ? say(`Searching the web: ${short(args.query)}`, `Ищу в интернете: ${short(args.query)}`) : say('Searching the web', 'Ищу в интернете');
    case 'web_fetch': return host(args.url) ? say(`Reading ${host(args.url)}`, `Читаю ${host(args.url)}`) : say('Reading a page', 'Читаю страницу');
    case 'browser': return host(args.url || args.targetUrl) ? say(`Working in the browser: ${host(args.url || args.targetUrl)}`, `Работаю в браузере: ${host(args.url || args.targetUrl)}`) : say('Working in the browser', 'Работаю в браузере');
    case 'read': {
      const p = String(args.path || args.file_path || '');
      if (/[\\/]\.openclaw[\\/]/.test(p)) return say('Checking my notes', 'Сверяюсь с заметками');
      return file(p) ? say(`Reading ${short(file(p), 40)}`, `Читаю ${short(file(p), 40)}`) : say('Reading a file', 'Читаю файл');
    }
    case 'write': case 'edit': case 'apply_patch': {
      const p = String(args.path || args.file_path || '');
      if (/[\\/]\.openclaw[\\/]/.test(p)) return say('Preparing the details', 'Готовлю данные');
      return say('Writing a file', 'Записываю файл');
    }
    case 'memory_search': case 'memory_get': return say('Checking my memory', 'Вспоминаю');
    case 'message': return say('Sending it to you', 'Отправляю вам');
    case 'image': return say('Looking at the picture', 'Смотрю на изображение');
    case 'computer': return say('Working on the screen', 'Работаю на экране');
    default: return say('Working on it', 'Работаю над этим');
  }
}
