import { RulesetError } from './types';

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/** Stable across JSONB key ordering. Runtime configuration is plain bounded JSON. */
export function canonical(value: unknown): string {
  let nodes = 0;
  const visit = (v: unknown, depth: number): unknown => {
    if (++nodes > 20_000 || depth > 16) throw new RulesetError('E_RULESET_INVALID');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.length <= 16_384) return v;
    if (Array.isArray(v)) return v.map((item) => visit(item, depth + 1));
    if (typeof v !== 'object' || !v || ![null, Object.prototype].includes(Object.getPrototypeOf(v)))
      throw new RulesetError('E_RULESET_INVALID');
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v).sort()) {
      if (FORBIDDEN.has(key)) throw new RulesetError('E_RULESET_INVALID');
      const item = (v as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = visit(item, depth + 1);
    }
    return out;
  };
  const text = JSON.stringify(visit(value, 0));
  if (Buffer.byteLength(text) > 131_072) throw new RulesetError('E_RULESET_INVALID');
  return text;
}

export function jsonClone<T>(value: T): T { return JSON.parse(canonical(value)) as T; }

export function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}
