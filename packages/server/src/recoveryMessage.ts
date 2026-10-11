import { LOCALE_SOURCES } from '../../../localization/bundles';
import { DEFAULT_LOCALE, type LocaleId } from '../../../localization';

/** Server-only template selection: no DOM runtime or process-wide locale mutation. */
export function recoveryMessage(locale: LocaleId, link: string): { subject: string; text: string } {
  const message = (key: string): string =>
    LOCALE_SOURCES[locale][key] ?? LOCALE_SOURCES[DEFAULT_LOCALE][key] ?? key;
  return {
    subject: message('auth.recovery-mail.subject'),
    text: message('auth.recovery-mail.text').replace('{link}', () => link),
  };
}
