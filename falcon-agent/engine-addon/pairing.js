// The engine's first reply to a new Telegram user ("access not configured … approve with: <command>")
// goes straight to Telegram, past every add-on. Falcon puts his own words into that one message in
// the engine's files instead. It is redone after every engine update, and skipped (never guessed)
// when the engine's text is not the one this was written for.
import fs from 'node:fs';
import path from 'node:path';

const MARK = '/* falcon-pairing */';
const FALCON_REPLY = `${MARK}return [
		"Hello, this is Falcon.",
		"To let me answer you here, type this code in Falcon's window, under Telegram, and press Confirm:",
		"\`\`\`",
		code,
		"\`\`\`",
		"The code stays the same for an hour."
	].join("\\n");`;

/** Rewrites the pairing reply in the engine at engineDir. Returns 'done', 'already' or 'skipped'. */
export function patchPairingText(engineDir) {
  let dist;
  try { dist = path.join(engineDir, 'dist'); fs.accessSync(dist); } catch { return 'skipped'; }
  const files = fs.readdirSync(dist).filter((f) => /^pairing-messages[-.].*\.(m?js)$/.test(f));
  let result = 'skipped';
  for (const file of files) {
    const full = path.join(dist, file);
    const text = fs.readFileSync(full, 'utf8');
    if (text.includes(MARK)) { if (result === 'skipped') result = 'already'; continue; }
    const start = text.indexOf('function buildPairingReply(');
    if (start < 0 || !text.includes('access not configured')) continue;
    const from = text.indexOf('return [', start);
    const end = text.indexOf('].join("\\n");', from);
    // Only the one array that holds the engine's wording, inside this one function.
    if (from < 0 || end < 0 || !text.slice(from, end).includes('access not configured')) continue;
    if (!/const \{[^}]*\bcode\b[^}]*\} = params;/.test(text.slice(start, from))) continue;
    fs.writeFileSync(full, text.slice(0, from) + FALCON_REPLY + text.slice(end + '].join("\\n");'.length));
    result = 'done';
  }
  return result;
}
