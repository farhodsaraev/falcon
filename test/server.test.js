import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/app/server.js';

// A stand-in engine, so these checks never touch the real one.
const calls = [];
let configured = false;
let pending = [];
const engine = {
  findEngine: () => ({ command: 'node', prefix: [] }),
  readGateway: () => (configured ? { port: 1, token: 'gw' } : null),
  engineReady: async () => configured,
  installEngine: async () => { calls.push(['install-engine']); return { code: 0, out: '' }; },
  installFalcon: async (options) => { calls.push(['install-falcon', typeof options.runEngine]); return { ok: true }; },
  runEngine: async (args) => {
    calls.push(args);
    if (args[0] === 'onboard') configured = true;
    if (args[0] === 'approvals' && args[1] === 'pending') return { code: 0, out: JSON.stringify({ approvals: pending }) };
    return { code: 0, out: '{}' };
  },
  fetch: async (url, options) => {
    calls.push(['fetch', url, options.headers.Authorization, JSON.parse(options.body).messages[0].content]);
    const sse = ['Slide five ', 'is up, sir.'].map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`).join('') + 'data: [DONE]\n\n';
    await new Promise((r) => setTimeout(r, 2500));          // long enough for one approvals poll
    return new Response(sse, { status: 200 });
  },
};

let server; let base;
before(async () => { server = await startServer({ engine }); base = `http://127.0.0.1:${server.port}`; });
after(() => server.close());

const call = (method, route, body, token = server.token) => fetch(base + route, {
  method, headers: { 'Content-Type': 'application/json', 'X-Falcon-Token': token },
  body: body ? JSON.stringify(body) : undefined,
});

test('the window page loads and says Falcon', async () => {
  const text = await (await fetch(base + '/')).text();
  assert.match(text, /F A L C O N/);
  assert.doesNotMatch(text, /openclaw|jarvis/i);
});

test('nothing works without the secret token', async () => {
  assert.equal((await call('GET', '/api/state', null, 'wrong')).status, 401);
  assert.equal((await call('POST', '/api/chat', { text: 'hi' }, '')).status, 401);
  assert.equal((await call('POST', '/api/setup', { key: 'x' }, 'wrong')).status, 401);
  assert.equal((await fetch(base + '/api/events?token=wrong')).status, 401);
  assert.equal((await fetch(base + '/src/app/server.js')).status, 404);
});

test('setup refuses without consent or with a malformed key, and runs nothing', async () => {
  calls.length = 0;
  assert.equal((await (await call('POST', '/api/setup', { key: 'sk-test-12345678901234567890', accepted: false })).json()).ok, false);
  assert.equal((await (await call('POST', '/api/setup', { key: 'bad key; rm -rf', accepted: true })).json()).ok, false);
  assert.equal(calls.filter((c) => c[0] === 'onboard').length, 0);
});

test('setup connects the key with the right provider and installs Falcon', async () => {
  calls.length = 0;
  const r = await (await call('POST', '/api/setup', { key: 'sk-or-v1-12345678901234567890', accepted: true })).json();
  assert.equal(r.ok, true);
  const onboard = calls.find((c) => c[0] === 'onboard');
  assert.ok(onboard.includes('--accept-risk') && onboard.includes('openrouter-api-key'));
  assert.ok(calls.some((c) => c[0] === 'install-falcon' && c[1] === 'function'));
  assert.equal(calls.filter((c) => c[0] === 'install-engine').length, 0);   // engine was already there
  assert.equal((await (await call('GET', '/api/state')).json()).ready, true);
});

test('chat is relayed to the engine and streamed back; approvals show up meanwhile', async () => {
  pending = [{ id: 'abcd1234-aaaa', kind: 'exec', summary: 'whoami' }];
  const events = await fetch(`${base}/api/events?token=${server.token}`);
  const reader = events.body.getReader();
  await reader.read();
  const chat = await call('POST', '/api/chat', { text: 'Open slide 5' });
  const text = await chat.text();
  assert.match(text, /Slide five /);
  assert.match(text, /is up, sir\./);
  assert.match(text, /event: done/);
  const relayed = calls.find((c) => c[0] === 'fetch');
  assert.equal(relayed[2], 'Bearer gw');
  assert.equal(relayed[3], 'Open slide 5');
  const pushed = new TextDecoder().decode((await reader.read()).value);
  assert.match(pushed, /event: approval/);
  assert.match(pushed, /whoami/);
  await reader.cancel();
  pending = [];
});

test('Telegram: a well-formed token and code are passed on; malformed ones never reach the engine', async () => {
  calls.length = 0;
  const post = async (route, body) => (await call('POST', route, body)).json();
  assert.equal((await post('/api/telegram/connect', { token: 'hello; rm -rf /' })).ok, false);
  assert.equal((await post('/api/telegram/pair', { code: 'a b"; calc' })).ok, false);
  assert.equal(calls.length, 0);
  assert.equal((await post('/api/telegram/connect', { token: '123456789:AAEabcdefghijklmnopqrstuvwxyz0123456' })).ok, true);
  assert.deepEqual(calls[0].slice(0, 5), ['channels', 'add', '--channel', 'telegram', '--token']);
  assert.equal((await post('/api/telegram/pair', { code: 'ab12cd34' })).ok, true);
  assert.deepEqual(calls[1].slice(0, 4), ['pairing', 'approve', 'telegram', 'AB12CD34']);
});

test('an approval answer is passed on, and odd answers are refused', async () => {
  calls.length = 0;
  assert.equal((await (await call('POST', '/api/approval', { id: 'abcd1234-aaaa', decision: 'allow-once' })).json()).ok, true);
  assert.deepEqual(calls[0].slice(0, 4), ['approvals', 'resolve', 'abcd1234-aaaa', 'allow-once']);
  assert.equal((await (await call('POST', '/api/approval', { id: 'abcd1234-aaaa', decision: 'allow-always' })).json()).ok, false);
  assert.equal((await (await call('POST', '/api/approval', { id: 'x; calc', decision: 'deny' })).json()).ok, false);
});
