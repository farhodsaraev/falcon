import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDirectLine, DirectLineUnavailable, stepText, stepSkill } from '../src/app/directline.js';
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
  // Seen on the real engine: the short title carries quotes and how many results were asked for.
  assert.equal(stepText({ name: 'web_search', args: {}, meta: '"Tashkent weather today" (top 5)' }), 'Searching the web: Tashkent weather today');
});

test('direct line: each step names the skill it uses, so the window can light it up', () => {
  const cases = [
    [{ name: 'web_search', args: { query: 'x' } }, 'search'],
    [{ name: 'browser', args: { url: 'https://calendar.google.com/calendar/r' } }, 'mail'],
    [{ name: 'browser', args: { url: 'https://bbc.com/news' } }, 'browser'],
    [{ name: 'exec', args: { command: 'powershell -File "C:\\x\\skills\\documents\\make-document.ps1"' } }, 'documents'],
    [{ name: 'message', args: { channel: 'telegram' } }, 'telegram'],
    [{ name: 'exec', args: { command: 'powershell -File "C:\\x\\skills\\presentations\\slides.ps1" -Go 5' } }, 'slides'],
    [{ name: 'exec', args: { command: 'powershell -File "C:\\x\\skills\\files\\find-files.ps1" -Query invoice' } }, 'files'],
    [{ name: 'exec', args: { command: 'whoami' } }, ''],
    [{ name: 'read', args: { path: 'C:\\Users\\a\\.openclaw\\workspace\\SKILL.md' } }, ''],
    [{ name: 'read', args: { path: 'C:\\Users\\a\\Desktop\\Plan.docx' } }, 'files'],
    [{ name: 'image_generate', args: {} }, 'pictures'],
    [{ name: 'some_new_tool', args: {} }, ''],
  ];
  for (const [step, want] of cases) assert.equal(stepSkill(step), want, JSON.stringify(step));
});

test('direct line: watching a conversation reports each step once, whoever sent the request; stop names the conversation', async () => {
  const { FakeSocket, sockets, seen } = fakeEngine((method, params, engine, reply) => { if (method === 'chat.abort') reply(true, { ok: true }); });
  const line = createDirectLine({ readGateway: () => ({ port: 1, token: 't' }), WebSocketImpl: FakeSocket });
  const steps = [];
  const unwatch = line.watch('falcon-window-ab12', (s) => steps.push(s));
  await line.connect();
  const engine = sockets[0];
  const item = (sessionKey, id, name, meta) => engine.event('agent', { sessionKey, stream: 'item', data: { kind: 'tool', phase: 'start', toolCallId: id, name, meta } });
  item('agent:falcon:falcon-window-ab12', 't1', 'web_search', 'population of Samarkand');
  engine.event('agent', { sessionKey: 'agent:falcon:falcon-window-ab12', stream: 'tool', data: { phase: 'start', toolCallId: 't1', name: 'web_search', args: { query: 'population of Samarkand' } } });
  item('agent:falcon:someone-else', 't2', 'exec', 'Something private');
  item('agent:falcon:falcon-window-ab12', 't3', 'exec', 'List pictures for a nature wallpaper');
  assert.deepEqual(steps.map((s) => stepText(s)), ['Searching the web: population of Samarkand', 'List pictures for a nature wallpaper']);
  assert.equal(await line.stop('falcon-window-ab12'), true);
  assert.deepEqual(seen.find(([m]) => m === 'chat.abort')[1], { sessionKey: 'falcon-window-ab12' });
  unwatch();
  item('agent:falcon:falcon-window-ab12', 't4', 'exec', 'After the watch ended');
  assert.equal(steps.length, 2);
  line.close();
});

test('the window sends requests the owner\'s way and uses the direct line to show steps and to stop', async () => {
  const stopped = [];
  let report;
  const directLine = {
    close() {},
    watch(sessionKey, onStep) { report = onStep; return () => { report = null; }; },
    stop(sessionKey) { stopped.push(sessionKey); return Promise.resolve(true); },
  };
  const sent = [];
  const s = await startServer({ engine: {
    readGateway: () => ({ port: 1, token: 'gw' }),
    profileFile: () => 'Z:\none\profile.json',
    fastLane: async () => null,
    directLine,
    runEngine: async () => ({ code: 0, out: '{"approvals":[]}' }),
    fetch: async (url, options) => {
      const said = JSON.parse(options.body).messages[0].content;
      sent.push([options.headers['x-openclaw-session-key'], said]);
      if (/long job/.test(said)) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
      report({ name: 'web_search', args: {}, meta: 'weather tashkent' });
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Sunny, sir.\n\n[[did]] Checked the weather' } }] })}\n\ndata: [DONE]\n\n`, { status: 200 });
    },
  } });
  const ask = (text, signal) => fetch(`http://127.0.0.1:${s.port}/api/chat`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'X-Falcon-Token': s.token }, body: JSON.stringify({ text }) }).then((r) => r.text());
  try {
    const text = await ask('What is the weather?');
    assert.match(text, /event: step\ndata: {"text":"Searching the web: weather tashkent","skill":"search"}/);
    assert.match(text, /Sunny, sir\./);
    assert.match(text, /event: actions\ndata: {"items":\["Checked the weather"\]}/);
    assert.match(sent[0][0], /^falcon-window-/, 'sent to the engine\'s web address, where it counts as the owner\'s');
    assert.equal(report, null, 'the watch ends with the request');

    const control = new AbortController();
    const going = ask('Do a long job', control.signal).catch(() => 'stopped');
    await new Promise((r) => setTimeout(r, 100));
    control.abort();
    assert.equal(await going, 'stopped');
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(stopped, [sent[0][0]], 'Stop reaches the engine for this conversation');
    await ask('And now?');
    assert.match(sent.at(-1)[1], /pressed Stop on your previous request/, 'he is told the last job was cancelled');
  } finally { await s.close(); }
});

test('the step of saving something learned is named in the user\'s words', () => {
  assert.equal(stepText({ name: 'skill_workshop', args: { action: 'create', name: 'cbu-usd-rate' } }), 'Saving what I learned');
  assert.equal(stepText({ name: 'skill_workshop', args: { action: 'create' } }, true), 'Запоминаю, как это делать');
  assert.equal(stepText({ name: 'skill_workshop', args: { action: 'archive' } }), 'Updating what I learned');
  assert.equal(stepText({ name: 'skill_workshop', args: { action: 'list' } }), 'Checking what I have learned');
  assert.equal(stepSkill({ name: 'skill_workshop', args: { action: 'create' } }), 'learned');
  // Using something learned: its program, or reading its method.
  const program = 'powershell -NoProfile -File "C:\\Users\\a\\.falcon\\engine\\agents\\falcon\\agent\\workshop-skills\\c-drive-free-space\\scripts\\cdrive-free.ps1"';
  assert.equal(stepText({ name: 'exec', args: { command: program } }), 'Using something I learned');
  assert.equal(stepSkill({ name: 'exec', args: { command: program } }), 'learned');
  assert.equal(stepText({ name: 'exec', meta: 'Run C drive free-space script from learned-skills folder' }), 'Using something I learned');
  assert.equal(stepSkill({ name: 'read', args: { path: 'C:\\Users\\a\\.falcon\\engine\\agents\\falcon\\agent\\workshop-skills\\x\\SKILL.md' } }), 'learned');
});
