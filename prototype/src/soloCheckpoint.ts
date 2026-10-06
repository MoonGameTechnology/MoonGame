/**
 * Сохранение схватки — у одного владельца (REFM-213): слот обычной одиночной партии, его
 * такт записи, пауза на уходе со страницы, «Продолжить» в хабе и вопрос о замене сохранения.
 *
 * Флаг {@link soloSaveActive} жил `let`'ом в `main.ts`, и писал его не только слот: установка
 * любой партии и вход в сеть гасили его своими строками, а старт схватки включал по своему
 * условию. Теперь его меняют только функции ниже — старт схватки зовёт {@link enterSolo},
 * установка партии и вход в сеть зовут {@link leaveSolo}, — а `main.ts` читает флаг как
 * живую привязку (`export let`), присвоить мимо владельца не даст компилятор.
 *
 * Мир, снимок политик хоста (боты, темп, авто-штурм, память разведки), установка партии и
 * экраны живут в `main.ts`; модуль получает их хуками {@link initSoloCheckpoint} — импорт
 * оттуда был бы циклом.
 */
import { t } from '../../localization/runtime';
import { hashJson, type GameState } from '../../packages/shared-core/src/index';
import { hubDoor } from '../../decisions/hubDoor';
import { parseSoloSave, serializeSoloSave, type SoloSave } from '../../decisions/soloSave';
import { gameDay } from './format';
import { data } from './game';
import { mapNodesFromState, mapPreset } from './mapCatalog';
import { kernel as soloKernel } from './protoKernel';
import { soloSaveStore } from './soloSaveLocal';

/** Что слоту нужно от игры. Мир, темп, установка партии и экраны живут в `main.ts`. */
export interface SoloCheckpointHost {
  /** Мир на экране. */
  world(): GameState;
  /** Идёт сетевая партия: её мир хранит сервер, а не слот. */
  net(): boolean;
  /** Партия песочницы (дев-сборка) — слот её не пишет. */
  practice(): boolean;
  /** Партия на экране, а не меню. */
  inMatch(): boolean;
  /** Снимок партии вместе с политиками хоста. */
  snapshot(): SoloSave;
  /** Остановить мир: пауза на уходе со страницы. */
  halt(): void;
  /** Поставить партию из слота: выйти из сети, установить мир и политики, темп на паузе. */
  install(save: SoloSave): void;
  /** Закрыть меню и экраны, из которых нажали «Продолжить». */
  show(): void;
  /** Новая схватка по экрану настройки — после согласия заменить сохранение. */
  startNew(): void;
  /** Новичок: главная дверь хаба ведёт в обучение. */
  newcomer(): boolean;
  /** Подпись карты на двери «Продолжить». */
  mapLabel(mapId: string): string;
  note(text: string): void;
}

let game: SoloCheckpointHost;

const $ = (id: string) => document.getElementById(id) as HTMLElement;

// The normal skirmish slot is independent of Sector Zero and the tutorial.
const soloStore = soloSaveStore();
const soloRules = hashJson({ data, modules: soloKernel.manifest });
export let soloSaveActive = false;
let soloSavedAtReal = 0;
let soloSaveFailed = false;

/** Поднять слот: хуки игры и кнопки окна замены. Зовётся из `main.ts` один раз. */
export function initSoloCheckpoint(host: SoloCheckpointHost): void {
  game = host;
  $('solo-replace-cancel').addEventListener('click', closeSoloReplace);
  $('solo-replace-confirm').addEventListener('click', () => {
    closeSoloReplace();
    game.startNew();
  });
}

/** Старт схватки: слот пишет её, если партия сохраняемая, не сетевая и не песочница. */
export function enterSolo(persist: boolean): void {
  soloSaveActive = persist && !game.net() && !game.practice();
  saveSolo();
}
/** Уход со схватки (установка любой партии, вход в сеть): последняя запись — и слот закрыт. */
export function leaveSolo(): void {
  saveSolo();
  soloSaveActive = false;
}

export function saveSolo(explicit = false): void {
  if (!soloSaveActive || game.net() || game.world().pve || game.practice()) return;
  const s = game.world();
  let ok = false;
  try {
    ok =
      s.match.status === 'ended'
        ? soloStore.clear()
        : soloStore.save(serializeSoloSave(game.snapshot(), soloRules));
  } catch {
    /* Serialization/storage failure leaves the previous checkpoint intact. */
  }
  if (!ok && (!soloSaveFailed || explicit)) game.note(t('solo.save.failed'));
  if (ok && explicit) game.note(t('solo.save.saved'));
  soloSaveFailed = !ok;
  if (s.match.status === 'ended' && ok) soloSaveActive = false;
}
export function suspendSolo(): void {
  if (!soloSaveActive || game.net()) return;
  saveSolo();
  game.halt();
}
export function tickSoloSave(now: number): void {
  if (!soloSaveActive || !game.inMatch()) return;
  if (game.world().match.status === 'ended') {
    saveSolo();
    return;
  }
  if (now - soloSavedAtReal < 15000) return;
  soloSavedAtReal = now;
  saveSolo();
}
/**
 * Главная дверь хаба (UIX-10.1): «Продолжить» с картой и днём сохранённой партии или, новичку
 * (ONB-0), «Начать обучение» — какая из двух, решает `decisions/hubDoor.ts`. Строка под
 * дверью — только беда со слотом: не сохранилось или сохранение не читается.
 */
export function refreshHubDoor(): void {
  const stored = soloStore.load();
  const save = stored.ok ? parseSoloSave(stored.raw, soloRules) : null;
  const door = hubDoor(
    // Сохранение без карты — «Нексус»: так его читает и `mapPreset` при загрузке.
    save
      ? { mapId: save.state.mapId ?? 'nexus', time: save.state.time }
      : stored.ok && stored.raw === null
        ? 'empty'
        : 'unreadable',
    game.newcomer(),
  );
  const button = $('hub-solo-continue') as HTMLButtonElement;
  button.hidden = door.kind !== 'continue' && door.kind !== 'broken';
  button.disabled = door.kind !== 'continue';
  $('hub-continue-sub').textContent =
    door.kind === 'continue'
      ? t('solo.save.continue.sub', { map: game.mapLabel(door.mapId), day: gameDay(door.time) })
      : '';
  $('onboard-nudge').style.display = door.kind === 'tutorial' ? 'flex' : 'none';
  $('solo-save-status').textContent =
    !stored.ok || soloSaveFailed
      ? t('solo.save.failed')
      : door.kind === 'broken'
        ? t('solo.save.invalid')
        : '';
}
/** Слот занят или не читается — спросить, заменить ли сохранение. `true` — окно открыто. */
export function askReplace(): boolean {
  const stored = soloStore.load();
  if (stored.ok && stored.raw === null) return false;
  $('solo-replace').style.display = 'flex';
  $('solo-replace-cancel').focus({ preventScroll: true });
  return true;
}
export function closeSoloReplace(): void {
  $('solo-replace').style.display = 'none';
  $('setupgo').focus({ preventScroll: true });
}
export function restoreSolo(): void {
  if (game.net()) return;
  const stored = soloStore.load();
  const save = stored.ok ? parseSoloSave(stored.raw, soloRules) : null;
  if (!save) {
    refreshHubDoor();
    return;
  }
  // Verify the map before replacing the in-memory match; future maps need an
  // explicit migration, not an accidental fallback to another board.
  try {
    mapPreset(save.state.mapId);
    mapNodesFromState(save.state);
  } catch {
    $('solo-save-status').textContent = t('solo.save.invalid');
    return;
  }
  soloSaveActive = false; // installMatch must not overwrite the checkpoint being read
  game.install(save);
  soloSaveActive = true;
  soloSaveFailed = false;
  game.show();
  game.note(t('solo.save.restored'));
}
