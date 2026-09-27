import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { allyBoxHtml } from './allyScreen';
import { chapterChainHtml } from './missionPanel';
import type { AllyPanelView } from '../../decisions/allyPanel';
import type { ChapterStep } from '../../decisions/chapterChain';

// Окно «Связь с союзником» и цепочка главы IV (PVR-7.5): что видит игрок.

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
});
