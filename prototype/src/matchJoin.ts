/**
 * Вход в партию и выбор места — у одного владельца (REFM-217, первый PR): заход в
 * выбранную партию {@link connectToMatch}, развилка «вернуться или выбрать место»
 * {@link openSessionTab}, экран настройки под сетевую сессию {@link openSeatPicker} и
 * опрос мест, пока этот экран открыт.
 *
 * Оверлей мест и таймер опроса — состояние модуля, снаружи его не видно. Опрос
 * останавливает дверь {@link stopNetSetupPoll} (её зовёт экран настройки, когда игрок
 * уходит), оверлей прячет {@link closeSeatPicker}.
 *
 * Адрес сервера и позывной `main.ts` читает из полей экрана подключения; модуль получает
 * их хуком {@link initMatchJoin}. Импорт из `main.ts` был бы циклом.
 */
import { t } from '../../localization/runtime';
import { entryOffer, type MatchSeat as EntrySeat } from '../../decisions/entrySetup';
import { afterTokenRefused, joinStep } from '../../decisions/joinGate';
import { queryOutcome, seatsUrl } from '../../decisions/matchQuery';
import { tokenFor } from '../../decisions/sessionStore';
import {
  askSignIn,
  authMode,
  claimDone,
  fetchJoinToken,
  holdJoinToken,
  sessionRecord,
} from './accountSession';
import { detach } from './detach';
import type { MapId } from './mapCatalog';
import { connect, targetMatch } from './netSession';
import { seatView, type SeatView } from './seatList';
import { enterNetSetup, netSetup, openSetup, updateNetOffer } from './setupScreen';

/** Что входу в партию нужно от игры. Живёт в `main.ts`. */
export interface MatchJoinHost {
  /** Адрес сервера и позывной; `null` — строка статуса уже сказала, чего не хватает. */
  resolveServer(): { base: string; nick: string } | null;
}

let game: MatchJoinHost;

/** Join a chosen match: set it as the (re)connect target, then dial via `connect()`.
 *  Accounts mode (SES-2.5) first exchanges the session for a join token (register/
 *  login happens lazily inside `ensureSession` on the first join).
 *
 *  If `?join=<id>` arrives without a stored session (no cached JWT in localStorage),
 *  `ensureSession` would silently return — the password row is on the welcome card,
 *  which isn't shown by default. Fix: stash the id in `pendingJoinAfterAuth`, show
 *  the welcome card so the player can register/login, and `welcomeSignIn` resumes
 *  the join automatically on success. */
export function connectToMatch(
  id: string,
  slot?: string,
  faction?: string,
  scientists: readonly string[] = [],
): void {
  targetMatch(id);
  // Развилка «пустить или послать на вход» — `joinGate.ts` (REFM-140); там же причины,
  // почему просьбу запоминают, почему пароль спрашивают только при известном сервере и
  // почему сессия проверяется наличием, а не совпадением позывного.
  detach(
    'заход в партию: билет и подключение',
    (async () => {
      const srv = game.resolveServer();
      const cached = srv ? sessionRecord(srv.base) : null;
      const next = joinStep({
        accountsMode: authMode === 'accounts',
        serverKnown: !!srv,
        hasSession: !!cached,
      });
      // Сервер без аккаунтов пускает по позывному: билет не нужен, сессии нет. Этот шаг
      // потерялся, когда режим стал строкой (`IdentityMode`): прежняя проверка
      // `if (!authMode)` больше никогда не срабатывала, и вход по позывному падал на
      // `cached!.token` ниже (нашёл `smoke:net`, REFM-204).
      if (next.step === 'connect') {
        claimDone(id);
        connect();
        return;
      }
      if (next.step === 'sign-in') {
        askSignIn(id, slot, faction, next.password ? srv : null, scientists);
        return;
      }
      const join = await fetchJoinToken(srv!.base, id, cached!.token, slot, faction, scientists);
      if (!join) {
        // Токен не выдан: сессии больше нет — вход просрочен, зовём войти заново; сессия на
        // месте — закрыт сам матч, и карточка входа тут ни при чём (правило 4).
        if (afterTokenRefused(!!sessionRecord(srv!.base)) === 'sign-in')
          askSignIn(id, slot, faction, srv, scientists);
        return;
      }
      holdJoinToken(join.token);
      claimDone(id);
      connect();
    })(),
  );
}

// Open a session in its OWN browser tab (deep-link «?join=<id>»): the hub/browser stays in
// THIS tab while the match runs in a fresh one, which boots straight into it from the shared
// same-origin localStorage identity (nick / session JWT).
//
// Audit (2026-07-25): `window.open(..., '_blank')` is silently blocked by most browsers
// for non-direct user-gestures, and the fallback `connectToMatch` then ran with a stale
// `nickInput.value` that didn't match the cached session login — so the welcome card
// re-opened instead of joining. Switch to `location.href` (same-tab navigation): the hub
// is replaced by the game view, no popup, no silent fallback. The hub is one tab-close away
// (the match itself is durable on the server). This matches the APK path (one window).
// REL-7: seat/faction picker — before joining, fetch the match's available seats
// and show a picker. The player chooses a faction/start, then we navigate to
// ?join=<id>&slot=<slotId>. Previously openSessionTab went straight to ?join=
// and the server auto-assigned the first free seat (no choice).
let seatpickEl: HTMLElement | null = null;
let seatpickListEl: HTMLElement | null = null;

/** Запрос расклада мест, назвавшись (ADDR-6).
 *
 *  Идущую партию сервер отдаёт только её участникам, поэтому запрос обязан сказать, кто
 *  спрашивает. На хосте с учётками это сессионный JWT (через `tokenFor` — «кто ты» ходит
 *  только им, правило 1 `sessionStore.ts`), на безаккаунтном — `?nick=` внутри адреса.
 *  Токена нет — идём как аноним: открытую для входа партию сервер покажет и так, а на
 *  закрытую нам и правда нечего смотреть.
 *
 *  ОДНА точка на оба захода — открытие экрана и его тихий переопрос. Разъехавшись, они
 *  отличались бы правами: переопрос молча слеп бы там, где открытие работает, и игрок
 *  видел бы застывший список вместо живого. */
function fetchSeats(base: string, matchId: string, nick: string): Promise<Response> {
  const pass = tokenFor(localStorage, base, nick);
  return fetch(
    seatsUrl(base, matchId, nick),
    pass ? { headers: { authorization: `Bearer ${pass}` } } : {},
  );
}

/** Опрос мест, пока открыт сетевой экран (ENTRY-2, правило 5).
 *
 *  Партия живая: пока игрок выбирает, соседний мир могут занять. Узнать об этом на
 *  попытке входа — поздно: игрок уже нажал «Выбрать» и получил отказ вместо мира.
 *  Поэтому список обновляется, а судьбу выбора решает `reconcileSelection`: занятый
 *  мир СБРАСЫВАЕТ выбор, а не переезжает на соседний — иначе человек улетел бы играть
 *  не туда, куда смотрел.
 *
 *  Тихий: неудачный запрос ничего не трогает. Список мест не критичен настолько, чтобы
 *  из-за одного сетевого чиха стирать игроку выбор. */
let netSetupPoll: ReturnType<typeof setInterval> | null = null;
const NET_SETUP_POLL_MS = 5000;

export function stopNetSetupPoll(): void {
  if (netSetupPoll !== null) clearInterval(netSetupPoll);
  netSetupPoll = null;
}

function startNetSetupPoll(base: string, matchId: string, nick: string): void {
  stopNetSetupPoll();
  netSetupPoll = setInterval(() => {
    if (!netSetup) return stopNetSetupPoll();
    detach(
      'сетевой сетап: опрос мест',
      (async () => {
        try {
          const res = await fetchSeats(base, matchId, nick);
          if (queryOutcome(res) !== 'ok') return;
          const body = (await res.json()) as { seats: EntrySeat[]; mapId?: MapId };
          updateNetOffer(matchId, entryOffer(body.seats ?? []));
        } catch {
          /* тихий опрос: связь моргнула — выбор игрока не трогаем */
        }
      })(),
    );
  }, NET_SETUP_POLL_MS);
}

/** Открыть экран настройки под КОНКРЕТНУЮ сетевую сессию (ENTRY-2).
 *
 *  Экран тот же, что в одиночной игре — игрок просил «как в одиночке, но в сетевой», и
 *  второй экран с той же картой разошёлся бы с первым на первой же правке. Меняется
 *  источник: кандидаты и дома приходят от сервера (`GET /matches/:id/seats`), занятые
 *  миры видны и не выбираются, правая колонка скрыта.
 *
 *  Пока места едут, на экране стоит честная заглушка (`seatList.ts`, правило 1): окно,
 *  которое ждёт ответа за кулисами, выглядит как проваленный тап, и игрок жмёт ещё раз. */
export async function openSeatPicker(matchId: string): Promise<void> {
  const srv = game.resolveServer();
  if (!srv) return;
  const показать = (view: SeatView): void => {
    if (!seatpickListEl || view.kind !== 'placeholder') return;
    const style = view.tone === 'dim' ? 'color:var(--dim);text-align:center' : 'color:var(--red)';
    seatpickListEl.innerHTML = `<p style="${style}">${t(view.key)}</p>`;
  };
  показать(seatView('opening'));
  if (seatpickEl) seatpickEl.style.display = 'flex';
  try {
    const res = await fetchSeats(srv.base, matchId, srv.nick);
    // Отказ и обрыв это окно показывает одинаково — см. оговорку в шапке `seatList.ts`.
    if (queryOutcome(res) !== 'ok') {
      показать(seatView('refused'));
      return;
    }
    const body = (await res.json()) as { seats: EntrySeat[]; mapId?: MapId };
    const offer = entryOffer(body.seats ?? []);
    if (seatpickEl) seatpickEl.style.display = 'none';
    openSetup('hub'); // сбрасывает режим — сетевой ставим сразу после
    enterNetSetup(matchId, body.mapId, offer);
    startNetSetupPoll(srv.base, matchId, srv.nick);
  } catch {
    показать(seatView('unreachable'));
  }
}

/** Спрятать оверлей мест. Выбор переехал на экран настройки (ENTRY-2), и оверлей остался
 *  заглушкой на время загрузки и на отказ: закрыть его можно, только спрятав. */
export function closeSeatPicker(): void {
  if (seatpickEl) seatpickEl.style.display = 'none';
}

export function openSessionTab(id: string, seated = false): void {
  // Место УЖЕ твоё — возвращаемся в партию, а не заводим её заново. Без этой развилки
  // игрок, вернувшийся после обрыва или рестарта сервера, попадал на «Совет учёных» и
  // выбор родного мира, то есть в создание персонажа поверх идущей партии; при этом
  // вход по ПРЯМОМУ адресу `/game/<id>` всё это время делал правильно. Признак берётся
  // не из догадки клиента, а из ответа сервера: вкладка «Активные» — это ровно те
  // партии, где `seatOf` вернул место (`MatchRegistry.list`).
  if (seated) {
    connectToMatch(id);
    return;
  }
  // REL-7: show the seat/faction picker first (if the server supports it),
  // otherwise fall back to the direct join (no slot).
  detach('вход в партию: выбор места', openSeatPicker(id));
}

/** Подключить вход в партию к игре: адрес сервера и оверлей мест. Зовут до загрузочного
 *  блока `main.ts` — ссылка на партию входит в неё прямо оттуда. */
export function initMatchJoin(host: MatchJoinHost): void {
  game = host;
  seatpickEl = document.getElementById('seatpick');
  seatpickListEl = document.getElementById('seatpick-list');
  // Кнопка «Назад» на оверлее до REFM-217 не делала ничего: после отказа сервера игрок
  // видел красную строку и кнопку, которая не закрывает окно, — уйти можно было только
  // аппаратным Back или Escape.
  document.getElementById('seatpick-cancel')?.addEventListener('click', closeSeatPicker);
}
