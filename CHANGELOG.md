# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - 2026-10-31

### Added

- **cloud:** a StorCube battery stack through the StorCube cloud (Baterway), with the e-mail and password of the StorCube app: real-time WebSocket stream, settings of the stack every 30 seconds, firmware every hour; one login whose token is kept for 12 hours, and nothing more after a refused login until the configuration changes
- **devices:** one device per battery (level, stored energy, temperature); the master battery also gives the solar power, the power sent to the house and the battery charge and discharge power, and takes the output setpoint (0 to 800 W), the injection switch and the discharge threshold, from the device card or a scene
- **scenes:** triggers when a battery is full, reaches its discharge threshold, goes silent or comes back, when a firmware update is offered and when the StorCube cloud refuses the login
- **widgets:** the stack now: battery level, solar, power to the house, charge or discharge, setpoint, threshold, expansion batteries and waiting firmware update
- **configuration:** "Test the connection" and "Diagnostic" buttons
- **i18n:** English, French, German and Spanish for the manifest, the runtime texts, the documentation and the README

[0.1.0]: https://github.com/William-De71/gladys-storcube/releases/tag/v0.1.0
