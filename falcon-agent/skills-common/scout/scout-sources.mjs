#!/usr/bin/env node
// Falcon's scout: one sweep of free, public sources about a person or a company, all at once.
// Read-only; nothing needs a key. Prints one line of JSON and keeps the full result next to this
// file (last-sweep.json) for the dossier page.
//
//   node scout-sources.mjs --name "Uzum" --type company [--hint "Uzbekistan marketplace"] [--site uzum.uz]
//   node scout-sources.mjs --name "Djasur Djumaev" --type person [--hint "Uzum"] [--aliases "Jasur Jumaev, Джасур Джумаев"] [--handles "djumaev, djasur.d"]
//
//   {"ok":true,"name":"...","type":"company","seconds":4.2,"checked":[{"source":"Wikipedia","found":2}, ...],"findings":{...}}
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeProgress } from './scout-live.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback = '') => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback; };
const done = (result) => { process.stdout.write(`${JSON.stringify(result)}\n`); process.exit(result.ok ? 0 : 1); };

const name = option('--name').trim();
const type = option('--type', 'person') === 'company' ? 'company' : 'person';
const hint = option('--hint').trim();
// Account names to check on social platforms, besides the ones guessed from the name
const handles = option('--handles').split(/[,;\s]+/).map((h) => h.trim().replace(/^@/, '')).filter((h) => /^[\w.]{3,40}$/.test(h)).slice(0, 6);
// Other spellings of the name (transliterations, Cyrillic, maiden names, the company's legal name)
const aliases = option('--aliases').split(/[,;]/).map((a) => a.trim()).filter((a) => a.length > 1 && a.length < 120).slice(0, 5);
let site = option('--site').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
if (name.length < 2 || name.length > 120) done({ ok: false, error: 'Give the name to scout with --name.' });

const UA = 'Mozilla/5.0 (FalconScout/1.0; personal research assistant)';
const started = Date.now();

async function get(url, { json = true, timeout = 15000, headers = {} } = {}, attempt = 0) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: json ? 'application/json' : '*/*', ...headers }, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
  // Busy: wait a moment and ask once more.
  if ((response.status === 429 || response.status >= 500) && attempt < 2) {
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    return get(url, { json, timeout, headers }, attempt + 1);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return json ? response.json() : response.text();
}
const enc = encodeURIComponent;
const clip = (text, max) => { const t = String(text ?? '').replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
const fold = (text) => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (n) => fold(n).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1);
const names = [name, ...aliases].map(words).filter((w) => w.length);
// A result is about our target only if it carries every word of one spelling of the name (in any order),
// as whole words. A Cyrillic word may carry a short Russian ending (Узума, Узумом); a Latin one only a
// plural or possessive, so "Uzumaki" is not "Uzum".
const fits = (token, word) => token === word || (token.startsWith(word) && token.length - word.length <= (/[а-яё]/.test(word) ? 3 : 1));
const mentions = (text) => { const tokens = words(text); return names.some((w) => w.every((t) => tokens.some((x) => fits(x, t)))); };
const each = async (fn) => (await Promise.allSettled([name, ...aliases].map(fn))).flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value].flat() : []));
const decode = (s) => String(s ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, '');

// ---- Wikipedia (English and Russian): the article summary and photo ----
async function wikipedia(lang) {
  let page = null;
  for (const n of [name, ...aliases]) {
    const found = await get(`https://${lang}.wikipedia.org/w/rest.php/v1/search/page?q=${enc(n)}&limit=5`);
    page = (found.pages || []).find((p) => mentions(p.title) && !/disambiguation|значения/i.test(p.description || ''));
    if (page) break;
  }
  if (!page) return null;
  const s = await get(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${enc(page.key)}`);
  return { title: s.title, description: s.description || '', extract: clip(s.extract, 1200), url: s.content_urls?.desktop?.page, photo: s.originalimage?.source || s.thumbnail?.source || null };
}

// ---- Wikidata: structured facts (born, roles, founders, headquarters, website, social profiles) ----
const PROPS = {
  P569: 'born', P19: 'place of birth', P27: 'citizenship', P106: 'occupation', P108: 'employer', P39: 'position held',
  P69: 'educated at', P26: 'spouse', P112: 'founded by', P169: 'chief executive', P571: 'founded', P159: 'headquarters',
  P452: 'industry', P1128: 'employees', P2139: 'revenue', P749: 'parent organisation', P355: 'subsidiaries', P17: 'country',
  P856: 'official website', P6634: 'LinkedIn', P2002: 'X (Twitter)', P2003: 'Instagram', P2013: 'Facebook', P2397: 'YouTube channel', P2037: 'GitHub',
};
const PROFILE_URL = { P6634: (v) => `https://www.linkedin.com/in/${v}`, P2002: (v) => `https://x.com/${v}`, P2003: (v) => `https://www.instagram.com/${v}`,
  P2013: (v) => `https://www.facebook.com/${v}`, P2397: (v) => `https://www.youtube.com/channel/${v}`, P2037: (v) => `https://github.com/${v}` };
async function wikidata() {
  const search = { search: await each(async (n) => (await get(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${enc(n)}&language=en&uselang=en&limit=7&format=json`)).search || []) };
  const want = type === 'person' ? /\b(born|businessman|entrepreneur|politician|investor|executive|founder|engineer|scientist|actor|singer|writer|player)\b|\(\d{4}/i : /company|business|enterprise|bank|organi[sz]ation|marketplace|brand|firm|platform|group|startup|corporation/i;
  const candidates = (search.search || []).filter((e) => mentions(e.label || '') && !/family name|given name|surname|disambiguation|Wikimedia/i.test(e.description || ''));
  const hit = candidates.find((e) => want.test(e.description || '')) || (candidates.length === 1 ? candidates[0] : null);
  if (!hit) return null;
  const entity = (await get(`https://www.wikidata.org/wiki/Special:EntityData/${hit.id}.json`)).entities[hit.id];
  const facts = {};
  const itemIds = new Set();
  for (const [prop, label] of Object.entries(PROPS)) {
    for (const claim of (entity.claims?.[prop] || []).slice(0, 6)) {
      const v = claim.mainsnak?.datavalue?.value;
      if (v == null) continue;
      let value;
      if (typeof v === 'string') value = PROFILE_URL[prop] ? PROFILE_URL[prop](v) : v;
      else if (v.id) { value = { id: v.id }; itemIds.add(v.id); }
      else if (v.time) value = v.time.replace(/^\+/, '').slice(0, v.precision >= 11 ? 10 : v.precision === 10 ? 7 : 4);
      else if (v.amount) value = `${Number(v.amount).toLocaleString('en-US')}${v.unit && v.unit !== '1' ? '' : ''}`;
      else continue;
      (facts[label] ||= []).push(value);
    }
  }
  if (itemIds.size) {
    const ids = [...itemIds].slice(0, 50).join('|');
    const labels = (await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=labels&languages=en|ru&format=json`)).entities || {};
    for (const label of Object.keys(facts)) {
      facts[label] = facts[label].map((v) => (v && v.id ? (labels[v.id]?.labels?.en?.value || labels[v.id]?.labels?.ru?.value || v.id) : v));
    }
  }
  for (const label of Object.keys(facts)) facts[label] = [...new Set(facts[label])].join(', ');
  const image = entity.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return {
    id: hit.id, label: hit.label, description: hit.description || '', url: `https://www.wikidata.org/wiki/${hit.id}`, facts,
    photo: image ? `https://commons.wikimedia.org/wiki/Special:FilePath/${enc(image)}?width=400` : null,
  };
}

// ---- Google News: the latest headlines, in English and Russian ----
async function news(lang) {
  const where = lang === 'ru' ? 'hl=ru&gl=RU&ceid=RU:ru' : 'hl=en-US&gl=US&ceid=US:en';
  const query = [name, ...aliases].map((n) => `"${n}"`).join(' OR ');
  const xml = await get(`https://news.google.com/rss/search?q=${enc(query)}&${where}`, { json: false });
  const items = [];
  for (const block of xml.split('<item>').slice(1)) {
    const tag = (t) => decode((block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || '');
    const title = tag('title');
    if (!mentions(title) && !mentions(tag('description'))) continue;
    const date = new Date(tag('pubDate'));
    items.push({ date: Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10), title: clip(title, 200), source: tag('source'), url: tag('link') });
  }
  return items.slice(0, 10);
}

// ---- GLEIF: the worldwide register of legal entities (official company name, country, status, address) ----
async function gleif() {
  const data = await get(`https://api.gleif.org/api/v1/lei-records?filter[fulltext]=${enc(name)}&page[size]=8`, { headers: { Accept: 'application/vnd.api+json' } });
  return (data.data || []).map((r) => r.attributes).filter((a) => mentions(a.entity?.legalName?.name || '')).slice(0, 5).map((a) => ({
    legalName: a.entity.legalName.name, lei: a.lei, country: a.entity.jurisdiction || a.entity.legalAddress?.country, status: a.entity.status,
    legalForm: a.entity.legalForm?.other || a.entity.legalForm?.id, city: a.entity.legalAddress?.city,
    address: [a.entity.legalAddress?.addressLines?.join(' '), a.entity.legalAddress?.city, a.entity.legalAddress?.country].filter(Boolean).join(', '),
    registered: a.registration?.initialRegistrationDate?.slice(0, 10), url: `https://search.gleif.org/#/record/${a.lei}`,
  }));
}

// ---- Uzbekistan's company register (orginfo.uz): official name, tax number, status, address ----
async function uzRegister() {
  const results = await each(async (n) => {
    const html = await get(`https://orginfo.uz/ru/search/organizations/?q=${enc(n)}`, { json: false, headers: { 'Accept-Language': 'ru' } });
    return html.split('og-card').slice(1).map((card) => {
      const link = (html.slice(0, html.indexOf(card)).match(/href="(\/ru\/organization\/[\w-]+\/)"[^>]*class="[^"]*$/) || [])[1];
      const pick = (re) => decode((card.match(re) || [])[1] || '').replace(/\s+/g, ' ').trim();
      return {
        legalName: pick(/<h6 class="card-title">([\s\S]*?)<\/h6>/), taxNumber: pick(/rounded-5">\s*(\d{9})\s*</),
        status: pick(/text-(?:danger|success|warning)">\s*([^<]+?)\s*</), registered: pick(/calendar"?>\s*([\d.]+)/),
        address: pick(/location"?>\s*([^<]+)/), url: link ? `https://orginfo.uz${link}` : 'https://orginfo.uz/',
      };
    });
  });
  const seen = new Set();
  // Same-name rule as everywhere: every word of one spelling of the name must be in the official name.
  // Closest first: the official name is exactly the name (inside its quotes), then working companies before
  // closed ones. "Uzum" is also an everyday word (grape), so farms named after it sink to the bottom.
  const quoted = (r) => fold((r.legalName.match(/["«]([^"»]+)["»]/) || [])[1] || r.legalName).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const exact = (r) => names.some((w) => quoted(r) === w.join(' '));
  const score = (r) => (exact(r) ? 0 : 4) + (/ликвид|liquid|tugatil/i.test(r.status) ? 2 : 0) + (/фермер|дехкон|fermer|dehqon/i.test(r.legalName) ? 1 : 0);
  return results.filter((r) => r.legalName && mentions(r.legalName) && !seen.has(r.taxNumber || r.legalName) && seen.add(r.taxNumber || r.legalName))
    .sort((a, b) => score(a) - score(b)).slice(0, 6).map((r) => ({ ...r, exactName: exact(r) }));
}

// ---- US SEC filings: companies of that name that file with the SEC, and how often the name is mentioned ----
// A plain mention of a common word ("Uzum", "Apex") turns up in many unrelated filings, so only filings
// made by a company whose own name matches are listed; the rest are only counted.
async function sec() {
  const data = await get(`https://efts.sec.gov/LATEST/search-index?q=${enc(`"${name}"`)}`);
  const hits = data.hits?.hits || [];
  const own = hits.filter((h) => (h._source.display_names || []).some((d) => mentions(d.replace(/\(CIK[^)]*\)/i, ''))));
  return {
    total: own.length,
    mentionedIn: data.hits?.total?.value || 0,
    filings: own.slice(0, 6).map((h) => ({
      company: (h._source.display_names || []).find((d) => mentions(d)) || '', form: h._source.form || h._source.file_type, date: h._source.file_date,
      url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${(h._source.ciks || [])[0] || ''}`,
    })),
  };
}

// ---- OpenAlex: research papers by a person ----
async function openalex() {
  return (await each(async (n) => (await get(`https://api.openalex.org/authors?search=${enc(n)}&per-page=5`)).results || [])).filter((a) => mentions(a.display_name)).slice(0, 3).map((a) => ({
    name: a.display_name, works: a.works_count, citations: a.cited_by_count,
    institution: a.last_known_institutions?.[0]?.display_name || '', topics: (a.topics || []).slice(0, 4).map((t) => t.display_name).join(', '), url: a.id,
  }));
}

// ---- GitHub: public developer profiles and organisations ----
async function github() {
  const q = type === 'company' ? `${name} type:org` : `${name} in:name type:user`;
  const data = await get(`https://api.github.com/search/users?q=${enc(q)}&per_page=5`, { headers: { Accept: 'application/vnd.github+json' } });
  // GitHub's search also matches bios and locations; keep only accounts whose own name carries the target's.
  return (data.items || []).filter((u) => mentions(u.login.replace(/[-_.]+/g, ' ')) || slugMatches(u.login) && fold(u.login).replace(/[^a-z0-9]/g, '') === [name, ...aliases].map((n) => fold(n).replace(/[^a-z0-9]/g, '')).find(Boolean)).slice(0, 4).map((u) => ({ login: u.login, url: u.html_url }));
}

// ---- US Treasury sanctions list (OFAC SDN), downloaded at most once a week ----
async function sanctions() {
  // Kept outside the skill folder, which is replaced whenever Falcon is reinstalled.
  const cache = path.join(os.homedir(), '.falcon', 'scout-cache', 'sdn.csv');
  let fresh = false;
  try { fresh = Date.now() - fs.statSync(cache).mtimeMs < 7 * 86400000; } catch { /* not downloaded yet */ }
  if (!fresh) {
    const csv = await get('https://www.treasury.gov/ofac/downloads/sdn.csv', { json: false, timeout: 45000 });
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, csv);
  }
  const lines = fs.readFileSync(cache, 'utf8').split(/\r?\n/).filter(Boolean);
  const matches = [];
  for (const line of lines) {
    const listed = (line.match(/^\d+,"([^"]*)"/) || [])[1];
    if (listed && mentions(listed)) matches.push({ name: listed, programme: (line.split(',')[3] || '').replace(/"/g, '') });
  }
  return { checked: lines.length, matches: matches.slice(0, 5), url: 'https://sanctionssearch.ofac.treas.gov/' };
}

// ---- Who registered the website, and when ----
async function domain(d) {
  const data = await get(`https://rdap.org/domain/${enc(d)}`);
  const event = (kind) => (data.events || []).find((e) => e.eventAction === kind)?.eventDate?.slice(0, 10);
  const registrar = (data.entities || []).find((e) => (e.roles || []).includes('registrar'));
  const registrarName = registrar?.vcardArray?.[1]?.find((v) => v[0] === 'fn')?.[3];
  return { domain: d, registered: event('registration'), expires: event('expiration'), registrar: registrarName || '' };
}

// ---- Social accounts: which account names exist on platforms that show it without logging in ----
// Instagram, TikTok, Facebook, VK and Threads hide this from anonymous visitors; Falcon searches those
// through web search and the user's own Chrome instead.
const translit = (t) => fold(t).replace(/[^a-z0-9]/g, '');
function guessHandles() {
  const latin = [name, ...aliases].map((n) => fold(n).split(/[^a-z0-9]+/).filter(Boolean)).find((w) => w.length >= 1 && w.every((x) => /^[a-z0-9]+$/.test(x)));
  const out = new Set(handles.map((h) => h.toLowerCase()));
  if (latin) {
    if (type === 'company' || latin.length === 1) { out.add(latin.join('')); out.add(latin.join('_')); out.add(`${latin.join('')}official`); }
    else {
      const [first, last] = [latin[0], latin[latin.length - 1]];
      for (const h of [`${first}${last}`, `${first}.${last}`, `${first}_${last}`, `${last}${first}`, `${first[0]}${last}`]) out.add(h);
    }
  }
  return [...out].filter((h) => /^[\w.]{3,40}$/.test(h)).slice(0, 7);
}
const meta = (html, prop) => decode((html.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, 'i')) || [])[1] || '');
const PLATFORMS = {
  Telegram: { url: (h) => `https://t.me/${h}`, test: (status, html) => status === 200 && /tgme_page_title/.test(html), name: (html) => decode((html.match(/tgme_page_title[^>]*>\s*<span[^>]*>([^<]*)/) || [])[1] || meta(html, 'og:title')), bio: (html) => meta(html, 'og:description') },
  X: { url: (h) => `https://x.com/${h}`, test: (status) => status === 200, name: (html) => decode((html.match(/<title>([^<]*?)\s*\(@/) || [])[1] || ''), bio: (html) => meta(html, 'description') },
  YouTube: { url: (h) => `https://www.youtube.com/@${h}`, test: (status) => status === 200, name: (html) => meta(html, 'og:title'), bio: (html) => meta(html, 'og:description') },
  GitHub: { url: (h) => `https://github.com/${h}`, api: (h) => `https://api.github.com/users/${h}` },
};
async function socialAccounts() {
  const tried = guessHandles();
  const checks = [];
  for (const h of tried) for (const [platform, p] of Object.entries(PLATFORMS)) checks.push([platform, p, h]);
  const found = [];
  // A few at a time, to stay polite.
  for (let i = 0; i < checks.length; i += 12) {
    await Promise.all(checks.slice(i, i + 12).map(async ([platform, p, h]) => {
      try {
        if (p.api) {
          const u = await get(p.api(h), { headers: { Accept: 'application/vnd.github+json' } }).catch(() => null);
          if (u?.login) found.push({ platform, handle: h, url: p.url(h), name: u.name || '', bio: clip(u.bio || u.company || u.location || '', 160) });
          return;
        }
        const response = await fetch(p.url(h), { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(9000), redirect: 'follow' });
        const html = (await response.text()).slice(0, 2000000);
        if (!p.test(response.status, html)) return;
        found.push({ platform, handle: h, url: p.url(h), name: clip(p.name(html), 80), bio: clip(p.bio(html), 160) });
      } catch { /* not reachable: treat as not found */ }
    }));
  }
  // Keep an account only if its display name carries the target's name ("likely"), or if Falcon was
  // given that exact account name to check ("possible"); anything else is someone else's handle.
  const given = new Set(handles.map((h) => h.toLowerCase()));
  const kept = [];
  for (const a of found) {
    // The name alone is only "possible"; the name plus the hint (employer, city) in the bio is "likely".
    const hinted = hint && latinWords(hint).concat(fold(hint).split(/\s+/)).some((w) => w.length > 3 && fold(a.bio).includes(w));
    if (a.name && mentions(a.name)) kept.push({ ...a, match: hinted ? 'likely' : 'possible' });
    else if (given.has(a.handle.toLowerCase())) kept.push({ ...a, match: 'possible' });
  }
  kept.sort((a, b) => (a.match === b.match ? 0 : a.match === 'likely' ? -1 : 1));
  return { tried, accounts: kept.slice(0, 12) };
}

// ---- Social accounts on every platform, through web search limited to that platform's site ----
// Uses the OpenRouter key Falcon already has (about half a cent per platform). Only profile pages
// (not posts) whose address carries the name are kept; a link that came back as a real search result
// counts for more than one the search model merely suggested.
const PROFILE_SHAPES = [
  ['Instagram', 'instagram.com', /^https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel|explore|accounts|stories|about|legal|developer)([\w.]{2,30})\/?$/i],
  ['Facebook', 'facebook.com', /^https?:\/\/(?:www\.|m\.)?facebook\.com\/(?!posts|groups|events|watch|photo|share|story|help|policies|login|search|hashtag|pages\/category)([\w.\-]{3,60})\/?$/i],
  ['LinkedIn', 'linkedin.com', /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/((?:in|company)\/[\w\-%]{2,100})\/?$/i],
  ['TikTok', 'tiktok.com', /^https?:\/\/(?:www\.)?tiktok\.com\/@([\w.]{2,30})\/?$/i],
  ['X', 'x.com', /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/(?!i\/|search|home|explore|hashtag|intent|share)([\w]{2,15})\/?$/i],
  ['Telegram', 't.me', /^https?:\/\/t\.me\/(?:s\/)?([\w]{4,32})\/?$/i],
  ['YouTube', 'youtube.com', /^https?:\/\/(?:www\.)?youtube\.com\/((?:@|c\/|channel\/)[\w.\-]{2,60})\/?$/i],
  ['VK', 'vk.com', /^https?:\/\/(?:m\.)?vk\.com\/(?!wall|photo|video|club\d|search|feed)([\w.]{3,40})\/?$/i],
  ['Threads', 'threads.net', /^https?:\/\/(?:www\.)?threads\.(?:net|com)\/@([\w.]{2,30})\/?$/i],
];
function canonicalProfile(url) {
  return String(url).replace(/^http:/, 'https:').replace('://twitter.com', '://x.com').replace('://www.x.com', '://x.com').replace('://instagram.com', '://www.instagram.com')
    .replace('://m.facebook.com', '://www.facebook.com').replace('://facebook.com', '://www.facebook.com').replace(/:\/\/t\.me\/s\//, '://t.me/')
    .replace(/:\/\/[a-z]{2,3}\.linkedin\.com/, '://www.linkedin.com').replace('://linkedin.com', '://www.linkedin.com').replace(/\/$/, '');
}
function openRouterKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  try { return (fs.readFileSync(path.join(os.homedir(), '.openclaw', '.env'), 'utf8').match(/^OPENROUTER_API_KEY=(.+)$/m) || [])[1]?.trim() || ''; } catch { return ''; }
}
const latinWords = (n) => fold(n).split(/[^a-z0-9]+/).filter((w) => w.length > 2);
// The address carries the name if it holds the surname (or for a company, its main word) in Latin letters.
function slugMatches(slug) {
  const f = fold(decodeURIComponent(slug)).replace(/[^a-z0-9]/g, '');
  return [name, ...aliases].map(latinWords).filter((w) => w.length).some((w) => (type === 'company' ? w.some((x) => f.includes(x)) : f.includes(w[w.length - 1]) && (w.length < 2 || f.includes(w[0]) || f.includes(w[0].slice(0, 3)))));
}
async function webProfiles() {
  const key = openRouterKey();
  if (!key) return null;
  const who = type === 'company' ? `the company ${name}${hint ? ` (${hint})` : ''}` : `${name}${hint ? ` (${hint})` : ''}`;
  const one = async ([platform, domain, shape]) => {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Falcon Scout' },
      body: JSON.stringify({ model: 'perplexity/sonar', max_tokens: 120, search_domain_filter: [domain],
        messages: [{ role: 'user', content: `Find the public ${platform} ${type === 'company' ? 'account' : 'profile'} of ${who}. Reply with the profile URL only, or NONE.` }] }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const j = await response.json();
    const clean = (u) => String(u).split('?')[0].replace(/\/$/, '');
    const titles = new Map();
    for (const a of j.choices?.[0]?.message?.annotations || []) if (a.url_citation?.url) titles.set(clean(a.url_citation.url), a.url_citation.title || '');
    for (const r of j.search_results || []) if (r.url) titles.set(clean(r.url), r.title || '');
    for (const u of j.citations || []) if (!titles.has(clean(u))) titles.set(clean(u), '');
    const cited = new Set(titles.keys());
    const suggested = ((j.choices?.[0]?.message?.content || '').match(/https?:\/\/[^\s)\]"'>,]+/g) || []).map((u) => u.split('?')[0].replace(/[.,;]+$/, '').replace(/\/$/, ''));
    const out = [];
    for (const url of new Set([...suggested, ...cited])) {
      const m = url.match(shape);
      if (!m || !slugMatches(m[1])) continue;
      const title = titles.get(url) || '';
      out.push({ platform, url, handle: m[1], title: clip(title, 100), match: cited.has(url) ? 'likely' : 'possible',
        how: cited.has(url) ? (title ? `Search result: "${clip(title, 70)}"` : 'Found in web search results') : 'Suggested by web search, not confirmed' });
    }
    return out;
  };
  const settledAll = await Promise.allSettled(PROFILE_SHAPES.map(one));
  const all = settledAll.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  all.sort((a, b) => (a.match === b.match ? 0 : a.match === 'likely' ? -1 : 1));
  // One entry per account (t.me/s/name is t.me/name; handles ignore case), at most four per platform.
  const accounts = [];
  const seenKeys = new Set();
  const perPlatform = {};
  for (const a of all) {
    const canonical = canonicalProfile(a.url);
    const k = canonical.toLowerCase();
    if (seenKeys.has(k) || (perPlatform[a.platform] || 0) >= 4) continue;
    seenKeys.add(k);
    perPlatform[a.platform] = (perPlatform[a.platform] || 0) + 1;
    accounts.push({ ...a, url: canonical });
  }
  return { platforms: PROFILE_SHAPES.map((p) => p[0]), accounts };
}

const jobs = {
  'Wikipedia (English)': () => wikipedia('en'),
  'Wikipedia (Russian)': () => wikipedia('ru'),
  Wikidata: wikidata,
  'Google News (English)': () => news('en'),
  'Google News (Russian)': () => news('ru'),
  'US sanctions list (OFAC)': sanctions,
  'US SEC filings': sec,
  GitHub: github,
  'Social accounts (Telegram, X, YouTube, GitHub)': socialAccounts,
  ...(openRouterKey() ? { 'Social accounts (web search on 9 platforms)': webProfiles } : {}),
  ...(type === 'company' ? { 'Global company register (GLEIF)': gleif, 'Uzbekistan company register (orginfo.uz)': uzRegister } : { 'Research papers (OpenAlex)': openalex }),
};

const findings = {};
const checked = [];
const ms = {};
// The live page: opens now, ticks off each source as it answers.
const countOf = (value) => (value == null ? 0 : Array.isArray(value) ? value.length : value.accounts ? value.accounts.length : value.matches ? value.matches.length : value.filings ? value.total : 1);
const live = Object.keys(jobs).map((n) => ({ name: n, state: 'wait', found: 0 }));
// Falcon's window reads this file and shows the scan while it runs.
const showLive = (stage) => { try { writeProgress({ name, type, sources: live, stage, found: live.reduce((sum, x) => sum + (x.found || 0), 0) }); } catch { /* the sweep goes on */ } };
if (!args.includes('--no-live')) showLive(0);
const settled = await Promise.allSettled(Object.entries(jobs).map(async ([source, job], i) => {
  const t = Date.now();
  try {
    const value = await job();
    Object.assign(live[i], { state: countOf(value) ? 'done' : 'none', found: Math.min(countOf(value), 99) });
    return [source, value];
  } catch (err) { live[i].state = 'error'; throw err; } finally { ms[source] = Date.now() - t; if (!args.includes('--no-live')) showLive(0); }
}));
for (const [i, outcome] of settled.entries()) {
  const source = Object.keys(jobs)[i];
  if (process.env.SCOUT_TIMING) console.error(source, ms[source]);
  if (outcome.status === 'rejected') { checked.push({ source, error: clip(outcome.reason?.message || 'failed', 80) }); continue; }
  const value = outcome.value[1];
  findings[source] = value;
  const found = value == null ? 0 : Array.isArray(value) ? value.length : value.accounts ? value.accounts.length : value.matches ? value.matches.length : value.filings ? value.total : 1;
  checked.push({ source, found });
}
site ||= String(findings.Wikidata?.facts?.['official website'] || '').split(',')[0].replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
if (site) {
  try { findings['Website registration'] = await domain(site); checked.push({ source: 'Website registration (RDAP)', found: 1 }); }
  catch (err) { checked.push({ source: 'Website registration (RDAP)', error: clip(err.message, 80) }); }
}

if (!args.includes('--no-live')) showLive(1);
const result = { ok: true, name, type, hint, aliases, seconds: Math.round((Date.now() - started) / 100) / 10, checked, findings };
try { fs.writeFileSync(path.join(here, 'last-sweep.json'), JSON.stringify({ ...result, at: new Date().toISOString() }, null, 2)); } catch { /* the answer still goes out */ }
done(result);
