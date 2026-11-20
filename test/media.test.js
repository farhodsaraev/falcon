import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { admitMedia, keepCopy, keepFolder, mediaType, newestSince, splitMedia } from '../src/app/media.js';
import { createDirectLine, stepText } from '../src/app/directline.js';
import { startServer } from '../src/app/server.js';

// A stand-in for the engine's media folder, the user's Pictures folder, and a file that is neither.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-media-'));
const mediaRoot = path.join(tmp, 'engine-media');
const made = path.join(mediaRoot, 'tool-image-generation');
const pictures = path.join(tmp, 'Pictures', 'Falcon');
fs.mkdirSync(made, { recursive: true });
const picture = path.join(made, 'image-1---abc.jpg');
fs.writeFileSync(picture, Buffer.from('not really a jpeg, but ten bytes or more'));
fs.utimesSync(picture, new Date(Date.now() - 3600000), new Date(Date.now() - 3600000));   // made an hour ago
const secret = path.join(tmp, 'secret.jpg');
fs.writeFileSync(secret, 'private');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('pictures: the lines that name a file are taken out of the answer, and only those', () => {
  const said = splitMedia('Here is your picture, sir.\n\nMEDIA:C:\\Users\\a\\.openclaw\\media\\tool-image-generation\\image-1.jpg');
  assert.equal(said.text, 'Here is your picture, sir.');
  assert.deepEqual(said.files, ['C:\\Users\\a\\.openclaw\\media\\tool-image-generation\\image-1.jpg']);

  const two = splitMedia('Two for you.\nMEDIA:/m/one.png\n  MEDIA:"/m/two, final.png"\nEnjoy.');
  assert.deepEqual(two.files, ['/m/one.png', '/m/two, final.png']);
  assert.equal(two.text, 'Two for you.\nEnjoy.');

  const talk = splitMedia('Write it as: MEDIA:/m/one.png\n```\nMEDIA:/m/code.png\n```\n    MEDIA:/m/indented.png');
  assert.deepEqual(talk.files, [], 'mentioned in a sentence, in a code block or indented as code, it is ordinary text');
  assert.equal(splitMedia('').text, '');
  assert.deepEqual(splitMedia(undefined).files, []);
});

test('pictures: only a picture, video or sound inside the engine\'s own media folder may be shown', () => {
  const ok = admitMedia(picture, mediaRoot);
  assert.equal(ok.kind, 'image');
  assert.equal(ok.type, 'image/jpeg');
  assert.equal(admitMedia(secret, mediaRoot), null, 'a file elsewhere on the computer');
  assert.equal(admitMedia(path.join(made, '..', '..', 'secret.jpg'), mediaRoot), null, 'a path that climbs out of the folder');
  assert.equal(admitMedia(path.join(made, 'missing.jpg'), mediaRoot), null);
  assert.equal(admitMedia('https://example.com/a.jpg', mediaRoot), null, 'a web address is not a file here');
  assert.equal(admitMedia('image-1---abc.jpg', mediaRoot), null, 'a bare name');
  const notes = path.join(made, 'notes.txt');
  fs.writeFileSync(notes, 'text');
  assert.equal(admitMedia(notes, mediaRoot), null, 'not a picture, video or sound');
  assert.deepEqual(mediaType('clip.MP4'), { kind: 'video', type: 'video/mp4' });
  assert.equal(mediaType('run.exe'), null);
});

test('pictures: a copy is kept under a plain name where the user looks for pictures', () => {
  const when = new Date(2026, 10, 18, 21, 45, 12);
  const first = keepCopy(picture, pictures, when);
  assert.equal(path.basename(first), 'Falcon 2026-11-18 21.45.12.jpg');
  assert.deepEqual(fs.readFileSync(first), fs.readFileSync(picture));
  assert.equal(path.basename(keepCopy(picture, pictures, when)), 'Falcon 2026-11-18 21.45.12 (2).jpg', 'never over another picture');

  const home = path.join(tmp, 'home');
  fs.mkdirSync(path.join(home, 'OneDrive', 'Pictures'), { recursive: true });
  assert.equal(keepFolder('image', home), path.join(home, 'OneDrive', 'Pictures', 'Falcon'), 'where Windows keeps Pictures when OneDrive holds them');
  assert.equal(keepFolder('video', home), path.join(home, 'Falcon'), 'no Videos folder: the home folder will do');

  assert.equal(newestSince(made, 0), picture);
  assert.equal(newestSince(made, Date.now() + 60000), null, 'nothing made since then');
  assert.equal(newestSince(path.join(tmp, 'no-such-folder'), 0), null);
});

test('direct line: following a conversation reports each finished run with its closing words', async () => {
  const sockets = [];
  class FakeSocket {
    constructor() { sockets.push(this); queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'event', event: 'connect.challenge', payload: {} }) })); }
    event(name, payload) { this.onmessage?.({ data: JSON.stringify({ type: 'event', event: name, payload }) }); }
    send(text) { const frame = JSON.parse(text); queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: {} }) })); }
    close() { queueMicrotask(() => this.onclose?.({ code: 1000 })); }
  }
  const line = createDirectLine({ readGateway: () => ({ port: 1, token: 't' }), WebSocketImpl: FakeSocket });
  const ended = [];
  const unfollow = line.follow('falcon-window-ab12', (run) => ended.push(run));
  await line.connect();
  const end = (sessionKey, runId, terminalReply) => sockets[0].event('agent', { sessionKey, runId, stream: 'lifecycle', data: { phase: 'end', terminalReply } });
  end('agent:falcon:falcon-window-ab12', 'chatcmpl_1', { text: 'I have started the picture, sir.' });
  end('agent:falcon:someone-else', 'chatcmpl_2', { text: 'Not for this window.' });
  sockets[0].event('agent', { sessionKey: 'agent:falcon:falcon-window-ab12', runId: 'chatcmpl_3', stream: 'lifecycle', data: { phase: 'start' } });
  end('agent:falcon:falcon-window-ab12', 'image_generate:tool:image_generate:9f:ok:agent-loop', { text: 'Here it is, sir.\n\nMEDIA:/m/one.jpg', mediaUrls: ['/m/two.jpg'] });
  assert.deepEqual(ended, [
    { runId: 'chatcmpl_1', text: 'I have started the picture, sir.', media: [] },
    { runId: 'image_generate:tool:image_generate:9f:ok:agent-loop', text: 'Here it is, sir.\n\nMEDIA:/m/one.jpg', media: ['/m/two.jpg'] },
  ]);
  unfollow();
  end('agent:falcon:falcon-window-ab12', 'chatcmpl_4', { text: 'After the following ended.' });
  assert.equal(ended.length, 2);
  assert.equal(stepText({ name: 'image_generate', args: {}, meta: 'prompt a red apple' }), 'Painting the picture');
  assert.equal(stepText({ name: 'video_generate', args: {} }, true), 'Создаю видео');
  line.close();
});

test('the window holds a place for a picture being made, then shows it, keeps a copy, and hands out nothing else', async () => {
  let step; let ended;
  const opened = [];
  const directLine = {
    close() {}, stop: async () => true,
    watch(sessionKey, onStep) { step = onStep; return () => { step = null; }; },
    follow(sessionKey, onEnd) { ended = onEnd; return () => { ended = null; }; },
  };
  const s = await startServer({ engine: {
    findEngine: () => null,
    readGateway: () => ({ port: 1, token: 'gw' }),
    profileFile: () => path.join(tmp, 'profile.json'),
    fastLane: async () => null,
    approvalPollMs: 50,
    mediaPatienceMs: 600,
    directLine,
    mediaRoot: () => mediaRoot,
    keepFolder: () => path.join(tmp, 'kept'),
    openPath: (file) => opened.push(file),
    runEngine: async () => ({ code: 0, out: '{"approvals":[]}' }),
    fetch: async (url, options) => {
      const asked = JSON.parse(options.body).messages[0].content;
      if (/picture/.test(asked)) {
        // The engine announces the start of one piece of work twice, under two names.
        step({ name: 'image_generate', args: {}, meta: 'prompt a red apple on a white table, count 1' });
        step({ name: 'image_generate', args: {}, meta: 'prompt a red apple on a white table, count 1' });
      }
      if (/which models/.test(asked)) step({ name: 'image_generate', args: {}, meta: 'action list' });
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'I have started it, sir.' } }] })}\n\ndata: [DONE]\n\n`, { status: 200 });
    },
  } });
  const base = `http://127.0.0.1:${s.port}`;
  const ask = (text) => fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Falcon-Token': s.token }, body: JSON.stringify({ text }) }).then((r) => r.text());
  const events = await fetch(`${base}/api/events?token=${s.token}`);
  const reader = events.body.getReader();
  const decoder = new TextDecoder();
  let pushed = '';
  let reading = null;      // one read at a time: a read given up on would swallow the next event
  // The next "media" event the window is sent, or null if none comes in time.
  const nextMedia = async (waitMs = 3000) => {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const found = /event: media\ndata: (.*)\n\n/.exec(pushed);
      if (found) { pushed = pushed.slice(found.index + found[0].length); return JSON.parse(found[1]); }
      const left = deadline - Date.now();
      if (left <= 0) return null;
      reading ??= reader.read();
      let timer;
      const chunk = await Promise.race([reading, new Promise((resolve) => { timer = setTimeout(() => resolve(null), left); })]);
      clearTimeout(timer);
      if (!chunk) return null;
      reading = null;
      pushed += decoder.decode(chunk.value, { stream: true });
    }
  };
  try {
    const answer = await ask('Make me a picture of a red apple.');
    assert.match(answer, /event: step\ndata: {"text":"Painting the picture","skill":"pictures"}/);
    assert.match(answer, /event: summary\ndata: {"fast":false,"steps":2,"ms":\d+}/);
    const places = [...answer.matchAll(/event: pending\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]));
    assert.equal(places.length, 1, 'one place is held, though the start was announced twice');
    assert.equal(places[0].kind, 'image');

    // The engine's own run, a little later: the picture is ready.
    ended({ runId: 'image_generate:tool:image_generate:9f:ok:agent-loop', text: `Here is your picture, sir.\n\nMEDIA:${picture}\n[[did]] Made a picture`, media: [] });
    const ready = await nextMedia();
    assert.equal(ready.pending, places[0].id, 'it fills the place that was held');
    assert.equal(ready.text, 'Here is your picture, sir.');
    assert.equal(ready.failed, false);
    assert.equal(ready.items.length, 1);
    const item = ready.items[0];
    assert.equal(item.kind, 'image');
    assert.match(item.name, /^Falcon \d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d\.jpg$/);
    assert.equal(path.dirname(item.path), path.join(tmp, 'kept'), 'a copy is kept in the user\'s own folder');
    assert.deepEqual(fs.readFileSync(item.path), fs.readFileSync(picture));

    // The window loads it by the name it was given, whole or in parts; nothing without the token.
    const whole = await fetch(`${base}/api/media?id=${item.id}&token=${s.token}`);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await whole.arrayBuffer()), fs.readFileSync(picture));
    const part = await fetch(`${base}/api/media?id=${item.id}&token=${s.token}`, { headers: { Range: 'bytes=4-9' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), `bytes 4-9/${fs.statSync(picture).size}`);
    assert.equal(await part.text(), 'really');
    assert.equal((await fetch(`${base}/api/media?id=${item.id}&token=wrong`)).status, 401);
    assert.equal((await fetch(`${base}/api/media?id=nope&token=${s.token}`)).status, 404);
    // Open works for it, as for any file Falcon offered.
    const open = await fetch(`${base}/api/file/open`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Falcon-Token': s.token }, body: JSON.stringify({ path: item.path }) });
    assert.equal((await open.json()).ok, true);
    assert.deepEqual(opened, [item.path]);

    // Asked to show it again in an ordinary answer: the same picture, no second copy, no words repeated.
    ended({ runId: 'chatcmpl_2', text: `Here it is again, sir.\n\nMEDIA:${picture}`, media: [] });
    const again = await nextMedia();
    assert.equal(again.items[0].id, item.id);
    assert.equal(again.text, '');
    assert.equal(again.pending, undefined);
    assert.equal(fs.readdirSync(path.join(tmp, 'kept')).length, 1);

    // An answer that names some other file on the computer shows nothing; an ordinary answer shows nothing.
    ended({ runId: 'chatcmpl_3', text: `Look at this.\n\nMEDIA:${secret}`, media: [secret] });
    ended({ runId: 'chatcmpl_4', text: 'Good morning, sir.', media: [] });
    assert.equal(await nextMedia(200), null);

    // Asking which picture models there are makes nothing, so no place is held.
    assert.doesNotMatch(await ask('which models can you paint with?'), /event: pending/);

    // A picture that could not be made: the place is given up, with his own words for it.
    const second = JSON.parse(/event: pending\ndata: (.*)\n/.exec(await ask('Another picture, please.'))[1]);
    ended({ runId: 'image_generate:tool:image_generate:a1:error:agent-loop', text: 'The picture did not come out, sir.', media: [] });
    const failed = await nextMedia();
    assert.deepEqual(failed, { pending: second.id, kind: 'image', text: 'The picture did not come out, sir.', items: [], failed: true });

    // News that never arrives: after the wait, the window is told, so the place is not held for ever.
    const third = JSON.parse(/event: pending\ndata: (.*)\n/.exec(await ask('One more picture.'))[1]);
    assert.deepEqual(await nextMedia(3000), { pending: third.id, kind: 'image', text: '', items: [], failed: true });

    // The news was missed, but the engine did make the picture meanwhile: it is found and shown.
    const fourth = JSON.parse(/event: pending\ndata: (.*)\n/.exec(await ask('And one last picture.'))[1]);
    fs.writeFileSync(path.join(made, 'image-2---def.png'), 'a second picture');
    const found = await nextMedia(3000);
    assert.equal(found.pending, fourth.id);
    assert.equal(found.failed, false);
    assert.match(found.items[0].name, /\.png$/);
    assert.equal(fs.readFileSync(found.items[0].path, 'utf8'), 'a second picture');
  } finally {
    await reader.cancel().catch(() => {});
    await s.close();
  }
});
