// Used by the automatic install test on a clean Windows PC (self-repair plan, stage 2):
//   node ci-workshop.mjs <installed app folder>
// 1. Git: with the computer's own Git ignored, Falcon installs the portable copy and checks its checksum.
// 2. A workshop with a harmless change: its tests pass, it starts, it is switched in and kept.
// 3. A workshop with a change that breaks the start: its tests and start check fail; switched in anyway,
//    the watchdog puts the last working version back and starts it again.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const appRoot = path.resolve(process.argv[2]);
const load = (file) => import(pathToFileURL(path.join(appRoot, 'src', 'app', file)).href);
const { ensureGit, falconGitDir, MARKER } = await load('git.js');
const { checkWorkshopStarts, createWorkshop, openHistory, saveWorkshop, switchToWorkshop, testWorkshop } = await load('workshop.js');
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${detail}`); if (!ok) failed = true; };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stopPid = (pid) => { if (pid) { try { execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } } };
async function waitResult(file, ms) {
  for (const until = Date.now() + ms; Date.now() < until; await sleep(2000)) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* not yet */ }
  }
  return null;
}

// 1. Git
// CI_KEEP_SYSTEM_GIT=1 (a trial run on a developer's PC): use the computer's Git and download nothing.
const keep = process.env.CI_KEEP_SYSTEM_GIT === '1';
const got = await ensureGit({ env: keep ? process.env : { ...process.env, FALCON_PRETEND_NO_GIT: '1' }, onLine: (line) => console.log(`     ${line}`) });
check(keep ? 'Git found' : 'portable Git installed and checked', got.ok && (keep || got.installed), got.error || got.version || '');
if (!got.ok) process.exit(1);
if (!keep) check('marked as Falcon\'s own', fs.existsSync(path.join(falconGitDir(), MARKER)));
const git = got.git;

const history = openHistory({ git, appRoot });
check('local history made', await history.init('ci'));
check('no connection to anywhere', (await history.run(['remote'])).out.trim() === '');
const windowFile = path.join(os.homedir(), '.falcon', 'window.json');
const startEnv = { FALCON_NO_WINDOW: '1' };

// 2. A harmless change
const good = await createWorkshop({ history, id: 'ci-good' });
fs.appendFileSync(path.join(good.dir, 'ui', 'style.css'), '\n/* a harmless change made in the workshop */\n');
await saveWorkshop({ git, dir: good.dir, message: 'A harmless change' });
const goodTests = await testWorkshop({ dir: good.dir });
check('good change: tests pass in the workshop', goodTests.ok, `${goodTests.pass}/${goodTests.tests} ${goodTests.failing.join('; ')}`);
check('good change: the workshop copy starts', (await checkWorkshopStarts({ dir: good.dir })).ok);
let started = Date.now();
const switched = await switchToWorkshop({ history, id: 'ci-good', windowFile, startEnv, waitMs: 60000 });
check('good change: switched in', switched.ok, switched.error || '');
const kept = await waitResult(switched.resultFile, 180000);
check('good change: the new Falcon answers and is kept', kept?.ok === true, `${Math.round((Date.now() - started) / 1000)} s ${JSON.stringify(kept)}`);
check('good change: it is in his files', fs.readFileSync(path.join(appRoot, 'ui', 'style.css'), 'utf8').includes('a harmless change made in the workshop'));
stopPid(kept?.pid);
await sleep(3000);

// 3. A change that breaks the start
const working = fs.readFileSync(path.join(appRoot, 'src', 'app', 'server.js'), 'utf8');
const bad = await createWorkshop({ history, id: 'ci-broken' });
fs.writeFileSync(path.join(bad.dir, 'src', 'app', 'server.js'), 'this is not JavaScript(\n');
await saveWorkshop({ git, dir: bad.dir, message: 'A change that breaks the start' });
const badTests = await testWorkshop({ dir: bad.dir });
check('broken change: tests fail in the workshop', !badTests.ok, `${badTests.fail} failing`);
check('broken change: the workshop copy does not start', !(await checkWorkshopStarts({ dir: bad.dir })).ok);
started = Date.now();
const forced = await switchToWorkshop({ history, id: 'ci-broken', windowFile, startEnv, waitMs: 60000 });
check('broken change: switched in for the test', forced.ok, forced.error || '');
const back = await waitResult(forced.resultFile, 240000);
const took = Math.round((Date.now() - started) / 1000);
check('broken change: the last working version is put back', back?.rolledBack === true, `${took} s ${JSON.stringify(back)}`);
check('broken change: the last working version starts again', back?.backUp === true);
check('broken change: his working files are back', fs.readFileSync(path.join(appRoot, 'src', 'app', 'server.js'), 'utf8') === working);
stopPid(back?.pid);

process.exit(failed ? 1 : 0);
