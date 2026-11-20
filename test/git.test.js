// Git for the workshop: found on the computer, or the portable copy installed from Git for Windows'
// official release after its checksum is checked. The download here is pretend; nothing is fetched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { falconGitDir, findGit, installPortableGit, MARKER } from '../src/app/git.js';

const windows = process.platform === 'win32';
const ZIP = Buffer.from('pretend MinGit zip');
const DIGEST = `sha256:${crypto.createHash('sha256').update(ZIP).digest('hex')}`;
const URL = 'https://github.com/git-for-windows/git/releases/download/v2.99.0.windows.1/MinGit-2.99.0-64-bit.zip';

function release({ digest = DIGEST, url = URL, name = 'MinGit-2.99.0-64-bit.zip' } = {}) {
  const asked = [];
  const fetchImpl = async (u) => {
    asked.push(String(u));
    if (String(u).includes('api.github.com')) {
      return new Response(JSON.stringify({ assets: [
        { name: 'MinGit-2.99.0-busybox-64-bit.zip', digest: DIGEST, browser_download_url: URL.replace('MinGit-2.99.0', 'MinGit-2.99.0-busybox') },
        { name, digest, browser_download_url: url },
      ] }), { status: 200 });
    }
    return new Response(ZIP, { status: 200 });
  };
  return { fetchImpl, asked };
}

// Pretend unpacking: a git.exe that is really a copy of a working Git, so "it starts" can be checked.
const realGit = findGit();
const extract = async (zip, dir) => {
  fs.mkdirSync(path.join(dir, 'cmd'), { recursive: true });
  if (realGit) fs.copyFileSync(realGit, path.join(dir, 'cmd', 'git.exe'));
};

test('the portable Git is installed only from Git for Windows, only with a matching checksum', { skip: (!windows || !realGit) && 'Windows with Git only' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-git-'));
  const { fetchImpl, asked } = release();
  const r = await installPortableGit({ home, fetchImpl, extract });
  // A copied git.exe cannot always run outside its own folder; what matters here is which file was chosen and checked.
  assert.ok(asked.includes(URL), 'the plain 64-bit MinGit was chosen, not the busybox one');
  if (r.ok) {
    assert.ok(fs.existsSync(path.join(falconGitDir(home), MARKER)), 'marked as Falcon\'s own, so his uninstaller may remove it');
  } else {
    assert.match(r.error, /does not start/);
  }
  assert.ok(!fs.existsSync(path.join(path.dirname(falconGitDir(home)), 'git-download.zip')), 'the download is not left behind');
});

test('a wrong checksum, no checksum, or a download from elsewhere is refused and nothing is installed', { skip: !windows && 'Windows only' }, async () => {
  for (const [what, options, said] of [
    ['wrong checksum', { digest: `sha256:${'0'.repeat(64)}` }, /did not match its checksum/],
    ['no checksum', { digest: '' }, /does not publish a checksum/],
    ['another place', { url: 'https://example.com/MinGit-2.99.0-64-bit.zip' }, /not from Git for Windows/],
    ['no portable copy', { name: 'Git-2.99.0-64-bit.exe' }, /no portable copy/],
  ]) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-git-'));
    const { fetchImpl } = release(options);
    const r = await installPortableGit({ home, fetchImpl, extract });
    assert.equal(r.ok, false, what);
    assert.match(r.error, said, what);
    assert.ok(!fs.existsSync(falconGitDir(home)), `${what}: nothing installed`);
  }
});

test('the computer\'s own Git is used when there is one, unless told to pretend there is none', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-git-'));
  assert.equal(findGit({ home, env: { ...process.env, FALCON_PRETEND_NO_GIT: '1' } }), null);
  if (realGit) assert.ok(findGit({ home }));
});
