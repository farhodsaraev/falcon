const $ = (id) => document.getElementById(id);
const screens = ['loading', 'setup', 'main'];

function showScreen(name) {
  for (const s of screens) $(`screen-${s}`).hidden = s !== name;
  if (name === 'main') $('ask-text').focus();
}

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
  $('setup-start').disabled = true;
  setMessage('Starting…');
  try {
    const result = await window.falcon.setup(key, true);
    if (result.ok) { $('setup-key').value = ''; return showScreen('main'); }
    setMessage(result.error || 'Something went wrong.', 'bad');
  } catch {
    setMessage('Setup was interrupted. Please try again.', 'bad');
  }
  $('setup-start').disabled = false;
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
  setup: (progress) => setMessage(progress.text),
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
if (query.get('preview') === 'talk') {
  $('said').textContent = 'Good morning, Falcon.';
  $('reply').textContent = 'Good morning, sir. At your service.';
  archiveExchange();
  $('said').textContent = 'Open my quarterly review presentation and go to slide 5.';
  $('reply').textContent = 'Slide five of the Quarterly Review is up, sir.';
}
