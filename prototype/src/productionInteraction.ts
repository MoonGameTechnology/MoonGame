import {
  act,
  cancelHeroMobilization,
  spawnHero,
  buildBuilding,
  upgradeBuilding,
  repairBuilding,
} from '../../decisions/actions';
import type { YardHost, YardTab } from './shipyard';
import type { BuildCategory } from './buildScreen';
import { data } from './gameData';

interface Navigation {
  planet: string;
  repaint(): void;
  open(tab: YardTab, building?: string): void;
  category(value: BuildCategory | null): void;
}
/** Shared workspace actions; the host still sends every mutation through the existing gate. */
export function productionClick(tg: HTMLElement, host: YardHost, nav: Navigation): boolean {
  const income = tg.closest<HTMLElement>('[data-pw-income]')?.dataset.pwIncome;
  if (income) { host.openInfo?.(`income:${income}`, income); return true; }
  const cancel = tg.closest<HTMLElement>('[data-pw-cancel]')?.dataset.pwCancel;
  const resume = tg.closest<HTMLElement>('[data-pw-resume]')?.dataset.pwResume;
  const cancelHero = tg.closest<HTMLElement>('[data-pw-hero-cancel]')?.dataset.pwHeroCancel;
  if (cancel || resume || cancelHero) {
    host.order(
      cancelHero
        ? cancelHeroMobilization(host.me(), cancelHero)
        : cancel
          ? act(host.me(), 'construction.cancel', { planetId: nav.planet, seq: Number(cancel) })
          : act(host.me(), 'construction.resume', { planetId: nav.planet, id: Number(resume) }),
    );
    nav.repaint();
    return true;
  }
  const spawn = tg.closest<HTMLElement>('[data-hspawn]')?.dataset.hspawn;
  if (spawn && nav.planet) {
    const hero = host.state().heroes?.[spawn];
    const specialTarget = (hero?.abilities ?? []).some(id => {
      const type = id ? data.heroAbilities[id]?.type : undefined;
      return type === 'spawn_fleet' || type === 'spawn_allied';
    });
    if (specialTarget) return false; // heroStaff arms the existing map target picker.
    host.order(spawnHero(host.me(), spawn, nav.planet));
    nav.repaint();
    return true;
  }
  const info = tg.closest<HTMLElement>('[data-pw-info]')?.dataset.pwInfo;
  if (info) {
    const [kind, id] = info.split(':');
    host.openInfo?.(`${kind === 'unit' ? 'u' : 'b'}:${id}`, nav.planet);
    return true;
  }
  const tech = tg.closest<HTMLElement>('[data-pw-tech],[data-bw-tech]');
  if (tech) {
    host.openTech?.(tech.dataset.pwTech ?? tech.dataset.bwTech!);
    return true;
  }
  const target = tg.closest<HTMLElement>('[data-pw-building]');
  if (target?.dataset.pwBuilding) {
    nav.open('buildings', target.dataset.pwBuilding);
    return true;
  }
  const cat = tg.closest<HTMLElement>('[data-bwtab]')?.dataset.bwtab;
  if (cat) {
    nav.category(cat === '*' ? null : (cat as BuildCategory));
    nav.repaint();
    return true;
  }
  const building = tg.closest<HTMLElement>('[data-bw-go],[data-bw-up],[data-bw-repair]');
  if (building && nav.planet) {
    const d = building.dataset;
    host.order(
      d.bwGo
        ? buildBuilding(host.me(), nav.planet, d.bwGo)
        : d.bwUp
          ? upgradeBuilding(host.me(), nav.planet, d.bwUp)
          : repairBuilding(host.me(), nav.planet, d.bwRepair!, d.uid || undefined),
    );
    nav.repaint();
    return true;
  }
  return false;
}
