// -----------------------------------------------------------------------------
// The answers of the StorCube cloud (Baterway), made safe.
//
// The API is not documented. The shapes below come from the Home Assistant
// integration storcube_Ha (jon7119, MIT License; fork xez7082), which reads
// them from real S1000 batteries (firmware 1.1.0):
//
//   - WebSocket frames mix three shapes:
//       {"<equipId>": {"totalPv1power": …, "totalInvPower": …, "list": [{…}]}}
//       {"list": [{…}]}
//       {"code": 200, "data": [{…}]}
//     The totals of the container describe the whole stack: they belong to
//     the master battery only (copied on a slave they would count the solar
//     twice). Each item of `list` is one battery: `equipId`, `soc` (%),
//     `temp` (°C), `capacity` (Wh still stored, not the size), `pv1power`,
//     `pv2power`, `invPower` (W sent to the micro-inverter), `reserved`
//     (discharge threshold, %), `isWork`, `fgOnline`, `version`.
//   - REST `scene/user/list/V2`: `data[0]` holds the settings of the stack:
//     `equipId`, `outputPower` (the output setpoint, W, not a measure),
//     `reserved`, `outputType`, `workStatus`, `rgOnline`, `mainEquipOnline`,
//     `equipType`, `equipModelCode`, `equipIds` (every battery of the stack).
//   - REST `equip/version/need/upgrade`: `lastBigVersion` is the INSTALLED
//     version and `currentBigVersion` the available one (counter-intuitive, as
//     HA notes), `upgread` (sic) true when an update waits.
//
// A missing or non-numeric value is null, never 0.
// -----------------------------------------------------------------------------

/**
 * @description A finite number, or null.
 * @param {unknown} value - The raw value ("12.5", 12.5, null…).
 * @returns {number|null} The number.
 */
function toNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * @description The first value of a list of keys that is not null.
 * @param {object} raw - The object.
 * @param {...string} keys - The keys, in order of preference.
 * @returns {unknown} The value, or null.
 */
function first(raw, ...keys) {
  for (const key of keys) {
    if (raw?.[key] !== null && raw?.[key] !== undefined) {
      return raw[key];
    }
  }
  return null;
}

/**
 * @description A serial number as a string (equipIds are digits, sometimes numbers).
 * @param {unknown} value - The raw id.
 * @returns {string|null} The id.
 */
function idOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

/**
 * @description The raw batteries of a WebSocket frame (port of
 * _extract_batteries of storcube_Ha): the totals of a container are merged
 * into its master battery only.
 * @param {unknown} payload - The parsed frame.
 * @returns {object[]} The raw batteries, each with an `equipId`.
 */
function extractBatteries(payload) {
  const batteries = [];
  const collect = (node, fallbackId = null) => {
    if (Array.isArray(node)) {
      node.forEach((item) => collect(item, fallbackId));
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node.list)) {
      const totals = Object.fromEntries(
        Object.entries(node).filter(
          ([key, value]) => key !== 'list' && (value === null || typeof value !== 'object'),
        ),
      );
      const items = node.list.filter((item) => item && typeof item === 'object');
      const solo = items.length === 1;
      for (const item of items) {
        const equipId = idOf(item.equipId) ?? fallbackId;
        if (!equipId) continue;
        const master = solo || (fallbackId !== null && equipId === fallbackId);
        batteries.push({ ...(master ? totals : {}), ...item, equipId, master });
      }
      return;
    }
    const equipId = idOf(node.equipId) ?? fallbackId;
    if (equipId) {
      batteries.push({ ...node, equipId });
    }
  };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return batteries;
  }
  if (Array.isArray(payload.list)) {
    collect(payload);
  } else if (payload.code === 200 && Array.isArray(payload.data)) {
    collect(payload.data);
  } else {
    for (const [key, value] of Object.entries(payload)) {
      if (value && typeof value === 'object') {
        collect(value, /^\d+$/.test(key) ? key : null);
      }
    }
  }
  return batteries;
}

/**
 * @description One battery of a frame, made safe.
 * @param {object} raw - A raw battery of extractBatteries().
 * @returns {object} `{ equipId, soc, temperature, storedWh, pv1, pv2, output,
 * reserved, working, online, version }`, null when unknown.
 */
function parseBattery(raw) {
  const soc = toNumber(first(raw, 'soc'));
  const flag = (value) => (value === null ? null : toNumber(value) === 1);
  return {
    equipId: idOf(raw?.equipId),
    soc: soc === null ? null : Math.min(100, Math.max(0, soc)),
    temperature: toNumber(first(raw, 'temp')),
    storedWh: toNumber(first(raw, 'capacity')),
    // The measures first, the totals of the stack as a fallback (HA order).
    pv1: toNumber(first(raw, 'pv1power', 'totalPv1power')),
    pv2: toNumber(first(raw, 'pv2power', 'totalPv2power')),
    output: toNumber(first(raw, 'totalInvPower', 'invPower')),
    reserved: toNumber(first(raw, 'reserved')),
    working: flag(first(raw, 'isWork')),
    online: flag(first(raw, 'fgOnline')),
    version: typeof raw?.version === 'string' ? raw.version.slice(0, 40) : null,
  };
}

/**
 * @description The solar power of a battery: PV1 + PV2 when one is known.
 * @param {object} battery - parseBattery().
 * @returns {number|null} Watts (>= 0).
 */
function solarOf(battery) {
  if (battery.pv1 === null && battery.pv2 === null) {
    return null;
  }
  return Math.max(0, battery.pv1 ?? 0) + Math.max(0, battery.pv2 ?? 0);
}

/**
 * @description The battery power, as storcube_Ha works it out: what comes
 * from the panels minus what goes to the micro-inverter. The API has no such
 * field.
 * @param {object} battery - parseBattery().
 * @returns {number|null} Watts: > 0 charging, < 0 discharging.
 */
function batteryPowerOf(battery) {
  const solar = solarOf(battery);
  if (solar === null || battery.output === null) {
    return null;
  }
  return Math.round(solar - Math.max(0, battery.output));
}

/**
 * @description The settings of the stack (REST scene list).
 * @param {unknown} data - `data` of scene/user/list/V2.
 * @returns {object|null} `{ equipId, setpoint, reserved, outputType,
 * workStatus, online, model, equipType, members }`.
 */
function parseScene(data) {
  const scene = Array.isArray(data) ? data[0] : null;
  if (!scene || typeof scene !== 'object') {
    return null;
  }
  const rg = toNumber(scene.rgOnline);
  const main = toNumber(scene.mainEquipOnline);
  const text = (value) =>
    typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 60) : null;
  return {
    equipId: idOf(scene.equipId),
    setpoint: toNumber(scene.outputPower),
    reserved: toNumber(scene.reserved),
    outputType: text(scene.outputType),
    workStatus: toNumber(scene.workStatus),
    online: rg === null && main === null ? null : rg === 1 && main === 1,
    model: text(scene.equipModelCode),
    equipType: text(scene.equipType),
    members: (Array.isArray(scene.equipIds) ? scene.equipIds : []).map(idOf).filter(Boolean),
  };
}

/**
 * @description The firmware of the master battery.
 * @param {unknown} data - `data` of equip/version/need/upgrade.
 * @returns {object|null} `{ installed, available, upgrade }`.
 */
function parseFirmware(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  const version = (value) =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, 40) : null;
  const installed = version(data.lastBigVersion);
  return {
    installed,
    available: version(data.currentBigVersion) ?? installed,
    upgrade: data.upgread === true || data.upgread === 1 || data.upgread === 'true',
  };
}

export {
  toNumber,
  idOf,
  extractBatteries,
  parseBattery,
  solarOf,
  batteryPowerOf,
  parseScene,
  parseFirmware,
};
