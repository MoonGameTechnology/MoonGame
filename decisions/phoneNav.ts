/**
 * Нижняя панель телефона в партии (UIX-3.1, своя раскладка — UIX-3.3): разделы внизу и что
 * лежит в «Ещё».
 *
 * Раньше «Наука» и «Производство» жили в меню «☰» среди десяти пунктов с подписями 8 px, а
 * «Настройки» и «Выход» телефон не показывал вовсе. Скрытым меню на телефоне пользуются в
 * 57 % задач, видимым — в 86 % (NN/g); Material держит внизу 3–5 разделов
 * (`docs/ui-research.md`, правка 3).
 *
 * 1. **По умолчанию внизу пять разделов: Карта, Производство, Наука, События, Ещё.** Раздел
 *    нажимает НАСТОЯЩУЮ кнопку рельсы (`opens`): окно, вводная «впервые» и звук те же, что у
 *    рельсы.
 * 2. **Раздела без кнопки нет и внизу.** В забеге Sector Zero «Производства» нет
 *    (`sectorZeroTools.ts`): пункт, который ничего не открывает, хуже отсутствующего.
 * 3. **В «Ещё» — остальные окна полными словами, затем Настройки и выходы.** «Дипломатия»,
 *    «Корпорация», «Хранитель», а не «Дипло», «Корп», «Сон». Пункт есть, пока есть его
 *    кнопка: в забеге нет почты и рынка, а торговец и досье Роя появляются по ходу партии.
 * 4. **Нажатие сначала убирает окна над картой**, иначе новое окно легло бы под старое.
 *    Нажатие на уже открытый раздел ведёт к карте, как у вкладок.
 * 5. **Подсвечен раздел, чьё окно открыто;** нет такого — «Ещё», пока открыт её лист, иначе
 *    «Карта».
 * 6. **Число стоит на кнопке своего окна:** бои — у «Событий», непрочитанные письма — у
 *    «Сообщений», где бы те ни стояли. Окно в «Ещё» несёт число на своей плитке, а раздел
 *    «Ещё» — сумму того, что внутри. Ноль прячет значок: значок с «0» зовёт в пустоту. Пока
 *    лист «Ещё» открыт, числа стоят на плитках, и второе такое же на разделе не нужно.
 * 7. **Три места между Картой и «Ещё» игрок выбирает сам** (заказ владельца 2026-10-12,
 *    Настройки → Управление). Карта и «Ещё» стоят по краям всегда: Карта возвращает из любого
 *    окна, а «Ещё» ведёт ко всему, чего нет на панели. Снятое с панели окно уходит в «Ещё»,
 *    так что ничего не теряется. Сохранение и выходы на панель не ставятся: у края экрана их
 *    легко задеть пальцем.
 * 8. **Поставить окно, которое уже на панели, значит поменять их местами.** Так меняют
 *    порядок без перетаскивания, а на панели не бывает двух одинаковых кнопок.
 * 9. **Испорченная или устаревшая запись не ломает панель:** незнакомые и повторные окна
 *    отбрасываются, пустые места занимают окна раскладки по умолчанию.
 */

/** Окно, которое можно поставить на панель (правило 7). */
export type PhoneItemId =
  | 'production'
  | 'science'
  | 'events'
  | 'diplomacy'
  | 'mail'
  | 'pings'
  | 'market'
  | 'trader'
  | 'corporation'
  | 'steward'
  | 'dossier'
  | 'codex'
  | 'settings';

/** Пункт листа «Ещё»: любое окно, сохранение и выходы. */
export type PhoneMoreId = PhoneItemId | 'save' | 'abandon' | 'exit';

/** Раздел нижней панели: Карта, окно на одном из мест или «Ещё». */
export type PhoneSection = 'map' | PhoneItemId | 'more';

export interface PhoneItem {
  readonly id: PhoneMoreId;
  /** Ключ подписи в `/localization` — полное слово, без сокращений (правило 3). */
  readonly label: string;
  /** Селектор настоящей кнопки, которую нажимает пункт. */
  readonly opens: string;
}

/** Правила 1 и 3: все окна по порядку «Ещё» — окна партии, справочник, Настройки,
 *  сохранение и выходы. Первые три стоят на панели по умолчанию. */
export const PHONE_ITEMS: readonly PhoneItem[] = [
  { id: 'production', label: 'rail.constructor.label', opens: '#rail-constructor' },
  { id: 'science', label: 'rail.tech.label', opens: '#rail-tech' },
  { id: 'events', label: 'rail.log.label', opens: '#rail-log' },
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

/** Правило 7: подписи краёв панели — у Карты и «Ещё» своей кнопки рельсы нет. */
export const PHONE_EDGE_LABEL = { map: 'hud.map', more: 'hud.tools' } as const;

/** Правило 7: что можно поставить на панель — всё, кроме сохранения и выходов. */
export const PHONE_PINNABLE: readonly PhoneItemId[] = [
  'production',
  'science',
  'events',
  'diplomacy',
  'mail',
  'pings',
  'market',
  'trader',
  'corporation',
  'steward',
  'dossier',
  'codex',
  'settings',
];

/** Окна на местах панели слева направо. */
export type PhoneBar = readonly PhoneItemId[];

/** Правило 7: сколько мест между Картой и «Ещё». */
export const PHONE_BAR_SLOTS = 3;

/** Правило 1: раскладка по умолчанию. */
export const DEFAULT_PHONE_BAR: PhoneBar = ['production', 'science', 'events'];

/** Пункт по id. */
export function phoneItem(id: PhoneMoreId): PhoneItem {
  return PHONE_ITEMS.find((item) => item.id === id)!;
}

/** Ключ подписи раздела. */
export function phoneSectionLabel(tab: PhoneSection): string {
  return tab === 'map' || tab === 'more' ? PHONE_EDGE_LABEL[tab] : phoneItem(tab).label;
}

function pinnable(id: string): id is PhoneItemId {
  return (PHONE_PINNABLE as readonly string[]).includes(id);
}

/** Правило 9: раскладка из записи `serializePhoneBar`; нет записи — по умолчанию. */
export function parsePhoneBar(raw: string | null): PhoneBar {
  const bar: PhoneItemId[] = [];
  for (const part of (raw ?? '').split(',')) {
    const id = part.trim();
    if (bar.length < PHONE_BAR_SLOTS && pinnable(id) && !bar.includes(id)) bar.push(id);
  }
  for (const id of DEFAULT_PHONE_BAR)
    if (bar.length < PHONE_BAR_SLOTS && !bar.includes(id)) bar.push(id);
  return bar;
}

/** Запись раскладки для хранилища: id через запятую. */
export function serializePhoneBar(bar: PhoneBar): string {
  return bar.join(',');
}

/** Правила 7–8: поставить окно на место `slot`; окно с другого места меняется с ним местами. */
export function placeInBar(bar: PhoneBar, slot: number, id: PhoneItemId): PhoneBar {
  if (!Number.isInteger(slot) || slot < 0 || slot >= bar.length || !pinnable(id)) return bar;
  const next = [...bar];
  const from = next.indexOf(id);
  if (from >= 0) next[from] = next[slot]!;
  next[slot] = id;
  return next;
}

/** Правила 1, 2 и 7: разделы слева направо. `present` — есть ли кнопка по селектору. */
export function phoneTabs(bar: PhoneBar, present: (selector: string) => boolean): PhoneSection[] {
  return ['map', ...bar.filter((id) => present(phoneItem(id).opens)), 'more'];
}

/** Правила 3 и 7: пункты «Ещё» — окна не с панели, чья кнопка сейчас есть. */
export function phoneMoreItems(bar: PhoneBar, present: (selector: string) => boolean): PhoneItem[] {
  return PHONE_ITEMS.filter(
    (item) => !(bar as readonly string[]).includes(item.id) && present(item.opens),
  );
}

/** Правило 5: подсвеченный раздел. `open` — открыто ли окно раздела (у «Ещё» — её лист). */
export function activePhoneTab(bar: PhoneBar, open: (tab: PhoneSection) => boolean): PhoneSection {
  for (const tab of [...bar, 'more' as const]) if (open(tab)) return tab;
  return 'map';
}

/** Правило 4: какой раздел открыть, когда окна над картой убраны; `null` — остаться на карте. */
export function phoneTabTap(tab: PhoneSection, active: PhoneSection): PhoneSection | null {
  return tab === 'map' || tab === active ? null : tab;
}

/** Числа у окон: бои у «Событий», непрочитанные письма у «Сообщений». */
export type PhoneCounts = Partial<Record<PhoneItemId, number>>;

const badgeText = (n: number | undefined): string => (n !== undefined && n > 0 ? String(n) : '');

/** Правило 6: тексты значков разделов; пустая строка или нет ключа — значка нет. */
export function phoneBadges(
  bar: PhoneBar,
  counts: PhoneCounts,
  moreOpen: boolean,
): Partial<Record<PhoneSection, string>> {
  const out: Partial<Record<PhoneSection, string>> = {};
  let inside = 0;
  for (const [id, n] of Object.entries(counts) as [PhoneItemId, number][]) {
    if (bar.includes(id)) out[id] = badgeText(n);
    else if (n > 0) inside += n;
  }
  out.more = moreOpen ? '' : badgeText(inside);
  return out;
}

/** Правило 6: число на плитке «Ещё» — то же, что было бы у раздела. */
export function phoneTileBadge(counts: PhoneCounts, id: PhoneMoreId): string {
  return id === 'save' || id === 'abandon' || id === 'exit' ? '' : badgeText(counts[id]);
}
