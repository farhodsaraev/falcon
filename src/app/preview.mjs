// A preview of a repair, before the owner approves it (the Workshop's Preview button).
//
//   node preview.mjs <workshop copy> <preview data folder>
//
// Starts the workshop copy's own window server, the way the start check does, and opens it in a window of
// its own. It talks to the same engine, so the owner can try the change, but it keeps a copy of his
// profile and chats in the preview folder, and every action that would change the engine or his settings is
// refused (server.js, PREVIEW_ALLOWED). Closing the window ends the preview.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [copy, data] = process.argv.slice(2);
if (!copy || !data || !fs.existsSync(path.join(copy, 'src', 'app', 'server.js'))) {
  console.error('Usage: node preview.mjs <workshop copy> <preview data folder>');
  process.exit(2);
}
const falcon = path.join(os.homedir(), '.falcon');
fs.rmSync(data, { recursive: true, force: true });
fs.mkdirSync(data, { recursive: true });
for (const file of ['profile.json', 'chats.json']) {
  try { fs.copyFileSync(path.join(falcon, file), path.join(data, file)); } catch { /* not there yet */ }
}

const { startServer } = await import(pathToFileURL(path.join(copy, 'src', 'app', 'server.js')).href);
let server = null;
const stop = async () => { try { await server?.close(); } catch { /* closing */ } process.exit(0); };
server = await startServer({
  port: 0,
  idleMs: 20000,
  onIdle: stop,
  engine: {
    preview: true,
    profileFile: () => path.join(data, 'profile.json'),
    chatsFile: () => path.join(data, 'chats.json'),
  },
});
const url = `http://127.0.0.1:${server.port}/#token=${server.token}`;
fs.writeFileSync(path.join(data, 'preview.json'), JSON.stringify({ pid: process.pid, port: server.port }));

const edge = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean)
  .map((base) => path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find((file) => fs.existsSync(file));
if (process.env.FALCON_NO_WINDOW === '1') {
  // automatic checks: the server alone
} else if (process.platform === 'win32' && edge) {
  spawn(edge, [`--app=${url}`, `--user-data-dir=${path.join(falcon, 'preview-window')}`, '--window-size=900,760', '--no-first-run', '--no-default-browser-check'],
    { stdio: 'ignore', detached: true }).unref();
} else if (process.platform === 'darwin') {
  spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
}
console.log(`Preview: ${url}`);
// Ends by itself once its window has been closed for a while (onIdle), or after an hour at most.
setTimeout(stop, 60 * 60000).unref();
