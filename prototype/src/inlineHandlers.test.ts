// Политика документа (`packages/server/src/securityHeaders.ts`) не разрешает инлайновые
// обработчики событий: `on…="…"` в разметке браузер не выполнит и сообщит о нарушении CSP
// (`script-src-attr`), которое валит сетевой смоук `nettest.mjs`. Сторож держит разметку
// без них, а гашение отправки форм — в `bootstrap.ts`.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const build = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
const boot = readFileSync(new URL('./bootstrap.ts', import.meta.url), 'utf8');

describe('разметка без инлайновых обработчиков', () => {
  it('в build.mjs нет атрибутов on…="…" (кроме лоадера SDK площадки)', () => {
    const handlers = [...build.matchAll(/\son[a-z]+="[^"]*"/g)].map((m) => m[0].trim());
    // Тег лоадера Яндекс Игр задан площадкой дословно и живёт только в её архиве,
    // который наш сервер не отдаёт (см. SDK_LOADER в build.mjs).
    expect(handlers.filter((h) => h !== 'onload="initSDK()"')).toEqual([]);
  });

  it('отправку форм гасит bootstrap.ts', () => {
    expect(boot).toContain("document.addEventListener('submit', (e) => e.preventDefault());");
  });
});
