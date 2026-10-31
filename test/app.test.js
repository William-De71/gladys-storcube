// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`), which checks the discovered
// devices, the states and the scene events like the host API does, and a fake
// StorCube cloud (test/helpers/fake-storcube.js), real HTTP and WebSocket
// servers on 127.0.0.1. No test touches the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp, ACTIONS, TOKEN_TTL_MS, PUBLISH_GAP_MS, OFFLINE_MS } from '../src/app.js';
import { WIDGETS } from '../src/widgets.js';
import { TRIGGERS } from '../src/events.js';
import { FILE } from '../src/store.js';
import {
  startFakeStorcube,
  frame,
  dataDir,
  silent,
  NOW,
  TZ,
  MINUTE,
  HOUR,
  LOGIN,
  PASSWORD,
  MASTER,
  SLAVE,
} from './helpers/fake-storcube.js';

const CONFIG = { login_name: LOGIN, password: PASSWORD, equip_id: MASTER, language: 'en' };
const PREFIX = 'ext:test-integration:battery';
const MASTER_ID = `${PREFIX}:${MASTER}`;
const SLAVE_ID = `${PREFIX}:${SLAVE}`;

/**
 * @description The integration, connected to a fake Gladys and a fake cloud.
 * @param {object} t - The test context (closes everything after).
 * @param {object} [options] - `{ config, dir, clock, fake, members, timers }`.
 * @returns {Promise<object>} `{ gladys, app, fake, clock, dir }`.
 */
async function startApp(
  t,
  { config = CONFIG, dir = dataDir(), clock = { now: NOW }, fake, members, timers = false } = {},
) {
  fake ??= await startFakeStorcube(members ? { members } : {});
  const gladys = createFakeGladys({ config });
  const app = createApp(gladys, {
    baseUrl: fake.url,
    wsUrl: fake.wsUrl,
    wsTiming: { silenceMs: 1000, pingMs: 1000, retryMinMs: 50, retryMaxMs: 200 },
    dataDir: dir,
    now: () => clock.now,
    timeZone: TZ,
    timers,
    logger: silent,
  });
  await gladys.connect();
  await app.whenReady();
  t.after(async () => {
    await gladys.fake.shutdown().catch(() => {});
    await fake.close();
  });
  return { gladys, app, fake, clock, dir };
}

/**
 * @description Create every offered device, like the user would.
 * @param {object} gladys - The fake Gladys.
 */
async function createAll(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(structuredClone(device));
  }
}

/**
 * @description A created device as Gladys hands it to setValue.
 * @param {object} gladys - The fake Gladys.
 * @param {string} key - The feature key.
 * @param {string} [id] - The device external id.
 * @returns {Array} `[device, feature]`.
 */
function featureOf(gladys, key, id = MASTER_ID) {
  const device = gladys.fake.discoveredDevices.find((item) => item.external_id === id);
  return [device, device.features.find((feature) => feature.external_id === `${id}:${key}`)];
}

const events = (gladys, key) => gladys.fake.sceneEvents.filter((event) => event.key === key);
const state = (gladys, key, id = MASTER_ID) => gladys.fake.lastState(`${id}:${key}`);

test('startup: the master battery offered at once, nothing asked before the timer', async (t) => {
  const { gladys, fake } = await startApp(t);
  assert.deepEqual(fake.calls, []);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => [device.external_id, device.features.length]),
    [[MASTER_ID, 10]],
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /waiting for the data of 910012345/);
});

test('the timer: settings of the stack, model, expansion batteries, firmware; one login', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t, { members: [MASTER, SLAVE] });
  await app.tick();
  assert.deepEqual(
    fake.calls.map((call) => call.path),
    ['/api/user/app/login', '/api/scene/user/list/V2', '/api/equip/version/need/upgrade'],
  );
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => [device.name, device.features.length]),
    [
      [`StorCube S1000 ${MASTER}`, 10],
      [`StorCube ${SLAVE} (expansion)`, 3],
    ],
  );
  await app.tick();
  assert.equal(fake.calls.length, 3, 'nothing due 0 s later');
  clock.now += 30 * 1000;
  await app.tick();
  assert.deepEqual(
    fake.calls.slice(3).map((call) => call.path),
    ['/api/scene/user/list/V2'],
  );
  clock.now += HOUR;
  await app.tick();
  assert.equal(fake.calls.at(-1).path, '/api/equip/version/need/upgrade', 'firmware hourly');
  assert.equal(fake.logins, 1);
});

test('frames: states of the created batteries, at most every 10 s, all again on creation', async (t) => {
  const { gladys, app, clock } = await startApp(t, { members: [MASTER, SLAVE] });
  await app.tick();
  await app.handleFrame(frame({ slaveSoc: 81 }));
  assert.equal(gladys.fake.states.length, 0, 'nothing created yet');
  await gladys.fake.deviceCreated(structuredClone(gladys.fake.discoveredDevices[0]));
  assert.equal(state(gladys, 'battery_level'), 64);
  assert.equal(state(gladys, 'output_setpoint'), 300);
  assert.equal(state(gladys, 'output_enabled'), 1);
  assert.equal(state(gladys, 'battery_charge_power'), 90);
  assert.equal(state(gladys, 'battery_level', SLAVE_ID), undefined, 'the expansion is not created');
  await gladys.fake.deviceCreated(structuredClone(gladys.fake.discoveredDevices[1]));
  assert.equal(state(gladys, 'battery_level', SLAVE_ID), 81);
  // A burst of frames: one publication per 10 s.
  const count = gladys.fake.states.length;
  clock.now += 1000;
  await app.handleFrame(frame({ soc: 65, slaveSoc: 81 }));
  assert.equal(gladys.fake.states.length, count);
  clock.now += PUBLISH_GAP_MS;
  await app.handleFrame(frame({ soc: 66, slaveSoc: 81 }));
  assert.equal(state(gladys, 'battery_level'), 66);
  assert.equal(gladys.fake.states.length, count + 1, 'only what changed');
});

test('a battery seen only in the frames is offered too', async (t) => {
  const { gladys, app } = await startApp(t);
  await app.handleFrame(frame({ slaveSoc: 40 }));
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.external_id),
    [MASTER_ID, SLAVE_ID],
  );
});

test('commands: setpoint, injection switch (resumes the last setpoint), threshold', async (t) => {
  const { gladys, app, fake } = await startApp(t);
  await app.tick();
  await createAll(gladys);
  let ack = await gladys.fake.setValue(...featureOf(gladys, 'output_setpoint'), 455);
  assert.equal(ack.success, true);
  assert.equal(fake.scene.outputPower, 455);
  assert.equal(state(gladys, 'output_setpoint'), 455);
  await gladys.fake.setValue(...featureOf(gladys, 'output_enabled'), 0);
  assert.equal(fake.scene.outputPower, 0);
  assert.equal(state(gladys, 'output_enabled'), 0);
  assert.equal(state(gladys, 'output_setpoint'), 0);
  await gladys.fake.setValue(...featureOf(gladys, 'output_enabled'), 1);
  assert.equal(fake.scene.outputPower, 455, 'the last setpoint above 0');
  await gladys.fake.setValue(...featureOf(gladys, 'output_setpoint'), 2000);
  assert.equal(fake.scene.outputPower, 800, 'bounded');
  ack = await gladys.fake.setValue(...featureOf(gladys, 'discharge_threshold'), 19.6);
  assert.equal(ack.success, true);
  assert.equal(fake.scene.reserved, 20);
  assert.equal(state(gladys, 'discharge_threshold'), 20);
  ack = await gladys.fake.setValue(...featureOf(gladys, 'battery_level'), 5);
  assert.equal(ack.success, false, 'read-only');
  assert.ok(gladys.fake.widgetRefreshes.includes(WIDGETS.LIVE));
  assert.equal(events(gladys, TRIGGERS.BATTERY_FULL).length, 0, 'no event from a command');
});

test('commands go to the master battery only', async (t) => {
  const { gladys, app, fake } = await startApp(t, { members: [MASTER, SLAVE] });
  await app.tick();
  const device = gladys.fake.discoveredDevices[1];
  const ack = await gladys.fake.setValue(
    device,
    { ...device.features[0], external_id: `${SLAVE_ID}:output_setpoint` },
    100,
  );
  assert.equal(ack.success, false);
  assert.equal(fake.scene.outputPower, 300);
});

test('a refused login: one event, nothing more until the configuration changes', async (t) => {
  const { gladys, app, fake } = await startApp(t, {
    config: { ...CONFIG, password: 'wrong' },
  });
  await app.tick();
  await app.tick();
  assert.equal(fake.calls.length, 1, 'one try');
  assert.equal(events(gladys, TRIGGERS.ACCESS_REFUSED).length, 1);
  assert.deepEqual(Object.keys(events(gladys, TRIGGERS.ACCESS_REFUSED)[0].data), [
    'code',
    'reason',
  ]);
  assert.equal(events(gladys, TRIGGERS.ACCESS_REFUSED)[0].data.code, 300);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /refuse la connexion/);
  assert.doesNotMatch(JSON.stringify(gladys.fake.connectionStatus), /pascal@example\.com/);
  const ack = await gladys.fake.setValue(...featureOf(gladys, 'output_setpoint'), 100);
  assert.equal(ack.success, false);
  await gladys.fake.configUpdated({ ...CONFIG });
  await app.tick();
  assert.equal(fake.logins, 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the token is kept in /data (never the password) and reused after a restart', async (t) => {
  const dir = dataDir();
  const fake = await startFakeStorcube();
  const first = await startApp(t, { dir, fake });
  await first.app.tick();
  const stored = readFileSync(join(dir, FILE), 'utf8');
  assert.doesNotMatch(stored, new RegExp(PASSWORD));
  assert.match(stored, /token-1/);
  const second = createApp(createFakeGladys({ config: CONFIG }), {
    baseUrl: fake.url,
    dataDir: dir,
    now: () => NOW + MINUTE,
    timers: false,
    logger: silent,
  });
  await second.whenReady();
  await second.store.load();
  assert.equal(second.store.data.token.value, 'token-1');
  assert.equal(fake.logins, 1);
  assert.ok(TOKEN_TTL_MS >= 12 * HOUR);
});

test('another account or battery starts from scratch', async (t) => {
  const dir = dataDir();
  const { gladys, app } = await startApp(t, { dir, members: [MASTER, SLAVE] });
  await app.tick();
  await gladys.fake.configUpdated({ ...CONFIG, equip_id: '123456' });
  assert.deepEqual(Object.keys(app.store.data.batteries), ['123456']);
  assert.equal(app.store.data.token, null);
});

test('scene events: full, at threshold, silent and back, firmware once per version', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  await app.tick();
  await app.handleFrame(frame({ soc: 99 }));
  await app.handleFrame(frame({ soc: 100 }));
  const full = events(gladys, TRIGGERS.BATTERY_FULL);
  assert.equal(full.length, 1);
  assert.deepEqual(full[0].data, {
    battery: MASTER_ID,
    battery_name: `StorCube S1000 ${MASTER}`,
    equip_id: MASTER,
    battery_level: 100,
    threshold: 10,
    pv_power_w: 390,
    output_power_w: 300,
  });
  await app.handleFrame(frame({ soc: 10 }));
  assert.equal(events(gladys, TRIGGERS.BATTERY_EMPTY).length, 1);
  // Silent for 21 minutes while the cloud answers.
  clock.now += OFFLINE_MS + MINUTE;
  await app.tick();
  assert.equal(events(gladys, TRIGGERS.BATTERY_OFFLINE).length, 1);
  assert.match(gladys.fake.connectionStatus.message.en, /sends nothing to the cloud since 18:00/);
  await app.tick();
  assert.equal(events(gladys, TRIGGERS.BATTERY_OFFLINE).length, 1, 'once');
  await app.handleFrame(frame({ soc: 12 }));
  assert.equal(events(gladys, TRIGGERS.BATTERY_ONLINE).length, 1);
  fake.firmware = { lastBigVersion: 'V1.1.0', currentBigVersion: 'V1.2.0', upgread: true };
  clock.now += HOUR;
  await app.tick();
  clock.now += HOUR;
  await app.tick();
  const update = events(gladys, TRIGGERS.FIRMWARE_UPDATE);
  assert.equal(update.length, 1);
  assert.equal(update[0].data.available_version, 'V1.2.0');
  assert.equal(update[0].data.installed_version, 'V1.1.0');
});

test('the cloud down: status, slower retries, no offline event', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  await app.tick();
  await app.handleFrame(frame());
  fake.failWith = 500;
  clock.now += 30 * 1000;
  await app.tick();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /unreachable/);
  const count = fake.calls.length;
  clock.now += 30 * 1000;
  await app.tick();
  assert.equal(fake.calls.length, count, 'backoff: 60 s after the first failure');
  clock.now += OFFLINE_MS;
  await app.tick();
  assert.equal(events(gladys, TRIGGERS.BATTERY_OFFLINE).length, 0);
  fake.failWith = null;
  clock.now += 10 * MINUTE;
  await app.tick();
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('an unknown serial number is said so', async (t) => {
  const { gladys, app } = await startApp(t, { config: { ...CONFIG, equip_id: '42' } });
  await app.tick();
  assert.match(gladys.fake.connectionStatus.message.en, /does not know the battery 42/);
});

test('incomplete configuration: nothing offered, nothing asked', async (t) => {
  const { gladys, app, fake } = await startApp(t, { config: { login_name: LOGIN } });
  await app.tick();
  assert.equal(fake.calls.length, 0);
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  const ack = await gladys.fake.widgetGet(WIDGETS.LIVE, { language: 'fr' });
  assert.match(ack.data.content.components[0].text, /Renseignez le compte StorCube/);
});

test('the widget: valid in every language, the stack now', async (t) => {
  const { gladys, app, fake } = await startApp(t, { members: [MASTER, SLAVE] });
  let ack = await gladys.fake.widgetGet(WIDGETS.LIVE, { language: 'en' });
  assert.deepEqual(validateWidgetContent(ack.data.content), []);
  assert.match(JSON.stringify(ack.data.content), /Waiting for the data/);
  fake.firmware = { lastBigVersion: 'V1.1.0', currentBigVersion: 'V1.2.0', upgread: true };
  await app.tick();
  await app.handleFrame(frame({ slaveSoc: 77 }));
  for (const language of ['en', 'fr', 'de', 'es']) {
    ack = await gladys.fake.widgetGet(WIDGETS.LIVE, { language });
    assert.equal(ack.success, true);
    assert.deepEqual(validateWidgetContent(ack.data.content), [], language);
  }
  ack = await gladys.fake.widgetGet(WIDGETS.LIVE, { language: 'fr' });
  const types = ack.data.content.components.map((component) => component.type);
  assert.deepEqual(types, ['text', 'gauge', 'value', 'value', 'value', 'value', 'status']);
  const rows = ack.data.content.components
    .at(-1)
    .items.map((item) => `${item.label}: ${item.value}`);
  assert.deepEqual(rows, [
    'Dernières données: 18:00 (à l’instant)',
    'Seuil de décharge: 10 %',
    `Extension ${SLAVE}: 77 %`,
    'Firmware: V1.2.0 disponible',
  ]);
});

test('configuration buttons: test the connection, diagnostic without secret', async (t) => {
  const { gladys, fake } = await startApp(t, { members: [MASTER, SLAVE] });
  let ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.en,
    `Connected. Battery ${MASTER}: S1000, 2 battery(ies) in the stack, setpoint 300 W, threshold 10 %.`,
  );
  assert.equal(fake.logins, 1);
  const lines = [];
  const logger = { ...silent, info: (line) => lines.push(line) };
  const gladys2 = createFakeGladys({ config: CONFIG });
  const app2 = createApp(gladys2, { baseUrl: fake.url, dataDir: dataDir(), timers: false, logger });
  await gladys2.connect();
  await app2.whenReady();
  t.after(() => gladys2.fake.shutdown().catch(() => {}));
  ack = await gladys2.fake.action(ACTIONS.DIAGNOSTIC);
  assert.equal(ack.success, true);
  const report = lines.filter((line) => line.startsWith('StorCube diagnostic')).join('');
  assert.ok(report.length > 0);
  assert.doesNotMatch(report, new RegExp(PASSWORD));
  assert.doesNotMatch(report, /pascal@example\.com/);
  fake.revoke();
  fake.tokens.add = () => fake.tokens;
  ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /^Test failed/);
});

test('with timers: the stream feeds the states, the shutdown stops it', async (t) => {
  const { gladys, app, fake } = await startApp(t, { timers: true, clock: { now: Date.now() } });
  await createAll(gladys);
  const end = Date.now() + 3000;
  while (fake.subscriptions.length === 0 && Date.now() < end) await sleep(10);
  assert.deepEqual(fake.subscriptions[0].reportEquip, [MASTER]);
  fake.push(frame({ soc: 57 }));
  while (state(gladys, 'battery_level') !== 57 && Date.now() < end) await sleep(10);
  assert.equal(state(gladys, 'battery_level'), 57);
  assert.equal(app.realtime.connected(), true);
  await gladys.fake.shutdown();
  assert.equal(app.realtime.connected(), false);
});
