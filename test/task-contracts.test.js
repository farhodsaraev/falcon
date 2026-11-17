import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { startServer } from '../src/app/server.js';
import { TaskCentre, controlName } from '../src/app/tasks.js';
import { registerTaskHooks } from '../falcon-agent/engine-addon/task-hooks.js';
import { verifyToolResult } from '../falcon-agent/engine-addon/verification.js';
import { syncTaskAddon } from '../src/app/addon.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) { for (let i = 0; i < 120; i++) { const r = await check(); if (r) return r; await pause(25); } throw new Error(message); }
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-contract-'));

async function fixture({ abortAck = true, pendingApprovals = false } = {}) {
  const dir = temp();
  const hooks = {};
  const bridge = path.join(dir, 'task-bridge');
  const commands = [], requests = [], runtime = new Map();
  let completedSideEffects = 0;
  const disconnected = new Set();
  registerTaskHooks({ on: (name, handler) => { hooks[name] = handler; } }, { dir: bridge });
  const gateway = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body); requests.push(payload);
    const text = payload.messages.at(-1).content;
    const sessionKey = req.headers['x-openclaw-session-key'];
    const ctx = { sessionKey, runId: sessionKey, toolCallId: 'call-1' };
    const control = new AbortController(); runtime.set(sessionKey, control);
    res.on('close', () => { disconnected.add(sessionKey); if (pendingApprovals) control.abort(); });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': start\n\n');
    const delta = content => { if (!res.destroyed) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`); };
    try {
      if (text.startsWith('long')) {
        // A stand-in for a cancellable runtime tool, with a visible side effect if allowed to continue.
        await new Promise(resolve => { const timer = setTimeout(() => { completedSideEffects++; resolve(); }, pendingApprovals ? 10000 : 600); control.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); });
        if (control.signal.aborted) return;
      }
      if (text.startsWith('write')) {
        const file = path.join(dir, 'result.txt');
        const event = { toolName: 'write', params: { path: file, content: 'expected contents' }, toolCallId: ctx.toolCallId };
        const denied = await hooks.before_tool_call(event, ctx);
        if (!denied?.block) {
          fs.writeFileSync(file, text.startsWith('write wrong') ? 'wrong contents' : 'expected contents');
          const complete = () => hooks.after_tool_call({ ...event, params: { ...event.params, normalized: true }, result: { content: [{ type: 'text', text: 'Success' }] } }, ctx);
          if (text.startsWith('write delayed')) void pause(120).then(complete); else await complete();
        }
      }
      delta('Done.\n[[did]] Opened every app | Everything succeeded');
      if (!text.startsWith('truncated')) res.write('data: [DONE]\n\n');
    } finally { runtime.delete(sessionKey); if (pendingApprovals) await hooks.agent_end({}, ctx); res.end(); }
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const server = await startServer({ engine: {
    findEngine: () => ({ command: 'node', prefix: [] }),
    engineReady: async () => true,
    readGateway: () => ({ port: gateway.address().port, token: 'fixture-only' }),
    workspaceDir: () => path.join(dir, 'workspace'),
    profileFile: () => path.join(dir, 'profile.json'),
    configFile: () => path.join(dir, 'openclaw.json'),
    envFile: () => path.join(dir, 'engine.env'),
    desktopReadiness: async () => false,
    installTaskAddon: () => syncTaskAddon(path.join(dir, 'workspace')),
    voiceKey: { get: async () => null },
    runEngine: async args => {
      commands.push(args);
      if (args[0] === 'approvals' && args[1] === 'pending') {
        const sessionKey = [...runtime.keys()][0];
        return { code: 0, out: JSON.stringify({ approvals: pendingApprovals && sessionKey ? [{ id: 'approval-owned-1', sessionKey }, { id: 'approval-owned-2', sessionKey }, { id: 'approval-foreign', sessionKey: 'agent:main:telegram:other' }] : [] }) };
      }
      if (args[0] === 'approvals' && args[1] === 'resolve' && disconnected.size) return { code: 1, out: 'Approval already cancelled' };
      if (args[0] === 'gateway' && args[1] === 'call') {
        const session = JSON.parse(args[args.indexOf('--params') + 1]).sessionKey;
        if (abortAck) runtime.get(session)?.abort();
        return { code: 0, out: JSON.stringify({ ok: true, aborted: abortAck, runIds: abortAck ? [session] : [] }) };
      }
      if (args[0] === 'skills') return { code: 0, out: JSON.stringify({ skills: [{ name: 'files', eligible: true }, { name: 'presentations', eligible: false, missing: { bins: ['PowerPoint'] } }] }) };
      if (args[0] === 'models') return { code: 0, out: 'fixture/model' };
      return { code: 0, out: '{}' };
    },
  } });
  const base = `http://127.0.0.1:${server.port}`;
  const call = (method, route, body, headers = {}) => fetch(base + route, { method, headers: { 'Content-Type': 'application/json', 'X-Falcon-Token': server.token, ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { dir, bridge, hooks, commands, requests, call, server, base, runtime, sideEffects: () => completedSideEffects,
    close: async () => { await server.close(); gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)); } };
}

test('model prose cannot generate verified action cards; real readback can', async () => {
  const f = await fixture();
  try {
    let response = await (await f.call('POST', '/api/chat', { text: 'hello' })).text();
    assert.doesNotMatch(response, /event: actions/);
    assert.doesNotMatch(response, /Opened every app/);
    response = await (await f.call('POST', '/api/chat', { text: 'write correct' })).text();
    assert.match(response, /event: actions/);
    let tasks = (await (await f.call('GET', '/api/tasks')).json()).items;
    assert.equal(tasks[0].actions[0].status, 'verified');
    response = await (await f.call('POST', '/api/chat', { text: 'write wrong' })).text();
    assert.doesNotMatch(response, /event: actions/);
    tasks = (await (await f.call('GET', '/api/tasks')).json()).items;
    assert.equal(tasks[0].actions[0].status, 'failed');
    assert.match(tasks[0].stage, /errors/);
    assert.equal(f.requests[1].messages[0].content, 'hello', 'follow-up context survives task-unique sessions');
    assert.notEqual(tasks[0].id, tasks[1].id);
    assert.doesNotMatch(JSON.stringify(tasks), /secret|fixture-only|expected contents/);
  } finally { await f.close(); }
});

test('an incomplete upstream stream is failed, not completed', async () => {
  const f = await fixture();
  try {
    const response = await (await f.call('POST', '/api/chat', { text: 'truncated' })).text();
    assert.match(response, /event: error/);
    assert.equal((await (await f.call('GET', '/api/tasks')).json()).items[0].state, 'failed');
  } finally { await f.close(); }
});

test('Stop aborts the dedicated runtime, fences later tools, and does not cancel other channels', async () => {
  const f = await fixture();
  try {
    const stream = await f.call('POST', '/api/chat', { text: 'long task' });
    const task = (await (await f.call('GET', '/api/tasks')).json()).items[0];
    assert.equal((await f.call('POST', '/api/chat', { text: 'overlap' })).status, 409);
    const result = await (await f.call('POST', '/api/tasks/cancel', { id: task.id })).json();
    assert.equal(result.ok, true); assert.equal(result.task.state, 'cancelled');
    const abort = f.commands.find(c => c[2] === 'chat.abort');
    const sessionKey = JSON.parse(abort[abort.indexOf('--params') + 1]).sessionKey;
    assert.match(sessionKey, new RegExp(task.id));
    assert.equal((await f.hooks.before_tool_call({ toolName: 'exec', params: {} }, { sessionKey, runId: sessionKey })).block, true);
    assert.equal(await f.hooks.before_tool_call({ toolName: 'exec', params: {} }, { sessionKey: 'agent:main:telegram:other', runId: 'elsewhere' }), undefined);
    assert.match(await stream.text(), /event: cancelled/);
    await pause(650); assert.equal(f.sideEffects(), 0, 'the runtime side effect never happens');
    // A successor has an independent session; a stale FIRST tool still sees the old cancellation fence.
    await (await f.call('POST', '/api/chat', { text: 'hello next' })).text();
    assert.equal((await f.hooks.before_tool_call({ toolName: 'exec', params: {} }, { sessionKey, runId: 'old-first-tool' })).block, true);
    const stored = JSON.parse(fs.readFileSync(path.join(f.bridge, 'history.json'), 'utf8'));
    assert.doesNotMatch(JSON.stringify(stored), /secret|controller|sessionKey/);
  } finally { await f.close(); }
});

test('an RPC with no matching run does not falsely confirm Stop', async () => {
  const f = await fixture({ abortAck: false });
  try {
    const stream = await f.call('POST', '/api/chat', { text: 'long unknown' });
    const task = (await (await f.call('GET', '/api/tasks')).json()).items[0];
    const result = await (await f.call('POST', '/api/tasks/cancel', { id: task.id })).json();
    assert.equal(result.ok, false); assert.equal(result.task.state, 'cancel_failed');
    assert.equal((await f.call('POST', '/api/chat', { text: 'new task' })).status, 409);
    await stream.text();
  } finally { await f.close(); }
});

test('all pending approvals are retained; stopped approvals cannot be re-allowed', () => {
  const dir = temp(); const centre = new TaskCentre({ dir, port: () => 1 });
  const t = centre.start('test', 'agent:main:falcon-window-12345678');
  centre.waiting(t, 'approval-1'); centre.waiting(t, 'approval-2');
  assert.equal(t.approvals.size, 2);
  centre.resolved(t, 'approval-1'); assert.equal(t.state, 'waiting');
  centre.requestCancel(t);
  assert.equal(centre.event(t, { phase: 'before', callId: 'late', label: 'Should not run' }).allowed, false);
  const restored = new TaskCentre({ dir, port: () => 1 });
  assert.equal(restored.list()[0].state, 'interrupted');
  assert.equal(restored.authorize(t.id, t.secret), null);
});

test('readiness shows missing and unknown states; new endpoints reject wrong identity/origin', async () => {
  const f = await fixture();
  try {
    const result = await (await f.call('GET', '/api/readiness')).json();
    assert.equal(result.items.find(i => i.id === 'presentation-app').status, 'blocked');
    assert.equal(result.items.find(i => i.id === 'screen-permission').status, 'unknown');
    assert.equal(result.items.find(i => i.id === 'skill-presentations').status, 'blocked');
    assert.doesNotMatch(JSON.stringify(result), /fixture-only|sk-/);
    for (const route of ['/api/tasks', '/api/readiness']) {
      assert.equal((await f.call('GET', route, null, { 'X-Falcon-Token': 'wrong' })).status, 401);
      assert.equal((await f.call('GET', route, null, { Origin: 'https://foreign.example' })).status, 403);
    }
    assert.equal((await f.call('POST', '/api/task-event', { taskId: 'fake', phase: 'after', status: 'verified' })).status, 401);
    assert.equal((await f.call('POST', '/api/tasks/cancel', { id: 'fake' }, { Origin: 'https://foreign.example' })).status, 403);
    assert.equal((await f.call('POST', '/api/tasks/cancel', { id: 'fake' })).status, 200);
  } finally { await f.close(); }
});

test('repair updates an existing configured installation and requests an assistant reload', async () => {
  const f = await fixture();
  try {
    const addon = path.join(f.dir, 'falcon-words'); fs.mkdirSync(addon); fs.writeFileSync(path.join(addon, 'index.js'), '// old');
    const r = await (await f.call('POST', '/api/readiness/repair-tracking', {})).json();
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(path.join(addon, 'task-hooks.js')));
    assert.ok(fs.existsSync(path.join(addon, 'inspect-slide.js')));
    assert.ok(f.commands.some(c => c[0] === 'gateway' && c[1] === 'restart'));
  } finally { await f.close(); }
});

test('slide verification uses independent app state, never a forged stdout flag', async () => {
  const file = path.join(temp(), 'deck.pptx');
  const event = { toolName: 'exec', params: { command: 'echo slides.ps1' }, result: { stdout: JSON.stringify({ ok: true, verified: true, path: file, slide: 5, total: 10 }) } };
  assert.equal((await verifyToolResult(event, 0, { readSlide: async () => null })).status, 'unverified');
  assert.equal((await verifyToolResult(event, 0, { readSlide: async () => ({ path: file, slide: 4, total: 10 }) })).status, 'failed');
  assert.equal((await verifyToolResult(event, 0, { readSlide: async () => ({ path: file, slide: 5, total: 10 }) })).status, 'verified');
});

test('document outcome verifies the actual generated file and detects disappearance', async () => {
  const dir = temp(); const spec = path.join(dir, 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ type: 'docx', title: 'Result', paragraphs: ['Readback'] }));
  const child = spawnSync(process.execPath, ['falcon-agent/skills-common/documents/make-document.mjs', '--spec', spec, '--dir', dir], { encoding: 'utf8', env: { ...process.env, FALCON_DOCS_DIR: dir } });
  assert.equal(child.status, 0);
  const result = JSON.parse(child.stdout);
  const event = { toolName: 'exec', params: { command: 'node make-document.mjs --spec spec.json' }, result: { stdout: child.stdout } };
  assert.equal((await verifyToolResult(event)).status, 'verified');
  fs.unlinkSync(result.path);
  assert.equal((await verifyToolResult(event)).status, 'failed');
  assert.equal((await verifyToolResult({ toolName: 'exec', result: { details: { exitCode: 1 } } })).status, 'failed');
});

 test('fire-and-forget tool completion is drained before the reply task closes', async () => {
  const f = await fixture();
  try {
    const response = await (await f.call('POST', '/api/chat', { text: 'write delayed' })).text();
    assert.match(response, /event: actions/);
    const task = (await (await f.call('GET', '/api/tasks')).json()).items[0];
    assert.equal(task.actions[0].status, 'verified');
    assert.equal(task.state, 'completed');
  } finally { await f.close(); }
});

test('Stop reconciles approvals auto-cancelled by HTTP abort and never denies another session', async () => {
  const f = await fixture({ abortAck: false, pendingApprovals: true });
  try {
    const stream = await f.call('POST', '/api/chat', { text: 'long approval' });
    const task = await until(async () => { const t = (await (await f.call('GET', '/api/tasks')).json()).items[0]; return t?.state === 'waiting' && t; }, 'approval never appeared');
    const result = await (await f.call('POST', '/api/tasks/cancel', { id: task.id })).json();
    assert.equal(result.ok, true, 'agent_end proves settled even when approval deny sees an expired record');
    const denies = f.commands.filter(c => c[0] === 'approvals' && c[1] === 'resolve');
    assert.deepEqual(denies.map(c => c[2]).sort(), ['approval-owned-1', 'approval-owned-2']);
    assert.equal((await (await f.call('POST', '/api/approval', { id: 'approval-owned-1', decision: 'allow-once' })).json()).ok, false);
    await stream.text();
  } finally { await f.close(); }
});
