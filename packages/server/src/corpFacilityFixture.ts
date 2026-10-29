import type { CorpStore } from './store';

/** Test setup through real construction orders, including their deadlines and costs. */
export async function buildFixtureFacility(store: CorpStore, corpId: string, head: string, building: 'warehouse' | 'hall_of_fame'): Promise<number> {
  await store.addInfluence(corpId, 5000);
  let now = 0;
  for (let level = 0; level < (building === 'warehouse' ? 2 : 3); level++) {
    const result = await store.infrastructure(corpId, head, now, { buildingId: 'headquarters', expectedLevel: level });
    if (!result.ok || !result.infrastructure.construction) throw Error('fixture headquarters');
    now = result.infrastructure.construction.completesAt;
  }
  const result = await store.infrastructure(corpId, head, now, { buildingId: building, expectedLevel: 0 });
  if (!result.ok || !result.infrastructure.construction) throw Error('fixture facility');
  now = result.infrastructure.construction.completesAt;
  await store.infrastructure(corpId, head, now);
  return now;
}
