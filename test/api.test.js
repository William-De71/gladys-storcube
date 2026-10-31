import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorcubeClient, scrub } from '../src/storcube-api.js';
import { startFakeStorcube, LOGIN, PASSWORD, MASTER } from './helpers/fake-storcube.js';

/**
 * @description A client of the fake cloud, its tokens in memory.
 * @param {object} fake - The fake cloud.
 * @param {object} [credentials] - `{ loginName, password, appCode }`.
 * @returns {object} `{ client, tokens }`.
 */
function clientOf(
  fake,
  credentials = { loginName: LOGIN, password: PASSWORD, appCode: 'Storcube' },
) {
  let token = null;
  const tokens = { get: () => token, set: (value) => (token = value) };
  return {
    client: createStorcubeClient({ credentials: () => credentials, tokens, baseUrl: fake.url }),
    tokens,
  };
}

test('login: the token is kept, sent raw in Authorization with the app code', async (t) => {
  const fake = await startFakeStorcube();
  t.after(() => fake.close());
  const { client, tokens } = clientOf(fake);
  const data = await client.scene(MASTER);
  assert.equal(data[0].equipId, MASTER);
  assert.equal(tokens.get(), 'token-1');
  await client.firmware(MASTER);
  assert.equal(fake.logins, 1, 'one login for both');
  const [login, scene, firmware] = fake.calls;
  assert.deepEqual(login.body, { appCode: 'Storcube', loginName: LOGIN, password: PASSWORD });
  assert.equal(login.authorization, null);
  assert.deepEqual(
    [scene.path, scene.query, scene.authorization, scene.appCode],
    ['/api/scene/user/list/V2', { equipId: MASTER }, 'token-1', 'Storcube'],
  );
  assert.equal(firmware.path, '/api/equip/version/need/upgrade');
  assert.equal(client.requests(), 3);
});

test('a refused login is an "auth" error, without the e-mail in the message', async (t) => {
  const fake = await startFakeStorcube();
  t.after(() => fake.close());
  const { client } = clientOf(fake, {
    loginName: 'someone@example.org',
    password: 'x',
    appCode: 'Storcube',
  });
  await assert.rejects(client.scene(MASTER), (err) => {
    assert.equal(err.kind, 'auth');
    assert.equal(err.code, 300);
    assert.doesNotMatch(err.message, /someone@example\.org/);
    assert.match(err.message, /was not found/);
    return true;
  });
  assert.equal(fake.calls.length, 1, 'nothing after the refusal');
  assert.equal(scrub('The account [a.b@c.fr] was not found'), 'The account […] was not found');
});

for (const refusal of ['http', 'code']) {
  test(`an expired token (${refusal}) logs in again, once`, async (t) => {
    const fake = await startFakeStorcube();
    t.after(() => fake.close());
    fake.tokenRefusal = refusal;
    const { client, tokens } = clientOf(fake);
    await client.scene(MASTER);
    fake.revoke();
    await client.scene(MASTER);
    assert.equal(fake.logins, 2);
    assert.equal(tokens.get(), 'token-2');
    // A token refused right after a login: no loop.
    fake.revoke();
    fake.tokens.add = () => fake.tokens; // the next tokens are never valid
    await assert.rejects(client.scene(MASTER), (err) => err.kind === 'token');
    assert.equal(fake.logins, 3);
  });
}

test('writes: power in the query, the threshold field the firmware accepts is kept', async (t) => {
  const fake = await startFakeStorcube();
  t.after(() => fake.close());
  const { client } = clientOf(fake);
  await client.setPower(MASTER, 450);
  assert.equal(fake.scene.outputPower, 450);
  assert.deepEqual(fake.calls.at(-1).query, { equipId: MASTER, power: '450' });
  assert.equal(await client.setThreshold(MASTER, 20), 'threshold');
  assert.deepEqual(
    fake.calls.filter((call) => call.path === '/api/scene/threshold/set').map((c) => c.body),
    [
      { reserved: '20', equipId: MASTER },
      { threshold: '20', equipId: MASTER },
    ],
  );
  assert.equal(fake.scene.reserved, 20);
  const before = fake.calls.length;
  await client.setThreshold(MASTER, 25);
  assert.equal(fake.calls.length, before + 1, 'straight to the field that worked');
  fake.thresholdField = 'nothing';
  await assert.rejects(client.setThreshold(MASTER, 30), (err) => err.kind === 'api');
  assert.equal(client.thresholdField(), null, 'all fields tried again next time');
});

test('errors of the cloud: api for a refusal, network for the rest', async (t) => {
  const fake = await startFakeStorcube();
  t.after(() => fake.close());
  const { client } = clientOf(fake);
  fake.failWith = 500;
  await assert.rejects(client.scene(MASTER), (err) => err.kind === 'api' && err.code === 500);
  const down = createStorcubeClient({
    credentials: () => ({ loginName: LOGIN, password: PASSWORD }),
    tokens: { get: () => 'x', set() {} },
    baseUrl: 'http://127.0.0.1:9',
  });
  await assert.rejects(down.scene(MASTER), (err) => err.kind === 'network');
  const notJson = createStorcubeClient({
    credentials: () => ({ loginName: LOGIN, password: PASSWORD }),
    tokens: { get: () => 'x', set() {} },
    fetch: async () => new Response('<html>', { status: 200 }),
  });
  await assert.rejects(notJson.scene(MASTER), (err) => err.kind === 'network');
  const gateway = createStorcubeClient({
    credentials: () => ({ loginName: LOGIN, password: PASSWORD }),
    tokens: { get: () => 'x', set() {} },
    fetch: async () => new Response('bad gateway', { status: 502 }),
  });
  await assert.rejects(gateway.scene(MASTER), (err) => err.kind === 'network' && err.code === 502);
});
