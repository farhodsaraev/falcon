import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installFalcon } from '../falcon-agent/install-falcon.mjs';

const variant = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : null;

function freshWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-ws-'));
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# AGENTS.md\n\nEngine defaults stay here.\n\n<!-- jarvis:start -->\nold section\n<!-- jarvis:end -->\n');
  fs.writeFileSync(path.join(dir, 'BOOTSTRAP.md'), 'first-run interview');
  return dir;
}

test('the pack installs into a workspace and can be re-run without duplicating itself', { skip: !variant }, async () => {
  const ws = freshWorkspace();
  const calls = [];
  const runEngine = async (args, opts) => { calls.push({ args, input: opts?.input }); return { code: 0, out: '' }; };
  for (let i = 0; i < 2; i++) await installFalcon({ workspace: ws, runEngine, log: () => {} });

  const agents = fs.readFileSync(path.join(ws, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Engine defaults stay here\./);
  assert.equal(agents.match(/falcon:start/g).length, 1);
  assert.doesNotMatch(agents, /jarvis|old section|\{\{[A-Z_]+\}\}/);
  assert.ok(agents.includes(path.join(ws, 'skills')), 'fast paths carry the real skills folder');
  assert.ok(!fs.existsSync(path.join(ws, 'BOOTSTRAP.md')));
  assert.match(fs.readFileSync(path.join(ws, 'SOUL.md'), 'utf8'), /Falcon/);

  for (const skill of ['files', 'presentations', 'screen', ...(variant === 'mac' ? ['daily'] : [])]) {
    const text = fs.readFileSync(path.join(ws, 'skills', skill, 'SKILL.md'), 'utf8');
    assert.doesNotMatch(text, /\{\{[A-Z_]+\}\}|<folder of this SKILL\.md>/);
    assert.ok(text.includes(path.join(ws, 'skills', skill)));
  }

  const once = calls.slice(0, calls.length / 2).map((c) => c.args.join(' '));
  assert.ok(once.includes('config set agents.defaults.thinkingDefault off'));
  assert.ok(once.includes('config set gateway.http.endpoints.chatCompletions.enabled true'));
  assert.ok(once.some((c) => c.startsWith('approvals set --gateway --stdin')));
  assert.match(calls.find((c) => c.args[0] === 'approvals' && c.args[1] === 'set').input, /"ask": "on-miss"/);
  assert.equal(once.filter((c) => c.startsWith('approvals allowlist add')).length, variant === 'mac' ? 4 : 3);
  fs.rmSync(ws, { recursive: true, force: true });
});

test('a failed setting is reported, not hidden', { skip: !variant }, async () => {
  const ws = freshWorkspace();
  const result = await installFalcon({ workspace: ws, runEngine: async () => ({ code: 1, out: 'nope' }), log: () => {} });
  assert.equal(result.ok, false);
  fs.rmSync(ws, { recursive: true, force: true });
});

test('a missing workspace is a clear error', async () => {
  await assert.rejects(installFalcon({ workspace: path.join(os.tmpdir(), 'no-such-falcon-ws'), log: () => {} }), /Workspace not found/);
});
