#!/usr/bin/env node
// Gets a file ready to be sent (on Telegram or another chat): the engine sends files only from its own
// folders, and web pages (.html) only from its temporary folder. This copies the file there and prints
// the path to send. The original is not touched.
//
//   node share-file.mjs --path "C:\Users\...\Desktop\Falcon Scout\Uzum - 2026-11-17.html"
//   {"ok":true,"sendPath":"C:\\Users\\...\\Temp\\openclaw\\falcon-outbox\\Uzum - 2026-11-17.html","name":"...","sizeKb":42}
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAX_BYTES = 45 * 1024 * 1024; // Telegram bots may send files up to 50 MB

/** The engine's temporary folder: the one its log files are written to. */
export function engineTempFolder() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  const candidates = process.platform === 'win32'
    ? [path.join(os.tmpdir(), 'openclaw')]
    : ['/tmp/openclaw', uid !== undefined && `/tmp/openclaw-${uid}`, path.join(os.tmpdir(), 'openclaw'),
      uid !== undefined && path.join(os.tmpdir(), `openclaw-${uid}`), path.join(os.homedir(), '.openclaw', 'tmp', 'openclaw')].filter(Boolean);
  const exists = candidates.filter((dir) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } });
  const withLogs = exists.find((dir) => { try { return fs.readdirSync(dir).some((f) => /^openclaw.*\.log$/.test(f)); } catch { return false; } });
  return withLogs || exists[0] || candidates[0];
}

/** Copies a file into the engine's temporary folder and returns where it can be sent from. */
export function shareFile(file) {
  const source = path.resolve(String(file || ''));
  let info;
  try { info = fs.statSync(source); } catch { return { ok: false, error: 'That file does not exist.' }; }
  if (!info.isFile()) return { ok: false, error: 'That is a folder, not a file.' };
  if (info.size > MAX_BYTES) return { ok: false, error: 'That file is too large to send through the chat (over 45 MB).' };
  const outbox = path.join(engineTempFolder(), 'falcon-outbox');
  fs.mkdirSync(outbox, { recursive: true });
  // Clear out what was sent more than a day ago.
  try {
    for (const f of fs.readdirSync(outbox)) {
      const full = path.join(outbox, f);
      if (Date.now() - fs.statSync(full).mtimeMs > 86400000) fs.rmSync(full, { force: true });
    }
  } catch { /* nothing to clear */ }
  const name = path.basename(source);
  const target = path.join(outbox, name);
  fs.rmSync(target, { force: true });
  fs.copyFileSync(source, target); // a fresh copy (not a link): the engine refuses linked files
  return { ok: true, sendPath: target, name, sizeKb: Math.ceil(info.size / 1024) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--path');
  const result = at >= 0 && argv[at + 1] ? shareFile(argv[at + 1]) : { ok: false, error: 'Give the file with --path.' };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.ok ? 0 : 1);
}
