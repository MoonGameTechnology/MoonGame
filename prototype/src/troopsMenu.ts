/**
 * Army transfer menu: a separate row for each source formation, with its wounds
 * and service visible. Positive deltas load, negative deltas unload. A plan uses
 * persistent server-owned group IDs; old callers may still supply unit-only rows.
 * The pure model reserves actual free cargo, never space from a future unload.
 */
import { t } from '../../localization/runtime';
import { esc, kfmt } from './format';
import type { ArmyGroupDetails } from '../../decisions/armyTransferRows';

/** Одна строка меню — выбранная группа в гарнизоне или трюме. */
export interface TroopsUnitInput extends Partial<ArmyGroupDetails> {
  unit: string;
  /** Единиц в группе гарнизона, включая раненых. */
  garrison: number;
  /** Всего единиц в группе гарнизона. */
  garrisonAll: number;
  /** Доступных единиц в группе трюма после вычета заявок. */
  hold: number;
  /** Всего единиц в трюме, включая побитые. */
  holdAll: number;
  /** Сколько единиц этой группы уже перевозит ЭТОТ флот (⏳ в подписи). */
  queued: number;
  /** Сколько единиц обещано очередям ВСЕХ флотов у этого мира. */
  reserved: number;
  /** Место под одну единицу. */
  cargoSize: number;
  /** Сколько из `garrison` — в раненых стеках. Нужно, чтобы спросить, кого грузить первыми. */
  wounded?: number;
}

export interface TroopsInput {
  units: TroopsUnitInput[];
  /** Полная грузоподъёмность кораблей флота (с учётом модулей). */
  capacity: number;
  /** Место, занятое уже погруженным десантом. */
  used: number;
  /** Место, зарезервированное отложенными погрузками этого флота. */
  reservedCargo: number;
  /** План: ключ группы → знаковая дельта (>0 погрузить, <0 выгрузить). */
  plan: Record<string, number>;
  /** Игрок нажал «Подтвердить», и меню спрашивает, кого грузить первыми. */
  asking?: boolean;
}

export interface TroopsRow extends TroopsUnitInput {
  /** Клампнутая дельта плана. */
  delta: number;
  /** Верхняя граница дельты: и гарнизон, и свободный трюм. */
  maxLoad: number;
  /** Нижняя граница по модулю: сколько доступных единиц в группе на борту. */
  maxUnload: number;
}

export interface TroopsModel {
  rows: TroopsRow[];
  capacity: number;
  used: number;
  reservedCargo: number;
  /** Свободное место ПОСЛЕ выполнения плана (никогда не отрицательное). */
  freeCargo: number;
  loadTotal: number;
  unloadTotal: number;
  queuedTotal: number;
  /** Место кончилось, а в гарнизоне ещё есть кого брать — «трюм полон». */
  holdFull: boolean;
  /** Брать нечего: весь гарнизон уже разобран очередями. */
  garrisonDry: boolean;
  /** Есть ли что подтверждать. */
  valid: boolean;
  /** Перед погрузкой спросить, кого брать первыми: у какого-то типа плана в гарнизоне
   *  есть и раненые, и целые, а берётся не весь доступный запас. */
  askFirst: boolean;
  /** Вопрос «кого первыми» уже на экране. */
  asking: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const rowKey = (row: TroopsUnitInput): string => row.key ?? row.unit;

/** Свести вход к модели: клампит план по обеим границам и считает остаток трюма.
 *  Строки конкурируют за одно и то же место, поэтому потолок погрузки строки — это
 *  её собственная дельта плюс то, что осталось свободным после ВСЕГО плана. */
export function troopsModel(input: TroopsInput): TroopsModel {
  const base = input.capacity - input.used - input.reservedCargo;
  // Первый проход: клампим каждую строку по её собственным границам, не глядя на трюм.
  const capped = input.units.map((u) => ({
    u,
    d:
      u.prepared === false
        ? 0
        : clamp(input.plan[rowKey(u)] ?? 0, -u.hold, Math.max(0, u.garrison - u.reserved)),
  }));
  // Второй проход: место конечно — гасим лишние погрузки по порядку строк.
  let free = base;
  for (const c of capped) if (c.d > 0) free -= c.d * c.u.cargoSize;
  for (const c of capped) {
    if (free >= 0) break;
    if (c.d <= 0) continue;
    const drop = Math.min(c.d, Math.ceil(-free / c.u.cargoSize));
    c.d -= drop;
    free += drop * c.u.cargoSize;
  }
  let loadTotal = 0;
  let unloadTotal = 0;
  let queuedTotal = 0;
  const rows: TroopsRow[] = capped.map(({ u, d }) => {
    if (d > 0) loadTotal += d;
    if (d < 0) unloadTotal += -d;
    queuedTotal += u.queued;
    return {
      ...u,
      delta: d,
      maxLoad:
        u.prepared === false
          ? 0
          : Math.max(
              d,
              Math.min(u.garrison - u.reserved, Math.max(0, d) + Math.floor(free / u.cargoSize)),
            ),
      maxUnload: u.prepared === false ? 0 : u.hold,
    };
  });
  // Почему «+» серая. Клик по disabled-кнопке ряда не всплывает, объяснить через
  // note() уже нельзя — значит причина обязана быть НАПИСАНА в самом меню. Обе
  // сноски — про ВНЕШНЮЮ преграду, а не про то, что игрок сам всё уже набрал:
  // «ещё есть кого брать, но некуда» и «брать нечего вовсе».
  const minSize = rows.reduce((m, r) => Math.min(m, r.cargoSize), Infinity);
  const takeable = rows.some((r) => r.garrison - r.reserved - Math.max(0, r.delta) > 0);
  return {
    rows,
    capacity: input.capacity,
    used: input.used,
    reservedCargo: input.reservedCargo,
    freeCargo: Math.max(0, free - capped.reduce((n, c) => n + Math.min(0, c.d) * c.u.cargoSize, 0)),
    loadTotal,
    unloadTotal,
    queuedTotal,
    holdFull: takeable && free < minSize,
    garrisonDry:
      !takeable &&
      loadTotal === 0 &&
      free >= minSize &&
      rows.some((r) => r.garrisonAll > 0 || r.reserved > 0),
    valid: loadTotal + unloadTotal > 0,
    askFirst: rows.some((r) => {
      const w = r.wounded ?? 0;
      return !r.group && r.delta > 0 && w > 0 && w < r.garrison && r.delta < r.garrison - r.reserved;
    }),
    asking: !!input.asking,
  };
}

/** Шаг счётчика строки. Как в диалоге разделения флота, шаг КЛАМПИТСЯ, а не
 *  блокируется: «+5» на трёх доступных даст +3, а не откажет. */
export function stepPlan(input: TroopsInput, unit: string, step: number): Record<string, number> {
  const row = troopsModel(input).rows.find((r) => rowKey(r) === unit);
  if (!row) return input.plan;
  return { ...input.plan, [unit]: clamp(row.delta + step, -row.maxUnload, row.maxLoad) };
}

/** Пресет строки: `+1` — набить трюм этим типом доверху, `-1` — высадить всё своё. */
export function maxPlan(input: TroopsInput, unit: string, dir: 1 | -1): Record<string, number> {
  const row = troopsModel(input).rows.find((r) => rowKey(r) === unit);
  if (!row) return input.plan;
  return { ...input.plan, [unit]: dir > 0 ? row.maxLoad : -row.maxUnload };
}

/** Приказы на выбранные группы. Погрузка и выгрузка завершаются в ядре через час. */
export function planOrders(m: TroopsModel): {
  load: Array<{ unit: string; count: number; group?: string }>;
  unload: Array<{ unit: string; count: number; group?: string }>;
} {
  const load: Array<{ unit: string; count: number; group?: string }> = [];
  const unload: Array<{ unit: string; count: number; group?: string }> = [];
  for (const r of m.rows) {
    const group = r.group ? { group: r.group } : {};
    if (r.delta > 0) load.push({ unit: r.unit, count: r.delta, ...group });
    else if (r.delta < 0) unload.push({ unit: r.unit, count: -r.delta, ...group });
  }
  return { load, unload };
}

export interface TroopsMenuOpts {
  /** SVG-значок типа юнита (тот же, что в списках флота). */
  icon: (unit: string) => string;
  /** Локализованное имя типа. */
  name: (unit: string) => string;
}

const stepBtn = (
  unit: string,
  n: number,
  glyph: string,
  title: string,
  off: boolean,
  group = unit,
): string =>
  `<button class="btn-second" data-cmd="tstep" data-unit="${esc(unit)}" data-group="${esc(group)}" data-n="${n}" title="${esc(title)}" aria-label="${esc(title)}"${off ? ' disabled' : ''}>${glyph}</button>`;

/** Пресет «до упора»: набить трюм этим типом (dir=1) / высадить всё своё (dir=-1).
 *  Треугольник против «+/−» — намеренная разница формы: крайние значения и мелкий
 *  шаг не должны выглядеть одинаково под пальцем на 30-пиксельной кнопке. Поэтому и
 *  стиль другой (UIX-11.1): шаг — вторичная кнопка в рамке, пресет — тихая, без рамки. */
const maxBtn = (
  unit: string,
  dir: 1 | -1,
  glyph: string,
  title: string,
  off: boolean,
  group = unit,
): string =>
  `<button data-cmd="tmax" class="tall btn-quiet" data-unit="${esc(unit)}" data-group="${esc(group)}" data-dir="${dir}" title="${esc(title)}" aria-label="${esc(title)}"${off ? ' disabled' : ''}>${glyph}</button>`;

/** Contents of the transfer window. Commands use the fleet command dispatcher.
 *  Живых тикающих чисел здесь нет намеренно: ряд диффится по строке каждый кадр,
 *  и счётчик времени переписывал бы DOM под пальцем, глотая нажатия. */
export function troopsMenuHtml(m: TroopsModel, opts: TroopsMenuOpts): string {
  const rows = m.rows
    .map((r) => {
      const nm = opts.name(r.unit);
      const sign = r.delta > 0 ? '+' : '';
      const cls = r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : '';
      const loadTitle = t('side.ground.load', { u: nm });
      const unloadTitle = t('side.ground.unload', { u: nm });
      const group = rowKey(r);
      const locationKey = r.side === 'garrison' ? 'troops.at-world' : 'troops.aboard';
      const details = r.side
        ? `<span class="tgroup-grade">${esc(r.grade ? t('troops.service', { n: r.grade }) : t('troops.recruits'))} · ${esc(t('troops.battles', { n: r.battles ?? 0 }))}</span><span class="tgroup-health${(r.health ?? 100) < 100 ? ' wounded' : ''}">${r.hp !== undefined && r.maxHp !== undefined ? `<b>${esc(t('troops.hp', { a: kfmt(r.hp), b: kfmt(r.maxHp) }))}</b> · ` : ''}${esc(t('troops.health', { n: r.health ?? 100 }))}<span aria-hidden="true" class="tgroup-bar"><i style="width:${r.health ?? 100}%"></i></span></span>`
        : '';
      const countLabel = r.side
        ? esc(t(locationKey, { n: r.side === 'garrison' ? r.garrisonAll : r.holdAll }))
        : `${r.garrison} ▸ ${r.hold}`;
      return `<div class="trow${r.delta ? ' chosen' : ''}" data-troop-group="${esc(group)}">
      <span class="tinfo">
        <span class="tname"><span class="bicon">${opts.icon(r.unit)}</span>${esc(nm)}</span>
        ${details}
        <span class="tcnt">${countLabel}${r.queued > 0 ? ` <em>⏳${r.queued}</em>` : ''}</span>
        ${r.reserved > 0 ? `<span class="tcnt">${esc(t('troops.reserved', { n: r.reserved }))}</span>` : ''}
      </span>
      <span class="tbtns">
        ${maxBtn(r.unit, -1, '▼', unloadTitle, r.delta <= -r.maxUnload, group)}
        ${stepBtn(r.unit, -1, '−', unloadTitle, r.delta <= -r.maxUnload, group)}
        <b class="tdelta ${cls}">${sign}${r.delta}</b>
        ${stepBtn(r.unit, 1, '+', loadTitle, r.delta >= r.maxLoad, group)}
        ${maxBtn(r.unit, 1, '▲', loadTitle, r.delta >= r.maxLoad, group)}
      </span>
    </div>`;
    })
    .join('');
  // Сводка плана — чисто числовая («+3−1»), без слов: сервер-независимое
  // форматирование, слова приходят из ключа `troops.planned`.
  const tally =
    (m.loadTotal > 0 ? `+${m.loadTotal}` : '') + (m.unloadTotal > 0 ? `−${m.unloadTotal}` : '');
  const planned = tally ? ` · ${esc(t('troops.planned', { n: tally }))}` : '';
  return (
    `<div class="cmdpop tpop">` +
    // «Трюм» показывает, каким он СТАНЕТ: занятое + очередь + набранный план. Это
    // прямой ответ на «сколько ещё влезет», ради которого меню и заводилось.
    `<div class="thead">${esc(t('troops.title'))} · ${esc(t('troops.hold', { a: m.capacity - m.freeCargo, b: m.capacity }))}${planned}</div>` +
    `<div class="tlegend">${esc(t('side.ground.legend'))}</div>` +
    `<div class="tlist">` +
    rows +
    (m.rows.some((r) => r.prepared === false)
      ? `<button type="button" class="btn-second" data-cmd="trefresh">${esc(t('troops.refresh'))}</button>`
      : '') +
    (m.queuedTotal > 0
      ? `<div class="tnote">${esc(t('troops.transferring', { n: m.queuedTotal }))}</div>`
      : '') +
    (m.holdFull ? `<div class="tnote warn">${esc(t('cargo.hold-full'))}</div>` : '') +
    (m.garrisonDry ? `<div class="tnote warn">${esc(t('cargo.garrison-empty'))}</div>` : '') +
    `<div class="tnote">${esc(t('troops.timing'))}</div>` +
    `<div class="tnote">${esc(t('troops.selection-note'))}</div>` +
    (m.asking && m.askFirst ? `<div class="tnote">${esc(t('troops.first.ask'))}</div>` : '') +
    `</div>` +
    (m.asking && m.askFirst
      ? `<div class="tacts">` +
        `<button data-cmd="tfirst" data-first="wounded" class="cbtn btn-main">${esc(t('troops.first.wounded'))}</button>` +
        `<button data-cmd="tfirst" data-first="healthy" class="cbtn btn-main">${esc(t('troops.first.healthy'))}</button>` +
        `<button data-cmd="tcancel" class="cbtn btn-quiet">${esc(t('ping.cancel'))}</button>` +
        `</div>`
      : `<div class="tacts">` +
        `<button data-cmd="tok" class="cbtn btn-main"${m.valid ? '' : ' disabled'}>${esc(t('split.confirm'))}</button>` +
        `<button data-cmd="tcancel" class="cbtn btn-quiet">${esc(t('ping.cancel'))}</button>` +
        `</div>`) +
    `</div>`
  );
}
