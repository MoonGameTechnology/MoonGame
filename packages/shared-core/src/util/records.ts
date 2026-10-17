/**
 * The entities of a state record (`planets`, `fleets`, `heroes`, …) in its key order —
 * exactly what `Object.values` returns, read through `Object.keys` instead.
 *
 * Why not `Object.values` itself: a record with hundreds of keys lives in V8's dictionary
 * mode, and there `Object.values` is about 2.5× slower than taking the keys and reading
 * each one (measured on FFA-50: 113 µs against 46 µs for 800 planets, 45 µs against 13 µs
 * for 372 fleets). The world step walks these records dozens of times per time span, so the
 * difference was ~10% of a late-game frame. Same keys, same order, same entities: both read
 * the own enumerable string keys in property order.
 */
export function recordValues<T>(record: Readonly<Record<string, T>>): T[] {
  const keys = Object.keys(record);
  const out = new Array<T>(keys.length);
  for (let i = 0; i < keys.length; i++) out[i] = record[keys[i]!]!;
  return out;
}
