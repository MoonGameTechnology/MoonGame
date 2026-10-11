import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';
import type { Mailer } from './authApi';

/** Bound untrusted addresses and scan delimiters without regex backtracking. */
function isAddress(value: string): boolean {
  if (value.length > 254 || /[\s<>,;]/.test(value)) return false;
  const at = value.indexOf('@');
  const dot = value.lastIndexOf('.');
  return at > 0 && at === value.lastIndexOf('@') && dot > at + 1 && dot < value.length - 1;
}

/** Recovery is opt-in, but enabling it without a delivery transport is a startup error. */
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer | undefined {
  if (!env.RESET_BASE_URL) return undefined;
  const host = env.SMTP_HOST?.trim();
  const from = env.SMTP_FROM?.trim();
  const mode = env.SMTP_TLS_MODE || 'implicit';
  const port = Number(env.SMTP_PORT || (mode === 'implicit' ? 465 : 587));
  if (
    !host ||
    !from ||
    !isAddress(from) ||
    !['implicit', 'starttls'].includes(mode) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)
  )
    throw new Error('E_MAIL_CONFIG');
  let origin: URL;
  try {
    origin = new URL(env.RESET_BASE_URL);
  } catch {
    throw new Error('E_MAIL_CONFIG');
  }
  if (
    !['https:', 'http:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    (env.PROD === '1' && origin.protocol !== 'https:')
  )
    throw new Error('E_MAIL_CONFIG');
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: mode === 'implicit',
    requireTLS: true,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD! } } : {}),
    tls: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
      ...(env.SMTP_TLS_SERVERNAME ? { servername: env.SMTP_TLS_SERVERNAME } : {}),
      ...(env.SMTP_CA_FILE ? { ca: readFileSync(env.SMTP_CA_FILE) } : {}),
    },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10_000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return async (msg) => {
    if (!isAddress(msg.to)) throw new Error('E_MAIL_ADDRESS');
    try {
      await transport.sendMail({
        from,
        to: { name: '', address: msg.to },
        envelope: { from, to: [msg.to] },
        subject: msg.subject,
        text: msg.text,
      });
    } catch {
      // No recipient, credentials, SMTP responses or reset bearer in logs/errors.
      process.stderr.write('{"kind":"mail.delivery","ok":false,"code":"E_MAIL_DELIVERY"}\n');
      throw new Error('E_MAIL_DELIVERY');
    }
  };
}
