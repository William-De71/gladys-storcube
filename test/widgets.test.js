import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { buildLiveWidget, messageContent, powerTile } from '../src/widgets.js';
import { LANGUAGES } from '../src/i18n.js';

const NOW = Date.UTC(2026, 9, 31, 17, 0, 0);
const reading = { soc: 8, pv1: 0, pv2: 0, output: 250, storedWh: 80, temperature: 18 };
const base = {
  equipId: '910012345',
  model: 'S1000',
  readingAt: NOW - 60000,
  fresh: true,
  offline: false,
  setpoint: 250,
  threshold: 10,
  expansions: [],
  firmware: null,
};

const budget = (content) => {
  const count = (types) => content.components.filter((c) => types.includes(c.type)).length;
  assert.ok(content.components.length <= 8);
  assert.ok(count(['value', 'gauge']) <= 6);
  assert.ok(count(['text']) <= 2);
  assert.ok(count(['status']) <= 1);
};

test('every state of the stack gives a valid content in every language', () => {
  const views = [
    { ...base, reading },
    { ...base, reading: null, fresh: false, readingAt: null, setpoint: null, threshold: null },
    { ...base, reading: null, fresh: false, offline: true, offlineSince: NOW - 3600000 },
    {
      ...base,
      reading: { ...reading, soc: 100, pv1: 400, pv2: 350, output: 0 },
      setpoint: 0,
      expansions: [
        { equipId: '910067890', soc: 99 },
        { equipId: '910067891', soc: null },
      ],
      firmware: { upgrade: true, available: 'V1.2.0' },
    },
  ];
  for (const view of views) {
    for (const language of LANGUAGES) {
      const content = buildLiveWidget({ view, language, now: NOW, timeZone: 'Europe/Paris' });
      assert.deepEqual(validateWidgetContent(content), [], `${language}`);
      budget(content);
    }
  }
});

test('colors and labels follow the battery', () => {
  const low = buildLiveWidget({
    view: { ...base, reading },
    language: 'en',
    now: NOW,
    timeZone: 'UTC',
  });
  assert.equal(low.components.find((c) => c.type === 'gauge').color, 'danger');
  const values = low.components.filter((c) => c.type === 'value').map((c) => c.label);
  assert.deepEqual(values, ['Solar', 'To the house', 'Discharging', 'Setpoint']);
  const off = buildLiveWidget({
    view: { ...base, reading: { ...reading, soc: 60 }, setpoint: 0 },
    language: 'fr',
    now: NOW,
    timeZone: 'UTC',
  });
  assert.equal(off.components.find((c) => c.type === 'gauge').color, 'success');
  assert.ok(off.components.some((c) => c.label === 'Injection coupée'));
  assert.deepEqual(powerTile(1250), { value: 1.3, unit: 'kW' });
  assert.deepEqual(powerTile(-80), { value: 80, unit: 'W' });
  assert.deepEqual(validateWidgetContent(messageContent('x'.repeat(400))), []);
});
