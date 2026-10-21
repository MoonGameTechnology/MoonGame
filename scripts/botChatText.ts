import { LOCALE_SOURCES } from '../localization/bundles';
import type { BotReplyKey, BotReplyLocale } from '../packages/server/src/botSocial';

/** Host presentation adapter, with no global locale changes or wire extensions. */
export function botChatText(key: BotReplyKey, locale: BotReplyLocale): string {
  return LOCALE_SOURCES[locale][key] ?? LOCALE_SOURCES.ru[key] ?? key;
}
