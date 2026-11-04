/** Keep the existing WebView origin/storage while restricting actual HTTP to localhost. */
export const NETWORK_SECURITY_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">localhost</domain>
    </domain-config>
</network-security-config>
`;

export function localOnlyCleartext(manifest) {
  const applications = [...manifest.matchAll(/<application\b[^>]*>/g)];
  if (applications.length !== 1) throw new Error('E_ANDROID_APPLICATION');
  let tag = applications[0][0];
  const attribute = 'android:networkSecurityConfig="@xml/void_network_security"';
  const existing = tag.match(/android:networkSecurityConfig\s*=\s*(["'])(.*?)\1/);
  if (existing && existing[2] !== '@xml/void_network_security')
    throw new Error('E_ANDROID_NETWORK_POLICY');
  if (!existing) tag = tag.replace('<application', `<application ${attribute}`);
  if (/android:usesCleartextTraffic\s*=/.test(tag)) {
    tag = tag.replace(
      /android:usesCleartextTraffic\s*=\s*(["']).*?\1/,
      'android:usesCleartextTraffic="false"',
    );
  } else tag = tag.replace('<application', '<application android:usesCleartextTraffic="false"');
  return manifest.replace(applications[0][0], tag);
}
