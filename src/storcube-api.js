// -----------------------------------------------------------------------------
// REST client of the StorCube cloud (Baterway), the server of the StorCube
// mobile app. The API is NOT documented and NOT official: the endpoints come
// from the Home Assistant integration storcube_Ha (jon7119, MIT License).
//
//   POST /api/user/app/login                  { appCode, loginName, password }
//                                             -> data.token
//   GET  /api/scene/user/list/V2?equipId=     the settings of the stack
//   GET  /api/equip/version/need/upgrade?equipId=   firmware
//   GET  /api/slb/equip/set/power?equipId=&power=   output setpoint, W
//   POST /api/scene/threshold/set             { <field>: "<pct>", equipId }
//
// The server is plain HTTP (no TLS): the password travels in clear, as it
// does with the app itself. Every answer is HTTP 200 with a `code` in the
// body: 200 is a success. A wrong login answers (checked live on 2026-10-31)
// `{"code":300,"message":"The account [x] was not found"}`. The token goes in
// the `Authorization` header (raw, no "Bearer"), with `appCode`.
//
// Kinds of errors: `auth` (the login is refused: never retried until the
// configuration changes), `token` (a request refused with the token: log in
// again, once), `api` (any other refusal), `network` (timeout, HTTP error,
// not JSON).
// -----------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'http://baterway.com';
const TIMEOUT_MS = 20000;
const DEFAULT_APP_CODE = 'Storcube';
// storcube_Ha: "the API accepts the threshold under several field names
// depending on the firmware".
const THRESHOLD_FIELDS = ['reserved', 'threshold', 'data'];
const TOKEN_REFUSED = new Set([401, 403]);

class StorcubeError extends Error {
  /**
   * @param {string} kind - auth, token, api or network.
   * @param {string} message - The message (never the password).
   * @param {object} [details] - `{ code }`.
   */
  constructor(kind, message, details = {}) {
    super(message);
    this.name = 'StorcubeError';
    this.kind = kind;
    this.code = details.code ?? null;
  }
}

/**
 * @description Hide an e-mail address in a message of the server ("The
 * account [x] was not found" echoes the login).
 * @param {unknown} text - The message.
 * @returns {string} The message, without address, 200 characters at most.
 */
function scrub(text) {
  return String(text ?? '')
    .replace(/[^\s[\]@]+@[^\s[\]]+/g, '…')
    .slice(0, 200);
}

/**
 * @description The REST client.
 * @param {object} options - Options.
 * @param {Function} options.credentials - `() => ({ loginName, password, appCode })`.
 * @param {object} options.tokens - `{ get(): string|null, set(token): void }` (kept in /data).
 * @param {string} [options.baseUrl] - The server.
 * @param {Function} [options.fetch] - fetch().
 * @param {number} [options.timeoutMs] - Timeout of a request.
 * @returns {object} The client.
 */
function createStorcubeClient({
  credentials,
  tokens,
  baseUrl = DEFAULT_BASE_URL,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = TIMEOUT_MS,
}) {
  let thresholdField = null;
  let requests = 0;
  let loggingIn = null;

  /**
   * @description One HTTP request, JSON in and out.
   * @param {string} method - GET or POST.
   * @param {string} path - The path, from /api.
   * @param {object} [options] - `{ query, body, token }`.
   * @returns {Promise<object>} The JSON body.
   */
  async function http(method, path, { query, body, token } = {}) {
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      appCode: credentials().appCode || DEFAULT_APP_CODE,
    };
    if (token) headers.Authorization = token;
    requests += 1;
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new StorcubeError('network', `StorCube cloud unreachable: ${err.message}`);
    }
    if (TOKEN_REFUSED.has(response.status)) {
      throw new StorcubeError('token', `HTTP ${response.status}`, { code: response.status });
    }
    if (!response.ok) {
      throw new StorcubeError('network', `HTTP ${response.status}`, { code: response.status });
    }
    try {
      return await response.json();
    } catch {
      throw new StorcubeError('network', 'The StorCube cloud did not answer JSON');
    }
  }

  /**
   * @description Log in, keep the token.
   * @returns {Promise<string>} The token.
   */
  async function login() {
    const { loginName, password, appCode } = credentials();
    const payload = await http('POST', '/api/user/app/login', {
      body: { appCode: appCode || DEFAULT_APP_CODE, loginName, password },
    });
    const token = payload?.data?.token;
    if (payload?.code !== 200 || typeof token !== 'string' || !token) {
      throw new StorcubeError('auth', scrub(payload?.message ?? payload?.msg ?? 'login refused'), {
        code: payload?.code ?? null,
      });
    }
    tokens.set(token);
    return token;
  }

  /**
   * @description The token: the kept one, else a new login (one at a time).
   * @param {boolean} [fresh] - Log in again.
   * @returns {Promise<string>} The token.
   */
  async function token(fresh = false) {
    if (!fresh && tokens.get()) {
      return tokens.get();
    }
    loggingIn ??= login().finally(() => {
      loggingIn = null;
    });
    return loggingIn;
  }

  /**
   * @description An authenticated call: a refused token logs in again, once.
   * @param {string} method - GET or POST.
   * @param {string} path - The path.
   * @param {object} [options] - `{ query, body }`.
   * @returns {Promise<object>} The JSON body (its `code` checked by the caller).
   */
  async function call(method, path, options = {}) {
    for (const fresh of [false, true]) {
      let payload;
      try {
        payload = await http(method, path, { ...options, token: await token(fresh) });
      } catch (err) {
        if (err.kind === 'token' && !fresh) {
          tokens.set(null);
          continue;
        }
        throw err;
      }
      if (TOKEN_REFUSED.has(payload?.code) && !fresh) {
        tokens.set(null);
        continue;
      }
      return payload;
    }
    throw new StorcubeError('token', 'The StorCube cloud refuses the token');
  }

  /**
   * @description Check the `code` of an answer.
   * @param {object} payload - The answer.
   * @param {string} what - What was asked (for the message).
   * @returns {object} The answer.
   */
  function ok(payload, what) {
    if (payload?.code !== 200) {
      throw new StorcubeError(
        TOKEN_REFUSED.has(payload?.code) ? 'token' : 'api',
        `${what}: ${scrub(payload?.message ?? payload?.msg ?? `code ${payload?.code}`)}`,
        { code: payload?.code ?? null },
      );
    }
    return payload;
  }

  return {
    login,
    token,
    requests: () => requests,
    thresholdField: () => thresholdField,

    /**
     * @description The settings of the stack.
     * @param {string} equipId - The master battery.
     * @returns {Promise<unknown>} `data` (a list).
     */
    async scene(equipId) {
      const payload = await call('GET', '/api/scene/user/list/V2', { query: { equipId } });
      return ok(payload, 'scene').data;
    },

    /**
     * @description The firmware of the master battery.
     * @param {string} equipId - The master battery.
     * @returns {Promise<unknown>} `data`.
     */
    async firmware(equipId) {
      const payload = await call('GET', '/api/equip/version/need/upgrade', { query: { equipId } });
      return ok(payload, 'firmware').data;
    },

    /**
     * @description Set the output setpoint (the power sent to the house).
     * @param {string} equipId - The master battery.
     * @param {number} watts - 0 to 800.
     * @returns {Promise<void>}
     */
    async setPower(equipId, watts) {
      const payload = await call('GET', '/api/slb/equip/set/power', {
        query: { equipId, power: watts },
      });
      ok(payload, 'set power');
    },

    /**
     * @description Set the discharge threshold, trying the field names the
     * firmwares accept, and keeping the one that worked.
     * @param {string} equipId - The master battery.
     * @param {number} percent - 0 to 100.
     * @returns {Promise<string>} The field accepted.
     */
    async setThreshold(equipId, percent) {
      const fields = thresholdField ? [thresholdField] : THRESHOLD_FIELDS;
      let last = null;
      for (const field of fields) {
        const payload = await call('POST', '/api/scene/threshold/set', {
          body: { [field]: String(percent), equipId },
        });
        if (payload?.code === 200) {
          thresholdField = field;
          return field;
        }
        last = payload;
      }
      // The field kept stopped working: try them all next time.
      thresholdField = null;
      return ok(last, 'set threshold');
    },
  };
}

export {
  createStorcubeClient,
  StorcubeError,
  scrub,
  DEFAULT_BASE_URL,
  DEFAULT_APP_CODE,
  THRESHOLD_FIELDS,
  TIMEOUT_MS,
};
