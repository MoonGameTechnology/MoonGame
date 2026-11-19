/**
 * Платные приказы сетевой партии (TEC-3.2, TEC-4): ускорение очереди
 * (`POST /matches/:id/speedup`) и покупка ресурса (`POST /matches/:id/resources`), их повтор.
 *
 * Правило, ради которого модуль существует: **номер запроса живёт до окончательного ответа.**
 * Сервер списывает ◆ под этот номер, а если ответ потерялся (503, обрыв, закрыли вкладку),
 * повтор ТЕМ ЖЕ номером не спишет второй раз, а узнает итог. Поэтому номер пишется в
 * хранилище до отправки и стирается только окончательным ответом; неразрешённый запрос
 * отправляется снова при следующем входе в эту партию, раньше любого нового.
 *
 * Сессию аккаунта даёт хаб (`setSpeedupAuth`), чтобы здесь не было второй копии правила
 * «когда вкладка имеет право ходить в сеть» (`decisions/hubAuth.ts`).
 */
import type { QueueRef } from '../../packages/shared-core/src/index';
import { speedupAnswerFinal } from '../../decisions/speedupOffer';
import { refusalText } from '../../decisions/refusalText';
import { t } from '../../localization/runtime';
import { serverMatchId } from './netSession';
import { readLocal, writeLocal } from './localStore';
import { toast } from './toastStack';
import { fmtEta } from './format';
import { detach } from './detach';

type AuthorizedBase = () => Promise<{ base: string; token: string } | null>;

/** Платный приказ партии: ускорение очереди или покупка ресурса (TEC-4) — у сервера один
 *  журнал ◆ и один бюджет на оба, поэтому и здесь одна очередь запроса. */
interface Pending {
  requestId: string;
  path: 'speedup' | 'resources';
  /** Тело запроса без номера. */
  body: Record<string, unknown>;
  hours: number;
}

let authorized: AuthorizedBase | null = null;
let inFlight = false;
const resumed = new Set<string>();
/** The tab's own copy: storage may refuse writes, and the request still must not be lost. */
const memory = new Map<string, Pending>();
const RETRY_MS = [1000, 3000];

/** Хаб отдаёт сюда свой ответ на «есть ли авторизованный адрес». */
export function setSpeedupAuth(fn: AuthorizedBase): void {
  authorized = fn;
}

const key = (matchId: string): string => `void.speedup.pending:${matchId}`;

function readPending(matchId: string): Pending | null {
  try {
    const raw = readLocal(key(matchId));
    const p = raw ? (JSON.parse(raw) as Pending) : null;
    if (
      p &&
      typeof p.requestId === 'string' &&
      typeof p.hours === 'number' &&
      (p.path === 'speedup' || p.path === 'resources') &&
      p.body &&
      typeof p.body === 'object'
    )
      return p;
  } catch {
    /* a broken record reads as none; the tab's copy may still hold it */
  }
  return memory.get(matchId) ?? null;
}

function writePending(matchId: string, p: Pending | null): void {
  if (p) memory.set(matchId, p);
  else memory.delete(matchId);
  writeLocal(key(matchId), p ? JSON.stringify(p) : '');
}

/** Платная кнопка есть только в сетевой партии; вход в партию заодно дошлёт зависший запрос. */
export function speedupPaid(): boolean {
  const matchId = serverMatchId();
  if (!matchId) return false;
  if (!resumed.has(matchId)) {
    resumed.add(matchId);
    if (readPending(matchId)) setTimeout(() => detach('speedup resume', send(matchId)), 0);
  }
  return true;
}

async function post(matchId: string, p: Pending): Promise<{ status: number; body: Record<string, unknown> }> {
  const auth = await authorized?.();
  if (!auth) return { status: 401, body: { error: 'E_AUTH' } };
  try {
    const res = await fetch(`${auth.base}/matches/${encodeURIComponent(matchId)}/${p.path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: p.requestId, ...p.body }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body };
  } catch {
    return { status: 0, body: {} };
  }
}

function report(p: Pending, answer: { status: number; body: Record<string, unknown> }): void {
  const { body } = answer;
  if (answer.status === 200) {
    const n = Number(body.sovereigns);
    toast(p.path === 'resources' ? t('rescard.buy.done', { n }) : t('speedup.done', { time: fmtEta(p.hours), n }));
    return;
  }
  const code = typeof body.error === 'string' ? body.error : 'E_NETWORK';
  const why = code === 'E_AUTH' ? t('speedup.sign-in') : refusalText(code);
  toast(typeof body.refunded === 'number' ? `${why} · ${t('speedup.refunded', { n: body.refunded })}` : why);
}

/** Отправить запрос партии, пока он не получит окончательный ответ (или не кончатся попытки). */
async function send(matchId: string): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    for (let attempt = 0; ; attempt++) {
      const p = readPending(matchId);
      if (!p) return;
      const answer = await post(matchId, p);
      if (speedupAnswerFinal(answer.status)) {
        writePending(matchId, null);
        report(p, answer);
        return;
      }
      if (answer.status === 401) {
        toast(t('speedup.sign-in'));
        return;
      }
      if (attempt >= RETRY_MS.length) {
        toast(t('speedup.pending'));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS[attempt]));
    }
  } finally {
    inFlight = false;
  }
}

/** Отправить платный приказ. Пока прежний запрос не разрешён, новый не начинается: сначала
 *  дошлётся прежний. Без сессии новый запрос не заводится. */
function request(path: Pending['path'], body: Record<string, unknown>, hours: number): void {
  const matchId = serverMatchId();
  if (!matchId || inFlight) return;
  detach(
    path,
    (async () => {
      if (!readPending(matchId)) {
        if (!(await authorized?.())) {
          toast(t('speedup.sign-in'));
          return;
        }
        writePending(matchId, { requestId: crypto.randomUUID(), path, body, hours });
      }
      await send(matchId);
    })(),
  );
}

/** Ускорить очередь `ref` на `hours` игровых часов. */
export function requestSpeedup(ref: QueueRef, hours: number): void {
  request('speedup', { ...ref, hours }, hours);
}

/** Купить ресурс на `hours` эталонных часов (TEC-4). */
export function requestResources(resource: string, hours: number): void {
  request('resources', { resource, hours }, hours);
}
