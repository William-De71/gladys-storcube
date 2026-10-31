import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, isComplete, readLanguage, DEFAULT_APP_CODE } from '../src/config.js';

test('the configuration: trimmed, the serial number without spaces, the app code by default', () => {
  const config = normalizeConfig({
    login_name: '  pascal@example.com ',
    password: ' pass word ',
    equip_id: '9100 123-45',
    language: 'xx',
  });
  assert.deepEqual(config, {
    loginName: 'pascal@example.com',
    password: 'pass word',
    equipId: '910012345',
    appCode: DEFAULT_APP_CODE,
    language: 'auto',
  });
  assert.equal(isComplete(config), true);
  assert.equal(isComplete(normalizeConfig({ login_name: 'a', password: 'b' })), false);
  assert.equal(isComplete(normalizeConfig(null)), false);
  assert.equal(normalizeConfig({ app_code: 'ASGOFT', equip_id: 12 }).appCode, 'ASGOFT');
  assert.equal(normalizeConfig({ equip_id: 12 }).equipId, '12');
  assert.equal(readLanguage({ last_language: 'de' }, 'en'), 'de');
  assert.equal(readLanguage({ last_language: 'it' }, 'en'), 'en');
});
