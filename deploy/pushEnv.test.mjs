// UIX-4.4: push на проде включается ключами VAPID в окружении хоста (`vapidFromEnv`,
// `packages/server/src/push.ts`). Compose перечисляет переменные контейнера поимённо, и
// ключ, которого нет в списке, до хоста не доходит: push молча остаётся выключенным, хотя
// оператор вписал его в server.env. Сторож держит три имени в обоих местах.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const KEYS = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'];

describe('ключи push доходят до хоста', () => {
  it('сервер читает ровно эти имена', () => {
    const push = read('../packages/server/src/push.ts');
    for (const key of KEYS) expect(push).toContain(`env.${key}`);
  });

  it('compose передаёт их контейнеру, пустыми по умолчанию — push выключен', () => {
    const compose = read('./docker-compose.yml');
    for (const key of KEYS) expect(compose).toContain(`${key}: \${${key}:-}`);
  });

  it('пример окружения объясняет, где их взять', () => {
    const example = read('./server.env.example');
    for (const key of KEYS) expect(example).toMatch(new RegExp(`^# ${key}=`, 'm'));
    expect(example).toContain('npx web-push generate-vapid-keys');
  });
});
