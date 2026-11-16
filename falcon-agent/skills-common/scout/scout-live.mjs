// Falcon's scout: the live page shown while a scout runs. It refreshes itself every two seconds and,
// once the dossier is ready, turns into it. Used by scout-sources.mjs and scout-report.mjs.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function scoutFolder() {
  const home = os.homedir();
  const desktop = [path.join(home, 'Desktop'), path.join(home, 'OneDrive', 'Desktop')].find((p) => fs.existsSync(p)) || home;
  return path.join(desktop, 'Falcon Scout');
}
export const livePath = () => path.join(scoutFolder(), 'Scout in progress.html');

export function openFile(file) {
  try {
    const child = process.platform === 'win32' ? spawn('explorer.exe', [file], { detached: true, stdio: 'ignore' })
      : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [file], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch { /* the page is saved anyway */ }
}

/** True if a live page was written in the last ten minutes (so it is open and will follow on). */
export function liveIsOpen() {
  try { return Date.now() - fs.statSync(livePath()).mtimeMs < 10 * 60000; } catch { return false; }
}

/** Points the open live page at the finished dossier. */
export function liveDone(dossierFile) {
  const href = encodeURI(path.basename(dossierFile));
  fs.writeFileSync(livePath(), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${href}"><title>Falcon Scout</title><body style="background:#0b1016;color:#9fb3c8;font:16px sans-serif;display:grid;place-items:center;height:100vh">Opening the dossier…</body>`);
}

/**
 * Writes the live page. `sources` is a list of { name, state: 'wait'|'done'|'none'|'error', found }.
 * `stage` 0: databases, 1: web search and social networks, 2: writing the dossier.
 */
export const progressPath = () => path.join(os.homedir(), '.falcon', 'scout-progress.json');
/** The progress Falcon's window shows while a scout runs. */
export function writeProgress({ name, type, sources, stage, found, dossier = '' }) {
  fs.mkdirSync(path.dirname(progressPath()), { recursive: true });
  fs.writeFileSync(progressPath(), JSON.stringify({ name, type, stage, found, dossier, at: Date.now(),
    sources: sources.map((s) => ({ name: s.name, state: s.state, found: s.found || 0 })) }));
}

export function writeLive({ name, type, sources, stage, found }) {
  const stages = ['Sweeping public databases', 'Searching the web and 9 social networks', 'Checking identity and writing the dossier'];
  const rows = sources.map((s) => `<li class="${s.state}"><i></i><span>${esc(s.name)}</span><em>${s.state === 'wait' ? 'checking…' : s.state === 'error' ? 'unavailable' : s.found ? `${s.found} found` : 'nothing'}</em></li>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="2">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Scouting ${esc(name)} · Falcon</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 30% 20%,#12324a 0%,#0b1016 55%);color:#e6eef6;font:16px/1.5 -apple-system,"Segoe UI",Inter,Roboto,sans-serif;display:grid;place-items:center}
.wrap{width:min(980px,94vw);display:grid;grid-template-columns:360px 1fr;gap:48px;align-items:center}
.radar{position:relative;width:340px;height:340px;border-radius:50%;background:radial-gradient(circle,rgba(84,194,228,.10) 0 1px,transparent 1px) 0 0/34px 34px;border:1px solid rgba(84,194,228,.35);overflow:hidden;box-shadow:0 0 60px rgba(84,194,228,.15) inset}
.radar:before,.radar:after{content:"";position:absolute;inset:16%;border-radius:50%;border:1px solid rgba(84,194,228,.25)}.radar:after{inset:34%}
.sweep{position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,rgba(84,194,228,.55),rgba(84,194,228,0) 60deg);animation:spin 2s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.dot{position:absolute;width:8px;height:8px;border-radius:50%;background:#7fe3ff;box-shadow:0 0 12px #7fe3ff;animation:blip 2s ease-in-out infinite}
@keyframes blip{0%,100%{opacity:.15}50%{opacity:1}}
.core{position:absolute;inset:44%;border-radius:50%;background:#54c2e4;box-shadow:0 0 24px #54c2e4}
.brand{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#54c2e4}
h1{margin:6px 0 2px;font-size:34px;letter-spacing:-.01em}.sub{color:#9fb3c8;margin-bottom:22px}
.stages{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap}.stages span{font-size:13px;border-radius:99px;padding:4px 12px;border:1px solid #23394d;color:#7d93a8}
.stages .now{border-color:#54c2e4;color:#e6eef6;background:rgba(84,194,228,.12)}.stages .past{color:#5fd09a;border-color:#1f4a35}
ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:6px 18px}
li{display:flex;align-items:center;gap:10px;font-size:14px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05)}li span{flex:1}li em{font-style:normal;font-size:12px;color:#7d93a8}
li i{width:10px;height:10px;border-radius:50%;flex:none;background:#2a3d50}
li.wait i{background:#54c2e4;animation:blip 1s infinite}li.done i{background:#5fd09a}li.done em{color:#5fd09a}li.none i{background:#4a5b6c}li.error i{background:#a5600b}
.count{margin-top:20px;font-size:14px;color:#9fb3c8}.count b{color:#e6eef6;font-size:22px;margin-right:6px}
.dots:after{content:"";animation:dots 1.5s steps(4) infinite}@keyframes dots{0%{content:""}25%{content:"."}50%{content:".."}75%{content:"..."}}
@media (max-width:760px){.wrap{grid-template-columns:1fr;justify-items:center}.radar{width:260px;height:260px}ul{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<div class="radar"><div class="sweep"></div>${Array.from({ length: Math.min(18, 3 + found) }, (_, i) => `<span class="dot" style="left:${(48 + Math.cos(i * 2.39996) * 40 * Math.sqrt((i + 1) / 19)).toFixed(1)}%;top:${(48 + Math.sin(i * 2.39996) * 40 * Math.sqrt((i + 1) / 19)).toFixed(1)}%;animation-delay:${((i * 0.37) % 2).toFixed(2)}s"></span>`).join('')}<div class="core"></div></div>
<div><div class="brand">Falcon Scout</div><h1>${esc(name)}</h1><div class="sub">${type === 'company' ? 'Company' : 'Person'} · ${esc(stages[stage])}<span class="dots"></span></div>
<div class="stages">${stages.map((s, i) => `<span class="${i < stage ? 'past' : i === stage ? 'now' : ''}">${i < stage ? '✓ ' : ''}${esc(s)}</span>`).join('')}</div>
<ul>${rows}</ul>
<div class="count"><b>${found}</b>findings so far</div></div>
</div></body></html>`;
  fs.mkdirSync(scoutFolder(), { recursive: true });
  fs.writeFileSync(livePath(), html);
}
