#!/usr/bin/env node
// Opens a presentation (by path, by words in its name, or the one already open) and jumps to a slide (macOS).
// Keynote files open in Keynote. PowerPoint files open in PowerPoint when it is installed, otherwise in Keynote.
// Prints one line of JSON.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function args() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] ?? '';
  return out;
}
const osa = (lines, argv = []) => execFileSync('osascript', [...lines.flatMap((l) => ['-e', l]), ...argv],
  { encoding: 'utf8', timeout: 60000 }).trim();
const appInstalled = (name) => ['/Applications', path.join(os.homedir(), 'Applications')]
  .some((dir) => fs.existsSync(path.join(dir, `${name}.app`)));
const isRunning = (name) => { try { return osa([`application "${name}" is running`]) === 'true'; } catch { return false; } };

function findDeck(find) {
  const words = find.toLowerCase().split(/\s+/).filter(Boolean);
  const isDeck = (f) => /\.(key|pptx|ppt)$/i.test(f) && !path.basename(f).startsWith('~$') &&
    words.every((w) => path.basename(f).toLowerCase().includes(w));
  const folders = ['Desktop', 'Documents', 'Downloads'].map((f) => path.join(os.homedir(), f)).filter((f) => fs.existsSync(f));
  let found = [];
  for (const folder of folders) {
    try {
      const out = execFileSync('mdfind', ['-onlyin', folder, '-name', words[0] || '.key'], { encoding: 'utf8', timeout: 8000 });
      found.push(...out.split('\n').filter((f) => f && isDeck(f)));
    } catch { /* fall through to the folder search */ }
  }
  if (found.length === 0) {
    const walk = (dir, depth) => {
      if (depth > 6) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'Library') continue;
        const full = path.join(dir, e.name);
        // A Keynote file can be a folder ("package"), so test the name before descending.
        if (isDeck(full)) found.push(full);
        else if (e.isDirectory() && !e.name.endsWith('.app')) walk(full, depth + 1);
      }
    };
    for (const folder of folders) walk(folder, 0);
  }
  return found.map((f) => ({ f, t: fs.statSync(f).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.f;
}

function keynote(file, slide) {
  const lines = ['on run argv', 'tell application "Keynote"', 'activate'];
  if (file) lines.push('set theDoc to open (POSIX file (item 1 of argv))');
  else lines.push('if (count of documents) is 0 then error "No presentation is open."', 'set theDoc to front document');
  lines.push('set total to count of slides of theDoc');
  if (slide > 0) {
    lines.push(`if ${slide} > total then error "The presentation has only " & total & " slides."`,
      `set current slide of theDoc to slide ${slide} of theDoc`,
      `start theDoc from slide ${slide} of theDoc`);
  }
  lines.push('return (name of theDoc) & "|" & total', 'end tell', 'end run');
  return osa(lines, file ? [file] : []);
}

function powerpoint(file, slide) {
  const lines = ['on run argv', 'tell application "Microsoft PowerPoint"', 'activate'];
  if (file) lines.push('open (POSIX file (item 1 of argv))');
  lines.push('if (count of presentations) is 0 then error "No presentation is open."',
    'set thePres to active presentation', 'set total to count of slides of thePres');
  if (slide > 0) {
    lines.push(`if ${slide} > total then error "The presentation has only " & total & " slides."`,
      'if (count of slide show windows) is 0 then run slide show (slide show settings of thePres)',
      'delay 0.6',
      `go to slide (slide show view of slide show window 1) number ${slide}`);
  }
  lines.push('return (name of thePres) & "|" & total', 'end tell', 'end run');
  return osa(lines, file ? [file] : []);
}

try {
  const { find = '', slide: slideArg = '0' } = args();
  let file = args().path || '';
  const slide = Number.parseInt(slideArg, 10) || 0;
  if (!file && find) {
    file = findDeck(find);
    if (!file) throw new Error(`No presentation with '${find}' in its name was found.`);
  }
  if (file && !fs.existsSync(file)) throw new Error(`"${file}" does not exist.`);

  const hasPowerPoint = appInstalled('Microsoft PowerPoint');
  let app;
  if (file) app = /\.key$/i.test(file) || !hasPowerPoint ? 'Keynote' : 'Microsoft PowerPoint';
  else app = hasPowerPoint && isRunning('Microsoft PowerPoint') ? 'Microsoft PowerPoint' : 'Keynote';
  if (app === 'Keynote' && !appInstalled('Keynote') && !fs.existsSync('/System/Applications/Keynote.app')) {
    throw new Error('Neither Keynote nor PowerPoint is installed on this Mac.');
  }

  const [name, total] = (app === 'Keynote' ? keynote(file, slide) : powerpoint(file, slide)).split('|');
  console.log(JSON.stringify({ ok: true, app, name, path: file || undefined, slide: slide || 1, total: Number(total) }));
} catch (err) {
  const text = String(err.stderr || err.message || err).trim().split('\n').pop();
  const hint = /-1743|not authori[sz]ed|not allowed/i.test(text)
    ? ' Allow Falcon to control the app in System Settings, Privacy and Security, Automation.' : '';
  console.log(JSON.stringify({ ok: false, error: text.replace(/^.*execution error: /, '') + hint }));
}
