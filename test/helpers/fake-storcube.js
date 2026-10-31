// A fake StorCube cloud (Baterway) for the tests: a real HTTP server and a
// WebSocket server on 127.0.0.1 (never the network), with the shapes
// storcube_Ha reads from real S1000 batteries. The login refusal is the one
// the real server answered on 2026-10-31 (HTTP 200, code 300).
// Nothing starts on import: `node --test` also loads this file.

import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';

const LOGIN = 'pascal@example.com';
const PASSWORD = 'balcon-2026';
const MASTER = '910012345';
const SLAVE = '910067890';
const NOW = Date.UTC(2026, 9, 31, 17, 0, 0);
const TZ = 'Europe/Paris';
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const silent = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * @description A new empty folder for /data.
 * @returns {string} The path.
 */
const dataDir = () => mkdtempSync(join(tmpdir(), 'storcube-test-'));

/**
 * @description A frame of the stream, as storcube_Ha documents it.
 * @param {object} [values] - `{ soc, pv1, pv2, inv, temp, capacity, reserved, slaveSoc }`.
 * @returns {object} The frame.
 */
function frame({
  soc = 64,
  pv1 = 210,
  pv2 = 180,
  inv = 300,
  temp = 21.5,
  capacity = 640,
  reserved = 10,
  slaveSoc,
} = {}) {
  const list = [{ equipId: MASTER, soc, temp, capacity, reserved, isWork: 1, version: 'V1.1.0' }];
  if (slaveSoc !== undefined) {
    list.push({ equipId: SLAVE, soc: slaveSoc, temp: 20.1, capacity: 700, isWork: 1 });
  }
  return {
    [MASTER]: { totalPv1power: pv1, totalPv2power: pv2, totalInvPower: inv, list },
  };
}

/**
 * @description Start the fake cloud.
 * @param {object} [options] - `{ members }`: the equipIds of the stack.
 * @returns {Promise<object>} `{ url, wsUrl, calls, scene, firmware, push, close, … }`.
 */
async function startFakeStorcube({ members = [MASTER] } = {}) {
  const fake = {
    calls: [],
    logins: 0,
    tokens: new Set(),
    subscriptions: [],
    sockets: new Set(),
    // How the cloud refuses a token: 'http' (401) or 'code' (body code 401).
    tokenRefusal: 'http',
    // The field name the "firmware" of this fake accepts for the threshold.
    thresholdField: 'threshold',
    // Answer with an error code to every authenticated request.
    failWith: null,
    scene: {
      equipId: MASTER,
      outputPower: 300,
      reserved: 10,
      outputType: 0,
      workStatus: 1,
      rgOnline: 1,
      mainEquipOnline: 1,
      equipType: 'S1000',
      equipModelCode: 'S1000',
      equipIds: members,
      createTime: '2026-10-31 17:58:00',
    },
    firmware: { lastBigVersion: 'V1.1.0', currentBigVersion: 'V1.1.0', upgread: false },
    revoke() {
      fake.tokens.clear();
    },
    push(payload) {
      const text = JSON.stringify(payload);
      for (const socket of fake.sockets) socket.send(text);
    },
  };

  const json = (res, body, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const call = {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body,
      authorization: req.headers.authorization ?? null,
      appCode: req.headers.appcode ?? null,
    };
    fake.calls.push(call);
    if (url.pathname === '/api/user/app/login') {
      if (
        body?.loginName === LOGIN &&
        body?.password === PASSWORD &&
        body?.appCode === 'Storcube'
      ) {
        fake.logins += 1;
        const token = `token-${fake.logins}`;
        fake.tokens.add(token);
        json(res, { code: 200, message: 'success', data: { token } });
      } else {
        json(res, {
          code: 300,
          message: `The account [${body?.loginName}] was not found`,
          msg: `The account [${body?.loginName}] was not found`,
        });
      }
      return;
    }
    if (!fake.tokens.has(call.authorization)) {
      if (fake.tokenRefusal === 'http') {
        json(res, { code: 401, message: 'Unauthorized' }, 401);
      } else {
        json(res, { code: 401, message: 'token expired' });
      }
      return;
    }
    if (fake.failWith) {
      json(res, { code: fake.failWith, message: 'system error' });
      return;
    }
    switch (url.pathname) {
      case '/api/scene/user/list/V2':
        json(res, {
          code: 200,
          data: call.query.equipId === fake.scene.equipId ? [fake.scene] : [],
        });
        return;
      case '/api/equip/version/need/upgrade':
        json(res, { code: 200, data: fake.firmware });
        return;
      case '/api/slb/equip/set/power':
        fake.scene.outputPower = Number(call.query.power);
        json(res, { code: 200, message: 'success', data: null });
        return;
      case '/api/scene/threshold/set':
        if (body?.[fake.thresholdField] !== undefined) {
          fake.scene.reserved = Number(body[fake.thresholdField]);
          json(res, { code: 200, message: 'success', data: null });
        } else {
          json(res, { code: 500, message: 'param error' });
        }
        return;
      default:
        json(res, { code: 404, message: 'not found' }, 404);
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const token = decodeURIComponent(req.url.split('/').pop());
    if (!req.url.startsWith('/equip/info/') || !fake.tokens.has(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.authorization = req.headers.authorization;
      fake.sockets.add(ws);
      ws.on('message', (data) => fake.subscriptions.push(JSON.parse(String(data))));
      ws.on('close', () => fake.sockets.delete(ws));
      ws.send('connected'); // a text acknowledgement, not JSON
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  fake.url = `http://127.0.0.1:${port}`;
  fake.wsUrl = `ws://127.0.0.1:${port}`;
  fake.close = async () => {
    for (const socket of fake.sockets) socket.terminate();
    wss.close();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  };
  return fake;
}

export {
  startFakeStorcube,
  frame,
  dataDir,
  silent,
  LOGIN,
  PASSWORD,
  MASTER,
  SLAVE,
  NOW,
  TZ,
  MINUTE,
  HOUR,
};
