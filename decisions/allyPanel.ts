/**
 * Панель «Связь с союзником» (глава IV, §6.5, кирпич PVR-7.5) — что показать игроку.
 *
 * Панель — отдельная командная возможность главы: она появляется только после встречи
 * (`contactedAllies`) и только в мире с местом встречи; в других главах, на полигоне и в
 * партии её нет. Статус операции берётся из ТОГО ЖЕ плана, по которому ходит бот союзника
 * (`planAllyOperation`): карточка не может написать «собираем силы», пока бот уже летит.
 */
import type { GameData, GameState, PlayerId } from '../packages/shared-core/src/index';
import { planAllyOperation, type AllyOpReason, type AllyOpStep } from './allyOperation';
import { linkedAlly } from './chapterChain';

// Правило «с кем игрок на связи» живёт рядом с местом встречи (`chapterChain.ts`): его читают
// и панель, и зачёт задач пула союзнику (`missionObjectives.ts`).
export { linkedAlly };

export type AllyOrderKind = 'guard' | 'attack' | 'scout';
export const ALLY_ORDER_KINDS: readonly AllyOrderKind[] = ['guard', 'attack', 'scout'];

export interface AllyPanelView {
  ally: PlayerId;
  /** Операция: приказ игрока или своя задача союзника. Нет — союзник держит район. */
  op?: {
    kind: AllyOrderKind;
    source: 'order' | 'own';
    planet?: string;
    fleet?: string;
  };
  step: AllyOpStep;
  reason?: AllyOpReason;
  /** Флоты операции — кнопка «Найти» ведёт к первому. */
  group: string[];
  /** Жив ли союзник: выбыл — приказывать некому. */
  alive: boolean;
}

/** Что показать в панели. `null` — связи нет (ещё не встречались или сценария нет). */
export function allyPanelView(
  state: GameState,
  me: PlayerId,
  data: GameData,
): AllyPanelView | null {
  const ally = linkedAlly(state, me);
  if (!ally) return null;
  const alive = state.players[ally]?.status === 'active';
  const plan = planAllyOperation(state, ally, data);
  const order = state.allyOps?.[ally];
  const op = order
    ? { kind: order.kind, source: 'order' as const, planet: order.planet, fleet: order.fleet }
    : plan.source === 'own' && plan.target
      ? { kind: 'attack' as const, source: 'own' as const, planet: plan.target }
      : undefined;
  return {
    ally,
    ...(op ? { op } : {}),
    step: alive ? plan.step : 'blocked',
    ...(alive ? (plan.reason ? { reason: plan.reason } : {}) : { reason: 'no-forces' as const }),
    group: plan.group,
    alive,
  };
}
