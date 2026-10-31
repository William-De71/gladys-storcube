import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import {
  FEATURES,
  buildBatteryDevice,
  buildBatteryStates,
  valuesOf,
  partsOfExternalId,
  batteryName,
} from '../src/device.js';
import { parseBattery, extractBatteries, parseScene } from '../src/parse.js';
import { LANGUAGES } from '../src/i18n.js';
import { frame, MASTER, SLAVE } from './helpers/fake-storcube.js';

const fakeGladys = {
  externalIds: (type, id) => ({
    device: `ext:test-integration:${type}:${id}`,
    feature: (key) => `ext:test-integration:${type}:${id}:${key}`,
  }),
};
const master = { equipId: MASTER, master: true, model: 'S1000' };
const slave = { equipId: SLAVE, master: false };

test('every feature: a known category / type pair, min, max, read_only, has_feedback', () => {
  const categories = Object.values(DEVICE_FEATURE_CATEGORIES);
  const units = Object.values(DEVICE_FEATURE_UNITS);
  for (const language of LANGUAGES) {
    for (const device of [
      buildBatteryDevice(fakeGladys, master, language),
      buildBatteryDevice(fakeGladys, slave, language),
    ]) {
      assert.equal(device.should_poll, false);
      assert.equal(device.poll_frequency, undefined, 'no Gladys poll: own timer and stream');
      for (const feature of device.features) {
        assert.ok(categories.includes(feature.category), feature.category);
        const types = Object.values(
          DEVICE_FEATURE_TYPES[
            Object.keys(DEVICE_FEATURE_CATEGORIES).find(
              (key) => DEVICE_FEATURE_CATEGORIES[key] === feature.category,
            )
          ] ?? {},
        );
        assert.ok(
          types.includes(feature.type) ||
            Object.values(DEVICE_FEATURE_TYPES.SENSOR).includes(feature.type),
          `${feature.category}/${feature.type}`,
        );
        if (feature.unit) assert.ok(units.includes(feature.unit), feature.unit);
        for (const key of ['min', 'max', 'read_only', 'has_feedback']) {
          assert.notEqual(feature[key], undefined, `${feature.external_id}.${key}`);
        }
        assert.ok(feature.name && feature.name.length <= 100);
        assert.equal(feature.slave, undefined, 'internal flag stripped');
      }
    }
  }
});

test('the master has every feature, an expansion battery only its level, energy and temperature', () => {
  const keys = (device) =>
    device.features.map((feature) => partsOfExternalId(feature.external_id).key);
  assert.deepEqual(
    keys(buildBatteryDevice(fakeGladys, master)),
    FEATURES.map((f) => f.key),
  );
  assert.deepEqual(keys(buildBatteryDevice(fakeGladys, slave)), [
    'battery_level',
    'battery_energy_remaining',
    'temperature',
  ]);
  const writable = buildBatteryDevice(fakeGladys, master).features.filter((f) => !f.read_only);
  assert.deepEqual(
    writable.map((f) => [
      partsOfExternalId(f.external_id).key,
      f.category,
      f.type,
      f.min,
      f.max,
      f.has_feedback,
    ]),
    [
      ['output_setpoint', 'switch', 'dimmer', 0, 800, true],
      ['output_enabled', 'switch', 'binary', 0, 1, true],
      ['discharge_threshold', 'switch', 'dimmer', 0, 100, true],
    ],
  );
  assert.equal(batteryName(master, 'fr'), `StorCube S1000 ${MASTER}`);
  assert.equal(batteryName(slave, 'fr'), `StorCube ${SLAVE} (extension)`);
});

test('the fake Gladys accepts the devices and their states', async () => {
  const gladys = createFakeGladys();
  await gladys.connect();
  const devices = [
    buildBatteryDevice(gladys, master, 'fr'),
    buildBatteryDevice(gladys, slave, 'fr'),
  ];
  await gladys.publishDiscoveredDevices(devices);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  const [rawMaster, rawSlave] = extractBatteries(frame({ slaveSoc: 81 }));
  const scene = parseScene([{ equipId: MASTER, outputPower: 300, reserved: 12 }]);
  const states = [
    ...buildBatteryStates(gladys, master, valuesOf(parseBattery(rawMaster), scene)),
    ...buildBatteryStates(gladys, slave, valuesOf(parseBattery(rawSlave), null)),
  ];
  await gladys.publishStates(states);
  const value = (equipId, key) =>
    gladys.fake.lastState(`ext:test-integration:battery:${equipId}:${key}`);
  assert.equal(value(MASTER, 'battery_level'), 64);
  assert.equal(value(MASTER, 'battery_energy_remaining'), 0.64);
  assert.equal(value(MASTER, 'pv_power'), 390);
  assert.equal(value(MASTER, 'output_power'), 300);
  assert.equal(value(MASTER, 'battery_charge_power'), 90);
  assert.equal(value(MASTER, 'battery_discharge_power'), 0);
  assert.equal(value(MASTER, 'output_setpoint'), 300);
  assert.equal(value(MASTER, 'output_enabled'), 1);
  assert.equal(value(MASTER, 'discharge_threshold'), 12, 'the scene wins over the frame');
  assert.equal(value(MASTER, 'temperature'), 21.5);
  assert.equal(value(SLAVE, 'battery_level'), 81);
  assert.equal(value(SLAVE, 'output_setpoint'), undefined);
});

test('states: unknown values are left out, out-of-range values bounded', () => {
  const states = buildBatteryStates(fakeGladys, master, {
    battery_level: null,
    output_setpoint: 1200,
    temperature: -60,
    battery_energy_remaining: 0.12345,
  });
  assert.deepEqual(
    states.map((state) => [partsOfExternalId(state.device_feature_external_id).key, state.state]),
    [
      ['battery_energy_remaining', 0.123],
      ['output_setpoint', 800],
      ['temperature', -40],
    ],
  );
  assert.deepEqual(valuesOf(null, parseScene([{ equipId: MASTER, outputPower: 0 }])), {
    output_setpoint: 0,
    output_enabled: 0,
  });
  assert.deepEqual(partsOfExternalId('nope'), { equipId: null, key: null });
  assert.deepEqual(partsOfExternalId(`ext:x:battery:${MASTER}`), { equipId: MASTER, key: null });
});
