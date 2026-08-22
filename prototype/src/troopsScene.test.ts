import { describe, expect, it } from 'vitest';
import { garrisonSide, planFor, troopsGate, type TroopsScene } from './troopsScene';

const сцена = (p: Partial<TroopsScene> = {}): TroopsScene => ({
  docked: true,
  worldMine: true,
  carriesGround: false,
  landingAllowed: () => false,
  ...p,
});

describe('правило 1 — меню только у пришвартованного вне боя', () => {
  it('свой мир под ногами — обе стороны', () => {
    expect(troopsGate(сцена())).toBe('both');
  });
  it('не пришвартован — закрыто, что бы ни было в трюме', () => {
    expect(troopsGate(сцена({ docked: false }))).toBe('closed');
    expect(
      troopsGate(сцена({ docked: false, carriesGround: true, landingAllowed: () => true })),
    ).toBe('closed');
  });
  it('не пришвартован над СВОИМ миром — тоже закрыто', () => {
    expect(troopsGate(сцена({ docked: false, worldMine: true }))).toBe('closed');
  });
});

describe('правила 2–3 — над чужим миром только высадка и только с разрешения ядра', () => {
  it('есть груз и ядро согласно — только высадка', () => {
    expect(
      troopsGate(сцена({ worldMine: false, carriesGround: true, landingAllowed: () => true })),
    ).toBe('landing-only');
  });
  it('ядро отказало — меню не открывается вовсе', () => {
    expect(
      troopsGate(сцена({ worldMine: false, carriesGround: true, landingAllowed: () => false })),
    ).toBe('closed');
  });
  it('высаживать нечего — закрыто, даже если ядро в принципе не против', () => {
    expect(
      troopsGate(сцена({ worldMine: false, carriesGround: false, landingAllowed: () => true })),
    ).toBe('closed');
  });
  it('на СВОЁМ мире разрешение ядра на высадку не спрашивается', () => {
    expect(
      troopsGate(сцена({ worldMine: true, carriesGround: false, landingAllowed: () => false })),
    ).toBe('both');
  });
  it('правило 7 — на своём мире ядро НЕ опрашивают вовсе', () => {
    let спрошено = 0;
    troopsGate(
      сцена({
        worldMine: true,
        landingAllowed: () => {
          спрошено++;
          return true;
        },
      }),
    );
    expect(спрошено).toBe(0);
  });
  it('правило 7 — с пустым трюмом на чужом мире ядро НЕ опрашивают', () => {
    let спрошено = 0;
    troopsGate(
      сцена({
        worldMine: false,
        carriesGround: false,
        landingAllowed: () => {
          спрошено++;
          return true;
        },
      }),
    );
    expect(спрошено).toBe(0);
  });
  it('правило 7 — у непришвартованного ядро НЕ опрашивают', () => {
    let спрошено = 0;
    troopsGate(
      сцена({
        docked: false,
        worldMine: false,
        carriesGround: true,
        landingAllowed: () => {
          спрошено++;
          return true;
        },
      }),
    );
    expect(спрошено).toBe(0);
  });
});

describe('правило 4 — на чужом мире гарнизонных чисел нет', () => {
  it('свой мир: числа проходят как есть', () => {
    expect(garrisonSide(true, 3, 5)).toEqual({ garrison: 3, garrisonAll: 5 });
  });
  it('чужой мир: обнуляются оба', () => {
    expect(garrisonSide(false, 3, 5)).toEqual({ garrison: 0, garrisonAll: 0 });
  });
  it('«здоровых» и «всего» — разные числа, и обнуляются вместе', () => {
    const свой = garrisonSide(true, 2, 7);
    expect(свой.garrison).not.toBe(свой.garrisonAll);
    const чужой = garrisonSide(false, 2, 7);
    expect(чужой.garrison).toBe(0);
    expect(чужой.garrisonAll).toBe(0);
  });
});

describe('правило 6 — план берут только у своего флота', () => {
  it('план этого флота проходит', () => {
    expect(planFor('f1', 'f1', { militia: 2 })).toEqual({ militia: 2 });
  });
  it('план соседнего флота не подставляется', () => {
    expect(planFor('f2', 'f1', { militia: 2 })).toEqual({});
  });
  it('плана нет вовсе', () => {
    expect(planFor(null, 'f1', undefined)).toEqual({});
    expect(planFor(undefined, 'f1', { militia: 2 })).toEqual({});
  });
  it('план КОПИРУЕТСЯ: правка меню не пишет в живой набор', () => {
    const живой = { militia: 2 };
    const взят = planFor('f1', 'f1', живой);
    взят.militia = 99;
    expect(живой.militia).toBe(2);
  });
});
