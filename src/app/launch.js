// Starts Falcon's window: a small local server plus Microsoft Edge in "app mode"
// (no address bar, its own profile), so everything that runs is software Windows already trusts.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './server.js';

function findEdge() {
  return [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
    .filter(Boolean)
    .map((base) => path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
    .find((file) => fs.existsSync(file));
}

const server = await startServer();
const url = `http://127.0.0.1:${server.port}/#token=${server.token}`;
const edge = findEdge();

if (!edge) {
  console.log('Microsoft Edge was not found. Open this address in a browser:\n' + url);
} else {
  const started = Date.now();
  const window = spawn(edge, [
    `--app=${url}`,
    `--user-data-dir=${path.join(os.homedir(), '.falcon', 'window')}`,
    '--window-size=520,760',
    '--no-first-run',
    '--no-default-browser-check',
  ], { stdio: 'ignore' });
  console.log('Falcon is running. Close his window to stop.');
  window.on('exit', async () => {
    // If Edge handed the window to another process, keep serving until Ctrl+C.
    if (Date.now() - started < 5000) return;
    await server.close();
    process.exit(0);
  });
}
