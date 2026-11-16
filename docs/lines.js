// Everything Falcon says on the landing page.
// One entry = one recording (docs/voice/<name>.wav). Each string is one paragraph on screen.
// After changing any text here, run:  node scripts/make-voice.mjs
window.FALCON_LINES = {
  intro: [
    'Good day, and welcome. I am Falcon.',
    'I am a private assistant who lives on your own computer. Tell me what you need in plain words, by voice or in writing, and I see to it. I open your presentation on the very slide you want. I find the file you lost. I tell you what is on your screen, and I work in the browser on your behalf.',
    'And before I send, delete or run anything unfamiliar, I ask you first.',
  ],
  mac: [
    'Installing me on a Mac takes one line and a few minutes. The steps are below; follow them one by one. Open Terminal, paste the line, press Return, and wait until my window opens. Nothing will ask you for a password.',
    'When my window opens, paste your AI key, tick the box, and press Start. Then press the microphone and simply talk. I shall be at your service.',
  ],
  windows: [
    'Installing me on Windows takes one line and a few minutes. The steps are below; follow them one by one. Open PowerShell, paste the line, press Enter, and wait until my window opens. Nothing will ask you for a password.',
    'When my window opens, paste your AI key, tick the box, and press Start. Then press the microphone and simply talk. I shall be at your service.',
  ],
  other: [
    'I live on Mac and Windows computers. Open this page on yours, and installing me takes one line and a few minutes. The steps for both are below.',
  ],
  what: [
    'I open presentations on the slide you ask for, find files, describe what is on your screen, work in the browser, and remember what you tell me.',
    'You may also reach me from your phone through Telegram, and each morning I can send you the weather and the headlines of the day. When you ask, I look through your calendar and your mail. I answer in English or Russian.',
  ],
  need: [
    'A Mac, or a PC with Windows 10 or 11, and an AI key from OpenAI, Anthropic or OpenRouter.',
    'An OpenAI key gives me both my mind and my voice, so one key is enough.',
  ],
  safe: [
    'Your AI key stays on your computer. Passwords I leave to you: I fill in the rest and ask you to type them yourself. Installing me needs no administrator password.',
    'And before I send, delete or run anything unfamiliar, I show you exactly what I intend, and I wait. If nobody answers, I refuse.',
  ],
  copiedMac: ['Copied. Now click inside Terminal, paste the line, and press Return.'],
  copiedWindows: ['Copied. Now click inside PowerShell, paste the line, and press Enter.'],
};
