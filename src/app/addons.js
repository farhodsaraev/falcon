// Falcon's add-ons for his engine (self-repair plan, stage 6).
//
// An add-on is a small folder of code that the engine loads at its start: it can give the AI new tools.
// Falcon's own add-ons live inside Falcon, in falcon-agent/addons/<name>, so a repair can make one in a
// workshop copy, his tests and a load check judge it, and as one of the owner's changes it survives
// Falcon's updates (stage 4). Engine updates replace only the engine's program files, so they never
// touch an add-on: his setup copies each one beside the engine's settings and tells the engine to load it.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ADDONS_DIR = path.join('falcon-agent', 'addons');
const ADDON_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** The add-ons in a copy of Falcon: [{ name, dir, id, manifest }]. Folders without a readable manifest are left out. */
export function listAddons(appRoot) {
  const root = path.join(appRoot, ADDONS_DIR);
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
  return names.flatMap((name) => {
    const dir = path.join(root, name);
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'openclaw.plugin.json'), 'utf8'));
      return ADDON_ID.test(String(manifest.id || '')) ? [{ name, dir, id: manifest.id, manifest }] : [];
    } catch { return []; }
  });
}

export function lastJson(out) {
  const text = String(out || '');
  const end = text.lastIndexOf('}');
  for (let start = text.lastIndexOf('\n{', end); start >= 0; start = text.lastIndexOf('\n{', start - 1)) {
    try { return JSON.parse(text.slice(start + 1, end + 1)); } catch { /* an earlier brace */ }
  }
  try { return JSON.parse(text.slice(text.indexOf('{'), end + 1)); } catch { return null; }
}

/**
 * Loads one add-on in a private copy of the engine's settings (never the engine in use) and reports
 * whether it loaded and which tools it adds: { ok, status, tools, error }.
 */
export function checkAddon({ cli, node = process.execPath, addon, stateDir, timeoutMs = 180000 }) {
  return new Promise((resolve) => {
    if (!cli) return resolve({ ok: true, skipped: 'the engine is not installed here' });
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'openclaw.json'), JSON.stringify({ plugins: { load: { paths: [addon.dir] }, entries: { [addon.id]: { enabled: true } } } }, null, 2));
    const env = { ...process.env, OPENCLAW_STATE_DIR: stateDir, NODE_NO_WARNINGS: '1' };
    for (const name of ['OPENCLAW_CONFIG_PATH', 'OPENCLAW_PROFILE', 'OPENCLAW_HOME', 'OPENCLAW_WINDOWS_TASK_NAME', 'NODE_TEST_CONTEXT']) delete env[name];
    execFile(node, [cli, 'plugins', 'inspect', addon.id, '--runtime', '--json'], { cwd: stateDir, env, windowsHide: true, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const doc = lastJson(stdout);
      const plugin = doc?.plugin;
      const tools = Array.isArray(plugin?.toolNames) ? plugin.toolNames : [];
      const problems = [...(Array.isArray(doc?.diagnostics) ? doc.diagnostics : []), ...(Array.isArray(plugin?.diagnostics) ? plugin.diagnostics : [])]
        .filter((d) => /error/i.test(String(d?.level || d?.severity || ''))).map((d) => String(d.message || d.text || d));
      if (plugin?.status === 'loaded' && plugin.enabled !== false && !problems.length) return resolve({ ok: true, status: 'loaded', tools });
      resolve({ ok: false, status: plugin?.status || 'not loaded', tools, error: (problems[0] || plugin?.error || String(stderr || err?.message || 'it did not load')).trim().split('\n').slice(0, 3).join(' ').slice(0, 500) });
    });
  });
}

/** Checks every add-on in a workshop copy: [{ id, ok, tools, error }]. */
export async function checkAddons({ dir, cli, node, home = os.homedir(), only = null }) {
  const results = [];
  for (const addon of listAddons(dir).filter((a) => !only || only.includes(a.name))) {
    const r = await checkAddon({ cli, node, addon, stateDir: path.join(home, '.falcon', 'addon-check', addon.id) });
    results.push({ id: addon.id, ...r });
  }
  return results;
}
