// -----------------------------------------------------------------------------
// Non-regression of everything users store: the device and feature external
// ids, the fields the Discovery "Update" button compares (category, type,
// unit, min, max, step), and every key of the manifest a scene, a widget or a
// saved configuration refers to.
//
// test/fixtures/discovery.baseline.json was generated from version 0.1.0 (the
// first release). A failure here means existing users would have to delete
// and recreate a device, or would lose a scene or a widget setting: never
// update the baseline without a documented migration
// (UPDATE_BASELINE=1 npm test rewrites it, on purpose only).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildBatteryDevice } from '../src/device.js';
import { LANGUAGES } from '../src/i18n.js';

const fakeGladys = {
  externalIds: (type, id) => ({
    device: `ext:test-integration:${type}:${id}`,
    feature: (key) => `ext:test-integration:${type}:${id}:${key}`,
  }),
};

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');

const ETERNAL = [
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'step',
  'read_only',
  'has_feedback',
];
const pick = (feature) =>
  Object.fromEntries(
    ETERNAL.filter((key) => feature[key] !== undefined).map((key) => [key, feature[key]]),
  );
const keys = (list) => (list ?? []).map((item) => item.key);
const byKey = (list) => new Map((list ?? []).map((item) => [item.key, item]));
const shape = (device) => ({
  external_id: device.external_id,
  should_poll: device.should_poll,
  params: device.params.map((param) => param.name),
  features: device.features.map(pick),
});

// The master battery (every feature) and an expansion battery.
const devices = (language) => ({
  master: buildBatteryDevice(
    fakeGladys,
    { equipId: '910012345', master: true, model: 'S1000' },
    language,
  ),
  expansion: buildBatteryDevice(fakeGladys, { equipId: '910067890', master: false }, language),
});

/**
 * @description The keys of the manifest users store.
 * @returns {object} The keys.
 */
export function manifestKeys() {
  return {
    config_schema: manifest.config_schema.map(({ key, type }) => ({ key, type })),
    actions: keys(manifest.actions),
    widgets: manifest.widgets.map((w) => ({
      key: w.key,
      settings: keys(w.settings),
      options: Object.fromEntries(
        (w.settings ?? [])
          .filter((setting) => setting.options)
          .map((setting) => [setting.key, setting.options.map((option) => option.value)]),
      ),
    })),
    scene_triggers: manifest.scene_triggers.map((trigger) => ({
      key: trigger.key,
      fields: (trigger.fields ?? []).map(({ key, options }) => ({
        key,
        options: (options ?? []).map((option) => option.value),
      })),
      variables: trigger.variables.map(({ key, type }) => ({ key, type })),
    })),
  };
}

export { devices, shape };

if (process.env.UPDATE_BASELINE === '1') {
  writeFileSync(
    new URL('./fixtures/discovery.baseline.json', import.meta.url),
    `${JSON.stringify(
      {
        devices: Object.fromEntries(
          Object.entries(devices('en')).map(([kind, device]) => [kind, shape(device)]),
        ),
        manifest: manifestKeys(),
      },
      null,
      2,
    )}\n`,
  );
}
const baseline = read('./fixtures/discovery.baseline.json');

test('the devices keep their external ids and the fields Discovery compares, in every language', () => {
  for (const language of LANGUAGES) {
    const current = Object.fromEntries(
      Object.entries(devices(language)).map(([kind, device]) => [kind, shape(device)]),
    );
    assert.deepEqual(current, baseline.devices, language);
  }
});

test('no configuration key, action or action field disappears', () => {
  const current = manifestKeys();
  const config = byKey(manifest.config_schema);
  for (const { key, type } of baseline.manifest.config_schema) {
    assert.equal(config.get(key)?.type, type, `config_schema.${key}`);
  }
  baseline.manifest.actions.forEach((key) => assert.ok(current.actions.includes(key), key));
});

test('widgets and scene triggers keep their keys, options, variables and outputs', () => {
  const widgets = byKey(manifestKeys().widgets);
  for (const widget of baseline.manifest.widgets) {
    widget.settings.forEach((key) =>
      assert.ok(widgets.get(widget.key)?.settings.includes(key), `${widget.key}.${key}`),
    );
    for (const [key, values] of Object.entries(widget.options)) {
      values.forEach((value) =>
        assert.ok(
          widgets.get(widget.key).options[key]?.includes(value),
          `${widget.key}.${key}: ${value}`,
        ),
      );
    }
  }
  const triggers = byKey(manifest.scene_triggers);
  for (const trigger of baseline.manifest.scene_triggers) {
    const now = triggers.get(trigger.key);
    assert.ok(now, trigger.key);
    const fields = byKey(now.fields ?? []);
    for (const { key, options } of trigger.fields) {
      const values = (fields.get(key)?.options ?? []).map((option) => option.value);
      assert.ok(fields.has(key), `${trigger.key}.${key}`);
      options.forEach((value) =>
        assert.ok(values.includes(value), `${trigger.key}.${key}: ${value}`),
      );
    }
    const variables = byKey(now.variables);
    for (const { key, type } of trigger.variables) {
      assert.equal(variables.get(key)?.type, type, `${trigger.key}.variables.${key}`);
    }
  }
});
