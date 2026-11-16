// Connects the window to Falcon's local server on this PC.
(() => {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('token') || '';
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
    // Sends the window's connection offer; the server adds the key and Falcon's voice settings.
    async voiceSession(sdp) {
      const response = await fetch('/api/voice/session', { method: 'POST', headers: { 'Content-Type': 'application/sdp', 'X-Falcon-Token': token }, body: sdp });
      if (response.ok) return { ok: true, sdp: await response.text() };
      let error = 'The voice could not be started.';
      try { error = (await response.json()).error || error; } catch { /* keep the default */ }
      return { ok: false, error };
    },
    currentModel: () => call('GET', '/api/model'),
    answerApproval: (id, decision) => call('POST', '/api/approval', { id, decision }),
    profile: () => call('GET', '/api/profile'),
    saveProfile: (profile) => call('POST', '/api/profile', profile),
    saveKey: (key, model) => call('POST', '/api/key', { key, model }),
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
    async chat(text, { onDelta, onError, onActions }) {
      const response = await fetch('/api/chat', { method: 'POST', headers, body: JSON.stringify({ text }) });
      if (!response.ok || !response.body) return onError('I have lost my connection, sir.');
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
          if (event === 'error') onError(payload.text);
        }
      }
    },
  };
})();
