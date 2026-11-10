import { data } from './gameData';
import { selectedBay, type YardDraft, type YardHost } from './shipyard';
import {
  createLoadoutEditor,
  applyLoadoutAction,
  type LoadoutEditorResult,
} from '../../packages/client/src/loadoutEditor';

type FittingHost = Pick<YardHost, 'state' | 'me' | 'note' | 'errText'>;

/** The loadout editor for the draft's hull over `modules` — the core-validated model. */
function editorFor(host: FittingHost, draft: YardDraft, modules: readonly string[]): LoadoutEditorResult {
  const p = host.state().players[host.me()];
  return createLoadoutEditor(draft.hull, data, p?.resources ?? {}, {
    modules: [...modules],
    count: draft.count,
    ownedModules: p?.arsenal ? new Set(p.arsenal.modules) : undefined,
    bonusSlots: p?.arsenal?.slots?.[draft.hull],
    pricing: host.state().pricing,
  });
}

/** Модуль из колонки открытого отсека. В занятом отсеке он меняет надетый и встаёт на его
 *  место; выбранный отсек остаётся открытым для сравнения и замены. Отказ — тот же черновик
 *  и строка отказа у хозяина. */
export function equipModule(host: FittingHost, draft: YardDraft, moduleId: string): YardDraft {
  const res = host.state().players[host.me()]?.resources ?? {};
  const ed = editorFor(host, draft, draft.modules);
  if (!ed.ok) return draft;
  const bay = ed.slots[selectedBay(ed.slots, draft.slot)];
  const cur = bay?.moduleId;
  const swap =
    cur !== undefined && (bay!.type === 'universal' || data.modules[moduleId]?.slot === bay!.type);
  const base = swap ? editorFor(host, draft, draft.modules.filter((id) => id !== cur)) : ed;
  if (!base.ok) return draft;
  const r = applyLoadoutAction({ kind: 'equip', moduleId }, base, data, res);
  if (!r.ok) {
    host.note('✖ ' + host.errText(r.code));
    return draft;
  }
  // Замена встаёт на место снятого: отсеки одного типа заполняются в порядке обвеса
  // (`loadoutBays`), а добавленный в конец модуль ушёл бы в последний отсек.
  const modules = swap ? draft.modules.map((id) => (id === cur ? moduleId : id)) : r.modules;
  const after = editorFor(host, draft, modules);
  const slots = after.ok ? after.slots : [];
  const at = slots.findIndex((sl) => sl.moduleId === moduleId);
  return { ...draft, modules, slot: at >= 0 ? at : undefined, unfit: false };
}

/** Снять модуль: открытым остаётся освободившийся отсек. Отсеки одного типа сдвигаются
 *  (`loadoutBays`), поэтому пустеет последний отсек этого типа, а не тот, где модуль стоял. */
export function unequipModule(host: FittingHost, draft: YardDraft, moduleId: string): YardDraft {
  const res = host.state().players[host.me()]?.resources ?? {};
  const ed = editorFor(host, draft, draft.modules);
  if (!ed.ok) return draft;
  const type = ed.slots.find((sl) => sl.moduleId === moduleId)?.type;
  const r = applyLoadoutAction({ kind: 'unequip', moduleId }, ed, data, res);
  if (!r.ok) {
    host.note('✖ ' + host.errText(r.code));
    return draft;
  }
  const freed = r.slots.findIndex((sl) => !sl.moduleId && sl.type === type);
  return { ...draft, modules: r.modules, slot: freed < 0 ? undefined : freed };
}
