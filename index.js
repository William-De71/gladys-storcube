// -----------------------------------------------------------------------------
// Entry point of the StorCube external integration.
//
// A StorCube balcony battery stack (S1000 and its expansion batteries),
// through the StorCube cloud (Baterway, the server of the StorCube app), with
// the e-mail and password of the app account:
//   - devices: one per battery — level, stored energy, temperature; the master
//     battery also gives the solar power, the power sent to the house, the
//     battery charge / discharge, and takes the output setpoint, the injection
//     switch and the discharge threshold (src/device.js);
//   - scene triggers: battery full, battery at its threshold, battery silent /
//     back, firmware update, login refused;
//   - dashboard widget: the stack now.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
//   TZ (the timezone of Gladys: the times shown in the widget)
// The SDK reads the first three: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys);

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the StorCube integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
