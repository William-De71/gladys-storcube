// -----------------------------------------------------------------------------
// The real-time stream of the StorCube cloud: a plain WebSocket (no TLS) on
// ws://baterway.com:9501/equip/info/<token>, the token also in the
// `Authorization` header (storcube_Ha: "the server expects the token in the
// path, not only in the headers"). Node's global WebSocket cannot send
// headers: the `ws` package does.
//
// Without the subscription frame
//   {"cmd":"sub","action":"report","reportEquip":["<equipId>"]}
// the server accepts the connection and never sends anything. After 30 s of
// silence the subscription is sent again; a ping every 15 s, and a
// connection that misses two pongs is dropped. Reconnection after 5 s,
// doubled up to 5 minutes; the delay starts again at 5 s once a frame came.
// A refused upgrade (HTTP 401 / 403) asks for a new token first.
// -----------------------------------------------------------------------------

import WebSocket from 'ws';

const DEFAULT_WS_URL = 'ws://baterway.com:9501';
const SILENCE_MS = 30000;
const PING_MS = 15000;
const RETRY_MIN_MS = 5000;
const RETRY_MAX_MS = 300000;

/**
 * @description The subscription frame.
 * @param {string} equipId - The master battery.
 * @returns {string} The JSON frame.
 */
const subscription = (equipId) =>
  JSON.stringify({ cmd: 'sub', action: 'report', reportEquip: [String(equipId)] });

/**
 * @description The stream: connects, subscribes, reconnects.
 * @param {object} options - Options.
 * @param {Function} options.token - `async (fresh) => token`.
 * @param {Function} options.equipId - `() => equipId`.
 * @param {Function} options.onFrame - Called with each parsed JSON frame.
 * @param {Function} [options.onError] - Called with `(error)` (kind `auth` stops).
 * @param {string} [options.url] - The server.
 * @param {Function} [options.WebSocketImpl] - The WebSocket class.
 * @param {object} [options.logger] - Logger.
 * @param {object} [options.timing] - `{ silenceMs, pingMs, retryMinMs, retryMaxMs }`.
 * @returns {object} `{ start, stop, connected, frames }`.
 */
function createRealtime({
  token,
  equipId,
  onFrame,
  onError = () => {},
  url = DEFAULT_WS_URL,
  WebSocketImpl = WebSocket,
  logger,
  timing = {},
}) {
  const silenceMs = timing.silenceMs ?? SILENCE_MS;
  const pingMs = timing.pingMs ?? PING_MS;
  const retryMinMs = timing.retryMinMs ?? RETRY_MIN_MS;
  const retryMaxMs = timing.retryMaxMs ?? RETRY_MAX_MS;
  let socket = null;
  let running = false;
  let retry = retryMinMs;
  let retryTimer = null;
  let silenceTimer = null;
  let pingTimer = null;
  let missedPongs = 0;
  let freshToken = false;
  let frames = 0;
  let open = false;

  const clearTimers = () => {
    clearTimeout(silenceTimer);
    clearInterval(pingTimer);
    silenceTimer = null;
    pingTimer = null;
  };

  const armSilence = (ws) => {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        logger?.debug('StorCube stream silent: subscribing again');
        ws.send(subscription(equipId()));
        armSilence(ws);
      }
    }, silenceMs);
    silenceTimer.unref?.();
  };

  const reconnectLater = () => {
    if (!running || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, retry);
    retryTimer.unref?.();
    retry = Math.min(retry * 2, retryMaxMs);
  };

  async function connect() {
    if (!running) return;
    let value;
    try {
      value = await token(freshToken);
      freshToken = false;
    } catch (err) {
      onError(err);
      if (err.kind !== 'auth') reconnectLater();
      return;
    }
    if (!running) return;
    const ws = new WebSocketImpl(`${url}/equip/info/${encodeURIComponent(value)}`, {
      headers: { Authorization: value, 'Content-Type': 'application/json' },
      handshakeTimeout: 20000,
    });
    socket = ws;
    ws.on('open', () => {
      open = true;
      missedPongs = 0;
      ws.send(subscription(equipId()));
      armSilence(ws);
      pingTimer = setInterval(() => {
        if (missedPongs >= 2) {
          logger?.debug('StorCube stream: no pong, dropping the connection');
          ws.terminate();
          return;
        }
        missedPongs += 1;
        ws.ping();
      }, pingMs);
      pingTimer.unref?.();
    });
    ws.on('pong', () => {
      missedPongs = 0;
    });
    ws.on('message', (data) => {
      armSilence(ws);
      let frame;
      try {
        frame = JSON.parse(String(data));
      } catch {
        return; // the server sends text acknowledgements
      }
      frames += 1;
      retry = retryMinMs;
      try {
        onFrame(frame);
      } catch (err) {
        logger?.warn(`StorCube frame ignored: ${err.message}`);
      }
    });
    ws.on('unexpected-response', (request, response) => {
      if ([401, 403].includes(response.statusCode)) {
        freshToken = true;
      }
      logger?.debug(`StorCube stream refused: HTTP ${response.statusCode}`);
      ws.terminate();
    });
    ws.on('error', (err) => {
      logger?.debug(`StorCube stream error: ${err.message}`);
    });
    ws.on('close', () => {
      open = false;
      clearTimers();
      if (socket === ws) socket = null;
      reconnectLater();
    });
  }

  return {
    start() {
      if (running) return;
      running = true;
      retry = retryMinMs;
      connect();
    },
    stop() {
      running = false;
      open = false;
      clearTimers();
      clearTimeout(retryTimer);
      retryTimer = null;
      if (socket) {
        socket.removeAllListeners('close');
        socket.on('error', () => {});
        socket.terminate();
        socket = null;
      }
    },
    connected: () => open,
    frames: () => frames,
  };
}

export { createRealtime, subscription, DEFAULT_WS_URL, SILENCE_MS, RETRY_MIN_MS, RETRY_MAX_MS };
