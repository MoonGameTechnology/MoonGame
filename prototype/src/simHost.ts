/**
 * Хозяин мира в отдельном потоке: принимает запросы экрана (`SimRequest`), ведёт соло-мир
 * (`soloSim.ts`) и после каждого шага и приказа отвечает разностью к копии экрана.
 * Без `self` и `postMessage` — их подставляет вход потока (`simWorker.ts`), поэтому хозяин
 * проверяется тестом прямо в процессе.
 *
 * Разность считается от того, что экран уже получил, а не от мира до шага: приказ между
 * шагами тоже меняет мир, и копия экрана должна узнать о нём той же разностью.
 */
import { serializeSoloSave } from '../../decisions/soloSave';
import { diffState, shareRoadNetwork, type GameState } from '../../packages/shared-core/src/index';
import { approvalLedger } from './botFavour';
import { setMatchMode } from './protoKernel';
import { createSoloSim, type SoloSim } from './soloSim';
import { screenView, type SimReply, type SimRequest } from './simProtocol';

export function createSimHost(post: (reply: SimReply) => void): (request: SimRequest) => void {
  let sim: SoloSim | null = null;
  let me = '';
  /** Копия экрана, какой её сделала последняя отправленная разность. */
  let shown: GameState | null = null;

  const sync = (reply: Omit<Extract<SimReply, { kind: 'sync' }>, 'kind' | 'delta'>): void => {
    const next = screenView(sim!.state(), me);
    post({ kind: 'sync', delta: diffState(shown!, next), ...reply });
    shown = next;
  };

  return (request) => {
    try {
      if (request.kind === 'init') {
        setMatchMode(request.modeId);
        // Мир пришёл копией и потерял метку общей сети дорог (ROADS-7): без неё каждый ход
        // мира копировал бы всю сеть заново.
        shareRoadNetwork(request.state.planets);
        sim = createSoloSim(request.state, request.me);
        me = request.me;
        shown = screenView(request.state, me);
        return;
      }
      if (!sim) throw new Error('E_SIM_NOT_READY');
      if (request.kind === 'step') {
        const t0 = performance.now();
        const out = sim.step(
          request.target,
          request.drivers,
          new Map(request.ai),
          new Set(request.autoAssault),
        );
        sync({
          events: out.events,
          driverOrders: out.driverOrders,
          orders: [],
          stepped: true,
          ms: performance.now() - t0,
        });
      } else if (request.kind === 'order') {
        const out = sim.order(request.action);
        const outcome = out.error ? { id: request.id, error: out.error } : { id: request.id };
        sync({ events: [], driverOrders: [], orders: [outcome], stepped: false, ms: 0 });
      } else if (request.kind === 'save') {
        // Строку слота собирает поток: на карте в 1675 провинций это сотни мс, и кадр стоял
        // их каждые 15 с. Мир — свой, полный (память тумана всех мест). Кончившуюся партию
        // слот не пишет — его сотрёт экран, увидев конец.
        const state = sim.state();
        let raw: string | null = null;
        if (state.match.status !== 'ended') {
          try {
            raw = serializeSoloSave({ state, ...request.host }, request.rules);
          } catch {
            // Слот остаётся прежним, как при сбое записи в кадре; мир потока цел.
          }
        }
        post({ kind: 'saved', id: request.id, raw });
      } else {
        const state = sim.state();
        post({
          kind: 'full',
          fog: state.fog,
          swarmIntel: state.swarmIntel,
          approval: approvalLedger(state),
        });
      }
    } catch (error) {
      sim = null;
      post({ kind: 'fail', message: error instanceof Error ? error.message : String(error) });
    }
  };
}
