import type { HandlerContext, ModuleSetupApi } from '../../kernel/module';
import type { Fleet, Planet, UnitStack } from '../../state/gameState';
import { timeScaleOf } from '../../action/types';
import { MS_PER_HOUR } from '../../util/time';
import { buildingLevel } from '../../data/schemas';
import { battleLocations } from '../../state/battle';
import { forkSiteInBattle } from '../../state/forkSite';
import { fortressSiteOf, serviceSitesForFleet, indexServiceSites } from '../../state/fortress';
import { bestFleetStat, effectiveStats } from '../../util/loadout';
import { mergeStacks } from '../../util/stacks';
import { recordValues } from '../../util/records';
import { isAllied } from '../../util/combat';
import { isInfected, feedsOnBiomass } from '../../util/infestation';

/** Timed maintenance owned by construction: hospital, paid building repairs,
 *  docked hulls and shields. Registered at the same point in the module setup. */
export function registerConstructionMaintenance(api: ModuleSetupApi, clearInfected: (h: HandlerContext, planet: Planet, amount: number) => void): void {
  api.on('time.advanced', (event, h) => {
    const { from, to } = event.payload as { from: number; to: number };
    const span = to - from;
    if (span <= 0) return;
    const scale = timeScaleOf(h.ctx);
    const hours = (span / MS_PER_HOUR) * scale;
    const data = h.ctx.data;

    // Узлы, где идёт бой ЛЮБОЙ фазы, не лечат гарнизон (решение владельца 17).
    // Прежде условием был только НАЗЕМНЫЙ бой, и это давало странность: флот врага
    // режется с крепостью на орбите, а её госпиталь спокойно штопает гарнизон.
    const fighting = battleLocations(h.state);
    const serviceIndex = indexServiceSites(h.state);

    const wounded = (stack: UnitStack): boolean => stack.count > 0 && stack.hp !== undefined;

    /** Подлечить один стек — доля от полного HP за час, как и было. Возвращает true,
     *  если стек стал целым: его тогда можно слить с целыми того же вида. */
    const mend = (stack: UnitStack, rate: number): boolean => {
      const unitDef = data.units[stack.unit];
      if (!unitDef || stack.hp === undefined) return false;
      const fullHp = stack.count * (effectiveStats(unitDef, stack, data).hp ?? 0);
      const newHp = Math.min(fullHp, stack.hp + rate * hours * fullHp);
      if (newHp < fullHp) {
        stack.hp = newHp;
        return false;
      }
      delete stack.hp;
      return true;
    };

    // Кого лечит госпиталь, стоящий на узле: гарнизон САМОГО узла и десант в трюме
    // припаркованных рядом флотов — своих и СОЮЗНЫХ (FORT-5.9, из описания построек
    // крепости: «когда флот игрока или союзника рядом, лечатся наземные войска в трюме»).
    // Прежде трюм не лечил никто и нигде: раненый десант оставался раненым навсегда, если
    // его не высадить. Только флоты, где есть кого лечить: на большой карте целых трюмов —
    // подавляющее большинство.
    const holdsAt = new Map<string, Fleet[]>();
    for (const fleet of recordValues(h.state.fleets)) {
      if (fleet.movement || fleet.battleId) continue;
      if (!(fleet.landing ?? []).some(wounded)) continue;
      for (const host of serviceSitesForFleet(h.state, fleet, (a, b) => isAllied(h, a, b), serviceIndex)) {
        const bucket = holdsAt.get(host.id) ?? [];
        bucket.push(fleet);
        holdsAt.set(host.id, bucket);
      }
    }

    for (const planet of recordValues(h.state.planets)) {
      if (planet.owner === null) continue;
      const paused = fighting.has(planet.id) || forkSiteInBattle(h.state, planet);
      for (const building of planet.buildings) {
        const repair = building.repair;
        if (!repair) continue;
        if (repair.owner !== planet.owner) { delete building.repair; continue; }
        if (paused) { repair.doneAt += span; continue; }
        const def = data.buildings[building.type];
        const full = def ? buildingLevel(def, building.level).hp : 0;
        const restored = Math.min(repair.remainingHp, repair.hpPerHour * hours, Math.max(0, full - building.hp));
        building.hp += restored;
        repair.remainingHp = Math.max(0, repair.remainingHp - restored);
        if (building.hp >= full) repair.remainingHp = 0;
      }
      if (paused) continue;
      const holds = holdsAt.get(planet.id) ?? [];
      if (!planet.garrison.some(wounded) && holds.length === 0) continue;
      let totalHealRate = 0;
      for (const b of planet.buildings) {
        if (b.hp <= 0) continue; // destroyed building contributes nothing
        const def = data.buildings[b.type];
        if (def) totalHealRate += buildingLevel(def, b.level).healRate;
      }
      if (totalHealRate <= 0) continue;
      let healed = false;
      for (const stack of planet.garrison) if (mend(stack, totalHealRate)) healed = true;
      // Залеченный стек снова целый — и сливается с целыми того же вида, лоадаута и
      // выслуги (`mergeStacks`, правило `findHealthyStack`). Иначе гарнизон после каждого
      // отбитого штурма распадался бы на плитки «×3» и «×2» одного юнита, а погрузка
      // видела бы только первую из них.
      if (healed) planet.garrison = mergeStacks([], planet.garrison);
      for (const fleet of holds) {
        let mended = false;
        for (const stack of fleet.landing ?? []) if (mend(stack, totalHealRate)) mended = true;
        if (mended) fleet.landing = mergeStacks([], fleet.landing ?? []);
      }
    }

    // Зачистка органов Роя (решение владельца 2026-09-24: «при захвате не-роем наземные
    // юниты сражаются с постройками»): на мире не-Роя наземный гарнизон непрерывно
    // снимает с заражённых построек прочность своим уроном по зданиям
    // (`stats.buildingDamage` в час). Пока идёт бой на узле — войска заняты боем, и
    // зачистки нет. У Роя его органы, понятно, никто не трогает.
    for (const planet of recordValues(h.state.planets)) {
      if (planet.owner === null || fighting.has(planet.id)) continue;
      if (!planet.buildings.some((b) => isInfected(data.buildings[b.type]))) continue;
      if (feedsOnBiomass(h.state, planet.owner, data)) continue;
      let rate = 0;
      for (const stack of planet.garrison)
        rate += stack.count * (data.units[stack.unit]?.stats.buildingDamage ?? 0);
      if (rate > 0) clearInfected(h, planet, rate * hours);
    }

    // Ship regen/repair — the two pools mend differently (shields-roadmap §1):
    //   • SHIELD (`shieldHp`) recharges for free anywhere out of combat, once past a
    //     short delay after the last hit (`lastDamagedAt`) — the async "hit-and-run"
    //     loop; paused entirely while in a battle.
    //   • HULL (`hp`) never regens for free: it repairs ONLY while the fleet is
    //     stationed over a FRIENDLY world (base rate + a repair building's healRate),
    //     and hull damage drags the fleet's speed (route.ts) until mended.
    const SHIELD_REGEN = 0.06; // shield-pool fraction restored per game-hour
    const SHIELD_REGEN_DELAY = MS_PER_HOUR; // shields stay down this long after a hit
    for (const fleet of recordValues(h.state.fleets)) {
      if (fleet.battleId) continue; // a fleet in combat regenerates nothing
      // Решение владельца 17: пока на узле идёт бой, док не чинит — даже флот, который
      // сам в драку не втянут. Прежде такой флот спокойно чинился посреди сражения.
      if (fleet.location !== null && fighting.has(fleet.location)) continue;

      // Корпус чинится у ДРУЖЕСТВЕННОГО мира с верфью или космопортом
      // (`shipRepair`, shields-roadmap SH-2.1); без дока — только свой `repair_bay` (SHU-5.4). «Дружественный»
      // с FORT-5.8 значит свой ИЛИ союзный: правило одно на все пути ремонта у дока, и
      // живёт оно в `fleetAtOwnDock`. Частичный эффект здесь был бы необъяснимым —
      // ровно так разъезжались два хука наземной защиты форта.
      let hullRate = 0;
      const ports = serviceSitesForFleet(h.state, fleet, (a, b) => isAllied(h, a, b), serviceIndex);
      if (ports.some((port) => fighting.has(port.id))) continue;
      for (const planet of ports) {
        for (const b of planet.buildings) {
          if (b.hp <= 0) continue;
          const def = data.buildings[b.type];
          if (def) hullRate += buildingLevel(def, b.level).shipRepair;
        }
      }

      // Shields regen only over the part of this span past the post-damage delay.
      const shieldFrom = Math.max(from, (fleet.lastDamagedAt ?? -Infinity) + SHIELD_REGEN_DELAY);
      const shieldHours = shieldFrom < to ? ((to - shieldFrom) / MS_PER_HOUR) * scale : 0;

      // SM-3.3 «Ремонтный тендер»: лучший `fleetHullRepair` во флоте чинит корпуса ВСЕХ
      // его стеков — там же и так же, как собственный `repair_bay` чинит свой стек.
      // Складывается с доком и с `hullRepair`: это разные источники. Нет тендера — 0.
      const tender = bestFleetStat(fleet.units, 'fleetHullRepair', data);

      for (const stack of fleet.units) {
        const unitDef = data.units[stack.unit];
        if (!unitDef) continue;

        // Hull (`hp`): friendly-port repair, plus the stack's own `repair_bay`
        // (`hullRepair`, SHU-5.4) anywhere out of combat — never a free regen.
        if (stack.hp !== undefined && !fortressSiteOf(h.state, fleet.id)) {
          const eff = effectiveStats(unitDef, stack, data);
          const fullHp = stack.count * (eff.hp ?? 0);
          const rate = hullRate + (eff.hullRepair ?? 0) + tender;
          if (fullHp <= 0 || stack.hp >= fullHp) stack.hp = undefined;
          else if (rate > 0) {
            const cur = Math.min(fullHp, stack.hp + rate * hours * fullHp);
            stack.hp = cur >= fullHp ? undefined : cur;
          }
        }

        // Shield (`shieldHp`): free out-of-combat regen once past the damage delay.
        //
        // Темп = общая база ПЛЮС добавка юнита (`shieldRegen`, FORT-5.10: со ступенью
        // щита крепости растёт не только размер пула, но и скорость его набора).
        // Именно ДОБАВКА, а не замена: корпус без этого стата обязан копить щит ровно
        // с прежней скоростью, иначе правка молча переписала бы весь флот игры.
        if (stack.shieldHp !== undefined) {
          const eff = effectiveStats(unitDef, stack, data);
          const fullShield = stack.count * (eff.shield ?? 0);
          const shieldRate = SHIELD_REGEN + (eff.shieldRegen ?? 0);
          if (fullShield <= 0 || stack.shieldHp >= fullShield) stack.shieldHp = undefined;
          else if (shieldHours > 0) {
            const cur = Math.min(
              fullShield,
              stack.shieldHp + shieldRate * shieldHours * fullShield,
            );
            stack.shieldHp = cur >= fullShield ? undefined : cur;
          }
        }
      }
    }
  });
}
