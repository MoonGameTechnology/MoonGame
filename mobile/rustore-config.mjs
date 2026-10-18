import { createHash } from 'node:crypto';
export function validateRelease(config, now = Date.now()) {
  const fail = () => { throw Error('E_RUSTORE_RELEASE_CONFIG'); };
  if (config?.commerceMode !== 'disabled') fail();
  if (!config || !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){2,}$/.test(config.appId ?? '') ||
      ['com.voiddominion.prototype', 'com.voiddominion.player'].includes(config.appId)) fail();
  if (!Number.isSafeInteger(config.versionCode) || config.versionCode <= 0 || config.versionCode > 2100000000 ||
      !Number.isSafeInteger(config.previousVersionCode) || config.previousVersionCode < 0 || config.versionCode <= config.previousVersionCode ||
      !/^[0-9][0-9A-Za-z.-]{0,39}$/.test(config.versionName ?? '')) fail();
  for (const key of ['server', 'privacyUrl']) {
    let url; try { url = new URL(config[key]); } catch { fail(); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) fail();
    if (key === 'server' && url.pathname !== '/') fail();
  }
  if (new URL(config.server).origin !== new URL(config.privacyUrl).origin) fail();
  for (const key of ['policySha256', 'certificateSha256', 'privacyEvidenceSha256', 'erasureRestoreDrillSha256'])
    if (!/^[a-f0-9]{64}$/.test(config[key] ?? '')) fail();
  const reviewed = Date.parse(config.reviewedAt);
  if (!Number.isFinite(reviewed) || now < reviewed || now - reviewed > 30 * 86400000 ||
      typeof config.approvedBy !== 'string' || !config.approvedBy.trim() || /TODO|TBD|example|заполн/i.test(config.approvedBy)) fail();
  return config;
}
export function policyDocument(text, expectedHash) {
  if (Buffer.byteLength(text) > 128 * 1024 || text.length < 500 || !/[а-яё]{3}/i.test(text) ||
      /\bTODO\b|\bTBD\b|НЕ ПУБЛИКОВАТЬ|\[ЗАПОЛНИТЬ(?:\]|:)/i.test(text) || createHash('sha256').update(text).digest('hex') !== expectedHash)
    throw Error('E_RUSTORE_POLICY');
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Политика конфиденциальности</title><style>body{max-width:50rem;margin:2rem auto;padding:1rem}pre{white-space:pre-wrap;font:1rem/1.6 system-ui}</style></head><body><pre>${escaped}</pre></body></html>`;
}

/** Verify the exact inert document, including the reviewed text, after APK packaging. */
export function verifyPolicyDocument(html, expectedHash) {
  const encoded = html.match(/<pre>([\s\S]*)<\/pre>/)?.[1];
  if (encoded === undefined) throw Error('E_RUSTORE_POLICY_ASSET');
  const text = encoded.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  if (policyDocument(text, expectedHash) !== html) throw Error('E_RUSTORE_POLICY_ASSET');
}

/** AndroidX Core declares this package-local signature permission to protect
 * non-exported dynamic receivers on older Android versions. Never allow a
 * similarly named foreign permission or a weakened protectionLevel. */
export function verifyPermissions(permissions, manifest, appId) {
  const internal = `${appId}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`;
  const allowed = ['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE', internal];
  if (!permissions.includes('android.permission.INTERNET') || permissions.some(p => !allowed.includes(p)))
    throw Error('E_RUSTORE_PERMISSIONS');
  const declarations = manifest.split(/(?=^\s*E: )/m).filter(block => /^\s*E: permission(?:\s|$)/m.test(block));
  if (declarations.length > 1 || (permissions.includes(internal) && declarations.length !== 1) ||
      declarations.some(block => block.match(/^\s*A: android:name(?:\([^)]*\))?="([^"]+)"/m)?.[1] !== internal ||
        !/android:protectionLevel[^\n]*=\(type 0x11\)0x2(?:\s|$)/.test(block)))
    throw Error('E_RUSTORE_PERMISSION_PROTECTION');
}
