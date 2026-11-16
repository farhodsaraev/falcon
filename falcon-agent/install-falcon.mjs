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
const FALCON_SKILLS = ['files', 'presentations', 'screen', 'daily'];
const APPROVALS = '{ "version": 1, "defaults": { "security": "allowlist", "ask": "on-miss", "askFallback": "deny" } }';

const read = (file) => fs.readFileSync(file, 'utf8');

// The Node.js path written into Falcon's commands must survive updates. A package manager's real
// path carries the version number (".../node@24/24.22.3/bin/node"), so prefer the stable link to it.
function stableNode() {
  if (process.platform === 'win32') return process.execPath;
  const real = fs.realpathSync(process.execPath);
  const dirs = ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.openclaw', 'bin'),
    path.join(os.homedir(), '.local', 'bin'), ...(process.env.PATH || '').split(':')];
  for (const dir of dirs) {
    const link = path.join(dir, 'node');
    try { if (dir && fs.realpathSync(link) === real) return link; } catch { /* not here */ }
  }
  return process.execPath;
}

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
  profileFile = path.join(os.homedir(), '.falcon', 'profile.json'),
  runEngine = defaultRunEngine,
  log = console.log,
} = {}) {
  if (!fs.existsSync(workspace)) throw new Error(`Workspace not found at ${workspace}. Set up the engine first.`);
  const skillsDir = path.join(workspace, 'skills');
  const node = stableNode();
  // How the user asked to be addressed. A note in his profile is not enough for smaller models, which copy
  // the "sir" in the examples, so the chosen form is written into the rules and examples themselves.
  let callMe = 'sir';
  let profile = {};
  try { profile = JSON.parse(read(profileFile)) || {}; } catch { /* no profile yet */ }
  try { callMe = String(profile.callMe || 'sir').replace(/[\r\n"<>`]/g, '').trim().slice(0, 30) || 'sir'; } catch { /* no profile yet */ }
  const custom = callMe.toLowerCase() !== 'sir';
  const addressRule = custom
    ? `The user has asked to be addressed as "${callMe}". Use "${callMe}" in every reply and in every language. Never call him "sir" or «сэр».`
    : 'Address the user as "sir" (in Russian: «сэр») unless your notes about him give another form of address.';
  // What the user said about himself when they first met. It goes into the rules themselves because the
  // notes file is not reliably in front of Falcon in every conversation.
  const tidy = (value, max) => String(value || '').replace(/[\r\n]+/g, ' ').replace(/[<>`{}]/g, '').trim().slice(0, max);
  const name = tidy(profile.name, 60);
  const about = tidy(profile.about, 400);
  const facts = [
    name ? `The user's name is ${name}.` : '',
    about ? `This is what he told you he mostly does on this computer, in his own words: "${about}"` : '',
  ].filter(Boolean);
  const userFacts = facts.length
    ? `What you know about the user from his own introduction: ${facts.join(' ')}`
    : 'The user has not yet told you about himself. If he does, remember it.';
  const personalise = (text) => (custom ? text.replace(/\bsir\b/g, callMe).replace(/сэр/g, callMe) : text)
    .replaceAll('{{ADDRESS_RULE}}', addressRule)
    .replaceAll('{{USER_FACTS}}', userFacts);
  const fill = (text, skillDir = '') => text
    .replaceAll('{{SKILLS}}', skillsDir)
    .replaceAll('{{NODE}}', node)
    .replaceAll('{{SKILL_DIR}}', skillDir)
    .replaceAll('<folder of this SKILL.md>', skillDir);

  // Personality and identity
  fs.writeFileSync(path.join(workspace, 'SOUL.md'), personalise(read(path.join(here, 'SOUL.md'))));
  fs.copyFileSync(path.join(here, 'IDENTITY.md'), path.join(workspace, 'IDENTITY.md'));

  // Working rules: keep the engine's own AGENTS.md, add (or refresh) the Falcon section at the end
  const agentsPath = path.join(workspace, 'AGENTS.md');
  const existing = fs.existsSync(agentsPath) ? read(agentsPath) : '# AGENTS.md\n';
  const withoutOld = existing.replace(/\r?\n*<!-- (jarvis|falcon):start -->[\s\S]*?<!-- (jarvis|falcon):end -->\r?\n*/g, '\n');
  const fastPaths = variant ? read(path.join(here, `fastpaths.${variant}.md`)).trim() : '';
  const section = personalise(fill(read(path.join(here, 'AGENTS.falcon.md')).replace('{{FAST_PATHS}}', fastPaths)));
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
