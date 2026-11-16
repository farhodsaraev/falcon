const $ = (id) => document.getElementById(id);
const screens = ['loading', 'setup', 'intro', 'main', 'connections'];

function showScreen(name) {
  for (const s of screens) $(`screen-${s}`).hidden = s !== name;
  $('open-connections').hidden = name !== 'main';
  $('status-dots').hidden = name !== 'main';
  if (name === 'main') { $('ask-text').focus(); refreshVoice(); refreshDots(); }
  if (name !== 'main' && window.falconVoice.active()) window.falconVoice.stop();
  if (name === 'connections') refreshConnections();
}

// ---- Connections ----
function note(id, text, kind = '') { $(id).textContent = text; $(id).className = `message ${kind}`; }

// Small dots in the title bar: lit when voice, Telegram and Chrome are ready.
function setDot(id, on, label) {
  $(id).classList.toggle('on', Boolean(on));
  $(id).title = label;
}
let chromeKnown = false;
try { chromeKnown = localStorage.getItem('falcon-chrome') === 'yes'; } catch { /* storage unavailable */ }
async function refreshDots() {
  setDot('dot-chrome', chromeKnown, chromeKnown ? 'Your Chrome: connected when last checked' : 'Your Chrome: not connected');
  try {
    const c = await window.falcon.connections();
    setDot('dot-telegram', c.telegram, c.telegram ? 'Telegram: connected' : 'Telegram: not connected');
    $('tg-state').textContent = c.telegram ? '✓ connected' : '';
  } catch { /* leave as is */ }
}

async function refreshConnections() {
  showCurrentModel();
  $('about-callme').textContent = callMe;
  $('voice-state').textContent = voiceReady ? '✓ ready' : '';
  $('voice-text').textContent = voiceReady
    ? 'Falcon can speak and listen. Press the microphone in his window and just talk; you can interrupt him.'
    : 'Falcon speaks and listens through OpenAI’s live voice service. It needs an OpenAI key, saved above.';
  $('chrome-state').textContent = chromeKnown ? '✓ connected' : '';
  await refreshDots();
  try { showBriefing(await window.falcon.briefing()); } catch { /* leave as is */ }
}

// Settings are split into four tabs.
function showTab(name) {
  for (const tab of document.querySelectorAll('.tab')) {
    const on = tab.dataset.tab === name;
    tab.classList.toggle('on', on);
    tab.setAttribute('aria-selected', String(on));
  }
  for (const body of document.querySelectorAll('.tab-body')) body.hidden = body.dataset.tab !== name;
}
for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => showTab(tab.dataset.tab));
$('about-intro').addEventListener('click', () => showScreen('intro'));

// Shows a spinner in the pressed button until the job is finished.
async function withButton(button, work) {
  button.disabled = true;
  button.classList.add('busy');
  button.setAttribute('aria-busy', 'true');
  try { await work(); } finally {
    button.disabled = false;
    button.classList.remove('busy');
    button.removeAttribute('aria-busy');
  }
}

$('open-connections').addEventListener('click', () => showScreen('connections'));
$('connections-back').addEventListener('click', () => showScreen('main'));

// ---- Recognising a pasted key and choosing the model ----
// A key tells whose it is (OpenAI, Anthropic, OpenRouter) but not which model, so the user picks one.
function keyHelper(inputId, kindId, modelsId) {
  let timer = null;
  let latest = 0;
  const clear = () => { $(modelsId).hidden = true; $(modelsId).replaceChildren(); };
  async function inspect() {
    const key = $(inputId).value.trim();
    const mine = ++latest;
    if (key.length < 20) { clear(); return note(kindId, ''); }
    note(kindId, 'Looking at the key', 'working');
    let info;
    try { info = await window.falcon.inspectKey(key); } catch { info = { ok: false, error: 'Falcon could not be reached.' }; }
    if (mine !== latest) return;             // a newer paste has replaced this one
    show(info);
  }
  function show(info) {
    if (!info.ok) { clear(); return note(kindId, info.error, 'bad'); }
    note(kindId, `${info.provider} key recognised${info.checked ? ' and accepted' : ''}. ${info.voice ? 'It covers thinking and voice.' : 'It covers thinking; voice needs an OpenAI key.'} Choose the model:`, 'ok');
    $(modelsId).replaceChildren(...info.models.map((m, i) => {
      const option = document.createElement('label');
      option.className = 'model-option';
      const radio = Object.assign(document.createElement('input'), { type: 'radio', name: modelsId, value: m.model, checked: i === 0 });
      const text = document.createElement('span');
      const title = document.createElement('b');
      title.textContent = m.label;
      text.append(title);
      if (m.tested) { const badge = document.createElement('em'); badge.textContent = 'tested'; text.append(badge); }
      const about = document.createElement('small');
      about.textContent = m.note;
      text.append(about);
      option.append(radio, text);
      return option;
    }));
    $(modelsId).hidden = false;
  }
  $(inputId).addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(inspect, 500); });
  return {
    model: () => document.querySelector(`#${modelsId} input:checked`)?.value || '',
    reset: () => { latest++; clear(); note(kindId, ''); },
    show,
  };
}
const setupKey = keyHelper('setup-key', 'setup-key-kind', 'setup-models');
const panelKey = keyHelper('key-value', 'key-kind', 'key-models');

async function showCurrentModel() {
  try { $('model-now').textContent = (await window.falcon.currentModel()).label || 'the default model'; }
  catch { $('model-now').textContent = 'the default model'; }
}

$('key-save').addEventListener('click', () => withButton($('key-save'), async () => {
  if (!$('key-value').value.trim()) return note('key-message', 'Paste the key first.', 'bad');
  note('key-message', 'Saving, this can take half a minute', 'working');
  try {
    const r = await window.falcon.saveKey($('key-value').value, panelKey.model());
    if (!r.ok) return note('key-message', r.error, 'bad');
    $('key-value').value = '';
    panelKey.reset();
    note('key-message', r.thinking ? `Saved. Falcon now thinks with ${r.thinking}, on your ${r.provider} key.` : `Saved. Falcon can now use your ${r.provider} key.`, 'ok');
    showCurrentModel();
    await refreshVoice();
    refreshConnections();
  } catch { note('key-message', 'Falcon could not be reached. Please try again.', 'bad'); }
}));

$('tg-connect').addEventListener('click', () => withButton($('tg-connect'), async () => {
  note('tg-message', 'Connecting to Telegram, this can take half a minute', 'working');
  try {
    const r = await window.falcon.telegramConnect($('tg-token').value);
    if (!r.ok) return note('tg-message', r.error, 'bad');
    $('tg-token').value = '';
    $('tg-state').textContent = '✓ connected';
    note('tg-message', 'Connected. Now send your bot a message and type the code it replies with.', 'ok');
  } catch { note('tg-message', 'Falcon could not be reached. Please try again.', 'bad'); }
}));

$('tg-pair').addEventListener('click', () => withButton($('tg-pair'), async () => {
  note('tg-message', 'Checking the code', 'working');
  try {
    const r = await window.falcon.telegramPair($('tg-code').value);
    if (!r.ok) return note('tg-message', r.error, 'bad');
    $('tg-code').value = '';
    note('tg-message', 'Done. Falcon now answers you in Telegram.', 'ok');
  } catch { note('tg-message', 'Falcon could not be reached. Please try again.', 'bad'); }
}));

$('chrome-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText('chrome://inspect/#remote-debugging'); note('chrome-message', 'Copied. Paste it into Chrome’s address bar.', 'ok'); }
  catch { note('chrome-message', 'Type it into Chrome’s address bar: chrome://inspect/#remote-debugging'); }
});

$('chrome-test').addEventListener('click', () => withButton($('chrome-test'), async () => {
  note('chrome-message', 'Asking Chrome. Click Allow if it asks', 'working');
  try {
    const r = await window.falcon.chromeTest();
    $('chrome-state').textContent = r.ok ? '✓ connected' : '';
    chromeKnown = r.ok;
    try { localStorage.setItem('falcon-chrome', r.ok ? 'yes' : 'no'); } catch { /* storage unavailable */ }
    refreshDots();
    note('chrome-message', r.ok ? 'Connected. Falcon can now use your Chrome when you ask him to.'
      : 'Not connected yet. Check that remote debugging is switched on and that you clicked Allow.', r.ok ? 'ok' : 'bad');
  } catch { note('chrome-message', 'Falcon could not be reached. Please try again.', 'bad'); }
}));

function setMessage(text, kind = '') {
  $('setup-message').textContent = text;
  $('setup-message').className = `message ${kind}`;
}

const setOrb = (state) => { $('orb').dataset.state = state; };

// ---- First launch ----
$('setup-start').addEventListener('click', async () => {
  const key = $('setup-key').value.trim();
  if (!key) return setMessage('Paste your AI key first.', 'bad');
  if (!$('setup-accept').checked) return setMessage('Please tick the box to continue.', 'bad');
  // Setup takes a few minutes: spin the button and the orb, and show each step as it happens.
  const smallOrb = $('screen-setup').querySelector('.orb');
  smallOrb.dataset.state = 'thinking';
  await withButton($('setup-start'), async () => {
    setMessage('Starting', 'working');
    try {
      const result = await window.falcon.setup(key, true, setupKey.model());
      if (result.ok) { $('setup-key').value = ''; return enterFalcon(); }
      setMessage(result.error || 'Something went wrong.', 'bad');
    } catch {
      setMessage('Setup was interrupted. Please try again.', 'bad');
    }
  });
  smallOrb.dataset.state = 'idle';
});

// ---- Talking to Falcon ----
let busy = false;

const scrollTalk = () => { $('talk').scrollTop = $('talk').scrollHeight; };

// ---- Action cards: a small card for each thing Falcon did ----
const ICONS = {
  slides: 'M4 5h16v11H4z M9 20h6 M12 16v4',
  file: 'M7 3h7l4 4v14H7z M14 3v4h4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M16.5 16.5 21 21',
  web: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18',
  screen: 'M3 5h18v12H3z M8 21h8 M12 17v4',
  mail: 'M3 6h18v12H3z M3 7l9 6 9-6',
  calendar: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
  memory: 'M6 4h12v16l-6-4-6 4z',
  weather: 'M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 11a3.5 3.5 0 0 0 1 7z',
  done: 'M5 12.5 10 17.5 19 7',
};
function iconFor(text) {
  const t = text.toLowerCase();
  if (/slide|presentation|deck|keynote|powerpoint|слайд|презентац/.test(t)) return 'slides';
  if (/screen|экран/.test(t)) return 'screen';
  if (/mail|inbox|message|почт|письм/.test(t)) return 'mail';
  if (/calendar|meeting|event|reminder|календар|встреч/.test(t)) return 'calendar';
  if (/weather|forecast|погод/.test(t)) return 'weather';
  if (/remember|noted|saved to memory|recall|запомн/.test(t)) return 'memory';
  if (/search|found|looked for|find|наш[её]л|поиск|искал/.test(t)) return 'search';
  if (/file|folder|document|pdf|invoice|файл|папк|документ/.test(t)) return 'file';
  if (/site|web|page|browser|opened .*\.|read .*(news|headline|article|wikipedia)|visited|сайт|страниц|браузер|bbc|google/.test(t)) return 'web';
  return 'done';
}
function actionCards(items) {
  return items.map((text) => {
    const card = document.createElement('span');
    card.className = 'action';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICONS[iconFor(text)]);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    const label = document.createElement('span');
    label.textContent = text;
    card.append(svg, label);
    return card;
  });
}
function showActions(items) { $('actions').replaceChildren(...actionCards(items)); scrollTalk(); }

// Moves the finished question, answer and cards up into the dimmer history above.
function archiveExchange() {
  if (!$('said').textContent) return;
  for (const [cls, text] of [['said', $('said').textContent], ['reply', $('reply').textContent]]) {
    const line = document.createElement('p');
    line.className = cls;
    line.textContent = text;
    $('history').appendChild(line);
  }
  if ($('actions').childElementCount) {
    const cards = document.createElement('div');
    cards.className = 'actions';
    cards.append(...$('actions').children);
    $('history').appendChild(cards);
  }
  $('actions').replaceChildren();
  while ($('history').childElementCount > 60) $('history').firstElementChild.remove();
  scrollTalk();
}

// Falcon is meant to speak in plain sentences. If formatting symbols slip through anyway
// (bold, bullets, headings, code marks), take them out so the window never shows them.
function plainSpeech(text) {
  return text
    .replace(/\r/g, '')
    .replace(/`{3}[a-z]*\n?/gi, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/\n{2,}/g, '\n')
    .replace(/([^.!?:;,\n])\n/g, '$1. ')
    .replace(/\n/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

// The answer usually arrives in one piece after the wait. Reveal it a few letters at a time,
// the way speech arrives, instead of dropping a block of text.
function createReveal(element) {
  let target = '';
  let shown = 0;
  let timer = null;
  let finish = null;
  const instant = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tick = () => {
    const behind = target.length - shown;
    shown = instant ? target.length : Math.min(target.length, shown + Math.max(2, Math.ceil(behind / 30)));
    element.textContent = target.slice(0, shown);
    scrollTalk();
    if (shown >= target.length) { clearInterval(timer); timer = null; if (finish) { finish(); finish = null; } }
  };
  return {
    // The full text so far; it only ever grows, so letters already shown stay put.
    set(text) { target = text; if (!timer) timer = setInterval(tick, 24); },
    done() { return new Promise((resolve) => { if (!timer) return resolve(); finish = resolve; }); },
  };
}

// `shown` is what appears as the user's line; pass '' for a request the window makes on its own.
async function sendToFalcon(text, shown = text) {
  if (!text || busy) return;
  busy = true;
  $('examples').hidden = true;
  $('ask-text').value = '';
  $('ask-send').disabled = true;
  archiveExchange();
  $('said').textContent = shown;
  $('reply').textContent = '';
  $('reply').classList.remove('bad', 'waiting');
  setOrb('thinking');
  let answer = '';
  let cards = [];
  const reveal = createReveal($('reply'));
  // If the answer takes a moment, say so instead of sitting silent.
  const russian = /[а-яё]/i.test(text);
  const patience = setTimeout(() => {
    if (!answer) {
      $('reply').textContent = russian ? `Одну минуту, ${addressRu()}.` : `One moment, ${address()}.`;
      $('reply').classList.add('waiting');
    }
  }, 2500);
  const clearWaiting = () => {
    clearTimeout(patience);
    if ($('reply').classList.contains('waiting')) { $('reply').classList.remove('waiting'); $('reply').textContent = ''; }
  };
  const fail = (message) => { clearWaiting(); answer = message; $('reply').textContent = message; $('reply').classList.add('bad'); };
  try {
    await window.falcon.chat(text, {
      onDelta: (piece) => { clearWaiting(); answer += piece; reveal.set(plainSpeech(answer)); setOrb('speaking'); },
      onActions: (items) => { cards = items; },
      onError: fail,
    });
    await reveal.done();
    if (cards.length) showActions(cards);
  } catch {
    fail(`I have lost my connection, ${address()}. Please try again in a moment.`);
  }
  clearWaiting();
  if (!answer) $('reply').textContent = `Done, ${address()}.`;
  setOrb('idle');
  busy = false;
  $('ask-send').disabled = false;
  $('ask-text').focus();
}

$('ask').addEventListener('submit', (event) => { event.preventDefault(); sendToFalcon($('ask-text').value.trim()); });
for (const chip of document.querySelectorAll('[data-ask]')) {
  chip.addEventListener('click', () => sendToFalcon(chip.dataset.ask));
}

// ---- Voice ----
// The microphone button starts and ends a live conversation. While it is on, the orb shows whether
// Falcon is listening, working or speaking, and what is said appears as text too.
let voiceReady = false;
async function refreshVoice() {
  try { voiceReady = (await window.falcon.voiceStatus()).available; } catch { voiceReady = false; }
  $('mic').classList.toggle('needs-key', !voiceReady);
  $('mic').title = voiceReady ? 'Talk to Falcon' : 'Voice needs an OpenAI key. Add one in Settings.';
  setDot('dot-voice', voiceReady, voiceReady ? 'Voice: ready' : 'Voice: needs an OpenAI key');
}
function voiceNote(text, kind = '') { $('voice-note').textContent = text; $('voice-note').className = `hint ${kind}`; }

window.falconVoice.on('state', (state) => {
  const on = state !== 'off';
  $('mic').classList.toggle('on', on);
  $('mic').classList.toggle('busy', state === 'connecting');
  $('mic').setAttribute('aria-pressed', String(on));
  $('orb').classList.toggle('live', on);
  if (!on) $('orb').style.setProperty('--level', '0');
  setOrb({ off: 'idle', connecting: 'thinking', listening: 'listening', thinking: 'thinking', speaking: 'speaking' }[state] || 'idle');
  voiceNote({ connecting: 'Connecting the voice…', listening: 'Listening. Just speak; press the microphone again to end.', thinking: 'One moment…', speaking: '', off: '' }[state] ?? '');
});
window.falconVoice.on('heard', (text) => { archiveExchange(); $('examples').hidden = true; $('said').textContent = text; $('reply').textContent = ''; });
window.falconVoice.on('said', (text) => { $('reply').classList.remove('bad', 'waiting'); $('reply').textContent = plainSpeech(text); scrollTalk(); });
window.falconVoice.on('error', (message) => voiceNote(message, 'bad'));
window.falconVoice.on('actions', (items) => showActions(items));
// The orb follows the real loudness: the user's voice while listening, Falcon's while he speaks.
window.falconVoice.on('level', (level) => { $('orb').style.setProperty('--level', level.toFixed(3)); });

$('mic').addEventListener('click', () => {
  if (window.falconVoice.active()) return window.falconVoice.stop();
  if (!voiceReady) return voiceNote('Voice needs an OpenAI key. Add one in Settings (the gear icon), then try again.', 'bad');
  if (busy) return voiceNote('One moment, I am still working on the last request.');
  $('examples').hidden = true;
  window.falconVoice.start();
});

// ---- Introduction: who Falcon serves ----
let callMe = 'sir';
const address = () => callMe;
const addressRu = () => ({ sir: 'сэр', madam: 'мадам', boss: 'босс' }[callMe.toLowerCase()] || callMe);

function greeting() {
  const hour = new Date().getHours();
  const part = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${address()}. At your service.`;
}
function applyProfile(profile) {
  callMe = profile?.callMe || 'sir';
  if (!$('said').textContent) $('reply').textContent = greeting();
  $('about-callme').textContent = callMe;
}

for (const chip of document.querySelectorAll('[data-call]')) {
  chip.addEventListener('click', () => {
    document.querySelectorAll('[data-call]').forEach((c) => c.classList.toggle('on', c === chip));
  });
}

async function saveIntro(skipped) {
  const name = $('intro-name').value.trim();
  const choice = document.querySelector('[data-call].on')?.dataset.call || 'sir';
  if (!skipped && choice === 'name' && !name) return note('intro-message', 'Tell me your name first, or choose another form of address.', 'bad');
  await withButton($(skipped ? 'intro-skip' : 'intro-save'), async () => {
    try {
      const saved = await window.falcon.saveProfile(skipped ? { skipped: true }
        : { name, callMe: choice === 'name' ? name : choice, about: $('intro-about').value });
      applyProfile(saved);
      showScreen('main');
      // Let him show that he took it in: his first words refer to what he was just told.
      if (!skipped) {
        sendToFalcon('I have just introduced myself to you in your window; what I told you is in your notes about me. ' +
          'Welcome me in two or three sentences: address me the way I chose, show in your own words that you took in ' +
          'what I mostly do on this computer, and offer one specific thing you could do for me right now that fits that work. ' +
          'Do not look anything up and do not act yet.', '');
      }
    } catch { note('intro-message', 'That could not be saved. Please try again.', 'bad'); }
  });
}
$('intro-save').addEventListener('click', () => saveIntro(false));
$('intro-skip').addEventListener('click', () => saveIntro(true));

// Once Falcon is awake: introduce yourself the first time, otherwise go straight to him.
async function enterFalcon() {
  try {
    const profile = await window.falcon.profile();
    if (!profile.done) return showScreen('intro');
    applyProfile(profile);
  } catch { /* no profile: carry on with the defaults */ }
  showScreen('main');
}

// ---- Approval prompt ----
// Says in plain words what a command would do, with the thing it touches in bold.
// The exact command stays one click away for anyone who wants to read it.
function describeCommand(command) {
  const c = String(command || '');
  const last = (re) => { const m = c.match(re); return m ? m[m.length - 1].replace(/^["']|["']$/g, '') : ''; };
  const leaf = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p;
  const target = last(/"[^"]+"|'[^']+'|[A-Za-z]:\\[^\s"']+|\/[^\s"']+\.[a-z0-9]{1,6}/gi);
  const host = (c.match(/https?:\/\/([^\s/"']+)/i) || [])[1] || '';
  const rules = [
    [/\b(remove-item|del|erase|rmdir|rd|rm)\b/i, 'delete', target && leaf(target)],
    [/\b(move-item|move|mv|rename-item|ren)\b/i, 'move or rename', target && leaf(target)],
    [/\b(copy-item|copy|cp|xcopy|robocopy)\b/i, 'copy', target && leaf(target)],
    [/\b(new-item|mkdir|md|touch)\b/i, 'create', target && leaf(target)],
    [/\b(winget|choco|scoop|brew|apt|npm|pip|pip3|msiexec)\b.*\b(install|add)\b/i, 'install software', ''],
    [/\b(curl|wget|invoke-webrequest|invoke-restmethod|iwr|irm)\b/i, 'contact a website', host],
    [/\b(shutdown|restart-computer|stop-computer|reboot)\b/i, 'shut down or restart this computer', ''],
    [/\b(stop-process|taskkill|kill|pkill)\b/i, 'close a running program', ''],
    [/\b(reg|set-itemproperty|defaults write|netsh|sc|set-service)\b/i, 'change a system setting', ''],
    [/\b(start-process|start|open|explorer)\b/i, 'open', target && leaf(target)],
    [/\b(ipconfig|ifconfig|whoami|hostname|systeminfo|get-process|tasklist|ps|netstat|ping)\b/i, 'read information about this computer', ''],
  ];
  const [, verb, what] = rules.find(([re]) => re.test(c)) || [null, 'run a command on this computer', ''];
  const parts = [document.createTextNode(`Falcon wants to ${verb}`)];
  if (what) { const b = document.createElement('b'); b.textContent = what; parts.push(document.createTextNode(': '), b); }
  parts.push(document.createTextNode('.'));
  return parts;
}
const approvalQueue = [];
let currentApproval = null;

function nextApproval() {
  currentApproval = approvalQueue.shift() || null;
  $('approval').hidden = !currentApproval;
  if (currentApproval) {
    $('approval-title').textContent = `Shall I proceed, ${address()}?`;
    $('approval-plain').replaceChildren(...describeCommand(currentApproval.summary));
    $('approval-text').textContent = currentApproval.summary;
    document.querySelector('.card-details').open = false;
    $('deny').focus();
  }
}

function answerApproval(decision) {
  if (!currentApproval) return;
  window.falcon.answerApproval(currentApproval.id, decision).catch(() => {});
  nextApproval();
}

$('allow').addEventListener('click', () => answerApproval('allow-once'));
$('deny').addEventListener('click', () => answerApproval('deny'));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') answerApproval('deny'); });

window.falcon.listen({
  approval: (request) => { approvalQueue.push(request); if (!currentApproval) nextApproval(); },
  setup: (progress) => setMessage(progress.text.replace(/…$/, ''), 'working'),
});

// ---- Start ----
// "?screen=" and "?preview=allow" exist only so the design can be checked.
const query = new URLSearchParams(location.search);
if (screens.includes(query.get('screen'))) {
  showScreen(query.get('screen'));
} else {
  const wake = (attempt = 0) => window.falcon.state()
    .then((s) => {
      if (s.ready) return enterFalcon();
      if (!s.configured) return showScreen('setup');
      // Set up before but still waking (for example right after the PC started): keep trying for a while.
      if (attempt < 20) return setTimeout(() => wake(attempt + 1), 3000);
      $('screen-loading').querySelector('.status').textContent = 'I could not wake up, sir. Please restart the computer.';
    })
    .catch(() => showScreen('setup'));
  wake();
}
if (query.get('preview') === 'allow') {
  approvalQueue.push({ id: 'preview', summary: 'powershell -Command "Remove-Item C:\\Users\\you\\Desktop\\old-report.docx"' });
  nextApproval();
}
if (['listening', 'thinking', 'speaking'].includes(query.get('orb'))) {
  setOrb(query.get('orb'));
  $('orb').classList.add('live');
  $('orb').style.setProperty('--level', '0.7');
}
if (query.get('tab')) showTab(query.get('tab'));
if (query.get('preview') === 'models') {
  const sample = { ok: true, provider: 'OpenAI', checked: true, voice: true, models: [
    { model: 'a', label: 'GPT-6.1 Terra', note: 'Recommended. Passed every safety and quality check.', tested: true },
    { model: 'b', label: 'GPT-6.1 Sol', note: 'More capable, about twice the price. Not yet put through the checks.' },
    { model: 'c', label: 'GPT-6 Luna', note: 'Cheapest. Less careful: in testing it typed a password it was told not to.' }] };
  $('setup-key').value = 'sk-proj-preview-preview-preview';
  setupKey.show(sample);
  panelKey.show({ ...sample, provider: 'Anthropic', voice: false });
}
if (query.get('preview') === 'voice') {
  $('examples').hidden = true;
  $('mic').classList.add('on'); setOrb('listening');
  $('said').textContent = 'Open my quarterly review presentation on slide five.';
  $('reply').textContent = 'Slide five of the Quarterly Review is up, sir.';
  voiceNote('Listening. Just speak; press the microphone again to end.');
}
if (query.get('preview') === 'busy') {
  $('tg-connect').classList.add('busy');
  note('tg-message', 'Connecting to Telegram, this can take half a minute', 'working');
  $('chrome-test').classList.add('busy');
  note('chrome-message', 'Asking Chrome. Click Allow if it asks', 'working');
}
if (query.get('preview') === 'talk') {
  $('said').textContent = 'Good morning, Falcon.';
  $('reply').textContent = 'Good morning, sir. At your service.';
  archiveExchange();
  showActions(['Opened BBC News', 'Read top headline']);
  archiveExchange();
  $('examples').hidden = true;
  $('said').textContent = 'Open my quarterly review presentation and go to slide 5.';
  $('reply').textContent = 'Slide five of the Quarterly Review is up, sir.';
  showActions(['Found Quarterly Review', 'Opened it in PowerPoint', 'Went to slide 5']);
  for (const id of ['dot-voice', 'dot-telegram']) $(id).classList.add('on');
}
