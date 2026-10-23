import { describe, it, expect } from 'vitest';
import {
  KnowledgeRevision,
  bakeSignature,
  type BakeContent,
  type KnownEnvironment,
} from './staticLayerCache';

const content = (over: Partial<BakeContent> = {}): BakeContent => ({
  vw: 1000,
  vh: 800,
  dpr: 2,
  me: 'p1',
  knowledge: 1,
  starfield: true,
  ...over,
});

const nodes = [{ id: 'a' }, { id: 'b' }];

describe('запеканка карты — номер знания о мирах', () => {
  it('номер следует ЗНАНИЮ игрока, а не правде — скрытый захват не выдаёт себя перерисовкой', () => {
    const правда: Record<string, string> = { a: 'p2', b: 'p2' };
    const знание: Record<string, string | null> = { a: 'p2', b: null }; // b за туманом
    const revision = new KnowledgeRevision();
    const было = revision.check(nodes, (id) => знание[id] ?? null, () => undefined);
    правда.b = 'p1'; // захват за туманом: игрок о нём не знает
    expect(revision.check(nodes, (id) => знание[id] ?? null, () => undefined)).toBe(было);
    знание.b = 'p1'; // увидел захват
    expect(revision.check(nodes, (id) => знание[id] ?? null, () => undefined)).not.toBe(было);
  });

  it('то же знание — тот же номер, сколько ни сверяй', () => {
    const revision = new KnowledgeRevision();
    const env = { kind: 'planet', terrain: 'nebula' };
    const первый = revision.check(nodes, () => 'p1', () => env);
    for (let i = 0; i < 3; i++) expect(revision.check(nodes, () => 'p1', () => ({ ...env }))).toBe(первый);
  });

  it('любой факт о мире меняет номер: владелец, знание местности, её вид и тип', () => {
    const revision = new KnowledgeRevision();
    const знания: Array<[string | null, KnownEnvironment]> = [
      [null, undefined],
      ['p1', undefined],
      ['p1', {}],
      ['p1', { kind: 'planet' }],
      ['p1', { kind: 'planet', terrain: 'nebula' }],
      ['p1', { kind: 'rift', terrain: 'nebula' }],
      ['p1', { kind: 'rift', terrain: 'ion_storm' }],
      ['p1', { kind: 'rift' }],
    ];
    const номера = знания.map(([owner, env]) => revision.check(nodes, (id) => (id === 'b' ? owner : null),
      (id) => (id === 'b' ? env : undefined)));
    expect(new Set(номера).size).toBe(знания.length);
  });

  it('число миров меняет номер, даже когда о новых мирах ничего не известно', () => {
    const revision = new KnowledgeRevision();
    const два = revision.check(nodes, () => null, () => undefined);
    const три = revision.check([...nodes, { id: 'c' }], () => null, () => undefined);
    expect(три).not.toBe(два);
    expect(revision.check(nodes, () => null, () => undefined)).not.toBe(три);
  });

  it('номер не возвращается к прежнему: захват туда и обратно — новая выпечка, а не старая', () => {
    const revision = new KnowledgeRevision();
    const owner = (who: string) => (id: string) => (id === 'a' ? who : null);
    const номера = ['p1', 'p2', 'p1'].map((who) => revision.check(nodes, owner(who), () => undefined));
    expect(new Set(номера).size).toBe(3);
  });
});

describe('запеканка карты — подпись содержимого', () => {
  it('РАЗМЕР ЭКРАНА И ПЛОТНОСТЬ ПИКСЕЛЕЙ — ЧАСТЬ ПОДПИСИ: после поворота нужна новая запеканка', () => {
    expect(bakeSignature(content())).not.toBe(bakeSignature(content({ vw: 800, vh: 1000 })));
    expect(bakeSignature(content())).not.toBe(bakeSignature(content({ dpr: 1 })));
  });

  it('чужими глазами карта другая — своя сторона входит в подпись', () => {
    expect(bakeSignature(content())).not.toBe(bakeSignature(content({ me: 'p2' })));
  });

  it('новое знание о мирах — новая подпись', () => {
    expect(bakeSignature(content())).not.toBe(bakeSignature(content({ knowledge: 2 })));
  });

  it('звёздный фон меняет саму запеканку', () => {
    expect(bakeSignature(content())).not.toBe(bakeSignature(content({ starfield: false })));
  });

  it('одинаковое содержимое — одинаковая подпись', () => {
    expect(bakeSignature(content())).toBe(bakeSignature(content()));
  });
});
