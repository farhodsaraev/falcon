import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/app/server.js';
import { createVoiceKeyStore } from '../src/app/voicekey.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-voice-'));
const KEY = 'sk-proj-voicetestkey0123456789abcdefghij';

// Nobody could try the live voice against the real service before release, so the request must
// survive a refusal: of the settings, or of the voice model.
function voiceServer(respond) {
  const sent = [];
  return startServer({ engine: {
    voiceKey: { get: async () => KEY, set: async () => {} },
    profileFile: () => path.join(tmp, 'none.json'),
    readGateway: () => ({ port: 1, token: 'gw' }),
    fetch: async (url, options) => {
      const session = JSON.parse(options.body.get('session'));
      sent.push(session);
      return respond(session, sent.length);
    },
  } }).then((server) => ({ server, sent }));
}
const offer = (server) => fetch(`http://127.0.0.1:${server.port}/api/voice/session`, {
  method: 'POST', headers: { 'Content-Type': 'application/sdp', 'X-Falcon-Token': server.token }, body: 'v=0\r\no=- offer\r\n' });

test('live voice: if the settings are refused, it connects bare and hands the settings to the window', async () => {
  const { server, sent } = await voiceServer((session) => (session.instructions
    ? new Response(JSON.stringify({ error: { message: 'Unknown parameter: tools' } }), { status: 400 })
    : new Response('v=0\r\n', { status: 200 })));
  const r = await offer(server);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('X-Falcon-Voice-Setup'), 'pending');
  assert.equal(sent.length, 2);
  assert.deepEqual(Object.keys(sent[1]).sort(), ['audio', 'model', 'type']);
  const setup = await (await fetch(`http://127.0.0.1:${server.port}/api/voice/setup`, { headers: { 'X-Falcon-Token': server.token } })).json();
  assert.equal(setup.tools[0].name, 'ask_falcon');
  assert.match(setup.instructions, /British/);
  assert.notEqual((await fetch(`http://127.0.0.1:${server.port}/api/voice/setup`)).status, 200, 'not without the window\'s secret token');
  await server.close();
});

test('live voice: if a voice model is not available, the next one is tried', async () => {
  const { server, sent } = await voiceServer((session) => (session.model === 'gpt-realtime-2.1'
    ? new Response('v=0\r\n', { status: 200 })
    : new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 })));
  const r = await offer(server);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('X-Falcon-Voice-Model'), 'gpt-realtime-2.1');
  assert.equal(r.headers.get('X-Falcon-Voice-Setup'), 'done');
  assert.deepEqual(sent.map((s) => s.model), ['gpt-realtime-2.1-mini', 'gpt-realtime-2.1-mini', 'gpt-realtime-2.1']);
  await server.close();
});

test('live voice: a refused key or an empty account stops at once with a plain reason', async () => {
  for (const [status, words] of [[401, /did not accept the key/], [429, /out of credit/]]) {
    const { server, sent } = await voiceServer(() => new Response('{}', { status }));
    const r = await offer(server);
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, words);
    assert.equal(sent.length, 1, 'no pointless retries');
    await server.close();
  }
});

test('the voice key is stored unreadable on Windows, private to the user elsewhere, and comes back intact', async () => {
  const file = path.join(tmp, 'voice.key');
  await createVoiceKeyStore(file).set(KEY);
  const onDisk = fs.readFileSync(file, 'utf8');
  if (process.platform === 'win32') assert.ok(!onDisk.includes(KEY), 'not stored in the clear');
  else assert.equal(fs.statSync(file).mode & 0o077, 0, 'no access for other users');
  assert.equal(await createVoiceKeyStore(file).get(), KEY);
  assert.equal(await createVoiceKeyStore(path.join(tmp, 'missing.key')).get(), null);
});

test('voice: no key means a clear refusal; with a key the offer is relayed with Falcon\'s settings and the key never reaches the window', async () => {
  let stored = null;
  const sent = [];
  fs.writeFileSync(path.join(tmp, 'profile.json'), JSON.stringify({ callMe: 'boss' }));
  const server = await startServer({ engine: {
    voiceKey: { get: async () => stored, set: async (k) => { stored = k; } },
    profileFile: () => path.join(tmp, 'profile.json'),
    readGateway: () => ({ port: 1, token: 'gw' }),
    fetch: async (url, options) => {
      sent.push({ url: String(url), auth: options.headers.Authorization, sdp: options.body.get('sdp'), session: JSON.parse(options.body.get('session')) });
      return new Response('v=0\r\no=- answer\r\n', { status: 200 });
    },
  } });
  const base = `http://127.0.0.1:${server.port}`;
  const post = (token, body = 'v=0\r\no=- offer\r\n') => fetch(base + '/api/voice/session', {
    method: 'POST', headers: { 'Content-Type': 'application/sdp', 'X-Falcon-Token': token }, body });
  const status = async () => (await fetch(base + '/api/voice', { headers: { 'X-Falcon-Token': server.token } })).json();

  assert.equal((await post('wrong')).status, 401);
  assert.equal((await status()).available, false);
  const refused = await post(server.token);
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /OpenAI key/);
  assert.equal(sent.length, 0);

  stored = KEY;
  assert.equal((await status()).available, true);
  assert.equal((await post(server.token, 'not an offer')).status, 400);
  const ok = await post(server.token);
  assert.equal(ok.status, 200);
  const answer = await ok.text();
  assert.match(answer, /^v=0/);
  assert.ok(!answer.includes(KEY));

  const call = sent[0];
  assert.equal(call.url, 'https://api.openai.com/v1/realtime/calls');
  assert.equal(call.auth, `Bearer ${KEY}`);
  assert.match(call.sdp, /offer/);
  assert.equal(call.session.type, 'realtime');
  assert.equal(call.session.tools[0].name, 'ask_falcon');
  assert.match(call.session.instructions, /British/);
  assert.match(call.session.instructions, /Address the user as "boss"/);
  assert.doesNotMatch(call.session.instructions, /\{\{|openclaw/i);
  await server.close();
});
