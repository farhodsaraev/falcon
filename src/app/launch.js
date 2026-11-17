// Starts Falcon's window: a small local server plus a browser in "app mode"
// (no address bar, its own profile). Uses a browser the computer already trusts:
// Microsoft Edge on Windows; Chrome, Edge or Brave on a Mac, or the default browser if none is found.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
const server = await startServer({
  onIdle: async () => {
    try { window?.kill(); } catch { /* already gone */ }
    await server.close();
    process.exit(0);
  },
});
const url = `http://127.0.0.1:${server.port}/#token=${server.token}`;
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
