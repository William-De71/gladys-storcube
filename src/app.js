// -----------------------------------------------------------------------------
// The StorCube integration: every handler, registered on a Gladys client.
//
// Brings a StorCube balcony battery stack (S1000 and its expansion batteries)
// into Gladys through the StorCube cloud (Baterway), the server of the
// StorCube app, with the e-mail and password of the app account. The API is
// not documented nor official: it follows the Home Assistant integration
// storcube_Ha (jon7119, MIT License).
//   - devices (device.js): one per battery — level, stored energy,
//     temperature; for the master battery also the charge / discharge power,
//     the solar power, the power sent to the house, and three writable
//     features: the output setpoint (0 to 800 W), the injection switch and the
//     discharge threshold;
//   - scene triggers (events.js): battery full, battery at its threshold,
//     battery silent / back, firmware update, login refused;
//   - dashboard widget (widgets.js): the stack now;
//   - configuration buttons: test the connection, diagnostic.
//
// Where the data come from:
//   - the WebSocket stream (realtime.js), always open: the frames of the
//     batteries (level, powers, temperature);
//   - the REST settings of the stack every 30 s (setpoint, threshold, model,
//     the batteries of the stack), slower after failures (up to 10 min);
//   - the firmware every hour.
// One login, its token kept in /data for 12 hours: the cloud tolerates
// several sessions of one account badly. A refused login stops everything
// until the configuration changes (no lockout of the account).
//
// index.js only creates the SDK client; the tests drive this module with the
// fake Gladys of the SDK and a fake StorCube cloud (test/helpers/fake-storcube.js).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import {
  normalizeConfig,
  isComplete,
  readLanguage,
  guessLanguage,
  INTERNAL_KEYS,
  AUTO_LANGUAGE,
} from './config.js';
import { createStorcubeClient } from './storcube-api.js';
import { createRealtime } from './realtime.js';
import { createStore, EMPTY } from './store.js';
import { extractBatteries, parseBattery, parseScene, parseFirmware } from './parse.js';
import {
  batteryIds,
  partsOfExternalId,
  buildBatteryDevice,
  buildBatteryStates,
  batteryName,
  valuesOf,
  MAX_SETPOINT,
} from './device.js';
import {
  TRIGGERS,
  detectLevel,
  detectOffline,
  detectFirmware,
  batteryData,
  OFFLINE_MS,
} from './events.js';
import { WIDGETS, messageContent, buildLiveWidget } from './widgets.js';
import { defaultTimeZone, usableTimeZone, formatTime } from './time.js';
import { t, all, formatNumber, LANGUAGES } from './i18n.js';

const ACTIONS = { TEST_CONNECTION: 'test_connection', DIAGNOSTIC: 'diagnostic' };
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const TICK_MS = 30 * 1000;
const SCENE_EVERY_MS = 30 * 1000;
const SCENE_BACKOFF_MAX_MS = 10 * MINUTE_MS;
const FIRMWARE_EVERY_MS = HOUR_MS;
// The API gives no expiry: storcube_Ha assumes 12 hours.
const TOKEN_TTL_MS = 12 * HOUR_MS;
// A frame older than this is not "now" any more (widget, status).
const FRESH_MS = 10 * MINUTE_MS;
// The states are sent at most this often (frames may come in bursts).
const PUBLISH_GAP_MS = 10 * 1000;
const HEARTBEAT_MS = 30 * MINUTE_MS;
const DIAGNOSTIC_CHUNK = 3000;
const { version: VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

/**
 * @description Register every handler of the integration on a Gladys client.
 * @param {object} gladys - A GladysIntegration (or the fake Gladys of the SDK).
 * @param {object} [options] - Options.
 * @param {string} [options.baseUrl] - The REST server (tests).
 * @param {string} [options.wsUrl] - The WebSocket server (tests).
 * @param {Function} [options.fetch] - The HTTP transport (tests).
 * @param {object} [options.wsTiming] - Timings of the stream (tests).
 * @param {string} [options.dataDir] - The writable folder (/data).
 * @param {Function} [options.now] - `() => number` in ms (tests).
 * @param {string} [options.timeZone] - IANA timezone of Gladys (TZ by default).
 * @param {boolean} [options.timers] - Arm the timer and the stream (false in tests).
 * @param {object} [options.logger] - Logger.
 * @returns {object} Handles for the tests.
 */
function createApp(
  gladys,
  {
    baseUrl,
    wsUrl,
    fetch: fetchFn,
    wsTiming,
    dataDir,
    now = () => Date.now(),
    timeZone: zone = defaultTimeZone(),
    timers = true,
    logger = sdkLogger,
  } = {},
) {
  const timeZone = usableTimeZone(zone);
  let config = normalizeConfig();
  let language = guessLanguage(timeZone);
  let createdDevices = new Set();
  let lastStatus = null;
  let lastDiscovery = null;
  let timer = null;
  let publishTimer = null;
  let lastPublishAt = 0;
  let stopped = false;
  let streamOn = false;
  let nextSceneAt = 0;
  let sceneFailures = 0;
  let nextFirmwareAt = 0;
  let cloudOk = false;
  let ticking = null;

  const store = createStore({ ...(dataDir ? { dir: dataDir } : {}), logger });
  const data = () => store.data;

  const api = createStorcubeClient({
    credentials: () => ({
      loginName: config.loginName,
      password: config.password,
      appCode: config.appCode,
    }),
    tokens: {
      get: () => {
        const token = data().token;
        return token && now() - token.at < TOKEN_TTL_MS ? token.value : null;
      },
      set: (value) => {
        data().token = value ? { value, at: now() } : null;
        store.save();
      },
    },
    ...(baseUrl ? { baseUrl } : {}),
    ...(fetchFn ? { fetch: fetchFn } : {}),
  });

  const realtime = createRealtime({
    token: (fresh) => api.token(fresh),
    equipId: () => config.equipId,
    onFrame: (frame) => {
      handleFrame(frame).catch((err) => logger.warn(`StorCube frame: ${err.message}`));
    },
    onError: (err) => {
      if (err.kind === 'auth') {
        refuseAccess(err).catch(() => {});
      }
    },
    ...(wsUrl ? { url: wsUrl } : {}),
    ...(wsTiming ? { timing: wsTiming } : {}),
    logger,
  });

  // --- Language --------------------------------------------------------------------

  /**
   * @description Remember the language of a widget request, and store it when it changed.
   * @param {string} next - The language.
   */
  function rememberLanguage(next) {
    if (!LANGUAGES.includes(next) || next === language) {
      return;
    }
    language = next;
    gladys
      .setConfig({ [INTERNAL_KEYS.language]: next })
      .catch((err) => logger.warn(`Unable to store the language: ${err.message}`));
  }

  /**
   * @description Language of the texts Gladys does not ask for in a language.
   * @returns {string} The language.
   */
  const textLanguage = () => (config.language === AUTO_LANGUAGE ? language : config.language);

  // --- What is known -----------------------------------------------------------------

  /**
   * @description The batteries known, the master first, then by serial number.
   * @returns {object[]} `{ equipId, master, model }`.
   */
  function batteries() {
    return Object.entries(data().batteries)
      .map(([equipId, battery]) => ({ ...battery, equipId, master: equipId === config.equipId }))
      .sort((a, b) => Number(b.master) - Number(a.master) || a.equipId.localeCompare(b.equipId));
  }

  /**
   * @description Remember a battery of the stack.
   * @param {string} equipId - Its serial number.
   * @returns {boolean} Whether it is new.
   */
  function registerBattery(equipId) {
    if (!equipId || data().batteries[equipId]) {
      return false;
    }
    data().batteries[equipId] = { seenAt: now() };
    return true;
  }

  const masterReading = () => data().readings[config.equipId] ?? null;

  /**
   * @description The view of the stack the widget and the status show.
   * @returns {object} The view.
   */
  function viewOf() {
    const reading = masterReading();
    const scene = data().scene;
    const seen = data().seen[config.equipId] ?? {};
    const fresh = Number.isFinite(reading?.at) && now() - reading.at < FRESH_MS;
    return {
      equipId: config.equipId,
      model: data().batteries[config.equipId]?.model ?? null,
      reading: fresh ? reading : null,
      readingAt: reading?.at ?? null,
      fresh,
      offline: Boolean(seen.offline),
      offlineSince: seen.offlineSince ?? null,
      setpoint: scene?.setpoint ?? null,
      threshold: scene?.reserved ?? reading?.reserved ?? null,
      expansions: batteries()
        .filter((battery) => !battery.master)
        .map((battery) => {
          const item = data().readings[battery.equipId];
          const ok = Number.isFinite(item?.at) && now() - item.at < FRESH_MS;
          return { equipId: battery.equipId, soc: ok ? item.soc : null };
        }),
      firmware: data().firmware,
    };
  }

  // --- Status ----------------------------------------------------------------------

  /**
   * @description Report the connection status, only when it changed.
   * @param {boolean} connected - Connected or not.
   * @param {object} message - The multi-language message.
   * @returns {Promise<void>}
   */
  async function reportStatus(connected, message) {
    const clipped = Object.fromEntries(
      Object.entries(message).map(([lang, text]) => [lang, text.slice(0, 200)]),
    );
    const signature = JSON.stringify([connected, clipped]);
    if (signature === lastStatus) {
      return;
    }
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(connected, clipped);
    } catch (err) {
      lastStatus = null;
      logger.error('Unable to report the connection status', err);
    }
  }

  /**
   * @description Work out the connection status.
   * @returns {Promise<void>}
   */
  async function refreshStatus() {
    if (!isComplete(config)) {
      await reportStatus(false, all('statusNoCredentials'));
      return;
    }
    if (data().accessRefused) {
      await reportStatus(false, all('statusAuth', { detail: data().accessRefused.detail }));
      return;
    }
    const error = data().lastError;
    if (!cloudOk && error) {
      await reportStatus(
        false,
        all(error.kind === 'unknown_battery' ? 'statusUnknownBattery' : 'statusError', {
          id: config.equipId,
          detail: error.detail,
        }),
      );
      return;
    }
    const view = viewOf();
    if (view.offline) {
      await reportStatus(
        true,
        all((lang) =>
          t('statusOffline', lang, {
            id: config.equipId,
            time: formatTime(view.offlineSince, { language: lang, timeZone, now: now() }),
          }),
        ),
      );
      return;
    }
    if (!view.reading) {
      await reportStatus(true, all('statusWaiting', { id: config.equipId }));
      return;
    }
    await reportStatus(
      true,
      all((lang) =>
        t('statusOk', lang, {
          id: config.equipId,
          level: Number.isFinite(view.reading.soc)
            ? `${formatNumber(view.reading.soc, lang, 0)} %`
            : '–',
          output: Number.isFinite(view.reading.output)
            ? `${formatNumber(Math.max(0, view.reading.output), lang, 0)} W`
            : '–',
        }),
      ),
    );
  }

  // --- Devices and states --------------------------------------------------------------

  /**
   * @description Refresh the list of the devices the user created.
   * @returns {Promise<void>}
   */
  async function refreshCreatedDevices() {
    try {
      const devices = await gladys.getDevices();
      createdDevices = new Set(devices.map((device) => device.external_id));
    } catch (err) {
      logger.warn(`Unable to read the devices: ${err.message}`);
    }
  }

  /**
   * @description Offer the devices of the known batteries, when they changed.
   * @param {boolean} [force] - Publish even when unchanged.
   * @returns {Promise<number>} How many devices were offered.
   */
  async function publishDiscoveredDevices(force = false) {
    if (!isComplete(config) || data().accessRefused) {
      return 0;
    }
    const lang = textLanguage();
    const devices = batteries().map((battery) => buildBatteryDevice(gladys, battery, lang));
    const signature = JSON.stringify(devices);
    if (force || signature !== lastDiscovery) {
      try {
        await gladys.publishDiscoveredDevices(devices);
        lastDiscovery = signature;
      } catch (err) {
        logger.warn(`Unable to offer the devices: ${err.message}`);
      }
    }
    return devices.length;
  }

  /**
   * @description Send the states of the created batteries that changed.
   * @returns {Promise<number>} How many states were sent.
   */
  async function publishStates() {
    clearTimeout(publishTimer);
    publishTimer = null;
    const states = [];
    for (const battery of batteries()) {
      if (!createdDevices.has(batteryIds(gladys, battery.equipId).device)) continue;
      const reading = data().readings[battery.equipId] ?? null;
      const scene = battery.master ? data().scene : null;
      states.push(...buildBatteryStates(gladys, battery, valuesOf(reading, scene)));
    }
    if (!states.length) {
      return 0;
    }
    try {
      const { count } = await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      return count;
    } catch (err) {
      logger.warn(`Unable to send the states: ${err.message}`);
      return 0;
    }
  }

  /**
   * @description Send the states soon: at most every 10 seconds.
   * @returns {Promise<number>|undefined} The publication, when it ran now.
   */
  function publishSoon() {
    const wait = lastPublishAt + PUBLISH_GAP_MS - now();
    if (wait <= 0) {
      lastPublishAt = now();
      return publishStates();
    }
    if (timers && !publishTimer) {
      publishTimer = setTimeout(() => {
        lastPublishAt = now();
        publishStates();
      }, wait);
      publishTimer.unref?.();
    }
    return undefined;
  }

  /**
   * @description Ask the open widgets to pull their content again.
   */
  function refreshWidgets() {
    for (const key of Object.values(WIDGETS)) {
      Promise.resolve(gladys.requestWidgetRefresh(key)).catch(() => {});
    }
  }

  /**
   * @description Fire scene events, one by one.
   * @param {Array<{ key: string, data: object }>} events - The events.
   * @returns {Promise<void>}
   */
  async function publishEvents(events) {
    for (const { key, data: payload } of events) {
      logger.info(`StorCube: ${key}${payload.equip_id ? ` (${payload.equip_id})` : ''}`);
      try {
        await gladys.publishSceneEvent(key, payload);
      } catch (err) {
        logger.warn(`Unable to fire ${key}: ${err.message}`);
      }
    }
  }

  /**
   * @description The data of an event about a battery.
   * @param {string} equipId - The battery.
   * @returns {object} The event data.
   */
  function eventData(equipId) {
    const battery = batteries().find((item) => item.equipId === equipId) ?? {
      equipId,
      master: equipId === config.equipId,
    };
    const reading = data().readings[equipId] ?? null;
    return batteryData({
      externalId: batteryIds(gladys, equipId).device,
      name: batteryName({ ...battery, model: data().batteries[equipId]?.model }, textLanguage()),
      equipId,
      reading,
      threshold: data().scene?.reserved ?? masterReading()?.reserved ?? null,
    });
  }

  // --- Access ------------------------------------------------------------------------

  /**
   * @description The cloud refuses the login: stop everything until the configuration changes.
   * @param {Error} err - The refusal.
   * @returns {Promise<void>}
   */
  async function refuseAccess(err) {
    const first = !data().accessRefused;
    data().accessRefused = { code: err.code, detail: err.message.slice(0, 120), at: now() };
    data().token = null;
    realtime.stop();
    streamOn = false;
    await store.save();
    logger.warn(
      `StorCube login refused (code ${err.code}): no new try until the configuration changes`,
    );
    if (first) {
      await publishEvents([
        {
          key: TRIGGERS.ACCESS_REFUSED,
          data: {
            code: Number.isFinite(err.code) ? err.code : null,
            reason: err.message.slice(0, 200),
          },
        },
      ]);
    }
    await refreshStatus();
  }

  // --- Frames ------------------------------------------------------------------------

  /**
   * @description A frame of the stream: readings, new batteries, events, states.
   * @param {object} frame - The parsed JSON.
   * @returns {Promise<void>}
   */
  async function handleFrame(frame) {
    const raws = extractBatteries(frame);
    if (!raws.length) {
      return;
    }
    let added = false;
    const events = [];
    for (const raw of raws) {
      const reading = parseBattery(raw);
      if (!reading.equipId) continue;
      added = registerBattery(reading.equipId) || added;
      data().readings[reading.equipId] = { ...reading, at: now() };
      const seen = (data().seen[reading.equipId] ??= {});
      const threshold = data().scene?.reserved ?? masterReading()?.reserved ?? null;
      for (const key of detectLevel(seen, reading.soc, threshold)) {
        events.push({ key, data: eventData(reading.equipId) });
      }
      if (reading.equipId === config.equipId) {
        const key = detectOffline(seen, { lastFrameAt: now(), now: now(), cloudOk: true });
        if (key) events.push({ key, data: eventData(reading.equipId) });
      }
    }
    await store.save();
    if (added) {
      await publishDiscoveredDevices();
    }
    await publishEvents(events);
    await publishSoon();
    await refreshStatus();
  }

  // --- REST ----------------------------------------------------------------------------

  /**
   * @description Remember why a reading failed.
   * @param {Error} err - The error.
   * @returns {Promise<void>}
   */
  async function readingFailed(err) {
    if (err.kind === 'auth') {
      await refuseAccess(err);
      return;
    }
    cloudOk = false;
    sceneFailures += 1;
    const delay = Math.min(SCENE_EVERY_MS * 2 ** sceneFailures, SCENE_BACKOFF_MAX_MS);
    nextSceneAt = now() + delay;
    data().lastError = {
      kind: err.kind ?? 'network',
      detail: err.message.slice(0, 120),
      at: now(),
    };
    if (sceneFailures === 1) {
      logger.warn(`StorCube reading failed (${err.message}), next try in ${delay / 1000} s`);
    }
    await store.save();
    await refreshStatus();
  }

  /**
   * @description Read what is due: the settings of the stack, the firmware.
   * @returns {Promise<void>}
   */
  async function tick() {
    if (ticking) return ticking;
    ticking = (async () => {
      if (stopped || !isComplete(config) || data().accessRefused) {
        await refreshStatus();
        return;
      }
      if (now() >= nextSceneAt) {
        try {
          const scene = parseScene(await api.scene(config.equipId));
          cloudOk = true;
          sceneFailures = 0;
          nextSceneAt = now() + SCENE_EVERY_MS;
          if (!scene) {
            data().lastError = {
              kind: 'unknown_battery',
              detail: 'no scene for this battery',
              at: now(),
            };
            cloudOk = false;
          } else {
            data().lastError = null;
            data().scene = { ...scene, at: now() };
            if (Number.isFinite(scene.setpoint) && scene.setpoint > 0) {
              data().lastSetpoint = scene.setpoint;
            }
            let added = registerBattery(config.equipId);
            if (scene.model && data().batteries[config.equipId].model !== scene.model) {
              data().batteries[config.equipId].model = scene.model;
              added = true;
            }
            for (const member of scene.members) {
              added = registerBattery(member) || added;
            }
            await store.save();
            if (added) await publishDiscoveredDevices();
          }
        } catch (err) {
          await readingFailed(err);
          return;
        }
      }
      if (cloudOk && now() >= nextFirmwareAt) {
        nextFirmwareAt = now() + FIRMWARE_EVERY_MS;
        try {
          const firmware = parseFirmware(await api.firmware(config.equipId));
          if (firmware) {
            data().firmware = { ...firmware, at: now() };
            const seen = (data().seen[config.equipId] ??= {});
            if (detectFirmware(seen, firmware)) {
              await publishEvents([
                {
                  key: TRIGGERS.FIRMWARE_UPDATE,
                  data: {
                    ...eventData(config.equipId),
                    installed_version: firmware.installed,
                    available_version: firmware.available,
                  },
                },
              ]);
            }
            await store.save();
          }
        } catch (err) {
          if (err.kind === 'auth') {
            await refuseAccess(err);
            return;
          }
          logger.debug(`StorCube firmware: ${err.message}`);
        }
      }
      // A master battery silent while the cloud answers.
      const reading = masterReading();
      if (reading) {
        const seen = (data().seen[config.equipId] ??= {});
        const key = detectOffline(seen, { lastFrameAt: reading.at, now: now(), cloudOk });
        if (key) {
          await store.save();
          await publishEvents([{ key, data: eventData(config.equipId) }]);
        }
      }
      await publishSoon();
      await refreshStatus();
    })().finally(() => {
      ticking = null;
    });
    return ticking;
  }

  // --- Configuration -----------------------------------------------------------------

  const accountOf = (value) => `${value.loginName}|${value.equipId}|${value.appCode}`;

  /**
   * @description Apply the configuration: start or stop the stream and the timer.
   * @returns {Promise<void>}
   */
  async function applyConfig() {
    if (isComplete(config) && data().account !== accountOf(config)) {
      // Another account or battery: start from scratch.
      const fresh = EMPTY();
      Object.keys(fresh).forEach((key) => {
        data()[key] = fresh[key];
      });
      data().account = accountOf(config);
      await store.save();
    }
    nextSceneAt = 0;
    sceneFailures = 0;
    nextFirmwareAt = 0;
    if (!isComplete(config) || data().accessRefused) {
      realtime.stop();
      streamOn = false;
      await refreshStatus();
      return;
    }
    registerBattery(config.equipId);
    await publishDiscoveredDevices();
    if (timers && !streamOn) {
      realtime.start();
      streamOn = true;
    }
    if (timers && !timer) {
      timer = setInterval(() => tick().catch((err) => logger.error('Tick', err)), TICK_MS);
      timer.unref?.();
      setTimeout(() => tick().catch((err) => logger.error('Tick', err)), 1000).unref?.();
    }
    await refreshStatus();
  }

  /**
   * @description Reload the whole config (internal keys included).
   * @param {object} [fallback] - Raw values to use when the read fails.
   * @returns {Promise<void>}
   */
  async function loadConfig(fallback) {
    try {
      const raw = await gladys.getConfig();
      config = normalizeConfig(raw);
      language = readLanguage(raw, language);
    } catch (err) {
      if (fallback) {
        config = normalizeConfig(fallback);
      }
      logger.error('Unable to read the configuration', err);
    }
  }

  gladys.onConfigUpdated(async (rawConfig) => {
    const previous = `${accountOf(config)}|${config.password}`;
    await loadConfig(rawConfig);
    logger.info('Configuration updated');
    lastStatus = null;
    lastDiscovery = null;
    if (`${accountOf(config)}|${config.password}` !== previous) {
      // New credentials: one new try, with a new token and stream.
      data().accessRefused = null;
      data().token = null;
      realtime.stop();
      streamOn = false;
      await store.save();
    }
    await applyConfig();
  });

  // --- Writes ------------------------------------------------------------------------

  /**
   * @description Send a new output setpoint and publish it.
   * @param {number} watts - 0 to 800.
   * @returns {Promise<void>}
   */
  async function setSetpoint(watts) {
    await api.setPower(config.equipId, watts);
    data().scene = { ...(data().scene ?? { reserved: null }), setpoint: watts, at: now() };
    if (watts > 0) data().lastSetpoint = watts;
    await store.save();
  }

  gladys.onSetValue(async (device, feature, value) => {
    const { equipId, key } = partsOfExternalId(feature?.external_id);
    if (!isComplete(config) || data().accessRefused) {
      throw new Error('StorCube is not configured, or its login is refused');
    }
    if (equipId !== config.equipId) {
      throw new Error(`Only the master battery ${config.equipId} takes commands`);
    }
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new Error(`Not a number: ${value}`);
    }
    try {
      if (key === 'output_setpoint') {
        await setSetpoint(Math.round(Math.min(MAX_SETPOINT, Math.max(0, number))));
      } else if (key === 'output_enabled') {
        await setSetpoint(number > 0 ? (data().lastSetpoint ?? MAX_SETPOINT) : 0);
      } else if (key === 'discharge_threshold') {
        const percent = Math.round(Math.min(100, Math.max(0, number)));
        await api.setThreshold(config.equipId, percent);
        data().scene = { ...(data().scene ?? { setpoint: null }), reserved: percent, at: now() };
        await store.save();
      } else {
        throw new Error(`Read-only feature: ${feature?.external_id}`);
      }
    } catch (err) {
      if (err.kind === 'auth') await refuseAccess(err);
      throw err;
    }
    // The setting is read again at the next tick (the cloud is the truth).
    nextSceneAt = now() + SCENE_EVERY_MS;
    await publishStates();
    refreshWidgets();
  });

  // --- Dashboard widget --------------------------------------------------------------

  gladys.onWidgetGet(WIDGETS.LIVE, async ({ language: lang } = {}) => {
    rememberLanguage(lang);
    if (!isComplete(config)) {
      return messageContent(t('widgetNotConfigured', lang));
    }
    if (data().accessRefused) {
      return messageContent(t('statusAuth', lang, { detail: data().accessRefused.detail }));
    }
    return buildLiveWidget({ view: viewOf(), language: lang, now: now(), timeZone });
  });

  // --- Configuration buttons -----------------------------------------------------------

  gladys.onAction(ACTIONS.TEST_CONNECTION, async () => {
    const lang = textLanguage();
    if (!isComplete(config)) {
      return all('testIncomplete');
    }
    try {
      // A new login: the test proves the credentials, not an old token.
      await api.token(true);
      const scene = parseScene(await api.scene(config.equipId));
      if (!scene) {
        return all('statusUnknownBattery', { id: config.equipId });
      }
      data().accessRefused = null;
      await store.save();
      if (!streamOn) await applyConfig();
      return all((language_) =>
        t('testOk', language_, {
          id: config.equipId,
          model: scene.model ?? t('unknown', language_),
          count: Math.max(1, new Set([config.equipId, ...scene.members]).size),
          setpoint: Number.isFinite(scene.setpoint) ? `${scene.setpoint} W` : '–',
          threshold: Number.isFinite(scene.reserved) ? `${scene.reserved} %` : '–',
        }),
      );
    } catch (err) {
      logger.warn(`StorCube test (${lang}): ${err.message}`);
      return all('testFailed', { detail: err.message.slice(0, 150) });
    }
  });

  gladys.onAction(ACTIONS.DIAGNOSTIC, async () => {
    const iso = (value) => (Number.isFinite(value) ? new Date(value).toISOString() : null);
    const report = {
      version: VERSION,
      timeZone,
      login: config.loginName ? `${config.loginName.slice(0, 2)}…` : 'missing',
      password: config.password ? 'set' : 'missing',
      equipId: config.equipId || 'missing',
      appCode: config.appCode,
      language: config.language,
      token: data().token ? { issued: iso(data().token.at) } : null,
      accessRefused: data().accessRefused,
      lastError: data().lastError,
      cloudOk,
      stream: { open: realtime.connected(), frames: realtime.frames() },
      requests: api.requests(),
      thresholdField: api.thresholdField(),
      nextScene: iso(nextSceneAt),
      scene: data().scene,
      firmware: data().firmware,
      lastSetpoint: data().lastSetpoint,
      batteries: batteries().map((battery) => ({
        ...battery,
        created: createdDevices.has(batteryIds(gladys, battery.equipId).device),
        reading: data().readings[battery.equipId] ?? null,
        seen: data().seen[battery.equipId] ?? null,
      })),
    };
    const json = JSON.stringify(report);
    const count = Math.max(1, Math.ceil(json.length / DIAGNOSTIC_CHUNK));
    for (let chunk = 0; chunk < count; chunk += 1) {
      logger.info(
        `StorCube diagnostic ${chunk + 1}/${count}: ${json.slice(chunk * DIAGNOSTIC_CHUNK, (chunk + 1) * DIAGNOSTIC_CHUNK)}`,
      );
    }
    return all('diagnosticDone', { count });
  });

  // --- Devices -----------------------------------------------------------------------

  gladys.onScanRequest(async () => {
    const count = await publishDiscoveredDevices(true);
    logger.info(`Scan: ${count} device(s) offered`);
    nextSceneAt = 0;
    tick().catch(() => {});
  });

  gladys.onDeviceCreated(async () => {
    await refreshCreatedDevices();
    // States sent before the device existed were dropped by Gladys, and the SDK
    // forgot what it sent for this device: send everything known again.
    await publishStates();
    refreshWidgets();
  });

  gladys.onDeviceDeleted(refreshCreatedDevices);

  // --- Connection lifecycle ----------------------------------------------------------
  // Each (re)connection resynchronizes; the promise lets the tests wait for it.
  let startup = Promise.resolve();
  gladys.on('connected', () => {
    startup = (async () => {
      await store.load();
      await loadConfig();
      await refreshCreatedDevices();
      lastStatus = null;
      lastDiscovery = null;
      await applyConfig();
    })().catch((err) => logger.error('Startup', err));
  });

  // --- Graceful shutdown -------------------------------------------------------------
  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    stopped = true;
    clearInterval(timer);
    clearTimeout(publishTimer);
    realtime.stop();
    await store.save();
  });

  return {
    store,
    api,
    realtime,
    tick,
    handleFrame,
    publishStates,
    viewOf,
    getConfig: () => config,
    whenReady: () => startup,
  };
}

export {
  createApp,
  ACTIONS,
  TOKEN_TTL_MS,
  SCENE_EVERY_MS,
  FIRMWARE_EVERY_MS,
  FRESH_MS,
  PUBLISH_GAP_MS,
  OFFLINE_MS,
};
