// Used by the automatic tests: starts Falcon's window server from an installed copy
// and checks that the page loads and (optionally) that the engine is awake behind it.
//   node ci-check.mjs <installed app folder> [--expect-ready]
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const appDir = process.argv[2];
const expectReady = process.argv.includes('--expect-ready');
const { startServer } = await import(pathToFileURL(path.join(appDir, 'src', 'app', 'server.js')).href);
const server = await startServer();
const base = `http://127.0.0.1:${server.port}`;
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${detail}`); if (!ok) failed = true; };

const page = await (await fetch(base + '/')).text();
check('window page loads', page.includes('F A L C O N'));
check('no token, no access', (await fetch(base + '/api/state')).status === 401);

const ask = async () => (await fetch(base + '/api/state', { headers: { 'X-Falcon-Token': server.token } })).json();
let state = await ask();
check('state answers', typeof state.configured === 'boolean', JSON.stringify(state));
if (expectReady) {
  // Right after setup Falcon re-learns his skills (and may move the engine into his folder) and says
  // "updating" meanwhile; the window waits for that, so the check does too: up to 5 minutes.
  for (let i = 0; i < 60 && state.configured && !state.ready; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    state = await ask();
  }
  check('engine is awake behind the window', state.configured && state.ready, JSON.stringify(state));
}

await server.close();
process.exit(failed ? 1 : 0);
