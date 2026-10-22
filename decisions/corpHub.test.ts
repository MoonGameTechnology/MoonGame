import { describe, expect, it } from 'vitest';
import { corpHubBadges, corpHubState } from './corpHub';

describe('вкладка «Корпорация»: что показать', () => {
  const base = { signedIn: true, answered: true, failed: false, role: null } as const;

  it('без входа — приглашение, даже если в памяти остался старый ответ', () => {
    expect(corpHubState({ ...base, signedIn: false, role: 'head' })).toBe('guest');
  });

  it('до первого ответа — загрузка, а не «создайте корпорацию»', () => {
    expect(corpHubState({ ...base, answered: false })).toBe('loading');
  });

  it('отказ без прежнего ответа — «нет связи», а не «без корпорации»', () => {
    expect(corpHubState({ ...base, answered: false, failed: true })).toBe('offline');
  });

  it('отказ после ответа оставляет прежнюю картину', () => {
    expect(corpHubState({ ...base, failed: true, role: 'member' })).toBe('corp');
    expect(corpHubState({ ...base, failed: true })).toBe('none');
  });

  it('заявка — ожидание, остальные роли — корпорация', () => {
    expect(corpHubState({ ...base, role: 'recruit' })).toBe('pending');
    for (const role of ['head', 'officer', 'member'] as const)
      expect(corpHubState({ ...base, role })).toBe('corp');
  });
});

describe('вкладка «Корпорация»: ярлыки разделов', () => {
  const members = [{ role: 'head' }, { role: 'recruit' }, { role: 'recruit' }, { role: 'member' }] as const;
  const challenges = [
    { status: 'pending', targetCorp: 'c' },
    { status: 'pending', targetCorp: 'other' },
    { status: 'accepted', targetCorp: 'c' },
  ];

  it('заявки считают глава и офицеры, участнику ярлык пуст', () => {
    expect(corpHubBadges({ corpId: 'c', role: 'head' }, members, []).members).toBe(2);
    expect(corpHubBadges({ corpId: 'c', role: 'officer' }, members, []).members).toBe(2);
    expect(corpHubBadges({ corpId: 'c', role: 'member' }, members, []).members).toBe(0);
  });

  it('на «Битвах» — только вызовы НАМ, ждущие ответа, и только у главы', () => {
    expect(corpHubBadges({ corpId: 'c', role: 'head' }, [], challenges).battles).toBe(1);
    expect(corpHubBadges({ corpId: 'c', role: 'officer' }, [], challenges).battles).toBe(0);
  });

  it('без корпорации ярлыки пусты', () => {
    expect(corpHubBadges(null, members, challenges)).toEqual({ members: 0, battles: 0 });
  });
});
