/**
 * Сторож проводки «одна вкладка — один писатель» (`AUD-29`) — статический: `main.ts` и
 * владелец профиля `sectorProfile.ts` (REFM-209) живут на DOM. Правило хозяйки — `decisions/tabLock.test.ts`, запрет записи в хранилище —
 * `runSaveLocal.test.ts`, две вкладки на собранном архиве — робот `yandextest.mjs`.
 *
 * Стык ломается молча тремя способами:
 * 1. **Писатель в обход замка.** Одно хранилище без проверки — и вытесненная вкладка снова
 *    затирает профиль, журнал забега, отметку облака или само облако.
 * 2. **Вход без перехвата.** Вкладка открыла Sector Zero, но хозяйкой не стала — её записи
 *    молча отбрасываются, и прогресс этой сессии не доживает до перезагрузки.
 * 3. **Перехват без перечитывания.** Вкладка хаба грузила профиль давно; стань она хозяйкой
 *    со старой памятью — первая же её запись сотрёт то, что другая вкладка сделала с тех пор.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
// Хранилища, отметка облака и перехват вкладки — у владельца профиля (REFM-209); вход в
// Sector Zero и слух о перехвате остались в `main.ts`.
const PROFILE = readFileSync(new URL('./sectorProfile.ts', import.meta.url), 'utf8');
const body = (src: string, name: string): string =>
  new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(src)?.[1] ?? '';
/** Ответы игры владельцу профиля: чем он снимает забег и останавливает мир. */
const wiring = /initSectorProfile\(\{[\s\S]*?\n\}\);/.exec(MAIN)?.[0] ?? '';

describe('AUD-29 — пишет только вкладка-хозяйка', () => {
  it('все четыре хранилища Sector Zero спрашивают замок', () => {
    expect(PROFILE).toContain('localRunSaveStore(RUN_SAVE_KEY, ownsSectorZero)');
    expect(PROFILE).toContain('localRunSaveStore(PORTABLE_RUN_KEY, ownsSectorZero)');
    expect(PROFILE).toContain('localRunSaveStore(SECTOR_ZERO_PROGRESS_KEY, ownsSectorZero)');
    // Теневая копия профиля (`YAG-4.4`) — тоже: вытесненная вкладка затёрла бы ею целую.
    expect(PROFILE).toContain('localRunSaveStore(SECTOR_ZERO_SHADOW_KEY, ownsSectorZero)');
    // Ни одного хранилища Sector Zero мимо замка — ни у владельца, ни в `main.ts`.
    expect((MAIN + PROFILE).match(/localRunSaveStore\(/g)).toHaveLength(4);
  });

  it('отметка облака и само облако — тоже', () => {
    expect(body(PROFILE, 'writeSyncMark')).toContain('if (ownsSectorZero())');
    expect(body(PROFILE, 'pushCloud')).toContain("if (cloudState !== 'on' || !ownsSectorZero()) return;");
  });

  it('вход в Sector Zero делает вкладку хозяйкой — первым делом', () => {
    expect(body(MAIN, 'openSectorZero').trimStart().startsWith('claimSectorZero();')).toBe(true);
  });

  it('перехват у другой вкладки перечитывает профиль и отметку, а забег берёт из журнала', () => {
    const claim = body(PROFILE, 'claimSectorZero');
    expect(claim).toContain('if (!tabSuperseded(TAB_ID, previous)) return;');
    // Забег в памяти снимается и забывается — ответами игры, которые делают ровно это.
    expect(claim).toContain('game.stopRun();');
    expect(claim).toContain('game.forgetRun();');
    expect(wiring).toMatch(/stopRun: \(\) => \{\s+if \(runInProgress\(\)\) setRunActive\(false\);\s+\}/);
    expect(wiring).toMatch(/forgetRun: \(\) => \{\s+savedRun = null;\s+savedPortable = null;\s+\}/);
    expect(claim).toContain('syncMark = parseSyncMark(mark);');
    // Перечитывает тем же правилом печати, что и старт (`YAG-4.4`).
    expect(claim).toContain('progressWrite = progressWrite.then(loadSectorProfile)');
    expect(claim).toContain(
      'sectorProgress = parseSectorZeroProgress(pick.raw, data, sectorSeed);',
    );
  });

  it('вытесненная вкладка слышит перехват и встаёт', () => {
    expect(MAIN).toContain('if (event.key === TAB_OWNER_KEY) checkTabOwner();');
    expect(body(PROFILE, 'checkTabOwner')).toContain('game.pause();');
    expect(wiring).toContain("pause: () => runPauseEvent('hidden'),");
  });
});
