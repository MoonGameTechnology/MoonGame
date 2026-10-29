import type { MaterialLot } from '@void/protocol';

/** Reserve only earned, unbound stock. Provenance survives every split and transfer. */
export function reserveMaterials(
  materials: MaterialLot[],
  materialId: string,
  quantity: number,
  listingId: string,
): MaterialLot[] | undefined {
  const eligible = materials.filter(
    (lot) =>
      lot.materialId === materialId &&
      !lot.soulbound &&
      lot.source !== 'commerce' &&
      lot.source !== 'ad',
  );
  if (eligible.reduce((sum, lot) => sum + lot.quantity, 0) < quantity) return undefined;
  const reserved: MaterialLot[] = [];
  let remaining = quantity;
  for (const lot of eligible) {
    if (!remaining) break;
    const taken = Math.min(lot.quantity, remaining);
    reserved.push({ ...lot, lotId: `${listingId}:${reserved.length}`, quantity: taken });
    lot.quantity -= taken;
    remaining -= taken;
  }
  return reserved;
}
