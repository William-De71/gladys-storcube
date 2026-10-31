// -----------------------------------------------------------------------------
// The devices of the integration, offered on the Discovery screen.
//
// One device per StorCube battery (its serial number, the equipId), in a
// stable order: the master battery first (the one of the configuration, wired
// to the panels and the micro-inverter), then the expansion batteries of the
// stack. The categories follow the contracts of the Gladys core
// (server/utils/constants.js, master of 2026-10-31):
//   - `battery_level`            battery-storage / battery-level (%);
//   - `battery_energy_remaining` battery-storage / battery-energy-remaining
//                                (kWh: `capacity` of the frames is the energy
//                                still stored, in Wh, not the size);
//   - `battery_charge_power`     battery-storage / charge-power (W, >= 0) and
//   - `battery_discharge_power`  battery-storage / discharge-power (W, >= 0):
//                                worked out as solar minus output (the API has
//                                no battery power), split in two directions;
//   - `pv_power`                 energy-production-sensor / power (W): PV1 + PV2;
//   - `output_power`             home-output-sensor / power (W): what the
//                                battery sends to the micro-inverter, "the
//                                power the device itself delivers to the home";
//   - `output_setpoint`          switch / dimmer (W, 0 to 800, step 10,
//                                writable): the output setpoint. No core type
//                                is a power setpoint; the dimmer is the
//                                writable level the dashboard shows as a slider
//                                and the scenes can set;
//   - `output_enabled`           switch / binary (writable): injection on
//                                (setpoint > 0) or off (0 W);
//   - `discharge_threshold`      switch / dimmer (0 to 100, writable): the
//                                level under which the battery stops sending
//                                power. No unit: % is not a unit of the switch
//                                category; the name says it;
//   - `temperature`              device-temperature-sensor / decimal (°C): the
//                                battery's own temperature, kept out of the
//                                temperature of the room.
// Expansion batteries only report their level, stored energy and temperature.
//
// No energy index: the frames come irregularly (sometimes minutes apart), an
// index integrated from them would be a guess; Gladys keeps the history of
// the powers.
//
// External ids: `ext:<selector>:battery:<equipId>`, features `…:<key>`.
// `should_poll` stays false: the data come from the cloud stream and timer.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { t } from './i18n.js';
import { solarOf, batteryPowerOf } from './parse.js';

const BATTERY_TYPE = 'battery';
const MAX_POWER = 5000;
const MAX_SETPOINT = 800;
const SETPOINT_STEP = 10;
const MAX_STORED_KWH = 50;

const sensor = (key, category, type, unit, min, max, extra = {}) => ({
  key,
  category,
  type,
  ...(unit ? { unit } : {}),
  min,
  max,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});
const command = (key, category, type, unit, min, max, extra = {}) => ({
  ...sensor(key, category, type, unit, min, max, extra),
  read_only: false,
  has_feedback: true,
});

const FEATURES = [
  sensor('battery_level', C.BATTERY_STORAGE, T.BATTERY_STORAGE.BATTERY_LEVEL, U.PERCENT, 0, 100, {
    slave: true,
  }),
  sensor(
    'battery_energy_remaining',
    C.BATTERY_STORAGE,
    T.BATTERY_STORAGE.BATTERY_ENERGY_REMAINING,
    U.KILOWATT_HOUR,
    0,
    MAX_STORED_KWH,
    { slave: true },
  ),
  sensor(
    'battery_charge_power',
    C.BATTERY_STORAGE,
    T.BATTERY_STORAGE.CHARGE_POWER,
    U.WATT,
    0,
    MAX_POWER,
  ),
  sensor(
    'battery_discharge_power',
    C.BATTERY_STORAGE,
    T.BATTERY_STORAGE.DISCHARGE_POWER,
    U.WATT,
    0,
    MAX_POWER,
  ),
  sensor(
    'pv_power',
    C.ENERGY_PRODUCTION_SENSOR,
    T.ENERGY_PRODUCTION_SENSOR.POWER,
    U.WATT,
    0,
    MAX_POWER,
  ),
  sensor('output_power', C.HOME_OUTPUT_SENSOR, T.HOME_OUTPUT_SENSOR.POWER, U.WATT, 0, MAX_POWER),
  command('output_setpoint', C.SWITCH, T.SWITCH.DIMMER, U.WATT, 0, MAX_SETPOINT, {
    step: SETPOINT_STEP,
  }),
  command('output_enabled', C.SWITCH, T.SWITCH.BINARY, null, 0, 1),
  command('discharge_threshold', C.SWITCH, T.SWITCH.DIMMER, null, 0, 100),
  sensor('temperature', C.DEVICE_TEMPERATURE_SENSOR, T.SENSOR.DECIMAL, U.CELSIUS, -40, 100, {
    slave: true,
  }),
];

const DECIMALS = { battery_energy_remaining: 3, temperature: 1 };

/**
 * @description The external ids of a battery.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {string} equipId - The serial number.
 * @returns {{ device: string, feature: Function }} The ids.
 */
const batteryIds = (gladys, equipId) => gladys.externalIds(BATTERY_TYPE, String(equipId));

/**
 * @description The equipId and the feature key of an external id.
 * @param {unknown} externalId - A device or feature external id.
 * @returns {{ equipId: string|null, key: string|null }} The parts.
 * @example
 * partsOfExternalId('ext:storcube:battery:910012345:output_setpoint');
 * // -> { equipId: '910012345', key: 'output_setpoint' }
 */
function partsOfExternalId(externalId) {
  const match = /:battery:([A-Za-z0-9_-]+)(?::([a-z_]+))?$/.exec(String(externalId ?? ''));
  return match ? { equipId: match[1], key: match[2] ?? null } : { equipId: null, key: null };
}

/**
 * @description The features of a battery, in a stable order.
 * @param {boolean} master - The master battery (every feature) or an expansion one.
 * @returns {object[]} The feature descriptions.
 */
const featuresOf = (master) => FEATURES.filter((feature) => master || feature.slave);

/**
 * @description The device name: "StorCube S1000 910012345".
 * @param {object} battery - `{ equipId, model, master }`.
 * @param {string} language - Language.
 * @returns {string} The name.
 */
function batteryName(battery, language) {
  const model = battery.model ? `${battery.model} ` : '';
  const role = battery.master ? '' : ` (${t('expansion', language)})`;
  return `StorCube ${model}${battery.equipId}${role}`.slice(0, 100);
}

/**
 * @description Build the device of a battery.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} battery - `{ equipId, model, master }`.
 * @param {string} [language] - Language of the names.
 * @returns {object} The discovered device.
 */
function buildBatteryDevice(gladys, battery, language = 'en') {
  const ids = batteryIds(gladys, battery.equipId);
  return {
    name: batteryName(battery, language),
    external_id: ids.device,
    model: `StorCube${battery.model ? ` ${battery.model}` : ''}`.slice(0, 100),
    should_poll: false,
    params: [
      { name: 'STORCUBE_EQUIP_ID', value: String(battery.equipId) },
      { name: 'STORCUBE_ROLE', value: battery.master ? 'master' : 'expansion' },
    ],
    features: featuresOf(Boolean(battery.master)).map((feature) => {
      // eslint-disable-next-line no-unused-vars
      const { key, slave, ...shape } = feature;
      return { name: t(`feature_${key}`, language), external_id: ids.feature(key), ...shape };
    }),
  };
}

/**
 * @description The values of the features of a battery.
 * @param {object|null} reading - parseBattery() of the last frame, or null.
 * @param {object|null} scene - parseScene() (master only), or null.
 * @returns {object} `{ key: number|null }`.
 */
function valuesOf(reading, scene) {
  const values = {};
  if (reading) {
    const power = batteryPowerOf(reading);
    const solar = solarOf(reading);
    Object.assign(values, {
      battery_level: reading.soc,
      battery_energy_remaining: reading.storedWh === null ? null : reading.storedWh / 1000,
      battery_charge_power: power === null ? null : Math.max(0, power),
      battery_discharge_power: power === null ? null : Math.max(0, -power),
      pv_power: solar,
      output_power: reading.output === null ? null : Math.max(0, reading.output),
      discharge_threshold: reading.reserved,
      temperature: reading.temperature,
    });
  }
  if (scene) {
    if (scene.setpoint !== null) {
      values.output_setpoint = scene.setpoint;
      values.output_enabled = scene.setpoint > 0 ? 1 : 0;
    }
    if (scene.reserved !== null) values.discharge_threshold = scene.reserved;
  }
  return values;
}

/**
 * @description The states of a battery: a value left out (null) stays untouched.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} battery - `{ equipId, master }`.
 * @param {object} values - valuesOf().
 * @returns {object[]} `{ device_feature_external_id, state }`.
 */
function buildBatteryStates(gladys, battery, values) {
  const ids = batteryIds(gladys, battery.equipId);
  return featuresOf(Boolean(battery.master))
    .filter((feature) => Number.isFinite(values?.[feature.key]))
    .map((feature) => {
      const factor = 10 ** (DECIMALS[feature.key] ?? 0);
      const value = Math.round(values[feature.key] * factor) / factor;
      return {
        device_feature_external_id: ids.feature(feature.key),
        state: Math.min(feature.max, Math.max(feature.min, value)),
      };
    });
}

export {
  BATTERY_TYPE,
  FEATURES,
  MAX_SETPOINT,
  SETPOINT_STEP,
  batteryIds,
  partsOfExternalId,
  featuresOf,
  batteryName,
  buildBatteryDevice,
  valuesOf,
  buildBatteryStates,
};
