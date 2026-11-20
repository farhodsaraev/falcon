// Falcon's Workshop window (self-repair plan, stage 3, section 8): the owner asks for a fix or a new
// ability, sees the estimate, and follows the work as it happens: each step in plain words, every changed
// line, the test results and the second opinion. Nothing changes in Falcon until he presses Approve.
const $ = (id) => document.getElementById(id);
const BUSY = ['preparing', 'writing', 'testing', 'reviewing', 'fixing', 'switching'];
const PHASES = {
  preparing: 'Getting ready', writing: 'Writing the change', testing: 'Testing the change', reviewing: 'A second AI is checking the change',
  fixing: 'Correcting what was found', switching: 'Switching to the new version', ready: 'Ready for your decision',
  failed: 'The change could not be finished', stopped: 'Stopped', refused: 'Refused: nothing was changed', approved: 'Approved: Falcon is starting again with the change',
};
let current = null;
let ticker = null;

function note(id, text, kind = '') { $(id).textContent = text; $(id).className = `message ${kind}`; }
const seconds = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; };

async function showAsk() {
  $('work').hidden = true;
  $('ask').hidden = false;
  $('start').disabled = true;
  let info;
  try { info = await window.falcon.repair(); } catch { return note('ask-message', 'Falcon could not be reached.', 'bad'); }
  if (!info.choice) {
    $('cost').textContent = 'Falcon needs an OpenAI or OpenRouter key for coding. Add one in Settings, under AI key.';
    $('agree').disabled = true;
    return;
  }
  $('cost').textContent = `Done by ${info.choice.tool} with ${info.choice.label}. A repair usually costs ${info.estimate}. You can change this in Settings, under "Which AI does what".`;
  $('agree').disabled = false;
  const ready = () => { $('start').disabled = !($('agree').checked && $('request').value.trim()); };
  $('agree').onchange = ready;
  $('request').oninput = ready;
  ready();
  $('request').focus();
}

$('start').addEventListener('click', async () => {
  $('start').disabled = true;
  note('ask-message', 'Starting', 'working');
  try {
    const r = await window.falcon.repairStart($('request').value, $('agree').checked);
    if (!r.ok) { $('start').disabled = false; return note('ask-message', r.error, 'bad'); }
    note('ask-message', '');
    $('agree').checked = false;
    render((await window.falcon.repair()).status);
  } catch { $('start').disabled = false; note('ask-message', 'Falcon could not be reached.', 'bad'); }
});

function render(s) {
  current = s;
  if (!s) return showAsk();
  $('ask').hidden = true;
  $('work').hidden = false;
  $('w-request').textContent = `“${s.request}”`;
  const busy = BUSY.includes(s.phase);
  const took = (s.endedAt || Date.now()) - s.startedAt;
  // The real cost when the tool reports it (Falcon's engine does); otherwise the estimate.
  const cost = s.cost > 0 ? `cost so far: ${s.cost < 1 ? `${Math.max(1, Math.round(s.cost * 100))} cents` : `${s.cost.toFixed(2)} US dollars`}, as billed`
    : `estimate: ${s.estimate}. The exact cost is on your key's page with the AI company`;
  $('w-meta').textContent = `${s.model}, done by ${s.tool} · ${seconds(took)} · ${cost}.`;
  $('w-phase').textContent = PHASES[s.phase] || s.phase;
  $('w-phase').className = `phase ${busy ? 'working' : s.phase}`;
  $('w-steps').replaceChildren(...s.steps.map((step, i) => {
    const li = document.createElement('li');
    const last = i === s.steps.length - 1;
    li.className = `step ${step.done || !busy || !last ? 'done' : 'now'}`;
    const text = document.createElement('span');
    text.textContent = step.text;
    const time = document.createElement('small');
    time.textContent = seconds((step.done || (busy && last ? Date.now() : step.at)) - step.at);
    li.append(text, time);
    return li;
  }));
  $('w-said').textContent = s.said ? `${s.tool === 'Codex' ? 'Codex' : 'Falcon'} says: ${s.said}` : '';
  $('w-tests').textContent = !s.tests ? '' : s.tests.ok ? `All ${s.tests.pass} of Falcon's tests pass${s.starts ? ', and this copy of him starts.' : '.'}`
    : `${s.tests.fail} of ${s.tests.tests} tests fail: ${(s.tests.failing || []).slice(0, 5).join('; ')}`;
  const review = [];
  if (s.review?.skipped) review.push(`No second opinion: ${s.review.skipped}.`);
  else if (s.review?.ok) review.push(`A second AI model${s.review.model ? ` (${s.review.model})` : ''} found no problems.`);
  else if (s.review) review.push('A second AI model found:', ...s.review.problems.map((p) => `• ${p}`));
  $('w-review').replaceChildren(...review.map((line) => Object.assign(document.createElement('p'), { textContent: line })));
  if (s.error) note('w-message', s.error, s.phase === 'ready' ? 'warn' : 'bad');
  else if (s.phase === 'ready') note('w-message', 'Approve to switch Falcon to this version. He closes and starts again; if he does not start within a minute, he goes back by himself.', 'ok');
  else note('w-message', '');
  showDiff(s.diff || []);
  $('w-stop').hidden = !busy || s.phase === 'switching';
  $('w-approve').hidden = s.phase !== 'ready';
  $('w-refuse').hidden = !['ready', 'failed'].includes(s.phase);
  $('w-new').hidden = !['stopped', 'refused', 'approved'].includes(s.phase);
  clearInterval(ticker);
  if (busy) ticker = setInterval(() => render(current), 1000);
}

function showDiff(files) {
  if (!files.length) return $('w-diff').replaceChildren(Object.assign(document.createElement('p'), { className: 'panel-text', textContent: 'Nothing yet.' }));
  $('w-diff').replaceChildren(...files.map((f) => {
    const box = document.createElement('details');
    box.open = files.length <= 3;
    const head = document.createElement('summary');
    head.textContent = `${f.file}  +${f.added} −${f.removed}`;
    const pre = document.createElement('pre');
    for (const [sign, text] of f.lines) {
      const line = document.createElement('span');
      line.className = sign === '+' ? 'add' : sign === '-' ? 'del' : sign === '@' ? 'hunk' : '';
      line.textContent = `${sign === '@' ? '…' : sign} ${text}\n`;
      pre.append(line);
    }
    box.append(head, pre);
    return box;
  }));
}

async function act(button, work, done) {
  button.disabled = true;
  try {
    const r = await work();
    if (!r.ok) note('w-message', r.error, 'bad');
    else if (done) note('w-message', done, 'ok');
  } catch { note('w-message', 'Falcon could not be reached.', 'bad'); } finally { button.disabled = false; }
}
$('w-stop').addEventListener('click', () => act($('w-stop'), () => window.falcon.repairStop()));
$('w-refuse').addEventListener('click', () => act($('w-refuse'), () => window.falcon.repairRefuse()));
$('w-approve').addEventListener('click', () => act($('w-approve'), () => window.falcon.repairApprove(), 'Falcon is switching to the new version and will open again in a moment.'));
$('w-new').addEventListener('click', () => { current = null; $('request').value = ''; showAsk(); });
$('w-details').addEventListener('click', async () => {
  const open = $('w-log').hidden;
  $('w-log').hidden = !open;
  $('w-details').textContent = open ? 'Hide details' : 'Show details';
  if (open) { try { $('w-log').textContent = (await window.falcon.repairLog()).lines.join('\n') || 'Nothing yet.'; } catch { /* leave it */ } }
});

// ---- The owner's own changes (stage 4) ----
const CHANGE_STATE = {
  applied: 'On', off: 'Off', 'did-not-fit': 'Off: it no longer fits this version', 'tests-failed': 'Off: it broke this version\'s tests', 'did-not-start': 'Off: Falcon did not start with it',
};
async function showMine() {
  let r;
  try { r = await window.falcon.personal(); } catch { return; }
  const list = r.changes;
  $('mine-empty').hidden = list.length > 0;
  $('mine-off').hidden = !list.some((c) => c.on);
  $('mine-on').hidden = !list.some((c) => !c.on);
  $('mine-list').replaceChildren(...list.slice().reverse().map((c) => {
    const row = document.createElement('li');
    const text = document.createElement('div');
    const title = document.createElement('b');
    title.textContent = c.title;
    const about = document.createElement('small');
    about.textContent = `${CHANGE_STATE[c.state] || (c.on ? 'On' : 'Off')} · ${new Date(c.at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`;
    text.append(title, about);
    row.append(text);
    const toggle = document.createElement('button');
    toggle.className = 'ghost small-btn';
    toggle.type = 'button';
    toggle.textContent = c.on ? 'Switch off' : 'Switch on';
    toggle.addEventListener('click', () => setMine(c.id, !c.on));
    row.append(toggle);
    if (['did-not-fit', 'tests-failed', 'did-not-start'].includes(c.state)) {
      const adapt = document.createElement('button');
      adapt.className = 'primary small-btn';
      adapt.type = 'button';
      adapt.textContent = 'Adapt it';
      adapt.addEventListener('click', () => adaptMine(c));
      row.append(adapt);
    }
    return row;
  }));
  if (r.busy) note('mine-message', 'Falcon is putting your changes in place', 'working');
}
async function setMine(id, on) {
  note('mine-message', 'Rebuilding Falcon with your choice and testing it', 'working');
  try {
    const r = await window.falcon.setPersonal(id, on);
    if (!r.ok) note('mine-message', r.error, 'bad');
  } catch { note('mine-message', 'Falcon could not be reached.', 'bad'); }
}
async function adaptMine(change) {
  let info;
  try { info = await window.falcon.repair(); } catch { return note('mine-message', 'Falcon could not be reached.', 'bad'); }
  if (!info.choice) return note('mine-message', 'Falcon needs an OpenAI or OpenRouter key for coding. Add one in Settings, under AI key.', 'bad');
  if (!window.confirm(`Ask Falcon to adapt “${change.title}” to this version?\n\nDone by ${info.choice.tool} with ${info.choice.label}. It usually costs ${info.estimate}.`)) return;
  try {
    const r = await window.falcon.adaptPersonal(change.id, true);
    if (!r.ok) return note('mine-message', r.error, 'bad');
    note('mine-message', '');
    render((await window.falcon.repair()).status);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch { note('mine-message', 'Falcon could not be reached.', 'bad'); }
}
$('mine-off').addEventListener('click', () => setMine('all', false));
$('mine-on').addEventListener('click', () => setMine('all', true));
showMine();

window.falcon.listen({
  repair: (s) => { if (s && (!current || s.id === current.id || BUSY.includes(s.phase))) render(s); if (s?.phase === 'approved') showMine(); },
  personal: ({ phase, error }) => {
    if (phase === 'switching') note('mine-message', 'Rebuilding Falcon with your choice and testing it', 'working');
    if (phase === 'restarting') note('mine-message', 'Done. Falcon is starting again with your choice.', 'ok');
    if (phase === 'failed') note('mine-message', error || 'That could not be done.', 'bad');
    showMine();
  },
});
window.falcon.repair().then((info) => {
  const s = info.status;
  // A repair in progress, or one waiting for a decision, is shown; a finished one gives way to a new request.
  render(s && (BUSY.includes(s.phase) || ['ready', 'failed'].includes(s.phase)) ? s : null);
}).catch(() => showAsk());
