// BOOT-1 — сторож «первый кадр сразу в новом виде».
//
// Заказ владельца: «убрать вспышку старого интерфейса при заходе на сайт». Замер до правки
// (1440×900): с 157 до 360 мс на экране был вход в ПРЕЖНЕМ виде и без подписей, потом —
// новый. Причина: браузер рисовал разметку раньше, чем выполнялся скрипт, а вид консоли
// (`holo-ui`) ставил только кадровый цикл игры. Сторож держит три звена правки: покров в
// разметке, его CSS и порядок в `bootstrap.ts` — сперва классы вида, потом снятие покрова.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const build = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
const boot = readFileSync(new URL('./bootstrap.ts', import.meta.url), 'utf8');

describe('BOOT-1 — покров до первого шага скрипта', () => {
  it('страница рождается под покровом, и покров прячет всё, кроме фона', () => {
    expect(build).toContain('<body data-entry="${entry}" class="app-booting">');
    expect(build).toContain('body.app-booting > *{visibility:hidden!important;}');
  });

  it('фон тёмный с первого кадра — раньше большого стиля', () => {
    const head = build.slice(build.indexOf('const page = '), build.indexOf('<body data-entry='));
    const tiny = head.indexOf('<style>html{background:#02080e}</style>');
    expect(tiny).toBeGreaterThan(-1);
    expect(tiny).toBeLessThan(head.indexOf('allCss()'));
  });

  it('покров снимается ПОСЛЕ того, как поставлены классы вида консоли', () => {
    const body = boot.slice(boot.indexOf('function revealBoot'), boot.indexOf('function revealBoot') + 400);
    const holo = body.indexOf("toggle('holo-ui'");
    const lift = body.indexOf("remove('app-booting')");
    expect(holo).toBeGreaterThan(-1);
    expect(lift).toBeGreaterThan(holo);
    // Правило вида — то же, что у кадрового цикла: не телефонный вьюпорт.
    expect(body).toContain('!measureViewport().mobile');
  });

  it('покров снимается на обоих путях запуска и при сбое', () => {
    // Обычная сборка — сразу, в первом синхронном шаге (подписи уже стоят).
    expect(boot).toMatch(/if \(!__SECTOR_ZERO_ONLY__\) revealBoot\(\);/);
    expect(boot.indexOf('if (!__SECTOR_ZERO_ONLY__) revealBoot();')).toBeLessThan(
      boot.indexOf('loaderReady()\n'),
    );
    // Архив площадки — после загрузки текстов, но до игры.
    expect(boot).toContain('loadActiveLocale().then(revealBoot)');
    expect(boot.indexOf('loadActiveLocale().then(revealBoot)')).toBeLessThan(
      boot.indexOf(".then(() => import('./main'))"),
    );
    // Экран ошибки запуска покров не прячет.
    const fail = boot.slice(boot.indexOf("console.error('E_CLIENT_STARTUP'"));
    expect(fail.indexOf("remove('app-booting')")).toBeGreaterThan(-1);
    expect(fail.indexOf("remove('app-booting')")).toBeLessThan(fail.indexOf("add('app-startup-failed')"));
  });
});
