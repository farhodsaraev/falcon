// Puts the engine's own name out of what Falcon sends. The user knows him only as Falcon.
// Careful by design: folder names such as ".openclaw" in a file path are left alone, so a path
// Falcon gives the user still leads to the file.

const COMMAND = /`openclaw(?:\s+[^`\n]+)?`/g;                       // `openclaw pairing approve …`
const COMMAND_LINE = /^[ \t>]*(?:\$\s*)?openclaw\s+[a-z][^\n]*$/gm;   // a whole line that is a command
const DOCS_LINK = /\(?<?https?:\/\/(?:docs\.)?openclaw\.ai[^\s)>]*>?\)?/gi;
const NAME = /(?<![\w./\\-])open[- ]?claw(?![\w/\\-])(?:'s|’s)?/gi;  // the name in a sentence, not in a path

export function falconWords(text) {
  if (typeof text !== 'string' || !/open[- ]?claw|🦞/i.test(text)) return text;
  return text
    .replace(COMMAND, "Falcon's window")
    .replace(COMMAND_LINE, '')
    .replace(DOCS_LINK, '')
    .replace(NAME, (match) => (/['’]s$/.test(match) ? "Falcon's" : 'Falcon'))
    .replace(/🦞\s?/gu, '')
    .replace(/```\s*```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}
