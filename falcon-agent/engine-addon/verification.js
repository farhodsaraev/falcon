import fs from 'node:fs';
import path from 'node:path';
import { inspectSlide } from './inspect-slide.js';

function hasPackageEntries(bytes, required) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > bytes.length || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length) return false;
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  if (!count || count > 2000 || offset + bytes.readUInt32LE(end + 12) !== end) return false;
  const names = new Set();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) return false;
    const length = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    if (local + 30 > offset || bytes.readUInt32LE(local) !== 0x04034b50 || offset + 46 + length + extra + comment > end) return false;
    names.add(bytes.subarray(offset + 46, offset + 46 + length).toString('utf8'));
    offset += 46 + length + extra + comment;
  }
  return offset === end && names.has(required) && names.has('[Content_Types].xml');
}

function output(result) {
  if (typeof result === 'string') return result;
  if (typeof result?.stdout === 'string') return result.stdout;
  return (result?.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
}
function jsonOutput(result) {
  if (result && typeof result.ok === 'boolean') return result;
  const text = output(result).trim();
  try { return JSON.parse(text); } catch {}
  // PowerShell may print an informational line before the final JSON.
  const last = text.split(/\r?\n/).pop();
  try { return JSON.parse(last); } catch { return null; }
}

export async function verifyToolResult(event, startedAt = 0, { readSlide = inspectSlide } = {}) {
  const tool = String(event.toolName || 'Tool').slice(0, 80);
  const parsed = jsonOutput(event.result);
  const result = event.result;
  const error = !!event.error || result?.isError || parsed?.ok === false ||
    (typeof result?.details?.exitCode === 'number' && result.details.exitCode !== 0) ||
    (typeof result?.exitCode === 'number' && result.exitCode !== 0);
  // Never put raw tool output (mail, passwords, keys) into task history.
  if (error) return { status: 'failed', label: 'Action failed', detail: 'The tool reported an error. See the reply for details.' };
  const command = String(event.params?.command || '');
  if (/^(exec|exec_command)$/.test(tool) && /make-document\.(mjs|ps1)/i.test(command) && parsed?.ok && typeof parsed.path === 'string' && ['docx', 'xlsx', 'pptx'].includes(parsed.type)) {
    try {
      const info = fs.statSync(parsed.path);
      if (!info.isFile() || !info.size || info.size > 32 * 1024 * 1024 || info.mtimeMs < startedAt - 1000) throw new Error('missing');
      const bytes = fs.readFileSync(parsed.path);
      const required = { docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml' }[parsed.type];
      if (!hasPackageEntries(bytes, required)) throw new Error('invalid');
      return { status: 'verified', label: `Created ${path.basename(parsed.path)}`, detail: `File exists and contains the expected ${parsed.type.toUpperCase()} structure. Opening its window was not verified.` };
    } catch { return { status: 'failed', label: 'Document not confirmed', detail: 'The reported file is missing, stale or unreadable.' }; }
  }
  if (/^(write|write_file)$/.test(tool) && typeof event.params?.path === 'string' && typeof event.params?.content === 'string') {
    try {
      const file = event.params.path;
      if (!path.isAbsolute(file)) throw new Error('relative path');
      if (fs.statSync(file).size > 8 * 1024 * 1024) throw new Error('large');
      if (fs.readFileSync(file, 'utf8') !== event.params.content) throw new Error('mismatch');
      return { status: 'verified', label: `Saved ${path.basename(file)}`, detail: 'Read back and matched the requested contents.' };
    } catch { return { status: 'failed', label: 'File contents not confirmed', detail: 'The saved file could not be matched to the requested contents.' }; }
  }
  if (/^(exec|exec_command)$/.test(tool) && /slides\.(ps1|mjs)/i.test(command) && parsed?.ok && typeof parsed.path === 'string' && path.isAbsolute(parsed.path) && Number.isInteger(parsed.slide)) {
    // A helper's stdout (including verified:true) is not an attestation. Read the app independently.
    const actual = await readSlide(parsed.path, parsed.app);
    if (!actual) return { status: 'unverified', label: 'Presentation result not confirmed', detail: 'The presentation app could not be inspected independently.' };
    const normalize = file => process.platform === 'win32' ? path.normalize(file).toLowerCase() : path.normalize(file);
    if (normalize(actual.path) !== normalize(parsed.path) || actual.slide !== parsed.slide || actual.total !== parsed.total) return { status: 'failed', label: 'Presentation state does not match', detail: 'The actual slide differs from the reported result.' };
    return { status: 'verified', label: `Presentation: slide ${actual.slide}`, detail: 'Read the current slide independently from the presentation app.' };
  }
  return { status: 'unverified', label: 'Tool returned', detail: 'The tool finished, but its effect has no independent check yet.' };
}
