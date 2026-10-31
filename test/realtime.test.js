import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRealtime, subscription } from '../src/realtime.js';
import { createStorcubeClient } from '../src/storcube-api.js';
import {
  startFakeStorcube,
  frame,
  LOGIN,
  PASSWORD,
  MASTER,
  silent,
} from './helpers/fake-storcube.js';

const timing = { silenceMs: 150, pingMs: 1000, retryMinMs: 50, retryMaxMs: 200 };

/**
 * @description Wait until a condition holds.
 * @param {Function} condition - The condition.
 * @param {number} [ms] - At most.
 * @returns {Promise<void>}
 */
async function until(condition, ms = 3000) {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error('timeout');
    await sleep(10);
  }
}

/**
 * @description A stream on the fake cloud.
 * @param {object} t - Test context.
 * @returns {Promise<object>} `{ fake, realtime, frames, errors }`.
 */
async function start(t) {
  const fake = await startFakeStorcube();
  let token = null;
  const client = createStorcubeClient({
    credentials: () => ({ loginName: LOGIN, password: PASSWORD, appCode: 'Storcube' }),
    tokens: { get: () => token, set: (value) => (token = value) },
    baseUrl: fake.url,
  });
  const frames = [];
  const errors = [];
  const realtime = createRealtime({
    token: (fresh) => client.token(fresh),
    equipId: () => MASTER,
    onFrame: (value) => frames.push(value),
    onError: (err) => errors.push(err),
    url: fake.wsUrl,
    logger: silent,
    timing,
  });
  t.after(async () => {
    realtime.stop();
    await fake.close();
  });
  return { fake, realtime, frames, errors };
}

test('connects with the token in the path and the header, subscribes, receives frames', async (t) => {
  const { fake, realtime, frames } = await start(t);
  realtime.start();
  await until(() => fake.subscriptions.length === 1);
  assert.deepEqual(fake.subscriptions[0], JSON.parse(subscription(MASTER)));
  assert.deepEqual(fake.subscriptions[0], { cmd: 'sub', action: 'report', reportEquip: [MASTER] });
  assert.equal([...fake.sockets][0].authorization, 'token-1');
  assert.equal(realtime.connected(), true);
  fake.push(frame());
  await until(() => frames.length === 1);
  assert.equal(frames[0][MASTER].list[0].soc, 64);
  assert.equal(realtime.frames(), 1, 'the text acknowledgement is not a frame');
});

test('silence: the subscription is sent again', async (t) => {
  const { fake, realtime } = await start(t);
  realtime.start();
  await until(() => fake.subscriptions.length >= 3);
});

test('a dropped connection comes back; a refused token asks for a new one', async (t) => {
  const { fake, realtime, frames } = await start(t);
  realtime.start();
  await until(() => fake.sockets.size === 1);
  fake.revoke();
  for (const socket of fake.sockets) socket.terminate();
  await until(() => fake.logins === 2 && fake.sockets.size === 1);
  fake.push(frame({ soc: 70 }));
  await until(() => frames.length === 1);
  realtime.stop();
  assert.equal(realtime.connected(), false);
  await sleep(100);
  assert.equal(fake.sockets.size, 0, 'stopped for good');
});

test('a refused login stops the stream', async (t) => {
  const fake = await startFakeStorcube();
  t.after(() => fake.close());
  const client = createStorcubeClient({
    credentials: () => ({ loginName: 'x@y.z', password: 'no', appCode: 'Storcube' }),
    tokens: { get: () => null, set() {} },
    baseUrl: fake.url,
  });
  const errors = [];
  const realtime = createRealtime({
    token: (fresh) => client.token(fresh),
    equipId: () => MASTER,
    onFrame() {},
    onError: (err) => errors.push(err.kind),
    url: fake.wsUrl,
    logger: silent,
    timing,
  });
  t.after(() => realtime.stop());
  realtime.start();
  await until(() => errors.length === 1);
  await sleep(150);
  assert.deepEqual(errors, ['auth'], 'no retry');
  assert.equal(fake.calls.length, 1);
});
