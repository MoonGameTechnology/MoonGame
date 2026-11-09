// Мины и крылатые ракеты в замере self-play (BAL-6, missiles-roadmap). Попадание и
// сбитие у обоих одним событием (`rocketMine.hit` / `.intercepted`) с флагом `mine`, и
// пока счётчик был общий, залпы бота читались бы как работа мин. Промах (`missile.missed`)
// флага не несёт: самонаводятся и мина с запасом дальности, и ракета.
export const ORDNANCE_KEYS = [
  'missileHits',
  'missileDamage',
  'missilesDowned',
  'cruiseLaunched',
  'cruiseHits',
  'cruiseDamage',
  'cruiseDowned',
  'ordnanceMissed',
];

export const ordnanceTally = () => Object.fromEntries(ORDNANCE_KEYS.map((k) => [k, 0]));

/** Учесть событие; true — оно про мины или ракеты и учтено. */
export function countOrdnance(t, e) {
  const p = e.payload ?? {};
  const cruise = p.mine === false;
  if (e.type === 'rocketMine.hit') {
    t[cruise ? 'cruiseHits' : 'missileHits'] += 1;
    t[cruise ? 'cruiseDamage' : 'missileDamage'] += p.damage ?? 0;
  } else if (e.type === 'rocketMine.intercepted') t[cruise ? 'cruiseDowned' : 'missilesDowned'] += 1;
  else if (e.type === 'missile.launched') t.cruiseLaunched += 1;
  else if (e.type === 'missile.missed') t.ordnanceMissed += 1;
  else return false;
  return true;
}

export function addOrdnance(total, t) {
  for (const k of ORDNANCE_KEYS) total[k] += t[k];
}

export const cruiseLine = (t) =>
  `  ракеты     : пущено ${t.cruiseLaunched} · попаданий ${t.cruiseHits} на ${t.cruiseDamage.toFixed(0)} урона · сбито ПВО ${t.cruiseDowned} · мимо (с минами) ${t.ordnanceMissed}  ← крылатые ракеты бота; 0 пусков при построенных = ракеты лежат в ангаре`;
