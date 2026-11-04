import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { localOnlyCleartext, NETWORK_SECURITY_XML } from './network-security.mjs';

it('preserves the installed sideload origin and storage namespace', () => {
  const config = JSON.parse(readFileSync(new URL('./capacitor.config.json', import.meta.url)));
  expect(config.server.androidScheme).toBe('http');
  expect(config.server.cleartext).toBe(false);
});

it('wires the real Android policy and overrides an unrestricted template idempotently', () => {
  const input =
    '<manifest><application android:usesCleartextTraffic="true"><activity /></application></manifest>';
  const patched = localOnlyCleartext(input);
  expect(patched).toContain('android:networkSecurityConfig="@xml/void_network_security"');
  expect(patched).toContain('android:usesCleartextTraffic="false"');
  expect(patched).toContain('<activity />');
  expect(localOnlyCleartext(patched)).toBe(patched);
  expect(localOnlyCleartext('<manifest><application /></manifest>')).toContain(
    'android:usesCleartextTraffic="false"',
  );
});

it('allows only the exact local asset host and disables cleartext by default', () => {
  expect(NETWORK_SECURITY_XML).toContain('<base-config cleartextTrafficPermitted="false" />');
  expect(NETWORK_SECURITY_XML.match(/<domain(?:\s|>)/g)).toHaveLength(1);
  expect(NETWORK_SECURITY_XML).toContain('<domain includeSubdomains="false">localhost</domain>');
});

it('fails rather than silently replacing an unknown policy or a malformed manifest', () => {
  expect(() =>
    localOnlyCleartext('<application android:networkSecurityConfig="@xml/other" />'),
  ).toThrow('E_ANDROID_NETWORK_POLICY');
  expect(() => localOnlyCleartext('<manifest />')).toThrow('E_ANDROID_APPLICATION');
  expect(() => localOnlyCleartext('<application /><application />')).toThrow(
    'E_ANDROID_APPLICATION',
  );
});

it('runs in both sideload builds through their existing updater preparation step', () => {
  const patch = readFileSync(new URL('./patch-updater.mjs', import.meta.url), 'utf8');
  expect(patch).toContain('localOnlyCleartext(read(manifestPath))');
  expect(patch).toContain("here('./android/app/src/main/res/xml/void_network_security.xml')");
});
