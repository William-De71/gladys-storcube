import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRIGGERS,
  detectLevel,
  detectOffline,
  detectFirmware,
  batteryData,
  OFFLINE_MS,
} from '../src/events.js';

test('level: learned silently first, then one event per transition, with hysteresis', () => {
  const seen = {};
  assert.deepEqual(detectLevel(seen, 100, 10), [], 'first reading: nothing');
  assert.deepEqual(detectLevel(seen, 98, 10), [], 'still "full" above 95');
  assert.deepEqual(detectLevel(seen, 100, 10), []);
  assert.deepEqual(detectLevel(seen, 94, 10), []);
  assert.deepEqual(detectLevel(seen, 100, 10), [TRIGGERS.BATTERY_FULL]);
  assert.deepEqual(detectLevel(seen, 11, 10), []);
  assert.deepEqual(detectLevel(seen, 10, 10), [TRIGGERS.BATTERY_EMPTY]);
  assert.deepEqual(detectLevel(seen, 12, 10), [], 'not 5 points above yet');
  assert.deepEqual(detectLevel(seen, 9, 10), []);
  assert.deepEqual(detectLevel(seen, 15, 10), []);
  assert.deepEqual(detectLevel(seen, 10, 10), [TRIGGERS.BATTERY_EMPTY]);
  assert.deepEqual(detectLevel(seen, null, 10), []);
  // Unknown threshold: 10 %.
  const other = {};
  detectLevel(other, 50, null);
  assert.deepEqual(detectLevel(other, 10, null), [TRIGGERS.BATTERY_EMPTY]);
});

test('offline after 20 silent minutes while the cloud answers, back on the next frame', () => {
  const seen = {};
  const at = 1000;
  assert.equal(detectOffline(seen, { lastFrameAt: at, now: at + OFFLINE_MS, cloudOk: true }), null);
  assert.equal(
    detectOffline(seen, { lastFrameAt: at, now: at + OFFLINE_MS + 1, cloudOk: false }),
    null,
    'the cloud itself is down: not the battery',
  );
  assert.equal(
    detectOffline(seen, { lastFrameAt: at, now: at + OFFLINE_MS + 1, cloudOk: true }),
    TRIGGERS.BATTERY_OFFLINE,
  );
  assert.equal(seen.offlineSince, at);
  assert.equal(
    detectOffline(seen, { lastFrameAt: at, now: at + 2 * OFFLINE_MS, cloudOk: true }),
    null,
  );
  assert.equal(
    detectOffline(seen, { lastFrameAt: 9e9, now: 9e9, cloudOk: true }),
    TRIGGERS.BATTERY_ONLINE,
  );
  assert.equal(detectOffline({}, { lastFrameAt: null, now: 1, cloudOk: true }), null);
});

test('firmware: once per available version', () => {
  const seen = {};
  assert.equal(detectFirmware(seen, { installed: 'a', available: 'a', upgrade: false }), false);
  assert.equal(detectFirmware(seen, { installed: 'a', available: 'b', upgrade: true }), true);
  assert.equal(detectFirmware(seen, { installed: 'a', available: 'b', upgrade: true }), false);
  assert.equal(detectFirmware(seen, { installed: 'a', available: 'c', upgrade: true }), true);
  assert.equal(detectFirmware(seen, null), false);
});

test('event data: flat scalars, rounded', () => {
  const data = batteryData({
    externalId: 'ext:storcube:battery:1',
    name: 'StorCube S1000 1',
    equipId: '1',
    reading: { soc: 64.4, pv1: 100.4, pv2: null, output: 250.6 },
    threshold: 10,
  });
  assert.deepEqual(data, {
    battery: 'ext:storcube:battery:1',
    battery_name: 'StorCube S1000 1',
    equip_id: '1',
    battery_level: 64,
    threshold: 10,
    pv_power_w: 100,
    output_power_w: 251,
  });
  for (const value of Object.values(data)) {
    assert.ok(value === null || ['string', 'number', 'boolean'].includes(typeof value));
  }
});
