// Pictures, videos and music Falcon makes. The engine writes each finished one into its own media
// folder and names it on a "MEDIA:" line at the end of his answer. These helpers find those lines,
// decide what may be shown in the window, and keep a copy where the user will look for it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TYPES = {
  image: { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' },
  video: { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' },
  audio: { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' },
};
const MAX_BYTES = 300 * 1024 * 1024;

/** What kind of thing a file is, by its ending: { kind, type }, or null when the window does not show it. */
export function mediaType(file) {
  const ending = path.extname(String(file || '')).toLowerCase();
  for (const [kind, types] of Object.entries(TYPES)) if (types[ending]) return { kind, type: types[ending] };
  return null;
}

/**
 * Takes the "MEDIA:" lines out of an answer. Returns the words that remain and the files named.
 * Only a line that starts with MEDIA: counts (as the engine itself reads it); one inside a code block,
 * or in the middle of a sentence, is ordinary text.
 */
export function splitMedia(text) {
  const files = [];
  const kept = [];
  let fenced = false;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (/^ {0,3}(```|~~~)/.test(line)) fenced = !fenced;
    const named = fenced ? null : /^ {0,3}MEDIA:\s*(.+?)\s*$/.exec(line);
    if (named) files.push(named[1].replace(/^"(.*)"$/, '$1'));
    else kept.push(line);
  }
  return { text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), files };
}

/**
 * Whether a file Falcon named may be shown: it must exist, be a picture, video or sound, and really
 * sit inside `root` (the engine's media folder). Anything else he names is ignored, so an answer can
 * never make the window hand out some other file. Returns { file, kind, type } or null.
 */
export function admitMedia(named, root) {
  let file = String(named || '').trim();
  if (!file || /^[a-z][a-z0-9+.-]{1,20}:\/\//i.test(file)) return null;       // a web address, not a file here
  if (/^~[\\/]/.test(file)) file = path.join(os.homedir(), file.slice(2));
  if (!path.isAbsolute(file)) return null;
  const known = mediaType(file);
  if (!known) return null;
  try {
    const real = fs.realpathSync(file);
    const within = path.relative(fs.realpathSync(root), real);
    if (!within || within.startsWith('..') || path.isAbsolute(within)) return null;
    const stat = fs.statSync(real);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES) return null;
    return { file: real, ...known };
  } catch {
    return null;       // not there, or not readable
  }
}

/** The newest picture, video or sound written into a folder since a moment in time, or null. */
export function newestSince(folder, since) {
  let newest = null;
  try {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isFile() || !mediaType(entry.name)) continue;
      const file = path.join(folder, entry.name);
      const at = fs.statSync(file).mtimeMs;
      if (at >= since && (!newest || at > newest.at)) newest = { file, at };
    }
  } catch { /* no such folder yet */ }
  return newest ? newest.file : null;
}

/** Where the user's own pictures, videos or music live on this computer, with a "Falcon" folder inside. */
export function keepFolder(kind, home = os.homedir()) {
  const names = { image: ['Pictures'], video: ['Videos', 'Movies'], audio: ['Music'] }[kind] || ['Pictures'];
  const places = names.flatMap((name) => [path.join(home, name), path.join(home, 'OneDrive', name)]);
  return path.join(places.find((place) => fs.existsSync(place)) || home, 'Falcon');
}

/**
 * Copies a finished picture or video into the user's own folder under a plain name
 * ("Falcon 2026-11-18 21.45.12.jpg"). Returns the copy's path, or null if it could not be written.
 */
export function keepCopy(file, folder, now = new Date()) {
  try {
    fs.mkdirSync(folder, { recursive: true });
    const two = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}.${two(now.getMinutes())}.${two(now.getSeconds())}`;
    const ending = path.extname(file).toLowerCase();
    for (let n = 1; n < 50; n++) {
      const copy = path.join(folder, `Falcon ${stamp}${n > 1 ? ` (${n})` : ''}${ending}`);
      try { fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL); return copy; } catch (err) { if (err.code !== 'EEXIST') return null; }
    }
  } catch { /* the folder cannot be written to */ }
  return null;
}
