// Исходник бота одной строкой: фасад `src/ai.ts` и фазы хода `src/aiTurn/*.ts` (SLIM-3).
// По нему диагноз «мёртвого контента» (`src/deadContent.ts`) решает, упоминает ли бот
// сущность строковым литералом; читают его `selfplay.mjs` и тест диагноза.
import { readdirSync, readFileSync } from 'node:fs';

const SRC = new URL('./src/', import.meta.url);

export const BOT_FILES = [
  'ai.ts',
  ...readdirSync(new URL('aiTurn/', SRC))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort()
    .map((name) => `aiTurn/${name}`),
];
export const botSource = () =>
  BOT_FILES.map((file) => readFileSync(new URL(file, SRC), 'utf8')).join('\n');
