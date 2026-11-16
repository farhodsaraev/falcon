import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();

export const CONFIG_PATH = path.join(process.env.APPDATA || home, 'Jarvis', 'config.json');

const defaults = {
  // Jarvis may only open, find and attach files inside these folders.
  allowedFolders: [
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
    path.join(home, 'Downloads'),
  ],
  // Spoken name -> email address, e.g. { "ahmed": "ahmed@example.com" }
  contacts: {},
  gmailUser: '',
};

export function loadConfig(file = CONFIG_PATH) {
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { ...defaults };
  }
}

export function saveConfig(config, file = CONFIG_PATH) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
}

/** True when the file sits inside one of the folders the user allowed. */
export function isAllowedPath(target, config) {
  const full = path.resolve(target).toLowerCase();
  return config.allowedFolders.some((folder) => {
    const root = path.resolve(folder).toLowerCase();
    return full === root || full.startsWith(root + path.sep);
  });
}
