#!/usr/bin/env node
// Records Falcon's voice for the landing page with Google's speech service (Gemini text-to-speech).
//
//   node scripts/make-voice.mjs
//
// It asks for a Google AI key (from https://aistudio.google.com/apikey). The key is typed into this
// window only; it is never saved to a file and never goes into the page.
// The text comes from docs/lines.js, the recordings go to docs/voice/<name>.wav.
//
// Options:
//   --voice Schedar   try another voice (default: Algieba). Others worth trying: Charon, Iapetus, Sadaltager, Orus
//   --only intro      record just one line, to hear a voice quickly
//   --force           record everything again, even lines that have not changed

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs', 'voice');
const madeFile = join(outDir, 'made.json');

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const VOICE = option('--voice') || 'Algieba';
const ONLY = option('--only');
const FORCE = args.includes('--force');
const STYLE = 'A calm, courteous English butler speaking to a guest. Warm, unhurried, quietly confident. British accent, received pronunciation.';
const API = 'https://generativelanguage.googleapis.com/v1beta';
// Newest first. If Google renames a model, the next one is tried.
const MODELS = ['gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview'];
const OLD_MODELS = ['gemini-2.5-flash-preview-tts'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readLines() {
  const box = { window: {} };
  vm.runInNewContext(readFileSync(join(root, 'docs', 'lines.js'), 'utf8'), box);
  return box.window.FALCON_LINES;
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(question);
    rl._writeToOutput = () => {}; // do not show the key as it is typed or pasted
    rl.question('', (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

// Finds the base64 sound inside whatever shape the answer has.
function findAudio(node) {
  if (!node || typeof node !== 'object') return null;
  if (typeof node.data === 'string' && node.data.length > 2000 && (node.type === 'audio' || /audio/.test(node.mime_type || node.mimeType || ''))) return node.data;
  for (const value of Object.values(node)) {
    const found = findAudio(value);
    if (found) return found;
  }
  return null;
}

// Google sends either a finished WAV file or bare sound (24 kHz, mono, 16-bit). Bare sound gets a WAV header.
function toWav(bytes) {
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF') return bytes;
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + bytes.length, 4); head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(24000, 24); head.writeUInt32LE(48000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(bytes.length, 40);
  return Buffer.concat([head, bytes]);
}

class Stop extends Error {}

async function post(url, key, body) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });
    if (res.ok) return res.json();
    const text = await res.text();
    const reason = (() => {
      try { const j = JSON.parse(text); return (Array.isArray(j) ? j[0] : j).error.message; } catch { return text.slice(0, 300); }
    })();
    if (res.status === 401 || /API key not valid|API_KEY_INVALID/i.test(text)) throw new Stop('Google did not accept the key. Check that you copied the whole key from aistudio.google.com/apikey.');
    if (res.status === 403) throw new Stop(`Google refused the request: ${reason}`);
    if ((res.status === 429 || res.status >= 500) && attempt <= 5) {
      console.log(`    Google asks to slow down; waiting ${attempt * 30} seconds...`);
      await sleep(attempt * 30000);
      continue;
    }
    const err = new Error(reason); err.status = res.status; throw err;
  }
}

let working = null; // the request shape that worked, reused for the remaining lines
async function record(text, key) {
  const shapes = working ? [working] : [
    ...MODELS.map((model) => ({ kind: 'new', model })),
    ...OLD_MODELS.map((model) => ({ kind: 'old', model })),
  ];
  let last = null;
  for (const shape of shapes) {
    try {
      const json = shape.kind === 'new'
        ? await post(`${API}/interactions`, key, {
            model: shape.model,
            input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style: STYLE }] }] }],
            response_format: { type: 'audio' },
            generation_config: { speech_config: [{ voice: VOICE }] },
          })
        : await post(`${API}/models/${shape.model}:generateContent`, key, {
            contents: [{ parts: [{ text: `${STYLE} Say exactly this: ${text}` }] }],
            generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
          });
      const data = findAudio(json);
      if (!data) throw new Error('the answer had no sound in it');
      working = shape;
      return toWav(Buffer.from(data, 'base64'));
    } catch (err) {
      if (err instanceof Stop) throw err;
      last = err;
    }
  }
  throw new Stop(`Google could not record this line: ${last ? last.message : 'unknown reason'}`);
}

const lines = readLines();
const names = Object.keys(lines).filter((name) => !ONLY || name === ONLY);
if (!names.length) { console.error(`\n  There is no line called "${ONLY}". Lines: ${Object.keys(lines).join(', ')}\n`); process.exit(1); }

console.log('\n  F A L C O N   voice recording\n');
const key = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || await askHidden('  Paste your Google AI key and press Enter (it stays hidden): ')).trim();
if (!key) { console.error('  No key given. Nothing was recorded.\n'); process.exit(1); }

mkdirSync(outDir, { recursive: true });
const made = existsSync(madeFile) ? JSON.parse(readFileSync(madeFile, 'utf8')) : {};
let recorded = 0, kept = 0, bytes = 0;
try {
  for (const name of names) {
    const text = lines[name].join('\n\n');
    const mark = createHash('sha256').update(`${VOICE}|${STYLE}|${text}`).digest('hex').slice(0, 16);
    const file = join(outDir, `${name}.wav`);
    if (!FORCE && made[name] === mark && existsSync(file)) { kept++; console.log(`  ${name}: already recorded, kept`); continue; }
    process.stdout.write(`  ${name}: recording...`);
    const wav = await record(text, key);
    writeFileSync(file, wav);
    made[name] = mark;
    writeFileSync(madeFile, JSON.stringify(made, null, 2) + '\n');
    recorded++; bytes += wav.length;
    console.log(` done (${Math.round((wav.length - 44) / 48000)} seconds of speech)`);
  }
} catch (err) {
  console.error(`\n\n  Stopped: ${err.message}\n  Lines recorded before this are saved; run the same command again to continue.\n`);
  process.exit(1);
}
console.log(`\n  Finished with the voice "${VOICE}": ${recorded} recorded, ${kept} kept, ${(bytes / 1048576).toFixed(1)} MB new.`);
console.log('  Open docs/index.html and click the orb to hear him.\n');
