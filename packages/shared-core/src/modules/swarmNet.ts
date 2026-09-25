/**
 * Сеть Роя — знание течёт только по связи (`docs/swarm-behavior.md`, решения владельца
 * 2026-09-24).
 *
 * Модуль держит ПАМЯТЬ сети: что знает каждый держатель — центр данных, флот, мир
 * (`state.swarmNet.holders`). Кто с кем связан прямо сейчас, решает чистая функция
 * `util/swarmNet.ts`; модуль только копирует знание внутри части, когда мир меняется.
 *
 * 1. **Опыт рождается у свидетеля.** `swarm.observed` приносит номер столкновения и
 *    того, по кому пришёлся удар. Свидетель жив — знание его; погиб прежде, чем
 *    сообщил, — опыт пропал (сценарий «изолированный отряд погиб до передачи»).
 * 2. **Внутри части знание общее, мгновенно** (решение владельца «мгновенно»). На
 *    каждом событии, которое может изменить связность или знание, каждый держатель
 *    части получает объединение знания части. Один бой — один номер: сколько бы копий
 *    ни пришло, вклад его не множится.
 * 3. **Разрыв ничего не стирает.** Отрезанный держатель уносит то, что успел получить.
 *    Стирает только гибель самого держателя: пал флот, снесён центр, потерян мир —
 *    пропало то, что было только у него (решение владельца «копия у связанных»:
 *    связанные центры знание уже сохранили).
 * 4. **Рецепт — тоже знание.** Готовая адаптация (`swarm.adapt.done`) пишется органу и
 *    дальше течёт по связи, давая новые формы другим частям.
 * 5. **Разрыв — событие.** Мир, бывший на связи с ульем и отрезанный от него, помнится
 *    (`cut`) — задача «Разорвать сеть» засчитывается, даже если Рой связь потом починил.
 *
 * Синхронизация идёт на событиях, а не на тиках времени: частота вызова `advanceTo` у
 * хостов разная, и знание, текущее «по часам», разошлось бы между одиночным забегом и
 * сервером. Идущий ретранслятор связывает в той точке пути, где стоит в момент события.
 *
 * Модуль включается PvE-матчем (`pve.started`); без него знание Роя общее, как было
 * (`knowledgeOf` откатывается к журналу целиком).
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { PlayerId, SwarmKnowledge, SwarmNetState } from '../state/gameState';
import { buildingLevel, type ModePve } from '../data/schemas';
import { fleetHolder, partsOf, planetHolder, swarmNet, type HolderId } from '../util/swarmNet';

function pveOf(h: HandlerContext): ModePve | undefined {
  const modeId = h.ctx.config?.modeId;
  return modeId === undefined ? undefined : h.ctx.data.modes[modeId]?.pve;
}

/** Место Роя: из `state.pve`, а до посева — по фракции режима (наименьший id). */
function swarmSeat(h: HandlerContext): PlayerId | undefined {
  if (h.state.pve) return h.state.pve.npcPlayerId;
  const cfg = pveOf(h);
  if (!cfg) return undefined;
  let found: PlayerId | undefined;
  for (const [id, player] of Object.entries(h.state.players)) {
    if (player.faction !== cfg.npcFaction) continue;
    if (found === undefined || id < found) found = id;
  }
  return found;
}

/** Сеть заводится только в PvE-матче: в PvP модуль следов не оставляет. */
function ensureNet(h: HandlerContext): SwarmNetState | undefined {
  if (!pveOf(h)) return undefined;
  return (h.state.swarmNet ??= { holders: {} });
}

/** Добавить держателю номер столкновения и/или рецепт. */
function teach(
  net: SwarmNetState,
  holder: HolderId,
  ordinal?: number,
  recipe?: [string, number],
): void {
  const k: SwarmKnowledge = (net.holders[holder] ??= { known: [] });
  if (ordinal !== undefined && !k.known.includes(ordinal)) {
    k.known = [...k.known, ordinal].sort((a, b) => a - b);
  }
  if (recipe) {
    const [moduleId, level] = recipe;
    if ((k.recipes?.[moduleId] ?? 0) < level)
      k.recipes = { ...(k.recipes ?? {}), [moduleId]: level };
  }
}

/** Правило 2–3: убрать держателей, которых больше нет, и выровнять знание внутри частей. */
function sync(h: HandlerContext): void {
  const net = h.state.swarmNet;
  const owner = swarmSeat(h);
  if (!net || owner === undefined) return;
  const view = swarmNet(h.state, h.ctx.data, owner, h.ctx.now);
  for (const id of Object.keys(net.holders)) if (!view.partOf.has(id)) delete net.holders[id];
  recordCuts(h, net, view);
  const centers = new Set(view.nodes.filter((n) => n.kind === 'center').map((n) => n.id));
  for (const holders of partsOf(view).values()) {
    if (holders.length < 2) continue; // отрезанному не с кем делиться
    const known = new Set<number>();
    const recipes: Record<string, number> = {};
    let any = false;
    for (const id of holders) {
      const k = net.holders[id];
      if (!k) continue;
      any = true;
      for (const ordinal of k.known) known.add(ordinal);
      for (const [moduleId, level] of Object.entries(k.recipes ?? {}))
        recipes[moduleId] = Math.max(recipes[moduleId] ?? 0, level);
    }
    if (!any) continue;
    const sorted = [...known].sort((a, b) => a - b);
    const hasRecipes = Object.keys(recipes).length > 0;
    for (const id of holders) {
      // Хранят знание флоты и центры; мир без центра — только если уже был свидетелем.
      if (!id.startsWith('fleet:') && !centers.has(id) && !net.holders[id]) continue;
      net.holders[id] = { known: [...sorted], ...(hasRecipes ? { recipes: { ...recipes } } : {}) };
    }
  }
}

/**
 * Правило 5: разрыв сети — событие. Мир, бывший на связи с ульем, а теперь отрезанный от
 * его части, попадает в `cut` навсегда: игрок перерезал связь, и починка Роем этого не
 * отменяет (задача «Разорвать сеть»). Миры, которые с ульем не связывались никогда, —
 * не «отрезаны», они просто вне сети.
 */
function recordCuts(h: HandlerContext, net: SwarmNetState, view: ReturnType<typeof swarmNet>): void {
  const home = h.state.pve?.home;
  const npc = h.state.pve?.npcPlayerId;
  if (home === undefined || npc === undefined || h.state.planets[home]?.owner !== npc) return;
  const homePart = view.partOf.get(planetHolder(home));
  for (const id of Object.keys(h.state.planets).sort()) {
    if (h.state.planets[id]?.owner !== npc) continue;
    const together = view.partOf.get(planetHolder(id)) === homePart;
    if (together) {
      if (!(net.linked ?? []).includes(id)) net.linked = [...(net.linked ?? []), id];
    } else if ((net.linked ?? []).includes(id) && !(net.cut ?? []).includes(id)) {
      net.cut = [...(net.cut ?? []), id];
      h.emit('swarm.net.cut', { owner: npc, planetId: id });
    }
  }
}

/** События, после которых связность или знание могли измениться. */
const RESYNC = [
  'pve.wave.spawned',
  'fleet.arrived',
  'fleet.transit',
  'fleet.departed',
  'fleet.destroyed',
  'building.constructed',
  'planet.captured',
  'unit.built',
] as const;

export const swarmNetModule: GameModule = {
  id: 'swarmNet',
  version: '1.1.0',
  setup(api) {
    api.on('pve.started', (_event, h) => {
      if (ensureNet(h)) sync(h);
    });

    // Правило 1: опыт рождается у свидетеля и дальше течёт только по связи.
    api.on('swarm.observed', (event, h) => {
      const net = ensureNet(h);
      const owner = swarmSeat(h);
      if (!net || owner === undefined) return;
      const p = event.payload as { ordinal?: unknown; witness?: unknown };
      if (typeof p.ordinal !== 'number' || typeof p.witness !== 'string') return;
      const holder =
        h.state.fleets[p.witness]?.owner === owner
          ? fleetHolder(p.witness)
          : h.state.planets[p.witness]?.owner === owner
            ? planetHolder(p.witness)
            : undefined;
      if (holder === undefined) return; // свидетель погиб прежде, чем сообщил
      teach(net, holder, p.ordinal);
      sync(h);
    });

    // Правило 4: готовый рецепт — знание органа.
    api.on('swarm.adapt.done', (event, h) => {
      const net = h.state.swarmNet;
      const p = event.payload as { moduleId?: unknown; level?: unknown; fleetId?: unknown };
      if (!net || typeof p.fleetId !== 'string' || typeof p.moduleId !== 'string') return;
      if (typeof p.level !== 'number') return;
      teach(net, fleetHolder(p.fleetId), undefined, [p.moduleId, p.level]);
      sync(h);
    });

    // Слияние: знание влитого флота переходит к принявшему — матки те же, флаг другой.
    api.on('fleet.merged', (event, h) => {
      const net = h.state.swarmNet;
      const p = event.payload as { from?: unknown; into?: unknown };
      if (!net || typeof p.from !== 'string' || typeof p.into !== 'string') return;
      const from = net.holders[fleetHolder(p.from)];
      if (from) {
        for (const ordinal of from.known) teach(net, fleetHolder(p.into), ordinal);
        for (const [moduleId, level] of Object.entries(from.recipes ?? {}))
          teach(net, fleetHolder(p.into), undefined, [moduleId, level]);
        delete net.holders[fleetHolder(p.from)];
      }
      sync(h);
    });

    // Деление: отделившаяся часть уносит то же знание.
    api.on('fleet.split', (event, h) => {
      const net = h.state.swarmNet;
      const p = event.payload as { from?: unknown; to?: unknown };
      if (!net || typeof p.from !== 'string' || typeof p.to !== 'string') return;
      const from = net.holders[fleetHolder(p.from)];
      if (from) {
        net.holders[fleetHolder(p.to)] = {
          known: [...from.known],
          ...(from.recipes ? { recipes: { ...from.recipes } } : {}),
        };
      }
      sync(h);
    });

    // Снесён центр данных — пропало то, что хранил только он (правило 3). Мир остаётся
    // миром Роя, поэтому его держатель сам не исчез бы: снимается явно.
    api.on('building.destroyed', (event, h) => {
      const net = h.state.swarmNet;
      const p = event.payload as { planetId?: unknown; building?: unknown };
      if (net && typeof p.planetId === 'string' && typeof p.building === 'string') {
        const def = h.ctx.data.buildings[p.building];
        const center =
          def !== undefined &&
          [1, ...def.upgrades.map((_, i) => i + 2)].some(
            (level) => buildingLevel(def, level).relayRange > 0,
          );
        if (center) delete net.holders[planetHolder(p.planetId)];
      }
      sync(h);
    });

    for (const type of RESYNC) api.on(type, (_event, h) => sync(h));
  },
};
