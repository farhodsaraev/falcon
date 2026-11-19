import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/app/server.js';

const BILLING = 'openrouter rejected the request — looks like a billing issue on the account. Run `openclaw models auth login --provider openrouter`';
const sse = (lines) => new Response(lines.map((l) => `data: ${JSON.stringify(l)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200 });

// One Falcon whose engine refuses the key for billing until its block is lifted, as seen on a real PC.
// `credit`: what OpenRouter says about the account: 'ok' (topped up), 'empty', or 'key-limit'.
async function falcon({ credit, blocked = true }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-credit-'));
  fs.writeFileSync(path.join(dir, '.env'), 'OPENROUTER_API_KEY=sk-or-v1-test\n');
  const did = [];
  let block = blocked;
  const server = await startServer({ engine: {
    fastLane: async () => null,
    directLine: null,
    profileFile: () => path.join(dir, 'profile.json'),
    envFile: () => path.join(dir, '.env'),
    scoutProgressFile: () => path.join(dir, 'scout.json'),
    readGateway: () => ({ port: 1, token: 'gw' }),
    engineReady: async () => true,
    updateWakeMs: 1,
    creditWatchMs: 20,
    runEngine: async (args, { input } = {}) => {
      if (args[0] === 'approvals') return { code: 0, out: '{"approvals":[]}' };
      did.push(args.join(' ') + (input ? ` <${input.trim()}>` : ''));
      if (args[0] === 'models' && args[1] === 'status') {
        return { code: 0, out: `- openrouter effective=profiles | openrouter:default=sk-or-v1...test${block ? ' [disabled:billing 4h]' : ''}` };
      }
      if (args.includes('paste-api-key') && credit === 'ok') block = false;
      return { code: 0, out: '' };
    },
    fetch: async (url) => {
      url = String(url);
      if (url.endsWith('/api/v1/key')) return new Response(JSON.stringify({ data: { limit_remaining: credit === 'key-limit' ? 0 : 4.8 } }));
      if (url.endsWith('/api/v1/credits')) return new Response(JSON.stringify({ data: { total_credits: 71, total_usage: credit === 'empty' ? 71 : 66 } }));
      if (url.includes('/v1/chat/completions')) {
        return block ? sse([{ choices: [{ delta: { role: 'assistant' } }] }, { error: { message: BILLING, type: 'api_error' } }])
          : sse([{ choices: [{ delta: { content: 'Hello, sir.' } }] }]);
      }
      throw new Error(`unexpected ${url}`);
    },
  } });
  const chat = async () => (await fetch(`http://127.0.0.1:${server.port}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Falcon-Token': server.token }, body: JSON.stringify({ text: 'Hi' }) })).text();
  return { server, did, chat, unblock: () => { credit = 'ok'; } };
}
const spoken = (text) => [...text.matchAll(/event: delta\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]).text).join('');
const error = (text) => (/event: error\ndata: (.*)\n/.exec(text) || [])[1];

test('Credit: after a top-up, the engine\'s billing block is lifted by itself and the question is answered', async () => {
  const f = await falcon({ credit: 'ok' });
  try {
    const text = await f.chat();
    assert.equal(spoken(text).trim(), 'Hello, sir.');
    assert.equal(error(text), undefined);
    assert.match(text, /Reconnecting to the AI/);
    assert.deepEqual(f.did, ['models status', 'gateway stop', 'models auth paste-api-key --provider openrouter --profile-id openrouter:default <sk-or-v1-test>', 'gateway start'],
      'the key is saved again while the engine is stopped, which clears its block');
  } finally { await f.server.close(); }
});

test('Credit: an empty account is said plainly, with where to top up; then Falcon notices the top-up himself', async () => {
  const f = await falcon({ credit: 'empty' });
  try {
    const events = await fetch(`http://127.0.0.1:${f.server.port}/api/events?token=${f.server.token}`);
    const reader = events.body.getReader();
    await reader.read();
    const said = JSON.parse(error(await f.chat())).text;
    assert.match(said, /run out of credit/);
    assert.match(said, /openrouter\.ai\/settings\/credits/);
    assert.match(said, /notice by myself/);
    assert.doesNotMatch(said, /openclaw|billing issue/i, 'no engine talk');
    assert.ok(!f.did.includes('gateway stop'), 'nothing is restarted while there is no credit');
    f.unblock();
    let pushed = '';
    while (!/event: notice/.test(pushed)) pushed += new TextDecoder().decode((await reader.read()).value);
    assert.match(pushed, /credit is back/);
    assert.ok(f.did.includes('gateway start'));
    await reader.cancel();
    assert.equal(spoken(await f.chat()).trim(), 'Hello, sir.');
  } finally { await f.server.close(); }
});

test('Credit: a key with its own spending limit used up is told apart from an empty account', async () => {
  const f = await falcon({ credit: 'key-limit' });
  try {
    const said = JSON.parse(error(await f.chat())).text;
    assert.match(said, /spending limit/);
    assert.match(said, /openrouter\.ai\/settings\/keys/);
  } finally { await f.server.close(); }
});
