// -----------------------------------------------------------------------------
// Scene triggers of the StorCube integration: one event per transition, never
// at the first reading (the state is learned silently), never from a write.
//
//   - `battery_full`      the level reaches 100 %; again once it went under 95 %;
//   - `battery_empty`     the level reaches the discharge threshold (the battery
//                         stops sending power); again once it is 5 points above;
//   - `battery_offline`   no frame from the battery for 20 minutes while the
//                         cloud answers; `battery_online` when frames come back;
//   - `firmware_update`   the cloud offers a new firmware (once per version);
//   - `access_refused`    the cloud refuses the login (once per refusal).
//
// A value to compare (> or <) is a device feature, not a trigger: the level
// and powers are features, these events are what happens.
// -----------------------------------------------------------------------------

import { solarOf } from './parse.js';

const TRIGGERS = {
  BATTERY_FULL: 'battery_full',
  BATTERY_EMPTY: 'battery_empty',
  BATTERY_OFFLINE: 'battery_offline',
  BATTERY_ONLINE: 'battery_online',
  FIRMWARE_UPDATE: 'firmware_update',
  ACCESS_REFUSED: 'access_refused',
};

const FULL = 100;
const FULL_REARM = 95;
const EMPTY_MARGIN = 5;
const DEFAULT_THRESHOLD = 10;
const OFFLINE_MS = 20 * 60 * 1000;

/**
 * @description The level transitions of a battery.
 * @param {object} seen - What the triggers know about it (mutated).
 * @param {number|null} soc - The level now.
 * @param {number|null} threshold - The discharge threshold (%).
 * @returns {string[]} The triggers to fire.
 */
function detectLevel(seen, soc, threshold) {
  if (!Number.isFinite(soc)) {
    return [];
  }
  const fired = [];
  const limit = Number.isFinite(threshold) ? threshold : DEFAULT_THRESHOLD;
  const first = seen.full === undefined;
  const full = soc >= FULL;
  const empty = soc <= limit;
  if (first) {
    seen.full = full;
    seen.empty = empty;
    return [];
  }
  if (full && !seen.full) {
    fired.push(TRIGGERS.BATTERY_FULL);
    seen.full = true;
  } else if (seen.full && soc < FULL_REARM) {
    seen.full = false;
  }
  if (empty && !seen.empty) {
    fired.push(TRIGGERS.BATTERY_EMPTY);
    seen.empty = true;
  } else if (seen.empty && soc >= limit + EMPTY_MARGIN) {
    seen.empty = false;
  }
  return fired;
}

/**
 * @description The connection transitions of the master battery.
 * @param {object} seen - What the triggers know (mutated).
 * @param {object} options - `{ lastFrameAt, now, cloudOk }`.
 * @returns {string|null} The trigger to fire.
 */
function detectOffline(seen, { lastFrameAt, now, cloudOk }) {
  if (!Number.isFinite(lastFrameAt)) {
    return null;
  }
  const silent = now - lastFrameAt > OFFLINE_MS;
  if (silent && cloudOk && !seen.offline) {
    seen.offline = true;
    seen.offlineSince = lastFrameAt;
    return TRIGGERS.BATTERY_OFFLINE;
  }
  if (!silent && seen.offline) {
    seen.offline = false;
    seen.offlineSince = null;
    return TRIGGERS.BATTERY_ONLINE;
  }
  return null;
}

/**
 * @description Whether a new firmware deserves an event.
 * @param {object} seen - What the triggers know (mutated).
 * @param {object|null} firmware - parseFirmware().
 * @returns {boolean} Fire.
 */
function detectFirmware(seen, firmware) {
  if (!firmware) {
    return false;
  }
  // An update already offered at the first reading is announced too (the
  // user wants to know), once per version.
  if (!firmware.upgrade || !firmware.available) {
    return false;
  }
  if (seen.firmwareAnnounced === firmware.available) {
    return false;
  }
  seen.firmwareAnnounced = firmware.available;
  return true;
}

/**
 * @description Round a value for the scene variables.
 * @param {unknown} value - The value.
 * @param {number} [decimals] - Decimals.
 * @returns {number|null} The number.
 */
const rounded = (value, decimals = 0) =>
  Number.isFinite(value) ? Math.round(value * 10 ** decimals) / 10 ** decimals : null;

/**
 * @description The data of a battery event (flat, scalars only).
 * @param {object} options - `{ externalId, name, equipId, reading, threshold }`.
 * @returns {object} The data.
 */
function batteryData({ externalId, name, equipId, reading, threshold }) {
  return {
    battery: externalId,
    battery_name: name,
    equip_id: equipId,
    battery_level: rounded(reading?.soc),
    threshold: rounded(threshold),
    pv_power_w: reading ? rounded(solarOf(reading)) : null,
    output_power_w: rounded(reading?.output),
  };
}

export {
  TRIGGERS,
  FULL,
  FULL_REARM,
  EMPTY_MARGIN,
  DEFAULT_THRESHOLD,
  OFFLINE_MS,
  detectLevel,
  detectOffline,
  detectFirmware,
  batteryData,
  rounded,
};
