/**
 * GRND-1 · «Десант» — модель и разметка меню погрузки/выгрузки наземных частей.
 *
 * Раньше это была секция боковой панели с кнопкой на каждый тип и шагом ровно 1:
 * чтобы поднять пять ополченцев, игрок пять раз тыкал в «▲ Погрузить». Теперь в ряду
 * команд флота стоит кнопка ⇅ «Десант», а по ней раскрывается поповер над рядом — по
 * строке на тип, со счётчиком «сколько» и одним «Подтвердить».
 *
 * Счётчик строки — это ПЛАН, знаковая дельта: `+N` поднять из гарнизона на борт,
 * `−N` высадить с борта в гарнизон. Одна строка на тип закрывает оба направления,
 * поэтому в меню нет вкладок (переключение вкладки обнуляло бы набор) и «выгрузить
 * танки, взять пехоту» делается одним заходом.
 *
 * Модуль ЧИСТЫЙ: ни DOM, ни живого состояния — вход описывает мир числами, выход это
 * модель и строка HTML. Так арифметику «сколько влезет» можно накрыть тестом, чего у
 * прежней секции внутри main.ts не было вовсе.
 *
 * Что обязан знать вызывающий (и почему это ВХОД, а не расчёт внутри):
 * - `garrison`/`hold` — только ЗДОРОВЫЕ стеки с дефолтным лоадаутом: ядро поднимает
 *   на борт лишь их (`findHealthyStack`), побитый в бою стек виден в гарнизоне, но не
 *   грузится. `garrisonAll`/`holdAll` — все стеки, они нужны только для сноски.
 * - `reserved` — сколько единиц этого типа уже обещано отложенным погрузкам ЛЮБОГО
 *   флота у этого мира: гарнизон общий, и без этого вычета два флота закажут одного
 *   и того же солдата.
 * - `reservedCargo` — трюмное место, занятое собственной очередью этого флота.
 * - `cargoSize` — место под одну единицу. Сейчас у всех наземных он 1, но арифметика
 *   всё равно идёт через `floor(free / cargoSize)`: это заявленный data-driven шов.
 */
import { t } from '../../localization/runtime';
import { esc } from './format';

/** Одна строка меню — состояние типа юнита в паре «гарнизон ⇄ трюм». */
export interface TroopsUnitInput {
  unit: string;
  /** Здоровых единиц в гарнизоне (то, что ядро реально согласится поднять). */
  garrison: number;
  /** Всего единиц в гарнизоне, включая побитые стеки — только для сноски. */
  garrisonAll: number;
  /** Здоровых единиц в трюме. */
  hold: number;
  /** Всего единиц в трюме, включая побитые. */
  holdAll: number;
  /** Сколько единиц этого типа уже поднимает ЭТОТ флот (⏳ в подписи). */
  queued: number;
  /** Сколько единиц обещано очередям ВСЕХ флотов у этого мира. */
  reserved: number;
  /** Место под одну единицу. */
  cargoSize: number;
}

export interface TroopsInput {
  units: TroopsUnitInput[];
  /** Полная грузоподъёмность кораблей флота (с учётом модулей). */
  capacity: number;
  /** Место, занятое уже погруженным десантом. */
  used: number;
  /** Место, зарезервированное отложенными погрузками этого флота. */
  reservedCargo: number;
  /** План: unit → знаковая дельта (>0 погрузить, <0 выгрузить). */
  plan: Record<string, number>;
}

export interface TroopsRow extends TroopsUnitInput {
  /** Клампнутая дельта плана. */
  delta: number;
  /** Верхняя граница дельты: и гарнизон, и свободный трюм. */
  maxLoad: number;
  /** Нижняя граница по модулю: сколько здоровых единиц на борту. */
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
  /** Есть ли тип, у которого часть единиц не поднимется (побитые/иной лоадаут). */
  anyDamaged: boolean;
  /** Место кончилось, а в гарнизоне ещё есть кого брать — «трюм полон». */
  holdFull: boolean;
  /** Брать нечего: весь здоровый гарнизон уже разобран очередями. */
  garrisonDry: boolean;
  /** Есть ли что подтверждать. */
  valid: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Свести вход к модели: клампит план по обеим границам и считает остаток трюма.
 *  Строки конкурируют за одно и то же место, поэтому потолок погрузки строки — это
 *  её собственная дельта плюс то, что осталось свободным после ВСЕГО плана. */
export function troopsModel(input: TroopsInput): TroopsModel {
  const base = input.capacity - input.used - input.reservedCargo;
  // Первый проход: клампим каждую строку по её собственным границам, не глядя на трюм.
  const capped = input.units.map((u) => ({
    u,
    d: clamp(input.plan[u.unit] ?? 0, -u.hold, Math.max(0, u.garrison - u.reserved)),
  }));
  // Второй проход: место конечно — гасим лишние погрузки по порядку строк.
  let free = base;
  for (const c of capped) free += -c.d * c.u.cargoSize;
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
  let anyDamaged = false;
  const rows: TroopsRow[] = capped.map(({ u, d }) => {
    if (d > 0) loadTotal += d;
    if (d < 0) unloadTotal += -d;
    queuedTotal += u.queued;
    if (u.garrisonAll > u.garrison || u.holdAll > u.hold) anyDamaged = true;
    return {
      ...u,
      delta: d,
      maxLoad: Math.max(d, Math.min(u.garrison - u.reserved, d + Math.floor(free / u.cargoSize))),
      maxUnload: u.hold,
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
    freeCargo: Math.max(0, free),
    loadTotal,
    unloadTotal,
    queuedTotal,
    anyDamaged,
    holdFull: takeable && free < minSize,
    garrisonDry:
      !takeable &&
      loadTotal === 0 &&
      free >= minSize &&
      rows.some((r) => r.garrisonAll > 0 || r.reserved > 0),
    valid: loadTotal + unloadTotal > 0,
  };
}

/** Шаг счётчика строки. Как в диалоге разделения флота, шаг КЛАМПИТСЯ, а не
 *  блокируется: «+5» на трёх доступных даст +3, а не откажет. */
export function stepPlan(input: TroopsInput, unit: string, step: number): Record<string, number> {
  const row = troopsModel(input).rows.find((r) => r.unit === unit);
  if (!row) return input.plan;
  return { ...input.plan, [unit]: clamp(row.delta + step, -row.maxUnload, row.maxLoad) };
}

/** Пресет строки: `+1` — набить трюм этим типом доверху, `-1` — высадить всё своё. */
export function maxPlan(input: TroopsInput, unit: string, dir: 1 | -1): Record<string, number> {
  const row = troopsModel(input).rows.find((r) => r.unit === unit);
  if (!row) return input.plan;
  return { ...input.plan, [unit]: dir > 0 ? row.maxLoad : -row.maxUnload };
}

/** Разбить план на два списка приказов. Выгрузка мгновенна и уходит в ядро одним
 *  действием на тип (`count` ядро принимает атомарно), погрузка — в клиентскую
 *  очередь на ~1 игровой час за единицу. */
export function planOrders(m: TroopsModel): {
  load: Array<{ unit: string; count: number }>;
  unload: Array<{ unit: string; count: number }>;
} {
  const load: Array<{ unit: string; count: number }> = [];
  const unload: Array<{ unit: string; count: number }> = [];
  for (const r of m.rows) {
    if (r.delta > 0) load.push({ unit: r.unit, count: r.delta });
    else if (r.delta < 0) unload.push({ unit: r.unit, count: -r.delta });
  }
  return { load, unload };
}

export interface TroopsMenuOpts {
  /** SVG-значок типа юнита (тот же, что в списках флота). */
  icon: (unit: string) => string;
  /** Локализованное имя типа. */
  name: (unit: string) => string;
}

const stepBtn = (unit: string, n: number, glyph: string, title: string, off: boolean): string =>
  `<button data-cmd="tstep" data-unit="${esc(unit)}" data-n="${n}" title="${esc(title)}" aria-label="${esc(title)}"${off ? ' disabled' : ''}>${glyph}</button>`;

/** Пресет «до упора»: набить трюм этим типом (dir=1) / высадить всё своё (dir=-1).
 *  Треугольник против «+/−» — намеренная разница формы: крайние значения и мелкий
 *  шаг не должны выглядеть одинаково под пальцем на 30-пиксельной кнопке. */
const maxBtn = (unit: string, dir: 1 | -1, glyph: string, title: string, off: boolean): string =>
  `<button data-cmd="tmax" class="tall" data-unit="${esc(unit)}" data-dir="${dir}" title="${esc(title)}" aria-label="${esc(title)}"${off ? ' disabled' : ''}>${glyph}</button>`;

/** Разметка поповера. Живёт внутри строки #cmdbar, поэтому диспатчится общим
 *  `data-cmd`-обработчиком ряда и не заводит ни своего узла, ни своего слушателя.
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
      return `<div class="trow">
      <span class="tinfo">
        <span class="tname"><span class="bicon">${opts.icon(r.unit)}</span>${esc(nm)}</span>
        <span class="tcnt">${r.garrison} ▸ ${r.hold}${r.queued > 0 ? ` <em>⏳${r.queued}</em>` : ''}</span>
      </span>
      <span class="tbtns">
        ${maxBtn(r.unit, -1, '▼', unloadTitle, r.delta <= -r.maxUnload)}
        ${stepBtn(r.unit, -1, '−', unloadTitle, r.delta <= -r.maxUnload)}
        <b class="tdelta ${cls}">${sign}${r.delta}</b>
        ${stepBtn(r.unit, 1, '+', loadTitle, r.delta >= r.maxLoad)}
        ${maxBtn(r.unit, 1, '▲', loadTitle, r.delta >= r.maxLoad)}
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
    rows +
    (m.queuedTotal > 0
      ? `<div class="tnote">${esc(t('side.ground.loading', { n: m.queuedTotal }))}</div>`
      : '') +
    (m.holdFull ? `<div class="tnote warn">${esc(t('cargo.hold-full'))}</div>` : '') +
    (m.garrisonDry ? `<div class="tnote warn">${esc(t('cargo.garrison-empty'))}</div>` : '') +
    (m.anyDamaged ? `<div class="tnote">${esc(t('troops.damaged'))}</div>` : '') +
    `<div class="tnote">${esc(t('troops.timing'))}</div>` +
    `<div class="tacts">` +
    `<button data-cmd="tok" class="cbtn"${m.valid ? '' : ' disabled'}>${esc(t('split.confirm'))}</button>` +
    `<button data-cmd="tcancel" class="cbtn ghost">${esc(t('ping.cancel'))}</button>` +
    `</div>` +
    `</div>`
  );
}
