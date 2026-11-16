#!/usr/bin/env node
// Captures the main screen to a JPEG next to this script (macOS) and prints one line of JSON.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screen.jpg');
try {
  fs.rmSync(out, { force: true });
  execFileSync('screencapture', ['-x', '-m', '-t', 'jpg', out], { timeout: 20000 });
  if (!fs.existsSync(out) || fs.statSync(out).size < 1000) {
    throw new Error('The screen could not be captured. Allow Screen Recording for Falcon in System Settings, Privacy and Security, then try again.');
  }
  // Scale down to at most 1600 px wide: enough to read, quicker to look at
  try { execFileSync('sips', ['-Z', '1600', out], { timeout: 20000, stdio: 'ignore' }); } catch { /* keep full size */ }
  let width; let height;
  try {
    const info = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', out], { encoding: 'utf8' });
    width = Number(/pixelWidth: (\d+)/.exec(info)?.[1]);
    height = Number(/pixelHeight: (\d+)/.exec(info)?.[1]);
  } catch { /* size is only informational */ }
  console.log(JSON.stringify({ ok: true, path: out, width, height }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: String(err.message || err).split('\n')[0] }));
}
