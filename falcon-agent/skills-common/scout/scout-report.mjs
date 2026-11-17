#!/usr/bin/env node
// Falcon's scout: turns his findings into a dossier page, saves it in "Falcon Scout" on the Desktop
// and opens it. Everything from the web is escaped; only http(s) links are kept.
//
//   node scout-report.mjs --data "<folder of this script>/dossier.json" [--no-open]
//
// dossier.json (written by Falcon; every field but name is optional):
//   { "name": "Uzum", "type": "company", "subtitle": "Digital ecosystem, Tashkent",
//     "summary": "Two or three sentences [1][2].", "photo": "https://...",
//     "facts": [{ "label": "Founded", "value": "2022", "sources": [1] }],
//     "sections": [{ "title": "Business", "items": [{ "text": "...", "sources": [2, 3] }] }],
//     "news": [{ "date": "2026-10-09", "title": "...", "url": "https://...", "outlet": "Bloomberg" }],
//     "social": [{ "platform": "Instagram", "handle": "uzum.market", "url": "https://...", "confidence": "confirmed|likely|possible", "note": "Linked from uzum.uz" }],
//     "profiles": [{ "label": "Website", "url": "https://..." }],
//     "checks": [{ "label": "Court cases", "result": "None found in public news", "status": "ok|warn|info|unknown" }],
//     "unknowns": ["Revenue is not published"],
//     "sources": [{ "title": "Wikipedia: Uzum", "url": "https://..." }],
//     "stats": { "searches": 6, "pagesRead": 5, "minutes": 3 } }
// The free sweep (last-sweep.json next to this script) fills in the photo, news and checks if missing.
//   {"ok":true,"path":"C:\\Users\\...\\Desktop\\Falcon Scout\\Uzum - 2026-11-16.html"}
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { progressPath } from './scout-live.mjs';

// A copy the chat can send (the engine sends files only from its own folders); never blocks the result.
async function readyToSend(file) {
  try { const { shareFile } = await import(new URL('../files/share-file.mjs', import.meta.url)); const r = shareFile(file); return r.ok ? r.sendPath : undefined; } catch { return undefined; }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback = '') => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback; };
const done = (result) => { process.stdout.write(`${JSON.stringify(result)}\n`); process.exit(result.ok ? 0 : 1); };

let d;
try { d = JSON.parse(fs.readFileSync(option('--data', path.join(here, 'dossier.json')), 'utf8').replace(/^\uFEFF/, '')); }
catch (err) { done({ ok: false, error: `The findings file could not be read: ${err.message}` }); }
if (!d || typeof d !== 'object' || !String(d.name || '').trim()) done({ ok: false, error: 'The findings need at least a "name".' });

let sweep = null;
try {
  const s = JSON.parse(fs.readFileSync(path.join(here, 'last-sweep.json'), 'utf8'));
  // Only use the sweep if it was about the same target and is recent.
  const same = (a, b) => String(a).toLowerCase().replace(/\s+/g, ' ').trim() === String(b).toLowerCase().replace(/\s+/g, ' ').trim();
  if ((same(s.name, d.name) || (s.aliases || []).some((a) => same(a, d.name))) && Date.now() - Date.parse(s.at) < 6 * 3600000) sweep = s;
} catch { /* no sweep */ }

// ---- Safe text and links ----
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
const list = (v) => (Array.isArray(v) ? v : []);
const sources = list(d.sources).map((s) => ({ title: String(s?.title || s?.url || 'Source'), url: safeUrl(s?.url) })).filter((s) => s.url);
const cite = (nums) => list(nums).map(Number).filter((n) => n >= 1 && n <= sources.length)
  .map((n) => `<a class="cite" href="#src-${n}" title="${esc(sources[n - 1].title)}">${n}</a>`).join('');
// "[1][2]" written inside text becomes a citation link.
// A number with no such source is dropped rather than shown.
const rich = (text) => esc(text).replace(/\s*\[(\d{1,3})\]/g, (m, n) => (Number(n) >= 1 && Number(n) <= sources.length ? cite([n]) : ''));

// ---- Fill gaps from the free sweep ----
const f = sweep?.findings || {};
const wiki = f['Wikipedia (English)'] || f['Wikipedia (Russian)'];
const photo = safeUrl(d.photo) || safeUrl(wiki?.photo) || safeUrl(f.Wikidata?.photo);
let news = list(d.news).map((n) => ({ date: String(n?.date || ''), title: String(n?.title || ''), url: safeUrl(n?.url), outlet: String(n?.outlet || n?.source || '') })).filter((n) => n.title);
if (!news.length && sweep) {
  const seen = new Set();
  news = [...list(f['Google News (English)']), ...list(f['Google News (Russian)'])]
    .map((n) => ({ date: n.date, title: String(n.title).replace(/\s+-\s+[^-]+$/, ''), url: safeUrl(n.url), outlet: n.source }))
    .filter((n) => { const k = n.title.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
}
const checks = list(d.checks).map((c) => ({ label: String(c?.label || ''), result: String(c?.result || ''), status: ['ok', 'warn', 'unknown', 'info'].includes(c?.status) ? c.status : 'unknown' })).filter((c) => c.label);
const has = (word) => checks.some((c) => c.label.toLowerCase().includes(word));
if (sweep) {
  const ofac = f['US sanctions list (OFAC)'];
  if (ofac && !has('sanction')) {
    checks.push(ofac.matches?.length
      ? { label: 'US sanctions list', result: `Possible name match: ${ofac.matches.map((m) => m.name).join('; ')}. Check whether it is the same party.`, status: 'warn' }
      : { label: 'US sanctions list', result: `No match among ${Number(ofac.checked).toLocaleString('en-US')} listed people and companies`, status: 'ok' });
  }
  const gl = f['Global company register (GLEIF)'];
  if (Array.isArray(gl) && !has('register')) {
    checks.push(gl.length
      ? { label: 'Global company register', result: `Closest registered names: ${gl.slice(0, 2).map((g) => `${g.legalName} (${g.country})`).join('; ')}. Not confirmed as the same company.`, status: 'info' }
      : { label: 'Global company register', result: 'No legal entity registered under this name', status: 'unknown' });
  }
  const sec = f['US SEC filings'];
  if (sec && !has('sec')) {
    const others = (sec.mentionedIn || 0) - (sec.total || 0);
    checks.push({ label: 'US SEC filings', result: sec.total
      ? `${sec.total} filings by ${sec.filings?.[0]?.company || 'a company of this name'}`
      : `Files nothing with the SEC${others > 0 ? ` (the name appears in ${others} filings by other companies)` : ''}`, status: 'info' });
  }
  const uz = f['Uzbekistan company register (orginfo.uz)'];
  if (Array.isArray(uz) && !has('uzbek')) {
    checks.push(uz.length
      ? { label: 'Uzbekistan company register', result: uz.slice(0, 3).map((u) => `${u.legalName}${u.taxNumber ? `, tax number ${u.taxNumber}` : ''}${u.status ? `, ${u.status}` : ''}`).join('; '), status: 'info' }
      : { label: 'Uzbekistan company register', result: 'No company registered in Uzbekistan under this name', status: 'unknown' });
  }
  const web = f['Website registration'];
  if (web?.registered && !has('website')) checks.push({ label: 'Website', result: `${web.domain} registered ${web.registered}${web.registrar ? ` with ${web.registrar}` : ''}`, status: 'ok' });
}
const profiles = list(d.profiles).map((p) => ({ label: String(p?.label || ''), url: safeUrl(p?.url) })).filter((p) => p.url);
if (!profiles.length && f.Wikidata?.facts) {
  for (const label of ['official website', 'LinkedIn', 'X (Twitter)', 'Instagram', 'Facebook', 'YouTube channel', 'GitHub']) {
    const url = safeUrl(String(f.Wikidata.facts[label] || '').split(',')[0].trim());
    if (url) profiles.push({ label: label === 'official website' ? 'Website' : label, url });
  }
}

// ---- Social media accounts: Falcon's own, then the sweep's name-matched ones and Wikidata's ----
const PLATFORM_OF = [[/instagram\.com/, 'Instagram'], [/facebook\.com|fb\.com/, 'Facebook'], [/tiktok\.com/, 'TikTok'], [/(?:\/\/|\.)(?:x|twitter)\.com/, 'X'],
  [/linkedin\.com/, 'LinkedIn'], [/t\.me|telegram\.me/, 'Telegram'], [/youtube\.com/, 'YouTube'], [/vk\.com/, 'VK'], [/threads\.(?:net|com)/, 'Threads'],
  [/github\.com/, 'GitHub'], [/ok\.ru/, 'Odnoklassniki'], [/pinterest\./, 'Pinterest'], [/reddit\.com/, 'Reddit']];
const platformOf = (url) => (PLATFORM_OF.find(([re]) => re.test(url)) || [null, ''])[1];
const social = [];
const seenSocial = new Set();
const addSocial = (a) => {
  const url = safeUrl(a?.url);
  if (!url) return;
  const key = url.toLowerCase().replace(/\/+$/, '').replace('twitter.com', 'x.com').replace(/:\/\/(www\.|m\.|[a-z]{2}\.(?=linkedin))/, '://').replace('t.me/s/', 't.me/');
  if (seenSocial.has(key)) return;
  seenSocial.add(key);
  const confidence = ['confirmed', 'likely', 'possible'].includes(a.confidence) ? a.confidence : 'possible';
  social.push({ platform: String(a.platform || platformOf(url) || new URL(url).hostname), handle: String(a.handle || '').replace(/^@?/, '@').replace(/^@$/, ''), url, confidence, note: String(a.note || '') });
};
list(d.social).forEach(addSocial);
for (const p of list(d.profiles)) if (platformOf(String(p?.url || ''))) addSocial({ url: p.url, platform: platformOf(p.url), confidence: 'confirmed', note: '' });
if (f.Wikidata?.facts) {
  for (const label of ['LinkedIn', 'X (Twitter)', 'Instagram', 'Facebook', 'YouTube channel', 'GitHub']) {
    const url = String(f.Wikidata.facts[label] || '').split(',')[0].trim();
    if (url) addSocial({ url, confidence: 'confirmed', note: 'Listed on Wikidata' });
  }
}
// Falcon's own judgement wins: once he lists accounts, the sweep's raw finds are not added on top,
// so an account he left out as someone else's stays out.
const judged = list(d.social).length > 0;
for (const a of judged ? [] : list(f['Social accounts (web search on 9 platforms)']?.accounts)) {
  addSocial({ ...a, confidence: a.match === 'likely' ? 'likely' : 'possible', note: a.how });
}
for (const a of judged ? [] : list(f['Social accounts (Telegram, X, YouTube, GitHub)']?.accounts)) {
  addSocial({ ...a, confidence: a.match === 'likely' ? 'likely' : 'possible', note: [a.name && `Shown as "${a.name}"`, a.bio].filter(Boolean).join(' · ') });
}
const order = { confirmed: 0, likely: 1, possible: 2 };
const BRAND = { Instagram: '#d6249f', Facebook: '#1877f2', TikTok: '#111', X: '#111', LinkedIn: '#0a66c2', Telegram: '#229ed9', YouTube: '#e62117',
  VK: '#0077ff', Threads: '#111', GitHub: '#24292f', Odnoklassniki: '#ee8208', Pinterest: '#e60023', Reddit: '#ff4500' };
social.sort((a, b) => order[a.confidence] - order[b.confidence]);
// Profiles that are social accounts are shown with them, not twice.
for (let i = profiles.length - 1; i >= 0; i--) if (platformOf(profiles[i].url)) profiles.splice(i, 1);

const stats = d.stats || {};
const swept = sweep ? sweep.checked.length : 0;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// The real time taken: from the start of the sweep until now.
const took = sweep ? Math.max(1, Math.round((Date.now() - Date.parse(sweep.at) + sweep.seconds * 1000) / 60000)) : Number(stats.minutes) || 0;
const chips = [
  swept && `${swept} databases swept`,
  Number(stats.searches) > 0 && plural(Number(stats.searches), 'web search', 'web searches'),
  Number(stats.pagesRead) > 0 && plural(Number(stats.pagesRead), 'page read', 'pages read'),
  sources.length && plural(sources.length, 'source cited', 'sources cited'),
  social.length && plural(social.length, 'social account', 'social accounts'),
  took > 0 && `${took} min`,
].filter(Boolean);
const typeLabel = d.type === 'company' ? 'Company' : d.type === 'person' ? 'Person' : 'Subject';
const today = new Date();
const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
const dateText = today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const initials = String(d.name).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

const section = (title, body) => (body ? `<section><h2>${esc(title)}</h2>${body}</section>` : '');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.name)} · Falcon Scout</title>
<style>
:root{--bg:#f4f2ee;--paper:#fffdf9;--ink:#1b1d22;--muted:#6a6f7a;--line:#e3dfd6;--accent:#0f6e8c;--accent-soft:#e3f1f5;--ok:#1d7a4f;--ok-soft:#e2f3ea;--warn:#a5600b;--warn-soft:#fbefdc;--unk:#6a6f7a;--unk-soft:#eeede9}
@media (prefers-color-scheme:dark){:root{--bg:#0d1014;--paper:#151a20;--ink:#e9ecf1;--muted:#99a1ad;--line:#262e38;--accent:#54c2e4;--accent-soft:#16303a;--ok:#5fd09a;--ok-soft:#14301f;--warn:#f0b35a;--warn-soft:#3a2c14;--unk:#99a1ad;--unk-soft:#20262e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif}
.page{max-width:920px;margin:32px auto;background:var(--paper);border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.06)}
header{padding:28px 36px 24px;border-bottom:1px solid var(--line);background:linear-gradient(135deg,var(--accent-soft),transparent 60%)}
.brand{display:flex;justify-content:space-between;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:22px}
.brand b{color:var(--accent);letter-spacing:.18em}
.who{display:flex;gap:22px;align-items:center}
.photo{width:96px;height:96px;border-radius:50%;object-fit:cover;flex:none;border:3px solid var(--paper);box-shadow:0 2px 10px rgba(0,0,0,.12);background:var(--accent);color:#fff;display:grid;place-items:center;font-size:34px;font-weight:600}
h1{margin:0;font-size:34px;line-height:1.15;letter-spacing:-.01em}.sub{color:var(--muted);margin-top:4px}
.tag{display:inline-block;font-size:12px;font-weight:600;color:var(--accent);background:var(--accent-soft);border-radius:99px;padding:2px 10px;margin-bottom:8px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.chips span{font-size:13px;border:1px solid var(--line);border-radius:99px;padding:3px 11px;background:var(--paper)}
main{padding:8px 36px 32px}section{padding:22px 0;border-bottom:1px solid var(--line)}section:last-child{border:0}
h2{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 14px}
.summary{font-size:19px;line-height:1.55}
.facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.fact{border:1px solid var(--line);border-radius:12px;padding:12px 14px}.fact small{display:block;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em}.fact div{font-weight:600;margin-top:2px}
ul.items{margin:0;padding-left:20px}ul.items li{margin:6px 0}
.cite{display:inline-block;font-size:11px;font-weight:700;color:var(--accent);background:var(--accent-soft);border-radius:6px;padding:0 5px;margin-left:3px;text-decoration:none;vertical-align:2px;line-height:1.5}
.timeline{list-style:none;margin:0;padding:0;border-left:2px solid var(--line)}.timeline li{position:relative;padding:0 0 14px 18px}
.timeline li:before{content:"";position:absolute;left:-6px;top:8px;width:10px;height:10px;border-radius:50%;background:var(--accent)}
.timeline time{font-size:13px;color:var(--muted);display:block}.timeline a{color:var(--ink);text-decoration:none;font-weight:500}.timeline a:hover{color:var(--accent)}.timeline em{color:var(--muted);font-style:normal;font-size:13px}
.checks{display:grid;gap:10px}.check{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--line);border-radius:12px;padding:11px 14px}
.pill{flex:none;font-size:12px;font-weight:700;border-radius:99px;padding:2px 10px}.ok .pill{color:var(--ok);background:var(--ok-soft)}.warn .pill{color:var(--warn);background:var(--warn-soft)}.unknown .pill,.info .pill{color:var(--unk);background:var(--unk-soft)}
.check b{display:block}.check span.r{color:var(--muted);font-size:14px}
.links{display:flex;flex-wrap:wrap;gap:10px}.links a{border:1px solid var(--line);border-radius:10px;padding:7px 13px;color:var(--accent);text-decoration:none;font-weight:600;font-size:14px}.links a:hover{background:var(--accent-soft)}
ol.sources{margin:0;padding-left:22px;font-size:14px}ol.sources li{margin:4px 0;word-break:break-word}ol.sources a{color:var(--accent)}ol.sources li:target{background:var(--accent-soft);border-radius:6px}
.unknowns li{color:var(--muted)}
.social{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.acct{display:flex;gap:12px;align-items:center;border:1px solid var(--line);border-radius:12px;padding:10px 12px;text-decoration:none;color:var(--ink)}.acct:hover{border-color:var(--accent)}
.acct .logo{flex:none;width:38px;height:38px;border-radius:10px;display:grid;place-items:center;font-weight:700;font-size:14px;color:#fff;background:var(--accent)}
.acct .who2{flex:1;min-width:0}.acct .who2 b{display:block;font-size:14px}.acct .who2 span{display:block;font-size:13px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.acct small{display:block;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.acct .conf{flex:none;font-size:11px;font-weight:700;border-radius:99px;padding:2px 9px}.confirmed .conf{color:var(--ok);background:var(--ok-soft)}.likely .conf{color:var(--accent);background:var(--accent-soft)}.possible .conf{color:var(--unk);background:var(--unk-soft)}
.possible{border-style:dashed}
footer{padding:16px 36px;font-size:12px;color:var(--muted);border-top:1px solid var(--line)}
@media (max-width:640px){.page{margin:0;border-radius:0}header,main,footer{padding-left:18px;padding-right:18px}.who{flex-direction:column;align-items:flex-start}h1{font-size:28px}}
@media print{body{background:#fff}.page{box-shadow:none;margin:0;border:0}}
</style></head><body><div class="page">
<header>
  <div class="brand"><b>Falcon Scout</b><span>Dossier · ${esc(dateText)}</span></div>
  <div class="who">
    ${photo ? `<img class="photo" src="${esc(photo)}" alt="" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;photo&quot;>${esc(initials)}</div>'">` : `<div class="photo">${esc(initials)}</div>`}
    <div><span class="tag">${esc(typeLabel)}</span><h1>${esc(d.name)}</h1>${d.subtitle ? `<div class="sub">${esc(d.subtitle)}</div>` : ''}</div>
  </div>
  ${chips.length ? `<div class="chips">${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div>` : ''}
</header>
<main>
${section('In brief', d.summary || wiki?.extract ? `<p class="summary">${d.summary ? rich(d.summary) : esc(wiki.extract)}</p>` : '')}
${section('Key facts', list(d.facts).filter((x) => x?.label && x?.value).length ? `<div class="facts">${list(d.facts).filter((x) => x?.label && x?.value).map((x) => `<div class="fact"><small>${esc(x.label)}</small><div>${rich(x.value)}${cite(x.sources)}</div></div>`).join('')}</div>` : '')}
${list(d.sections).filter((s) => s?.title && list(s.items).length).map((s) => section(s.title, `<ul class="items">${list(s.items).map((i) => `<li>${rich(typeof i === 'string' ? i : i?.text)}${typeof i === 'object' ? cite(i?.sources) : ''}</li>`).join('')}</ul>`)).join('\n')}
${section('In the news', news.length ? `<ul class="timeline">${news.map((n) => `<li><time>${esc(n.date)}</time>${n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>` : esc(n.title)}${n.outlet ? ` <em>· ${esc(n.outlet)}</em>` : ''}</li>`).join('')}</ul>` : '')}
${section('Checks', checks.length ? `<div class="checks">${checks.map((c) => `<div class="check ${c.status}"><span class="pill">${c.status === 'ok' ? 'Clear' : c.status === 'warn' ? 'Look' : c.status === 'info' ? 'Info' : 'Unknown'}</span><div><b>${esc(c.label)}</b><span class="r">${rich(c.result)}</span></div></div>`).join('')}</div>` : '')}
${section('Social media', social.length ? `<div class="social">${social.map((a) => `<a class="acct ${a.confidence}" href="${esc(a.url)}" target="_blank" rel="noopener"><span class="logo" style="background:${BRAND[a.platform] || 'var(--accent)'}">${esc(a.platform === 'X' ? 'X' : a.platform.slice(0, 2))}</span><span class="who2"><b>${esc(a.platform)}</b><span>${esc(a.handle || new URL(a.url).pathname.replace(/^\/|\/$/g, '') || a.url)}</span>${a.note ? `<small>${esc(a.note)}</small>` : ''}</span><span class="conf">${a.confidence === 'confirmed' ? 'Confirmed' : a.confidence === 'likely' ? 'Likely' : 'Possible'}</span></a>`).join('')}</div>` : '')}
${section('Online presence', profiles.length ? `<div class="links">${profiles.map((p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.label || new URL(p.url).hostname)}</a>`).join('')}</div>` : '')}
${section('Not found or unclear', list(d.unknowns).length ? `<ul class="items unknowns">${list(d.unknowns).map((u) => `<li>${rich(u)}</li>`).join('')}</ul>` : '')}
${section('Sources', sources.length ? `<ol class="sources">${sources.map((s, i) => `<li id="src-${i + 1}"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('')}</ol>` : '')}
</main>
<footer>Compiled by Falcon from public sources on ${esc(dateText)}. Facts carry the number of their source; check anything important before relying on it.</footer>
</div></body></html>`;

// ---- Save on the Desktop, in "Falcon Scout" ----
const home = os.homedir();
const desktop = [path.join(home, 'Desktop'), path.join(home, 'OneDrive', 'Desktop')].find((p) => fs.existsSync(p)) || home;
const folder = path.join(desktop, 'Falcon Scout');
const fileName = `${String(d.name).replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 80)} - ${localDate}.html`;
const out = path.join(folder, fileName);
try {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(out, html);
} catch (err) { done({ ok: false, error: `The dossier could not be saved: ${err.message}` }); }

// Remember it: a plain summary goes into Falcon's own notes (the memory folder of his workspace, two
// folders above this script), where his memory search finds it when the user asks about it later.
let remembered = null;
try {
  const workspace = path.resolve(here, '..', '..');
  if (fs.existsSync(path.join(workspace, 'AGENTS.md'))) {
    const memory = path.join(workspace, 'memory');
    fs.mkdirSync(memory, { recursive: true });
    const plain = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
    const lines = [
      `# Scout dossier: ${plain(d.name)} (${localDate})`, '',
      `Scouted on ${localDate} at the user's request. ${plain(d.subtitle)}`.trim(),
      `Full dossier page: ${out}`, '',
      d.summary ? `Summary: ${plain(d.summary)}` : '',
      ...list(d.facts).filter((x) => x?.label && x?.value).map((x) => `- ${plain(x.label)}: ${plain(x.value)}`),
      ...list(d.sections).filter((s) => s?.title).flatMap((s) => [`## ${plain(s.title)}`, ...list(s.items).map((i) => `- ${plain(typeof i === 'string' ? i : i?.text)}`)]),
      checks.length ? '## Checks' : '', ...checks.map((c) => `- ${plain(c.label)}: ${plain(c.result)}`),
      social.length ? '## Social media' : '', ...social.map((a) => `- ${a.platform}: ${a.url} (${a.confidence})`),
      list(d.unknowns).length ? '## Not found or unclear' : '', ...list(d.unknowns).map((u) => `- ${plain(u)}`),
    ].filter((l, i, all) => l !== '' || all[i - 1] !== '');
    remembered = path.join(memory, `scout-${fileName.replace(/\.html$/, '.md').replace(/\s+/g, '-')}`);
    fs.writeFileSync(remembered, `${lines.join('\n').trim()}\n`);
  }
} catch { remembered = null; /* the dossier itself is saved */ }

// Falcon's window shows the dossier itself; open it in the browser only when asked to.
if (args.includes('--open')) {
  {
    try {
      const child = process.platform === 'win32' ? spawn('explorer.exe', [out], { detached: true, stdio: 'ignore' })
        : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [out], { detached: true, stdio: 'ignore' });
      child.on('error', () => {});
      child.unref();
    } catch { /* saved anyway */ }
  }
}
// Tell Falcon's window the dossier is ready (it shows an "Open dossier" button).
try {
  const progress = JSON.parse(fs.readFileSync(progressPath(), 'utf8'));
  fs.writeFileSync(progressPath(), JSON.stringify({ ...progress, stage: 3, dossier: out, at: Date.now() }));
} catch { /* no window waiting */ }
const sendPath = await readyToSend(out);
done({ ok: true, path: out, ...(sendPath ? { sendPath } : {}), remembered: Boolean(remembered), sources: sources.length, news: news.length, checks: checks.length });
