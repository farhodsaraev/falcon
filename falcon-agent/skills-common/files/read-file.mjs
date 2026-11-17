#!/usr/bin/env node
// Reads what is written inside a file and prints it as one line of JSON. Read-only.
//
//   node read-file.mjs --path "<full path>" [--pages 10] [--max 20000]
//
// PDF and Word files are read with the readers that come with the engine; plain text is read directly.
//   {"ok":true,"path":"...","kind":"pdf","pages":3,"text":"...","truncated":false}
//   {"ok":false,"error":"..."}
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback; };
const done = (result) => { process.stdout.write(`${JSON.stringify(result)}\n`); process.exit(result.ok ? 0 : 1); };

const TEXT_KINDS = new Set(['txt', 'md', 'csv', 'tsv', 'json', 'log', 'xml', 'html', 'htm', 'rtf', 'yml', 'yaml', 'ini']);

// The engine brings a PDF reader and a zip reader with it. Find the folder they live in.
function engineModules() {
  const home = os.homedir();
  const starts = [process.execPath];
  try { starts.push(fs.realpathSync(process.execPath)); } catch { /* keep the plain path */ }
  const roots = [];
  for (const start of starts) {
    const dir = path.dirname(start);
    roots.push(path.join(dir, 'node_modules'), path.join(dir, '..', 'lib', 'node_modules'));
  }
  roots.push(
    path.join(home, '.openclaw', 'lib', 'node_modules'),
    path.join(home, '.openclaw', 'node_modules'),
    path.join(home, '.openclaw', 'tools', 'node', 'lib', 'node_modules'),
    path.join(home, '.npm-global', 'lib', 'node_modules'),
    path.join(home, '.local', 'lib', 'node_modules'),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node_modules'),
    '/opt/homebrew/lib/node_modules',
    '/usr/local/lib/node_modules',
  );
  // The engine's own launcher is a link into its package folder: follow it.
  for (const bin of [path.join(home, '.openclaw', 'bin'), path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', ...(process.env.PATH || '').split(path.delimiter)]) {
    try {
      let dir = path.dirname(fs.realpathSync(path.join(bin, 'openclaw')));
      for (let up = 0; up < 6; up++) { roots.push(path.join(dir, 'node_modules'), path.dirname(dir)); dir = path.dirname(dir); }
    } catch { /* no launcher here */ }
  }
  for (const root of roots) {
    for (const modules of [path.join(root, 'openclaw', 'node_modules'), root]) {
      if (fs.existsSync(path.join(modules, 'clawpdf', 'package.json'))) return modules;
    }
  }
  return null;
}

async function load(modules, name) {
  const dir = path.join(modules, name);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const entry = pkg.exports?.['.']?.import || pkg.exports?.['.']?.default || pkg.module || pkg.main || 'index.js';
  let file = path.join(dir, typeof entry === 'string' ? entry : entry.default);
  // Old packages name their entry without ".js" ("main": "./lib/index"), which import() does not accept.
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = [`${file}.js`, path.join(file, 'index.js')].find((f) => fs.existsSync(f)) || file;
  return import(pathToFileURL(file).href);
}

async function readPdf(file, maxPages) {
  const modules = engineModules();
  if (!modules) throw new Error('The PDF reader that comes with the engine was not found.');
  const { openPdf } = await load(modules, 'clawpdf');
  const pdf = await openPdf(file);
  try {
    const pages = typeof pdf.pageCount === 'function' ? pdf.pageCount() : pdf.pageCount;
    const text = pdf.text({ maxPages });
    return { pages, pagesRead: Math.min(pages, maxPages), text };
  } finally {
    try { await pdf.destroy(); } catch { /* already closed */ }
  }
}

// A Word file is a zip with the text in word/document.xml.
async function readDocx(file) {
  const modules = engineModules();
  if (!modules || !fs.existsSync(path.join(modules, 'jszip'))) throw new Error('The Word reader that comes with the engine was not found.');
  const JSZip = (await load(modules, 'jszip')).default;
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('This does not look like a Word document.');
  const text = xml
    .replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<\/w:tc>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  return { text };
}

try {
  const file = option('--path');
  if (!file) done({ ok: false, error: 'Give the full path of the file with --path.' });
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) done({ ok: false, error: `There is no file at ${file}.` });
  const max = Math.max(500, Number(option('--max', 20000)) || 20000);
  const maxPages = Math.max(1, Number(option('--pages', 30)) || 30);
  const kind = path.extname(file).slice(1).toLowerCase();

  let result;
  if (kind === 'pdf') result = await readPdf(file, maxPages);
  else if (kind === 'docx') result = await readDocx(file);
  else if (TEXT_KINDS.has(kind)) result = { text: fs.readFileSync(file, 'utf8') };
  else done({ ok: false, error: `I cannot read inside .${kind || 'unknown'} files yet. PDF, Word (.docx) and plain text files work.` });

  const text = String(result.text || '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const out = { ok: true, path: file, kind };
  if (result.pages) { out.pages = result.pages; out.pagesRead = result.pagesRead; }
  out.text = text.slice(0, max);
  out.truncated = text.length > max || (result.pages ? result.pagesRead < result.pages : false);
  if (!text && kind === 'pdf') out.note = 'This PDF has no text in it; it is probably a scan or a picture.';
  done(out);
} catch (err) {
  const message = /password/i.test(`${err?.name} ${err?.message}`) ? 'This PDF is protected with a password.' : `The file could not be read: ${err?.message || err}`;
  done({ ok: false, error: message });
}
