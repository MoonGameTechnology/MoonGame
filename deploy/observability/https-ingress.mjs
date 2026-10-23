// Render a separate Caddy site. This does not edit/reload the live Game policy.
import { X509Certificate } from 'node:crypto';

export function monitoringSite(hostname, caPem) {
  if (typeof hostname !== 'string' || hostname.length > 253 ||
      !/^(?=.{1,253}$)[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(hostname))
    throw new Error('E_OBS_INGRESS');
  let ca;
  try {
    ca = new X509Certificate(caPem);
    if (!ca.ca) throw new Error();
  } catch { throw new Error('E_OBS_INGRESS'); }
  return `
# MoonGame operator ingress: client certificate AND individual Grafana password.
# No auth-proxy mode; client-supplied identity headers are never trusted.
${hostname} {
  tls {
    client_auth {
      mode require_and_verify
      trust_pool inline {
        trust_der ${ca.raw.toString('base64')}
      }
    }
  }
  header {
    Strict-Transport-Security "max-age=31536000"
    Cache-Control "no-store"
    Referrer-Policy "no-referrer"
  }
  reverse_proxy obs-grafana:3000 {
    header_up -X-WEBAUTH-USER
    header_up -X-WEBAUTH-ROLE
    header_up -X-Forwarded-User
    header_up -X-Forwarded-Email
    header_up -X-Auth-Request-User
    header_up -X-Auth-Request-Email
  }
}
`;
}
