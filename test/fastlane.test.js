import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchFast, fastLane } from '../src/app/fastlane.js';
import { startServer } from '../src/app/server.js';

test('fast lane: the common requests are recognised, in English and Russian, however politely asked', () => {
  const cases = {
    'Next slide.': { do: 'step', step: 1 },
    'Falcon, next slide please': { do: 'step', step: 1 },
    'go back': { do: 'step', step: -1 },
    'Следующий слайд': { do: 'step', step: 1 },
    'Now slide 7.': { do: 'slide', slide: 7 },
    'go to slide five': { do: 'slide', slide: 5 },
    'Перейди на слайд 3': { do: 'slide', slide: 3 },
    'last slide': { do: 'last' },
    'Open my quarterly review presentation and go to slide 5.': { do: 'deck', find: 'quarterly review', slide: 5 },
    'open the sales deck': { do: 'deck', find: 'sales', slide: 0 },
    'Открой презентацию квартальный отчёт на слайде 4': { do: 'deck', find: 'квартальный отчёт', slide: 4 },
    'Open Excel': { do: 'app-open', name: 'excel' },
    'Запусти Telegram': { do: 'app-open', name: 'telegram' },
    'close notepad': { do: 'app-close', name: 'notepad' },
    'Louder!': { do: 'keys', keys: 'volumeup', times: 5, say: 'louder' },
    'тише': { do: 'keys', keys: 'volumedown', times: 5, say: 'quieter' },
    'pause the music': { do: 'keys', keys: 'playpause', times: 1, say: 'playpause' },
    'What time is it?': { do: 'time' },
    'Find my latest invoice.': { do: 'find', query: 'invoice' },
  };
  for (const [said, want] of Object.entries(cases)) assert.deepEqual(matchFast(said), want, said);
});

test('fast lane: anything that needs thinking is left to the AI', () => {
  for (const said of [
    'Good morning, Falcon.',
    'Open bbc.com/news and tell me the top headline.',
    'Open the invoice',
    'open it',
    'Open my presentation about sales and summarise it',
    "Find last month's invoice.",
    'Find the email from Aziz about the contract',
    'find out who founded Uzum',
    'What is on slide 5?',
    'Delete the old report',
    'close everything',
    'Send the deck to Ahmed',
    'What is on my screen right now?',
    'Open YouTube',
  ]) assert.equal(matchFast(said), null, said);
});

test('fast lane: runs the right small program and answers in the user\'s language and form of address', async () => {
  const ran = [];
  const run = (reply) => async (file, args) => { ran.push([file.replace(/\\/g, '/').split('/').slice(-2).join('/'), args.map(String).join(' ')]); return reply; };
  const go = (text, reply, more = {}) => fastLane(text, { packDir: 'C:\\pack', callMe: 'boss', platform: 'win32', run: run(reply), ...more });

  let r = await go('next slide', { ok: true, name: 'Quarterly Review.pptx', path: 'C:\\d\\Quarterly Review.pptx', slide: 6, total: 8 });
  assert.equal(r.reply, 'Slide 6 of 8 is up, boss.');
  assert.deepEqual(r.actions, ['Went to slide 6']);
  assert.match(r.note, /now showing slide 6 of Quarterly Review\.pptx \(C:\\d\\Quarterly Review\.pptx\)/);
  assert.deepEqual(ran.pop(), ['presentations/slides.ps1', '-Step 1']);

  r = await go('Open my quarterly review presentation and go to slide 5.', { ok: true, name: 'Quarterly Review.pptx', path: 'C:\\d\\q.pptx', slide: 5, total: 8 });
  assert.deepEqual(r.actions, ['Opened Quarterly Review', 'Went to slide 5']);
  assert.deepEqual(ran.pop(), ['presentations/slides.ps1', '-Find quarterly review -Slide 5']);

  r = await go('Слайд 40', { ok: false, error: 'The presentation has only 8 slides.' });
  assert.equal(r.reply, 'В презентации только 8 слайдов, босс.');

  r = await go('louder', { ok: true });
  assert.equal(r.reply, 'Louder, boss.');
  assert.deepEqual(ran.pop(), ['apps/apps.ps1', '-Do keys -Keys volumeup -Times 5']);

  r = await go('find my latest invoice', { ok: true, files: [{ path: 'C:\\Users\\a\\Documents\\Falcon Samples\\Invoice October 2026.pdf' }, { path: 'C:\\x\\invoice2.pdf' }] });
  assert.equal(r.reply, 'I found Invoice October 2026.pdf in Falcon Samples, boss. There is 1 more with a similar name. Shall I open it?');
  assert.match(r.note, /Invoice October 2026\.pdf ; C:\\x\\invoice2\.pdf/);

  r = await go('what time is it', null, { now: new Date(2026, 10, 18, 16, 5) });
  assert.equal(r.reply, 'It is 16:05, boss.');
});

test('fast lane: when it cannot be sure, it steps aside for the AI', async () => {
  const go = (text, reply, platform = 'win32') => fastLane(text, { packDir: 'C:\\pack', platform, run: async () => reply });
  assert.equal(await go('open excel', { ok: false, error: 'No app called excel is installed.' }), null, 'not an app: maybe a file');
  assert.equal(await go('open the sales deck', { ok: false, error: "No presentation with 'sales' in its name was found." }), null);
  assert.equal(await go('find my budget', { ok: true, files: [] }), null, 'nothing by that name');
  assert.equal(await go('next slide', null), null, 'the program gave no answer');
  assert.equal(await go('next slide', { ok: true }, 'darwin'), null, 'Windows only for now');
  assert.equal((await go('next slide', { ok: false, error: 'No presentation is open.' })).reply, 'No presentation is open, sir. Which one shall I open?');
});

test('fast lane in the window: answered at once without the AI, and the AI is told about it with the next request', async () => {
  const sent = [];
  const s = await startServer({ engine: {
    readGateway: () => ({ port: 1, token: 'gw' }),
    directLine: null,
    profileFile: () => 'Z:\\none\\profile.json',
    runEngine: async () => ({ code: 0, out: '{"approvals":[]}' }),
    fastLane: async (text) => (/slide/.test(text) ? { reply: 'Slide 6 of 8 is up, sir.', actions: ['Went to slide 6'], note: '"next slide": now showing slide 6 of Q.pptx' } : null),
    fetch: async (url, options) => {
      sent.push(JSON.parse(options.body).messages[0].content);
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'It shows revenue, sir.' } }] })}\n\ndata: [DONE]\n\n`, { status: 200 });
    },
  } });
  const ask = async (text) => (await fetch(`http://127.0.0.1:${s.port}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Falcon-Token': s.token }, body: JSON.stringify({ text }) })).text();
  try {
    const quick = await ask('next slide');
    assert.match(quick, /Slide 6 of 8 is up, sir\./);
    assert.match(quick, /event: actions/);
    assert.match(quick, /event: done/);
    assert.equal(sent.length, 0, 'the AI was not asked');

    await ask('What is on it?');
    assert.match(sent[0], /^\[Note from your own window.*\(1\) "next slide": now showing slide 6 of Q\.pptx\]\n\nWhat is on it\?/s);
    await ask('And then?');
    assert.match(sent[1], /^And then\?/, 'the note is passed on once');
  } finally { await s.close(); }
});

test('fast lane: the desktop picture changes at once, and "another" brings the next one', async () => {
  for (const said of ['Can you change my desktop image to sth else?', 'Change my wallpaper', 'change the desktop background to something else', 'new wallpaper', 'Смени обои']) {
    assert.deepEqual(matchFast(said.replace(/^Can you /, '')), { do: 'wallpaper' }, said);
  }
  assert.equal(matchFast('change my wallpaper to the photo of my daughter'), null, 'a particular picture is for the AI');
  const memory = {};
  const ran = [];
  const go = (text) => fastLane(text, { packDir: 'C:\\pack', platform: 'win32', memory,
    run: async (file, args) => { ran.push(args.join(' ')); return { ok: true, picture: 'C:\\WINDOWS\\Web\\Wallpaper\\ThemeA\\img21.jpg', previous: 'C:\\old.jpg', choices: 22 }; } });
  const first = await go('Can you change my desktop image to sth else?');
  assert.equal(first.reply, 'Your desktop has a new picture, sir. Say "another" if you would like a different one.');
  assert.match(first.note, /img21\.jpg \(before: C:\\old\.jpg\)/);
  assert.equal((await go('Another one, please.')).actions[0], 'Changed the desktop picture');
  assert.deepEqual(ran, ['-Do wallpaper', '-Do wallpaper']);
  await go('what time is it');
  assert.equal(await go('another'), null, 'after something else, "another" means nothing in particular');
});

test('fast lane: a plain hello or thank-you is answered at once, by the time of day', async () => {
  const go = (text, hour) => fastLane(text, { packDir: 'C:\\pack', callMe: 'Farhod', platform: 'win32', now: new Date(2026, 10, 18, hour, 0), run: async () => { throw new Error('nothing should run'); } });
  assert.equal((await go('Hi!', 22)).reply, 'Good evening, Farhod. What can I do for you?');
  assert.equal((await go('Привет', 9)).reply, 'Доброе утро, Farhod. Чем могу помочь?');
  assert.equal((await go('Thank you, Falcon.', 12)).reply, 'My pleasure, Farhod.');
  assert.equal(matchFast('Hi, can you find my invoice and email it?'), null);
});

test('fast lane: a found file can be opened with a plain yes; his own made files do not crowd out the user\'s', async () => {
  const memory = {};
  const opened = [];
  const files = { ok: true, files: [
    { path: 'C:\\Users\\a\\Documents\\Falcon Documents\\Invoice October 2026.xlsx' },
    { path: 'C:\\Users\\a\\Downloads\\Invoice October 2026.pdf' },
  ] };
  const go = (text) => fastLane(text, { packDir: 'C:\\pack', platform: 'win32', memory, open: (f) => opened.push(f), run: async () => files });

  const found = await go('Find my latest invoice');
  assert.match(found.reply, /^I found Invoice October 2026\.pdf in Downloads, sir\./, 'the user\'s own file, not the spreadsheet Falcon made');
  assert.equal(found.file, 'C:\\Users\\a\\Downloads\\Invoice October 2026.pdf');

  const yes = await go('Yes, please.');
  assert.equal(yes.reply, 'Invoice October 2026.pdf is open, sir.');
  assert.deepEqual(opened, ['C:\\Users\\a\\Downloads\\Invoice October 2026.pdf']);

  assert.equal(await fastLane('yes', { packDir: 'C:\\pack', platform: 'win32', memory, open: (f) => opened.push(f) }), null, 'a yes with nothing on offer goes to the AI');
  await go('Find my latest invoice');
  await fastLane('what time is it', { packDir: 'C:\\pack', platform: 'win32', memory });
  assert.equal(await fastLane('yes', { packDir: 'C:\\pack', platform: 'win32', memory, open: (f) => opened.push(f) }), null, 'another request in between drops the offer');
  assert.equal(opened.length, 1);
});
