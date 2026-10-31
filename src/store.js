// -----------------------------------------------------------------------------
// What the integration keeps across restarts, under /data (the only writable
// place of the container), in /data/storcube.json:
//
//   - `token`         the token of the StorCube cloud and when it was issued
//                     (assumed valid 12 hours: the API gives no expiry), so a
//                     restart does not log in again (the cloud tolerates
//                     several sessions of one account badly);
//   - `account`       the login and master battery the token and the data
//                     belong to: another account starts from scratch;
//   - `batteries`     per equipId: `{ master, model, seenAt }`;
//   - `readings`      per equipId: the last frame made safe, and when;
//   - `scene`         the settings of the stack and when they were read;
//   - `firmware`      the firmware of the master and when it was read;
//   - `lastSetpoint`  the last output setpoint above 0 W ("resume" of the
//                     injection switch);
//   - `seen`          what the scene triggers know (one event per transition);
//   - `accessRefused` why the cloud refuses the login, or null;
//   - `lastError`     the last error of a reading (diagnostic).
// The password is never written there.
// -----------------------------------------------------------------------------

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DEFAULT_DIR = '/data';
const FILE = 'storcube.json';
const EMPTY = () => ({
  token: null,
  account: null,
  batteries: {},
  readings: {},
  scene: null,
  firmware: null,
  lastSetpoint: null,
  seen: {},
  accessRefused: null,
  lastError: null,
});

/**
 * @description Read a JSON file; an absent or broken file is null.
 * @param {string} path - The file.
 * @param {object} [logger] - Logger.
 * @returns {Promise<object|null>} The value.
 */
async function readJson(path, logger) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger?.warn(`Unable to read ${path}: ${err.message}`);
    }
    return null;
  }
}

/**
 * @description Write a JSON file atomically (a temporary file, then a rename).
 * @param {string} path - The file.
 * @param {object} value - The value.
 * @param {object} [logger] - Logger.
 * @returns {Promise<void>}
 */
async function writeJson(path, value, logger) {
  try {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(value));
    await rename(temporary, path);
  } catch (err) {
    logger?.warn(`Unable to write ${path}: ${err.message}`);
  }
}

/**
 * @description The store.
 * @param {object} [options] - `{ dir, logger }`.
 * @returns {object} `{ data, load, save }`.
 */
function createStore({ dir = DEFAULT_DIR, logger } = {}) {
  const path = join(dir, FILE);
  let writing = Promise.resolve();
  const store = {
    data: EMPTY(),
    /**
     * @description Read the file.
     * @returns {Promise<void>}
     */
    async load() {
      const raw = (await readJson(path, logger)) ?? {};
      const part = (value) =>
        value && typeof value === 'object' && !Array.isArray(value) ? value : null;
      store.data = EMPTY();
      store.data.token =
        typeof raw.token?.value === 'string' && Number.isFinite(raw.token?.at) ? raw.token : null;
      store.data.account = typeof raw.account === 'string' ? raw.account : null;
      store.data.batteries = { ...part(raw.batteries) };
      store.data.readings = { ...part(raw.readings) };
      store.data.scene = part(raw.scene);
      store.data.firmware = part(raw.firmware);
      store.data.lastSetpoint = Number.isFinite(raw.lastSetpoint) ? raw.lastSetpoint : null;
      store.data.seen = { ...part(raw.seen) };
      store.data.accessRefused = part(raw.accessRefused);
      store.data.lastError = part(raw.lastError);
    },
    /**
     * @description Write the state (one write at a time).
     * @returns {Promise<void>}
     */
    save() {
      writing = writing.then(() => writeJson(path, store.data, logger));
      return writing;
    },
  };
  return store;
}

export { DEFAULT_DIR, FILE, EMPTY, createStore };
