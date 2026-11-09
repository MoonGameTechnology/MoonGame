/**
 * Разметка окна «i» мира (UIX-10.12): полоса дохода, строки обороны, гарнизон сеткой и
 * свёрнутые блоки построек и эскадры. Окно только СООБЩАЕТ: заказы, очереди и конвейеры
 * живут в окне «Построить», здесь кнопок приказов нет, кроме шпионажа в строке статуса и
 * приказов эскадры внутри её блока. Правила подачи — `decisions/planetDossier.ts`.
 */
import type { Fleet, GameState, UnitStack } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import {
  groupBuildings,
  hpTone,
  incomeCells,
  scanAgeHours,
  type DossierGroup,
} from '../../decisions/planetDossier';
import { tileHp } from '../../decisions/unitTile';
import { buildCategory } from './buildScreen';
import { stackPools } from './fleetSummary';
import { buildingName, displayUnit, esc, flowPer, resChip } from './format';
import { data } from './gameData';
import { BUILD_ICON } from './icons';
import { foldHtml } from './dossierFolds';
import { INFO_ICON } from './infoIcon';
import { ownerColor } from './mapPalette';
import { productionIncomeDetails } from './productionIncome';
import { HOUR } from './time';

/** Строка «подпись — значение». */
const row = (label: string, value: string): string =>
  `<div class="drow"><span class="k">${esc(label)}</span><span class="v">${value}</span></div>`;

/** Секция с заголовком; пустая не рисуется. */
const section = (title: string, body: string): string =>
  body ? `<div class="dsec"><div class="dsec-t">${title}</div>${body}</div>` : '';

/** Полоса дохода своего мира за час (правило 2): тап открывает разбор «откуда». */
export function incomeBandHtml(s: GameState, me: string, worldId: string): string {
  const rates = productionIncomeDetails(s, me, worldId);
  if (!rates) return '';
  const cells = incomeCells(rates.net, rates.resources);
  if (cells.length === 0) return '';
  return (
    `<button class="dband" data-codex="income:${esc(worldId)}">` +
    `<span class="dband-t"><span>${t('production.planet-income')} <small>${flowPer()}</small></span>` +
    `<span class="dband-more">${INFO_ICON}${t('side.dossier.income.why')}</span></span>` +
    `<span class="dband-r">${cells.map((c) => resChip(c.res, c.perHour, { sign: true, per: 'h' })).join('')}</span>` +
    `</button>`
  );
}

/** Строки обороны: защита (фишки уже собраны картой), радар, орбита. Свой флот на орбите —
 *  кнопкой: тап выбирает его, как тап по флоту на карте. */
export function defenseHtml(
  radar: { reach: number; identify: number },
  me: string,
  cover: string,
  orbit: readonly Fleet[],
  sumShips: (f: Fleet) => number,
): string {
  const rows: string[] = [];
  if (cover) rows.push(row(t('side.dossier.protect'), cover));
  if (radar.reach > 0)
    rows.push(
      row(
        t('side.dossier.radar'),
        esc(
          t('side.dossier.radar.v', {
            d: Math.round(radar.reach),
            i: Math.round(radar.identify),
          }),
        ),
      ),
    );
  if (orbit.length)
    rows.push(
      row(
        t('side.world.fleets'),
        orbit
          .map((f) => {
            const text = `▲ ${esc(t('side.world.fleet-ships', { n: sumShips(f) }))}`;
            const tint = `style="color:${ownerColor(f.owner)}"`;
            return f.owner === me
              ? `<button class="dlink" data-act="selfleet" data-arg="${esc(f.id)}" ${tint}>${text}</button>`
              : `<span ${tint}>${text}</span>`;
          })
          .join(' '),
      ),
    );
  return section(t('build.cat.defense'), rows.join(''));
}

/** Гарнизон сеткой в две колонки: имя ×число и полоска здоровья, цвет которой говорит,
 *  насколько отряд ранен (правило 3). Тап — досье юнита. */
export function garrisonGridHtml(stacks: readonly UnitStack[], extra = ''): string {
  const cells = stacks
    .filter((st) => data.units[st.unit] && st.count > 0)
    .map((st) => {
      const hp = tileHp(stackPools(st, data).hull);
      return (
        `<button class="dunit" data-codex="u:${esc(st.unit)}" data-desc="u:${esc(st.unit)}">` +
        `<span class="dunit-t"><span>${esc(displayUnit(st.unit))}</span><b>×${st.count}</b></span>` +
        `<span class="dhp ${hpTone(hp.pct)}"><i style="width:${hp.pct}%"></i></span></button>`
      );
    })
    .join('');
  const total = stacks.reduce((n, st) => n + st.count, 0);
  const body = cells
    ? `<div class="dunits">${cells}</div>`
    : `<div class="row dim">${esc(t('side.none'))}</div>`;
  return section(`${esc(t('side.dossier.garrison'))} <b>${total}</b>`, extra + body);
}

/** Гарнизон мира в тумане: только число со снимка, состав разведка не раскрывает. */
export function scanGarrisonHtml(count: number): string {
  return section(
    `${esc(t('side.dossier.garrison'))} <b>≈${count}</b>`,
    `<div class="row dim">${esc(t('side.scan.garrison.hidden'))}</div>`,
  );
}

const groupOf = (type: string): DossierGroup => {
  const def = data.buildings[type];
  return def ? buildCategory(def) : 'infra';
};

const GROUP_KEY = {
  economy: 'build.cat.economy',
  defense: 'build.cat.defense',
  infra: 'build.cat.infra',
} as const;

/** Фишка постройки: имя, уровень и доход, если он дан; тап — карточка кодекса. */
function buildingChipHtml(b: { type: string; level: number }, income: string): string {
  const key = `b:${esc(b.type)}:${b.level}`;
  return (
    `<button class="dchip" data-codex="${key}" data-desc="${key}">` +
    `${BUILD_ICON[b.type] ?? '▪'} ${esc(buildingName(data.buildings[b.type]?.name, b.type))} ` +
    `<span class="lv">L${b.level}</span>${income ? ` <span class="inc">${income}</span>` : ''}</button>`
  );
}

/** Постройки одним свёрнутым блоком, внутри — свёрнутые группы окна «Построить» (правило 1).
 *  Доход у фишки — только если дан `incomeOf`: у мира в тумане его не знают. */
export function buildingsFoldHtml(
  buildings: ReadonlyArray<{ type: string; level: number }>,
  incomeOf?: (type: string, level: number) => string,
): string {
  if (buildings.length === 0) return '';
  return foldHtml('buildings', t('side.tab.buildings'), buildings.length, () =>
    groupBuildings(buildings, groupOf)
      .map((g) =>
        foldHtml(
          `grp:${g.group}`,
          t(GROUP_KEY[g.group]),
          g.items.length,
          () =>
            `<div class="dchips">${g.items.map((b) => buildingChipHtml(b, incomeOf?.(b.type, b.level) ?? '')).join('')}</div>`,
        ),
      )
      .join(''),
  );
}

/** Фишка возраста снимка разведки (правило 4); время снимка неизвестно — фишки нет. */
export function scanAgeHtml(takenAt: number | undefined, now: number): string {
  const h = scanAgeHours(takenAt, now, HOUR);
  if (h === null) return '';
  const text = h === 0 ? t('side.scan.age.fresh') : t('side.scan.age', { n: h });
  return `<span class="pfact old">🕘 ${esc(text)}</span>`;
}
