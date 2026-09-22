import { describe, expect, it } from 'vitest';
import {
  buildId,
  cacheablePaths,
  digestOf,
  isLocaleChunk,
  precachePaths,
  type BuiltFile,
} from './precache';

/**
 * CP2.2 — what the offline shell is told to keep.
 *
 * The file names below are real output of `pnpm --filter @void/client build`, not
 * invented shapes: the locale rule reads a chunk NAME, so a test on made-up names
 * would pass while the build shipped something else.
 */
const f = (path: string, digest = 'd'): BuiltFile => ({ path, digest });

const BUILD: BuiltFile[] = [
  f('index.html', 'h'),
  f('assets/main-5EH-V8Xc.js', 'm'),
  f('assets/index-BpldJrhO.js', 'i'),
  f('assets/ru-_A4Nf2dg.js', 'r'),
  f('assets/en-CgR6fmLG.js', 'e'),
  f('assets/holographic-space-DfNxYHIn.webp', 'w'),
  f('sw.js', 's'),
];

describe('precache (CP2.2)', () => {
  it('никогда не кэширует сам воркер', () => {
    expect(cacheablePaths(BUILD)).not.toContain('sw.js');
    expect(precachePaths(BUILD, ['ru', 'en'])).not.toContain('sw.js');
  });

  it('чанк языка кэшируется по требованию, но не скачивается заранее (LOC-6)', () => {
    const cacheable = cacheablePaths(BUILD);
    const precache = precachePaths(BUILD, ['ru', 'en']);
    expect(cacheable).toContain('assets/ru-_A4Nf2dg.js');
    expect(cacheable).toContain('assets/en-CgR6fmLG.js');
    // Оба языка в prefetch'е вернули бы ровно ту экономию, ради которой был LOC-6.
    expect(precache).not.toContain('assets/ru-_A4Nf2dg.js');
    expect(precache).not.toContain('assets/en-CgR6fmLG.js');
    expect(precache).toContain('index.html');
    expect(precache).toContain('assets/main-5EH-V8Xc.js');
  });

  it('по имени языка узнаётся только сам чанк языка', () => {
    expect(isLocaleChunk('assets/en-CgR6fmLG.js', ['ru', 'en'])).toBe(true);
    // Совпадение префикса — не совпадение имени: `ru` не делает `ruins` языком.
    expect(isLocaleChunk('assets/ruins-CgR6fmLG.js', ['ru', 'en'])).toBe(false);
    expect(isLocaleChunk('assets/index-BpldJrhO.js', ['ru', 'en'])).toBe(false);
    expect(isLocaleChunk('assets/en-CgR6fmLG.webp', ['ru', 'en'])).toBe(false);
  });

  it('id сборки не зависит от порядка файлов', () => {
    expect(buildId([...BUILD].reverse())).toBe(buildId(BUILD));
  });

  it('id сборки меняется от правки файла с ПОСТОЯННЫМ именем', () => {
    // Ровно та дыра, ради которой id считается по содержимому, а не по именам:
    // в `index.html` лежит весь стиль приложения, а имя у него всегда одно.
    const edited = BUILD.map((b) => (b.path === 'index.html' ? f('index.html', 'h2') : b));
    expect(buildId(edited)).not.toBe(buildId(BUILD));
  });

  it('id сборки не меняется от пересборки без изменений', () => {
    expect(buildId(BUILD.map((b) => ({ ...b })))).toBe(buildId(BUILD));
  });

  it('воркер не участвует в id сборки — иначе он ссылался бы сам на себя', () => {
    const other = BUILD.map((b) => (b.path === 'sw.js' ? f('sw.js', 's2') : b));
    expect(buildId(other)).toBe(buildId(BUILD));
  });

  it('дайджест различает содержимое и не различает представление', () => {
    expect(digestOf('a')).not.toBe(digestOf('b'));
    expect(digestOf(new Uint8Array([97]))).toBe(digestOf('a'));
  });
});
