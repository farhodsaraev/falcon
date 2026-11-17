#!/usr/bin/env node
// Controls the Mac's own apps through AppleScript, without clicking on the screen (macOS).
//   node apps.mjs --do mail-draft --to "a@b.com, c@d.com" --subject "" --body "" [--cc ""] [--attach "<full path>"]
//   node apps.mjs --do notes-add --title "" --body "" [--folder ""]
//   node apps.mjs --do notes-find --query ""
//   node apps.mjs --do calendar-add --title "" --start "2026-11-20T15:00" [--end "..." | --minutes 60] [--calendar ""] [--location ""] [--notes ""]
//   node apps.mjs --do reminder-add --title "" [--due "2026-11-20T09:00"] [--list ""]
//   node apps.mjs --do music --cmd play|pause|next|previous|now
//   node apps.mjs --do volume --level 0-100 | --mute | --unmute
//   node apps.mjs --do open-app --name "Safari"      node apps.mjs --do quit-app --name "Safari"
//   node apps.mjs --do reveal --path "<full path>"
//   node apps.mjs --do frontmost
//   node apps.mjs --print-script            every action's AppleScript, nothing is run
//   node apps.mjs --do <action> ... --dry-run   the script and argv that would run, nothing is run
// Prints one line of JSON.
//
// Safety: every AppleScript below is a fixed text. The user's words never become part of it; they reach
// the script only as strings in `argv` of `on run argv`. Item 1 of argv is always the action name, so the
// first argument osascript sees never starts with "-" (osascript would otherwise read it as an option).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FLAGS = new Set(['mute', 'unmute', 'dry-run', 'print-script']);
function args() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    if (FLAGS.has(key)) out[key] = true;
    else out[key] = argv[++i] ?? '';
  }
  return out;
}

class Plain extends Error {}
const fail = (message) => { throw new Plain(message); };

// ---------- the AppleScripts (fixed text, user input only via argv) ----------

const DATE_HANDLER = [
  'on makeDate(y, mo, d, h, mi)',
  'set t to current date',
  'set day of t to 1',
  'set year of t to (y as integer)',
  'set month of t to (mo as integer)',
  'set day of t to (d as integer)',
  'set time of t to ((h as integer) * hours + (mi as integer) * minutes)',
  'return t',
  'end makeDate',
];

const SCRIPTS = {
  // argv: action, subject, body, attachment path or "", number of To addresses, To addresses..., Cc addresses...
  'mail-draft': [
    'on run argv',
    'set theSubject to item 2 of argv',
    'set theBody to item 3 of argv',
    'set attachPath to item 4 of argv',
    'set toCount to (item 5 of argv) as integer',
    'set attachFile to missing value',
    'if attachPath is not "" then set attachFile to (POSIX file attachPath) as alias',
    'if attachFile is not missing value and theBody is "" then set theBody to linefeed',
    'tell application "Mail"',
    'set msg to make new outgoing message with properties {subject:theSubject, content:theBody, visible:true}',
    'tell msg',
    'repeat with i from 6 to (5 + toCount)',
    'make new to recipient at end of to recipients with properties {address:(item i of argv)}',
    'end repeat',
    'repeat with i from (6 + toCount) to (count of argv)',
    'make new cc recipient at end of cc recipients with properties {address:(item i of argv)}',
    'end repeat',
    'if attachFile is not missing value then',
    'tell content',
    'make new attachment with properties {file name:attachFile} at after the last paragraph',
    'end tell',
    'end if',
    'end tell',
    'activate',
    'end tell',
    'return "drafted"',
    'end run',
  ],
  // argv: action, title, HTML body (already escaped), folder name or ""
  'notes-add': [
    'on run argv',
    'set theTitle to item 2 of argv',
    'set theBody to item 3 of argv',
    'set folderName to item 4 of argv',
    'tell application "Notes"',
    'if folderName is "" then',
    'set n to make new note at (default folder of default account) with properties {name:theTitle, body:theBody}',
    'else',
    'if not (exists folder folderName) then error "There is no Notes folder called " & folderName & "."',
    'set n to make new note at folder folderName with properties {name:theTitle, body:theBody}',
    'end if',
    'set folderUsed to ""',
    'try',
    'set folderUsed to name of container of n',
    'end try',
    'return folderUsed',
    'end tell',
    'end run',
  ],
  // argv: action, query. Returns records split by character id 30, fields by character id 31.
  'notes-find': [
    'on run argv',
    'set q to item 2 of argv',
    'set rs to character id 30',
    'set fs to character id 31',
    'set out to ""',
    'set n to 0',
    'tell application "Notes"',
    'set found to (every note whose name contains q or plaintext contains q)',
    'repeat with nt in found',
    'if n = 10 then exit repeat',
    'set n to n + 1',
    'set t to plaintext of nt',
    'if (length of t) > 300 then set t to text 1 thru 300 of t',
    'set out to out & (name of nt) & fs & t & rs',
    'end repeat',
    'end tell',
    'return out',
    'end run',
  ],
  // argv: action, title, start y, mo, d, h, mi, end y, mo, d, h, mi (all "" when minutes are used),
  //       minutes, calendar name or "", location or "", notes or ""
  'calendar-add': [
    ...DATE_HANDLER,
    'on run argv',
    'set theTitle to item 2 of argv',
    'set startDate to makeDate(item 3 of argv, item 4 of argv, item 5 of argv, item 6 of argv, item 7 of argv)',
    'if (item 8 of argv) is "" then',
    'set endDate to startDate + ((item 13 of argv) as integer) * minutes',
    'else',
    'set endDate to makeDate(item 8 of argv, item 9 of argv, item 10 of argv, item 11 of argv, item 12 of argv)',
    'end if',
    'set calName to item 14 of argv',
    'set theLocation to item 15 of argv',
    'set theNotes to item 16 of argv',
    'tell application "Calendar"',
    'set cal to missing value',
    'if calName is "" then',
    'repeat with c in calendars',
    'if writable of c then',
    'set cal to contents of c',
    'exit repeat',
    'end if',
    'end repeat',
    'if cal is missing value then error "There is no calendar here that can be written to."',
    'else',
    'if not (exists calendar calName) then error "There is no calendar called " & calName & "."',
    'set cal to calendar calName',
    'end if',
    'set ev to make new event at end of events of cal with properties {summary:theTitle, start date:startDate, end date:endDate}',
    'if theLocation is not "" then set location of ev to theLocation',
    'if theNotes is not "" then set description of ev to theNotes',
    'return name of cal',
    'end tell',
    'end run',
  ],
  // argv: action, title, "1" when there is a due date else "", due y, mo, d, h, mi (or ""), list name or ""
  'reminder-add': [
    ...DATE_HANDLER,
    'on run argv',
    'set theTitle to item 2 of argv',
    'set hasDue to ((item 3 of argv) is "1")',
    'set listName to item 9 of argv',
    'if hasDue then set dueDate to makeDate(item 4 of argv, item 5 of argv, item 6 of argv, item 7 of argv, item 8 of argv)',
    'tell application "Reminders"',
    'if listName is "" then',
    'set theList to default list',
    'else',
    'if not (exists list listName) then error "There is no Reminders list called " & listName & "."',
    'set theList to list listName',
    'end if',
    'if hasDue then',
    'make new reminder at end of reminders of theList with properties {name:theTitle, due date:dueDate}',
    'else',
    'make new reminder at end of reminders of theList with properties {name:theTitle}',
    'end if',
    'return name of theList',
    'end tell',
    'end run',
  ],
  // argv: action, play|pause|next|previous|now. Returns state, track, artist split by tab.
  music: [
    'on run argv',
    'set c to item 2 of argv',
    'if c is "now" and not (application "Music" is running) then return "not running" & tab & "" & tab & ""',
    'tell application "Music"',
    'if c is "play" then',
    'play',
    'else if c is "pause" then',
    'pause',
    'else if c is "next" then',
    'next track',
    'else if c is "previous" then',
    'previous track',
    'end if',
    'set playerState to player state as string',
    'set trackName to ""',
    'set artistName to ""',
    'try',
    'set trackName to name of current track',
    'set artistName to artist of current track',
    'end try',
    'return playerState & tab & trackName & tab & artistName',
    'end tell',
    'end run',
  ],
  // argv: action, "mute" | "unmute" | "set", level 0-100 or "". Returns volume and muted split by tab.
  volume: [
    'on run argv',
    'set how to item 2 of argv',
    'if how is "mute" then',
    'set volume with output muted',
    'else if how is "unmute" then',
    'set volume without output muted',
    'else',
    'set volume output volume ((item 3 of argv) as integer) without output muted',
    'end if',
    'set s to get volume settings',
    'return ((output volume of s) as string) & tab & ((output muted of s) as string)',
    'end run',
  ],
  // argv: action, app name
  'open-app': [
    'on run argv',
    'set appName to item 2 of argv',
    'tell application appName to activate',
    'return "opened"',
    'end run',
  ],
  // argv: action, app name. Asks the app to quit the normal way; never forces it.
  'quit-app': [
    'on run argv',
    'set appName to item 2 of argv',
    'if not (application appName is running) then return "not running"',
    'with timeout of 25 seconds',
    'tell application appName to quit',
    'end timeout',
    'return "quit"',
    'end run',
  ],
  // argv: action, full POSIX path
  reveal: [
    'on run argv',
    'set theItem to (POSIX file (item 2 of argv)) as alias',
    'tell application "Finder"',
    'reveal theItem',
    'activate',
    'end tell',
    'return "revealed"',
    'end run',
  ],
  // argv: action. Returns app name, window title, and the error number when the window could not be read.
  frontmost: [
    'on run argv',
    'set winTitle to ""',
    'set winError to ""',
    'tell application "System Events"',
    'set p to first application process whose frontmost is true',
    'set appName to name of p',
    'try',
    'if (count of windows of p) > 0 then set winTitle to name of window 1 of p',
    'on error errText number errNum',
    'set winError to errNum as string',
    'end try',
    'end tell',
    'if winTitle is missing value then set winTitle to ""',
    'return appName & tab & winTitle & tab & winError',
    'end run',
  ],
};

// ---------- checking the user's input and building argv ----------

function parseWhen(text, label) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
  if (!m) fail(`The ${label} time should look like 2026-11-20T15:00.`);
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const check = new Date(y, mo - 1, d, h, mi);
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || check.getMonth() !== mo - 1 || check.getDate() !== d) {
    fail(`The ${label} time ${text} is not a real date and time.`);
  }
  return [y, mo, d, h, mi];
}
const nums = (parts) => parts.map(String);
const fullPath = (p) => {
  let f = String(p || '').trim();
  if (!f) return '';
  if (f === '~' || f.startsWith('~/')) f = path.join(os.homedir(), f.slice(1));
  return f;
};
function existingFile(p, what) {
  const f = fullPath(p);
  if (!f) fail(`Please give the full path of the ${what}.`);
  if (!path.isAbsolute(f)) fail(`Please give the full path of the ${what}, starting with /.`);
  if (!fs.existsSync(f)) fail(`There is no file or folder at ${f}.`);
  return f;
}
function addresses(list, label) {
  return String(list || '').split(/[,;]/).map((a) => a.trim()).filter(Boolean).map((a) => {
    const inner = /<([^<>]+)>\s*$/.exec(a);
    const addr = (inner ? inner[1] : a).trim();
    if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(addr)) fail(`"${a}" in ${label} does not look like an email address.`);
    return addr;
  });
}
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function noteHtml(title, body) {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
  const html = lines.map((l) => (l.trim() ? `<div>${escapeHtml(l)}</div>` : '<div><br></div>')).join('');
  return `<div><h1>${escapeHtml(title)}</h1></div>${String(body || '').trim() ? html : ''}`;
}
const appName = (a) => {
  const name = String(a.name || '').trim();
  if (!name) fail('Please say which app.');
  return name;
};

// Each builder returns { argv, reply(output) } — argv starts with the action name (see the note at the top).
const BUILD = {
  'mail-draft': (a) => {
    const to = addresses(a.to, 'the To field');
    const cc = addresses(a.cc, 'the Cc field');
    const attach = a.attach ? existingFile(a.attach, 'attachment') : '';
    if (attach && fs.statSync(attach).isDirectory()) fail(`${attach} is a folder; Mail can only attach files.`);
    return {
      argv: [String(a.subject ?? ''), String(a.body ?? ''), attach, String(to.length), ...to, ...cc],
      reply: () => ({ drafted: true, sent: false, to, cc, subject: String(a.subject ?? ''), attached: attach || undefined,
        note: 'The message is open in Mail and has not been sent. The user presses Send himself.' }),
    };
  },
  'notes-add': (a) => {
    const title = String(a.title || '').trim();
    if (!title) fail('Please give the note a title.');
    return {
      argv: [title, noteHtml(title, a.body), String(a.folder || '').trim()],
      reply: (out) => ({ added: true, title, folder: out }),
    };
  },
  'notes-find': (a) => {
    const query = String(a.query || '').trim();
    if (!query) fail('Please say what to look for in Notes.');
    return {
      argv: [query],
      reply: (out) => {
        const notes = out.split('\x1e').filter((r) => r.trim()).map((r) => {
          const [title, text = ''] = r.split('\x1f');
          return { title: title.trim(), snippet: text.replace(/\s+/g, ' ').trim() };
        });
        return { query, count: notes.length, notes };
      },
    };
  },
  'calendar-add': (a) => {
    const title = String(a.title || '').trim();
    if (!title) fail('Please give the event a title.');
    const start = parseWhen(a.start, 'start');
    let end = ['', '', '', '', ''];
    let mins = '';
    if (a.end) {
      end = parseWhen(a.end, 'end');
      const s = new Date(start[0], start[1] - 1, start[2], start[3], start[4]);
      const e = new Date(end[0], end[1] - 1, end[2], end[3], end[4]);
      if (e <= s) fail('The event has to end after it starts.');
      end = nums(end);
    } else {
      const m = a.minutes === undefined || a.minutes === '' ? 60 : Number(a.minutes);
      if (!Number.isInteger(m) || m < 1 || m > 10080) fail('The length of the event should be a whole number of minutes, from 1 to 10080.');
      mins = String(m);
    }
    return {
      argv: [title, ...nums(start), ...end, mins, String(a.calendar || '').trim(), String(a.location || ''), String(a.notes || '')],
      reply: (out) => ({ added: true, calendar: out, title, start: String(a.start).trim(), end: a.end ? String(a.end).trim() : undefined, minutes: mins ? Number(mins) : undefined }),
    };
  },
  'reminder-add': (a) => {
    const title = String(a.title || '').trim();
    if (!title) fail('Please give the reminder a title.');
    const due = a.due ? nums(parseWhen(a.due, 'due')) : ['', '', '', '', ''];
    return {
      argv: [title, a.due ? '1' : '', ...due, String(a.list || '').trim()],
      reply: (out) => ({ added: true, list: out, title, due: a.due ? String(a.due).trim() : undefined }),
    };
  },
  music: (a) => {
    const cmd = String(a.cmd || 'now').trim().toLowerCase();
    if (!['play', 'pause', 'next', 'previous', 'now'].includes(cmd)) fail('The music command should be play, pause, next, previous or now.');
    return {
      argv: [cmd],
      reply: (out) => {
        const [state = '', track = '', artist = ''] = out.split('\t');
        return { cmd, state: state.trim(), track: track.trim(), artist: artist.trim() };
      },
    };
  },
  volume: (a) => {
    let argv;
    if (a.mute) argv = ['mute', ''];
    else if (a.unmute) argv = ['unmute', ''];
    else {
      const level = Number(a.level);
      if (a.level === undefined || a.level === '' || !Number.isInteger(level) || level < 0 || level > 100) fail('The volume should be a whole number from 0 to 100, or --mute, or --unmute.');
      argv = ['set', String(level)];
    }
    return {
      argv,
      reply: (out) => {
        const [vol, muted] = out.split('\t');
        return { volume: Number(vol), muted: String(muted).trim() === 'true' };
      },
    };
  },
  'open-app': (a) => {
    const name = appName(a);
    return { argv: [name], reply: () => ({ opened: name }) };
  },
  'quit-app': (a) => {
    const name = appName(a);
    return { argv: [name], reply: (out) => (out === 'not running' ? { quit: false, wasRunning: false, app: name } : { quit: true, app: name }) };
  },
  reveal: (a) => {
    const f = existingFile(a.path, 'file or folder');
    return { argv: [f], reply: () => ({ revealed: f }) };
  },
  frontmost: () => ({
    argv: [],
    reply: (out) => {
      const [app = '', win = '', err = ''] = out.split('\t');
      const result = { app: app.trim(), window: win.trim() };
      if (err.trim()) result.note = 'The window title could not be read: Falcon needs Accessibility, in System Settings, Privacy and Security, Accessibility.';
      return result;
    },
  }),
};

// ---------- running ----------

function plainError(err, action, a) {
  if (err instanceof Plain) return err.message;
  const raw = String(err.stderr || err.message || err).trim();
  const text = raw.split('\n').filter(Boolean).pop()?.replace(/^.*execution error: /, '') || raw;
  const automation = ' Falcon is not yet allowed to control this app: the user can click OK on the macOS prompt, or allow Falcon in System Settings, Privacy and Security, Automation, then ask again.';
  if (/-1743|not authori[sz]ed|not allowed to send/i.test(raw)) return text + automation;
  if (/-1719|-25211|assistive access|not allowed assistive/i.test(raw)) return `${text} Falcon needs Accessibility for this: the user can allow it in System Settings, Privacy and Security, Accessibility, then ask again.`;
  if (/not allowed/i.test(raw)) return text + automation;
  if (/ETIMEDOUT|timed out|-1712/i.test(raw)) {
    if (action === 'quit-app') return `${a.name} did not quit within half a minute. It may be asking whether to save unsaved work; the user should look at it.`;
    return `The app did not answer in time. Most likely macOS is showing a permission prompt; the user can click OK on it, or allow Falcon in System Settings, Privacy and Security, Automation, then ask again.`;
  }
  if (/-128|user canceled/i.test(raw)) return action === 'quit-app' ? `${a.name} did not quit: it was cancelled, probably because of unsaved work.` : 'It was cancelled.';
  if (/-10814|-1728|-600|can.t get application|application isn.t running/i.test(raw) && action === 'open-app') return `I could not find an app called ${a.name} on this Mac.`;
  if (/-43|-1700|file .* wasn.t found/i.test(raw)) return `${text} The file could not be found.`;
  return text;
}

const a = args();
const action = String(a.do || '').trim();
try {
  if (a['print-script']) {
    const scripts = Object.fromEntries(Object.entries(SCRIPTS).map(([k, v]) => [k, v.join('\n')]));
    console.log(JSON.stringify({ ok: true, scripts }));
  } else {
    if (!BUILD[action]) fail(`Unknown action "${action}". Use one of: ${Object.keys(BUILD).join(', ')}.`);
    const { argv, reply } = BUILD[action](a);
    const fullArgv = [action, ...argv];
    if (a['dry-run']) {
      console.log(JSON.stringify({ ok: true, action, script: SCRIPTS[action].join('\n'), argv: fullArgv }));
    } else {
      if (process.platform !== 'darwin') fail('This skill only works on a Mac.');
      const out = execFileSync('osascript', [...SCRIPTS[action].flatMap((l) => ['-e', l]), ...fullArgv],
        { encoding: 'utf8', timeout: 30000 }).replace(/\n$/, '');
      console.log(JSON.stringify({ ok: true, action, ...reply(out) }));
    }
  }
} catch (err) {
  console.log(JSON.stringify({ ok: false, action: action || undefined, error: plainError(err, action, a) }));
}
