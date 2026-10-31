// Widget contents for the generated illustrations, built by the real code of
// the integration: the app itself (src/app.js) wired to the fake Gladys of the
// SDK and the fake StorCube cloud of the tests (real local HTTP and WebSocket
// servers), on a made-up Saturday, 31 October 2026 at 18:00 in Paris: an S1000
// with one expansion battery, sending 300 W to the house while the last sun
// still charges it, a firmware update waiting. Never real data.
// Written as JSON for render.js: node gen.mjs <repo> <out.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (file) => import(pathToFileURL(join(repo, file)).href);
const { createApp } = await load('src/app.js');
const { LANGUAGES } = await load('src/i18n.js');
const { createFakeGladys } = await import(
  pathToFileURL(join(repo, 'node_modules/@gladysassistant/integration-sdk/lib/testing.js')).href
);
const { startFakeStorcube, frame, dataDir, silent, NOW, LOGIN, PASSWORD, MASTER, SLAVE } =
  await load('test/helpers/fake-storcube.js');

const manifest = JSON.parse(readFileSync(join(repo, 'gladys-assistant-integration.json'), 'utf8'));
const WIDGET_KEYS = ['live'];
const MINUTE = 60 * 1000;

/**
 * @description One language: the widget of the stack.
 * @param {string} language - Language.
 * @returns {Promise<object>} The widget contents.
 */
async function contents(language) {
  const clock = { now: NOW - 2 * MINUTE };
  const fake = await startFakeStorcube({ members: [MASTER, SLAVE] });
  fake.firmware = { lastBigVersion: 'V1.1.0', currentBigVersion: 'V1.2.0', upgread: true };
  const gladys = createFakeGladys({
    config: { login_name: LOGIN, password: PASSWORD, equip_id: MASTER, language },
  });
  const app = createApp(gladys, {
    baseUrl: fake.url,
    dataDir: dataDir(),
    now: () => clock.now,
    timeZone: 'Europe/Paris',
    timers: false,
    logger: silent,
  });
  await gladys.connect();
  await app.whenReady();
  await app.tick();
  await app.handleFrame(frame({ soc: 72, pv1: 240, pv2: 150, inv: 300, slaveSoc: 68 }));
  clock.now = NOW;
  const result = {};
  for (const key of WIDGET_KEYS) {
    result[key] = (await gladys.fake.widgetGet(key, { language })).data.content;
  }
  await gladys.fake.shutdown();
  await fake.close();
  return result;
}

const all = {};
for (const language of LANGUAGES) {
  all[language] = await contents(language);
}

const card = (key) => {
  const widget = manifest.widgets.find((item) => item.key === key);
  return { icon: widget.icon, label: widget.label };
};
writeFileSync(
  out,
  JSON.stringify({
    contents: all,
    images: {},
    cards: Object.fromEntries(WIDGET_KEYS.map((key) => [key, card(key)])),
  }),
);
