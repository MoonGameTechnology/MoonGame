import type { BuildOptions } from 'esbuild';

/** Настройки сборщика для архива площадки — см. `platformBuild.mjs`. */
export declare const platformBuildOptions: BuildOptions & {
  define: Record<string, string>;
};

/** Путь файла языка в архиве (`assets/locale-<id>.json`). */
export declare const localeAssetPath: (id: string) => string;

/** Файлы языков архива: один на язык, с запечённым русским фолбэком. */
export declare function platformLocaleFiles(): Promise<
  { id: string; path: string; contents: string }[]
>;
