import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const bridgeVersion = 1;
export const controlName = (session) => `${crypto.createHash('sha256').update(session).digest('hex')}.json`;
export function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temp, file); }
  finally { try { fs.unlinkSync(temp); } catch {} }
}

// Only runtime events may add actions. Model prose is never evidence.
export class TaskCentre {
  constructor({ dir, port, emit = () => {} }) {
    this.dir = dir; this.port = port; this.emit = emit; this.tasks = new Map();
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8'));
      for (const task of saved.slice(-50)) {
        if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(task.state)) task.state = 'interrupted';
        this.tasks.set(task.id, { ...task, restored: true });
      }
    } catch {}
  }
  snapshot(t) { return { id: t.id, title: t.title, state: t.state, stage: t.stage, startedAt: t.startedAt, updatedAt: t.updatedAt, actions: t.actions, error: t.error || '', restored: !!t.restored, revision: t.revision || 0 }; }
  list() { return [...this.tasks.values()].slice(-50).map(t => this.snapshot(t)).reverse(); }
  save(t) {
    t.updatedAt = Date.now(); t.revision = (t.revision || 0) + 1;
    atomicJson(path.join(this.dir, 'history.json'), [...this.tasks.values()].slice(-50).map(t => this.snapshot(t)));
    this.emit(this.snapshot(t));
  }
  active() { return [...this.tasks.values()].find(t => !t.restored && ['running', 'waiting', 'cancelling', 'cancel_failed'].includes(t.state)); }
  control(t, state) {
    atomicJson(path.join(this.dir, controlName(t.sessionKey)), { version: bridgeVersion, taskId: t.id, sessionKey: t.sessionKey, port: this.port(), secret: t.secret, state, startedAt: t.startedAt, expiresAt: Date.now() + 24 * 3600000 });
  }
  start(text, sessionKey) {
    if (this.active()) return null;
    const id = crypto.randomUUID();
    const t = { id, title: text.replace(/[\r\n]+/g, ' ').slice(0, 160), conversationKey: sessionKey, text, sessionKey: `${sessionKey}-${id}`, secret: crypto.randomBytes(32).toString('hex'), state: 'running', stage: 'Thinking', startedAt: Date.now(), actions: [], controller: new AbortController(), approvals: new Set(), calls: new Map() };
    this.tasks.set(t.id, t);
    // Retain a bounded history without ever evicting a live task.
    while (this.tasks.size > 50) this.tasks.delete(this.tasks.keys().next().value);
    this.control(t, 'running'); this.save(t); return t;
  }
  authorize(id, secret) {
    const t = this.tasks.get(id);
    return t && !t.restored && typeof secret === 'string' && /^[a-f0-9]{64}$/.test(secret) && crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(t.secret)) ? t : null;
  }
  event(t, event) {
    if (event.phase === 'settled') { t.runtimeSettled = true; t.notifySettled?.(); return { allowed: false }; }
    if (!['running', 'waiting'].includes(t.state)) return { allowed: false };
    const callId = String(event.callId || '').slice(0, 160);
    if (!callId || !['before', 'after'].includes(event.phase)) return { allowed: false };
    if (event.phase === 'before') {
      if (!t.calls.has(callId)) t.calls.set(callId, { label: String(event.label || 'Using a tool').slice(0, 120) });
      t.stage = t.approvals.size ? 'Waiting for your permission' : String(event.label || 'Working').slice(0, 120); t.state = t.approvals.size ? 'waiting' : 'running';
    } else {
      const call = t.calls.get(callId);
      if (!call || call.done) return { allowed: false };
      call.done = true;
      const status = ['verified', 'failed', 'unverified'].includes(event.status) ? event.status : 'unverified';
      t.actions.push({ id: callId, label: String(event.label || call.label).slice(0, 120), status, detail: String(event.detail || '').slice(0, 240) });
      t.actions = t.actions.slice(-40);
      t.stage = status === 'failed' ? 'An action failed' : 'Working';
      t.outcomeChanged?.();
    }
    this.save(t); return { allowed: true };
  }
  waiting(t, id) { if (!t || !['running', 'waiting'].includes(t.state)) return; t.approvals.add(id); t.state = 'waiting'; t.stage = 'Waiting for your permission'; this.save(t); }
  resolved(t, id) { if (!t) return; t.approvals.delete(id); if (t.state === 'waiting' && !t.approvals.size) { t.state = 'running'; t.stage = 'Working'; this.save(t); } }
  async drain(t, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (!t.controller.signal.aborted && [...t.calls.values()].some(call => !call.done)) {
      t.stage = 'Checking action results'; this.save(t);
      const left = deadline - Date.now();
      if (left <= 0) break;
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); t.controller.signal.removeEventListener('abort', done); t.outcomeChanged = null; resolve(); };
        const timer = setTimeout(done, left);
        t.outcomeChanged = done;
        t.controller.signal.addEventListener('abort', done, { once: true });
      });
    }
    if (t.controller.signal.aborted) return;
    for (const [id, call] of t.calls) if (!call.done) {
      call.done = true;
      t.actions.push({ id, label: call.label, status: 'unverified', detail: 'Verification did not finish in time.' });
    }
  }
  finish(t, error = '') {
    if (['cancelling', 'cancel_failed', 'cancelled'].includes(t.state)) return;
    t.state = error ? 'failed' : 'completed';
    t.stage = error ? 'Could not finish' : t.actions.some(a => a.status === 'failed') ? 'Reply finished with action errors' : 'Reply finished';
    t.error = error; this.control(t, 'closed'); this.save(t);
  }
  requestCancel(t) {
    if (!['running', 'waiting', 'cancel_failed'].includes(t.state)) return false;
    t.state = 'cancelling'; t.stage = 'Stopping execution';
    // Persist the fence BEFORE aborting transport. The runtime checks it before every tool.
    this.control(t, 'cancelled'); this.save(t); t.controller.abort(); return true;
  }
  cancelled(t, ok) {
    t.state = ok ? 'cancelled' : 'cancel_failed';
    t.stage = ok ? 'Stopped; completed actions are kept' : 'Stop not confirmed; retry Stop';
    t.error = ok ? '' : 'Further tool calls are blocked, but the running action could not be confirmed stopped.';
    this.save(t);
  }
}
