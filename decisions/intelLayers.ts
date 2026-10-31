/**
 * Что показать по слоям копящейся разведки (SPY-13). Само правило — какой слой когда
 * открывается и что видно по нему — в ядре (`espionageModule`, `visibleState`); здесь
 * только какие строки положить в карточку мира.
 *
 * 1. **Слой без поля — не слой.** Окно без `layer` (последний взгляд убитого агента, окно
 *    из старого сейва) — это первый слой; глубже ничего не показывается.
 * 2. **Слой открыт — строка есть, даже пустая.** Казна без запасов, мир без стройки,
 *    владелец без переговоров: строка всё равно стоит, иначе игрок не отличит «пусто» от
 *    «ещё не докопались».
 * 3. **Только владелец мира СЕЙЧАС.** Агент копает мир, а не прежнего хозяина: казна,
 *    исследования и переговоры — того, кто держит мир сейчас.
 * 4. **Переговоры — только те, где владелец сторона.** Чужие предложения третьих лиц
 *    слой не открывает.
 */
import {
  getOffer,
  type DiplomaticStance,
  type GameState,
  type IntelGrant,
} from '../packages/shared-core/src/index';

/** Направленное предложение стойки (ключ `from>to` в `diplomacyOffers`). */
export interface IntelOffer {
  from: string;
  to: string;
  stance: DiplomaticStance;
}

export interface IntelLayers {
  /** 1–4. */
  layer: number;
  /** Слой 2: запасы владельца, целые единицы больше нуля. */
  treasury?: [resource: string, amount: number][];
  /** Слой 3: что строится на мире (id здания или юнита) — сначала идущее, потом очередь. */
  building?: string[];
  /** Слой 3: что исследует владелец. */
  research?: string[];
  /** Слой 4: предложения стоек, где владелец — сторона. */
  offers?: IntelOffer[];
}

/** Правила 1–4 для одного окна на мир. */
export function intelLayers(state: GameState, grant: IntelGrant): IntelLayers {
  const layer = grant.layer ?? 1;
  const out: IntelLayers = { layer };
  const owner = state.planets[grant.target]?.owner;
  const player = owner ? state.players[owner] : undefined;
  if (!owner || !player || layer < 2) return out;
  out.treasury = Object.entries(player.resources)
    .map(([r, v]) => [r, Math.floor(v)] as [string, number])
    .filter(([, v]) => v > 0);
  if (layer >= 3) {
    const running = state.scheduled
      .filter((e) => e.type === 'construction.complete')
      .map((e) => e.payload as { planetId?: unknown; building?: unknown; unit?: unknown })
      .filter((p) => p.planetId === grant.target)
      .map((p) => (typeof p.building === 'string' ? p.building : typeof p.unit === 'string' ? p.unit : ''));
    const queued = (state.planets[grant.target]?.buildQueue ?? []).map((q) => q.building ?? q.unit ?? '');
    out.building = [...running, ...queued].filter((id) => id !== '');
    out.research = (player.technologies?.active ?? []).map((a) => a.technology);
  }
  if (layer >= 4) {
    out.offers = [];
    for (const other of Object.keys(state.players).sort()) {
      if (other === owner) continue;
      const sent = getOffer(state, owner, other);
      if (sent) out.offers.push({ from: owner, to: other, stance: sent });
      const got = getOffer(state, other, owner);
      if (got) out.offers.push({ from: other, to: owner, stance: got });
    }
  }
  return out;
}
