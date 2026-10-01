/**
 * Карточка прогноза у цели «Атаки» (UIX-6.1) — «если ударю этим флотом, что будет?».
 *
 * Считает не этот модуль: исход, раунды и доли потерь даёт прогноз ядра `previewSides`
 * (прицел и окно боя зовут его через `battleForecast.ts`) — тот же движок раундов, что у
 * живого боя, и тот же, которым через `previewBattle` уже судят «Хранитель» и бот. Здесь
 * только решение, ЧТО из прогноза показать игроку и какими словами, чтобы оба клиента
 * показали одно и то же.
 *
 * 1. **Итог — словом: победа, ничья, поражение.** Цвет лишь дублирует слово (`tone`): на
 *    экране без цвета или у игрока, который его не различает, прогноз читается так же.
 * 2. **Время — в игровых часах.** Раунд боя — игровой час (`combat.ts`, `roundIntervalMs`),
 *    поэтому часы до конца — это число раундов прогноза.
 * 3. **Потери — в процентах корпуса, своих и чужих.** Доля корпуса, а не штук: флот,
 *    стёртый до одного процента прочности, не выглядит «целым».
 *
 * Туман — забота вызывающего, как у прогноза штурма (ONB-6): в прогноз подают только
 * флот, чей состав игрок законно видит.
 */

/** Итог боя с точки зрения атакующего. */
export type EngageVerdict = 'win' | 'draw' | 'loss';

/** То, что карточке нужно из `BattlePreview`: игрок — атакующая сторона. */
export interface EngageForecastInput {
  outcome: 'attacker' | 'defender' | 'stalemate';
  roundsEst: number;
  attacker: { damageFraction: number };
  defender: { damageFraction: number };
}

export interface EngageForecastCard {
  verdict: EngageVerdict;
  /** Ключ слова-итога в `/localization`. */
  verdictKey: 'engage.forecast.win' | 'engage.forecast.draw' | 'engage.forecast.loss';
  /** Цвет, дублирующий слово. */
  tone: 'positive' | 'neutral' | 'negative';
  /** Игровых часов до конца боя (раунд = час). */
  hours: number;
  /** Доля своего корпуса, которую прогноз теряет, в целых процентах 0…100. */
  ownLossPct: number;
  /** То же у противника. */
  foeLossPct: number;
}

const pct = (fraction: number): number =>
  Number.isFinite(fraction) ? Math.min(100, Math.max(0, Math.round(fraction * 100))) : 0;

/** Карточка по прогнозу, где игрок — атакующий (правила 1–3). */
export function engageForecastCard(pv: EngageForecastInput): EngageForecastCard {
  const verdict: EngageVerdict =
    pv.outcome === 'attacker' ? 'win' : pv.outcome === 'defender' ? 'loss' : 'draw';
  return {
    verdict,
    verdictKey: `engage.forecast.${verdict}`,
    tone: verdict === 'win' ? 'positive' : verdict === 'loss' ? 'negative' : 'neutral',
    hours: Math.max(0, pv.roundsEst),
    ownLossPct: pct(pv.attacker.damageFraction),
    foeLossPct: pct(pv.defender.damageFraction),
  };
}
