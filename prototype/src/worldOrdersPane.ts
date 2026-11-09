/**
 * Приказы мира в окне «Построить» (UIX-10.12): сделать столицей, точка удержания, точка
 * сбора новых кораблей, космическая крепость. Раньше они стояли в окне «i» мира, и окна
 * дублировали друг друга; теперь «i» только сообщает, а распоряжения миром живут рядом с
 * его стройкой. ЧТО предлагать, решают те же чистые правила, что и прежде
 * (`decisions/worldOrders.ts`, `rallyPoint.ts`, `fortressRaise.ts`), здесь только кнопки.
 *
 * Кнопки несут `data-wo` (приказ), `data-arg` и `data-pid` (мир): окно производства выбирает
 * мир своим списком, и приказ обязан уйти выбранному там миру, а не выделенному на карте.
 */
import type { GameState } from '../../packages/shared-core/src/index';
import {
  capitalOf,
  hasShipyard,
  isForkSite,
  isInhabited,
  MAX_STEWARD_HOLD_POINTS,
  rallyPointOf,
  stationSiteId,
} from '../../packages/shared-core/src/index';
import { t, tData } from '../../localization/runtime';
import { fortressRaise } from '../../decisions/fortressRaise';
import { rallyOffer } from '../../decisions/rallyPoint';
import { capitalOffer, holdOffer } from '../../decisions/worldOrders';
import { esc, resLine } from './format';
import { data } from './gameData';
import { ctx } from './game';
import { worldName } from './planetName';
import { stewardTechDone } from './stewardScreen';

function orderButton(
  act: string,
  arg: string,
  pid: string,
  label: string,
  ok = true,
  extra = '',
  style = 'btn-second',
): string {
  return (
    `<button class="b ${style}" data-wo="${esc(act)}" data-arg="${esc(arg)}" data-pid="${esc(pid)}"${ok ? '' : ' disabled'}>` +
    `${esc(label)}${extra}</button>`
  );
}

/** Ряд приказов выбранного мира; приказов нет — пусто. */
export function worldOrdersHtml(s: GameState, me: string, pid: string): string {
  const p = s.planets[pid];
  if (!p || p.owner !== me) return '';
  const out: string[] = [];
  // Столица — здесь возрождаются герои и меняют модули (Phase C).
  if (
    capitalOffer(
      true,
      capitalOf(s, me) === pid,
      isInhabited(data, p),
      !!ctx(s.time, s).config?.victory?.capitalCapture,
    ) === 'designate'
  )
    out.push(orderButton('capital', '', pid, t('side.world.make-capital')));
  // Точка удержания (ST-2.1): лимит гасит кнопку, но снять точку можно всегда.
  const points = s.players[me]?.stewardHoldPoints ?? [];
  const hold = holdOffer(
    true,
    stewardTechDone(s, me),
    points.includes(pid),
    points.length,
    MAX_STEWARD_HOLD_POINTS,
    !isForkSite(p),
  );
  if (hold === 'clear')
    out.push(orderButton('holdpoint', 'off', pid, `🚩 ${t('side.world.hold.clear')}`));
  else if (hold !== 'none')
    out.push(orderButton('holdpoint', 'on', pid, t('side.world.hold.set'), hold === 'set'));
  // RALLY-1: куда сами летят корабли, построенные здесь.
  const to = rallyPointOf(s, me, pid);
  const rally = rallyOffer(true, hasShipyard(p, data), to !== null);
  if (rally === 'change' && to) {
    out.push(
      `<span class="pfact cyan">${esc(t('side.world.rally.to', { w: worldName(s, to) }))}</span>` +
        orderButton('rally', 'pick', pid, t('side.world.rally.change')) +
        orderButton('rally', 'off', pid, t('side.world.rally.clear')),
    );
  } else if (rally !== 'none') {
    out.push(
      orderButton('rally', 'pick', pid, `${t('side.world.rally')}: ${t('side.world.rally.set')}`),
    );
  }
  // FORT-0.2: космическая крепость при мире — открыть её или возвести.
  const attached = s.planets[stationSiteId(pid)];
  if (attached?.fortress)
    out.push(orderButton('openstation', attached.id, pid, `◈ ${t('fortress.open')}`));
  const fortress = fortressRaise(
    p,
    me,
    s.players[me]?.resources ?? {},
    data,
    s.players[me]?.technologies?.completed ?? [],
    s,
  );
  if (fortress.show) {
    // Цена — фишками `resLine` (разметка со значками), поэтому вне `esc`.
    out.push(
      orderButton(
        'fortress',
        '',
        pid,
        `◈ ${t('side.fortress.raise')}`,
        fortress.enabled,
        ` <span class="dim">${resLine(fortress.cost)}</span>`,
      ),
    );
    if (fortress.blocked === 'tech') {
      const names = fortress.needs
        .map((id) => `«${tData(data.technologies[id]?.name ?? id)}»`)
        .join(t('side.fortress.or'));
      out.push(
        `<span class="fort-why">${esc(t('side.fortress.needs-tech', { tech: names }))}</span>` +
          orderButton(
            'opentech',
            fortress.needs[0] ?? '',
            pid,
            `⚗ ${t('side.fortress.to-tech')}`,
            true,
            '',
            'btn-quiet',
          ),
      );
    }
  }
  return out.length ? `<div class="pw-orders">${out.join('')}</div>` : '';
}
