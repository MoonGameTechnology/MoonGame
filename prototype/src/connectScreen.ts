/**
 * Экран подключения `#connect` (REFM-247): его поля, строка статуса, показ и разбор адреса.
 *
 * Входной экран: выбрать фракцию, затем схватка на месте или вход на сервер
 * (`pnpm dev:proto-server` или адрес туннеля, которым поделился друг). Последний адрес
 * помнится, поэтому APK переподключается одним касанием. Страницы входа и переключатель
 * стадий экрана — `signInPages.ts` (REFM-218), список партий — `matchBrowser.ts` (REFM-217),
 * разбор набранного адреса — `decisions/serverAddress.ts`. Здесь — то, что раньше лежало в
 * `main.ts`: сами узлы экрана, его показ, адрес и позывной по умолчанию, вход в обозреватель
 * и такт активности игрока. Узлы видны наружу живой привязкой: их пишут загрузочный блок,
 * вход и хосты окон `main.ts`.
 */
import { startPlayerActivity } from '../../packages/client/src/playerActivity';
import { httpBase } from '../../decisions/matchQuery';
import { defaultServerField, resolveAddress, resolveBase } from '../../decisions/serverAddress';
import { t } from '../../localization/runtime';
import { sessionToken } from './accountSession';
import { detach } from './detach';
import { refreshMatches } from './matchBrowser';
import { showStage, suggestCallsign } from './signInPages';
import { bakedServer } from './updater';

declare const __SECTOR_ZERO_ONLY__: boolean;

export let connectEl: HTMLElement;
export let srvInput: HTMLInputElement;
export let nickInput: HTMLInputElement;
export let statusEl: HTMLElement;
let activity: ReturnType<typeof startPlayerActivity> | undefined;

export function initConnectScreen(): void {
  connectEl = document.getElementById('connect') as HTMLElement;
  srvInput = document.getElementById('csrv') as HTMLInputElement;
  nickInput = document.getElementById('cnick') as HTMLInputElement;
  statusEl = document.getElementById('cstatus') as HTMLElement;
  // Запомненный сервер, затем вшитый в APK, затем свой адрес страницы (`serverAddress.ts`,
  // правило 8).
  srvInput.value = defaultServerField(localStorage.getItem('void.server'), bakedServer(), location);
  // Remember the side you last commanded, so reopening the link drops you back onto
  // your own seat — the server maps nick→side, so a returning name resumes its own
  // faction (nick-login; full accounts in docs/persistence-accounts-roadmap.md).
  nickInput.value = localStorage.getItem('void.nick') ?? '';
}

export function showConnect(show: boolean): void {
  connectEl.style.display = show ? 'flex' : 'none';
}

/** Виден ли экран подключения. Нужен там, где решение зависит от того, ПРОЧИТАЕТ ли
 *  игрок написанное в его строку статуса. Пришёл ли он по ссылке — отдельный вопрос и
 *  отдельный признак (`cameFromLink`): оверлей держится до впуска в обоих случаях. */
export function connectShown(): boolean {
  return connectEl.style.display !== 'none';
}

/** Стадия обозревателя партий: без позывного он предложит свой, а список перечитается. */
export function enterBrowse(): void {
  if (!nickInput.value.trim()) nickInput.value = suggestCallsign();
  showStage('browse');
  detach('обозреватель: список партий', refreshMatches());
}

/** Normalize the pasted server box to a ws(s):// ORIGIN + read the nick. Returns
 *  null (and sets the status line) when either is missing/invalid. Shared by the
 *  match browser and `connect()`. */
export function resolveServer(): { base: string; nick: string } | null {
  // Разбор набранного — `serverAddress.ts` (REFM-162): схема правится (скопированный из
  // браузера `https://` → `wss://`, голый хост дополняется схемой страницы, а на
  // HTTPS-странице `ws://` поднимается до `wss://` — иначе браузер молча режет сокет),
  // путь отбрасывается, а пустой ПОЗЫВНОЙ не пускает дальше МОЛЧА: пробу режима
  // аккаунтов зовут из загрузочного блока, до того как игрок что-то напечатал.
  const step = resolveAddress({
    server: srvInput.value,
    nick: nickInput.value,
    pageHttps: location.protocol === 'https:',
  });
  if (step.kind === 'ok') return { base: step.base, nick: step.nick };
  if (step.kind !== 'need-nick') statusEl.textContent = t(step.key);
  return null;
}

/** Такт активности игрока: сервер из поля и сессия этого сервера. В архиве площадки
 *  сервера нет — такт не поднимается. */
export function startActivity(): void {
  if (__SECTOR_ZERO_ONLY__) return;
  activity = startPlayerActivity(() => {
    const step = resolveBase(srvInput.value, location.protocol === 'https:');
    const base = step.kind === 'ok' ? step.base : null;
    const token = base ? sessionToken(base) : null;
    return base && token ? { base: httpBase(base), token } : null;
  });
}

/** Сессия сменилась — такт активности перечитает сервер и токен. */
export function refreshActivity(): void {
  activity?.refresh();
}
