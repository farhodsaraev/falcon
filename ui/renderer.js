const $ = (id) => document.getElementById(id);
const screens = ['loading', 'setup', 'intro', 'main', 'connections'];

function showScreen(name) {
  for (const s of screens) $(`screen-${s}`).hidden = s !== name;
  $('open-connections').hidden = name !== 'main';
  $('status-dots').hidden = name !== 'main';
  $('mind').hidden = name !== 'main';
  $('more').hidden = name !== 'main';
  document.body.classList.toggle('on-main', name === 'main');
  for (const side of document.querySelectorAll('.side')) side.hidden = name !== 'main';
  if (name === 'main') { $('ask-text').focus(); refreshVoice(); refreshDots(); showShortcut(); checkUpdateOnce(); refreshMind(); refreshLearnedCount(); refreshAbilities(); }
  if (name !== 'main' && voice && voice.active()) voice.stop();
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

// ---- Settings > AI key: which AI does what (everyday work, voice, coding) ----
async function refreshAiJobs() {
  let jobs;
  try { jobs = await window.falcon.aiJobs(); } catch { return; }
  $('job-everyday').textContent = jobs.everyday.label ? `${jobs.everyday.label}${jobs.everyday.provider ? `, through ${jobs.everyday.provider}` : ''}` : 'Not set up';
  let live = true;
  try { live = localStorage.getItem('falcon-live-voice') !== 'off'; } catch { /* default */ }
  $('job-voice').textContent = jobs.voice.live && live ? 'OpenAI live voice' : jobs.voice.live ? 'Built-in voice (free); live voice is switched off below' : 'Built-in voice (free). An OpenAI key gives the live voice';
  const now = jobs.coding.current;
  $('job-coding').textContent = now ? `${now.label}, through ${now.tool}` : 'Needs an OpenAI or OpenRouter key';
  const box = $('job-coding-choice');
  box.hidden = !jobs.coding.options.length;
  box.replaceChildren(...jobs.coding.options.map((m) => {
    const option = document.createElement('label');
    option.className = 'model-option';
    const radio = Object.assign(document.createElement('input'), { type: 'radio', name: 'job-coding', checked: Boolean(now && now.provider === m.provider && now.model === m.model) });
    radio.addEventListener('change', async () => {
      note('job-message', 'Saving', 'working');
      try {
        const r = await window.falcon.setCodingAi(m.provider, m.model);
        if (!r.ok) return note('job-message', r.error, 'bad');
        note('job-message', `Coding and repairs will use ${r.coding.label}. ${jobs.coding.price}`, 'ok');
        refreshAiJobs();
      } catch { note('job-message', 'Falcon could not be reached. Please try again.', 'bad'); }
    });
    const text = document.createElement('span');
    const title = document.createElement('b');
    title.textContent = `${m.label}, ${m.providerName} key`;
    text.append(title);
    if (m.tested) { const badge = document.createElement('em'); badge.textContent = 'tested'; text.append(badge); }
    const about = document.createElement('small');
    about.textContent = `${m.note} Done by ${m.tool}.`;
    text.append(about);
    option.append(radio, text);
    return option;
  }));
}

async function refreshConnections() {
  showCurrentModel();
  refreshAiJobs();
  $('about-callme').textContent = callMe;
  showVoiceSetting();
  $('chrome-state').textContent = chromeKnown ? '✓ connected' : '';
  refreshUninstall();
  refreshUpdate();
  window.falcon.about().then((a) => { $('about-version').textContent = `${a.version} (build ${a.build})`; }).catch(() => {});
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
  if (name === 'learned') refreshLearned();
}
for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => showTab(tab.dataset.tab));

// ---- What Falcon learned (Settings > Learned) ----
// Asking the engine takes a few seconds, so the list is read only when this tab is opened.
const learnedTitle = (name) => name.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
const learnedDate = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '');
function learnedRow(item, removed) {
  const row = document.createElement('li');
  const text = document.createElement('div');
  const title = document.createElement('b');
  title.textContent = learnedTitle(item.name);
  text.append(title);
  const about = document.createElement('small');
  about.textContent = removed ? (item.when ? `Removed on ${learnedDate(item.when)}` : 'Removed') : [item.about, item.when ? `Learned or changed on ${learnedDate(item.when)}.` : ''].filter(Boolean).join(' ');
  text.append(about);
  const button = document.createElement('button');
  button.className = 'ghost small-btn';
  button.textContent = removed ? 'Bring back' : 'Remove';
  button.setAttribute('aria-label', `${button.textContent}: ${learnedTitle(item.name)}`);
  button.addEventListener('click', () => withButton(button, async () => {
    try {
      const r = removed ? await window.falcon.restoreLearned(item.name) : await window.falcon.removeLearned(item.name);
      if (!r.ok) return note('learned-message', r.error, 'bad');
      note('learned-message', removed ? `${learnedTitle(item.name)} is back.` : `${learnedTitle(item.name)} is removed. You can bring it back below.`, 'ok');
      refreshLearned(false);
    } catch { note('learned-message', 'Falcon could not be reached. Please try again.', 'bad'); }
  }));
  // Its programs: each runs only after the user allows it, so he can read it first.
  for (const program of removed ? [] : item.programs || []) {
    const box = document.createElement('details');
    box.className = 'program';
    const head = document.createElement('summary');
    head.textContent = program.allowed ? `Program ${program.file}: allowed` : `Program ${program.file}: waiting for your yes`;
    const code = document.createElement('pre');
    code.textContent = program.text || '';
    box.append(head, code);
    if (!program.allowed) {
      box.open = true;
      const allow = document.createElement('button');
      allow.className = 'primary small-btn';
      allow.textContent = 'Allow this program';
      allow.addEventListener('click', () => withButton(allow, async () => {
        try {
          const r = await window.falcon.allowProgram(item.name, program.file);
          if (!r.ok) return note('learned-message', r.error, 'bad');
          note('learned-message', `Allowed. Falcon can now run ${program.file}.`, 'ok');
          refreshLearned(false);
        } catch { note('learned-message', 'Falcon could not be reached. Please try again.', 'bad'); }
      }));
      box.append(allow);
    }
    text.append(box);
  }
  row.append(text, button);
  return row;
}
let learnedReading = 0;
async function refreshLearned(clearMessage = true) {
  const mine = ++learnedReading;
  if (clearMessage) note('learned-message', 'Looking', 'working');
  let r;
  try { r = await window.falcon.learned(); } catch { r = { ok: false, error: 'Falcon could not be reached.' }; }
  if (mine !== learnedReading) return;
  if (!r.ok) return note('learned-message', r.error, 'bad');
  if (clearMessage) note('learned-message', '');
  $('learned-list').replaceChildren(...r.learned.map((item) => learnedRow(item, false)));
  $('removed-list').replaceChildren(...r.removed.map((item) => learnedRow(item, true)));
  $('learned-empty').hidden = r.learned.length > 0;
  $('removed-title').hidden = r.removed.length === 0;
  $('learned-hint').hidden = !r.learned.some((item) => (item.programs || []).some((p) => !p.allowed));
}
$('learned-hint').addEventListener('click', () => { showScreen('connections'); showTab('learned'); });
$('about-intro').addEventListener('click', () => showScreen('intro'));

// ---- Update: one button for Falcon and the engine he runs on ----
async function refreshUpdate() {
  let info;
  try { info = await window.falcon.updateStatus(); } catch { $('update-state').textContent = ''; return null; }
  const offer = (info.falconNewer && info.canUpdateFalcon) || info.engineNewer;
  $('update-go').hidden = !offer;
  $('update-state').textContent = info.falconNewer && info.canUpdateFalcon ? `A newer Falcon is ready: version ${info.latest}.`
    : info.engineNewer ? 'An improvement to the engine I run on is ready.'
      : info.falconNewer ? `Version ${info.latest} is published. This copy runs from its project folder and follows that folder.`
        : info.latest ? 'Falcon is up to date.' : 'I could not check for a newer Falcon just now.';
  return offer;
}
$('update-go').addEventListener('click', () => withButton($('update-go'), async () => {
  note('update-message', 'Starting the update. Please keep this window open', 'working');
  try {
    const r = await window.falcon.update();
    if (!r.ok) return note('update-message', [r.error, r.detail].filter(Boolean).join('\n'), 'bad');
    $('update-hint').hidden = true;
    if (r.restarting) return note('update-message', 'Falcon will close and open again by himself in a moment.', 'ok');
    note('update-message', 'Done. Falcon is up to date.', 'ok');
    refreshUpdate();
  } catch { note('update-message', 'The update was interrupted. Open Falcon again and press Update once more.', 'bad'); }
}));
$('update-hint').addEventListener('click', () => { showScreen('connections'); showTab('about'); });
let updateChecked = false;
function checkUpdateOnce() {
  if (updateChecked) return;
  updateChecked = true;
  refreshUpdate().then((offer) => { $('update-hint').hidden = !offer; }).catch(() => {});
}

// ---- Uninstall from Settings > About ----
async function refreshUninstall() {
  try { $('uninstall-box').hidden = !(await window.falcon.uninstallStatus()).available; } catch { $('uninstall-box').hidden = true; }
}
$('uninstall-open').addEventListener('click', () => { $('uninstall-confirm').hidden = false; $('uninstall-open').hidden = true; $('uninstall-cancel').focus(); });
$('uninstall-cancel').addEventListener('click', () => { $('uninstall-confirm').hidden = true; $('uninstall-open').hidden = false; $('uninstall-data').checked = false; });
$('uninstall-go').addEventListener('click', () => withButton($('uninstall-go'), async () => {
  try {
    const r = await window.falcon.uninstall($('uninstall-data').checked);
    if (!r.ok) return note('uninstall-message', r.error, 'bad');
    $('uninstall-confirm').hidden = true;
    note('uninstall-message', `Falcon is being removed. Goodbye, ${address()}.`, 'ok');
  } catch { note('uninstall-message', 'Falcon could not be reached. Please try again.', 'bad'); }
}));

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
// On the first screen the tested model is simply used (`choose` false): a newcomer should not have to
// pick an AI model. The choice is offered later, in Settings.
function keyHelper(inputId, kindId, modelsId, choose = true) {
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
    const covers = info.voice ? 'It covers thinking and voice.' : 'It covers thinking; the live voice needs an OpenAI key.';
    if (!choose) return note(kindId, `${info.provider} key recognised${info.checked ? ' and accepted' : ''}. ${covers}`, 'ok');
    note(kindId, `${info.provider} key recognised${info.checked ? ' and accepted' : ''}. ${covers} Choose the model:`, 'ok');
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
const setupKey = keyHelper('setup-key', 'setup-key-kind', 'setup-models', false);
const panelKey = keyHelper('key-value', 'key-kind', 'key-models');

async function showCurrentModel() {
  mindAsked = 0;
  await refreshMind();
  $('model-now').textContent = mindName || 'the default model';
}

// ---- The AI Falcon thinks with, shown in the title bar and under each answer ----
// Asking the engine takes a few seconds, so the last name seen is shown at once and then checked.
let mindName = '';
try { mindName = localStorage.getItem('falcon-mind') || ''; } catch { /* storage unavailable */ }
function showMind() {
  $('mind-name').textContent = mindName || 'AI';
  $('side-mind').textContent = mindName || '…';
}
showMind();
let mindAsked = 0;
async function refreshMind() {
  if (Date.now() - mindAsked < 5000) return;
  mindAsked = Date.now();
  try {
    const label = (await window.falcon.currentModel()).label;
    if (!label) return;
    mindName = label;
    try { localStorage.setItem('falcon-mind', label); } catch { /* storage unavailable */ }
    showMind();
  } catch { /* keep the last name seen */ }
}
$('mind').addEventListener('click', () => { showScreen('connections'); showTab('key'); });

$('key-save').addEventListener('click', () => withButton($('key-save'), async () => {
  if (!$('key-value').value.trim()) return note('key-message', 'Paste the key first.', 'bad');
  note('key-message', 'Saving. With an OpenRouter key this also sets up web search and can take a minute or two', 'working');
  try {
    const r = await window.falcon.saveKey($('key-value').value, panelKey.model());
    if (!r.ok) return note('key-message', r.error, 'bad');
    $('key-value').value = '';
    panelKey.reset();
    refreshSearch();
    note('key-message', r.thinking ? `Saved. Falcon now thinks with ${r.thinking}, on your ${r.provider} key.` : `Saved. Falcon can now use your ${r.provider} key.`, 'ok');
    showCurrentModel(); refreshAiJobs();
    await refreshVoice();
    refreshConnections();
  } catch { note('key-message', 'Falcon could not be reached. Please try again.', 'bad'); }
}));

async function refreshSearch() {
  try {
    const { via } = await window.falcon.searchStatus();
    $('search-state').textContent = via === 'google' ? '✓ on' : '';
    $('web-search-now').textContent = via === 'google' ? 'on, through Google'
      : via === 'openrouter' ? 'on, through your OpenRouter key'
        : via === 'builtin' ? 'on, through your OpenAI key'
          : via === 'free' ? 'on, through a free search service. A Google key below makes it more thorough'
            : 'off. Save an OpenRouter key above, or add a Google key below, to switch it on';
  } catch { /* leave as it was */ }
}
refreshSearch();

$('search-save').addEventListener('click', () => withButton($('search-save'), async () => {
  if (!$('search-key').value.trim()) return note('search-message', 'Paste the key first.', 'bad');
  note('search-message', 'Checking the key with Google and saving it', 'working');
  try {
    const r = await window.falcon.saveSearchKey($('search-key').value);
    if (!r.ok) return note('search-message', r.error, 'bad');
    $('search-key').value = '';
    note('search-message', 'Saved. Falcon now searches Google directly.', 'ok');
    refreshSearch();
  } catch { note('search-message', 'Falcon could not be reached. Please try again.', 'bad'); }
}));

$('tg-connect').addEventListener('click',() => withButton($('tg-connect'), async () => {
  note('tg-message', 'Connecting to Telegram. If Falcon has to restart for it, this can take a few minutes', 'working');
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

// While setup runs: the last few real lines from the installers, and how long it has taken.
const setupLog = {
  lines: [], started: 0, clock: 0, until: 0,
  start() {
    this.lines = []; this.started = Date.now(); this.until = 0;
    $('setup-log-lines').textContent = ''; $('setup-log').hidden = false;
    $('setup-log').scrollIntoView({ block: 'end' });
    clearInterval(this.clock);
    const tick = () => {
      const s = Math.floor((Date.now() - this.started) / 1000);
      const left = this.until ? Math.round((this.until - Date.now()) / 1000) : null;
      const about = left === null ? '' : left > 90 ? `about ${Math.round(left / 60)} minutes left` : left > 30 ? 'about a minute left'
        : left > -20 ? 'almost done' : 'taking a little longer than usual';
      $('setup-log-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} so far${about ? `, ${about}` : ''}. Please keep this window open.`;
    };
    tick(); this.clock = setInterval(tick, 1000);
  },
  eta(seconds) { if (this.started && seconds > 0) this.until = Date.now() + seconds * 1000; },
  add(line) {
    if (!this.started || line === this.lines[this.lines.length - 1]) return;
    this.lines.push(line);
    if (this.lines.length > 5) this.lines.shift();
    $('setup-log-lines').textContent = this.lines.join('\n');
  },
  stop() { clearInterval(this.clock); this.started = 0; $('setup-log').hidden = true; },
  // A step failed: leave what the installer last said on screen, so there is something to go on.
  fail(detail) {
    clearInterval(this.clock); this.started = 0;
    if (!detail) { $('setup-log').hidden = true; return; }
    $('setup-log-lines').textContent = detail;
    $('setup-log-time').textContent = 'Nothing was changed that needs undoing. You can press Start again.';
    $('setup-log').hidden = false;
  },
};

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
    setupLog.start();
    try {
      const result = await window.falcon.setup(key, true, setupKey.model());
      if (result.ok) { $('setup-key').value = ''; return enterFalcon(); }
      setMessage(`${result.error || 'Something went wrong.'} Check the internet connection and the key, then press Start again.`, 'bad');
      setupLog.fail(result.detail);
      return;
    } catch {
      setMessage('Setup was interrupted. Please press Start again.', 'bad');
    }
    setupLog.stop();
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
// ---- Scout: the scan, shown while Falcon researches a person or company ----
const SCOUT_STAGES = ['Sweeping public databases', 'Searching the web and 9 social networks', 'Checking identity and writing the dossier', 'Dossier ready'];
function showScout(p) {
  $('scout').hidden = false;
  $('scout-name').textContent = p.name || '';
  $('scout-stage').textContent = SCOUT_STAGES[Math.min(3, Number(p.stage) || 0)];
  $('scout-found').textContent = String(p.found || 0);
  $('scout-list').replaceChildren(...(p.sources || []).map((src) => {
    const li = document.createElement('li');
    li.className = src.state;
    const dot = document.createElement('i');
    const name = document.createElement('span');
    name.textContent = src.name;
    const what = document.createElement('em');
    what.textContent = src.state === 'wait' ? 'checking' : src.state === 'error' ? 'unavailable' : src.found ? String(src.found) : '–';
    li.append(dot, name, what);
    return li;
  }));
  // One glowing dot on the radar for each finding, spread out like a sunflower.
  const dots = Math.min(24, Number(p.found) || 0);
  $('scout-dots').replaceChildren(...Array.from({ length: dots }, (_, i) => {
    const d = document.createElement('span');
    d.className = 'scout-dot';
    const r = 42 * Math.sqrt((i + 1) / 25);
    d.style.left = `${50 + Math.cos(i * 2.39996) * r}%`;
    d.style.top = `${50 + Math.sin(i * 2.39996) * r}%`;
    d.style.animationDelay = `${(i * 0.37) % 2}s`;
    return d;
  }));
  scrollTalk();
}
function dossierButton(name) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dossier-button';
  button.textContent = 'Open dossier';
  button.title = name;
  button.addEventListener('click', () => showDossier(name));
  return button;
}
// Under a file Falcon found: open it, or show where it is.
function fileButtons(file) {
  return [['Open', false], ['Show in folder', true]].map(([label, reveal]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = reveal ? 'file-button ghost' : 'file-button primary';
    button.textContent = label;
    button.title = file.name;
    button.addEventListener('click', () => window.falcon.openFile(file.path, reveal).catch(() => {}));
    return button;
  });
}
// Shows the dossier inside Falcon's window, over everything, with Close and "Open in browser".
let dossierShown = '';
function showDossier(name) {
  dossierShown = name;
  $('dossier-frame').src = window.falcon.dossierUrl(name);
  $('dossier-view').hidden = false;
  $('dossier-close').focus();
}
$('dossier-close').addEventListener('click', () => { $('dossier-view').hidden = true; $('dossier-frame').src = 'about:blank'; });
$('dossier-browser').addEventListener('click', () => { if (dossierShown) window.falcon.openDossier(dossierShown).catch(() => {}); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('dossier-view').hidden) $('dossier-close').click(); });

function showActions(items) { $('actions').replaceChildren(...actionCards(items)); scrollTalk(); }

// ---- Pictures and videos Falcon makes ----
// While one is being made, a frame holds its place and counts the time. When it is ready the frame is
// filled wherever it has got to by then: under the current answer, or in the history above.
const MAKING = {
  image: ['Painting your picture', 'Рисую изображение'],
  video: ['Making your video. This can take a few minutes', 'Создаю видео. Это может занять несколько минут'],
  audio: ['Composing your music', 'Сочиняю музыку'],
};
function mediaWaiting({ id, kind }, russian) {
  const frame = document.createElement('figure');
  frame.className = `shot waiting ${MAKING[kind] ? kind : 'image'}`;
  frame.dataset.pending = id;
  frame.dataset.since = String(Date.now());
  frame.dataset.label = (MAKING[kind] || MAKING.image)[russian ? 1 : 0];
  const glow = document.createElement('div');
  glow.className = 'shot-frame';
  const caption = document.createElement('figcaption');
  caption.textContent = frame.dataset.label;
  frame.append(glow, caption);
  return frame;
}
// One clock for every frame still waiting.
setInterval(() => {
  for (const frame of document.querySelectorAll('.shot.waiting')) {
    const s = Math.floor((Date.now() - Number(frame.dataset.since)) / 1000);
    frame.querySelector('figcaption').textContent = `${frame.dataset.label}… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}, 1000);
// The finished picture, video or sound, with Open and Show in folder under it.
function mediaFigure(item) {
  const figure = document.createElement('figure');
  figure.className = `shot ${item.kind}`;
  const src = window.falcon.mediaUrl(item.id);
  let view;
  if (item.kind === 'video') view = Object.assign(document.createElement('video'), { src, controls: true, preload: 'metadata', playsInline: true });
  else if (item.kind === 'audio') view = Object.assign(document.createElement('audio'), { src, controls: true, preload: 'metadata' });
  else {
    view = Object.assign(document.createElement('img'), { src, alt: item.name, title: 'Open' });
    view.addEventListener('click', () => window.falcon.openFile(item.path, false).catch(() => {}));
  }
  const buttons = document.createElement('div');
  buttons.className = 'shot-buttons';
  buttons.append(...fileButtons(item));
  figure.append(view, buttons);
  return figure;
}
// Falcon's server says a picture or video is ready (or that it never came).
function showMedia({ pending, text = '', items = [], failed = false }) {
  const frame = pending ? document.querySelector(`.shot.waiting[data-pending="${CSS.escape(pending)}"]`) : null;
  const here = !frame || frame.parentElement === $('media');     // under the current answer, not up in the history
  const russian = frame ? /[а-яё]/i.test(frame.dataset.label) : Boolean(window.falconLastRussian);
  const sorry = russian ? `Не получилось, ${addressRu()}. Попросите меня ещё раз.` : `That did not arrive, ${address()}. Please ask me again.`;
  const words = plainSpeech(text) || (failed ? sorry : '');
  const pieces = items.map(mediaFigure);
  if (words && here && !busy) {
    // His closing words take the place of "I have started it".
    $('reply').classList.remove('bad', 'waiting');
    $('reply').textContent = words;
  } else if (words && pieces.length) {
    const caption = document.createElement('figcaption');
    caption.textContent = words;
    pieces[0].append(caption);
  } else if (words && frame) {
    const line = document.createElement('p');
    line.className = 'reply';
    line.textContent = words;
    pieces.push(line);
  }
  if (frame) frame.replaceWith(...pieces); else $('media').append(...pieces);
  // Bring it into view, and again once it has loaded and has its real height. One that arrives up in
  // the history (he was asked something else meanwhile) is scrolled to, so it is not missed.
  const bring = () => { if (here) scrollTalk(); else if (pieces[0]) pieces[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  bring();
  for (const piece of pieces) {
    const view = piece.querySelector('img, video');
    if (view) view.addEventListener(view.tagName === 'IMG' ? 'load' : 'loadedmetadata', bring, { once: true });
  }
}
function archiveMedia() {
  if (!$('media').childElementCount) return;
  const kept = document.createElement('div');
  kept.className = 'media';
  kept.append(...$('media').children);
  $('history').appendChild(kept);
}

// ---- What Falcon can do, and what he is doing ----
// The skills shown in the wide view. Each lights up while a step uses it; pressing one puts an
// example in the box, so the user learns what to ask without anything being done.
// All of his abilities, so the user sees everything he can ask for. Each roadmap stage adds its own
// (see docs/self-repair-plan.md, section 8B). A tile's line shows its state where that matters.
const SKILLS = [
  ['files', 'Files', 'Find last month\'s invoice.'],
  ['documents', 'Documents', 'Make a Word document with my notes from today\'s meeting.'],
  ['apps', 'Apps', 'Open Excel.'],
  ['screen', 'Screen', 'Show me what is on my screen right now.'],
  ['browser', 'Browser', 'Open bbc.com/news and tell me the top headline.'],
  ['search', 'Web search', 'What is the weather in Tashkent today?'],
  ['mail', 'Mail & calendar', 'What is on my calendar today?'],
  ['slides', 'Slides', 'Open my quarterly review presentation and go to slide 5.'],
  ['pictures', 'Pictures & video', 'Draw a falcon over a city at sunset.'],
  ['scout', 'Scout', 'Scout Uzum and tell me what you find.'],
  ['memory', 'Memory', 'Remember that my accountant is called Ann.'],
  ['controls', 'Music & volume', 'Turn the volume up.'],
  ['telegram', 'Telegram', 'Send me this file on Telegram.'],
  ['briefing', 'Morning briefing', 'Send me my morning briefing now.'],
  ['voice', 'Voice', null],
  // What he learned when asked (self-repair plan, stage 1). Its line shows how many, or one waiting for a yes.
  ['learned', 'Learned', 'Learn how to tell me the official dollar rate.'],
  // Fixing or extending himself in his workshop (stage 3): opens the Workshop window.
  ['repair', 'Repair', null],
];
// What pressing a tile shows besides an example: where to switch the ability on, or how to use it.
const SKILL_HELP = {
  voice: ['Press the microphone next to the box and just talk.', null],
  telegram: ['Talk to me from your phone.', 'connections'],
  briefing: ['Every morning in Telegram: weather, headlines, your reminders.', 'briefing'],
  mail: ['Uses your own Chrome, where you are signed in.', 'connections'],
  search: ['A free Google key makes searches more thorough.', 'key'],
  repair: ['Tell Falcon what to fix or add. He works on a separate copy of himself and asks before anything changes.', null],
};
function openWorkshop() {
  window.open(window.falcon.workshopUrl(), 'falcon-workshop', 'width=900,height=820');
}
for (const [id, name, example] of SKILLS) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'tile';
  tile.dataset.skill = id;
  tile.dataset.idle = 'Ready';
  const title = document.createElement('span');
  title.textContent = name;
  const state = document.createElement('small');
  state.textContent = 'Ready';
  tile.append(title, state);
  tile.addEventListener('click', () => {
    $('skill-try').replaceChildren();
    if (example) {
      const tryIt = document.createElement('button');
      tryIt.type = 'button';
      tryIt.textContent = `“${example}”`;
      tryIt.title = 'Put this in the box';
      tryIt.addEventListener('click', () => { $('ask-text').value = example; $('ask-text').focus(); });
      $('skill-try').append('Try: ', tryIt);
    }
    const [help, settingsTab] = SKILL_HELP[id] || [];
    if (help) $('skill-try').append(example ? ' ' : '', help);
    if (settingsTab) {
      const go = document.createElement('button');
      go.type = 'button';
      go.textContent = 'Settings';
      go.addEventListener('click', () => { showScreen('connections'); showTab(settingsTab); });
      $('skill-try').append(' ', go);
    }
    if (id === 'repair') {
      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = 'Open the workshop';
      open.addEventListener('click', openWorkshop);
      $('skill-try').append(' ', open);
    }
    if (id === 'learned') {
      // What he has learned so far, with Remove and the programs waiting for a yes.
      const see = document.createElement('button');
      see.type = 'button';
      see.textContent = 'See what I learned';
      see.addEventListener('click', () => { showScreen('connections'); showTab('learned'); });
      $('skill-try').append(' ', see);
    }
  });
  $('skill-tiles').append(tile);
}
function lightSkill(skill) {
  for (const tile of document.querySelectorAll('.tile')) {
    const on = Boolean(skill) && tile.dataset.skill === skill;
    tile.classList.toggle('use', on);
    tile.lastChild.textContent = on ? 'In use' : tile.dataset.idle || 'Ready';
  }
}
// The Learned tile's line: how many methods he has learned, or that a program waits for the user's yes.
function showLearnedCount({ count = 0, waiting = 0 } = {}) {
  const tile = document.querySelector('.tile[data-skill="learned"]');
  if (!tile) return;
  tile.dataset.idle = waiting ? `${waiting} to allow` : count ? `${count} learned` : 'Ready';
  tile.classList.toggle('wait', waiting > 0);
  if (!tile.classList.contains('use')) tile.lastChild.textContent = tile.dataset.idle;
  $('learned-hint').hidden = !waiting;
}
function refreshLearnedCount() {
  window.falcon.learnedCount().then(showLearnedCount).catch(() => {});
}
// A tile's line when it is not in use: its state, in one to three words.
function setTileIdle(id, text, wait = false) {
  const tile = document.querySelector(`.tile[data-skill="${id}"]`);
  if (!tile) return;
  tile.dataset.idle = text;
  tile.classList.toggle('wait', wait);
  if (!tile.classList.contains('use')) tile.lastChild.textContent = text;
}
// The states of the abilities that need something set up: read once each time the main screen opens.
async function refreshAbilities() {
  setTileIdle('mail', chromeKnown ? 'Ready' : 'Needs your Chrome', !chromeKnown);
  try {
    setTileIdle('voice', window.falconSpeech?.supported?.() || voiceReady ? (liveVoice && voiceReady ? 'Live voice' : 'Ready') : 'Not available');
  } catch { /* the voice is still being set up */ }
  window.falcon.connections().then((c) => setTileIdle('telegram', c.telegram ? 'Connected' : 'Not set up', !c.telegram)).catch(() => {});
  window.falcon.searchStatus().then(({ via }) => setTileIdle('search', via ? 'Ready' : 'Off', !via)).catch(() => {});
  window.falcon.briefing().then((b) => setTileIdle('briefing', b.enabled ? `Daily at ${b.time}` : 'Off')).catch(() => {});
  window.falcon.repair().then(showRepairState).catch(() => {});
}
// The Repair tile: ready, needs a coding key, working, or waiting for the owner's decision.
function showRepairState({ status, choice } = {}) {
  const phase = status?.phase;
  if (['preparing', 'writing', 'testing', 'reviewing', 'fixing', 'switching'].includes(phase)) setTileIdle('repair', 'Working');
  else if (phase === 'ready') setTileIdle('repair', 'Waiting for you', true);
  else setTileIdle('repair', choice ? 'Ready' : 'Needs a coding key', !choice);
}

// Today's counts, kept on this computer only.
function todayCounts() {
  const day = new Date().toDateString();
  let counts = { day, asks: 0, steps: 0, fast: 0 };
  try { const saved = JSON.parse(localStorage.getItem('falcon-today') || '{}'); if (saved.day === day) counts = { ...counts, ...saved }; } catch { /* start afresh */ }
  return counts;
}
function countToday(change) {
  const counts = todayCounts();
  for (const [k, v] of Object.entries(change)) counts[k] += v;
  try { localStorage.setItem('falcon-today', JSON.stringify(counts)); } catch { /* storage unavailable */ }
  showToday(counts);
}
function showToday(counts = todayCounts()) {
  $('today-asks').textContent = String(counts.asks);
  $('today-steps').textContent = String(counts.steps);
  $('today-fast').textContent = String(counts.fast);
}
showToday();

// The live list of steps: the one under way glows; finished ones get a tick and their time.
// Narrow window: shown while he works, then folded into one line under the answer.
// Wide window: always shown on the right.
let stepRows = [];
function stepsReset() {
  stepRows = [];
  $('steps').replaceChildren();
  $('steps').hidden = true;
  $('receipt').hidden = true;
  $('steps-empty').hidden = false;
  lightSkill('');
}
function stepFinish(cut = false) {
  const last = stepRows[stepRows.length - 1];
  if (!last || last.done) return;
  last.done = true;
  const seconds = Math.round((Date.now() - last.started) / 1000);
  last.row.classList.remove('now');
  last.row.classList.toggle('cut', cut);
  last.row.querySelector('.ic').textContent = cut ? '–' : '✓';
  last.row.querySelector('.tm').textContent = cut ? '' : `${Math.max(1, seconds)} s`;
}
function stepAdd(text, skill, thinking = false) {
  const last = stepRows[stepRows.length - 1];
  if (last && !last.done && last.text === text) return;   // the same step, announced again
  stepFinish();
  const row = document.createElement('div');
  row.className = 'step now';
  for (const cls of ['ic', 'tx', 'tm']) row.append(Object.assign(document.createElement('span'), { className: cls }));
  row.querySelector('.tx').textContent = text;
  $('steps').append(row);
  stepRows.push({ row, text, started: Date.now(), done: false, thinking });
  while ($('steps').childElementCount > 12) $('steps').firstElementChild.remove();
  $('steps').hidden = false;
  $('steps-empty').hidden = true;
  lightSkill(skill);
  scrollTalk();
}
// When he has finished: the line under the answer says how it was done.
function stepsDone({ summary, stopped, failed, russian }) {
  stepFinish(stopped || failed);
  lightSkill('');
  const n = stepRows.filter((r) => !r.thinking).length;   // "Thinking" is not a step he took
  const seconds = Math.max(1, Math.round((summary?.ms || 0) / 1000));
  let line = '';
  if (summary?.fast) line = russian ? 'Сделано сразу · без ИИ' : 'Done at once · no AI needed';
  else if (stopped) line = n ? (russian ? `Остановлено после ${n} шаг.` : `Stopped after ${n} ${n === 1 ? 'step' : 'steps'}`) : '';
  else if (summary && !failed) {
    const steps = n ? (russian ? `${n} шаг. · ` : `${n} ${n === 1 ? 'step' : 'steps'} · `) : '';
    line = `${steps}${seconds} ${russian ? 'с' : 's'}${mindName ? ` · ${mindName}` : ''}`;
  }
  $('receipt').textContent = line;
  $('receipt').hidden = !line;
  $('receipt').disabled = !n;
  $('receipt').title = n ? 'Show how this was done' : '';
  if (!document.body.classList.contains('wide')) $('steps').hidden = true;
  if (summary) countToday({ asks: 1, steps: n, fast: summary.fast ? 1 : 0 });
}
$('receipt').addEventListener('click', () => { if (stepRows.length) { $('steps').hidden = !$('steps').hidden; scrollTalk(); } });

// Show more: the window widens to show his skills on the left and his work on the right.
function setWide(on, resize = true) {
  document.body.classList.toggle('wide', on);
  $('more').setAttribute('aria-pressed', String(on));
  $('more').title = on ? 'Show less' : 'Show more: what Falcon can do and how he is working';
  $(on ? 'steps-wide' : 'steps-home').append($('steps'));
  $('steps').hidden = !on && (!busy || !stepRows.length);
  if (on && stepRows.length) $('steps').hidden = false;
  try { localStorage.setItem('falcon-wide', on ? 'yes' : 'no'); } catch { /* storage unavailable */ }
  if (!resize) return;
  // Falcon's window is his own, so it may change its size; centred on where it was.
  try {
    const width = on ? Math.min(1120, screen.availWidth) : 520;
    const left = Math.max(0, window.screenX + Math.round((window.outerWidth - width) / 2));
    window.resizeTo(width, window.outerHeight);
    window.moveTo(Math.min(left, Math.max(0, screen.availWidth - width)), window.screenY);
  } catch { /* the browser decides */ }
}
$('more').addEventListener('click', () => setWide(!document.body.classList.contains('wide')));
try { if (localStorage.getItem('falcon-wide') === 'yes') setWide(true); } catch { /* storage unavailable */ }

// Moves the finished question, answer and cards up into the dimmer history above.
function archiveExchange() {
  // A picture shown before anything was asked (one that arrived late, say) still moves up.
  if (!$('said').textContent) return archiveMedia();
  for (const [cls, text] of [['said', $('said').textContent], ['reply', $('reply').textContent]]) {
    const line = document.createElement('p');
    line.className = cls;
    line.textContent = text;
    $('history').appendChild(line);
  }
  archiveMedia();
  if ($('actions').childElementCount) {
    const cards = document.createElement('div');
    cards.className = 'actions';
    cards.append(...$('actions').children);
    $('history').appendChild(cards);
  }
  $('actions').replaceChildren();
  stepsReset();
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
  // While he works, the send button is a Stop button.
  const stopper = new AbortController();
  let stopped = false;
  stopChat = () => { stopped = true; stopper.abort(); };
  $('ask-send').classList.add('stop');
  $('ask-send').textContent = '■';
  $('ask-send').setAttribute('aria-label', 'Stop');
  $('ask-send').title = 'Stop';
  window.falconLastRussian = /[а-яё]/i.test(text);
  archiveExchange();
  $('said').textContent = shown;
  $('reply').textContent = '';
  $('reply').classList.remove('bad', 'waiting');
  setOrb('thinking');
  let answer = '';
  let cards = [];
  let dossier = '';
  let found = null;
  let summary = null;
  let failed = false;
  $('scout').hidden = true;
  $('mind').classList.add('working');
  // The AI can think for a while before its first step; say so at once, instead of an empty list.
  stepAdd(/[а-яё]/i.test(text) ? 'Думаю' : 'Thinking', '', true);
  const reveal = createReveal($('reply'));
  // If the answer takes a moment, say so instead of sitting silent.
  const russian = /[а-яё]/i.test(text);
  // After a while, also say how long it has been, so a long job never looks frozen.
  const asked = Date.now();
  let step = '';
  const patience = setInterval(() => {
    const seconds = Math.round((Date.now() - asked) / 1000);
    if (answer || seconds < 2 || !$('scout').hidden) return;
    if ($('reply').textContent && !$('reply').classList.contains('waiting')) return;
    // What he is doing right now, when the engine says so; otherwise a holding phrase and the time.
    $('reply').textContent = step
      ? `${step}… ${seconds >= 10 ? (russian ? `${seconds} с` : `${seconds} s`) : ''}`.trim()
      : seconds < 10
        ? (russian ? `Одну минуту, ${addressRu()}.` : `One moment, ${address()}.`)
        : (russian ? `Работаю над этим, ${addressRu()}. Прошло ${seconds} с.` : `Still working on it, ${address()}. ${seconds} seconds so far.`);
    $('reply').classList.add('waiting');
  }, 1000);
  const clearWaiting = () => {
    clearInterval(patience);
    if ($('reply').classList.contains('waiting')) { $('reply').classList.remove('waiting'); $('reply').textContent = ''; }
  };
  const fail = (message) => { failed = true; clearWaiting(); answer = message; $('reply').textContent = message; $('reply').classList.add('bad'); };
  try {
    await window.falcon.chat(text, {
      onDelta: (piece) => { clearWaiting(); answer += piece; reveal.set(plainSpeech(answer)); setOrb('speaking'); },
      onActions: (items) => { cards = items; },
      onStep: (line, skill) => { step = line; stepAdd(line, skill); if (!answer) setOrb('thinking'); },
      onSummary: (s) => { summary = s; },
      onScout: (progress) => { clearWaiting(); showScout(progress); },
      onDossier: (name) => { dossier = name; },
      onFile: (file) => { found = file; },
      onPending: (waiting) => { $('media').append(mediaWaiting(waiting, russian)); scrollTalk(); },
      onError: fail,
    }, stopper.signal);
    await reveal.done();
    if (cards.length) showActions(cards);
    $('scout').hidden = true;
    if (dossier) { $('actions').append(dossierButton(dossier)); scrollTalk(); showDossier(dossier); }
    if (found) { $('actions').append(...fileButtons(found)); scrollTalk(); }
  } catch {
    if (stopped) {
      clearWaiting();
      $('scout').hidden = true;
      answer = russian ? `Остановился, ${addressRu()}.` : `Stopped, ${address()}.`;
      $('reply').textContent = answer;
    } else {
      fail(`I have lost my connection, ${address()}. Please try again in a moment.`);
    }
  }
  clearWaiting();
  if (!answer) $('reply').textContent = dossier ? `The dossier is ready, ${address()}.` : `Done, ${address()}.`;
  stepsDone({ summary, stopped, failed, russian });
  $('mind').classList.remove('working');
  setOrb('idle');
  busy = false;
  stopChat = null;
  $('ask-send').classList.remove('stop');
  $('ask-send').textContent = '➤';
  $('ask-send').setAttribute('aria-label', 'Send');
  $('ask-send').title = '';
  // After his own welcome (a request the window made), show what he can be asked.
  if (!shown && !stopped) $('examples').hidden = false;
  $('ask-text').focus();
}

let stopChat = null;
$('ask-send').addEventListener('click', (event) => { if (busy && stopChat) { event.preventDefault(); stopChat(); } });
$('ask').addEventListener('submit', (event) => { event.preventDefault(); sendToFalcon($('ask-text').value.trim()); });
for (const chip of document.querySelectorAll('[data-ask]')) {
  chip.addEventListener('click', () => sendToFalcon(chip.dataset.ask));
}

// ---- Voice ----
// Falcon has two voices. The built-in one is free, needs no key and works with any AI provider.
// The live one (OpenAI's Realtime service) is smoother and can be interrupted by simply speaking,
// but needs an OpenAI key; it is switched on in Settings. If the live voice cannot start, the
// built-in one takes over.
let voiceReady = false;                 // an OpenAI key for the live voice is saved
let liveVoice = true;                   // use the live voice whenever an OpenAI key is saved
try { liveVoice = localStorage.getItem('falcon-live-voice') !== 'off'; } catch { /* storage unavailable */ }
let voice = null;                       // the voice in use while a conversation is on
window.falconAddress = () => callMe;
window.falconPlain = (text) => plainSpeech(text);

async function refreshVoice() {
  try { voiceReady = (await window.falcon.voiceStatus()).available; } catch { voiceReady = false; }
  const builtIn = window.falconSpeech.supported();
  const any = builtIn || voiceReady;
  $('mic').classList.toggle('needs-key', !any);
  $('mic').title = any ? 'Talk to Falcon' : 'Voice is not available in this browser.';
  setDot('dot-voice', any, !any ? 'Voice: not available in this browser'
    : (liveVoice && voiceReady ? 'Voice: live voice' : 'Voice: ready'));
}
function voiceNote(text, kind = '') { $('voice-note').textContent = text; $('voice-note').className = `hint ${kind}`; }

function onVoiceState(state) {
  const on = state !== 'off';
  $('mic').classList.toggle('on', on);
  $('mic').classList.toggle('busy', state === 'connecting');
  $('mic').setAttribute('aria-pressed', String(on));
  $('orb').classList.toggle('live', on);
  if (!on) { $('orb').style.setProperty('--level', '0'); voice = null; }
  setOrb({ off: 'idle', connecting: 'thinking', listening: 'listening', thinking: 'thinking', speaking: 'speaking' }[state] || 'idle');
  voiceNote({ connecting: 'Connecting the voice…', listening: 'Listening. Just speak; press the microphone again to end.', thinking: 'One moment…', speaking: '', off: '' }[state] ?? '');
}
for (const engine of [window.falconVoice, window.falconSpeech]) {
  engine.on('state', onVoiceState);
  engine.on('heard', (text) => { archiveExchange(); $('examples').hidden = true; $('said').textContent = text; $('reply').textContent = ''; });
  engine.on('said', (text) => { $('reply').classList.remove('bad', 'waiting'); $('reply').textContent = plainSpeech(text); scrollTalk(); });
  engine.on('actions', (items) => showActions(items));
  // The orb follows the loudness: the user's voice while listening, Falcon's while he speaks.
  engine.on('level', (level) => { $('orb').style.setProperty('--level', level.toFixed(3)); });
}
window.falconSpeech.on('error', (message) => voiceNote(message, 'bad'));
window.falconVoice.on('note', (message) => voiceNote(message));
// If the live voice fails, carry on with the built-in one instead of leaving the user in silence.
window.falconVoice.on('error', (message) => {
  if (window.falconSpeech.supported() && !window.falconSpeech.active()) {
    voiceNote('The live voice is not available just now, so I am using my built-in voice.');
    voice = window.falconSpeech;
    setTimeout(() => window.falconSpeech.start(), 400);
  } else {
    voiceNote(message, 'bad');
  }
});

$('mic').addEventListener('click', () => {
  if (voice && voice.active()) {
    // While he is speaking, the first press cuts him off and listens; otherwise it ends the conversation.
    if (voice.interrupt && voice.interrupt()) return;
    return voice.stop();
  }
  if (busy) return voiceNote('One moment, I am still working on the last request.');
  $('examples').hidden = true;
  voice = liveVoice && voiceReady ? window.falconVoice : window.falconSpeech;
  if (voice === window.falconSpeech && !voice.supported()) {
    if (voiceReady) voice = window.falconVoice;
    else return voiceNote('This browser has no built-in speech. Open Falcon in Chrome or Edge, or add an OpenAI key in Settings.', 'bad');
  }
  voice.start();
});

// Settings: choose the voice.
function showVoiceSetting() {
  const builtIn = window.falconSpeech.supported();
  $('voice-state').textContent = liveVoice && voiceReady ? '✓ live voice' : (builtIn ? '✓ built-in voice' : '');
  $('voice-text').textContent = liveVoice && voiceReady
    ? 'Falcon is using OpenAI’s live voice: smoother, and you can interrupt him just by speaking. It uses your OpenAI credit.'
    : (builtIn
      ? 'Falcon is using his built-in voice, which works with any AI key. With an OpenAI key saved above he switches to the smoother live voice. Press the microphone and talk.'
      : 'This browser has no built-in speech. Add an OpenAI key above to use the live voice.');
  $('voice-live').hidden = !voiceReady;
  $('voice-live').textContent = liveVoice ? 'Use the built-in voice instead' : 'Use OpenAI’s live voice';
  $('voice-live-note').textContent = voiceReady ? '' : 'The live voice becomes available when an OpenAI key is saved above.';
}
$('voice-live').addEventListener('click', () => {
  liveVoice = !liveVoice;
  try { localStorage.setItem('falcon-live-voice', liveVoice ? 'on' : 'off'); } catch { /* storage unavailable */ }
  showVoiceSetting();
  refreshVoice();
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

// Quit: stops Falcon's window and his background part. His engine keeps running for Telegram and briefings.
$('about-quit').addEventListener('click', async () => {
  try { await window.falcon.quit(); } catch { /* stopping anyway */ }
  note('quit-message', 'Falcon has stopped. You can close this window.', 'ok');
  setTimeout(() => window.close(), 800);
});

// The keyboard shortcut (Ctrl+Alt+Space): come forward and listen; pressed again while listening, stop.
function summoned() {
  try { window.focus(); } catch { /* the icon by the clock has already brought the window forward */ }
  if ($('screen-main').hidden) return;
  if (voice && voice.active()) return voice.stop();
  const canListen = (liveVoice && voiceReady) || window.falconSpeech.supported();
  if (busy || !canListen) return $('ask-text').focus();
  $('mic').click();
}

window.falcon.listen({
  summon: summoned,
  update: (progress) => { const line = progress.text || progress.detail; if (line) note('update-message', line, 'working'); },
  approval: (request) => { approvalQueue.push(request); if (!currentApproval) nextApproval(); },
  media: showMedia,
  // A program in something he learned waits for the user's yes (Settings > Learned).
  learned: showLearnedCount,
  repair: (s) => showRepairState({ status: s, choice: true }),
  // Something he noticed by himself, such as the AI credit being back after a top-up.
  notice: ({ text }) => {
    if (busy || !text) return;
    archiveExchange();
    $('said').textContent = '';
    $('reply').classList.remove('bad', 'waiting');
    $('reply').textContent = text;
    scrollTalk();
  },
  setup: (progress) => {
    if (progress.detail) return setupLog.add(progress.detail);
    setMessage(progress.text.replace(/…$/, ''), 'working');
    setupLog.eta(progress.left);
  },
});

// The shortcut exists on Windows, where Falcon's icon by the clock holds it and says which keys it took.
function showShortcut() {
  window.falcon.about().then((a) => {
    if (!a.shortcut) return;
    $('shortcut-hint').replaceChildren('Press ', ...a.shortcut.split('+').flatMap((key) => {
      const k = document.createElement('kbd');
      k.textContent = key;
      return [k, ' '];
    }), 'anywhere to call me.');
    $('shortcut-hint').hidden = false;
  }).catch(() => {});
}

// ---- Start ----
// "?screen=" and "?preview=allow" exist only so the design can be checked.
const query = new URLSearchParams(location.search);
const WAKE_GIVE_UP_MS = 15 * 60000;     // after this, say so, but keep trying
if (screens.includes(query.get('screen'))) {
  showScreen(query.get('screen'));
} else if (query.get('waited')) {
  // Design check only: show the waiting screen as it looks after this many seconds.
  showScreen('loading');
  showWaiting(Number(query.get('waited')) * 1000, 0);
} else {
  // Right after the computer starts, Falcon's engine can take several minutes to be ready (about
  // eight and a half on a busy PC). Wait for it as long as that takes, and say honestly what is
  // happening, instead of giving up after a minute with advice to restart, which only starts the
  // wait again.
  const startedWaiting = Date.now();
  let failures = 0;
  let done = false;
  let updating = false;
  const ticker = setInterval(() => {
    if (done) return;
    if (!updating) return showWaiting(Date.now() - startedWaiting, failures);
    $('loading-status').textContent = 'Learning my new skills';
    $('loading-status').classList.add('working');
    $('loading-detail').textContent = 'I have just been updated. This takes about a minute, once; then I shall be quicker than before.';
  }, 1000);
  const wake = () => window.falcon.state()
    .then((s) => {
      failures = 0;
      updating = Boolean(s.updating);
      if (s.ready) { done = true; clearInterval(ticker); return enterFalcon(); }
      if (!s.configured) { done = true; clearInterval(ticker); return showScreen('setup'); }
      setTimeout(wake, Date.now() - startedWaiting > WAKE_GIVE_UP_MS ? 10000 : 3000);
    })
    .catch(() => { failures += 1; setTimeout(wake, 3000); });
  wake();
}

// What the waiting screen says, by how long Falcon has been waiting for his engine.
function showWaiting(waitedMs, failures) {
  const status = $('loading-status');
  const detail = $('loading-detail');
  const minutes = Math.floor(waitedMs / 60000);
  const set = (title, text, working) => {
    status.textContent = title;
    status.classList.toggle('working', working);
    detail.textContent = text;
  };
  if (failures >= 5) {
    set('I have lost my connection.', 'Close this window and open Falcon again.', false);
  } else if (waitedMs > WAKE_GIVE_UP_MS) {
    set('I am taking unusually long to wake up.',
      'I am still trying. If nothing changes in a few minutes, close this window and open Falcon again.', true);
  } else if (waitedMs > 60000) {
    set(`Still waking up, ${minutes} min`,
      'Right after the computer starts this can take up to ten minutes. You may leave this window open; I shall come in by myself.', true);
  } else if (waitedMs > 6000) {
    set('Waking up', 'Right after the computer starts this can take a few minutes. I shall be with you as soon as I am ready.', true);
  }
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
// Design check only: Falcon part-way through a job, then finished, with made-up steps.
if (query.get('preview') === 'work' || query.get('preview') === 'worked') {
  $('examples').hidden = true;
  mindName = 'Claude Haiku 5.5'; showMind();
  $('said').textContent = 'Find last month\'s invoice and make a short summary of it.';
  stepAdd('Looking for the file', 'files');
  stepFinish();
  stepAdd('Reading Invoice October.pdf', 'files');
  stepFinish();
  stepAdd('Making the document', 'files');
  if (query.get('preview') === 'work') {
    $('mind').classList.add('working'); setOrb('thinking');
    $('reply').textContent = 'Making the document…';
    $('reply').classList.add('waiting');
  } else {
    $('reply').textContent = 'The summary is on your desktop, sir: Invoice October summary.docx.';
    stepsDone({ summary: { fast: false, steps: 3, ms: 14000 }, stopped: false, failed: false, russian: false });
  }
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
