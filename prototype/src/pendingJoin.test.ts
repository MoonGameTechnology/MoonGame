import { describe, it, expect } from 'vitest';
import { createPendingJoin } from './pendingJoin';

describe('отложенный вход — что запоминается', () => {
  it('ВЫБОР ЕДЕТ ЦЕЛИКОМ: матч, кресло и дом, а не один матч', () => {
    const p = createPendingJoin();
    p.remember('demo', 'p5', 'azure');
    expect(p.take()).toEqual({ matchId: 'demo', slot: 'p5', faction: 'azure' });
  });

  it('без выбора — только матч, без пустых полей', () => {
    const p = createPendingJoin();
    p.remember('demo');
    expect(p.take()).toEqual({ matchId: 'demo' });
  });

  it('ПУСТАЯ СТРОКА — ЭТО «НЕ ВЫБРАНО», а не заданное пустое кресло', () => {
    const p = createPendingJoin();
    p.remember('demo', '', '');
    expect(p.take()).toEqual({ matchId: 'demo' });
  });

  it('null от адресной строки тоже «не выбрано»', () => {
    const p = createPendingJoin();
    p.remember('demo', null, null);
    expect(p.take()).toEqual({ matchId: 'demo' });
  });

  it('пустой матч — не намерение', () => {
    const p = createPendingJoin();
    p.remember('', 'p5');
    expect(p.has()).toBe(false);
    expect(p.take()).toBeNull();
  });
});

describe('отложенный вход — прочитать и забыть', () => {
  it('ЗАБИРАЮТ ОДИН РАЗ: второй заход в хаб не утащит в позавчерашний матч', () => {
    const p = createPendingJoin();
    p.remember('demo', 'p5', 'azure');
    expect(p.take()).not.toBeNull();
    expect(p.take()).toBeNull();
    expect(p.has()).toBe(false);
  });

  it('ЧТЕНИЕ И ЗАБВЕНИЕ НЕ РАЗЪЕЗЖАЮТСЯ — выбор нельзя стереть до того, как он прочитан', () => {
    const p = createPendingJoin();
    p.remember('demo', 'p5', 'azure');
    const taken = p.take(); // один вызов: и отдал, и очистил
    expect(taken?.slot).toBe('p5');
    expect(taken?.faction).toBe('azure');
    expect(p.has()).toBe(false);
  });

  it('пустое хранилище отдаёт null, а не пустое намерение', () => {
    expect(createPendingJoin().take()).toBeNull();
  });

  it('has() спрашивает, но не забирает', () => {
    const p = createPendingJoin();
    p.remember('demo');
    expect(p.has()).toBe(true);
    expect(p.has()).toBe(true);
    expect(p.take()).not.toBeNull();
  });

  it('новое намерение вытесняет прежнее целиком, без остатков выбора', () => {
    const p = createPendingJoin();
    p.remember('old', 'p5', 'azure');
    p.remember('new');
    expect(p.take()).toEqual({ matchId: 'new' });
  });

  it('два хранилища независимы', () => {
    const a = createPendingJoin();
    const b = createPendingJoin();
    a.remember('demo', 'p5');
    expect(b.has()).toBe(false);
    expect(a.take()?.matchId).toBe('demo');
  });
});
