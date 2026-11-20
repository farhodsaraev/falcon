// Falcon's watchdog for switching to a new version of himself (self-repair plan, stage 2).
// It is copied out of Falcon's folder before the switch and depends on nothing in it, so a broken new
// version cannot break it. It waits for the old Falcon to close, starts the new one, and waits for him
// to answer. If he does not answer in time, it puts the last working version back with Git, starts that,
// and writes what happened, so Falcon can tell the user.
//   node watchdog.mjs <job.json>
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const WINDOWS = process.platform === 'win32';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const write = (result) => { try { fs.writeFileSync(job.resultFile, JSON.stringify({ ...result, at: new Date().toISOString() }, null, 2)); } catch { /* nothing more to do */ } };

function git(args) {
  return new Promise((resolve) => execFile(job.git, ['--git-dir', job.gitDir, '--work-tree', job.appRoot, ...args],
    { cwd: job.appRoot, windowsHide: true, timeout: 120000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } },
    (err, stdout, stderr) => resolve({ code: err ? 1 : 0, out: `${stdout}${stderr}` })));
}

function start() {
  const since = Date.now();
  const child = spawn(job.node, job.start, { cwd: job.appRoot, detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ...job.startEnv } });
  child.on('error', () => {});
  child.unref();
  return { child, since };
}

// He answers when he has written his address (after the given moment) and his page loads from it.
async function answers(since, waitMs) {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    try {
      if (fs.statSync(job.windowFile).mtimeMs >= since - 1000) {
        const { port } = JSON.parse(fs.readFileSync(job.windowFile, 'utf8'));
        const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) });
        if (response.ok && (await response.text()).includes('F A L C O N')) return true;
      }
    } catch { /* not yet */ }
    await sleep(1000);
  }
  return false;
}

function stop(child) {
  if (!child?.pid) return Promise.resolve();
  return new Promise((resolve) => {
    if (WINDOWS) execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } } resolve(); }
  });
}

// 1. Let the old Falcon close.
for (let i = 0; i < 60 && job.oldPid && alive(job.oldPid); i++) await sleep(500);

// 2. Start the new one and wait for him.
const fresh = start();
if (await answers(fresh.since, job.waitMs)) {
  write({ ok: true, commit: job.commit, pid: fresh.child.pid });
  process.exit(0);
}

// 3. He did not answer: put the last working version back and start that.
await stop(fresh.child);
await git(['update-ref', 'refs/heads/personal', job.lastGood]);
const back = await git(['reset', '--quiet', '--hard', 'personal']);
const again = start();
const backUp = back.code === 0 && await answers(again.since, job.waitMs);
write({ ok: false, rolledBack: back.code === 0, backUp, pid: again.child.pid, commit: job.commit, lastGood: job.lastGood, detail: back.code === 0 ? '' : back.out.trim().slice(0, 500) });
process.exit(0);
