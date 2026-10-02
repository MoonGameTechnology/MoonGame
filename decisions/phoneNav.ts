/**
 * Нижняя панель телефона в партии (UIX-3.1): пять разделов внизу и что лежит в «Ещё».
 *
 * Раньше «Наука» и «Производство» жили в меню «☰» среди десяти пунктов с подписями 8 px, а
 * «Настройки» и «Выход» телефон не показывал вовсе. Скрытым меню на телефоне пользуются в
 * 57 % задач, видимым — в 86 % (NN/g); Material держит внизу 3–5 разделов
 * (`docs/ui-research.md`, правка 3).
 *
 * 1. **Внизу пять разделов: Карта, Производство, Наука, События, Ещё.** Раздел нажимает
 *    НАСТОЯЩУЮ кнопку рельсы (`opens`): окно, вводная «впервые» и звук те же, что у рельсы.
 * 2. **Раздела без кнопки нет и внизу.** В забеге Sector Zero «Производства» нет
 *    (`sectorZeroTools.ts`): пункт, который ничего не открывает, хуже отсутствующего.
 * 3. **В «Ещё» — остальные окна полными словами, затем Настройки и выходы.** «Дипломатия»,
 *    «Корпорация», «Хранитель», а не «Дипло», «Корп», «Сон». Пункт есть, пока есть его
 *    кнопка: в забеге нет почты и рынка, а торговец и досье Роя появляются по ходу партии.
 * 4. **Нажатие сначала убирает окна над картой**, иначе новое окно легло бы под старое.
 *    Нажатие на уже открытый раздел ведёт к карте, как у вкладок.
 * 5. **Подсвечен раздел, чьё окно открыто;** нет такого — «Ещё», пока открыт её лист, иначе
 *    «Карта».
 * 6. **Число у «Событий» — бои, у «Ещё» — непрочитанные письма:** это значки тех же кнопок
 *    рельсы. Ноль прячет значок: значок с «0» зовёт в пустоту. Пока лист «Ещё» открыт, его
 *    число стоит на плитке «Сообщения», и второе такое же на разделе не нужно.
 */

/** Раздел нижней панели. */
export type PhoneSection = 'map' | 'production' | 'science' | 'events' | 'more';

export interface PhoneTab {
  readonly id: PhoneSection;
  /** Ключ подписи в `/localization`. */
  readonly label: string;
  /** Селектор настоящей кнопки, которую нажимает раздел; у «Карты» и «Ещё» её нет. */
  readonly opens: string | null;
}

/** Правило 1: разделы слева направо. */
export const PHONE_TABS: readonly PhoneTab[] = [
  { id: 'map', label: 'hud.map', opens: null },
  { id: 'production', label: 'rail.constructor.label', opens: '#rail-constructor' },
  { id: 'science', label: 'rail.tech.label', opens: '#rail-tech' },
  { id: 'events', label: 'rail.log.label', opens: '#rail-log' },
  { id: 'more', label: 'hud.tools', opens: null },
];

/** Пункт листа «Ещё». */
export type PhoneMoreId =
  | 'diplomacy'
  | 'mail'
  | 'pings'
  | 'market'
  | 'trader'
  | 'corporation'
  | 'steward'
  | 'dossier'
  | 'codex'
  | 'settings'
  | 'save'
  | 'abandon'
  | 'exit';

export interface PhoneMoreItem {
  readonly id: PhoneMoreId;
  /** Ключ подписи в `/localization` — полное слово, без сокращений (правило 3). */
  readonly label: string;
  /** Селектор настоящей кнопки, которую нажимает пункт. */
  readonly opens: string;
}

/** Правило 3: окна партии, справочник, затем Настройки, сохранение и выходы. */
export const PHONE_MORE: readonly PhoneMoreItem[] = [
  { id: 'diplomacy', label: 'rail.diplo.title', opens: '#rail-diplo' },
  { id: 'mail', label: 'rail.msgs.title', opens: '#rail-msgs' },
  { id: 'pings', label: 'rail.pings.label', opens: '#rail-pings' },
  { id: 'market', label: 'rail.market.label', opens: '#rail-market' },
  { id: 'trader', label: 'rail.trader.label', opens: '#rail-trader' },
  { id: 'corporation', label: 'rail.corp.title', opens: '#railcorp' },
  { id: 'steward', label: 'steward.name', opens: '#rail-steward' },
  { id: 'dossier', label: 'swarm.intel.title', opens: '#rail-dossier' },
  { id: 'codex', label: 'rail.help.title', opens: '#rail-help' },
  { id: 'settings', label: 'rail.settings.label', opens: '#rail-settings' },
  { id: 'save', label: 'solo.save.action', opens: '#devline [data-solo-save]' },
  { id: 'abandon', label: 'rail.abandon.title', opens: '#rail-abandon' },
  { id: 'exit', label: 'speed.exit', opens: '#rail-exit' },
];

/** Правило 2: разделы, чья кнопка сейчас есть. `present` — есть ли кнопка по селектору. */
export function phoneTabs(present: (selector: string) => boolean): PhoneTab[] {
  return PHONE_TABS.filter((tab) => tab.opens === null || present(tab.opens));
}

/** Правило 3: пункты «Ещё», чья кнопка сейчас есть. */
export function phoneMoreItems(present: (selector: string) => boolean): PhoneMoreItem[] {
  return PHONE_MORE.filter((item) => present(item.opens));
}

/** Правило 5: подсвеченный раздел. `open` — открыто ли окно раздела (у «Ещё» — её лист). */
export function activePhoneTab(open: (tab: PhoneSection) => boolean): PhoneSection {
  for (const tab of ['production', 'science', 'events', 'more'] as const) if (open(tab)) return tab;
  return 'map';
}

/** Правило 4: какой раздел открыть, когда окна над картой убраны; `null` — остаться на карте. */
export function phoneTabTap(tab: PhoneSection, active: PhoneSection): PhoneSection | null {
  return tab === 'map' || tab === active ? null : tab;
}

/** Правило 6: тексты значков разделов; пустая строка — значка нет. */
export function phoneBadges(
  battles: number,
  unread: number,
  moreOpen: boolean,
): { events: string; more: string } {
  const text = (n: number): string => (n > 0 ? String(n) : '');
  return { events: text(battles), more: moreOpen ? '' : text(unread) };
}
