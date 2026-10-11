import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

/** Local socket, configured TLS identity. Never follows redirects or disables verification. */
export function healthcheck(env = process.env) {
  return new Promise((resolve) => {
    const key = env.TLS_KEY_FILE?.trim();
    const cert = env.TLS_CERT_FILE?.trim();
    if (Boolean(key) !== Boolean(cert)) return resolve(false);
    const port = Number(env.PORT || 8788);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return resolve(false);
    let ca;
    try {
      if (cert) ca = readFileSync(env.HEALTHCHECK_CA_FILE || cert);
    } catch {
      return resolve(false);
    }
    const request = (cert ? https : http).get(
      {
        hostname: '127.0.0.1',
        port,
        path: '/health',
        timeout: 2000,
        ...(cert
          ? {
              ca,
              servername: env.HEALTHCHECK_TLS_SERVERNAME || 'localhost',
              // A mounted leaf cert is an explicit trust anchor; hostname/expiry still checked.
              allowPartialTrustChain: true,
              minVersion: 'TLSv1.2',
            }
          : {}),
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = (await healthcheck()) ? 0 : 1;
}
