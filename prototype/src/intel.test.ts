import { describe, it, expect } from 'vitest';
import type { IntelGrant } from '../../packages/shared-core/src/index';
import {
  SPY_COST,
  SPY_LOG_MAX,
  grantLeftMs,
  grantVision,
  liveGrants,
  pushSpyEntry,
  targetsOf,
} from './intel';

const grant = (over: Partial<IntelGrant> = {}): IntelGrant =>
  ({ kind: 'planet', target: 'C1R1', until: 1000, ...over }) as IntelGrant;

const vision = () => ({ identify: new Set<string>(), radar: new Set<string>() });

describe('разведка — живые окна', () => {
  it('окно живо, пока его срок ВПЕРЕДИ', () => {
    expect(liveGrants([grant({ until: 1000 })], 999)).toHaveLength(1);
  });

  it('истёкшее окно не показывает ничего — даже до того, как ядро его вычистит', () => {
    expect(liveGrants([grant({ until: 1000 })], 1000)).toEqual([]);
    expect(liveGrants([grant({ until: 1000 })], 2000)).toEqual([]);
  });

  it('живые и мёртвые окна разделяются, порядок живых сохраняется', () => {
    const live = liveGrants(
      [
        grant({ target: 'A', until: 500 }),
        grant({ target: 'B', until: 5000 }),
        grant({ target: 'C', until: 9000 }),
      ],
      1000,
    );
    expect(live.map((g) => g.target)).toEqual(['B', 'C']);
  });

  it('окон нет вовсе — пустой список, а не падение', () => {
    expect(liveGrants(undefined, 0)).toEqual([]);
    expect(liveGrants([], 0)).toEqual([]);
  });
});

describe('разведка — цели по видам', () => {
  const grants = [
    grant({ kind: 'planet', target: 'C1R1' }),
    grant({ kind: 'planet', target: 'C2R2' }),
    grant({ kind: 'fleets', target: 'p2' }),
    grant({ kind: 'treasury', target: 'p3' }),
  ];

  it('каждый вид отдаёт СВОИ цели и не подмешивает чужие', () => {
    expect(targetsOf(grants, 'planet')).toEqual(new Set(['C1R1', 'C2R2']));
    expect(targetsOf(grants, 'fleets')).toEqual(new Set(['p2']));
    expect(targetsOf(grants, 'treasury')).toEqual(new Set(['p3']));
  });

  it('вида нет среди окон — пустое множество', () => {
    expect(targetsOf([grant({ kind: 'planet' })], 'fleets')).toEqual(new Set());
  });

  it('два окна на одну цель схлопываются в одну', () => {
    const twice = [grant({ target: 'C1R1', until: 10 }), grant({ target: 'C1R1', until: 99 })];
    expect(targetsOf(twice, 'planet').size).toBe(1);
  });
});

describe('разведка — что она добавляет в туман', () => {
  it('купленный мир опознан И попадает под радар (опознание влечёт обнаружение)', () => {
    const v = vision();
    grantVision(v, new Set(['C1R1']), () => true);
    expect(v.identify.has('C1R1')).toBe(true);
    expect(v.radar.has('C1R1')).toBe(true);
  });

  it('окно пережило свой мир — его молча пропускают', () => {
    const v = vision();
    grantVision(v, new Set(['снесён']), () => false);
    expect(v.identify.size).toBe(0);
    expect(v.radar.size).toBe(0);
  });

  it('уже видимый мир не портится повторной выдачей', () => {
    const v = vision();
    v.identify.add('C1R1');
    v.radar.add('C1R1');
    grantVision(v, new Set(['C1R1']), () => true);
    expect(v.identify.size).toBe(1);
    expect(v.radar.size).toBe(1);
  });

  it('окон нет — туман остаётся ровно таким, каким его посчитало ядро', () => {
    const v = vision();
    v.identify.add('свой');
    grantVision(v, new Set(), () => true);
    expect(v.identify).toEqual(new Set(['свой']));
    expect(v.radar.size).toBe(0);
  });
});

describe('разведка — журнал шпионажа', () => {
  it('строки копятся в порядке событий', () => {
    const log = pushSpyEntry(pushSpyEntry([], { at: 1, text: 'первое' }), {
      at: 2,
      text: 'второе',
    });
    expect(log.map((e) => e.text)).toEqual(['первое', 'второе']);
  });

  it('журнал ограничен — старое вытесняется, новое остаётся', () => {
    const log: { at: number; text: string }[] = [];
    for (let i = 0; i < SPY_LOG_MAX + 5; i++) pushSpyEntry(log, { at: i, text: `#${i}` });
    expect(log.length).toBe(SPY_LOG_MAX);
    expect(log[0]!.text).toBe('#5'); // первые пять вытеснены
    expect(log[log.length - 1]!.text).toBe(`#${SPY_LOG_MAX + 4}`);
  });

  it('потолок можно задать явно (окно вкладки короче)', () => {
    const log: { at: number; text: string }[] = [];
    for (let i = 0; i < 10; i++) pushSpyEntry(log, { at: i, text: `#${i}` }, 3);
    expect(log.map((e) => e.text)).toEqual(['#7', '#8', '#9']);
  });
});

describe('разведка — подписи', () => {
  it('остаток окна не уходит в минус, когда срок прошёл', () => {
    expect(grantLeftMs(grant({ until: 100 }), 500)).toBe(0);
  });

  it('остаток считается от текущего часа мира', () => {
    expect(grantLeftMs(grant({ until: 1000 }), 400)).toBe(600);
  });

  it('цена попытки — та, что показана игроку на кнопке', () => {
    expect(SPY_COST).toBeGreaterThan(0);
  });
});
