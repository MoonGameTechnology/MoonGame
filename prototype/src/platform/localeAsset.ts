/**
 * Язык архива площадки — файлом, а не в бандле (`YAG-1.1d`).
 *
 * В архиве `localization/runtime.ts` подменён на пустой рантайм (`platformBuild.mjs`), и
 * тексты приходят ровно одного языка: `assets/locale-<id>.json`, в котором русский
 * источник уже запечён фолбэком (`bakedLocale`). Остальные сборки открываются с диска,
 * без сервера, и по-прежнему несут все языки в себе.
 */
import type { LocaleId, Messages } from '../../../localization/core';

/** Путь файла языка — тот же, что пишет сборка (`platformBuild.mjs` → `localeAssetPath`);
 *  расхождение ловит `localeAsset.test.ts`. Относительный: архив распаковывают в
 *  произвольный префикс на стороне площадки. */
export const localeAssetPath = (id: LocaleId): string => `assets/locale-${id}.json`;

/** Файл языка — плоская карта «ключ → текст». Что угодно другое — отказ целиком, а не
 *  полупустой язык: игрок увидел бы вперемешку текст и ключи. */
export function parseLocaleAsset(raw: unknown): Messages | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entries = Object.entries(raw);
  if (entries.length === 0 || entries.some(([, text]) => typeof text !== 'string')) return null;
  return Object.fromEntries(entries) as Messages;
}

type FetchLike = (url: string) => Promise<Pick<Response, 'ok' | 'json'>>;

/** Скачать и проверить тексты языка. Любой сбой — `E_LOCALE_ASSET`: деталь (URL, статус)
 *  уходит в лог разработчика через экран сбоя запуска, игроку — только код. */
export async function loadLocaleAsset(
  id: LocaleId,
  fetchFn: FetchLike = (url) => fetch(url),
): Promise<Messages> {
  const res = await fetchFn(localeAssetPath(id));
  if (!res.ok) throw new Error('E_LOCALE_ASSET');
  const messages = parseLocaleAsset(await res.json());
  if (!messages) throw new Error('E_LOCALE_ASSET');
  return messages;
}
