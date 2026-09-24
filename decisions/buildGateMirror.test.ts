/**
 * СТОРОЖ ЗЕРКАЛА: ворота стройки клиента обязаны сходиться с НАСТОЯЩИМ редьюсером.
 *
 * `buildGate.ts` не переписывает правила — он зовёт `isBuildable`/`allowedBuildings`
 * ядра и читает `onlyOn` из того же каталога. Но ПОРЯДОК вопросов он всё-таки
 * повторяет, а повторённое правило расходится молча: ровно так `sectorAllowsBuilding`
 * прототипа и разъехался с данными (ORB-4) — рукописный список `BUILDABLE` знал
 * 11 зданий из 20, и кнопка молчала там, где сервер приказ принимал.
 *
 * Поэтому проверка не «покрыть случаи», а ПЕРЕБОР: каждая пара (вид × здание) всего
 * шипнутого каталога разыгрывается через `building.construct` — и ответ решения обязан
 * совпасть с ответом кернела. Новый вид провинции или новое здание попадают сюда сами,
 * их не надо вписывать руками.
 *
 * Почему кернел собран из ОДНОГО модуля стройки: тогда единственные причины отказа —
 * те три, что решение и моделирует. Казна нарочно бездонная, узел свежий и свой, так
 * что ни `E_INSUFFICIENT`, ни `E_ALREADY_BUILT` ответ не подменят.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKernel } from '../packages/shared-core/src/kernel/kernel';
import { constructionModule } from '../packages/shared-core/src/modules/construction';
import { composeGameDataBundle } from '../packages/shared-core/src/data/loadGameData';
import { parseGameData, type GameData } from '../packages/shared-core/src/index';
import {
  createInitialState,
  type GameState,
  type Planet,
  type Player,
} from '../packages/shared-core/src/state/gameState';
import type { Action } from '../packages/shared-core/src/action/types';
import { buildsAnything, canBuildHere } from './buildGate';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(repoRoot, 'data');
const data: GameData = parseGameData(
  composeGameDataBundle((name) => JSON.parse(readFileSync(path.join(dataDir, name), 'utf8'))),
);

const kernel = createKernel([constructionModule]);
const CATALOGUE = Object.keys(data.buildings);

/** Строитель — не Рой (`x`) или Рой (`swarm`): органы Роя строит только второй. */
function world(kind?: string, faction = 'x'): GameState {
  const base = createInitialState({ seed: 'mig10', version: { data: '0.1.0', manifest: '1' } });
  const player: Player = {
    id: 'p1',
    name: 'p1',
    faction,
    status: 'active',
    resources: Object.fromEntries(data.resources.map((r) => [r, 1_000_000])),
  };
  const node: Planet = {
    id: 'N',
    owner: 'p1',
    position: { x: 0, y: 0 },
    ...(kind === undefined ? {} : { kind }),
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
  return { ...base, players: { p1: player }, planets: { N: node } };
}

/** Что РЕДЬЮСЕР пускает на узел этого вида. */
function reducerHosts(kind?: string, faction = 'x'): string[] {
  const state = world(kind, faction);
  return CATALOGUE.filter((building) => {
    const action: Action = {
      id: `a:${kind ?? '-'}:${building}`,
      type: 'building.construct',
      playerId: 'p1',
      payload: { planetId: 'N', building },
      issuedAt: 0,
    };
    return kernel.applyAction(state, action, { now: 0, data }).ok;
  });
}

/** Что пускает РЕШЕНИЕ. */
function decisionHosts(kind?: string, eatsBiomass = false): string[] {
  return CATALOGUE.filter((building) => canBuildHere({ kind }, building, data, eatsBiomass));
}

describe('buildGate — ответ решения и ответ building.construct совпадают (MIG-10)', () => {
  it('каталог и список видов не пусты — иначе перебор ничего не доказывает', () => {
    expect(CATALOGUE.length).toBeGreaterThan(0);
    expect(Object.keys(data.sectorKinds).length).toBeGreaterThan(0);
  });

  for (const kind of Object.keys(data.sectorKinds)) {
    it(`${kind}: те же здания, что у редьюсера`, () => {
      expect(decisionHosts(kind)).toEqual(reducerHosts(kind));
    });
    // Органы Роя (решение владельца 2026-09-24): у Роя ответ свой, и он тоже обязан сойтись.
    it(`${kind}: у Роя — те же здания, что у редьюсера`, () => {
      expect(decisionHosts(kind, true)).toEqual(reducerHosts(kind, 'swarm'));
    });
  }

  // Мягкая деградация — правило ядра, а не частный случай: вид без записи в данных и
  // узел вовсе без вида обязаны вести себя одинаково у обеих сторон, иначе старые
  // сценарии (у их узлов вида нет) увидят у клиента не то, что примет сервер.
  it('узел без вида: те же здания, что у редьюсера', () => {
    expect(decisionHosts(undefined)).toEqual(reducerHosts(undefined));
  });

  it('незнакомый вид: те же здания, что у редьюсера', () => {
    expect(decisionHosts('no_such_kind')).toEqual(reducerHosts('no_such_kind'));
  });

  it('«есть ли тут вообще стройка» — тот же перебор, что у редьюсера', () => {
    for (const kind of [...Object.keys(data.sectorKinds), undefined, 'no_such_kind']) {
      expect(buildsAnything({ kind }, data, false), `вид ${kind ?? '(нет)'}`).toBe(
        reducerHosts(kind).length > 0,
      );
    }
  });
});
