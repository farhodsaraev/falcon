import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { verifyToolResult } from './verification.js';

const nameFor = session => `${crypto.createHash('sha256').update(session).digest('hex')}.json`;
const managed = session => /^agent:main:falcon-window-[a-f0-9]{8}-[a-f0-9-]{36}$/.test(session || '');

export function registerTaskHooks(api, { dir = path.join(os.homedir(), '.falcon', 'task-bridge'), fetcher = fetch } = {}) {
  const runs = new Map();
  const calls = new Map();
  const read = session => { try { return JSON.parse(fs.readFileSync(path.join(dir, nameFor(session)), 'utf8')); } catch { return null; } };
  const heartbeat = () => {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(dir, 'health.json'), JSON.stringify({ version: 1, pid: process.pid, at: Date.now() }), { mode: 0o600 });
    } catch {}
  };
  let timer;
  api.on('gateway_start', () => { heartbeat(); clearInterval(timer); timer = setInterval(heartbeat, 10000); timer.unref?.(); });
  api.on('gateway_stop', () => { clearInterval(timer); try { fs.unlinkSync(path.join(dir, 'health.json')); } catch {} });

  function context(event, ctx, bind = false) {
    if (!managed(ctx?.sessionKey)) return null;
    const record = read(ctx.sessionKey);
    const run = ctx.runId || event.runId;
    if (!record || !run || record.version !== 1 || record.sessionKey !== ctx.sessionKey || record.expiresAt < Date.now()) return { blocked: true };
    if (bind && !runs.has(run)) {
      if (runs.size >= 256) return { blocked: true }; // no eviction of a still-running identity
      runs.set(run, record.taskId);
    }
    if (runs.get(run) !== record.taskId || record.state !== 'running') return { blocked: true };
    if (!Number.isInteger(record.port) || record.port < 1 || record.port > 65535 || !/^[a-f0-9]{64}$/.test(record.secret)) return { blocked: true };
    return record;
  }
  async function publish(record, event) {
    const r = await fetcher(`http://127.0.0.1:${record.port}/api/task-event`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Falcon-Task-Token': record.secret },
      body: JSON.stringify({ taskId: record.taskId, ...event }), signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) throw new Error('Task bridge unavailable');
    return r.json();
  }
  const key = (event, ctx) => `${ctx.runId || event.runId}:${ctx.toolCallId || event.toolCallId || `${event.toolName}:${JSON.stringify(event.params)}`}`;
  api.on('before_tool_call', async (event, ctx) => {
    const record = context(event, ctx, true);
    if (!record) return;
    if (record.blocked) return { block: true, blockReason: 'This Falcon task is stopped or its execution tracking is unavailable. Start a new request in Falcon.' };
    const callId = ctx.toolCallId || event.toolCallId || crypto.randomUUID();
    try {
      const result = await publish(record, { phase: 'before', callId, label: ({ exec: 'Running a computer action', browser: 'Working in the browser', read: 'Reading a file', write: 'Saving a file', memory_search: 'Searching memory', web_search: 'Searching the web' })[event.toolName] || 'Running an action' });
      if (!result.allowed) throw new Error('Stopped');
      const k = key(event, ctx);
      const queue = calls.get(k) || []; queue.push(callId); calls.set(k, queue);
    } catch { return { block: true, blockReason: 'Falcon could not confirm that this task is still allowed to run.' }; }
  });
  api.on('after_tool_call', async (event, ctx) => {
    const k = key(event, ctx);
    const queue = calls.get(k) || [];
    const callId = queue.shift(); if (!queue.length) calls.delete(k);
    const record = context(event, ctx);
    if (!record || record.blocked || !callId) return;
    heartbeat();
    const outcome = await verifyToolResult(event, record.startedAt);
    try { await publish(record, { phase: 'after', callId, ...outcome }); } catch { /* never report an unacknowledged result as verified */ }
  });
  api.on('agent_end', async (_event, ctx) => {
    const record = read(ctx?.sessionKey || '');
    if (!managed(ctx?.sessionKey) || !record || record.expiresAt < Date.now()) return;
    try { await publish(record, { phase: 'settled', runId: ctx.runId }); } catch {}
    if (ctx.runId) runs.delete(ctx.runId);
  });
}
