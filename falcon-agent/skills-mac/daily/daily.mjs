#!/usr/bin/env node
// Reads the user's day from the Mac's own apps: Calendar, Mail and Reminders. Read-only.
//   node daily.mjs --what calendar [--day today|tomorrow|YYYY-MM-DD]
//   node daily.mjs --what mail [--max 8]
//   node daily.mjs --what reminders
// Prints one line of JSON.
import { execFileSync } from 'node:child_process';

function args() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] ?? '';
  return out;
}
// The first argument is a fixed word, so a value such as "-1" can never be read as an option.
const osa = (lines, argv = []) => execFileSync('osascript', [...lines.flatMap((l) => ['-e', l]), ...(argv.length ? ['falcon', ...argv] : [])],
  { encoding: 'utf8', timeout: 30000 }).trim();
const rows = (text) => text.split('\n').filter(Boolean).map((line) => line.split('\t').map((v) => (v === 'missing value' ? '' : v.trim())));
const clock = (iso) => iso.slice(11, 16);

function calendar(day) {
  let offset = 0;
  if (day === 'tomorrow') offset = 1;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    offset = Math.round((new Date(`${day}T00:00:00`) - midnight) / 86400000);
  }
  const text = osa([
    'on run argv',
    'set d1 to current date',
    'set time of d1 to 0',
    'set d1 to d1 + ((item 2 of argv) as integer) * days',
    'set d2 to d1 + 1 * days',
    'set out to ""',
    'tell application "Calendar"',
    'repeat with c in calendars',
    'try',
    'set evs to (every event of c whose start date is greater than or equal to d1 and start date is less than d2)',
    'repeat with e in evs',
    'set out to out & (name of c) & tab & (summary of e) & tab & ((start date of e) as «class isot» as string) & tab & ((end date of e) as «class isot» as string) & tab & (allday event of e) & tab & (location of e) & linefeed',
    'end repeat',
    'end try',
    'end repeat',
    'end tell',
    'return out',
    'end run',
  ], [String(offset)]);
  const events = rows(text).map(([cal, title, start, end, allDay, location]) => ({
    calendar: cal, title, start: allDay === 'true' ? 'all day' : clock(start), end: allDay === 'true' ? '' : clock(end), location,
  })).sort((a, b) => a.start.localeCompare(b.start));
  return { day: day || 'today', events, note: 'Repeating events may be missing from this list. If the user keeps his calendar in Google or Outlook, check it in the browser as well.' };
}

function mail(max) {
  const text = osa([
    'on run argv',
    'set out to ""',
    'tell application "Mail"',
    'set unreadMessages to (messages of inbox whose read status is false)',
    'set total to count of unreadMessages',
    'set upTo to (item 2 of argv) as integer',
    'if total < upTo then set upTo to total',
    'repeat with i from 1 to upTo',
    'set m to item i of unreadMessages',
    'set out to out & (sender of m) & tab & (subject of m) & tab & ((date received of m) as «class isot» as string) & linefeed',
    'end repeat',
    'return (total as string) & linefeed & out',
    'end tell',
    'end run',
  ], [String(max)]);
  const [total, ...rest] = text.split('\n');
  return { unread: Number(total) || 0, newest: rows(rest.join('\n')).map(([from, subject, received]) => ({ from, subject, received: received.replace('T', ' ').slice(0, 16) })) };
}

function reminders() {
  const text = osa([
    'set out to ""',
    'tell application "Reminders"',
    'repeat with r in (reminders whose completed is false)',
    'set dueText to ""',
    'try',
    'set dueText to ((due date of r) as «class isot» as string)',
    'end try',
    'set out to out & (name of r) & tab & dueText & linefeed',
    'end repeat',
    'end tell',
    'return out',
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const all = rows(text).map(([title, due]) => ({ title, due: due ? due.replace('T', ' ').slice(0, 16) : '' }));
  return { dueTodayOrOverdue: all.filter((r) => r.due && r.due.slice(0, 10) <= today), withoutDate: all.filter((r) => !r.due).length, later: all.filter((r) => r.due && r.due.slice(0, 10) > today).length };
}

try {
  const { what = 'calendar', day = 'today', max = '8' } = args();
  const result = what === 'mail' ? mail(Number(max) || 8) : what === 'reminders' ? reminders() : calendar(day);
  console.log(JSON.stringify({ ok: true, what, ...result }));
} catch (err) {
  const text = String(err.stderr || err.message || err).trim().split('\n').pop().replace(/^.*execution error: /, '');
  const hint = /-1743|not authori[sz]ed|not allowed|-1712|timed out|ETIMEDOUT/i.test(text)
    ? ' The app did not answer. Most likely macOS is showing a permission prompt, or has not yet allowed Falcon to read this app: the user can click OK on the prompt, or allow it in System Settings, Privacy and Security, Automation, then ask again.' : '';
  console.log(JSON.stringify({ ok: false, error: text + hint }));
}
