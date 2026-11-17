import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { falconWords } from '../falcon-agent/engine-addon/words.js';
import addon from '../falcon-agent/engine-addon/index.js';
import { patchPairingText } from '../falcon-agent/engine-addon/pairing.js';

test('the engine\'s name never reaches the user', () => {
  assert.equal(falconWords('OpenClaw could not reply. Try again.'), 'Falcon could not reply. Try again.');
  assert.equal(falconWords('OpenClaw is busy. Check status before trying again.'), 'Falcon is busy. Check status before trying again.');
  assert.equal(falconWords('Ask the person who manages OpenClaw for access.'), 'Ask the person who manages Falcon for access.');
  assert.equal(falconWords('🦞 OpenClaw 2026.11.4 status'), 'Falcon 2026.11.4 status');
  assert.equal(falconWords("Open-Claw's memory"), "Falcon's memory");
  assert.equal(falconWords('Run `openclaw doctor --fix` to repair it.'), "Run Falcon's window to repair it.");
  assert.equal(falconWords('Fix it with:\n```\nopenclaw pairing approve telegram AB12CD34\n```\nThanks'), 'Fix it with:\n\nThanks');
  assert.equal(falconWords('Details: https://docs.openclaw.ai/cli/status'), 'Details:');
  for (const reply of [falconWords('Done, sir.'), falconWords('')]) assert.doesNotMatch(reply, /claw/i);
});

test('file paths and ordinary words are left alone', () => {
  const p = 'Saved to C:\\Users\\anna\\.openclaw\\workspace\\report.pdf and ~/.openclaw/workspace/notes.md';
  assert.equal(falconWords(p), p);
  assert.equal(falconWords('The crab has a claw.'), 'The crab has a claw.');
  assert.equal(falconWords(42), 42);
});

test('the add-on rewrites outgoing messages and leaves clean ones untouched', () => {
  const hooks = {};
  addon.register({ on: (name, handler) => { hooks[name] = handler; } });
  assert.deepEqual(hooks.message_sending({ to: 'x', content: 'OpenClaw could not reply.' }), { content: 'Falcon could not reply.' });
  assert.equal(hooks.message_sending({ to: 'x', content: 'Hello, sir.' }), undefined);
  assert.deepEqual(hooks.reply_payload_sending({ payload: { text: 'OpenClaw is busy.', mediaUrl: 'a.png' } }), { payload: { text: 'Falcon is busy.', mediaUrl: 'a.png' } });
  assert.equal(hooks.reply_payload_sending({ payload: { mediaUrl: 'a.png' } }), undefined);
});

const ENGINE_PAIRING = `import { t as formatCliCommand } from "./command-format-CMLYVZ3m.mjs";
//#region src/pairing/pairing-messages.ts
function buildPairingReply(params) {
	const { channel, idLine, code } = params;
	return [
		"OpenClaw: access not configured.",
		"",
		idLine,
		"Pairing code:",
		"\`\`\`",
		code,
		"\`\`\`",
		"",
		"Ask the bot owner to approve with:",
		"\`\`\`",
		formatCliCommand(\`openclaw pairing approve \${channel} \${code}\`),
		"\`\`\`"
	].join("\\n");
}
//#endregion
export { buildPairingReply as t };
`;

test('the first Telegram reply is put into Falcon\'s words, once, and an unknown text is left alone', async () => {
  const engine = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-engine-'));
  fs.mkdirSync(path.join(engine, 'dist'));
  const file = path.join(engine, 'dist', 'pairing-messages-6LIQ19EB.mjs');
  fs.writeFileSync(file, ENGINE_PAIRING);
  fs.writeFileSync(path.join(engine, 'dist', 'command-format-CMLYVZ3m.mjs'), 'export const t = (s) => s;');
  assert.equal(patchPairingText(engine), 'done');
  const { t: reply } = await import(`file:///${file.replace(/\\/g, '/')}`);
  const text = reply({ channel: 'telegram', idLine: 'Your id: 1', code: 'AB12CD34' });
  assert.match(text, /this is Falcon/);
  assert.match(text, /AB12CD34/);
  assert.doesNotMatch(text, /claw|approve with/i);
  assert.equal(patchPairingText(engine), 'already');

  fs.writeFileSync(file, 'function buildPairingReply(params) { return ["Something else entirely"].join("\\n"); }');
  assert.equal(patchPairingText(engine), 'skipped');
  assert.equal(patchPairingText(path.join(engine, 'missing')), 'skipped');
  fs.rmSync(engine, { recursive: true, force: true });
});
