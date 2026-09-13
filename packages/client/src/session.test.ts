/**
 * The client's HTTP half, driven end to end with no browser and no server (MIG-2).
 *
 * What is worth testing here is NOT the rules — each decision module already has its own
 * test next to it in `/decisions`. It is the ORDER the effects run in and what the client
 * does with the verdict: which request goes out first, what gets stored, and what is
 * forgotten. Those are exactly the mistakes that survive a green rules test: sending
 * registration before login opens a second account for an existing player, and keeping a
 * session the server has already rejected makes every later attempt fail identically.
 */
import { describe, expect, it } from 'vitest';
import { createSession, type HttpReply, type SessionIo } from './session';
import { sessionKey } from '../../../decisions/sessionStore';

const BASE = 'ws://host:8788';

/** A stub server: canned answers by `METHOD path`, plus the call log in order. */
function io(answers: Record<string, HttpReply | null | Array<HttpReply | null>>): SessionIo & {
  calls: string[];
  sent: Array<string | undefined>;
  headers: Array<Record<string, string> | undefined>;
  mem: Map<string, string>;
} {
  const calls: string[] = [];
  const sent: Array<string | undefined> = [];
  const headers: Array<Record<string, string> | undefined> = [];
  const mem = new Map<string, string>();
  return {
    calls,
    sent,
    headers,
    mem,
    http: (url, init) => {
      const method = init?.method ?? 'GET';
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      calls.push(`${method} ${path}`);
      sent.push(init?.body);
      headers.push(init?.headers);
      const key = Object.keys(answers).find((k) => `${method} ${path}`.startsWith(k));
      const answer = key ? answers[key] : undefined;
      if (key && answer === null) return Promise.resolve(null); // запрос не состоялся
      const reply = Array.isArray(answer) ? (answer.shift() ?? notFound) : (answer ?? notFound);
      return Promise.resolve(reply);
    },
    store: {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    },
  };
}
const notFound: HttpReply = { ok: false, status: 404, body: null };
const ok = (body: unknown): HttpReply => ({ ok: true, status: 200, body });
const fail = (status: number, error?: string): HttpReply => ({
  ok: false,
  status,
  body: error ? { error } : null,
});

describe('вход', () => {
  it('пробует ВХОД, и только неизвестный логин уводит в регистрацию', async () => {
    const net = io({
      'POST /auth/login': fail(401, 'E_AUTH'),
      'POST /auth/register': ok({ token: 'T', login: 'Командор' }),
    });
    const res = await createSession(BASE, net).signIn('Командор', 'longenough');

    expect(res).toEqual({ kind: 'done', outcome: 'created' });
    // Порядок — это и есть смысл «первый вход заводит учётку»; наоборот он завёл бы
    // вторую тому, у кого она уже есть.
    expect(net.calls).toEqual(['POST /auth/login', 'POST /auth/register']);
  });

  it('удачный вход НЕ идёт в регистрацию и запоминает сессию под позывным', async () => {
    const net = io({ 'POST /auth/login': ok({ token: 'T1', login: 'Ash' }) });
    const res = await createSession(BASE, net).signIn('Ash', 'longenough');

    expect(res).toEqual({ kind: 'done', outcome: 'ok' });
    expect(net.calls).toEqual(['POST /auth/login']);
    expect(net.mem.get(sessionKey(BASE))).toBe(JSON.stringify({ login: 'Ash', token: 'T1' }));
  });

  it('занятый позывной с чужим паролем — это «пароль не подошёл», а не «отказ»', async () => {
    // Та самая пара: 401 на входе + 409 на регистрации. Слить их в общий отказ значит
    // отправить игрока чинить не то.
    const net = io({
      'POST /auth/login': fail(401, 'E_AUTH'),
      'POST /auth/register': fail(409, 'E_LOGIN_TAKEN'),
    });
    const res = await createSession(BASE, net).signIn('Ash', 'wrongbutlong');

    expect(res).toEqual({ kind: 'done', outcome: 'wrong-password' });
    expect(net.mem.size, 'неудачный вход не оставляет сессии').toBe(0);
  });

  it('кривое поле не уходит в сеть вовсе и названо поимённо', async () => {
    const net = io({});
    const session = createSession(BASE, net);

    expect(await session.signIn('ab', 'longenough')).toEqual({ kind: 'invalid', field: 'login' });
    expect(await session.signIn('Ash', 'short')).toEqual({ kind: 'invalid', field: 'password' });
    expect(net.calls, 'сервер не должен отвечать за подсказку по полю').toEqual([]);
  });

  it('почта уходит ТОЛЬКО в регистрацию и только если её ввели', async () => {
    const withMail = io({
      'POST /auth/login': fail(401),
      'POST /auth/register': ok({ token: 'T' }),
    });
    await createSession(BASE, withMail).signIn('Ash', 'longenough', 'a@b.c');
    expect(JSON.parse(withMail.sent[0] ?? '{}')).toEqual({ login: 'Ash', password: 'longenough' });
    expect(JSON.parse(withMail.sent[1] ?? '{}')).toEqual({
      login: 'Ash',
      password: 'longenough',
      email: 'a@b.c',
    });

    const noMail = io({ 'POST /auth/login': fail(401), 'POST /auth/register': ok({ token: 'T' }) });
    await createSession(BASE, noMail).signIn('Ash', 'longenough');
    // `email: ''` записал бы на учётку пустой адрес — восстановление потом упрётся в него
    // как в «адрес уже задан». Поэтому поля нет вовсе, а не пустого.
    expect(JSON.parse(noMail.sent[1] ?? '{}')).not.toHaveProperty('email');
  });
});

describe('список матчей', () => {
  it('отдаёт разобранный список и представляется сессией', async () => {
    const net = io({ 'GET /matches': ok({ available: [{ matchId: 'm1' }], active: [], archived: [] }) });
    net.mem.set(sessionKey(BASE), JSON.stringify({ login: 'Ash', token: 'T1' }));

    const res = await createSession(BASE, net).matches();

    expect(res.outcome).toBe('ok');
    expect(res.lists?.available[0]?.matchId).toBe('m1');
    expect(net.headers[0]?.authorization).toBe('Bearer T1');
  });

  it('2xx с неразобранным телом — это «списка нет», а не «список прежний»', async () => {
    // Иначе на экране остались бы старые строки, и игрок нажал бы «Войти» по матчу,
    // которого уже нет.
    const net = io({ 'GET /matches': ok('не-json') });
    expect(await createSession(BASE, net).matches()).toEqual({ outcome: 'unreachable', lists: null });
  });

  it('несостоявшийся запрос отличается от отказа сервера', async () => {
    // `null` = запрос НЕ СОСТОЯЛСЯ. Отличать это от отказа — единственная разница,
    // на которую игрок может ответить: недоступный сервер стоит переспросить.
    const down = io({ 'GET /matches': null });
    expect((await createSession(BASE, down).matches()).outcome).toBe('unreachable');

    const refused = io({ 'GET /matches': fail(403) });
    expect((await createSession(BASE, refused).matches()).outcome).toBe('refused');
  });
});

describe('занятие места', () => {
  const seated = (net: ReturnType<typeof io>): void => {
    net.mem.set(sessionKey(BASE), JSON.stringify({ login: 'Ash', token: 'T1' }));
  };

  it('меняет сессию на пропуск и строит адрес дозвона ТОКЕНОМ', async () => {
    const net = io({ 'GET /matches/m1/join': ok({ token: 'J7', playerId: 'p2' }) });
    seated(net);

    const res = await createSession(BASE, net).join('m1');

    expect(res).toEqual({ ok: true, playerId: 'p2', wsUrl: `${BASE}/matches/m1?token=J7` });
    // Позывной в адрес НЕ попадает: в режиме аккаунтов сервер его там отвергнет.
    expect((res as { wsUrl: string }).wsUrl).not.toContain('nick=');
  });

  it('выбранное место и дом уходят в запрос, а невыбранное не уходит пустым', async () => {
    const net = io({ 'GET /matches/m1/join': ok({ token: 'J', playerId: 'p1' }) });
    seated(net);
    await createSession(BASE, net).join('m1', { slot: 'p3', scientists: ['s1', 's2'] });

    expect(net.calls[0]).toBe('GET /matches/m1/join?slot=p3&sci=s1%2Cs2');
    // `faction=` сервер прочитал бы как «выбор сделан и он пуст» — это другое утверждение.
    expect(net.calls[0]).not.toContain('faction=');
  });

  it('401 ЗАБЫВАЕТ сессию — иначе клиент вечно стучится просроченным пропуском', async () => {
    const net = io({ 'GET /matches/m1/join': fail(401) });
    seated(net);

    const res = await createSession(BASE, net).join('m1');

    expect(res).toEqual({ ok: false, reason: 'session-expired' });
    expect(net.mem.size, 'просроченная сессия обязана быть стёрта').toBe(0);
  });

  it('отказ самого матча сессию НЕ трогает — дело не в пароле', async () => {
    for (const [status, reason] of [
      [403, 'entry-closed'],
      [409, 'seats-full'],
    ] as const) {
      const net = io({ 'GET /matches/m1/join': fail(status) });
      seated(net);
      expect(await createSession(BASE, net).join('m1')).toEqual({ ok: false, reason });
      expect(net.mem.size, 'вход закрыт или мест нет — а сессия в порядке').toBe(1);
    }
  });

  it('несостоявшийся вход — «сервер недоступен», а не «пароль не тот»', async () => {
    const net = io({ 'POST /auth/login': null });
    expect(await createSession(BASE, net).signIn('Ash', 'longenough')).toEqual({ kind: 'offline' });
  });

  it('несостоявшееся занятие места не выглядит отказом ЭТОГО матча', async () => {
    // Иначе игрок пойдёт выбирать другой матч — неверный ход, когда недоступен весь сервер.
    const net = io({ 'GET /matches/m1/join': null });
    net.mem.set(sessionKey(BASE), JSON.stringify({ login: 'Ash', token: 'T1' }));
    expect(await createSession(BASE, net).join('m1')).toEqual({ ok: false, reason: 'offline' });
  });

  it('половина пропуска — не пропуск', async () => {
    // 2xx без playerId адреса дозвона не даёт; выдумать его значит отправить игрока
    // в рукопожатие, которое сервер обязан отбить.
    const net = io({ 'GET /matches/m1/join': ok({ token: 'J' }) });
    seated(net);
    expect(await createSession(BASE, net).join('m1')).toEqual({ ok: false, reason: 'failed' });
  });
});
