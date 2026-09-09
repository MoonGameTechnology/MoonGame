// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Determinism: these Math functions are "implementation-approximated" in ECMA-262
 * (not required to be correctly-rounded), so they can differ bit-for-bit across JS
 * engines (V8 on the server vs V8 / JSC / Hermes on the client) — which would
 * desync the client's preview from the server authority. The core must stay in the
 * correctly-rounded IEEE-754 subset (+ − × ÷ √ min max floor ceil + integer ops).
 * `Math.sqrt` is intentionally NOT banned: IEEE-754 mandates √ be correctly rounded
 * and ECMA-262 excludes it from the approximated list. See docs/architecture.md §8.
 */
const NON_DETERMINISTIC_MATH = [
  'acos', 'acosh', 'asin', 'asinh', 'atan', 'atan2', 'atanh', 'cbrt', 'cos', 'cosh',
  'exp', 'expm1', 'hypot', 'log', 'log10', 'log1p', 'log2', 'pow', 'sin', 'sinh', 'tan', 'tanh',
].map((property) => ({
  object: 'Math',
  property,
  message: `Determinism: Math.${property} is implementation-approximated (not bit-exact across JS engines). Keep the core in the correctly-rounded IEEE-754 subset (+ − × ÷ √ min max floor ceil + integer ops). See docs/architecture.md §8.`,
}));

export default tseslint.config(
  {
    // The multiplayer test client and the mobile (Capacitor) wrapper are throwaway
    // demo / build glue; not part of the core or its gate. `prototype/` is NOT in
    // this list any more (REFM-0.1): it is the players' playable client, so it gets
    // the same lint as the packages — the zone's Node scripts just need their
    // globals (see the block at the bottom).
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'testclient/**',
      'mobile/**',
      // Semgrep rule fixtures (SEC-2) are intentionally-broken snippets for the
      // `// ruleid:` / `// ok:` unit-test convention, not real source.
      '.semgrep/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Determinism guardrails — enforced only inside the simulation core.
    // See docs/architecture.md §4.2.
    files: ['packages/shared-core/src/**/*.ts'],
    ignores: ['packages/shared-core/src/**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Determinism: use the seeded Rng, never Math.random().',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'Determinism: pass time as a parameter (Context.now), never Date.now().',
        },
        ...NON_DETERMINISTIC_MATH,
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'Date',
          message: 'Determinism: time must be a parameter in shared-core; avoid Date here.',
        },
      ],
    },
  },
  {
    // «Как часы» с машинным сторожем (а не с обещанием быть внимательным).
    //
    // Node с 15-й версии УБИВАЕТ процесс на необработанном отклонении промиса. Значит в
    // серверном коде каждый фоновый промис — потенциальный обрыв всех матчей разом:
    // заминка базы в отложенном сохранении, сорвавшееся пробуждение спящего матча,
    // неудачное сообщение одного игрока. Ровно на этом классе мы уже потеряли плейтест
    // (замершая карта — его клиентский родственник), поэтому правило теперь не в голове,
    // а здесь: у каждого фонового промиса ОБЯЗАН быть назван исход при отказе — обычно
    // через `detach()` (`packages/server/src/detach.ts`).
    //
    // `ignoreVoid: false` — принципиально: именно `void p` и был той формой, которая
    // выглядит как «я подумал об этом», а на деле просто прячет промис от линтера.
    //
    // Граница проведена по ПРОЦЕССУ, а не по вкусу: сторожим то, что крутится 24/7 и
    // падением уносит всех. Браузерный `prototype/src/**` сюда НЕ входит — там отклонение
    // это запись в консоли вкладки, а не оборванный матч; его уборка отдельная и большая.
    // Правило типозависимое (`projectService`), поэтому линт этих файлов заметно дороже —
    // ещё одна причина не расширять список без нужды.
    files: ['packages/server/src/**/*.ts', 'prototype/netserver.ts'],
    ignores: ['packages/server/src/**/*.test.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
    },
  },
  {
    // CI / repo-automation scripts run on Node — give them the Node globals they use
    // (the determinism rules above never apply here; this is build glue, not the core).
    // `prototype/*.mjs` joins them (REFM-0.1): the zone's build/host/harness scripts
    // (build, netserver, host, doctor, perf, selfplay, browsertest, …) are the same
    // kind of Node glue. The zone's TypeScript is linted by the shared config above —
    // typescript-eslint turns `no-undef` off for .ts (tsc owns that check), so the
    // browser client needs no globals list here.
    files: [
      '.github/**/*.{mjs,js}',
      'scripts/**/*.{mjs,js}',
      'prototype/**/*.{mjs,js}',
      // `deploy/*.mjs` — тесты скриптов эксплуатации (OPS-1), та же Node-глюкода.
      'deploy/**/*.{mjs,js}',
    ],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        performance: 'readonly',
      },
    },
  },
);
