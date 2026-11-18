import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDirectLine, DirectLineUnavailable, stepText } from '../src/app/directline.js';
import { startServer } from '../src/app/server.js';

// A stand-in for the engine's end of the line. `script(method, params, engine)` answers each request;
// `engine.event(name, payload)` sends the window an event.
function fakeEngine(script) {
  const sockets = [];
  const seen = [];
  class FakeSocket {
    constructor(url) {
      this.url = url;
      sockets.push(this);
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'n', ts: 1 } }) }));
    }
    event(name, payload) { this.onmessage?.({ data: JSON.stringify({ type: 'event', event: name, payload }) }); }
    send(text) {
      const frame = JSON.parse(text);
      seen.push([frame.method, frame.params]);
      const reply = (ok, payload) => queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'res', id: frame.id, ok, ...(ok ? { payload } : { error: payload }) }) }));
      if (frame.method === 'connect') return reply(true, { type: 'hello-ok' });
      script(frame.method, frame.params, this, reply);
    }
    close() { queueMicrotask(() => this.onclose?.({ code: 1000 })); }
  }
  return { FakeSocket, sockets, seen };
}

test('direct line: greets the engine as a local helper asking only for what a conversation needs', async () => {
  const { FakeSocket, seen } = fakeEngine(() => {});
  const line = createDirectLine({ readGateway: () => ({ port: 4321, token: 'secret' }), WebSocketImpl: FakeSocket });
  await line.connect();
  const [method, params] = seen[0];
  assert.equal(method, 'connect');
  assert.deepEqual(params.scopes, ['operator.read', 'operator.write'], 'no approval or admin rights are asked for');
  assert.equal(params.auth.token, 'secret');
  assert.deepEqual([params.client.id, params.client.mode], ['gateway-client', 'backend']);
  line.close();
});

test('direct line: the answer arrives piece by piece, steps are announced, passages around a step are kept apart', async () => {
  const { FakeSocket } = fakeEngine((method, params, engine, reply) => {
    if (method !== 'chat.send') return;
    const runId = params.idempotencyKey;
    reply(true, { runId, status: 'started' });
    setTimeout(() => {
      engine.event('chat', { runId: 'someone-else', state: 'delta', deltaText: 'not for this request' });
      engine.event('chat', { runId, state: 'delta', deltaText: 'One moment.' });
      engine.event('agent', { runId, stream: 'tool', data: { phase: 'start', name: 'web_search', args: { query: 'tashkent population' } } });
      engine.event('agent', { runId, stream: 'tool', data: { phase: 'result', name: 'web_search' } });
      engine.event('chat', { runId, state: 'delta', deltaText: 'About 3 million' });
      engine.event('chat', { runId, state: 'final', message: { role: 'assistant', content: [{ type: 'text', text: 'About 3 million, sir.' }] } });
    }, 5);
  });
  const line = createDirectLine({ readGateway: () => ({ port: 1, token: 't' }), WebSocketImpl: FakeSocket });
  const pieces = []; const steps = [];
  const answer = await line.chat({ sessionKey: 'falcon-window', message: 'hi', onDelta: (p) => pieces.push(p), onStep: (s) => steps.push(s) });
  assert.equal(answer, 'One moment.\n\nAbout 3 million, sir.');
  assert.deepEqual(pieces, ['One moment.', '\n\nAbout 3 million', ', sir.'], 'the closing message fills in what the pieces missed');
  assert.deepEqual(steps, [{ name: 'web_search', args: { query: 'tashkent population' } }]);
  line.close();
});

test('direct line: Stop tells the engine to abandon the request', async () => {
  const { FakeSocket, seen } = fakeEngine((method, params, engine, reply) => {
    if (method === 'chat.send') reply(true, { runId: params.idempotencyKey, status: 'started' });
    if (method === 'chat.abort') { reply(true, { ok: true }); engine.event('chat', { runId: params.runId, state: 'aborted' }); }
  });
  const line = createDirectLine({ readGateway: () => ({ port: 1, token: 't' }), WebSocketImpl: FakeSocket });
  const control = new AbortController();
  const going = line.chat({ sessionKey: 'falcon-window', message: 'a long job', signal: control.signal });
  setTimeout(() => control.abort(), 20);
  await assert.rejects(going, { name: 'AbortError' });
  const abort = seen.find(([method]) => method === 'chat.abort');
  assert.equal(abort[1].sessionKey, 'falcon-window');
  assert.equal(abort[1].runId, seen.find(([method]) => method === 'chat.send')[1].idempotencyKey);
  line.close();
});

test('direct line: when the line cannot be opened or the request is refused, it says the request never started', async () => {
  const none = createDirectLine({ readGateway: () => null });
  await assert.rejects(none.chat({ sessionKey: 's', message: 'm' }), (err) => err instanceof DirectLineUnavailable && err.started === false);

  const { FakeSocket } = fakeEngine((method, params, engine, reply) => { if (method === 'chat.send') reply(false, { message: 'unknown method' }); });
  const refused = createDirectLine({ readGateway: () => ({ port: 1, token: 't' }), WebSocketImpl: FakeSocket });
  await assert.rejects(refused.chat({ sessionKey: 's', message: 'm' }), (err) => err.started === false);
  refused.close();
});

test('direct line: each step is described in the user\'s terms, never by the name of the machinery', () => {
  const cases = [
    [{ name: 'web_search', args: { query: 'USD to EUR today' } }, 'Searching the web: USD to EUR today'],
    [{ name: 'web_fetch', args: { url: 'https://www.bbc.com/news' } }, 'Reading bbc.com'],
    [{ name: 'exec', args: { command: 'powershell -File "C:\\x\\skills\\files\\find-files.ps1" -Query invoice' } }, 'Looking for the file'],
    [{ name: 'exec', args: { command: 'powershell -File "C:\\x\\skills\\documents\\make-document.ps1" -Open' } }, 'Making the document'],
    [{ name: 'exec', args: { command: 'whoami' } }, 'Running a command'],
    [{ name: 'read', args: { path: 'C:\\Users\\a\\.openclaw\\workspace\\skills\\documents\\SKILL.md' } }, 'Checking my notes'],
    [{ name: 'read', args: { path: 'C:\\Users\\a\\Desktop\\Plan 2027.docx' } }, 'Reading Plan 2027.docx'],
    [{ name: 'some_new_tool', args: {} }, 'Working on it'],
  ];
  for (const [step, want] of cases) {
    assert.equal(stepText(step), want);
    assert.doesNotMatch(stepText(step), /openclaw|exec|web_|tool|skill/i);
  }
  assert.equal(stepText({ name: 'web_search', args: { query: 'курс доллара' } }, true), 'Ищу в интернете: курс доллара');
});

test('the window uses the direct line first: steps reach it, Stop is remembered, and a line that is down falls back to the old way', async () => {
  const asked = [];
  let lineUp = true;
  const directLine = {
    close() {},
    async chat({ sessionKey, message, onDelta, onStep, signal }) {
      if (!lineUp) throw Object.assign(new DirectLineUnavailable('down'), { started: false });
      asked.push([sessionKey, message]);
      if (/long job/.test(message)) {
        await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('stopped'), { name: 'AbortError' }))));
      }
      onStep({ name: 'web_search', args: { query: 'weather tashkent' } });
      onDelta('Sunny, sir.\n\n[[did]] Checked the weather');
      return 'Sunny, sir.';
    },
  };
  const engineCalls = [];
  const s = await startServer({ engine: {
    readGateway: () => ({ port: 1, token: 'gw' }),
    profileFile: () => 'Z:\\none\\profile.json',
    fastLane: async () => null,
    directLine,
    runEngine: async (args) => { engineCalls.push(args.join(' ')); return { code: 0, out: '{"approvals":[]}' }; },
    fetch: async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'The old way, sir.' } }] })}\n\ndata: [DONE]\n\n`, { status: 200 }),
  } });
  const ask = (text, signal) => fetch(`http://127.0.0.1:${s.port}/api/chat`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'X-Falcon-Token': s.token }, body: JSON.stringify({ text }) }).then((r) => r.text());
  try {
    const text = await ask('What is the weather?');
    assert.match(text, /event: step\ndata: {"text":"Searching the web: weather tashkent"}/);
    assert.match(text, /Sunny, sir\./);
    assert.match(text, /event: actions\ndata: {"items":\["Checked the weather"\]}/);
    assert.doesNotMatch(text, /\[\[did/);
    assert.match(asked[0][0], /^falcon-window-/);
    assert.ok(!engineCalls.some((c) => c.startsWith('approvals pending')), 'no approval checking on the direct line');

    const control = new AbortController();
    const going = ask('Do a long job', control.signal).catch(() => 'stopped');
    await new Promise((r) => setTimeout(r, 100));
    control.abort();
    assert.equal(await going, 'stopped');
    await new Promise((r) => setTimeout(r, 100));
    await ask('And now?');
    assert.match(asked.at(-1)[1], /pressed Stop on your previous request/, 'he is told the last job was cancelled');

    lineUp = false;
    const fallback = await ask('Still there?');
    assert.equal([...fallback.matchAll(/event: delta\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]).text).join(''), 'The old way, sir.');
  } finally { await s.close(); }
});
