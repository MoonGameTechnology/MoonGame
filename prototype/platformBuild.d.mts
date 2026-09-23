import type { BuildOptions } from 'esbuild';

/** Настройки сборщика для архива площадки — см. `platformBuild.mjs`. */
export declare const platformBuildOptions: BuildOptions & {
  define: Record<string, string>;
};
