import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/src/**/*.test.ts',
      'prototype/src/**/*.test.ts',
      // Общий рантайм локализации живёт рядом с текстами, вне packages/ и prototype/.
      'localization/**/*.test.ts',
      // Скрипты CI (SEC-19). До сих пор их не покрывал ни один тест, хотя ошибка в них
      // тихая по своей природе: шаг под `continue-on-error` падает, гейт зелёный, а
      // сертифицирует он ничего — ровно так и потерялась загрузка находок trivy-deps.
      '.github/scripts/**/*.test.mjs',
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
  },
});
