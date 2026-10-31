// -----------------------------------------------------------------------------
// Dashboard widget of the StorCube integration.
//
//   - `live`  the stack now: the level of the master battery (gauge), the
//             solar power, the power sent to the house, the battery charging
//             or discharging, the output setpoint (or "injection off"); a
//             status with when the last frame came (or since when the battery
//             is silent), the discharge threshold, the level of each
//             expansion battery, and a waiting firmware update.
// No button: the setpoint, the injection switch and the threshold are device
// features, changed from the device card or a scene. Every text exists in the
// four languages (the content is cached per language). Budget of a card:
// 8 components, 1 main one, 6 tiles, 2 texts (1 body), 1 status, 4 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { t, ago, formatNumber } from './i18n.js';
import { formatTime } from './time.js';
import { solarOf, batteryPowerOf } from './parse.js';

const WIDGETS = { LIVE: 'live' };
const TTL_SECONDS = { live: 60, message: 120 };
const IDLE_W = 5;

/**
 * @description Truncate a text to a bound, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - The bound.
 * @returns {string} The text.
 */
function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @description A widget content made of one message.
 * @param {string} message - The message.
 * @param {number} [ttl] - Seconds.
 * @returns {object} The content.
 */
function messageContent(message, ttl = TTL_SECONDS.message) {
  return {
    ttl_seconds: ttl,
    components: [{ type: 'text', variant: 'body', text: clip(message, 300) }],
  };
}

/**
 * @description A power as a tile shows it: W under 1 kW, kW above.
 * @param {number} watts - Watts (absolute value shown).
 * @returns {{ value: number, unit: string }} The value.
 */
function powerTile(watts) {
  const value = Math.abs(watts);
  if (value >= 1000) {
    return { value: Math.round(value / 100) / 10, unit: 'kW' };
  }
  return { value: Math.round(value), unit: 'W' };
}

/**
 * @description The row of the freshness of the frames.
 * @param {object} view - The view of the stack.
 * @param {object} options - `{ language, now, timeZone }`.
 * @returns {object} A status row.
 */
function freshnessRow(view, { language, now, timeZone }) {
  const label = clip(t('rowReading', language), 40);
  const time = (instant) => formatTime(instant, { language, timeZone, now });
  if (view.offline) {
    return {
      label,
      value: clip(t('rowOffline', language, { time: time(view.offlineSince) }), 40),
      color: WIDGET_COLORS.DANGER,
    };
  }
  if (!Number.isFinite(view.readingAt)) {
    return { label, value: clip(t('rowNoReading', language), 40), color: WIDGET_COLORS.WARNING };
  }
  return {
    label,
    value: clip(
      t('rowAgo', language, {
        time: time(view.readingAt),
        ago: ago(view.readingAt, now, language),
      }),
      40,
    ),
    color: view.fresh ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
  };
}

/**
 * @description The "live" widget.
 * @param {object} options - Options.
 * @param {object} options.view - The view of the stack (app.js): `{ equipId,
 * model, reading, readingAt, fresh, offline, offlineSince, setpoint,
 * threshold, expansions: [{ equipId, soc }], firmware }`.
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @param {string} options.timeZone - The timezone of Gladys.
 * @returns {object} The content.
 */
function buildLiveWidget({ view, language, now, timeZone }) {
  const caption = {
    type: 'text',
    variant: 'caption',
    text: clip([view.model ? `StorCube ${view.model}` : 'StorCube', view.equipId].join(' · '), 60),
  };
  const reading = view.reading;
  const components = [caption];
  if (!reading) {
    components.push({
      type: 'text',
      variant: 'body',
      text: clip(t(view.offline ? 'widgetOffline' : 'widgetWaiting', language), 300),
    });
  }
  if (Number.isFinite(reading?.soc)) {
    const limit = Number.isFinite(view.threshold) ? view.threshold : 10;
    components.push({
      type: 'gauge',
      value: Math.round(reading.soc),
      min: 0,
      max: 100,
      unit: '%',
      label: clip(t('tileBattery', language), 24),
      color:
        reading.soc <= limit + 1
          ? WIDGET_COLORS.DANGER
          : reading.soc < 30
            ? WIDGET_COLORS.WARNING
            : WIDGET_COLORS.SUCCESS,
    });
  }
  const solar = reading ? solarOf(reading) : null;
  if (Number.isFinite(solar)) {
    components.push({
      type: 'value',
      ...powerTile(solar),
      label: clip(t('tileSolar', language), 24),
      icon: 'sun',
      color: solar > IDLE_W ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (Number.isFinite(reading?.output)) {
    components.push({
      type: 'value',
      ...powerTile(Math.max(0, reading.output)),
      label: clip(t('tileHouse', language), 24),
      icon: 'home',
      color: reading.output > IDLE_W ? WIDGET_COLORS.PRIMARY : WIDGET_COLORS.NEUTRAL,
    });
  }
  const battery = reading ? batteryPowerOf(reading) : null;
  if (Number.isFinite(battery)) {
    const direction = battery > IDLE_W ? 'charge' : battery < -IDLE_W ? 'discharge' : 'idle';
    components.push({
      type: 'value',
      ...powerTile(direction === 'idle' ? 0 : battery),
      label: clip(
        t(
          { charge: 'tileCharging', discharge: 'tileDischarging', idle: 'tileBatteryIdle' }[
            direction
          ],
          language,
        ),
        24,
      ),
      icon: direction === 'charge' ? 'battery-charging' : 'battery',
      color: direction === 'charge' ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.INFO,
    });
  }
  if (Number.isFinite(view.setpoint)) {
    components.push({
      type: 'value',
      ...powerTile(view.setpoint),
      label: clip(t(view.setpoint > 0 ? 'tileSetpoint' : 'tileInjectionOff', language), 24),
      icon: 'sliders',
      color: view.setpoint > 0 ? WIDGET_COLORS.PRIMARY : WIDGET_COLORS.NEUTRAL,
    });
  }
  const rows = [freshnessRow(view, { language, now, timeZone })];
  if (Number.isFinite(view.threshold)) {
    rows.push({
      label: clip(t('rowThreshold', language), 40),
      value: `${formatNumber(view.threshold, language, 0)} %`,
      color: WIDGET_COLORS.INFO,
    });
  }
  for (const expansion of view.expansions ?? []) {
    rows.push({
      label: clip(t('rowExpansion', language, { id: expansion.equipId }), 40),
      value: Number.isFinite(expansion.soc) ? `${formatNumber(expansion.soc, language, 0)} %` : '–',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (view.firmware?.upgrade && view.firmware.available) {
    rows.push({
      label: clip(t('rowFirmware', language), 40),
      value: clip(t('valueUpdate', language, { version: view.firmware.available }), 40),
      color: WIDGET_COLORS.WARNING,
    });
  }
  components.push({ type: 'status', items: rows.slice(0, 8) });
  return { ttl_seconds: TTL_SECONDS.live, components };
}

export { WIDGETS, TTL_SECONDS, clip, messageContent, powerTile, buildLiveWidget };
