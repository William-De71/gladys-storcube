// -----------------------------------------------------------------------------
// Texts of the integration, in English, French, German and Spanish (English
// fallback).
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: feature names, widget contents, statuses, results of the
// configuration buttons. Vocabulary of the Gladys interface (appareil /
// Gerät / dispositivo) and of its energy categories; German says "du",
// Spanish "usted", like Gladys. Serial numbers and models are never
// translated.
// -----------------------------------------------------------------------------

const LANGUAGES = ['en', 'fr', 'de', 'es'];

const TEXTS = {
  // features
  feature_battery_level: {
    en: 'Battery level',
    fr: 'Niveau de batterie',
    de: 'Batteriestand',
    es: 'Nivel de batería',
  },
  feature_battery_energy_remaining: {
    en: 'Energy stored',
    fr: 'Énergie stockée',
    de: 'Gespeicherte Energie',
    es: 'Energía almacenada',
  },
  feature_battery_charge_power: {
    en: 'Battery charge power',
    fr: 'Puissance de charge',
    de: 'Ladeleistung',
    es: 'Potencia de carga',
  },
  feature_battery_discharge_power: {
    en: 'Battery discharge power',
    fr: 'Puissance de décharge',
    de: 'Entladeleistung',
    es: 'Potencia de descarga',
  },
  feature_pv_power: {
    en: 'Solar power',
    fr: 'Puissance solaire',
    de: 'Solarleistung',
    es: 'Potencia solar',
  },
  feature_output_power: {
    en: 'Power sent to the house',
    fr: 'Puissance injectée dans la maison',
    de: 'Ins Haus eingespeiste Leistung',
    es: 'Potencia inyectada en la casa',
  },
  feature_output_setpoint: {
    en: 'Output setpoint (W)',
    fr: 'Consigne de sortie (W)',
    de: 'Ausgangssollwert (W)',
    es: 'Consigna de salida (W)',
  },
  feature_output_enabled: {
    en: 'Injection to the house',
    fr: 'Injection vers la maison',
    de: 'Einspeisung ins Haus',
    es: 'Inyección a la casa',
  },
  feature_discharge_threshold: {
    en: 'Discharge threshold (%)',
    fr: 'Seuil de décharge (%)',
    de: 'Entladegrenze (%)',
    es: 'Umbral de descarga (%)',
  },
  feature_temperature: {
    en: 'Battery temperature',
    fr: 'Température de la batterie',
    de: 'Batterietemperatur',
    es: 'Temperatura de la batería',
  },
  expansion: { en: 'expansion', fr: 'extension', de: 'Erweiterung', es: 'ampliación' },

  // widget
  tileBattery: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
  tileSolar: { en: 'Solar', fr: 'Solaire', de: 'Solar', es: 'Solar' },
  tileHouse: { en: 'To the house', fr: 'Vers la maison', de: 'Ins Haus', es: 'Hacia la casa' },
  tileCharging: { en: 'Charging', fr: 'En charge', de: 'Lädt', es: 'Cargando' },
  tileDischarging: { en: 'Discharging', fr: 'En décharge', de: 'Entlädt', es: 'Descargando' },
  tileBatteryIdle: {
    en: 'Battery idle',
    fr: 'Batterie au repos',
    de: 'Batterie ruht',
    es: 'Batería en reposo',
  },
  tileSetpoint: { en: 'Setpoint', fr: 'Consigne', de: 'Sollwert', es: 'Consigna' },
  tileInjectionOff: {
    en: 'Injection off',
    fr: 'Injection coupée',
    de: 'Einspeisung aus',
    es: 'Inyección cortada',
  },
  rowReading: { en: 'Last data', fr: 'Dernières données', de: 'Letzte Daten', es: 'Últimos datos' },
  rowAgo: {
    en: '{time} ({ago})',
    fr: '{time} ({ago})',
    de: '{time} ({ago})',
    es: '{time} ({ago})',
  },
  rowOffline: {
    en: 'Silent since {time}',
    fr: 'Muette depuis {time}',
    de: 'Stumm seit {time}',
    es: 'Sin datos desde {time}',
  },
  rowNoReading: {
    en: 'Nothing received yet',
    fr: 'Rien reçu pour l’instant',
    de: 'Noch nichts empfangen',
    es: 'Nada recibido todavía',
  },
  rowThreshold: {
    en: 'Discharge threshold',
    fr: 'Seuil de décharge',
    de: 'Entladegrenze',
    es: 'Umbral de descarga',
  },
  rowExpansion: {
    en: 'Expansion {id}',
    fr: 'Extension {id}',
    de: 'Erweiterung {id}',
    es: 'Ampliación {id}',
  },
  rowFirmware: { en: 'Firmware', fr: 'Firmware', de: 'Firmware', es: 'Firmware' },
  valueUpdate: {
    en: '{version} available',
    fr: '{version} disponible',
    de: '{version} verfügbar',
    es: '{version} disponible',
  },
  widgetWaiting: {
    en: 'Waiting for the data of the battery: the StorCube cloud sometimes takes a few minutes.',
    fr: 'En attente des données de la batterie : le cloud StorCube met parfois quelques minutes.',
    de: 'Warte auf die Daten der Batterie: Die StorCube-Cloud braucht manchmal ein paar Minuten.',
    es: 'Esperando los datos de la batería: la nube de StorCube tarda a veces unos minutos.',
  },
  widgetOffline: {
    en: 'The battery sends nothing to the StorCube cloud: check its Wi-Fi and the app.',
    fr: 'La batterie n’envoie plus rien au cloud StorCube : vérifiez son Wi-Fi et l’application.',
    de: 'Die Batterie sendet nichts an die StorCube-Cloud: Prüfe ihr WLAN und die App.',
    es: 'La batería no envía nada a la nube de StorCube: compruebe su Wi-Fi y la aplicación.',
  },
  widgetNotConfigured: {
    en: 'Fill in the StorCube account and the serial number of the battery in the configuration of the integration.',
    fr: 'Renseignez le compte StorCube et le numéro de série de la batterie dans la configuration de l’intégration.',
    de: 'Trage das StorCube-Konto und die Seriennummer der Batterie in der Konfiguration der Integration ein.',
    es: 'Indique la cuenta StorCube y el número de serie de la batería en la configuración de la integración.',
  },

  // connection status (200 characters at most)
  statusNoCredentials: {
    en: 'Fill in the e-mail, the password and the serial number of the master battery.',
    fr: 'Renseignez l’e-mail, le mot de passe et le numéro de série de la batterie maître.',
    de: 'Trage E-Mail, Passwort und Seriennummer der Hauptbatterie ein.',
    es: 'Indique el correo, la contraseña y el número de serie de la batería principal.',
  },
  statusAuth: {
    en: 'The StorCube cloud refuses the login: {detail}. Check the e-mail and the password, then save.',
    fr: 'Le cloud StorCube refuse la connexion : {detail}. Vérifiez l’e-mail et le mot de passe, puis enregistrez.',
    de: 'Die StorCube-Cloud lehnt die Anmeldung ab: {detail}. Prüfe E-Mail und Passwort und speichere.',
    es: 'La nube de StorCube rechaza el inicio de sesión: {detail}. Compruebe el correo y la contraseña y guarde.',
  },
  statusWaiting: {
    en: 'Connected to the StorCube cloud, waiting for the data of {id}.',
    fr: 'Connecté au cloud StorCube, en attente des données de {id}.',
    de: 'Mit der StorCube-Cloud verbunden, warte auf die Daten von {id}.',
    es: 'Conectado a la nube de StorCube, esperando los datos de {id}.',
  },
  statusOk: {
    en: 'StorCube {id}: {level}, {output} to the house.',
    fr: 'StorCube {id} : {level}, {output} vers la maison.',
    de: 'StorCube {id}: {level}, {output} ins Haus.',
    es: 'StorCube {id}: {level}, {output} hacia la casa.',
  },
  statusOffline: {
    en: 'StorCube {id} sends nothing to the cloud since {time}.',
    fr: 'StorCube {id} n’envoie plus rien au cloud depuis {time}.',
    de: 'StorCube {id} sendet seit {time} nichts an die Cloud.',
    es: 'StorCube {id} no envía nada a la nube desde {time}.',
  },
  statusError: {
    en: 'StorCube cloud unreachable: {detail}. Next try in a moment.',
    fr: 'Cloud StorCube injoignable : {detail}. Nouvel essai dans un instant.',
    de: 'StorCube-Cloud nicht erreichbar: {detail}. Neuer Versuch gleich.',
    es: 'Nube de StorCube inaccesible: {detail}. Nuevo intento en un momento.',
  },
  statusUnknownBattery: {
    en: 'The StorCube cloud does not know the battery {id} on this account: check the serial number.',
    fr: 'Le cloud StorCube ne connaît pas la batterie {id} sur ce compte : vérifiez le numéro de série.',
    de: 'Die StorCube-Cloud kennt die Batterie {id} in diesem Konto nicht: Prüfe die Seriennummer.',
    es: 'La nube de StorCube no conoce la batería {id} en esta cuenta: compruebe el número de serie.',
  },

  // configuration buttons
  testOk: {
    en: 'Connected. Battery {id}: {model}, {count} battery(ies) in the stack, setpoint {setpoint}, threshold {threshold}.',
    fr: 'Connecté. Batterie {id} : {model}, {count} batterie(s) dans la pile, consigne {setpoint}, seuil {threshold}.',
    de: 'Verbunden. Batterie {id}: {model}, {count} Batterie(n) im Stapel, Sollwert {setpoint}, Grenze {threshold}.',
    es: 'Conectado. Batería {id}: {model}, {count} batería(s) en la pila, consigna {setpoint}, umbral {threshold}.',
  },
  testFailed: {
    en: 'Test failed: {detail}',
    fr: 'Échec du test : {detail}',
    de: 'Test fehlgeschlagen: {detail}',
    es: 'Prueba fallida: {detail}',
  },
  testIncomplete: {
    en: 'Fill in the e-mail, the password and the serial number, save, then test again.',
    fr: 'Renseignez l’e-mail, le mot de passe et le numéro de série, enregistrez, puis testez à nouveau.',
    de: 'Trage E-Mail, Passwort und Seriennummer ein, speichere und teste erneut.',
    es: 'Indique el correo, la contraseña y el número de serie, guarde y vuelva a probar.',
  },
  diagnosticDone: {
    en: 'Diagnostic written to the logs of the integration ({count} line(s), "StorCube diagnostic").',
    fr: 'Diagnostic écrit dans les journaux de l’intégration ({count} ligne(s), « StorCube diagnostic »).',
    de: 'Diagnose in die Protokolle der Integration geschrieben ({count} Zeile(n), „StorCube diagnostic“).',
    es: 'Diagnóstico escrito en los registros de la integración ({count} línea(s), «StorCube diagnostic»).',
  },
  unknown: { en: 'unknown', fr: 'inconnu', de: 'unbekannt', es: 'desconocido' },

  // durations
  never: { en: 'never', fr: 'jamais', de: 'nie', es: 'nunca' },
  justNow: { en: 'just now', fr: 'à l’instant', de: 'gerade eben', es: 'ahora mismo' },
  minutesAgo: {
    en: '{n} min ago',
    fr: 'il y a {n} min',
    de: 'vor {n} Min.',
    es: 'hace {n} min',
  },
  hoursAgo: { en: '{n} h ago', fr: 'il y a {n} h', de: 'vor {n} Std.', es: 'hace {n} h' },
  daysAgo: {
    en: '{n} days ago',
    fr: 'il y a {n} jours',
    de: 'vor {n} Tagen',
    es: 'hace {n} días',
  },
};

/**
 * @description Whether a value is a language of the integration.
 * @param {unknown} value - The value.
 * @returns {boolean} True for en, fr, de, es.
 */
function isLanguage(value) {
  return LANGUAGES.includes(value);
}

/**
 * @description A text in a language, with its values.
 * @param {string} key - A TEXTS key.
 * @param {string} language - The language (English when unknown).
 * @param {object} [values] - The values of the `{placeholders}`.
 * @returns {string} The text, the key itself when unknown.
 */
function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) {
    return key;
  }
  const template = entry[isLanguage(language) ? language : 'en'] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    values[name] === undefined || values[name] === null ? '' : String(values[name]),
  );
}

/**
 * @description A text in the four languages.
 * @param {string|Function} key - A TEXTS key, or `(language) => text`.
 * @param {object|Function} [values] - The values, or `(language) => values`.
 * @returns {object} `{ en, fr, de, es }`.
 */
function all(key, values = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      typeof key === 'function'
        ? key(language)
        : t(key, language, typeof values === 'function' ? values(language) : values),
    ]),
  );
}

/**
 * @description How long ago an instant was: "just now", "12 min ago", "3 h ago".
 * @param {number} at - The instant, in ms (0: never).
 * @param {number} now - Now, in ms.
 * @param {string} language - The language.
 * @returns {string} The text.
 */
function ago(at, now, language) {
  if (!at) {
    return t('never', language);
  }
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) {
    return t('justNow', language);
  }
  if (minutes < 60) {
    return t('minutesAgo', language, { n: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return t('hoursAgo', language, { n: hours });
  }
  return t('daysAgo', language, { n: Math.floor(hours / 24) });
}

/**
 * @description A number in the format of a language.
 * @param {number} value - The number.
 * @param {string} language - The language.
 * @param {number} [decimals] - The decimals at most.
 * @returns {string} "12,5" in French.
 */
function formatNumber(value, language, decimals = 1) {
  if (!Number.isFinite(value)) {
    return '–';
  }
  return new Intl.NumberFormat(isLanguage(language) ? language : 'en', {
    maximumFractionDigits: decimals,
  }).format(value);
}

export { LANGUAGES, TEXTS, isLanguage, t, all, ago, formatNumber };
