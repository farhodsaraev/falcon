// Falcon's voice: a live connection to OpenAI's Realtime API over WebRTC.
// The microphone goes out, Falcon's voice comes back, and interruptions are handled by the service.
// When the user asks for something to be done, the voice calls Falcon's hands through the same
// chat path the typed box uses, then speaks the result.
(() => {
  const listeners = { state: () => {}, heard: () => {}, said: () => {}, error: () => {}, note: () => {}, actions: () => {}, level: () => {} };
  const handled = new Set();
  let bufferReports = false;
  const actOnce = (call) => { if (!call.call_id || handled.has(call.call_id)) return; handled.add(call.call_id); actFor(call); };
  let pc = null;
  let channel = null;
  let mic = null;
  let audio = null;
  let spoken = '';
  let sound = null;        // AudioContext, used for loudness and the chime
  let micMeter = null;
  let voiceMeter = null;
  let meterTimer = null;
  let speaking = false;

  // A soft two-note chime when Falcon starts and stops listening.
  function chime(up) {
    if (!sound) return;
    const now = sound.currentTime;
    (up ? [523.25, 783.99] : [783.99, 523.25]).forEach((freq, i) => {
      const osc = sound.createOscillator();
      const gain = sound.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.11);
      gain.gain.linearRampToValueAtTime(0.07, now + i * 0.11 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.11 + 0.32);
      osc.connect(gain).connect(sound.destination);
      osc.start(now + i * 0.11);
      osc.stop(now + i * 0.11 + 0.36);
    });
  }

  // Loudness of a stream, 0 to 1, so the orb can move with the voices.
  function meter(stream) {
    const analyser = sound.createAnalyser();
    analyser.fftSize = 512;
    sound.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    return () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) { const centred = (value - 128) / 128; sum += centred * centred; }
      return Math.min(1, Math.sqrt(sum / data.length) * 4.5);
    };
  }
  function startMeters() {
    let smooth = 0;
    meterTimer = setInterval(() => {
      const source = speaking ? voiceMeter : micMeter;
      const level = source ? source() : 0;
      smooth = level > smooth ? level : smooth * 0.82 + level * 0.18;   // rise at once, fall gently
      listeners.level(smooth);
    }, 50);
  }

  const send = (event) => { if (channel?.readyState === 'open') channel.send(JSON.stringify(event)); };

  async function actFor(call) {
    let request = '';
    try { request = JSON.parse(call.arguments || '{}').request || ''; } catch { /* handled below */ }
    let result = '';
    if (!request) {
      result = 'The request was empty. Ask the user to repeat it.';
    } else {
      listeners.state('thinking');
      try {
        await window.falcon.chat(request, {
          onDelta: (piece) => { result += piece; },
          onActions: (items) => listeners.actions(items),
          onError: (message) => { result = message; },
        });
      } catch {
        result = 'The request could not be carried out because the connection to this computer was lost.';
      }
    }
    send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: call.call_id, output: result || 'Done.' } });
    send({ type: 'response.create' });
  }

  function onEvent(event) {
    switch (event.type) {
      case 'input_audio_buffer.speech_started': listeners.state('listening'); break;
      case 'input_audio_buffer.speech_stopped': listeners.state('thinking'); break;
      case 'output_audio_buffer.started': bufferReports = true; // falls through
      case 'response.output_audio.delta':
      case 'response.audio.delta': if (!speaking) { speaking = true; listeners.state('speaking'); } break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared': speaking = false; listeners.state('listening'); break;
      case 'response.output_item.done':
        // Some versions report a finished function call here as well; handle each call only once.
        if (event.item?.type === 'function_call' && event.item.name === 'ask_falcon') actOnce(event.item);
        break;
      case 'conversation.item.input_audio_transcription.completed': if (event.transcript) listeners.heard(event.transcript.trim()); break;
      case 'response.created': spoken = ''; break;
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta': spoken += event.delta || ''; listeners.said(spoken); break;
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done': if (event.transcript) { spoken = event.transcript; listeners.said(spoken); } break;
      case 'response.done':
        for (const item of event.response?.output || []) {
          if (item.type === 'function_call' && item.name === 'ask_falcon') actOnce(item);
        }
        // Normally the end of his speech is reported separately. If this service version never sends
        // that report, do not leave the orb "speaking" for ever: fall back to listening after a moment.
        if (speaking && !bufferReports) setTimeout(() => { if (speaking && pc) { speaking = false; listeners.state('listening'); } }, 1500);
        break;
      case 'error': listeners.note(event.error?.message || 'The voice connection reported a problem.'); break;
      default: break;
    }
  }

  async function start() {
    if (pc) return;
    listeners.state('connecting');
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      listeners.state('off');
      return listeners.error('I cannot hear you: the microphone is not allowed. Allow it for Falcon and try again.');
    }
    try {
      pc = new RTCPeerConnection();
      audio = document.createElement('audio');
      audio.autoplay = true;
      try {
        sound = new (window.AudioContext || window.webkitAudioContext)();
        micMeter = meter(mic);
      } catch { sound = null; /* the voice works without the meter and chime */ }
      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
        try { if (sound) voiceMeter = meter(e.streams[0]); } catch { /* no meter */ }
      };
      pc.addTrack(mic.getTracks()[0]);
      channel = pc.createDataChannel('oai-events');
      channel.addEventListener('message', (e) => { try { onEvent(JSON.parse(e.data)); } catch { /* ignore unreadable event */ } });
      pc.addEventListener('connectionstatechange', () => {
        if (pc && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) { stop(); listeners.error('The voice connection was lost.'); }
      });
      const watchdog = setTimeout(() => { if (pc && pc.connectionState !== 'connected') { stop(); listeners.error('The live voice did not connect.'); } }, 20000);
      pc.addEventListener('connectionstatechange', () => { if (pc && pc.connectionState === 'connected') clearTimeout(watchdog); });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const answer = await window.falcon.voiceSession(offer.sdp);
      if (!answer.ok) throw new Error(answer.error);
      await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
      if (answer.setupPending) {
        // The service accepted only a bare connection: send Falcon's manner and his one function now.
        const setup = await window.falcon.voiceSetup();
        const sendSetup = () => send({ type: 'session.update', session: { type: 'realtime', instructions: setup.instructions, tools: setup.tools, tool_choice: 'auto' } });
        if (channel.readyState === 'open') sendSetup(); else channel.addEventListener('open', sendSetup, { once: true });
      }
      if (sound) startMeters();
      chime(true);
      listeners.state('listening');
    } catch (err) {
      stop();
      listeners.error(err.message || 'The voice could not be started.');
    }
  }

  function stop() {
    if (pc && sound) chime(false);
    clearInterval(meterTimer);
    meterTimer = null; micMeter = null; voiceMeter = null; speaking = false;
    const closing = sound;
    sound = null;
    if (closing) setTimeout(() => closing.close().catch(() => {}), 700);   // let the chime finish
    try { channel?.close(); } catch { /* already closed */ }
    try { pc?.close(); } catch { /* already closed */ }
    for (const track of mic?.getTracks() || []) track.stop();
    if (audio) audio.srcObject = null;
    pc = null; channel = null; mic = null; audio = null;
    listeners.state('off');
  }

  window.falconVoice = {
    start,
    stop,
    active: () => Boolean(pc),
    on: (name, handler) => { listeners[name] = handler; },
  };
})();

// ---------------------------------------------------------------------------------------------
// Falcon's built-in voice: free, needs no key, works with any AI provider.
// It uses the speech the browser already has: speech recognition to hear, speech synthesis to speak.
// One turn at a time: he listens, works, speaks, then listens again. Press the microphone to stop;
// pressing it while he speaks cuts him off.
// ---------------------------------------------------------------------------------------------
(() => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis;
  const listeners = { state: () => {}, heard: () => {}, said: () => {}, error: () => {}, actions: () => {}, level: () => {} };
  let on = false;
  let recognition = null;
  let lang = 'en-GB';
  let pulse = null;
  let turn = 0;

  const isRussian = (text) => /[а-яё]/i.test(text);
  const address = () => (window.falconAddress ? window.falconAddress() : 'sir');

  // The calmest British voice this computer offers; a Russian one for Russian replies.
  function pickVoice(russian) {
    const voices = synth ? synth.getVoices() : [];
    if (russian) return voices.find((v) => /^ru/i.test(v.lang)) || null;
    const british = voices.filter((v) => /^en[-_]GB/i.test(v.lang));
    const preferred = ['Ryan', 'George', 'Daniel', 'Oliver', 'Arthur', 'UK English Male', 'Thomas'];
    for (const name of preferred) { const hit = british.find((v) => v.name.includes(name)); if (hit) return hit; }
    return british[0] || voices.find((v) => /^en/i.test(v.lang)) || null;
  }

  function stopPulse() { clearInterval(pulse); pulse = null; listeners.level(0); }
  function startPulse() {
    stopPulse();
    let t = 0;
    // There is no sound stream to measure here, so the orb follows a speaking rhythm instead.
    pulse = setInterval(() => { t += 1; listeners.level(0.35 + 0.3 * Math.abs(Math.sin(t / 2.1)) + 0.2 * Math.abs(Math.sin(t / 0.9))); }, 70);
  }

  function speak(text) {
    return new Promise((resolve) => {
      if (!synth || !text) return resolve();
      const utterance = new SpeechSynthesisUtterance(text);
      const russian = isRussian(text);
      const voice = pickVoice(russian);
      if (voice) utterance.voice = voice;
      utterance.lang = voice ? voice.lang : (russian ? 'ru-RU' : 'en-GB');
      utterance.rate = 1.0;
      utterance.pitch = 0.92;
      utterance.onstart = () => { listeners.state('speaking'); startPulse(); };
      utterance.onend = utterance.onerror = () => { stopPulse(); resolve(); };
      synth.speak(utterance);
    });
  }

  async function handle(text) {
    const mine = ++turn;
    listeners.heard(text);
    listeners.state('thinking');
    lang = isRussian(text) ? 'ru-RU' : 'en-GB';
    // Say a holding phrase if the answer is not ready quickly.
    const holding = setTimeout(() => { if (on && mine === turn) speak(isRussian(text) ? `Одну минуту, ${address()}.` : `One moment, ${address()}.`); }, 2200);
    let answer = '';
    try {
      await window.falcon.chat(text, {
        onDelta: (piece) => { answer += piece; },
        onActions: (items) => listeners.actions(items),
        onError: (message) => { answer = message; },
      });
    } catch {
      answer = `I have lost my connection, ${address()}. Please try again in a moment.`;
    }
    clearTimeout(holding);
    if (!on || mine !== turn) return;
    synth.cancel();                       // drop the holding phrase if it is still being said
    listeners.said(answer);
    await speak(window.falconPlain ? window.falconPlain(answer) : answer);
    if (on && mine === turn) listen();
  }

  function listen() {
    if (!on) return;
    recognition = new Recognition();
    recognition.lang = lang;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    let got = false;
    recognition.onstart = () => listeners.state('listening');
    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript.trim();
      if (text) { got = true; handle(text); }
    };
    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      on = false;
      listeners.state('off');
      listeners.error({
        'not-allowed': 'I cannot hear you: the microphone is not allowed. Allow it for Falcon and try again.',
        'service-not-allowed': 'Speech recognition is switched off on this computer.',
        'audio-capture': 'I cannot find a microphone on this computer.',
        network: 'I could not reach the speech service. Check the internet connection and try again.',
      }[event.error] || 'I could not hear you just now. Please try again.');
    };
    recognition.onend = () => { if (on && !got) listen(); };   // silence: keep listening
    try { recognition.start(); } catch { /* already starting */ }
  }

  window.falconSpeech = {
    supported: () => Boolean(Recognition && synth),
    start() {
      if (on) return;
      if (!this.supported()) return listeners.error('This browser has no built-in speech. Open Falcon in Chrome or Edge, or add an OpenAI key for the live voice.');
      on = true;
      // Listen in Russian when the user last wrote in Russian; otherwise he could never start in it.
      lang = window.falconLastRussian ? 'ru-RU' : 'en-GB';
      synth.getVoices();                 // ask early; some browsers load the list lazily
      listen();
    },
    stop() {
      on = false;
      turn++;
      try { recognition?.abort(); } catch { /* not running */ }
      if (synth) synth.cancel();
      stopPulse();
      listeners.state('off');
    },
    // Cut him off mid-sentence and listen again.
    interrupt() { if (on && synth?.speaking) { turn++; synth.cancel(); stopPulse(); listen(); return true; } return false; },
    active: () => on,
    on: (name, handler) => { listeners[name] = handler; },
    // For checks only: act as if this sentence had just been heard.
    simulateHeard(text) { on = true; return handle(text); },
    voiceFor: (russian) => { const v = pickVoice(russian); return v ? `${v.name} (${v.lang})` : null; },
  };
})();
