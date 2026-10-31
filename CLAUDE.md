# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for **StorCube** balcony
batteries (S1000 and its expansion batteries): a Node.js service (Node 22+,
ESM, no build step) in its own sandboxed Docker container, talking to Gladys
through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to the StorCube cloud (Baterway, `baterway.com`, the server of the StorCube
app) with the e-mail and password of the app account. Runtime dependencies:
the SDK and `ws` (Node's global WebSocket cannot send headers; the SDK already
depends on `ws`). `type: "device"`, Gladys 5.3.0+, `transports: ["cloud"]`.
Not affiliated with StorCube.

**The API is neither documented nor official.** Endpoints, fields and frame
shapes come from the Home Assistant integration
[storcube_Ha](https://github.com/jon7119/storcube_Ha) (MIT, fork xez7082),
which reads real S1000 batteries (firmware 1.1.0). **Never tested with a real
battery**; only the refused login was checked live (2026-10-31: HTTP 200,
`{"code":300,"message":"The account [x] was not found"}`). The fixtures of
`test/helpers/fake-storcube.js` are rebuilt from the HA code, not captured.

## Commands

```bash
npm install
npm test                                  # node --test; a fake StorCube cloud (HTTP + WS) on 127.0.0.1
node --test test/app.test.js              # one file
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/discovery.baseline.json (on purpose only)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg, logo inlined
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js               SDK wiring only (new GladysIntegration + createApp)
src/app.js             every handler: config, timer (scene every 30 s with backoff, firmware
                       hourly), frames -> readings / events / states, commands (setValue),
                       widget, configuration buttons, status
src/storcube-api.js    REST client: login, token (raw Authorization + appCode), one re-login on
                       a refused token, `code` checked (HTTP is always 200), threshold field fallback
src/realtime.js        WebSocket stream (ws): token in path and header, subscription frame,
                       re-subscribe after 30 s of silence, ping, reconnect 5 s -> 5 min
src/parse.js           frames (3 shapes, stack totals to the master only), scene, firmware
src/device.js          one device per battery, features and states
src/events.js          triggers (full, threshold, silent / back, firmware, login refused)
src/widgets.js         the live widget
src/time.js            local times (TZ of Gladys, Intl only)
src/store.js           /data/storcube.json (token, readings, scene, firmware, seen)
src/config.js          e-mail, password, master serial number, app code, language
src/i18n.js            runtime texts, en / fr / de / es
test/helpers/fake-storcube.js   the fake cloud (login, token refusal, scene, writes, WS frames)
.github/scripts/release.mjs     version, changelog, bump (tested in test/)
```

## Rules

- **External ids are forever**, and so is every key users store:
  `ext:<selector>:battery:<equipId>`, features `…:<key>` (`battery_level`,
  `battery_energy_remaining`, `battery_charge_power`,
  `battery_discharge_power`, `pv_power`, `output_power`, `output_setpoint`,
  `output_enabled`, `discharge_threshold`, `temperature`), feature `category`
  / `type` / `unit` / `min` / `max` / `step`, the keys of `config_schema` and
  `actions`, `last_language`, the widget, the triggers (fields, variables).
  `test/structure.test.js` compares them to
  `test/fixtures/discovery.baseline.json`: never update it to make a test pass
  without a documented migration.
- **Core contracts of the categories** (server/utils/constants.js):
  battery-storage powers are >= 0 (the worked-out battery power becomes charge
  and discharge), `battery-energy-remaining` is kWh, what the battery sends to
  the house is `home-output-sensor` / `power`, the battery's own temperature
  is `device-temperature-sensor`. **No energy index**: frames are irregular.
- **Setpoint and threshold are `switch` / `dimmer`** (writable slider); the
  threshold has no unit (`%` is not a switch unit). Commands go to the master
  battery only.
- **One login.** The token is kept in /data 12 hours and reused after a
  restart; a refused token logs in again once. **A refused login stops
  everything** (stream, timer, commands) until the e-mail, password, serial
  number or app code change: never retry it on a timer.
- **The password** is a `secret`: never logged, never in /data, never in the
  diagnostic. It travels in clear to the cloud (plain HTTP): say it in the docs.
- **Scene events** once per transition, never at the first reading, never
  from a command. Offline only when the cloud itself answers.
- **States**: only for created devices, through `publishChangedStates`, at
  most every 10 s from frames; everything again on `onDeviceCreated`.
- **`should_poll` stays false**: the stream and the timer feed the data.
- **The container rootfs is read-only.** Write only under `/data`.
- **Four languages.** Every user-facing text (manifest, `src/i18n.js`,
  `docs/*.md`, README) exists in en, fr, de, es; `test/i18n.test.js` checks it.
  German says "du", Spanish "usted".
- **Widget images.** After any change to a widget content, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Cover.** StorCube is a trademark of its owner: the logo
  (`docs/assets/storcube-logo.png`, cut from the storcube_Ha repository) only
  names the brand; keep the "not affiliated" notices.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  Below 1.0.0 until the maintainer runs Release with `release-as: 1.0.0`.
- **Changelog.** Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Commits and PR titles** follow Conventional Commits, in English.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

## Pitfalls

- Every answer is HTTP 200: read `code` (200 = success). A wrong login
  answers code 300 and echoes the e-mail in `message`: it is scrubbed before
  any log or status.
- Without the subscription frame the WebSocket stays silent; the server also
  sends text acknowledgements that are not JSON.
- `capacity` in the frames is the energy still stored (Wh), not the size.
  `outputPower` of the scene is the setpoint, not a measure.
- `lastBigVersion` is the INSTALLED firmware, `currentBigVersion` the
  available one; `upgread` (sic).
- The threshold is accepted as `reserved`, `threshold` or `data` depending on
  the firmware: the one that worked is kept in memory.
- Some firmwares (S1000 Pro) never push the expansion batteries on the
  stream: `equipIds` of the scene lists them.
- `node --test` also runs `test/helpers/`: nothing starts on import.
- The validator of the Gladys core creates `gladys-development.duckdb` in the
  current folder: run it from elsewhere.
