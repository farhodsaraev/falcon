import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Used by the explicit Readiness repair action; no workspace/skill contents are deleted.
export function syncTaskAddon(workspace) {
  if (!path.isAbsolute(workspace)) throw new Error('Invalid workspace');
  const source = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'falcon-agent', 'engine-addon');
  const dest = path.join(path.dirname(workspace), 'falcon-words');
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  for (const file of ['index.js', 'words.js', 'task-hooks.js', 'verification.js', 'inspect-slide.js', 'package.json', 'openclaw.plugin.json']) {
    fs.copyFileSync(path.join(source, file), path.join(dest, file));
  }
  return dest;
}
