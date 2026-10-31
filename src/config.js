// -----------------------------------------------------------------------------
// Configuration of the StorCube integration.
//
// Fields of the config_schema:
//   - `login_name`  the e-mail address of the StorCube app account;
//   - `password`    its password: a `secret`, never sent back to the UI, never
//                   logged, never written to /data; it travels to the StorCube
//                   cloud in clear (plain HTTP), as with the app;
//   - `equip_id`    the serial number of the master battery (the one the
//                   panels and the micro-inverter are wired to);
//   - `app_code`    the app code the cloud expects, `Storcube` by default
//                   (other brands of the same cloud use another one);
//   - `language`    language of the texts Gladys does not ask for in a
//                   language (feature names, scene texts): `auto` follows the
//                   language of the last widget, or the timezone.
//
// Internal key, outside the config_schema (never shown in the UI):
//   - `last_language` language of the last widget request.
// -----------------------------------------------------------------------------

import { isLanguage } from './i18n.js';

const AUTO_LANGUAGE = 'auto';
const INTERNAL_KEYS = { language: 'last_language' };
const DEFAULT_APP_CODE = 'Storcube';

const readString = (raw) =>
  typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';

/**
 * @description Normalize the raw config object from the host API.
 * @param {object} [rawConfig] - The raw config values.
 * @returns {object} `{ loginName, password, equipId, appCode, language }`.
 * @example
 * normalizeConfig({ login_name: 'me@example.com', password: 's', equip_id: '9100 0123' });
 */
function normalizeConfig(rawConfig = {}) {
  const config = rawConfig ?? {};
  return {
    loginName: readString(config.login_name),
    // A password may hold spaces: only the ends are trimmed.
    password: typeof config.password === 'string' ? config.password.replace(/^\s+|\s+$/g, '') : '',
    // A serial number copied from the label may hold spaces or dashes.
    equipId: readString(config.equip_id).replace(/[\s-]+/g, ''),
    appCode: readString(config.app_code) || DEFAULT_APP_CODE,
    language: isLanguage(config.language) ? config.language : AUTO_LANGUAGE,
  };
}

/**
 * @description Whether the configuration is complete.
 * @param {object} config - normalizeConfig().
 * @returns {boolean} Complete.
 */
const isComplete = (config) => Boolean(config.loginName && config.password && config.equipId);

// The timezones of the countries that speak the languages of the integration:
// the automatic language before any widget was shown.
const TIMEZONE_LANGUAGES = {
  fr: [
    'Europe/Paris',
    'Europe/Monaco',
    'Europe/Brussels',
    'Europe/Luxembourg',
    'Indian/Reunion',
    'Indian/Mayotte',
    'America/Guadeloupe',
    'America/Martinique',
    'America/Cayenne',
    'America/Miquelon',
    'Pacific/Noumea',
    'Pacific/Tahiti',
    'America/Montreal',
    'Africa/Abidjan',
    'Africa/Dakar',
    'Africa/Casablanca',
    'Africa/Algiers',
    'Africa/Tunis',
  ],
  de: ['Europe/Berlin', 'Europe/Busingen', 'Europe/Vienna', 'Europe/Zurich', 'Europe/Vaduz'],
  es: [
    'Europe/Madrid',
    'Atlantic/Canary',
    'Africa/Ceuta',
    'America/Mexico_City',
    'America/Bogota',
    'America/Lima',
    'America/Santiago',
    'America/Caracas',
    'America/Montevideo',
    'America/Asuncion',
    'America/La_Paz',
    'America/Guayaquil',
    'America/Havana',
    'America/Costa_Rica',
    'America/Panama',
  ],
};

/**
 * @description The language of the texts guessed from a timezone, before
 * any widget was shown.
 * @param {string} timezone - IANA timezone of Gladys.
 * @returns {string} en, fr, de or es.
 * @example
 * guessLanguage('Europe/Paris'); // -> 'fr'
 */
function guessLanguage(timezone) {
  const zone = String(timezone ?? '');
  if (zone.startsWith('America/Argentina/')) {
    return 'es';
  }
  const found = Object.entries(TIMEZONE_LANGUAGES).find(([, zones]) => zones.includes(zone));
  return found ? found[0] : 'en';
}

/**
 * @description Read the stored language of the last widget request.
 * @param {object} [rawConfig] - The raw config values.
 * @param {string} fallback - The language to keep when nothing valid is stored.
 * @returns {string} The language.
 */
function readLanguage(rawConfig, fallback) {
  const language = (rawConfig ?? {})[INTERNAL_KEYS.language];
  return isLanguage(language) ? language : fallback;
}

export {
  AUTO_LANGUAGE,
  INTERNAL_KEYS,
  DEFAULT_APP_CODE,
  normalizeConfig,
  isComplete,
  guessLanguage,
  readLanguage,
};
