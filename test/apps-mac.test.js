import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The Mac apps skill is tested without a Mac: --dry-run and --print-script never run osascript.
// The AppleScript itself is only compiled by the Mac CI (osacompile) and only proven on a real Mac.
const here = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(here, '..', 'falcon-agent', 'skills-mac', 'apps', 'apps.mjs');
const run = (...args) => JSON.parse(execFileSync(process.execPath, [SKILL, ...args], { encoding: 'utf8' }).trim());
const dry = (...args) => run(...args, '--dry-run');

const NASTY = [
  'He said "hi" \\ and \\" left',
  'Привет, как дела? Встреча в 15:00',
  'line one\nline two\r\nline three',
  '" & (do shell script "rm -rf ~") & "',
  '-e do shell script "say hi"',
  'end run\non run argv\ndo shell script "id"',
];
const EXISTING_FILE = fileURLToPath(import.meta.url);

test('apps: every printed script is a fixed text with on run argv', () => {
  const { ok, scripts } = run('--print-script');
  assert.equal(ok, true);
  const names = ['mail-draft', 'notes-add', 'notes-find', 'calendar-add', 'reminder-add', 'music', 'volume', 'open-app', 'quit-app', 'reveal', 'frontmost'];
  assert.deepEqual(Object.keys(scripts).sort(), [...names].sort());
  for (const [name, source] of Object.entries(scripts)) {
    assert.match(source, /^on run argv$/m, `${name} has on run argv`);
    assert.match(source, /^end run$/m, `${name} has end run`);
    assert.doesNotMatch(source, /do shell script/, `${name} runs no shell`);
    assert.doesNotMatch(source, /[^\x09\x0a\x20-\x7e]/, `${name} is plain ASCII`);
  }
  // A dry run gives exactly the printed script.
  assert.equal(dry('--do', 'frontmost').script, scripts.frontmost);
});

test('apps: user text reaches argv untouched and never the script', () => {
  for (const text of NASTY) {
    const cases = [
      [['--do', 'mail-draft', '--to', 'ann@example.com', '--subject', text, '--body', text], (r) => [r.argv[1], r.argv[2]]],
      [['--do', 'notes-find', '--query', text], (r) => [r.argv[1]]],
      [['--do', 'calendar-add', '--title', text, '--start', '2026-11-20T15:00', '--calendar', text, '--location', text, '--notes', text], (r) => [r.argv[1], r.argv[13], r.argv[14], r.argv[15]]],
      [['--do', 'reminder-add', '--title', text, '--list', text], (r) => [r.argv[1], r.argv[8]]],
      [['--do', 'open-app', '--name', text], (r) => [r.argv[1]]],
      [['--do', 'quit-app', '--name', text], (r) => [r.argv[1]]],
    ];
    for (const [args, pick] of cases) {
      const r = dry(...args);
      assert.equal(r.ok, true, `${args[1]}: ${r.error}`);
      for (const value of pick(r)) assert.equal(value, text, `${args[1]} carries the text untouched`);
      assert.ok(!r.script.includes(text), `${args[1]} script does not contain the user text`);
      assert.ok(!r.script.includes('rm -rf'), `${args[1]} script has no injected command`);
      assert.equal(r.argv[0], args[1], 'argv starts with the action name, never with user text');
    }
  }
});

test('apps: first osascript argument is never user text that looks like an option', () => {
  const r = dry('--do', 'mail-draft', '--subject', '-e', '--body', '-l JavaScript');
  assert.equal(r.argv[0], 'mail-draft');
  assert.deepEqual(r.argv.slice(1, 3), ['-e', '-l JavaScript']);
});

test('apps: mail draft carries recipients, cc and attachment as separate items', () => {
  const r = dry('--do', 'mail-draft', '--to', 'ann@example.com; Bob <bob@example.org>', '--cc', 'c@d.com', '--subject', 'S', '--body', 'B', '--attach', EXISTING_FILE);
  assert.deepEqual(r.argv, ['mail-draft', 'S', 'B', EXISTING_FILE, '2', 'ann@example.com', 'bob@example.org', 'c@d.com']);
  assert.match(r.script, /visible:true/);
  assert.doesNotMatch(r.script, /\bsend\b/);
});

test('apps: a note body becomes escaped HTML, the title stays as said', () => {
  const r = dry('--do', 'notes-add', '--title', 'Ideas <b>&', '--body', 'a < b & "c"\n\nПривет', '--folder', 'Работа');
  assert.equal(r.argv[1], 'Ideas <b>&');
  assert.equal(r.argv[2], '<div><h1>Ideas &lt;b&gt;&amp;</h1></div><div>a &lt; b &amp; &quot;c&quot;</div><div><br></div><div>Привет</div>');
  assert.equal(r.argv[3], 'Работа');
});

test('apps: dates go in as numbers, never as a date string', () => {
  const r = dry('--do', 'calendar-add', '--title', 'T', '--start', '2026-11-20T15:05', '--end', '2026-11-21T09:30');
  assert.deepEqual(r.argv.slice(2, 12), ['2026', '11', '20', '15', '5', '2026', '11', '21', '9', '30']);
  for (const n of r.argv.slice(2, 12)) assert.match(n, /^\d+$/);
  assert.doesNotMatch(r.script, /date "/);
  const m = dry('--do', 'calendar-add', '--title', 'T', '--start', '2026-11-20T15:00', '--minutes', '90');
  assert.deepEqual(m.argv.slice(7, 13), ['', '', '', '', '', '90']);
  const d = dry('--do', 'calendar-add', '--title', 'T', '--start', '2026-11-20T15:00');
  assert.equal(d.argv[12], '60', 'an hour by default');
  const rem = dry('--do', 'reminder-add', '--title', 'Call', '--due', '2026-11-20T09:00');
  assert.deepEqual(rem.argv.slice(2, 8), ['1', '2026', '11', '20', '9', '0']);
  assert.doesNotMatch(rem.script, /date "/);
  const none = dry('--do', 'reminder-add', '--title', 'Call');
  assert.deepEqual(none.argv.slice(2, 9), ['', '', '', '', '', '', '']);
});

test('apps: music, volume, reveal and frontmost build plain argv', () => {
  assert.deepEqual(dry('--do', 'music', '--cmd', 'Next').argv, ['music', 'next']);
  assert.deepEqual(dry('--do', 'volume', '--level', '40').argv, ['volume', 'set', '40']);
  assert.deepEqual(dry('--do', 'volume', '--mute').argv, ['volume', 'mute', '']);
  assert.deepEqual(dry('--do', 'volume', '--unmute').argv, ['volume', 'unmute', '']);
  assert.deepEqual(dry('--do', 'reveal', '--path', EXISTING_FILE).argv, ['reveal', EXISTING_FILE]);
  assert.deepEqual(dry('--do', 'frontmost').argv, ['frontmost']);
  assert.doesNotMatch(dry('--do', 'quit-app', '--name', 'Safari').script, /force|kill|saving no/i);
});

test('apps: bad input gives ok:false in plain words', () => {
  const bad = [
    [['--do', 'nonsense'], /Unknown action/],
    [['--do', 'mail-draft', '--to', 'not an address'], /does not look like an email address/],
    [['--do', 'mail-draft', '--to', 'a@b.com', '--attach', '/no/such/file.pdf'], /no file or folder/],
    [['--do', 'mail-draft', '--to', 'a@b.com', '--attach', 'relative.pdf'], /full path/],
    [['--do', 'notes-add', '--body', 'x'], /title/],
    [['--do', 'notes-find'], /look for/],
    [['--do', 'calendar-add', '--title', 'T', '--start', 'Friday at 3'], /should look like/],
    [['--do', 'calendar-add', '--title', 'T', '--start', '2026-02-30T10:00'], /not a real date/],
    [['--do', 'calendar-add', '--title', 'T', '--start', '2026-11-20T25:00'], /not a real date/],
    [['--do', 'calendar-add', '--title', 'T', '--start', '2026-11-20T15:00', '--end', '2026-11-20T14:00'], /end after it starts/],
    [['--do', 'calendar-add', '--title', 'T', '--start', '2026-11-20T15:00', '--minutes', 'lots'], /whole number of minutes/],
    [['--do', 'calendar-add', '--start', '2026-11-20T15:00'], /title/],
    [['--do', 'reminder-add', '--title', 'x', '--due', 'tomorrow'], /should look like/],
    [['--do', 'music', '--cmd', 'louder'], /play, pause/],
    [['--do', 'volume', '--level', '150'], /0 to 100/],
    [['--do', 'volume'], /0 to 100/],
    [['--do', 'open-app'], /which app/],
    [['--do', 'reveal', '--path', '/no/such/place'], /no file or folder/],
  ];
  for (const [args, message] of bad) {
    const r = dry(...args);
    assert.equal(r.ok, false, args.join(' '));
    assert.match(r.error, message, args.join(' '));
    assert.doesNotMatch(r.error, /at .*\.mjs|TypeError|undefined/, 'no stack traces or code words');
  }
});

test('apps: without a Mac it says so instead of trying to run', { skip: process.platform === 'darwin' }, () => {
  const r = run('--do', 'frontmost');
  assert.deepEqual(r, { ok: false, action: 'frontmost', error: 'This skill only works on a Mac.' });
});
