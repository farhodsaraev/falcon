import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/app/server.js';
import { createVoiceKeyStore } from '../src/app/voicekey.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-voice-'));
const KEY = 'sk-proj-voicetestkey0123456789abcdefghij';

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
