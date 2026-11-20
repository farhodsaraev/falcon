// Connects the window to Falcon's local server on this PC.
(() => {
  const params = new URLSearchParams(location.hash.slice(1));
  // The token arrives in the address once; keep it for this window so a refresh does not lose it.
  let token = params.get('token') || '';
  try {
    if (token) sessionStorage.setItem('falcon-token', token); else token = sessionStorage.getItem('falcon-token') || '';
  } catch { /* storage unavailable */ }
  history.replaceState(null, '', location.pathname + location.search);
  const headers = { 'Content-Type': 'application/json', 'X-Falcon-Token': token };

  async function call(method, path, body) {
    const response = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw new Error('unreachable');
    return response.json();
  }

  window.falcon = {
    state: () => call('GET', '/api/state'),
    setup: (key, accepted, model) => call('POST', '/api/setup', { key, accepted, model }),
    inspectKey: (key) => call('POST', '/api/key/inspect', { key }),
    voiceStatus: () => call('GET', '/api/voice'),
    voiceSetup: () => call('GET', '/api/voice/setup'),
    // Sends the window's connection offer; the server adds the key and Falcon's voice settings.
    async voiceSession(sdp) {
      const response = await fetch('/api/voice/session', { method: 'POST', headers: { 'Content-Type': 'application/sdp', 'X-Falcon-Token': token }, body: sdp });
      if (response.ok) return { ok: true, sdp: await response.text(), setupPending: response.headers.get('X-Falcon-Voice-Setup') === 'pending' };
      let error = 'The voice could not be started.';
      try { error = (await response.json()).error || error; } catch { /* keep the default */ }
      return { ok: false, error };
    },
    currentModel: () => call('GET', '/api/model'),
    about: () => call('GET', '/api/about'),
    updateStatus: () => call('GET', '/api/update'),
    update: () => call('POST', '/api/update'),
    answerApproval: (id, decision) => call('POST', '/api/approval', { id, decision }),
    profile: () => call('GET', '/api/profile'),
    saveProfile: (profile) => call('POST', '/api/profile', profile),
    saveKey: (key, model) => call('POST', '/api/key', { key, model }),
    uninstallStatus: () => call('GET', '/api/uninstall'),
    uninstall: (deleteData) => call('POST', '/api/uninstall', { deleteData }),
    searchStatus: () => call('GET', '/api/search'),
    saveSearchKey: (key) => call('POST', '/api/search', { key }),
    openDossier: (name) => call('POST', '/api/dossier/open', { name }),
    quit: () => call('POST', '/api/quit'),
    dossierUrl: (name) => `/api/dossier/view?name=${encodeURIComponent(name)}&token=${encodeURIComponent(token)}`,
    learned: () => call('GET', '/api/learned'),
    learnedCount: () => call('GET', '/api/learned/count'),
    aiJobs: () => call('GET', '/api/ai-jobs'),
    repair: () => call('GET', '/api/repair'),
    repairStart: (request, agreed) => call('POST', '/api/repair/start', { request, agreed }),
    repairStop: () => call('POST', '/api/repair/stop'),
    repairApprove: () => call('POST', '/api/repair/approve'),
    repairRefuse: () => call('POST', '/api/repair/refuse'),
    repairLog: () => call('GET', '/api/repair/log'),
    personal: () => call('GET', '/api/personal'),
    addons: () => call('GET', '/api/addons'),
    setPersonal: (id, on) => call('POST', '/api/personal/set', { id, on }),
    adaptPersonal: (id, agreed) => call('POST', '/api/personal/adapt', { id, agreed }),
    // The Workshop window: a second window, opened with this one's access.
    workshopUrl: () => `/workshop#token=${encodeURIComponent(token)}`,
    setCodingAi: (provider, model) => call('POST', '/api/ai-jobs', { coding: { provider, model } }),
    removeLearned: (name) => call('POST', '/api/learned/remove', { name }),
    restoreLearned: (name) => call('POST', '/api/learned/restore', { name }),
    allowProgram: (name, file) => call('POST', '/api/learned/allow', { name, file }),
    briefing: () => call('GET', '/api/briefing'),
    setBriefing: (enabled, time) => call('POST', '/api/briefing', { enabled, time }),
    briefingNow: () => call('POST', '/api/briefing/now'),
    connections: () => call('GET', '/api/connections'),
    telegramConnect: (token) => call('POST', '/api/telegram/connect', { token }),
    telegramPair: (code) => call('POST', '/api/telegram/pair', { code }),
    chromeTest: () => call('POST', '/api/chrome/test'),
    listen: (handlers) => {
      const events = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
      for (const [name, handler] of Object.entries(handlers)) {
        events.addEventListener(name, (event) => handler(JSON.parse(event.data)));
      }
    },
    // Sends a message and calls onDelta for each piece of the answer as it arrives.
    // `signal` lets the caller stop the request (the Stop button).
    openFile: (path, reveal) => call('POST', '/api/file/open', { path, reveal }),
    // Where the window loads a picture or video Falcon made (only one he offered here).
    mediaUrl: (id) => `/api/media?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`,
    async chat(text, { onDelta, onError, onActions, onScout, onDossier, onStep, onFile, onPending, onSummary }, signal) {
      const response = await fetch('/api/chat', { method: 'POST', headers, body: JSON.stringify({ text }), signal });
      if (!response.ok || !response.body) return onError(`I have lost my connection, ${window.falconAddress ? window.falconAddress() : 'sir'}.`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let gap;
        while ((gap = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, gap);
          buffer = buffer.slice(gap + 2);
          const event = (block.match(/^event: (.+)$/m) || [])[1];
          const data = (block.match(/^data: (.+)$/m) || [])[1];
          if (!event || !data) continue;
          const payload = JSON.parse(data);
          if (event === 'delta') onDelta(payload.text);
          if (event === 'actions' && onActions) onActions(payload.items);
          if (event === 'step' && onStep) onStep(payload.text, payload.skill || '');
          if (event === 'summary' && onSummary) onSummary(payload);
          if (event === 'file' && onFile) onFile(payload);
          if (event === 'pending' && onPending) onPending(payload);
          if (event === 'scout' && onScout) onScout(payload);
          if (event === 'dossier' && onDossier) onDossier(payload.name);
          if (event === 'error') onError(payload.text);
        }
      }
    },
  };
})();
