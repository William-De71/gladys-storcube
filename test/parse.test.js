import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toNumber,
  extractBatteries,
  parseBattery,
  solarOf,
  batteryPowerOf,
  parseScene,
  parseFirmware,
} from '../src/parse.js';
import { frame, MASTER, SLAVE } from './helpers/fake-storcube.js';

test('numbers: null stays null, never 0', () => {
  assert.deepEqual([null, undefined, '', 'x', true, '12.5', 0, Infinity].map(toNumber), [
    null,
    null,
    null,
    null,
    null,
    12.5,
    0,
    null,
  ]);
});

test('frames: the totals of the stack go to the master battery only', () => {
  const batteries = extractBatteries(frame({ slaveSoc: 80 }));
  assert.deepEqual(
    batteries.map((battery) => [battery.equipId, battery.master, battery.totalPv1power]),
    [
      [MASTER, true, 210],
      [SLAVE, false, undefined],
    ],
  );
  // A lone battery in a list is the master, even without a key.
  assert.deepEqual(
    extractBatteries({ list: [{ equipId: 42, soc: 5, totalInvPower: 1 }] }).map((b) => [
      b.equipId,
      b.master,
    ]),
    [['42', true]],
  );
  // {code: 200, data: [...]}
  assert.equal(extractBatteries({ code: 200, data: [{ equipId: MASTER, soc: 9 }] })[0].soc, 9);
  // Acknowledgements and garbage give nothing.
  for (const payload of [null, 'ok', [], { code: 200, message: 'ok' }, { 12: 'x' }]) {
    assert.deepEqual(extractBatteries(payload), [], JSON.stringify(payload));
  }
});

test('a battery: measures before the totals, level bounded, flags read', () => {
  const [master] = extractBatteries(frame({ soc: 104, pv1: 200, pv2: 100, inv: 120 }));
  const battery = parseBattery({ ...master, invPower: 999, fgOnline: 1 });
  assert.equal(battery.equipId, MASTER);
  assert.equal(battery.soc, 100);
  assert.equal(battery.output, 120, 'totalInvPower first, like storcube_Ha');
  assert.equal(battery.storedWh, 640);
  assert.equal(battery.temperature, 21.5);
  assert.equal(battery.working, true);
  assert.equal(battery.online, true);
  assert.equal(battery.version, 'V1.1.0');
  assert.equal(solarOf(battery), 300);
  assert.equal(batteryPowerOf(battery), 180, 'solar - output: charging');
  const evening = parseBattery({ equipId: MASTER, pv1power: 0, pv2power: 0, invPower: 250 });
  assert.equal(batteryPowerOf(evening), -250, 'discharging');
  const unknown = parseBattery({ equipId: SLAVE, soc: 50 });
  assert.equal(solarOf(unknown), null);
  assert.equal(batteryPowerOf(unknown), null);
  assert.equal(unknown.online, null);
});

test('the scene: setpoint, threshold, members, online only when both flags say so', () => {
  const scene = parseScene([
    {
      equipId: 910012345,
      outputPower: '300',
      reserved: 15,
      equipModelCode: 'S1000',
      equipIds: [MASTER, SLAVE, 'bad id!'],
      rgOnline: 1,
      mainEquipOnline: 0,
    },
  ]);
  assert.deepEqual(
    [scene.equipId, scene.setpoint, scene.reserved, scene.model, scene.members, scene.online],
    [MASTER, 300, 15, 'S1000', [MASTER, SLAVE], false],
  );
  assert.equal(parseScene([]), null);
  assert.equal(parseScene(null), null);
  assert.equal(parseScene([{ equipId: MASTER }]).online, null);
});

test('the firmware: lastBigVersion is the INSTALLED one', () => {
  assert.deepEqual(
    parseFirmware({ lastBigVersion: 'V1.1.0', currentBigVersion: 'V1.2.0', upgread: true }),
    { installed: 'V1.1.0', available: 'V1.2.0', upgrade: true },
  );
  assert.deepEqual(parseFirmware({ lastBigVersion: 'V1.1.0' }), {
    installed: 'V1.1.0',
    available: 'V1.1.0',
    upgrade: false,
  });
  assert.equal(parseFirmware(null), null);
});
