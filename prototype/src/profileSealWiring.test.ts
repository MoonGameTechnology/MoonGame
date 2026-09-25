/**
 * Сторож проводки печати профиля (`YAG-4.4`) — статический: `main.ts` живёт на DOM.
 * Правила печати покрыты в `decisions/profileSeal.test.ts`, поведение на собранном архиве —
 * робот `yandextest.mjs`. Здесь стык, и у него четыре способа сломаться молча:
 *
 * 1. **Запись мимо печати.** Одна запись профиля без печати — и следующий старт примет
 *    честный профиль за правленый: игрок откатится к теневой копии.
 * 2. **Чтение мимо правила.** Путь, который берёт основную копию как есть, снова пускает
 *    правку руками в игру.
 * 3. **Флаг раньше записи.** Флаг «уже запечатывало» встал, а запечатанный профиль в
 *    переполненное хранилище не лёг — старый профиль без печати окажется правленым.
 * 4. **Облако без привязки.** Копия, запечатанная без id игрока или принятая без проверки,
 *    снова разносит подделку по устройствам.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const body = (name: string): string =>
  new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(SRC)?.[1] ?? '';

describe('YAG-4.4 — профиль пишется только с печатью', () => {
  it('в хранилище профиля пишет одна функция — основную копию и сразу теневую', () => {
    expect(SRC.match(/sectorProgressStore\.save\(/g)).toHaveLength(1);
    expect(SRC.match(/sectorShadowStore\.save\(/g)).toHaveLength(1);
    const write = body('writeSectorProgress');
    expect(write).toContain('await sectorProgressStore.save(blob);');
    expect(write).toContain('await sectorShadowStore.save(blob);');
  });

  it('каждый её вызов несёт запечатанный профиль', () => {
    const calls = [...SRC.matchAll(/(?<!function )writeSectorProgress\(([^;]*)\);/g)].map(
      (m) => m[1],
    );
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const arg of calls) expect(arg).toMatch(/^sealProgress\(.+, LOCAL_SEAL\)\)?$|^blob\)?$/);
    expect(body('saveSectorProgress')).toContain('const blob = sealProgress(next, LOCAL_SEAL);');
  });

  it('флаг «уже запечатывало» встаёт только после того, как запись легла', () => {
    expect(body('writeSectorProgress')).toMatch(
      /if \(syncMark\.sealed \|\| \(await sectorProgressStore\.load\(\)\) !== blob\) return;\s+syncMark = \{ \.\.\.syncMark, sealed: true \};\s+writeSyncMark\(\);/,
    );
  });
});

describe('YAG-4.4 — профиль читается только по правилу печати', () => {
  it('основную копию читает одна функция — и отдаёт выбор правилу', () => {
    expect(SRC.match(/sectorProgressStore\.load\(\)/g)).toHaveLength(2); // чтение и проверка записи
    expect(body('loadSectorProfile')).toContain(
      'const pick = pickLocalProfile(main, shadow, syncMark.sealed === true);',
    );
  });

  it('старт и перехват вкладки идут через неё, а велено — переписывают профиль', () => {
    expect(SRC).toContain('let progressWrite = loadSectorProfile().then(');
    expect(SRC).toContain('if (granted.progress === sectorProgress && !pick.rewrite) return;');
    const claim = body('claimSectorZero');
    expect(claim).toContain('progressWrite.then(loadSectorProfile)');
    expect(claim).toContain('if (pick.rewrite) await writeSectorProgress(');
  });
});

describe('YAG-4.4 — облако не разносит подделку', () => {
  it('в облако уходит копия, запечатанная для вошедшего игрока', () => {
    expect(body('pushCloud')).toContain(
      'progress: sealProgress(sectorProgress, cloudSeal(cloudPlayer)),',
    );
    expect(body('syncCloud')).toContain('cloudPlayer = player.id;');
  });

  it('из облака берётся только копия с целой печатью этого игрока', () => {
    const sync = body('syncCloud');
    expect(sync).toContain('const cloud = wholeCloud(found, player.id);');
    // Дальше сверка видит только проверенную копию: сырой разбор в план не попадает.
    expect(sync).not.toMatch(/planCloudSync\([\s\S]*\bfound\b[\s\S]*\);/);
    expect(body('adoptCloud')).toContain(
      'await writeSectorProgress(sealProgress(sectorProgress, LOCAL_SEAL));',
    );
  });
});
