// Starts Falcon's window: a small local server plus a browser in "app mode"
// (no address bar, its own profile). Uses a browser the computer already trusts:
// Microsoft Edge on Windows; Chrome, Edge or Brave on a Mac, or the default browser if none is found.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.js';

function findAppBrowser() {
  if (process.platform === 'win32') {
    return [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
      .filter(Boolean)
      .map((base) => path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
      .find((file) => fs.existsSync(file));
  }
  if (process.platform === 'darwin') {
    const apps = [
      'Google Chrome.app/Contents/MacOS/Google Chrome',
      'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      'Brave Browser.app/Contents/MacOS/Brave Browser',
      'Chromium.app/Contents/MacOS/Chromium',
    ];
    return ['/Applications', path.join(os.homedir(), 'Applications')]
      .flatMap((dir) => apps.map((app) => path.join(dir, app)))
      .find((file) => fs.existsSync(file));
  }
  return undefined;
}

let window = null;
// Falcon stops when his window has been closed for a while, or when the user presses Quit in Settings.
const onIdle = async () => {
  try { window?.kill(); } catch { /* already gone */ }
  await server.close();
  process.exit(0);
};
// The same local address every time, so the window keeps what the browser remembers for it between
// starts (the microphone permission, small choices). If that address is taken, any free one will do.
let server;
try { server = await startServer({ port: 47615, onIdle }); } catch { server = await startServer({ onIdle }); }
const url = `http://127.0.0.1:${server.port}/#token=${server.token}`;
// Where the keyboard shortcut (Ctrl+Alt+Space, held by the icon by the clock) finds this window to ask it
// to listen. Readable by this user only; replaced at every start.
try {
  const where = path.join(os.homedir(), '.falcon', 'window.json');
  fs.mkdirSync(path.dirname(where), { recursive: true });
  fs.writeFileSync(where, JSON.stringify({ port: server.port, token: server.token }), { mode: 0o600 });
} catch { /* the shortcut still brings the window forward */ }

// Windows: Falcon's icon among the hidden icons, by the clock. It stays when the window is closed, so he
// can be opened again from there. The icon allows only one copy of itself, so starting it again is harmless.
const tray = path.join(path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))), 'installer', 'tray.ps1');
if (process.platform === 'win32' && fs.existsSync(tray)) {
  try {
    spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', tray, '-Node', process.execPath, '-Launch', fileURLToPath(import.meta.url)],
      { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch { /* Falcon works without the icon */ }
}
const browser = findAppBrowser();

if (browser) {
  const started = Date.now();
  window = spawn(browser, [
    `--app=${url}`,
    `--user-data-dir=${path.join(os.homedir(), '.falcon', 'window')}`,
    '--window-size=520,760',
    '--no-first-run',
    '--no-default-browser-check',
  ], { stdio: 'ignore' });
  console.log('Falcon is running. Close his window to stop.');
  window.on('exit', async () => {
    // If the browser handed the window to another process, keep serving: Falcon stops by himself once
    // his window has been gone for half a minute (see onIdle above).
    if (Date.now() - started < 5000) return;
    await server.close();
    process.exit(0);
  });
} else if (process.platform === 'darwin') {
  // No app-mode browser on this Mac: open Falcon as a page in the default browser (Safari).
  spawn('open', [url], { stdio: 'ignore' });
  console.log('Falcon is running in your browser. Press Ctrl+C here to stop.');
} else {
  console.log('Open this address in a browser:\n' + url);
}
