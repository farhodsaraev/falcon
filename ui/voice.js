// Falcon's voice: a live connection to OpenAI's Realtime API over WebRTC.
// The microphone goes out, Falcon's voice comes back, and interruptions are handled by the service.
// When the user asks for something to be done, the voice calls Falcon's hands through the same
// chat path the typed box uses, then speaks the result.
(() => {
  const listeners = { state: () => {}, heard: () => {}, said: () => {}, error: () => {}, actions: () => {}, level: () => {} };
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
      case 'output_audio_buffer.started': speaking = true; listeners.state('speaking'); break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared': speaking = false; listeners.state('listening'); break;
      case 'conversation.item.input_audio_transcription.completed': if (event.transcript) listeners.heard(event.transcript.trim()); break;
      case 'response.created': spoken = ''; break;
      case 'response.output_audio_transcript.delta': spoken += event.delta || ''; listeners.said(spoken); break;
      case 'response.done':
        for (const item of event.response?.output || []) {
          if (item.type === 'function_call' && item.name === 'ask_falcon') actFor(item);
        }
        break;
      case 'error': listeners.error(event.error?.message || 'The voice connection reported a problem.'); break;
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
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const answer = await window.falcon.voiceSession(offer.sdp);
      if (!answer.ok) throw new Error(answer.error);
      await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
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
