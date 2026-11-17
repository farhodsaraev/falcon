import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

export async function desktopReadiness(platform = process.platform) {
  if (platform === 'darwin') {
    const has = app => ['/Applications', path.join(os.homedir(), 'Applications')].some(dir => fs.existsSync(path.join(dir, `${app}.app`)));
    return has('Keynote') || has('Microsoft PowerPoint');
  }
  if (platform === 'win32') return new Promise(resolve => execFile('reg.exe', ['query', 'HKCR\\PowerPoint.Application\\CLSID'], { timeout: 4000, windowsHide: true }, (error, _stdout, stderr) => resolve(!error ? true : error.code === 1 && /unable to find|cannot find|не удается найти|не удаётся найти/i.test(stderr) ? false : null)));
  return null;
}

export async function readiness(api, dir) {
  const items = [];
  const add = (id, label, status, detail, remedy = '') => items.push({ id, label, status, detail, remedy });
  const installed = !!api.findEngine();
  let connected = false;
  try { connected = installed && await api.engineReady(); } catch {}
  add('engine', 'Assistant connection', connected ? 'ready' : 'blocked', connected ? 'The local assistant is responding.' : 'The local assistant is not responding.', 'Open Falcon again; if setup is incomplete, finish setup first.');
  let bridge = false;
  try { const h = JSON.parse(fs.readFileSync(path.join(dir, 'health.json'), 'utf8')); bridge = h.version === 1 && Date.now() - h.at < 30000 && h.at <= Date.now() + 1000; } catch {}
  add('tracking', 'Action tracking and stop guard', bridge ? 'ready' : 'blocked', bridge ? 'The execution add-on is reporting.' : 'The execution add-on has not reported recently.', 'Use Update tracking below, then check again after the assistant restarts. Actions are blocked if tracking cannot be reached.');
  if (connected) {
    try {
      const r = await api.runEngine(['skills', 'list', '--json'], { timeoutMs: 10000 });
      const data = JSON.parse(r.out.slice(r.out.indexOf('{')));
      if (r.code !== 0 || !Array.isArray(data.skills)) throw new Error('unavailable');
      for (const s of data.skills.filter(s => ['files', 'apps', 'presentations', 'documents', 'screen', 'scout', 'daily'].includes(s.name))) {
        const missing = s.missing || {};
        const unmet = Object.values(missing).flat().filter(v => typeof v === 'string').map(v => v.replace(/[^a-zA-Z0-9_. /-]/g, '').slice(0, 80));
        const ready = s.eligible === true && !s.disabled && !unmet.length;
        add(`skill-${s.name}`, `${s.name[0].toUpperCase()}${s.name.slice(1)}`, ready ? 'ready' : 'blocked', ready ? 'Skill dependencies are available.' : unmet.length ? `Missing: ${unmet.join(', ')}` : 'The skill is disabled or not eligible.', 'Install the listed dependency or enable the skill in assistant settings.');
      }
      if (!items.some(i => i.id.startsWith('skill-'))) add('skills', 'Skills', 'unknown', 'No Falcon skills were returned.', 'Update Falcon to install its skills.');
    } catch { add('skills', 'Skills', 'unknown', 'The skill inventory could not be checked.', 'Check the assistant connection, then refresh.'); }
    try {
      const r = await api.runEngine(['models', 'status', '--plain'], { timeoutMs: 10000 });
      add('model', 'AI model', r.code === 0 && !!r.out.trim() ? 'unknown' : 'blocked', r.code === 0 && !!r.out.trim() ? 'A model is configured. Provider access and credit are checked when a request is sent.' : 'No configured model could be confirmed.', 'Open Settings → AI key to check the key and model.');
    } catch { add('model', 'AI model', 'unknown', 'Model configuration could not be checked.', 'Open Settings → AI key.'); }
  }
  let ppt = null;
  try { ppt = await api.desktopReadiness(); } catch {}
  add('presentation-app', 'Presentation app', ppt === true ? 'ready' : ppt === false ? 'blocked' : 'unknown', ppt === true ? 'A presentation app is installed. Control permission is checked when used.' : ppt === false ? 'PowerPoint or Keynote was not found.' : 'Presentation app availability was not checked.', 'Install PowerPoint (Windows), or Keynote/PowerPoint (Mac).');
  add('screen-permission', 'Screen and app control permission', 'unknown', 'Permission is confirmed only when screen/app control is used.', 'On Mac, review Privacy & Security → Screen Recording, Accessibility and Automation.');
  add('browser', 'Your Chrome connection', 'unknown', 'Use the connection check to confirm access to signed-in tabs.', 'Open Settings → Connections → Test Chrome.');
  return { checkedAt: Date.now(), items };
}
