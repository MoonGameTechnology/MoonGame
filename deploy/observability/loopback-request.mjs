import https from 'node:https';
import { readFileSync } from 'node:fs';

/** Fixed numeric loopback, verified TLS identity, no redirect or proxy handling.
 * The small fetch-compatible surface preserves existing bounded stream readers.
 */
export function loopbackRequestFromEnv(env = process.env) {
  const caPath = env.GAME_METRICS_TLS_CA_FILE;
  if (!caPath) {
    if (env.TLS_CERT_FILE) throw new Error('E_OBS_TLS_CONFIG');
    return fetch;
  }
  const servername =
    env.GAME_METRICS_TLS_SERVERNAME || env.HEALTHCHECK_TLS_SERVERNAME || 'localhost';
  if (!/^[A-Za-z0-9.-]+$/.test(servername)) throw new Error('E_OBS_TLS_CONFIG');
  const ca = readFileSync(caPath);
  return (url, init = {}) =>
    new Promise((resolve, reject) => {
      let target;
      try {
        target = new URL(url);
      } catch {
        reject(new Error('E_OBS_SOURCE'));
        return;
      }
      if (
        target.hostname !== '127.0.0.1' ||
        target.username ||
        target.password ||
        target.hash ||
        !['http:', 'https:'].includes(target.protocol)
      ) {
        reject(new Error('E_OBS_SOURCE'));
        return;
      }
      const request = https.request(
        {
          hostname: '127.0.0.1',
          port: Number(target.port || 8788),
          path: target.pathname + target.search,
          method: 'GET',
          headers: init.headers,
          signal: init.signal,
          ca,
          servername,
          minVersion: 'TLSv1.2',
          rejectUnauthorized: true,
        },
        (response) => {
          response.cancel = async () => {
            response.destroy();
          };
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            body: response,
          });
        },
      );
      request.on('error', () => reject(new Error('E_OBS_SOURCE')));
      request.end();
    });
}
