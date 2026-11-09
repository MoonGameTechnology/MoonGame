/**
 * КАРТОЧКА ЭСКАДРЫ НА СТОЯНКЕ (концепт «Управление эскадрой», заказ владельца 2026-11-08) —
 * та же вёрстка, что у эскадры в воздухе (`aloftPanelHtml`): имя, строка «где стоит и можно
 * ли лететь», состав, ряд приказов. Открывается тапом по значку ангара на карте.
 *
 * Что предлагать, решают `squadronPanel.ts` (кнопки ангара) и `decisions/hangarBadge.ts`
 * (строка состояния); здесь только разметка. Кнопки шлют те же действия, что и ангар в
 * «i» мира (`wingstrike`, `wingpatrol`…): у приказа одно имя и один обработчик, где бы
 * ни стояла кнопка. Кнопка есть, только если ядро примет приказ прямо сейчас.
 *
 * Строка «Ещё здесь» — остальные эскадры той же базы: тап по имени выделяет её, а пока
 * взведено слияние, имя становится «сюда».
 */
import type { Action, GameState, Planet } from '../../packages/shared-core/src/index';
import { hasMissiles, MISSILE_SALVO } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { parkedState } from '../../decisions/hangarBadge';
import { fleetCallsign } from './fleetName';
import { esc } from './format';
import { data, loadShuttle, unloadShuttle } from './game';
import { pcUi } from './graphicsPrefs';
import {
  dockedCarrier,
  fleetHangar,
  hasHangar,
  planetHangar,
  type HangarView,
} from './hangarPanel';
import { squadMerge } from './interaction';
import { squadronRelocateSpots } from './mapAim';
import { ownerColor } from './mapPalette';
import { actionButton as btn, cardHeader } from './panelKit';
import { worldName } from './planetName';
import { wingOrder, wingOrdersHtml, type WingOrder } from './wingOrders';
import { unitRows } from './worldCard';
import {
  mergeTargets,
  SQUADRON_KIND_KEY,
  squadronCallsignOf,
  squadronCards,
  type SquadronCard,
} from './squadronPanel';

/** Что карточке нужно от игры. */
export interface SquadronCardDeps {
  world: GameState;
  me: string;
}

/** Где стоит эскадра: порт мира или трюм своего носителя. */
type Spot =
  | { kind: 'port'; planet: Planet; view: HangarView }
  | { kind: 'hold'; fleetId: string; view: HangarView };

function spotOf(s: GameState, me: string, id: string): Spot | null {
  for (const p of Object.values(s.planets)) {
    if (p.owner !== me || !(p.hangar ?? []).some((q) => q.id === id)) continue;
    const view = planetHangar(p, data);
    return view ? { kind: 'port', planet: p, view } : null;
  }
  for (const f of Object.values(s.fleets)) {
    if (f.owner !== me || !(f.hangar ?? []).some((q) => q.id === id)) continue;
    const view = fleetHangar(f, data, s);
    return view ? { kind: 'hold', fleetId: f.id, view } : null;
  }
  return null;
}

/** Строка под именем: где стоит и можно ли лететь (`hangarBadge.ts`, правило 5). */
function statusLine(spot: Spot, deps: SquadronCardDeps, missiles: boolean): string {
  const where =
    spot.kind === 'port'
      ? t('side.squad.port', { name: worldName(deps.world, spot.planet.id) })
      : t('side.squad.hold', { name: fleetCallsign(spot.fleetId) });
  const st = parkedState(spot.view.blocked, spot.view.sortie);
  // Ракетам топливо порта не нужно: им важно одно — не в бою ли база.
  if (missiles)
    return `${where} · ${t(st.kind === 'busy' ? 'side.squad.busy' : 'side.missile.ready')}`;
  const state =
    st.kind === 'busy'
      ? t('side.squad.busy')
      : st.kind === 'rearming'
        ? t('side.wing.rearming', { h: st.hours })
        : st.kind === 'no-fuel'
          ? t('side.squad.no-fuel')
          : st.fuel !== null && st.maxFuel !== null
            ? t('side.squad.ready.fuel', { n: st.fuel, max: st.maxFuel })
            : t('side.squad.ready');
  return `${where} · ${state}`;
}

/** Строка состояния своей эскадры на стоянке — та же, что под именем в её карточке;
 *  `null` — такой эскадры на стоянке нет. Её же читает список «◇ Авиация». */
export function parkedStatusText(id: string, deps: SquadronCardDeps): string | null {
  const spot = spotOf(deps.world, deps.me, id);
  if (!spot) return null;
  const hangar =
    spot.kind === 'port' ? spot.planet.hangar : deps.world.fleets[spot.fleetId]?.hangar;
  const sq = hangar?.find((q) => q.id === id);
  return statusLine(spot, deps, !!sq && hasMissiles(sq, data));
}

/** Перегрузка ЭТОЙ эскадры между портом и стоящим у мира своим носителем. Ядро возит
 *  соединение целиком, поэтому приказ есть, только когда на той стороне хватит места. */
function transferOrder(spot: Spot, card: SquadronCard, deps: SquadronCardDeps): WingOrder | null {
  const s = deps.world;
  if (spot.kind === 'port') {
    const ship = dockedCarrier(Object.values(s.fleets), spot.planet.id, deps.me, data);
    const hold = ship ? fleetHangar(ship, data, s) : null;
    if (!ship || !hasHangar(hold) || hold.free < card.places) return null;
    return wingOrder('load', 'sqload', card.id);
  }
  const f = s.fleets[spot.fleetId];
  const at = f?.location ? s.planets[f.location] : undefined;
  if (!f || !at || f.movement || f.battleId || at.owner !== deps.me) return null;
  if (!hasHangar(planetHangar(at, data))) return null;
  return wingOrder('unload', 'squnload', card.id);
}

/** Карточка своей эскадры на стоянке; `null` — такой эскадры у места больше нет. */
export function parkedSquadronHtml(id: string, deps: SquadronCardDeps): string | null {
  const spot = spotOf(deps.world, deps.me, id);
  if (!spot) return null;
  const from = spot.kind === 'port' ? { planetId: spot.planet.id } : { fleetId: spot.fleetId };
  const cards = squadronCards(spot.view, {
    mine: true,
    data,
    relocate: (sq) => squadronRelocateSpots(sq, from).length > 0,
  });
  const card = cards.find((c) => c.id === id);
  if (!card) return null;
  const cargo = card.cargo.reduce((n, c) => n + c.count, 0);
  const notes = [
    esc(statusLine(spot, deps, card.missiles)),
    ...(cargo > 0 ? [esc(t('side.wing.cargo', { n: cargo }))] : []),
    ...(card.hull !== null ? [esc(t('side.wing.hull', { p: card.hull }))] : []),
    ...(card.hold ? [esc(t('side.wing.holding'))] : []),
  ];
  const title = `${t(SQUADRON_KIND_KEY)} «${card.name}»`;
  let h =
    cardHeader(ownerColor(deps.me), title, '', { compact: pcUi(), subLive: notes.join(' · ') }) +
    unitRows(card.stacks);
  // Плитка есть, только если приказ пройдёт сейчас: готовность базы у удара, патруля и
  // перелёта общая (`canStrike`), и серая плитка здесь обещала бы то, чего нет.
  const ready = card.canStrike;
  const merging = squadMerge?.from === card.id;
  // Ракеты пускаются, пока база не в бою: топливо и перезарядка порта им не нужны.
  const launch = card.missiles && spot.view.blocked !== 'busy';
  const salvo = Math.min(MISSILE_SALVO, card.machines);
  const orders = [
    launch && wingOrder('launch', 'msllaunch', id),
    launch && salvo > 1 && wingOrder('salvo', 'mslsalvo', id, undefined, { n: salvo }),
    ready && wingOrder('strike', 'wingstrike', id),
    ready && card.canPatrol && wingOrder('patrol', 'wingpatrol', id),
    ready && card.canRelocate && wingOrder('relocate', 'wingrelocate', id),
    transferOrder(spot, card, deps),
    card.canSplit && wingOrder('split', 'wingsplit', id),
    // Слияние взведено — плитка горит, повторное нажатие его снимает.
    card.canMerge && wingOrder('merge', 'wingmerge', id, merging),
    // Держит патруль и ждёт дома перезарядки: плитка горит, нажатие отпускает.
    card.hold && wingOrder('keep', 'wingrelease', id, true),
  ];
  h += wingOrdersHtml(orders, id);
  h += siblingsHtml(spot.view, card.id, merging);
  return h;
}

/** «Ещё здесь»: остальные эскадры базы. Пока взведено слияние — куда слить. */
function siblingsHtml(view: HangarView, id: string, merging: boolean): string {
  const others = view.squadrons.filter((sq) => sq.id !== id && sq.units.some((st) => st.count > 0));
  if (others.length === 0) return '';
  const into = merging ? new Set(mergeTargets(view, id, data)) : new Set<string>();
  const chips = others
    .map((sq) => {
      const name = squadronCallsignOf(sq.id);
      return into.has(sq.id)
        ? btn('wingmergeto', sq.id, `⛬ ${name}`, true)
        : btn('sqpick', sq.id, `◇ ${name}`, true);
    })
    .join('');
  const label = merging ? t('side.wing.merge.pick') : t('side.squad.siblings');
  return `<div class="row dim">${esc(label)}</div><div class="row aloft-acts">${chips}</div>`;
}

/** Приказ перегрузить эскадру `id`: из порта на свой носитель у причала (`up`) или из трюма
 *  в порт мира, где стоит носитель. `null` — перегружать некуда. */
export function squadronTransfer(s: GameState, me: string, id: string, up: boolean): Action | null {
  const spot = spotOf(s, me, id);
  if (!spot) return null;
  const carrier =
    spot.kind === 'port'
      ? dockedCarrier(Object.values(s.fleets), spot.planet.id, me, data)?.id
      : spot.fleetId;
  const at = spot.kind === 'port' ? spot.planet.id : carrier && s.fleets[carrier]?.location;
  if (!carrier) return null;
  const fortress = at && s.planets[at]?.fortress ? at : undefined;
  return (up ? loadShuttle : unloadShuttle)(me, carrier, id, fortress);
}
