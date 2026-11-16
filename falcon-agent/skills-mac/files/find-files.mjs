#!/usr/bin/env node
// Finds files by words in the name (macOS). Spotlight first, plain folder search as a fallback.
// Prints one line of JSON, newest files first.
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

const { query = '', ext = '', max = '8' } = args();
const words = query.toLowerCase().split(/\s+/).filter(Boolean);
const exts = ext.toLowerCase().split(/[,; ]+/).filter(Boolean).map((e) => '.' + e.replace(/^\./, ''));
const folders = ['Desktop', 'Documents', 'Downloads'].map((f) => path.join(os.homedir(), f)).filter((f) => fs.existsSync(f));

const matches = (file) => {
  const name = path.basename(file).toLowerCase();
  return !name.startsWith('~$') && !name.startsWith('.') &&
    words.every((w) => name.includes(w)) &&
    (exts.length === 0 || exts.includes(path.extname(name)));
};

function spotlight() {
  if (words.length === 0) return [];
  const found = [];
  for (const folder of folders) {
    try {
      const out = execFileSync('mdfind', ['-onlyin', folder, '-name', words[0]], { encoding: 'utf8', timeout: 8000 });
      found.push(...out.split('\n').filter(Boolean));
    } catch { /* Spotlight off or slow: the folder search below covers it */ }
  }
  return found;
}

function walk(dir, depth, found) {
  if (depth > 6 || found.length > 5000) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'Library') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!entry.name.endsWith('.app')) walk(full, depth + 1, found); }
    else if (matches(full)) found.push(full);
  }
}

try {
  let source = 'index';
  let files = spotlight().filter((f) => { try { return fs.statSync(f).isFile() && matches(f); } catch { return false; } });
  if (files.length === 0) {
    source = 'folders';
    for (const folder of folders) walk(folder, 0, files);
  }
  const result = [...new Set(files)]
    .map((f) => { const s = fs.statSync(f); return { path: f, modified: s.mtime, sizeKb: Math.round(s.size / 1024) }; })
    .sort((a, b) => b.modified - a.modified)
    .slice(0, Number(max) || 8)
    .map((f) => ({ ...f, modified: f.modified.toISOString().slice(0, 16).replace('T', ' ') }));
  console.log(JSON.stringify({ ok: true, source, files: result }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err.message }));
}
