const $ = (id) => document.getElementById(id);
const screens = ['loading', 'setup', 'main', 'connections'];

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
      const result = await window.falcon.setup(key, true);
      if (result.ok) { $('setup-key').value = ''; return showScreen('main'); }
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

$('ask').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('ask-text').value.trim();
  if (!text || busy) return;
  busy = true;
  $('ask-text').value = '';
  $('ask-send').disabled = true;
  archiveExchange();
  $('said').textContent = text;
  $('reply').textContent = '';
  $('reply').classList.remove('bad', 'waiting');
  setOrb('thinking');
  let answer = '';
  // If the answer takes a moment, say so instead of sitting silent.
  const patience = setTimeout(() => {
    if (!answer) { $('reply').textContent = /[а-яё]/i.test(text) ? 'Одну минуту, сэр.' : 'One moment, sir.'; $('reply').classList.add('waiting'); }
  }, 2500);
  const clearWaiting = () => { clearTimeout(patience); $('reply').classList.remove('waiting'); };
  try {
    await window.falcon.chat(text, {
      onDelta: (piece) => { clearWaiting(); answer += piece; $('reply').textContent = answer; setOrb('speaking'); scrollTalk(); },
      onError: (message) => { clearWaiting(); answer = message; $('reply').textContent = message; $('reply').classList.add('bad'); },
    });
  } catch {
    clearWaiting();
    answer = 'I have lost my connection, sir. Please try again in a moment.';
    $('reply').textContent = answer;
    $('reply').classList.add('bad');
  }
  clearWaiting();
  if (!answer) $('reply').textContent = 'Done, sir.';
  setOrb('idle');
  busy = false;
  $('ask-send').disabled = false;
  $('ask-text').focus();
});

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
      if (s.ready) return showScreen('main');
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
