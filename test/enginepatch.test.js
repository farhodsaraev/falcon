// Personal patches to the engine's own files (self-repair plan, stage 6), on a tiny pretend engine:
// the real engine is never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findGit } from '../src/app/git.js';
import { COPY_DIR, PATCHES_DIR, changedInCopy, listPatches, makeEngineCopy, patchFromCopy, patchSize, patchState, removeEngineCopy, syncPatches } from '../src/app/enginepatch.js';

const git = findGit();
const skip = !git && 'no Git on this computer';
const GREETING = "export const greeting = () => 'Hello from the engine';\n";

function pretendEngine(root) {
  const engine = path.join(root, 'engine');
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(engine, file)), { recursive: true }); fs.writeFileSync(path.join(engine, file), text); };
  put('package.json', '{ "name": "openclaw", "version": "1.0.0" }\n');
  put('dist/index.js', "console.log('engine');\n");
  put('dist/greeting.js', GREETING);
  put('dist/old.js', 'export const old = 1;\n');
  put('node_modules/lib/index.js', 'module.exports = 42;\n');
  put('docs/readme.md', 'docs\n');
  return engine;
}

function setUp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-patch-'));
  const engine = pretendEngine(root);
  const workshop = path.join(root, 'workshop');
  fs.mkdirSync(path.join(workshop, '.git', 'info'), { recursive: true });
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.falcon'), { recursive: true });
  const app = path.join(root, 'app');
  fs.mkdirSync(path.join(app, PATCHES_DIR), { recursive: true });
  return { root, engine, workshop, home, app };
}

test('the engine copy shares the libraries, shows what the writer changed, and becomes a patch that fits the real engine', { skip }, async () => {
  const { root, engine, workshop, home } = setUp();
  const made = await makeEngineCopy({ engineDir: engine, dir: workshop });
  assert.equal(made.ok, true, made.error);
  const copy = path.join(workshop, COPY_DIR);
  assert.ok(fs.lstatSync(path.join(copy, 'node_modules')).isSymbolicLink() || fs.existsSync(path.join(copy, 'node_modules', 'lib')), 'libraries are linked');
  assert.ok(!fs.existsSync(path.join(copy, 'docs')), 'documents are not copied');
  assert.match(fs.readFileSync(path.join(workshop, '.git', 'info', 'exclude'), 'utf8'), /\.engine-copy/);
  assert.deepEqual(changedInCopy(workshop), []);

  fs.writeFileSync(path.join(copy, 'dist', 'greeting.js'), "export const greeting = () => 'Hello from Falcon\\'s engine';\n");
  fs.writeFileSync(path.join(copy, 'dist', 'new.js'), 'export const added = true;\n');
  fs.rmSync(path.join(copy, 'dist', 'old.js'));
  assert.deepEqual(changedInCopy(workshop), ['dist/greeting.js', 'dist/new.js', 'dist/old.js']);

  const patch = await patchFromCopy({ git, dir: workshop, home });
  assert.match(patch, /a\/dist\/greeting\.js/);
  assert.match(patch, /new file mode/);
  assert.match(patch, /deleted file mode/);
  assert.equal(patchSize(patch), 4);
  const file = path.join(root, 'p.patch');
  fs.writeFileSync(file, patch);
  assert.equal(await patchState({ git, engineDir: engine, file }), 'fits');
  assert.equal(fs.readFileSync(path.join(engine, 'dist', 'greeting.js'), 'utf8'), GREETING, 'the real engine is untouched');

  assert.equal(removeEngineCopy(workshop), true);
  assert.ok(!fs.existsSync(copy));
  assert.ok(fs.existsSync(path.join(engine, 'node_modules', 'lib', 'index.js')), 'the real libraries survive');
  fs.rmSync(root, { recursive: true, force: true });
});

test('patches are put in, put back after an engine update, taken out when removed, and one that no longer fits is off and told once', { skip }, async () => {
  const { root, engine, home, app } = setUp();
  const greetingFile = path.join(engine, 'dist', 'greeting.js');
  const patch = `diff --git a/dist/greeting.js b/dist/greeting.js
--- a/dist/greeting.js
+++ b/dist/greeting.js
@@ -1 +1 @@
-export const greeting = () => 'Hello from the engine';
+export const greeting = () => 'Hello from Falcon';
`;
  fs.writeFileSync(path.join(app, PATCHES_DIR, 'repair-one.patch'), patch);
  fs.writeFileSync(path.join(app, PATCHES_DIR, 'Bad Name.patch'), patch);
  assert.deepEqual(listPatches(app).map((p) => p.name), ['repair-one']);

  let r = await syncPatches({ git, appRoot: app, engineDir: engine, home, engineVersion: '1.0.0' });
  assert.equal(r.changed, true);
  assert.deepEqual(r.applied, ['repair-one']);
  assert.match(fs.readFileSync(greetingFile, 'utf8'), /Hello from Falcon/);

  r = await syncPatches({ git, appRoot: app, engineDir: engine, home, engineVersion: '1.0.0' });
  assert.equal(r.changed, false, 'already in place: nothing written');

  fs.writeFileSync(greetingFile, GREETING);            // an engine update replaced the file
  r = await syncPatches({ git, appRoot: app, engineDir: engine, home, engineVersion: '1.0.1' });
  assert.equal(r.changed, true);
  assert.match(fs.readFileSync(greetingFile, 'utf8'), /Hello from Falcon/, 'put back after the update');

  fs.rmSync(path.join(app, PATCHES_DIR, 'repair-one.patch'));   // the owner switched the change off
  r = await syncPatches({ git, appRoot: app, engineDir: engine, home, engineVersion: '1.0.1' });
  assert.equal(r.changed, true);
  assert.equal(fs.readFileSync(greetingFile, 'utf8'), GREETING, 'taken out again');

  fs.writeFileSync(path.join(app, PATCHES_DIR, 'repair-one.patch'), patch);
  fs.writeFileSync(greetingFile, "export const greeting = () => 'A new engine says hi';\n");   // a new engine changed the same line
  r = await syncPatches({ git, appRoot: app, engineDir: engine, home, engineVersion: '2.0.0' });
  assert.deepEqual(r.failed.map((f) => f.name), ['repair-one']);
  assert.deepEqual(r.newlyFailed, ['repair-one']);
  assert.equal(r.changed, false);
  r = await syncPatches({ git, appRoot: app, engineDir: engine, home, engineVersion: '2.0.0' });
  assert.deepEqual(r.newlyFailed, [], 'the owner is told only once for this engine version');
  fs.rmSync(root, { recursive: true, force: true });
});

test('with no patches, nothing is written', { skip }, async () => {
  const { root, engine, home, app } = setUp();
  const r = await syncPatches({ git, appRoot: app, engineDir: engine, home });
  assert.deepEqual(r, { changed: false, applied: [], failed: [], newlyFailed: [] });
  assert.ok(!fs.existsSync(path.join(home, '.falcon', 'engine-patches')));
  fs.rmSync(root, { recursive: true, force: true });
});
