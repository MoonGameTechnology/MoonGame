import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { allyBoxHtml, initAllyScreen } from './allyScreen';
import { chapterChainHtml } from './missionPanel';
import type { AllyPanelView } from '../../decisions/allyPanel';
import type { ChapterStep } from '../../decisions/chapterChain';
import { allyOrder } from '../../decisions/actions';
import {
  buildStateFromMap,
  parseMatchMap,
  type Action,
  type GameState,
} from '../../packages/shared-core/src/index';
import { shippedGameData } from '../../data/bundle';
import pve6 from '../../data/maps/pve-6.json';

// Окно «Связь с союзником» и цепочка главы (IV — PVR-7.5, VI — PVR-8.5): что видит игрок.

beforeAll(() => setLocale('ru'));

const name = (planet?: string, fleet?: string): string => planet ?? `флот ${fleet}`;
const view = (v: Partial<AllyPanelView>): AllyPanelView => ({
  ally: 'ally',
  step: 'idle',
  group: [],
  alive: true,
  ...v,
});

describe('окно союзника', () => {
  it('три приказа с подсказкой; взведённый — подсвечен', () => {
    const html = allyBoxHtml(view({}), name, 'attack', '');
    for (const k of ['guard', 'attack', 'scout']) expect(html).toContain(`data-ally-order="${k}"`);
    expect(html).toContain('class="al-order on" data-ally-order="attack"');
    expect(html).toContain('Охранять');
    expect(html).toContain('Отряд держит свой район');
  });

  it('приказ игрока: вид, цель, шаг с причиной, «Найти» и «Отменить»', () => {
    const html = allyBoxHtml(
      view({
        op: { kind: 'attack', source: 'order', planet: 'Шпиль' },
        step: 'gather',
        reason: 'need-landing',
        group: ['a1'],
      }),
      name,
      null,
      '',
    );
    expect(html).toContain('<b>Атаковать</b> <span class="al-target">Шпиль</span>');
    expect(html).toContain('Подготовка: ожидаем десант');
    expect(html).toContain('data-ally="find"');
    expect(html).toContain('data-ally="cancel"');
  });

  it('своя задача отряда подписана и не отменяется игроком', () => {
    const html = allyBoxHtml(
      view({
        op: { kind: 'attack', source: 'own', planet: 'Станция Гелиос' },
        step: 'advance',
        group: ['a1'],
      }),
      name,
      null,
      '',
    );
    expect(html).toContain('Своя задача отряда');
    expect(html).not.toContain('data-ally="cancel"');
  });

  it('«нужна помощь» — с причиной; союзник выбыл — приказы гаснут', () => {
    const blocked = allyBoxHtml(
      view({
        op: { kind: 'guard', source: 'order', planet: 'X' },
        step: 'blocked',
        reason: 'too-strong',
      }),
      name,
      null,
      '',
    );
    expect(blocked).toContain('Нужна помощь: цель сильнее, чем отряд может собрать');
    const dead = allyBoxHtml(
      view({ alive: false, step: 'blocked', reason: 'no-forces' }),
      name,
      null,
      '',
    );
    expect(dead).toMatch(/data-ally-order="guard" disabled/);
  });
});

describe('цепочка главы в панели задач', () => {
  const step = (
    id: ChapterStep['id'],
    done: boolean,
    active: boolean,
    extra: Partial<ChapterStep> = {},
  ): ChapterStep => ({
    id,
    key: `chain.${id}`,
    done,
    active,
    target: 'x',
    ...extra,
  });

  it('шаги по порядку: выполненный — отметкой, текущий — кнопкой к цели', () => {
    const html = chapterChainHtml(
      [
        step('contact', true, false),
        step('archive', false, true),
        step('extract', false, false),
        step('deliver', false, false),
      ],
      [],
    );
    expect(html).toContain('Операция главы');
    expect(html).toMatch(/mp-chain done.*Связь: прибыть к точке встречи/);
    expect(html).toContain('class="mp-row mp-chain on" data-chain-go="x"');
    expect(html).not.toContain('data-extract');
  });

  it('на шаге извлечения — доля работы, предупреждение о носителе и кнопки флотов', () => {
    const html = chapterChainHtml(
      [
        step('contact', true, false),
        step('archive', true, false),
        step('extract', false, true, { progress: 0.4 }),
        step('deliver', false, false),
      ],
      [{ id: 'p1_1', label: '2× Крейсер' }],
    );
    expect(html).toContain('<b class="mp-prog">40%</b>');
    expect(html).toContain('Гибель носителя — поражение главы');
    expect(html).toContain('data-extract="p1_1">Извлечь флотом 2× Крейсер</button>');
  });

  it('глава VI: у результатов счёт, а порог эвакуации виден, пока она не выполнена', () => {
    const chain = (evacDone: boolean): string =>
      chapterChainHtml(
        [
          step('docks', true, false),
          step('evacuate', evacDone, !evacDone, {
            count: { done: evacDone ? 3 : 1, total: 3 },
            rule: { need: 3, of: 4 },
          }),
          step('production', false, evacDone, { count: { done: 0, total: 3 } }),
          step('forces', false, false, { count: { done: 2, total: 3 }, target: undefined }),
        ],
        [],
      );
    const html = chain(false);
    expect(html).toContain(
      'Эвакуация: довести транспорты с людьми до базы</span><b class="mp-prog">1/3</b>',
    );
    expect(html).toContain(
      'Главные силы: разгромить соединения Роя</span><b class="mp-prog">2/3</b>',
    );
    expect(html).toContain('Довести нужно 3 из 4 транспортов. Меньше — поражение главы');
    expect(chain(true)).not.toContain('Довести нужно');
  });
});

describe('глава VI: союзник предлагает охранять доки (PVR-8.5, §8.7)', () => {
  const data = shippedGameData();
  const DOCKS = 'quarantine_docks';

  it('карточка предложения — над операцией; выбывший союзник ничего не предлагает', () => {
    const html = allyBoxHtml(view({}), name, null, '', { at: DOCKS });
    expect(html).toContain(
      'Основное соединение противника идёт к докам. Мы можем задержать его, но для атаки комплекса придётся оставить вам меньше сил',
    );
    expect(html).toContain('data-ally="guard-offer">Охранять доки</button>');
    expect(html.indexOf('al-offer')).toBeLessThan(html.indexOf('al-idle'));
    expect(allyBoxHtml(view({}), name, null, '')).not.toContain('guard-offer');
    const dead = view({ alive: false, step: 'blocked', reason: 'no-forces' });
    expect(allyBoxHtml(dead, name, null, '', { at: DOCKS })).not.toContain('guard-offer');
  });

  /** Node без DOM: окну хватает `innerHTML`, `classList` и делегирования кликов. */
  function fakeRoot() {
    const classes = new Set<string>();
    let handler: ((ev: unknown) => void) | null = null;
    const el = {
      innerHTML: '',
      classList: {
        add: (c: string) => void classes.add(c),
        remove: (c: string) => void classes.delete(c),
        contains: (c: string) => classes.has(c),
      },
      addEventListener: (_type: string, h: (ev: unknown) => void) => {
        handler = h;
      },
      fire: (target: unknown) => handler?.({ target }),
    };
    return el;
  }

  it('«Охранять доки» — обычный приказ союзнику, и окно говорит, что он принят', () => {
    // Доки найдены, охрана Роя видимо идёт к ним.
    const base = buildStateFromMap(parseMatchMap(pve6), data);
    const guard = base.fleets.swarm_guard!;
    const s: GameState = {
      ...base,
      missionFacts: { ...base.missionFacts, found: { p1: [DOCKS] } },
      fleets: {
        ...base.fleets,
        swarm_guard: {
          ...guard,
          location: null,
          movement: {
            from: guard.location!,
            to: DOCKS,
            departedAt: 0,
            arrivesAt: 1,
            destination: DOCKS,
          },
        },
      },
    };
    const root = fakeRoot();
    const orders: Action[] = [];
    const screen = initAllyScreen({
      root: () => root as unknown as HTMLElement,
      state: () => s,
      me: () => 'p1',
      data: () => data,
      targetName: (planet) => planet ?? '—',
      arm: () => {},
      armed: () => null,
      findFleet: () => {},
      order: (a) => {
        orders.push(a);
        return true;
      },
      sees: () => true,
    });
    screen.open();
    expect(root.innerHTML).toContain('data-ally="guard-offer"');
    root.fire({
      closest: (sel: string) =>
        sel === '[data-ally]' ? { dataset: { ally: 'guard-offer' } } : null,
    });
    // Тот же приказ, что из прицела на карте (id действия у каждого свой).
    const guardDocks = allyOrder('p1', 'ally', 'guard', { planet: DOCKS });
    expect(orders.map((a) => [a.type, a.payload])).toEqual([[guardDocks.type, guardDocks.payload]]);
    expect(root.innerHTML).toContain('Союзник принял приказ');
  });
});
