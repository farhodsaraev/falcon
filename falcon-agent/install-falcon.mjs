#!/usr/bin/env node
// Turns a fresh agent workspace into Falcon, on Windows or macOS. Safe to run again:
// it replaces only the Falcon parts.
//
//   node install-falcon.mjs [--workspace <dir>] [--skip-settings]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const variant = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : null;
const FALCON_SKILLS = ['files', 'presentations', 'screen'];
const APPROVALS = '{ "version": 1, "defaults": { "security": "allowlist", "ask": "on-miss", "askFallback": "deny" } }';

const read = (file) => fs.readFileSync(file, 'utf8');

/** Default way to run an engine command when no runner is passed in. */
function defaultRunEngine(args, { input } = {}) {
  return new Promise((resolve) => {
    const win = process.platform === 'win32';
    // On Windows the command is a .cmd file, which needs the shell; quote anything with a space.
    const child = win
      ? spawn('openclaw', args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)), { shell: true, windowsHide: true })
      : spawn('openclaw', args);
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.on('error', (err) => resolve({ code: -1, out: err.message }));
    child.on('close', (code) => resolve({ code: code ?? -1, out }));
    child.stdin.end(input ?? '');
  });
}

/**
 * @param {object} options
 * @param {string} [options.workspace]     agent workspace folder
 * @param {boolean} [options.skipSettings] copy files only
 * @param {Function} [options.runEngine]   (args, {input}) => Promise<{code, out}>
 * @param {Function} [options.log]
 */
export async function installFalcon({
  workspace = path.join(os.homedir(), '.openclaw', 'workspace'),
  skipSettings = false,
  runEngine = defaultRunEngine,
  log = console.log,
} = {}) {
  if (!fs.existsSync(workspace)) throw new Error(`Workspace not found at ${workspace}. Set up the engine first.`);
  const skillsDir = path.join(workspace, 'skills');
  const fill = (text, skillDir = '') => text
    .replaceAll('{{SKILLS}}', skillsDir)
    .replaceAll('{{NODE}}', process.execPath)
    .replaceAll('{{SKILL_DIR}}', skillDir)
    .replaceAll('<folder of this SKILL.md>', skillDir);

  // Personality and identity
  fs.copyFileSync(path.join(here, 'SOUL.md'), path.join(workspace, 'SOUL.md'));
  fs.copyFileSync(path.join(here, 'IDENTITY.md'), path.join(workspace, 'IDENTITY.md'));

  // Working rules: keep the engine's own AGENTS.md, add (or refresh) the Falcon section at the end
  const agentsPath = path.join(workspace, 'AGENTS.md');
  const existing = fs.existsSync(agentsPath) ? read(agentsPath) : '# AGENTS.md\n';
  const withoutOld = existing.replace(/\r?\n*<!-- (jarvis|falcon):start -->[\s\S]*?<!-- (jarvis|falcon):end -->\r?\n*/g, '\n');
  const fastPaths = variant ? read(path.join(here, `fastpaths.${variant}.md`)).trim() : '';
  const section = fill(read(path.join(here, 'AGENTS.falcon.md')).replace('{{FAST_PATHS}}', fastPaths));
  fs.writeFileSync(agentsPath, `${withoutOld.trimEnd()}\n\n${section.trim()}\n`);

  // Falcon already knows who he is, so skip the engine's first-run "who am I?" interview
  fs.rmSync(path.join(workspace, 'BOOTSTRAP.md'), { force: true });

  // Skills for this kind of computer
  const scripts = [];
  fs.mkdirSync(skillsDir, { recursive: true });
  for (const name of FALCON_SKILLS) {
    const target = path.join(skillsDir, name);
    fs.rmSync(target, { recursive: true, force: true });
    const source = variant && path.join(here, `skills-${variant}`, name);
    if (!source || !fs.existsSync(source)) continue;
    fs.cpSync(source, target, { recursive: true });
    for (const file of fs.readdirSync(target)) {
      const full = path.join(target, file);
      if (file === 'SKILL.md') fs.writeFileSync(full, fill(read(full), target));
      else if (/\.(ps1|mjs)$/.test(file)) scripts.push(full);
    }
  }
  log(`Falcon is installed in ${workspace}`);
  if (skipSettings) return { ok: true, settings: [] };

  // Settings (need the engine running)
  const results = [];
  const step = async (what, args, input) => {
    const { code, out } = await runEngine(args, { input });
    results.push({ what, ok: code === 0 });
    log(code === 0 ? `  ok    ${what}` : `  FAILED ${what}: ${out.trim().split('\n')[0]}`);
  };
  log('Applying settings...');
  await step('fast replies', ['config', 'set', 'agents.defaults.thinkingDefault', 'off']);
  await step('no background check-ins', ['config', 'set', 'agents.defaults.heartbeat.every', '0m']);
  await step('local chat for the Falcon window', ['config', 'set', 'gateway.http.endpoints.chatCompletions.enabled', 'true']);
  await step('ask-first approvals', ['approvals', 'set', '--gateway', '--stdin'], APPROVALS);
  for (const script of scripts) {
    await step(`pre-approve ${path.basename(script)}`, ['approvals', 'allowlist', 'add', script, '--gateway']);
  }
  await step('name', ['agents', 'set-identity', '--workspace', workspace, '--name', 'Falcon']);
  return { ok: results.every((r) => r.ok), settings: results };
}

// Run directly from a terminal
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--workspace');
  installFalcon({
    workspace: at >= 0 ? argv[at + 1] : undefined,
    skipSettings: argv.includes('--skip-settings'),
  }).then((r) => process.exit(r.ok ? 0 : 1)).catch((err) => { console.error(err.message); process.exit(1); });
}
