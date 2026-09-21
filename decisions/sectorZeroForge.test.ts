import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  forgeOutcome,
  forgeRoll,
  type ForgeAttempt,
  type ForgeLadder,
} from './sectorZeroForge';


const LADDER: ForgeLadder = JSON.parse(
  readFileSync('data/sectorZeroStars.json', 'utf8'),
) as ForgeLadder;

const at = (over: Partial<ForgeAttempt> = {}): ForgeAttempt => ({
  seed: 'profile-7',
  attempt: 3,
  target: 'cargo_bay',
  star: 0,
  shards: 0,
  ...over,
});

describe('sectorZeroForge — бросок не перекатывается', () => {
  it('та же попытка даёт тот же бросок: перезагрузка не помогает', () => {
    // Ради этого свойства механика и написана: в одиночной игре с сохраняемым профилем
    // случайный бросок означал бы F5 до нужного исхода.
    expect(forgeRoll(at())).toBe(forgeRoll(at()));
    expect(forgeOutcome(at(), LADDER, 9999)).toEqual(forgeOutcome(at(), LADDER, 9999));
  });

  it('смена ЛЮБОГО из четырёх полей меняет бросок', () => {
    const base = forgeRoll(at());
    for (const over of [{ seed: 'profile-8' }, { attempt: 4 }, { target: 'ion_engine' }, { star: 1 }])
      expect([over, forgeRoll(at(over)) === base]).toEqual([over, false]);
  });

  it('бросок лежит в [0, 1) — иначе сравнение с шансом врёт на краях', () => {
    for (let i = 0; i < 200; i++) {
      const r = forgeRoll(at({ attempt: i, target: `m${i}` }));
      expect([i, r >= 0 && r < 1]).toEqual([i, true]);
    }
  });

  it('ни Math.random, ни Date.now в исходнике', () => {
    // Сторож по сырому тексту: подстановка «временного» рандома вернула бы перекат.
    const src = readFileSync('decisions/sectorZeroForge.ts', 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/Math\.random|Date\.now|new Date/);
  });
});

describe('sectorZeroForge — правила лестницы', () => {
  it('гарантированные ступени не бросают вовсе', () => {
    for (let star = 0; star < LADDER.guaranteed; star++) {
      const out = forgeOutcome(at({ star }), LADDER, 9999);
      expect([star, out.success, out.star]).toEqual([star, true, star + 1]);
    }
  });

  it('данные согласованы: гарант и шанс 1 указывают на одни и те же ступени', () => {
    // Два числа об одном факте — классика расхождения; тест держит их вместе.
    LADDER.steps.forEach((step, i) => {
      expect([i, step.chance === 1]).toEqual([i, i < LADDER.guaranteed]);
    });
    expect(LADDER.steps).toHaveLength(LADDER.cap);
  });

  it('провал сжигает вложенное, но НЕ отнимает достигнутое', () => {
    // Инвариант владельца 2026-09-20 — ветки «звезда потеряна» не существует.
    const failed = [];
    for (let i = 0; i < 100; i++) {
      const out = forgeOutcome(at({ star: LADDER.cap - 1, attempt: i }), LADDER, 9999);
      if (!out.success) failed.push(out);
    }
    expect(failed.length).toBeGreaterThan(0); // верхняя ступень обязана иногда не удаваться
    for (const out of failed) {
      expect(out.star).toBe(LADDER.cap - 1); // звёздность на месте
      expect(out.warrants).toBeGreaterThan(0); // а вложенное сгорело
    }
  });

  it('на потолке попытка не предлагается', () => {
    const out = forgeOutcome(at({ star: LADDER.cap }), LADDER, 9999);
    expect([out.allowed, out.reason]).toEqual([false, 'E_FORGE_AT_CAP']);
  });

  it('без денег попытка не разрешается, но цена и шанс ВИДНЫ', () => {
    // `EC-2.3`: игрок должен понимать, сколько это стоит, ещё до того как сможет купить.
    const out = forgeOutcome(at(), LADDER, 0);
    expect([out.allowed, out.reason]).toEqual([false, 'E_FORGE_NOT_ENOUGH']);
    expect(out.warrants).toBe(LADDER.steps[0]!.warrants);
    expect(out.chance).toBe(LADDER.steps[0]!.chance);
  });

  it('цена растёт по ступеням — иначе верхние звёзды ничего не стоят', () => {
    for (let i = 1; i < LADDER.steps.length; i++)
      expect([i, LADDER.steps[i]!.warrants > LADDER.steps[i - 1]!.warrants]).toEqual([i, true]);
  });
});

describe('sectorZeroForge — pity: серия неудач упирается в потолок, а не в бесконечность', () => {
  // `EC-2.2`: накопление сгоревшего ГАРАНТИРУЕТ результат. Без этого игрок с плохим
  // броском может лить Варранты бесконечно — а это и есть то, за что штрафуют сторы.
  const PITY: ForgeLadder = {
    cap: 2,
    guaranteed: 0,
    // `pity: 3` = «третья попытка на этой ступени гарантирована», то есть после двух
    // сгоревших. Ноль = гарантии нет вовсе.
    steps: [
      { chance: 0.2, warrants: 10, bonus: 0.5, pity: 3 },
      { chance: 0.2, warrants: 20, bonus: 0.5, pity: 0 },
    ],
  };
  const at = (over: Partial<ForgeAttempt> = {}): ForgeAttempt => ({
    seed: 'p',
    attempt: 0,
    target: 'cargo_bay',
    star: 0,
    shards: 0,
    ...over,
  });

  it('накопив осколки до порога, попытка перестаёт бросать', () => {
    // Проверяем по ВСЕМ номерам попытки: одиночный вызов при шансе 0.2 угадал бы
    // успех и без всякой гарантии — такой тест ничего бы не доказывал.
    for (let attempt = 0; attempt < 50; attempt++) {
      const out = forgeOutcome(at({ attempt, shards: 2 }), PITY, 9999);
      expect([attempt, out.success, out.star]).toEqual([attempt, true, 1]);
    }
  });

  it('объявленный шанс на гарантии — сто процентов, а не прежние 20', () => {
    // Показать 20%, когда бросок уже не делается, значит соврать игроку ровно там,
    // где `EC-2.3` требует честности.
    expect(forgeOutcome(at({ shards: 2 }), PITY, 9999).chance).toBe(1);
    expect(forgeOutcome(at({ shards: 1 }), PITY, 9999).chance).toBe(0.2);
  });

  it('ступень без pity гарантии не даёт даже при горе осколков', () => {
    const out = forgeOutcome(at({ star: 1, shards: 99 }), PITY, 9999);
    expect(out.chance).toBe(0.2);
  });

  it('до порога бросок остаётся броском', () => {
    // С шансом 0.2 из десяти попыток обязана найтись неудачная.
    const outcomes = Array.from({ length: 10 }, (_, i) =>
      forgeOutcome(at({ attempt: i, shards: 0 }), PITY, 9999),
    );
    expect(outcomes.some((o) => !o.success)).toBe(true);
  });
});
