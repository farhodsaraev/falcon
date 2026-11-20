import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { startServer } from '../src/app/server.js';

const source = fs.readFileSync(new URL('../ui/chats.js', import.meta.url), 'utf8');
const createChats = vm.runInNewContext(`${source}\ncreateChats`);

test('chats keep exchanges and attachments, and report storage failure', async () => {
  let data = []; let fail = false; let warning = '';
  const storage = { load: async () => data, save: async (value) => { if (fail) throw Error(); data = value; } };
  let next = 0;
  const chats = createChats(storage, () => `chat-${++next}`, (message) => { warning = message; });
  await chats.load();
  const first = chats.id();
  chats.question('First question'); chats.answer('First answer', { cards: ['Opened it'], dossier: 'report.html', file: { name: 'report', path: '/report' } });
  chats.media(first, 0, [{ id: 'pic', kind: 'image', path: '/picture.png', name: 'picture.png' }], 'Here');
  chats.question('Follow-up'); chats.answer('Second answer');
  chats.newChat(); const second = chats.id(); chats.question('Another question'); chats.answer('Another answer');
  await chats.flush();
  const reopened = createChats(storage, () => `chat-${++next}`); await reopened.load(); reopened.select(first);
  assert.equal(reopened.current().exchanges.length, 2);
  assert.equal(reopened.current().exchanges[0].media[0].name, 'picture.png');
  assert.equal(reopened.current().exchanges[0].cards[0], 'Opened it');
  assert.equal(reopened.current().exchanges[0].file.name, 'report');
  reopened.remove(second); await reopened.flush(); assert.equal(data.length, 1);
  fail = true; chats.question('Unsaved'); await chats.flush(); assert.match(warning, /could not be saved/i);
  fail = false; chats.answer('Saved'); await chats.flush(); assert.equal(warning, '');
});

test('server history survives a restart on a different port and reports write failures', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-chats-'));
  const engine = { directLine: null, profileFile: () => path.join(dir, 'profile.json'), chatsFile: () => path.join(dir, 'chats.json') };
  const request = (server, method, body) => fetch(`http://127.0.0.1:${server.port}/api/chats`, { method, headers: { 'Content-Type': 'application/json', 'X-Falcon-Token': server.token }, body: body && JSON.stringify(body) });
  const first = await startServer({ engine });
  const history = [{ id: 'one', date: '2026-01-01', title: 'Hello', exchanges: [{ question: 'Hello', answer: 'Hi', cards: ['Done'] }] }];
  assert.equal((await request(first, 'POST', { chats: history })).status, 200);
  const second = await startServer({ engine });
  try { assert.notEqual(second.port, first.port); await first.close(); assert.deepEqual(await (await request(second, 'GET')).json(), history); } finally { await second.close(); }
  const bad = await startServer({ engine: { ...engine, chatsFile: () => dir } });
  try { assert.equal((await request(bad, 'POST', { chats: history })).status, 500); } finally { await bad.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('saved media and file controls are available after restarting', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-chat-media-'));
  const picture = path.join(dir, 'picture.png'); fs.writeFileSync(picture, 'picture');
  const opened = [];
  const engine = { directLine: null, profileFile: () => path.join(dir, 'profile.json'), openPath: (file) => opened.push(file) };
  const history = [{ id: 'one', date: '2026-01-01', title: 'Picture', exchanges: [{ question: 'Picture', answer: 'Here', file: { path: picture, name: 'picture.png' }, media: [{ id: 'picture-id', path: picture, name: 'picture.png', kind: 'image' }] }] }];
  fs.writeFileSync(path.join(dir, 'chats.json'), JSON.stringify(history));
  const server = await startServer({ engine });
  const base = `http://127.0.0.1:${server.port}`;
  const headers = { 'Content-Type': 'application/json', 'X-Falcon-Token': server.token };
  try {
    assert.deepEqual(await (await fetch(`${base}/api/chats`, { headers })).json(), history);
    assert.equal(await (await fetch(`${base}/api/media?id=picture-id&token=${server.token}`)).text(), 'picture');
    const result = await (await fetch(`${base}/api/file/open`, { method: 'POST', headers, body: JSON.stringify({ path: picture }) })).json();
    assert.equal(result.ok, true); assert.equal(opened.length, 1);
  } finally { await server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('deleting a chat also deletes only that conversation in the engine', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-chat-forget-'));
  const id = '3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b';
  const other = '11111111-2222-4333-8444-555555555555';
  const calls = [];
  const engine = {
    directLine: null, profileFile: () => path.join(dir, 'profile.json'),
    runEngine: async (args) => {
      calls.push(args.join(' '));
      if (args[0] === 'sessions' && args[1] !== 'delete') {
        return { code: 0, out: `[log] listing\n${JSON.stringify({ sessions: [
          { key: `agent:falcon:falcon-window-3a6cadc9-${id}` },
          { key: `agent:falcon:falcon-window-3a6cadc9-${other}` },
          { key: 'agent:falcon:falcon-window-3a6cadc9' },
          { key: `agent:falcon:main-${id}` },
        ] })}\n` };
      }
      return { code: 0, out: '{"ok":true}' };
    },
  };
  const server = await startServer({ engine });
  const forget = (body) => fetch(`http://127.0.0.1:${server.port}/api/chats/forget`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Falcon-Token': server.token }, body: JSON.stringify(body) }).then((r) => r.json());
  try {
    assert.deepEqual(await forget({ id }), { ok: true, removed: 1 });
    assert.deepEqual(calls.filter((c) => c.startsWith('sessions delete')), [`sessions delete agent:falcon:falcon-window-3a6cadc9-${id} --agent falcon --yes --json`]);
    assert.equal((await forget({ id: '../../x' })).ok, false, 'only a chat id is accepted');
  } finally { await server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
