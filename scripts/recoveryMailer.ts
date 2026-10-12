import { LOCALE_SOURCES } from '../localization/bundles';
import { DEFAULT_LOCALE, isLocaleId } from '../localization';
import type { Mailer, RecoveryMailer } from '../packages/server/src/authApi';

/** Host presentation adapter: each delivery selects its own locale, without global state. */
export function recoveryMailer(sendMail: Mailer | undefined): RecoveryMailer | undefined {
  if (!sendMail) return undefined;
  return ({ to, locale: requested, params: { link } }) => {
    const locale = isLocaleId(requested) ? requested : DEFAULT_LOCALE;
    const message = (key: string): string =>
      LOCALE_SOURCES[locale][key] ?? LOCALE_SOURCES[DEFAULT_LOCALE][key] ?? key;
    return sendMail({
      to,
      subject: message('auth.recovery-mail.subject'),
      text: message('auth.recovery-mail.text').replace('{link}', () => link),
    });
  };
}
