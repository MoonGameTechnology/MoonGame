/**
 * Сторож проводки «одна вкладка — один писатель» (`AUD-29`) — статический: `main.ts` живёт
 * на DOM. Правило хозяйки — `decisions/tabLock.test.ts`, запрет записи в хранилище —
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

const SRC = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const body = (name: string): string =>
  new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(SRC)?.[1] ?? '';

describe('AUD-29 — пишет только вкладка-хозяйка', () => {
  it('все четыре хранилища Sector Zero спрашивают замок', () => {
    expect(SRC).toContain('localRunSaveStore(RUN_SAVE_KEY, ownsSectorZero)');
    expect(SRC).toContain('localRunSaveStore(PORTABLE_RUN_KEY, ownsSectorZero)');
    expect(SRC).toContain('localRunSaveStore(SECTOR_ZERO_PROGRESS_KEY, ownsSectorZero)');
    // Теневая копия профиля (`YAG-4.4`) — тоже: вытесненная вкладка затёрла бы ею целую.
    expect(SRC).toContain('localRunSaveStore(SECTOR_ZERO_SHADOW_KEY, ownsSectorZero)');
    // Ни одного хранилища Sector Zero мимо замка.
    expect(SRC.match(/localRunSaveStore\(/g)).toHaveLength(4);
  });

  it('отметка облака и само облако — тоже', () => {
    expect(body('writeSyncMark')).toContain('if (ownsSectorZero())');
    expect(body('pushCloud')).toContain("if (cloudState !== 'on' || !ownsSectorZero()) return;");
  });

  it('вход в Sector Zero делает вкладку хозяйкой — первым делом', () => {
    expect(body('openSectorZero').trimStart().startsWith('claimSectorZero();')).toBe(true);
  });

  it('перехват у другой вкладки перечитывает профиль и отметку, а забег берёт из журнала', () => {
    const claim = body('claimSectorZero');
    expect(claim).toContain('if (!tabSuperseded(TAB_ID, previous)) return;');
    expect(claim).toContain('if (runInProgress()) setRunActive(false);');
    expect(claim).toContain('syncMark = parseSyncMark(mark);');
    // Перечитывает тем же правилом печати, что и старт (`YAG-4.4`).
    expect(claim).toContain('progressWrite = progressWrite.then(loadSectorProfile)');
    expect(claim).toContain(
      'sectorProgress = parseSectorZeroProgress(pick.raw, data, sectorSeed);',
    );
  });

  it('вытесненная вкладка слышит перехват и встаёт', () => {
    expect(SRC).toContain('if (event.key === TAB_OWNER_KEY) checkTabOwner();');
    expect(body('checkTabOwner')).toContain("runPauseEvent('hidden');");
  });
});
