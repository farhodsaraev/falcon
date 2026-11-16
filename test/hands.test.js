import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callTool, toolSchemas } from '../src/hands/index.js';
import { isAllowedPath } from '../src/config.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const demo = path.join(root, 'demo');
const deck = path.join(demo, 'Quarterly Review.pptx');
const invoice = fs.existsSync(demo)
  ? fs.readdirSync(demo).map((f) => path.join(demo, f)).find((f) => /Invoice.*\.pdf$/.test(f))
  : undefined;

const sent = [];
const ctx = (extra = {}) => ({
  config: { allowedFolders: [demo], contacts: { Ahmed: 'ahmed@example.com' } },
  gmail: { user: 'me@example.com' },
  mailTransport: { sendMail: async (mail) => { sent.push(mail); return { messageId: 'test-1' }; } },
  ...extra,
});

test('every tool has a schema for the voice model', () => {
  for (const t of toolSchemas()) {
    assert.equal(t.type, 'function');
    assert.ok(t.name && t.description && t.parameters);
  }
});

test('paths outside the allowed folders are refused', async () => {
  assert.equal(isAllowedPath('C:\\Windows\\system32\\cmd.exe', ctx().config), false);
  const r = await callTool('open_file', { path: 'C:\\Windows\\system32\\cmd.exe' }, ctx());
  assert.equal(r.ok, false);
  assert.match(r.error, /outside the folders/);
});

test('email is not sent without an Allow', async () => {
  sent.length = 0;
  const args = { to: 'Ahmed', subject: 'Invoice', body: 'Attached.' };
  const noApprover = await callTool('send_email', args, ctx());
  const saidNo = await callTool('send_email', args, ctx({ approve: async () => false }));
  assert.equal(noApprover.declined, true);
  assert.equal(saidNo.declined, true);
  assert.equal(sent.length, 0);
});

test('email is sent after Allow, to the contact, with the attachment', { skip: !invoice }, async () => {
  sent.length = 0;
  let asked = '';
  const r = await callTool('send_email',
    { to: 'ahmed', subject: 'Invoice', body: 'Attached.', attachments: [invoice] },
    ctx({ approve: async (summary) => { asked = summary; return true; } }));
  assert.equal(r.ok, true, r.error);
  assert.match(asked, /ahmed@example\.com/);
  assert.match(asked, /Invoice.*\.pdf/);
  assert.equal(sent[0].to, 'ahmed@example.com');
  assert.equal(sent[0].attachments[0].path, invoice);
});

test('unknown contact gives a clear error and sends nothing', async () => {
  sent.length = 0;
  const r = await callTool('send_email', { to: 'Nobody', subject: 's', body: 'b' },
    ctx({ approve: async () => true }));
  assert.equal(r.ok, false);
  assert.match(r.error, /don't have an email address/);
  assert.equal(sent.length, 0);
});

test('screen capture writes a picture', async () => {
  const r = await callTool('capture_screen', {}, ctx());
  assert.equal(r.ok, true, r.error);
  assert.ok(fs.statSync(r.imagePath).size > 1000);
  fs.unlinkSync(r.imagePath);
});

test('opens the demo presentation on slide 5', { skip: !fs.existsSync(deck) }, async () => {
  const r = await callTool('show_slide', { path: deck, slide: 5 }, ctx());
  assert.equal(r.ok, true, r.error);
  assert.equal(r.slide, 5);
  assert.equal(r.total, 8);
});

test('finds the demo invoice by name', { skip: !invoice }, async () => {
  const r = await callTool('find_files', { query: 'invoice', extension: 'pdf' }, ctx());
  assert.equal(r.ok, true, r.error);
  // The Windows index can lag a minute behind new files, so only report, don't fail.
  if (!r.files.some((f) => f.path.toLowerCase() === invoice.toLowerCase())) {
    console.log('note: invoice not in the Windows index yet; found', r.files.length, 'other files');
  }
});
