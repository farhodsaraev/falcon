import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const maker = path.join(root, 'falcon-agent', 'skills-common', 'documents', 'make-document.mjs');
const reader = path.join(root, 'falcon-agent', 'skills-common', 'files', 'read-file.mjs');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-docs-'));

function make(spec, extra = []) {
  const file = path.join(out, `spec-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(spec));
  try {
    return JSON.parse(execFileSync(process.execPath, [maker, '--spec', file, '--dir', out, ...extra], { encoding: 'utf8' }));
  } catch (err) {
    return JSON.parse(err.stdout);
  }
}

// A small zip reader: walk the central directory and inflate each entry.
function unzip(file) {
  const buf = fs.readFileSync(file);
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'zip has an end record');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const entries = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50, 'central directory entry');
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    assert.equal(buf.readUInt32LE(local), 0x04034b50, `local header for ${name}`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    entries[name] = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Tags balance, attributes are quoted, and no raw "<" or stray "&" sits in text.
function assertWellFormed(name, xml) {
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'), `${name} has an XML declaration`);
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, '');
  const stack = [];
  let last = 0;
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g;
  for (let m; (m = tag.exec(body));) {
    const between = body.slice(last, m.index);
    assert.ok(!between.includes('<') && !/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(between), `${name}: bad text before ${m[0].slice(0, 40)}`);
    for (const value of m[3].matchAll(/="([^"]*)"/g)) assert.ok(!/&(?!(amp|lt|gt|quot|apos);)/.test(value[1]), `${name}: bad attribute ${value[1]}`);
    if (m[1]) assert.equal(stack.pop(), m[2], `${name}: </${m[2]}> closes the wrong tag`);
    else if (!m[4]) stack.push(m[2]);
    if (!stack.length) assert.equal(body.slice(m.index + m[0].length).trim(), '', `${name}: one root element`);
    last = tag.lastIndex;
  }
  assert.equal(stack.length, 0, `${name}: unclosed ${stack.join(', ')}`);
  assert.equal(body.slice(last).trim(), '', `${name}: nothing after the root`);
}

function check(file, required) {
  const parts = unzip(file);
  assert.equal(Object.keys(parts)[0], '[Content_Types].xml');
  for (const part of required) assert.ok(parts[part], `${path.basename(file)} has ${part}`);
  for (const [name, xml] of Object.entries(parts)) assertWellFormed(name, xml);
  // Every relationship target exists, and every part has a content type.
  const types = parts['[Content_Types].xml'];
  for (const [name, xml] of Object.entries(parts)) {
    if (!name.endsWith('.rels')) {
      if (name !== '[Content_Types].xml') assert.ok(types.includes(`PartName="/${name}"`), `${name} has a content type`);
      continue;
    }
    const base = path.posix.dirname(path.posix.dirname(name));
    for (const [, target] of xml.matchAll(/Target="([^"]+)"/g)) {
      const resolved = path.posix.normalize(path.posix.join(base === '.' ? '' : base, target));
      assert.ok(parts[resolved], `${name} points at ${resolved}, which exists`);
    }
  }
  return parts;
}

test('a Word document is made with headings, lists, a table and escaped Russian text', () => {
  const result = make({
    type: 'docx', title: 'Отчёт & план', extra: 'ignored',
    blocks: [
      { heading: 'Итоги', level: 1 },
      { paragraph: 'R&D <beta> "quoted" — **важно**\u0007' },
      { bullets: ['Первый', 'Second & third'] },
      { numbered: ['One', 'Two'] },
      { numbered: ['Again one'] },
      { table: [['Имя', 'Сумма'], ['Ann & Co', 12.5], ['Борис']] },
      { unknown: true },
    ],
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.type, 'docx');
  assert.equal(result.skipped, 1);
  assert.equal(path.basename(result.path), 'Отчёт & план.docx');
  const parts = check(result.path, ['_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml']);
  const doc = parts['word/document.xml'];
  assert.match(doc, /Отчёт &amp; план/);
  assert.match(doc, /R&amp;D &lt;beta&gt; &quot;quoted&quot; — /);
  assert.match(doc, /<w:b\/><w:bCs\/><\/w:rPr><w:t xml:space="preserve">важно<\/w:t>/);
  assert.doesNotMatch(doc, /\u0007|\*\*/);
  assert.match(doc, /Ann &amp; Co/);
  assert.equal((doc.match(/<w:tc>/g) || []).length, 6, 'short rows are padded');
  assert.equal((parts['word/numbering.xml'].match(/<w:startOverride w:val="1"\/>/g) || []).length, 2, 'each numbered list starts at 1');

  // The files skill reads the text back (when the engine's zip reader is installed).
  let read;
  try { read = JSON.parse(execFileSync(process.execPath, [reader, '--path', result.path], { encoding: 'utf8' })); } catch (err) { read = JSON.parse(err.stdout); }
  if (read.ok) {
    assert.match(read.text, /Отчёт & план/);
    assert.match(read.text, /R&D <beta> "quoted"/);
    assert.match(read.text, /Борис/);
  } else {
    assert.match(read.error, /not found/, `read-file failed for another reason: ${read.error}`);
  }
});

test('a spreadsheet keeps numbers as numbers, writes formulas and bolds the header', () => {
  const result = make({
    type: 'xlsx', title: 'Бюджет',
    sheets: [
      { name: 'Расходы', rows: [['Статья', 'Сумма'], ['Аренда', 1200], ['Food & drink', 345.5], ['Итого', '=SUM(B2:B3)'], ['ok', true]] },
      { name: 'Bad/Name:*?', rows: [['A'], [1]] },
      { name: 'расходы', rows: [] },
    ],
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.sheets, 3);
  const parts = check(result.path, ['xl/workbook.xml', 'xl/styles.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet3.xml', 'xl/_rels/workbook.xml.rels']);
  const sheet = parts['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /<c r="B2"><v>1200<\/v><\/c>/);
  assert.match(sheet, /<c r="B3"><v>345.5<\/v><\/c>/);
  assert.match(sheet, /<c r="B4"><f>SUM\(B2:B3\)<\/f><\/c>/);
  assert.match(sheet, /<c r="B5" t="b"><v>1<\/v><\/c>/);
  assert.match(sheet, /<c r="A1" s="1" t="s">/);
  assert.match(sheet, /<col min="1" max="1" width="\d+"/);
  assert.match(parts['xl/sharedStrings.xml'], /Food &amp; drink/);
  assert.match(parts['xl/workbook.xml'], /name="Расходы".*name="Bad Name".*name="расходы \(2\)"/);
});

test('a presentation has a title slide, bullet slides and speaker notes', () => {
  const result = make({
    type: 'pptx', title: 'Стратегия & рост', subtitle: 'Ноябрь',
    slides: [
      { title: 'Почему <сейчас>', bullets: ['Рынок растёт', 'R&D'], notes: 'Скажи про рынок & цены' },
      { title: 'Plan', bullets: ['One', 'Two'] },
    ],
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.slides, 3);
  const parts = check(result.path, ['ppt/presentation.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/slideLayouts/slideLayout2.xml',
    'ppt/theme/theme1.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide3.xml', 'ppt/notesMasters/notesMaster1.xml', 'ppt/notesSlides/notesSlide2.xml']);
  assert.match(parts['ppt/presentation.xml'], /<p:sldSz cx="12192000" cy="6858000"\/>/);
  assert.match(parts['ppt/slides/slide1.xml'], /type="ctrTitle".*Стратегия &amp; рост.*Ноябрь/s);
  assert.match(parts['ppt/slides/slide2.xml'], /Почему &lt;сейчас&gt;.*lang="ru-RU".*R&amp;D/s);
  assert.match(parts['ppt/notesSlides/notesSlide2.xml'], /Скажи про рынок &amp; цены/);

  const plain = make({ type: 'pptx', title: 'No notes', slides: [{ title: 'Only' }] });
  assert.equal(plain.ok, true);
  const plainParts = check(plain.path, ['ppt/presentation.xml']);
  assert.ok(!Object.keys(plainParts).some((p) => p.includes('notes')), 'no notes parts when there are no notes');
});

test('an existing file is never overwritten, and bad input gets a plain answer', () => {
  const first = make({ type: 'docx', title: 'Same name', fileName: 'Same: name?.docx', blocks: [{ paragraph: 'one' }] });
  const second = make({ type: 'docx', title: 'Same name', fileName: 'Same: name?.docx', blocks: [{ paragraph: 'two' }] });
  assert.equal(path.basename(first.path), 'Same name.docx');
  assert.equal(path.basename(second.path), 'Same name (2).docx');
  assert.match(unzip(first.path)['word/document.xml'], /one/);

  assert.match(make({ type: 'pdf' }).error, /docx.*xlsx.*pptx/);
  assert.match(make({ type: 'xlsx' }).error, /no sheets/);
  assert.match(make({ type: 'docx' }).error, /nothing in it/);
  const bad = path.join(out, 'bad.json');
  fs.writeFileSync(bad, '{not json');
  let reply;
  try { execFileSync(process.execPath, [maker, '--spec', bad, '--dir', out], { encoding: 'utf8' }); } catch (err) { reply = JSON.parse(err.stdout); }
  assert.equal(reply.ok, false);
  assert.match(reply.error, /not valid JSON/);
});
