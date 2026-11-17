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
const FALCON_SKILLS = ['files', 'presentations', 'screen', 'daily', 'scout', 'documents', 'apps'];
const APPROVALS = '{ "version": 1, "defaults": { "security": "allowlist", "ask": "on-miss", "askFallback": "deny" } }';

const read = (file) => fs.readFileSync(file, 'utf8');

// The Node.js path written into Falcon's commands must survive updates. A package manager's real
// path carries the version number (".../node@24/24.22.3/bin/node"), so prefer the stable link to it.
function stableNode() {
  if (process.platform === 'win32') return process.execPath;
  const real = fs.realpathSync(process.execPath);
  const dirs = [path.join(os.homedir(), '.openclaw', 'tools', 'node', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.openclaw', 'bin'),
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
 * Web search. The engine has a search tool only when a search service is set up; an OpenAI key brings
 * its own, but with an Anthropic or OpenRouter key Falcon would have none and fall back to a browser
 * that Google blocks. Falcon's window keeps the keys search needs in the engine's private .env file:
 * a Google key (searches Google itself) wins; otherwise an OpenRouter key searches through Perplexity,
 * billed to the same OpenRouter account, with no extra key. With neither (an Anthropic key, or no key
 * yet), a free search service that needs no key is switched on, unless Falcon thinks with an OpenAI
 * model, which searches by itself.
 */
export async function setupSearch({
  step,
  // Optional: collect plain settings to apply together with Falcon's others, instead of one command each.
  set = (what, key, value) => step(what, ['config', 'set', key, String(value)]),
  envFile = path.join(os.homedir(), '.openclaw', '.env'),
  configFile = path.join(os.homedir(), '.openclaw', 'openclaw.json'),
}) {
  let env = '';
  try { env = read(envFile); } catch { /* no keys saved */ }
  let primary = '';
  try {
    const model = JSON.parse(read(configFile))?.agents?.defaults?.model;
    primary = String((typeof model === 'string' ? model : model?.primary) || '');
  } catch { /* no engine settings yet */ }
  if (/^GEMINI_API_KEY=\S/m.test(env)) {
    await set('Google search', 'tools.web.search.provider', 'gemini');
  } else if (/^OPENROUTER_API_KEY=\S/m.test(env)) {
    // Without the add-on the engine would not know the search service, so set nothing else if it failed.
    if (!await step('search add-on', ['plugins', 'install', '@openclaw/perplexity-plugin', '--accept-capabilities', '--acknowledge-install-policy-warning'], undefined, { okIf: /already (installed|exists)/i })) return;
    await set('web search', 'plugins.entries.perplexity.config.webSearch.baseUrl', 'https://openrouter.ai/api/v1');
    await set('web search model', 'plugins.entries.perplexity.config.webSearch.model', 'perplexity/sonar');
    await set('web search on', 'tools.web.search.provider', 'perplexity');
  } else if (!/^openai\//.test(primary)) {
    if (!await step('free search add-on', ['plugins', 'install', '@openclaw/parallel-plugin', '--accept-capabilities', '--acknowledge-install-policy-warning'], undefined, { okIf: /already (installed|exists)/i })) return;
    await set('free web search on', 'tools.web.search.provider', 'parallel-free');
  }
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
  envFile = path.join(os.homedir(), '.openclaw', '.env'),
  configFile = path.join(os.homedir(), '.openclaw', 'openclaw.json'),
  runEngine = defaultRunEngine,
  retryDelayMs = 3000,
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
  // His own Telegram chat, saved by Falcon's window at pairing: the send action needs it named exactly.
  let telegramChat = '';
  try { telegramChat = String(JSON.parse(read(path.join(path.dirname(profileFile), 'telegram.json'))).chat || ''); } catch { /* not paired yet */ }
  if (!/^-?\d{5,}$/.test(telegramChat)) telegramChat = '';
  const telegramRule = telegramChat
    ? `use the message tool with channel \`telegram\` and target \`${telegramChat}\`, which is his own Telegram chat.`
    : 'his Telegram is not connected to you yet; say so in one sentence and that he can connect it with the Telegram button in your window.';
  const personalise = (text) => (custom ? text.replace(/\bsir\b/g, callMe).replace(/сэр/g, callMe) : text)
    .replaceAll('{{ADDRESS_RULE}}', addressRule)
    .replaceAll('{{USER_FACTS}}', userFacts)
    .replaceAll('{{TELEGRAM_RULE}}', telegramRule);
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
    // Parts of a skill that are the same on every kind of computer
    const shared = path.join(here, 'skills-common', name);
    if (fs.existsSync(shared)) fs.cpSync(shared, target, { recursive: true });
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
  // An optional step may fail without making the whole setup count as failed.
  const step = async (what, args, input, { okIf, optional = false } = {}) => {
    let { code, out } = await runEngine(args, { input, timeoutMs: 300000 });
    // The engine may be busy saving another change ("config changed since last load", "not applied to
    // the active Gateway"): wait a moment and try once more.
    if (code !== 0 && /changed since last load|retry|not applied to the active Gateway|UNAVAILABLE/i.test(out)) {
      await new Promise((r) => setTimeout(r, retryDelayMs));
      ({ code, out } = await runEngine(args, { input, timeoutMs: 300000 }));
    }
    const ok = code === 0 || Boolean(okIf && okIf.test(out));
    results.push({ what, ok, optional });
    log(ok ? `  ok    ${what}` : `  ${optional ? 'skipped' : 'FAILED'} ${what}: ${out.trim().split('\n')[0]}`);
    return ok;
  };
  log('Applying settings...');
  // Each engine command starts the engine's command tool from scratch, which takes seconds (11 on a slow
  // PC with two antivirus programs). So plain settings are collected and applied in one validated write,
  // and the pre-approvals go in with the approvals themselves: about 6 commands instead of about 28.
  // If a batch is refused, the same settings are applied one by one, as before.
  const sets = [];
  const set = (what, key, value) => { sets.push({ what, path: key, value }); return true; };
  // A little thinking: with none, Falcon stopped after the first step of browser tasks (opened a site and answered).
  set('think before acting', 'agents.defaults.thinkingDefault', 'low');
  // One browser: the user's own Chrome. Smaller models forgot to name it on every step, so their next
  // step went to the engine's separate, empty browser and found nothing.
  set('browser is his Chrome', 'browser.defaultProfile', 'user');
  // Tools sit in a catalog. In the default mode, calling web search or the browser by name answered
  // "tool not found" and Falcon gave up; in directory mode a call by exact name just works.
  set('tools callable by name', 'tools.toolSearch.mode', 'directory');
  // Falcon's rules are longer than the 20,000 characters the engine reads from each file by default;
  // without this the end of them (the scout steps among them) was cut off.
  set('read all of his rules', 'agents.defaults.bootstrapMaxChars', 60000);
  set('local chat for the Falcon window', 'gateway.http.endpoints.chatCompletions.enabled', true);
  // His own Telegram chat (saved by Falcon's window at pairing) as the default, so "send it to me on
  // Telegram" works from his window and by voice too, not only from inside Telegram.
  try {
    const chat = String(JSON.parse(fs.readFileSync(path.join(path.dirname(profileFile), 'telegram.json'), 'utf8')).chat || '');
    if (/^-?\d{5,}$/.test(chat)) set('his Telegram chat', 'channels.telegram.defaultTo', chat);
  } catch { /* not paired yet */ }
  // Hands for desktop apps: the engine's desktop control stays off until it is switched on by name.
  // On Windows this makes the computer tool work. On a Mac it is tried; the apps skill, which commands
  // Mail, Notes, Calendar and the rest directly, covers the common apps either way.
  // Skipped when already on: on a second setup the engine's enable command failed with no reason given.
  let desktopOn = false;
  try { desktopOn = JSON.parse(fs.readFileSync(configFile, 'utf8')).plugins?.entries?.['cua-computer']?.enabled === true; } catch { /* no settings yet */ }
  if (!desktopOn) await step('desktop control', ['plugins', 'enable', 'cua-computer'], undefined, { okIf: /already enabled/i, optional: process.platform !== 'win32' });
  // Search add-ons are installed first (their settings only exist once they are); their plain settings
  // join the batch.
  await setupSearch({ step, set, envFile, configFile });

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-setup-'));
  try {
    const batchFile = path.join(temp, 'settings.json');
    fs.writeFileSync(batchFile, JSON.stringify(sets.map(({ path: key, value }) => ({ path: key, value }))));
    if (!await step(`${sets.length} settings at once`, ['config', 'set', '--batch-file', batchFile], undefined, { optional: true })) {
      for (const s of sets) await step(s.what, ['config', 'set', s.path, String(s.value)]);
    }
    // No background check-ins. Engines from 2026.11.5 have no such monitor (scheduled checks became
    // ordinary automation jobs) and reject the setting, so it is sent on its own and may fail harmlessly;
    // in the batch it made every other setting fail with it.
    await step('no background check-ins', ['config', 'set', 'agents.defaults.heartbeat.every', '0m'], undefined, { okIf: /Unrecognized key: "heartbeat"/i, optional: true });

    // Ask-first approvals, with Falcon's own small programs pre-approved in the same document.
    const approvals = JSON.parse(APPROVALS);
    approvals.agents = { '*': { allowlist: scripts.map((script) => ({ pattern: script })) } };
    const approvalsFile = path.join(temp, 'approvals.json');
    fs.writeFileSync(approvalsFile, JSON.stringify(approvals));
    const together = await step(`ask-first approvals and ${scripts.length} pre-approvals`,
      ['approvals', 'set', '--gateway', '--file', approvalsFile], undefined, { optional: true });
    // Check what landed; add one by one whatever did not (or everything, if the combined write was refused).
    let landed = new Set();
    if (together) {
      const { code, out } = await runEngine(['approvals', 'get', '--gateway', '--json'], { timeoutMs: 300000 });
      if (code === 0) {
        try {
          const doc = JSON.parse(out.slice(out.indexOf('{')));
          landed = new Set(Object.values(doc.file?.agents || {}).flatMap((a) => a.allowlist || []).map((e) => path.normalize(String(e.pattern || ''))));
        } catch { /* unreadable: re-add everything below */ }
      }
    } else {
      await step('ask-first approvals', ['approvals', 'set', '--gateway', '--stdin'], APPROVALS);
    }
    for (const script of scripts) {
      if (landed.has(path.normalize(script))) continue;
      await step(`pre-approve ${path.basename(script)}`, ['approvals', 'allowlist', 'add', script, '--gateway']);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }

  await step('name', ['agents', 'set-identity', '--workspace', workspace, '--name', 'Falcon']);
  // A refused batch is not a failure in itself: what counts is that its settings then went in one by one.
  return { ok: results.every((r) => r.ok || r.optional), settings: results };
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
