/**
 * Окно «Настройки матча» перед созданием сетевой партии: что сказать игроку о выбранной
 * карте, пока партия ещё не создана.
 *
 * 1. **Создаёт только подтверждение.** Кнопка «Создать» на странице «Матчи» открывает
 *    окно; запрос уходит с кнопки окна. Здесь — содержание окна, а не сам запрос.
 * 2. **Строки — те же правила, по которым сервер поднимет партию.** Режим карты
 *    (`fixedSideMode`) и условия победы (`victoryFor`) вызывающий берёт из каталога карт,
 *    которым пользуется и хост; своих чисел тут нет.
 * 3. **Захват столиц заменяет порог очков.** У такой партии нет ни порога, ни доли
 *    карты: показывать их значит обещать победу, которой не будет.
 *
 * Результат — ключи локали с параметрами: текст подставляет вызывающий через `t()`.
 */

export interface NewMatchFacts {
  /** Стартовых мест на карте. */
  readonly seats: number;
  /** Режим партии, если карта его задаёт (`team_2v2`, `capital_2v2` …). */
  readonly modeId?: string;
  readonly victory: {
    readonly scoreLimit: number;
    readonly dominationPercent?: number;
    readonly capitalCapture?: boolean;
  };
}

export interface Phrase {
  readonly key: string;
  readonly params?: Readonly<Record<string, number>>;
}

export interface NewMatchSummary {
  readonly players: Phrase;
  /** Имя режима из данных (`tData`) или «каждый сам за себя». */
  readonly mode: { readonly dataName: string } | Phrase;
  readonly goals: readonly Phrase[];
}

export function newMatchSummary(facts: NewMatchFacts): NewMatchSummary {
  const goals: Phrase[] = [];
  if (facts.victory.capitalCapture) goals.push({ key: 'browser.description.capitals' });
  else {
    goals.push({ key: 'browser.description.score', params: { n: facts.victory.scoreLimit } });
    if (facts.victory.dominationPercent)
      goals.push({
        key: 'browser.description.domination',
        params: { p: Math.round(facts.victory.dominationPercent * 100) },
      });
  }
  return {
    players: { key: 'browser.create.players', params: { n: facts.seats } },
    mode: facts.modeId ? { dataName: facts.modeId } : { key: 'browser.create.ffa' },
    goals,
  };
}
