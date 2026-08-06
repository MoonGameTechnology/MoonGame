/**
 * BUILD-1 — окно построек мира (макет владельца): полноэкранный список зданий,
 * сгруппированный категориями, каждая строка — имя с уровнем, состояние
 * (✓ построено / ⏳ строится / кнопка «Строить» / причина замка), эффект, цена
 * с пометкой нехватки и срок. Открывается кнопкой «Построить» из панели мира.
 *
 * Тот же раздел труда, что у techTree/rankScreen: разметка ЧИСТАЯ
 * (`buildScreenHtml`, `buildCategory`), хоста трогает только `initBuildScreen(host)`.
 *
 * Правила НЕ копируются: состояние каждой строки — ответ ядра на настоящий приказ
 * (`probe(buildBuilding(...))`, RULES-1). Одна проба покрывает все причины разом:
 * ростер сектора, лимит экземпляров, идущую стройку, казну — и любую будущую.
 * `E_FORBIDDEN` не приглушает строку, а УБИРАЕТ её (CMD-VIS: чего нельзя — того нет):
 * на мёртвом мире список честно состоит из одной сборочной вышки.
 *
 * Чего в макете было, а здесь НЕТ — потому что нет в данных (не выдумываем):
 * «Слоты 2/5» (у ядра нет бюджета слотов — лимит объявлен НА здании, `maxPerPlanet`;
 * вместо слотов честный счётчик «построено: N») и «Черта: заражено» (каталог
 * прототипа не несёт черт зданий). Оба — остаток в бэклоге, не ложь на экране.
 */
import { buildingLevel, buildingMaxLevel } from '../../packages/shared-core/src/index';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import { t, tData } from '../../localization/runtime';
import { data } from './prototypeData';
import { buildingName, cost, esc, resLine } from './format';
import { BUILD_ICON } from './icons';
import { buildBuilding } from './actions';
import { planetName } from './planetName';

type BuildingDef = (typeof data.buildings)[string];

/** Ярус римской цифрой — как на дереве технологий. Уровней у зданий единицы. */
const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V'];
const roman = (n: number): string => ROMAN[n] ?? String(n);

export type BuildCategory = 'economy' | 'defense' | 'infra';
export const BUILD_CATEGORIES: ReadonlyArray<{ key: BuildCategory; label: string }> = [
  { key: 'economy', label: 'build.cat.economy' },
  { key: 'defense', label: 'build.cat.defense' },
  { key: 'infra', label: 'build.cat.infra' },
];

/** Категория выводится из ДАННЫХ здания, а не из рукописного списка id: новое
 *  здание попадает в свою группу тем полем, которое и есть его назначение. */
export function buildCategory(def: BuildingDef): BuildCategory {
  const lv1 = buildingLevel(def, 1);
  if (Object.values(lv1.produces ?? {}).some((n) => (n ?? 0) > 0) || (def.creditsBonus ?? 0) > 0)
    return 'economy';
  // Порог 0.01 — как у карточки кодекса: схема даёт КАЖДОМУ зданию защитный дефолт
  // 0.01, и без порога вся инфраструктура съезжала бы в «оборону».
  if ((lv1.defenseBonus ?? 0) > 0.01 || (lv1.aaDamage ?? 0) > 0) return 'defense';
  return 'infra';
}

/** «+12 металл/ч · +30% к обороне · −6 энергия/ч» — эффекты уровня одной строкой.
 *  Пустая строка = у здания нет числового эффекта (казарма) — строка ряда возьмёт
 *  текст досье. */
export function buildFx(def: BuildingDef, level: number): string {
  const lv = buildingLevel(def, Math.max(1, level));
  const fx: string[] = [];
  // Ресурс — иконкой и цветом, а не словом: та же чиповая форма, что у ценника.
  const prod = resLine(lv.produces ?? {}, { sign: true, per: 'h' });
  if (prod) fx.push(prod);
  if ((def.creditsBonus ?? 0) > 0)
    fx.push(t('build.fx.credits', { n: Math.round((def.creditsBonus ?? 0) * 100) }));
  // Тот же порог 0.01, что у категории: дефолт схемы — не эффект, а шум.
  if ((lv.defenseBonus ?? 0) > 0.01)
    fx.push(t('build.fx.defense', { n: Math.round((lv.defenseBonus ?? 0) * 100) }));
  if ((lv.aaDamage ?? 0) > 0) fx.push(t('build.fx.aa', { n: lv.aaDamage ?? 0 }));
  if ((lv.radarRange ?? 0) > 0) fx.push(t('build.fx.radar', { n: lv.radarRange ?? 0 }));
  if (def.enablesShipConstruction) fx.push(t('build.fx.shipyard'));
  const keep = resLine(
    Object.fromEntries(Object.entries(lv.upkeep ?? {}).map(([r, n]) => [r, -(n ?? 0)])),
    { sign: true, per: 'h' },
  );
  if (keep) fx.push(keep);
  return fx.join(' · ');
}

/** Состояние строки. Ядро — единственный судья: `probe` гоняет НАСТОЯЩИЙ приказ.
 *  `localQueued` добавляет только локальную (соло) очередь прототипа — её ядро не
 *  видит, стройку в ней таймит сам клиент. */
export type BuildRowSt =
  | { st: 'built'; level: number; count: number }
  | { st: 'queued' }
  | { st: 'avail'; affordable: boolean }
  | { st: 'hidden' }
  | { st: 'lock'; code: string };

export function buildRowState(
  state: GameState,
  me: string,
  planetId: string,
  id: string,
  probe: (a: Action) => string | null,
  localQueued: (planetId: string, id: string) => boolean,
): BuildRowSt {
  if (localQueued(planetId, id)) return { st: 'queued' };
  const code = probe(buildBuilding(me, planetId, id));
  if (code === null) return { st: 'avail', affordable: true };
  if (code === 'E_INSUFFICIENT') return { st: 'avail', affordable: false };
  if (code === 'E_ALREADY_QUEUED' || code === 'E_ALREADY_PAUSED') return { st: 'queued' };
  if (code === 'E_ALREADY_BUILT') {
    const mine = (state.planets[planetId]?.buildings ?? []).filter((b) => b.type === id);
    if (mine.length === 0) return { st: 'queued' }; // достроится — станет built
    return {
      st: 'built',
      level: Math.max(...mine.map((b) => b.level)),
      count: mine.length,
    };
  }
  // Ростер сектора / не тот мир: приказа не существует — нет и строки (CMD-VIS).
  if (code === 'E_FORBIDDEN' || code === 'E_NO_PLANET') return { st: 'hidden' };
  return { st: 'lock', code }; // незнакомый отказ показываем причиной, не прячем
}

/** Всё тело окна для одного мира. Чистая функция — `initBuildScreen` кормит её живым
 *  состоянием; `lockText` переводит незнакомый код отказа в слова (errText хоста). */
export function buildScreenHtml(
  state: GameState,
  me: string,
  planetId: string,
  probe: (a: Action) => string | null,
  localQueued: (planetId: string, id: string) => boolean,
  lockText: (code: string) => string,
  dossierBody?: (id: string, level: number) => string,
): string {
  const p = state.planets[planetId];
  if (!p) return '';
  const seat = state.players[me];
  const res = (seat?.resources ?? {}) as Record<string, number>;
  const pt = p.planetType ? data.planetTypes[p.planetType] : undefined;
  // Подзаголовок мира: тип и его честные бонусы. Бонус печатается только ненулевой —
  // «+0%» это шум, а не информация.
  const sub: string[] = [];
  if (pt) {
    sub.push(esc(tData(pt.name ?? p.planetType ?? '')));
    if ((pt.defenseBonus ?? 0) !== 0)
      sub.push(t('build.fx.defense', { n: Math.round((pt.defenseBonus ?? 0) * 100) }));
    if ((pt.productionBonus ?? 0) !== 0)
      sub.push(t('build.fx.production', { n: Math.round((pt.productionBonus ?? 0) * 100) }));
  }
  // Честный счётчик вместо выдуманных «слотов»: сколько зданий уже стоит.
  const head =
    `<div class="bw-top"><div class="bw-world"><b>${esc(planetName(p.id))}</b>` +
    (sub.length ? `<span>${sub.join(' · ')}</span>` : '') +
    `</div><span class="bw-cnt">⛭ ${t('build.head.built', { n: p.buildings.length })}</span></div>`;

  const groups = new Map<BuildCategory, string[]>();
  for (const id of Object.keys(data.buildings)) {
    const def = data.buildings[id]!;
    const st = buildRowState(state, me, planetId, id, probe, localQueued);
    if (st.st === 'hidden') continue;
    const maxLvl = buildingMaxLevel(def);
    const shownLvl = st.st === 'built' ? st.level : 1;
    const name =
      esc(buildingName(def.name, id)) + (maxLvl > 1 ? ` <i class="bw-lv">${roman(shownLvl)}</i>` : '');
    const right =
      st.st === 'built'
        ? `<span class="bw-st done">✓ ${t('build.state.done')}${st.count > 1 ? ` ×${st.count}` : ''}</span>`
        : st.st === 'queued'
          ? `<span class="bw-st run">⏳ ${t('build.state.queued')}</span>`
          : st.st === 'lock'
            ? `<span class="bw-st lock">🔒 ${esc(lockText(st.code))}</span>`
            : `<button class="bw-take" data-bw-go="${id}"${st.affordable ? '' : ' disabled'}>▷ ${
                st.affordable ? t('build.action.build') : t('build.action.no-res')
              }</button>`;
    // Эффект СВОЕГО уровня: построенное показывает, что даёт СЕЙЧАС, остальное — L1.
    const fx = buildFx(def, shownLvl) || (dossierBody ? dossierBody(id, shownLvl) : '');
    // Цена и срок: для построенного — цена СЛЕДУЮЩЕГО уровня (то, что можно купить),
    // для остального — вход первого уровня. Достроенному до упора платить нечего.
    const nextLvl = st.st === 'built' ? st.level + 1 : 1;
    const lv = nextLvl <= maxLvl ? buildingLevel(def, nextLvl) : null;
    const foot = lv
      ? `<div class="bw-foot"><span>${st.st === 'built' ? `<i class="bw-next">▲ ${roman(nextLvl)}</i> ` : ''}${cost(lv.cost, res)}</span>` +
        `<span class="bw-dur">${t('fmt.hours', { n: lv.buildTimeHours })}</span></div>`
      : '';
    const row =
      `<div class="bw-item st-${st.st}" data-bw="${id}">` +
      `<div class="bw-ih"><span class="bw-ic">${BUILD_ICON[id] ?? '▣'}</span><b>${name}</b>${right}</div>` +
      (fx ? `<div class="bw-fx">${fx}</div>` : '') +
      foot +
      `</div>`;
    const cat = buildCategory(def);
    groups.set(cat, [...(groups.get(cat) ?? []), row]);
  }

  let list = '';
  for (const c of BUILD_CATEGORIES) {
    const rows = groups.get(c.key);
    if (!rows?.length) continue; // пустую категорию не рисуем — заголовок без строк лжёт
    list += `<div class="bw-cath">${t(c.label)}</div>` + rows.join('');
  }
  return head + `<div class="bw-scroll"><div class="bw-list">${list}</div></div>`;
}

/** Что окну нужно от матч-экрана. */
export interface BuildHost {
  /** Само окно (`#buildwin`) — показ/скрытие классом .show и делегат кликов. */
  root(): HTMLElement;
  /** Тело (`#buildwinbody`) — часть, которая перерисовывается. */
  body(): HTMLElement;
  state(): GameState;
  me(): string;
  /** Проба ядра (canOrder) — та же, которой решается сам приказ. */
  probe(a: Action): string | null;
  /** Локальная (соло) очередь прототипа: заказ уже лежит, ядро о нём не знает. */
  localQueued(planetId: string, id: string): boolean;
  /** Заказ стройки хостовым путём (enqueueBuild: сеть → приказ, соло → очередь). */
  build(planetId: string, id: string): void;
  /** Тап по строке → полная карточка здания (кодекс с листалкой уровней). */
  openInfo(id: string): void;
  /** Незнакомый код отказа → слова (errText хоста). */
  lockText(code: string): string;
  /** Короткое описание здания для строк без числового эффекта (досье). */
  dossierBody(id: string, level: number): string;
}

export function initBuildScreen(host: BuildHost): {
  open: (planetId: string) => void;
  repaint: () => void;
  isOpen: () => boolean;
} {
  let planetId: string | null = null;
  // Кэш разметки как у techTree: одинаковую строку не переприсваиваем — innerHTML
  // пересоздаёт DOM даже на идентичном тексте и выбивал бы кнопку из-под пальца.
  let lastHtml = '';

  function repaint(): void {
    if (!planetId) return;
    const html = buildScreenHtml(
      host.state(),
      host.me(),
      planetId,
      (a) => host.probe(a),
      (pid, id) => host.localQueued(pid, id),
      (code) => host.lockText(code),
      (id, level) => host.dossierBody(id, level),
    );
    if (html === lastHtml) return;
    const body = host.body();
    const before = body.querySelector('.bw-scroll');
    const sy = before?.scrollTop ?? 0;
    body.innerHTML = html;
    lastHtml = html;
    const after = body.querySelector('.bw-scroll');
    if (after) after.scrollTop = sy;
  }

  host.root().addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    if (tg === host.root() || tg.classList.contains('tw-close')) {
      host.root().classList.remove('show');
      return;
    }
    // Кнопка «Строить» лежит ВНУТРИ кликабельной строки — спрашиваем по самому
    // приказу (data-bw-go) и выходим рано, иначе тап дал бы и заказ, и карточку.
    const go = (tg.closest('[data-bw-go]') as HTMLElement | null)?.dataset.bwGo;
    if (go && planetId) {
      host.build(planetId, go);
      repaint(); // строка тут же перекрашивается в «строится»
      return;
    }
    const row = (tg.closest('[data-bw]') as HTMLElement | null)?.dataset.bw;
    if (row) host.openInfo(row);
  });

  return {
    open: (pid: string) => {
      planetId = pid;
      lastHtml = ''; // другой мир — прошлая разметка не годится даже совпав строкой
      host.root().classList.add('show');
      repaint();
    },
    repaint,
    isOpen: () => host.root().classList.contains('show'),
  };
}
