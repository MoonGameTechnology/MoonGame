import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import type { GameState } from '../../packages/shared-core/src/index';
import { newGame } from './game';
import { EMPTY_STATS, metaLevel, type MetaState } from './meta';
import {
  awardKeyFor,
  awardOnce,
  endReasonText,
  endStampOf,
  initMatchEnd,
  outcomeOf,
  parseAwardMarker,
  type MatchEndHost,
} from './matchEnd';

// REFM-27: locale pinned RU (see format.test.ts — Node has no browser language, so the
// runtime would fall back to EN and the label assertions would drift).
beforeAll(() => setLocale('ru'));

const meta = (over: Partial<MetaState> = {}): MetaState => ({
  xp: 0,
  spent: [],
  stats: { ...EMPTY_STATS },
  ...over,
});

/** Матч, закончившийся указанным образом, с очками и местом из ядра. */
function ended(over: Record<string, unknown> = {}): GameState {
  const s = newGame();
  s.match = {
    ...(s.match ?? {}),
    status: 'ended',
    endedAt: 5_000_000,
    reason: 'score',
    winner: 'p1',
    scores: { p1: { total: 300 }, p2: { total: 120 } },
    rewards: { p1: { place: 1 } },
    ...over,
  } as unknown as GameState['match'];
  return s;
}

function wired(over: Partial<MatchEndHost> = {}, seed: GameState = ended()) {
  let s = seed;
  let stored: MetaState = meta();
  const marks = new Map<string, string>();
  let shown = false;
  const saves: MetaState[] = [];
  const api = initMatchEnd({
    state: () => s,
    me: () => 'p1',
    nick: () => 'Комдив',
    endShown: () => shown,
    readMarker: (k) => marks.get(k) ?? null,
    writeMarker: (k, v) => void marks.set(k, v),
    loadMeta: () => stored,
    saveMeta: (m) => {
      stored = m;
      saves.push(m);
    },
    ...over,
  });
  return {
    api,
    marks,
    saves,
    meta: () => stored,
    setState: (next: GameState) => {
      s = next;
    },
    setShown: (v: boolean) => {
      shown = v;
    },
  };
}

describe('конец матча — причина', () => {
  it('у каждой причины своя строка', () => {
    const said = ['domination', 'elimination', 'score', 'timeout'].map(endReasonText);
    expect(new Set(said).size).toBe(4);
    expect(said.every((x) => x.length > 0)).toBe(true);
  });

  it('незнакомая причина не оставляет игрока с пустотой', () => {
    expect(endReasonText(undefined)).toBeTruthy();
    expect(endReasonText('что-то новое')).toBeTruthy();
  });
});

describe('конец матча — исход', () => {
  it('победитель по очкам — победа', () => {
    expect(outcomeOf({ winner: 'p1' }, 'p1')).toEqual({ won: true, draw: false });
  });

  it('коалиция побеждает ВМЕСТЕ, а не только верхний по очкам (SES-1)', () => {
    expect(outcomeOf({ winner: 'p2', winners: ['p2', 'p1'] }, 'p1').won).toBe(true);
  });

  it('чужая победа — поражение, а не ничья', () => {
    expect(outcomeOf({ winner: 'p2' }, 'p1')).toEqual({ won: false, draw: false });
  });

  it('конец без победителя — ничья', () => {
    expect(outcomeOf({ winner: null }, 'p1')).toEqual({ won: false, draw: true });
  });
});

describe('конец матча — метка выдачи', () => {
  it('ключ у каждого ника свой', () => {
    expect(awardKeyFor('Комдив')).not.toBe(awardKeyFor('Другой'));
  });

  it('без ника награда всё равно кому-то принадлежит', () => {
    expect(awardKeyFor('   ')).toBe(awardKeyFor(''));
    expect(awardKeyFor('')).toContain('guest');
  });

  it('испорченная метка читается как «выдачи не было» — награда не теряется', () => {
    expect(parseAwardMarker('{не json')).toBeNull();
    expect(parseAwardMarker(null)).toBeNull();
    expect(parseAwardMarker('{"at":5}')).toBeNull(); // не та форма
  });

  it('целая метка читается', () => {
    expect(parseAwardMarker('{"at":"777","xp":42}')).toEqual({ at: '777', xp: 42 });
  });

  it('метка привязана к моменту конца — у каждого матча своя', () => {
    expect(endStampOf({ endedAt: 1 })).not.toBe(endStampOf({ endedAt: 2 }));
    expect(endStampOf(undefined)).toBeTruthy(); // дев-хук без времени конца
  });
});

describe('конец матча — награда выдаётся один раз', () => {
  it('первый конец матча начисляет опыт и пишет метку', () => {
    const a = awardOnce(null, '777', meta(), { won: true, score: 300, place: 1 });
    expect(a.xp).toBeGreaterThan(0);
    expect(a.marker).toEqual({ at: '777', xp: a.xp });
    expect(a.meta?.xp).toBe(a.xp);
  });

  it('тот же матч второй раз — та же квитанция и НИ РАЗУ не начисляет', () => {
    const first = awardOnce(null, '777', meta(), { won: true, score: 300 });
    const again = awardOnce(first.marker, '777', first.meta!, { won: true, score: 300 });
    expect(again.xp).toBe(first.xp); // показываем ту же сумму, а не обманчивый «+0»
    expect(again.meta).toBeNull(); // мете писать нечего
    expect(again.marker).toBeNull();
  });

  it('счётчики карьеры не фармятся перезаходом', () => {
    const first = awardOnce(null, '777', meta(), { won: true, score: 300, place: 1 });
    const again = awardOnce(first.marker, '777', first.meta!, { won: true, score: 300, place: 1 });
    expect(first.meta!.stats.matches).toBe(1);
    expect(again.meta).toBeNull(); // второй матч в статистику не попал
  });

  it('НОВЫЙ матч платит снова', () => {
    const first = awardOnce(null, '777', meta(), { won: true, score: 300 });
    const second = awardOnce(first.marker, '888', first.meta!, { won: true, score: 300 });
    expect(second.xp).toBeGreaterThan(0);
    expect(second.meta!.stats.matches).toBe(2);
  });

  it('повышение уровня отмечается только когда порог реально взят', () => {
    const low = awardOnce(null, '777', meta(), { won: false, score: 0 });
    expect(low.levelUp).toBeNull(); // с нулевого опыта уровень тот же

    const rich = meta({ xp: 0 });
    const big = awardOnce(null, '777', rich, { won: true, score: 1_000_000 });
    if (metaLevel(big.meta!.xp) > metaLevel(rich.xp)) expect(big.levelUp).toBeGreaterThan(1);
  });

  it('победа стоит больше поражения при том же счёте', () => {
    const win = awardOnce(null, '1', meta(), { won: true, score: 300 });
    const loss = awardOnce(null, '1', meta(), { won: false, score: 300 });
    expect(win.xp).toBeGreaterThan(loss.xp);
  });
});

describe('конец матча — витрина', () => {
  it('матч идёт — итога нет', () => {
    const w = wired({}, newGame());
    expect(w.api.check()).toBeNull();
  });

  it('матч закончился — итог собран из авторитетного состояния', () => {
    const w = wired();
    const end = w.api.check();
    expect(end?.won).toBe(true);
    expect(end?.why).toBeTruthy();
    expect(end?.xp).toBeGreaterThan(0);
    expect(end?.dismissed).toBe(false);
  });

  it('второй кадр итог не пересобирает', () => {
    const w = wired();
    expect(w.api.check()).not.toBeNull();
    expect(w.api.check()).toBeNull();
    expect(w.saves.length).toBe(1);
  });

  it('экран итогов уже на месте — считать нечего', () => {
    const w = wired();
    w.setShown(true);
    expect(w.api.check()).toBeNull();
    expect(w.saves).toEqual([]);
  });

  it('перезаход в тот же законченный матч не фармит опыт', () => {
    const w = wired();
    const first = w.api.check()!;
    const xpAfterFirst = w.meta().xp;
    w.api.reset(); // как переподключение к уже законченному матчу
    const again = w.api.check()!;
    expect(again.xp).toBe(first.xp); // та же квитанция
    expect(w.meta().xp).toBe(xpAfterFirst); // а мете больше ничего не досталось
    expect(w.saves.length).toBe(1);
  });

  it('новый матч того же ника платит снова', () => {
    const w = wired();
    w.api.check();
    w.setState(ended({ endedAt: 9_999_999 }));
    w.api.reset();
    expect(w.api.check()!.xp).toBeGreaterThan(0);
    expect(w.saves.length).toBe(2);
  });

  it('испорченная метка не блокирует награду', () => {
    const w = wired();
    w.marks.set(awardKeyFor('Комдив'), '{сломано');
    expect(w.api.check()!.xp).toBeGreaterThan(0);
  });

  it('ничья приходит как ничья, а не как поражение', () => {
    const w = wired({}, ended({ winner: null, reason: 'timeout' }));
    const end = w.api.check()!;
    expect(end.won).toBe(false);
    expect(end.draw).toBe(true);
  });

  it('место берётся из таблицы наград ядра', () => {
    const w = wired({}, ended({ rewards: { p1: { place: 3 } } }));
    w.api.check();
    expect(w.meta().stats.placeSum).toBe(3);
    expect(w.meta().stats.placed).toBe(1);
  });

  it('матч без места (дев-хук) считается, но среднее не портит', () => {
    const w = wired({}, ended({ rewards: {} }));
    w.api.check();
    expect(w.meta().stats.matches).toBe(1);
    expect(w.meta().stats.placed).toBe(0);
  });
});
