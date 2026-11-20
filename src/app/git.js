// Git for Falcon's local history and his workshop (self-repair plan, stage 2).
// Git is a standard tool that records every change to a set of files. Falcon uses the computer's own Git
// when it has one; on a Windows PC without Git he installs a small portable copy ("MinGit", about 30 MB,
// no administrator password) from Git for Windows' official releases, checked against its published
// checksum, into ~/.falcon/git. His uninstaller removes that copy, and never a Git that was there before.
import { execFile, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WINDOWS = process.platform === 'win32';
const RELEASES = 'https://api.github.com/repos/git-for-windows/git/releases/latest';
const DOWNLOADS = 'https://github.com/git-for-windows/git/releases/download/';
const MAX_DOWNLOAD = 120 * 1024 * 1024;

export const falconGitDir = (home = os.homedir()) => path.join(home, '.falcon', 'git');
const portableGit = (home) => path.join(falconGitDir(home), 'cmd', WINDOWS ? 'git.exe' : 'git');
export const MARKER = 'installed-by-falcon.txt';

/** Git settings and surroundings that keep Falcon's use of Git private and predictable. */
export function gitEnv(base = process.env) {
  return {
    ...base,
    GIT_TERMINAL_PROMPT: '0',       // never wait for a password
    GIT_CONFIG_NOSYSTEM: '1',       // ignore the computer's Git settings (signing, hooks, helpers)
    GIT_CONFIG_GLOBAL: '/dev/null', // and the user's own (Git for Windows also reads /dev/null as empty)
    GIT_OPTIONAL_LOCKS: '0',
  };
}

function works(git) {
  try { return /git version/.test(execFileSync(git, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return false; }
}

/**
 * The Git to use: Falcon's own portable copy, else the computer's. Null when there is none.
 * FALCON_PRETEND_NO_GIT=1 (for checks only) ignores the computer's own Git.
 */
export function findGit({ home = os.homedir(), env = process.env } = {}) {
  if (fs.existsSync(portableGit(home)) && works(portableGit(home))) return portableGit(home);
  if (env.FALCON_PRETEND_NO_GIT === '1') return null;
  const candidates = [];
  try {
    const out = execFileSync(WINDOWS ? 'where.exe' : 'which', ['git'], { encoding: 'utf8', windowsHide: true, timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] });
    candidates.push(...out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  } catch { /* not on PATH */ }
  if (WINDOWS) {
    candidates.push(path.join(env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd', 'git.exe'),
      path.join(env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd', 'git.exe'));
  } else {
    // On a Mac, /usr/bin/git only asks to install developer tools when they are missing: use it only if they are there.
    let tools = false;
    try { execFileSync('xcode-select', ['-p'], { stdio: 'ignore', timeout: 10000 }); tools = true; } catch { /* no developer tools */ }
    candidates.push('/opt/homebrew/bin/git', '/usr/local/bin/git', ...(tools ? ['/usr/bin/git'] : []));
  }
  return candidates.find((git) => fs.existsSync(git) && works(git)) || null;
}

/**
 * Installs MinGit (64-bit or ARM) from Git for Windows' latest official release into ~/.falcon/git,
 * after checking the download against the checksum GitHub publishes for it. Windows only.
 * @returns {Promise<{ok: boolean, git?: string, version?: string, error?: string}>}
 */
export async function installPortableGit({ home = os.homedir(), fetchImpl = fetch, arch = process.arch, onLine = () => {}, extract = extractZip } = {}) {
  if (!WINDOWS) return { ok: false, error: 'Falcon installs Git by himself on Windows only.' };
  const fail = (error) => ({ ok: false, error });
  let release;
  try {
    const response = await fetchImpl(RELEASES, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'falcon-assistant' }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) return fail(`The Git release list could not be read (${response.status}).`);
    release = await response.json();
  } catch { return fail('The Git release list could not be reached.'); }
  const want = arch === 'arm64' ? /^MinGit-[\d.]+-arm64\.zip$/ : /^MinGit-[\d.]+-64-bit\.zip$/;
  const asset = (Array.isArray(release?.assets) ? release.assets : []).find((a) => want.test(String(a?.name || '')));
  if (!asset) return fail('The Git release has no portable copy for this computer.');
  const expected = /^sha256:([a-f0-9]{64})$/.exec(String(asset.digest || ''))?.[1];
  if (!expected) return fail('The Git release does not publish a checksum, so it was not installed.');
  const url = String(asset.browser_download_url || '');
  if (!url.startsWith(DOWNLOADS)) return fail('The Git download is not from Git for Windows itself, so it was not installed.');
  onLine(`Downloading Git (${asset.name})`);
  let bytes;
  try {
    const response = await fetchImpl(url, { headers: { 'User-Agent': 'falcon-assistant' }, signal: AbortSignal.timeout(10 * 60000) });
    if (!response.ok) return fail(`Git could not be downloaded (${response.status}).`);
    bytes = Buffer.from(await response.arrayBuffer());
  } catch { return fail('Git could not be downloaded.'); }
  if (bytes.length > MAX_DOWNLOAD) return fail('The Git download is far larger than expected, so it was not installed.');
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== expected) return fail('The Git download did not match its checksum, so it was not installed.');

  const target = falconGitDir(home);
  const staging = `${target}.new`;
  const zip = path.join(path.dirname(target), 'git-download.zip');
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(zip, bytes);
    onLine('Unpacking Git');
    await extract(zip, staging);
    fs.writeFileSync(path.join(staging, MARKER), `${asset.name}\n${expected}\n`);
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staging, target);
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    return fail(`Git could not be unpacked: ${err.message}`);
  } finally {
    fs.rmSync(zip, { force: true });
  }
  const git = portableGit(home);
  if (!works(git)) return fail('Git was unpacked but does not start.');
  return { ok: true, git, version: String(asset.name) };
}

// Windows 10 and 11 come with tar, which unpacks zip files.
function extractZip(zip, dir) {
  return new Promise((resolve, reject) => {
    execFile('tar.exe', ['-xf', zip, '-C', dir], { windowsHide: true, timeout: 5 * 60000 }, (err) => (err ? reject(err) : resolve()));
  });
}

/** Git to use, installing the portable copy first when the computer has none (Windows). */
export async function ensureGit(options = {}) {
  const found = findGit(options);
  if (found) return { ok: true, git: found, installed: false };
  const result = await installPortableGit(options);
  return result.ok ? { ...result, installed: true } : result;
}
