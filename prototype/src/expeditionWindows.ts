/**
 * Окна экспедиции (REFM-249): торговец, связь с союзником и подсказка первого боя с пиратами.
 *
 * Сами окна — `traderScreen.ts`, `allyScreen.ts` и `pirateIntro.ts`; раздел торговца забега —
 * ядро (`modules/trader.ts`), статус операции союзника — `decisions/allyPanel.ts`. Здесь — то,
 * что раньше стояло в `main.ts` вокруг них: узлы окон, кнопка рельса торговца, привязка
 * торговца к идущему забегу и кадровые такты обоих окон. Окна видны наружу живой привязкой:
 * их открывают карточка ресурса, строка статуса и слой Back. Мир, своё место, имя места и
 * связь с союзником (её кэш — у кадра) модуль получает хуками.
 */
import type { GameState, ModeTrader } from '../../packages/shared-core/src/index';
import { traderOf } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { initAllyScreen } from './allyScreen';
import { battleWindow } from './battleView';
import { note } from './eventFeed';
import { ctx, data } from './game';
import { allyAim, arm, drop } from './interaction';
import { defaultView, focusWorld, jumpTo, pirateIntroRect, world } from './mapCamera';
import { fleetSeen } from './mapFog';
import { pickHome } from './openingView';
import { playerOrder } from './orderPipeline';
import { cardCovers } from './panelSlack';
import { initPirateIntro } from './pirateIntro';
import { getPlatform } from './platform/host';
import { isSectorZeroRun, runInProgress, sectorAttempt } from './sectorRun';
import { initTrader } from './traderScreen';

/** Что окнам экспедиции даёт игра. */
export interface ExpeditionWindowsHost {
  world(): GameState;
  me(): string;
  placeName(id: string): string;
  /** Есть ли связь с союзником сейчас (кэш мира — у кадра). */
  allyLinked(): boolean;
}

/** Сколько экрана вокруг дома занимают его значки — стек флотов, гарнизон, подписи (YAG-7.2). */
const HOME_CLEARANCE_PX = 80;

let game: ExpeditionWindowsHost;
let railTrader: HTMLElement;
export let trader: ReturnType<typeof initTrader>;
export let allyScreen: ReturnType<typeof initAllyScreen>;
export let pirateIntro: ReturnType<typeof initPirateIntro>;

/** Раздел торговца, если он у текущего забега есть. */
export function runTrader(): ModeTrader | undefined {
  const s = game.world();
  return runInProgress() ? traderOf(ctx(s.time, s)) : undefined;
}

/** Кадровый такт торговца: кнопка рельса — пока он есть, окно следит за курсом (он плывёт к
 *  базе) и закрывается само, когда забег кончился. */
export function tickTrader(): void {
  const live = runTrader() !== undefined;
  const shown = live ? '' : 'none';
  if (railTrader.style.display !== shown) railTrader.style.display = shown;
  if (!live) {
    if (trader.isOpen()) trader.close();
    return;
  }
  trader.refresh();
}

/** Кадровый такт окна союзника: связи нет — окно закрыто и прицел снят. */
export function tickAlly(): void {
  if (!game.allyLinked()) {
    if (allyScreen.isOpen()) allyScreen.close();
    drop('allyAim');
    return;
  }
  allyScreen.refresh();
}

/** Где сейчас флот: стоит — у мира, летит — у цели перелёта. */
function fleetAt(fleetId: string | undefined): string | undefined {
  const f = fleetId ? game.world().fleets[fleetId] : undefined;
  return f ? (f.location ?? f.movement?.to) : undefined;
}

export function initExpeditionWindows(host: ExpeditionWindowsHost): void {
  game = host;
  const node = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
  pirateIntro = initPirateIntro({
    root: node('pirate-intro'),
    copy: node('pirate-copy'),
    action: node('pirate-action'),
    close: node('pirate-close'),
    focus: focusWorld,
    openBattle: (id) => battleWindow.open(id),
    // Воронка обучения (`YAG-5.1`): первый бой с пиратами — это и есть обучение забега.
    onStage: (step) => {
      if (isSectorZeroRun())
        getPlatform().analytics.emit('onboarding_step', {
          guide: 'pirates',
          step,
          attempt: sectorAttempt,
        });
    },
    // YAG-7.2: подсказка встаёт после первого хода часов, когда стартовый вид уже выбран. Если
    // она легла на дом (и его флоты рядом), вид пересчитывается — теперь с припуском под ней.
    onFirstShow: () => {
      const home = pickHome(Object.values(game.world().planets), game.me());
      if (home && cardCovers(pirateIntroRect(), world(home.position), HOME_CLEARANCE_PX))
        defaultView();
    },
  });

  // --- торговец экспедиции («живой курс», решение владельца 2026-09-26) ---
  // Рынок основной игры — книга заявок живых игроков, и в забеге его нет; здесь торгуют с самим
  // рынком (`modules/trader.ts`). Открыт торговец, пока идёт забег режима с разделом `trader`:
  // кнопка рельса и карточка ресурса спрашивают `runTrader()`.
  const traderWin = node('trader');
  trader = initTrader({
    root: () => traderWin,
    state: () => game.world(),
    me: () => game.me(),
    ctx: () => {
      const s = game.world();
      return ctx(s.time, s);
    },
    cfg: runTrader,
    order: playerOrder,
  });
  railTrader = node('rail-trader');
  railTrader.addEventListener('click', () => trader.open());

  // --- связь с союзником (глава IV, PVR-7.5) ---
  // Статус операции — тот же план, по которому ходит бот союзника (`decisions/allyPanel.ts`).
  // Вход — чип «⬡ Союзник» в строке статуса: он есть и на ПК, и на телефоне, и появляется
  // только после встречи.
  const allyWin = node('ally');
  allyScreen = initAllyScreen({
    root: () => allyWin,
    state: () => game.world(),
    me: () => game.me(),
    data: () => data,
    targetName: (planet, fleet) => {
      if (planet) return game.placeName(planet);
      const at = fleetAt(fleet);
      return at ? game.placeName(at) : '—';
    },
    arm: (kind) => {
      arm('allyAim', kind);
      note(t('ally.pick', { order: t(`ally.kind.${kind}`) }));
    },
    armed: () => allyAim,
    findFleet: (fleetId) => {
      const at = fleetAt(fleetId);
      if (at) jumpTo(at, 'goto');
    },
    order: playerOrder,
    sees: fleetSeen,
  });
}
