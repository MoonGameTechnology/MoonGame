/**
 * Журнал адаптаций — что об ответах Роя знает ИГРОК (PVR-4.5).
 *
 * Зеркало `swarmMemory`. Там Рой копит, что против него применили; здесь игрок копит,
 * что Рой ему показал. Симметрия не украшение, а правило §3.3/§3.9: обе стороны узнают
 * друг друга только боем, и ни одна не читает состояние другой.
 *
 * Поэтому источник ровно один — `shuttle.repelled` по цели Роя: удар игрока отражён
 * зональным ПВО, и это ЕДИНСТВЕННЫЙ момент, когда перехват себя проявил. Ни память
 * Роя, ни идущий проект журналу не видны: оба сняты с клиентской проекции
 * (`visibility.ts`), и заглянуть в них клиенту физически нечем.
 *
 * Уровень модуля в журнал НЕ пишется, хотя ядро его знает. §3.9: игрок узнаёт об
 * адаптации по проявлению, а не по счётчику. Поэтому хранятся два замера — первый и
 * последний, — а вывод «перехват стал сильнее» строит уже решение
 * `/decisions/swarmJournal.ts` сравнением этих двух собственных наблюдений игрока.
 * Это честная ГИПОТЕЗА, а не подсмотренная правда, и ровно так она и подписана.
 */
import type { GameModule } from '../kernel/module';
import type { SwarmRepelRecord } from '../state/gameState';

/** Во сколько раз перехват должен вырасти (и во сколько раз быть слабее сильнейшего),
 *  чтобы разница читалась как другая память, а не как другой размер отряда. */
const STALE_RATIO = 4;

export const swarmJournalModule: GameModule = {
  id: 'swarmJournal',
  version: '1.1.0',
  setup(api) {
    api.on('shuttle.repelled', (event, h) => {
      const p = event.payload as {
        owner?: unknown;
        targetOwner?: unknown;
        damage?: unknown;
      };
      if (typeof p.owner !== 'string' || typeof p.targetOwner !== 'string') return;
      // Отразил именно Рой: чужое ПВО адаптацией Роя не является.
      if (h.state.players[p.targetOwner]?.faction !== 'swarm') return;
      // И отразили ИГРОКА, а не другого бота Роя (в забеге он один, но правило
      // формулируется от факта, а не от числа мест).
      if (h.state.players[p.owner]?.faction === 'swarm') return;
      const damage = typeof p.damage === 'number' && p.damage > 0 ? p.damage : 0;
      if (damage <= 0) return; // отражение без урона игроку ничего не показало

      const journal = (h.state.swarmJournal ??= {});
      const seen = journal[p.owner];
      if (!seen) {
        journal[p.owner] = {
          firstAt: h.ctx.now,
          lastAt: h.ctx.now,
          sorties: 1,
          firstDamage: damage,
          lastDamage: damage,
        } satisfies SwarmRepelRecord;
      } else {
        // Старая память (сеть Роя, 2026-09-24): игрок уже видел перехват, выросший в разы
        // против первого, а этот отряд отвечает в разы слабее сильнейшего — он, похоже,
        // отрезан от сети. Вывод из собственных замеров игрока, а не из состояния Роя.
        const top = seen.maxDamage ?? Math.max(seen.firstDamage, seen.lastDamage);
        if (top >= STALE_RATIO * seen.firstDamage && damage * STALE_RATIO <= top) {
          seen.stale = (seen.stale ?? 0) + 1;
        }
        seen.lastAt = h.ctx.now;
        seen.sorties += 1;
        seen.lastDamage = damage;
        seen.maxDamage = Math.max(top, damage);
      }
      h.emit('swarm.journal.entry', { owner: p.owner, damage });
    });
  },
};
