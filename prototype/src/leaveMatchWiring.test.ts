/**
 * Сторож двери «выход из партии» (REFM-205) — статический: `main.ts` живёт на DOM. Поведение
 * на живом сервере держит `smoke:net`: выход на обрыве связи оставляет игрока в хабе без
 * дозвона, а приказ, отданный на обрыве, не догоняет его на повторном входе. Здесь стык, и
 * ломается он молча тремя способами:
 *
 * 1. **Выход мимо двери.** Выход был шестью копиями одних и тех же флагов, и копии
 *    разошлись: три не закрывали сокет, итоговый экран не гасил первые цели, ни одна не
 *    гасила дозвон. Новая копия снова начнёт расходиться.
 * 2. **Дверь без дозвона.** На обрыве `NET` уже ложен, а таймер дозвона жив: выход, который
 *    его не гасит, уводит игрока в хаб, а дозвон через секунду возвращает его в партию.
 * 3. **Сокет, забытый после закрытия.** Позднее `close` текущего сокета посадило бы игрока
 *    на карточку входа или в хаб (ADDR-5) из того места, куда он ушёл.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const body = (name: string): string =>
  new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(SRC)?.[1] ?? '';
/** Тело обработчика клика по элементу с этим id (обработчик может стоять с отступом). */
const handler = (id: string): string =>
  new RegExp(
    `(?:\\$\\('${id}'\\)|document\\.getElementById\\('${id}'\\))\\??\\.addEventListener\\('click', \\([^)]*\\) => \\{([\\s\\S]*?)\\n\\s*\\}\\);`,
  ).exec(SRC)?.[1] ?? '';

describe('REFM-205 — выход из партии одной дверью', () => {
  it('каждый выход из партии идёт через дверь', () => {
    for (const id of ['tomenu', 'hub-solo', 'msolo-go', 'ctest']) {
      expect(handler(id), id).toContain('leaveMatch();');
    }
    const onLeave = /onLeave: \(which, wasNet\) => \{([\s\S]*?)\n {2}\},/.exec(SRC)?.[1] ?? '';
    expect(onLeave, 'итоговый экран').toContain('leaveMatch();');
    expect(body('openSectorZero'), 'вход в Sector Zero').toContain('leaveMatch();');
  });

  it('флаги выхода из сети пишет только дверь', () => {
    expect(SRC.match(/userClosed = true/g)).toHaveLength(1);
    expect(body('leaveNetwork')).toContain('userClosed = true;');
    // Кроме двери их гасит только обрыв связи — и он же заводит дозвон.
    expect(SRC.match(/^\s+NET = false;/gm)).toHaveLength(2);
    expect(SRC.match(/^\s+netAdmitted = false;/gm)).toHaveLength(2);
  });

  it('дверь гасит дозвон, забывает сокет до закрытия и выбрасывает очередь', () => {
    const door = body('leaveNetwork');
    expect(door).toContain('clearTimeout(reconnectTimer)');
    expect(door).toContain('reconnecting = false;');
    expect(door).toContain('reconnectAttempts = 0;');
    // Снимает только СВОЙ баннер: «ждём хоста» и итог матча — не её.
    expect(door).toContain('if (isReconnectBanner(banner)) banner = null;');
    expect(door).toMatch(/netSock = null;\s*sock\?\.close\(\);/);
    expect(door).toContain('dropNetClient();');
    // Билет для дозвона идёт по сети: вышедший за это время игрок назад не дозванивается.
    expect(SRC).toMatch(
      /await fetchJoinToken\(srv\.base, currentMatchId, session\);[\s\S]{0,300}if \(!reconnecting\) return;/,
    );
  });

  it('выход сохраняет забег, останавливает мир, гасит гайд и первые цели', () => {
    const exit = body('leaveMatch');
    for (const step of [
      'saveRun();',
      'speed = 0;',
      'leaveNetwork();',
      'stopFirstGoals();',
      'activeTour?.stop();',
    ]) {
      expect(exit, step).toContain(step);
    }
  });
});
