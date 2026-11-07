import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeSettings } from './setup-agent-tools.mjs';

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true });
});
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-settings-'));
  temporary.push(dir);
  return join(dir, 'config.json');
}

describe('agent tool settings installation', () => {
  it('preserves unrelated preferences and a recoverable original; reruns are idempotent', () => {
    const file = fixture();
    const original = '{"theme":"custom","auto_trigger":true}\n';
    writeFileSync(file, original);
    mergeSettings(file, { auto_trigger: false, auditor: 'none' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      theme: 'custom',
      auto_trigger: false,
      auditor: 'none',
    });
    const files = readdirSync(temporary[0]!);
    const saved = files.find((name) => name.endsWith('.bak'))!;
    expect(readFileSync(join(temporary[0]!, saved), 'utf8')).toBe(original);
    mergeSettings(file, { auto_trigger: false, auditor: 'none' });
    expect(readdirSync(temporary[0]!)).toEqual(files);
  });

  it.each(['{broken', '[]', 'null'])(
    'never replaces malformed/non-object settings: %s',
    (original) => {
      const file = fixture();
      writeFileSync(file, original);
      expect(() => mergeSettings(file, { defaultMode: 'full' })).toThrow();
      expect(readFileSync(file, 'utf8')).toBe(original);
      expect(readdirSync(temporary[0]!)).toEqual(['config.json']);
    },
  );
});
