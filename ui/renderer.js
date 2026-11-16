const $ = (id) => document.getElementById(id);
const screens = ['loading', 'setup', 'intro', 'main', 'connections'];

function showScreen(name) {
  for (const s of screens) $(`screen-${s}`).hidden = s !== name;
  $('open-connections').hidden = name !== 'main';
  if (name === 'main') $('ask-text').focus();
  if (name === 'connections') refreshConnections();
}

// ---- Connections ----
function note(id, text, kind = '') { $(id).textContent = text; $(id).className = `message ${kind}`; }

async function refreshConnections() {
  try {
    const c = await window.falcon.connections();
    $('tg-state').textContent = c.telegram ? '✓ connected' : '';
    showBriefing(await window.falcon.briefing());
    showCurrentModel();
  } catch { /* leave as is */ }
}

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

// Moves the finished question and answer up into the dimmer history above.
function archiveExchange() {
  if (!$('said').textContent) return;
  for (const [cls, text] of [['said', $('said').textContent], ['reply', $('reply').textContent]]) {
    const line = document.createElement('p');
    line.className = cls;
    line.textContent = text;
    $('history').appendChild(line);
  }
  while ($('history').childElementCount > 40) $('history').firstElementChild.remove();
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

async function sendToFalcon(text) {
  if (!text || busy) return;
  busy = true;
  $('examples').hidden = true;
  $('ask-text').value = '';
  $('ask-send').disabled = true;
  archiveExchange();
  $('said').textContent = text;
  $('reply').textContent = '';
  $('reply').classList.remove('bad', 'waiting');
  setOrb('thinking');
  let answer = '';
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
      onError: fail,
    });
    await reveal.done();
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

// ---- Introduction: who Falcon serves ----
let callMe = 'sir';
const address = () => callMe;
const addressRu = () => ({ sir: 'сэр', madam: 'мадам', boss: 'босс' }[callMe.toLowerCase()] || callMe);

function applyProfile(profile) {
  callMe = profile?.callMe || 'sir';
  $('reply').textContent = `At your service, ${address()}.`;
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
const approvalQueue = [];
let currentApproval = null;

function nextApproval() {
  currentApproval = approvalQueue.shift() || null;
  $('approval').hidden = !currentApproval;
  if (currentApproval) {
    $('approval-text').textContent = currentApproval.summary;
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
if (query.get('preview') === 'models') {
  const sample = { ok: true, provider: 'OpenAI', checked: true, voice: true, models: [
    { model: 'a', label: 'GPT-6.1 Terra', note: 'Recommended. Passed every safety and quality check.', tested: true },
    { model: 'b', label: 'GPT-6.1 Sol', note: 'More capable, about twice the price. Not yet put through the checks.' },
    { model: 'c', label: 'GPT-6 Luna', note: 'Cheapest. Less careful: in testing it typed a password it was told not to.' }] };
  $('setup-key').value = 'sk-proj-preview-preview-preview';
  setupKey.show(sample);
  panelKey.show({ ...sample, provider: 'Anthropic', voice: false });
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
  $('said').textContent = 'Open my quarterly review presentation and go to slide 5.';
  $('reply').textContent = 'Slide five of the Quarterly Review is up, sir.';
}
