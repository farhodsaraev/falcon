// Task views use runtime outcomes, never an assistant-written success marker.
(() => {
  const $ = id => document.getElementById(id);
  const tasks = new Map();
  const active = task => ['running', 'waiting', 'cancelling', 'cancel_failed'].includes(task.state);
  const node = (tag, text, cls = '') => { const el = document.createElement(tag); el.textContent = text; el.className = cls; return el; };
  function render() {
    const list = [...tasks.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 50);
    const count = list.filter(active).length;
    $('open-tasks').textContent = count ? `Tasks (${count})` : 'Tasks';
    $('task-list').replaceChildren(...list.map(task => {
      const card = node('article', '', 'task-card');
      const title = node('h3', task.title);
      const state = node('p', task.restored && task.state === 'interrupted' ? 'Interrupted when the window stopped. Check the result before retrying.' : task.stage, `task-state ${task.state}`);
      card.append(title, state);
      if (task.error) card.append(node('p', task.error, 'hint bad'));
      for (const action of task.actions || []) {
        const label = { verified: 'Verified', failed: 'Failed', unverified: 'Not confirmed' }[action.status] || 'Not confirmed';
        const row = node('div', '', `task-action ${action.status}`);
        row.append(node('strong', `${label}: ${action.label}`), node('p', action.detail, 'hint'));
        card.append(row);
      }
      if (task.state === 'completed' && !task.actions?.length) card.append(node('p', 'No computer actions were independently confirmed for this reply.', 'hint'));
      if (active(task)) {
        const stop = node('button', task.state === 'cancelling' ? 'Stopping…' : 'Stop task', 'ghost small-btn');
        stop.type = 'button'; stop.disabled = task.state === 'cancelling';
        stop.addEventListener('click', async () => {
          stop.disabled = true;
          // Stopping execution also stops its voice output, but the microphone button remains speech-only.
          window.falconVoice?.stop(); window.falconSpeech?.stop();
          try {
            const r = await window.falcon.cancelTask(task.id);
            if (r.task) update(r.task);
            if (!r.ok) $('tasks-message').textContent = r.error || 'Stop was not confirmed. Retry Stop.';
          } catch { $('tasks-message').textContent = 'The stop request could not be delivered. Retry Stop.'; stop.disabled = false; }
        });
        card.append(stop);
      }
      return card;
    }));
    if (!list.length) $('task-list').append(node('p', 'Your requests will appear here.', 'hint'));
  }
  function update(task) {
    const old = tasks.get(task.id);
    if (old && (old.revision || 0) > (task.revision || 0)) return;
    tasks.set(task.id, task); render();
  }
  async function loadTasks() {
    try { const r = await window.falcon.tasks(); for (const t of r.items) update(t); render(); }
    catch { $('tasks-message').textContent = 'Tasks could not be loaded. Close and reopen this panel to retry.'; }
  }
  $('open-tasks').addEventListener('click', () => { $('tasks-message').textContent = ''; $('tasks-dialog').showModal(); loadTasks(); });
  $('tasks-close').addEventListener('click', () => $('tasks-dialog').close());
  $('tasks-dialog').addEventListener('close', () => $('open-tasks').focus());
  async function refreshReadiness() {
    const button = $('readiness-refresh'); button.disabled = true;
    $('readiness-message').textContent = 'Checking…';
    $('readiness-list').replaceChildren();
    try {
      const result = await window.falcon.readiness();
      const items = [...result.items];
      let permission = 'unknown';
      try { permission = (await navigator.permissions.query({ name: 'microphone' })).state; } catch {}
      const voice = !!(window.SpeechRecognition || window.webkitSpeechRecognition || window.RTCPeerConnection);
      items.push({ label: 'Microphone', status: !voice || permission === 'denied' ? 'blocked' : permission === 'granted' ? 'ready' : 'unknown', detail: permission === 'granted' ? 'Microphone permission is granted; hardware is checked when you press the microphone.' : permission === 'denied' ? 'Microphone permission is denied.' : 'Microphone access has not been confirmed.', remedy: 'Allow microphone access in the browser/site settings, then press the microphone in Falcon.' });
      for (const item of items) {
        const card = node('article', '', `readiness-item ${item.status}`);
        const label = { ready: 'Available', blocked: 'Needs attention', unknown: 'Not confirmed' }[item.status] || 'Not confirmed';
        card.append(node('h3', item.label), node('strong', label), node('p', item.detail, 'hint'));
        if (item.status !== 'ready' && item.remedy) card.append(node('p', item.remedy, 'hint remedy'));
        if (item.id === 'tracking' && item.status !== 'ready') {
          const repair = node('button', 'Update tracking (restarts assistant)', 'ghost small-btn'); repair.type = 'button';
          repair.addEventListener('click', async () => {
            repair.disabled = true;
            try { const r = await window.falcon.repairTracking(); $('readiness-message').textContent = r.message || r.error; }
            catch { $('readiness-message').textContent = 'Tracking could not be updated. Try again.'; }
            finally { repair.disabled = false; }
          });
          card.append(repair);
        }
        $('readiness-list').append(card);
      }
      $('readiness-message').textContent = `Last checked ${new Date(result.checkedAt).toLocaleTimeString()}. Checks do not request permissions or change settings.`;
    } catch { $('readiness-message').textContent = 'Checks could not be completed. Check the connection and try again.'; }
    finally { button.disabled = false; }
  }
  $('readiness-refresh').addEventListener('click', refreshReadiness);
  window.falconTaskUI = { update, refreshReadiness };
  loadTasks();
})();
