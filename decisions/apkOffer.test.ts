import { describe, expect, it } from 'vitest';
import { apkOfferShown, isAppleMobile } from './apkOffer';

const UA = {
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipadOld:
    'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1',
  // iPadOS 13+ и настоящий Mac приходят с одной строкой — различает их только сенсор.
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
};

const shown = (userAgent: string, maxTouchPoints = 0, insideApk = false) =>
  apkOfferShown({ insideApk, userAgent, maxTouchPoints });

describe('кому предлагать «Скачать APK»', () => {
  it('мобильный браузер Android — да: с телефона APK и качают', () => {
    expect(shown(UA.android, 5)).toBe(true);
  });

  it('ПК-браузер — да, как и раньше (там к кнопке QR для телефона)', () => {
    expect(shown(UA.windows)).toBe(true);
    expect(shown(UA.mac)).toBe(true);
  });

  it('ВНУТРИ APK — нет: игра уже установлена, обновления приносит баннер', () => {
    expect(shown(UA.android, 5, true)).toBe(false);
  });

  it('iPhone и iPad — нет: iOS не ставит APK', () => {
    expect(shown(UA.iphone, 5)).toBe(false);
    expect(shown(UA.ipadOld, 5)).toBe(false);
  });

  it('iPad, назвавшийся Mac`ом, выдаёт сенсорный экран; настоящий Mac — нет', () => {
    expect(isAppleMobile(UA.mac, 5)).toBe(true);
    expect(isAppleMobile(UA.mac, 0)).toBe(false);
    expect(shown(UA.mac, 5)).toBe(false);
  });

  it('незнакомую систему не прячем: лишняя кнопка дешевле неузнанного Android', () => {
    expect(shown('SomeBrowser/1.0', 5)).toBe(true);
    expect(shown('')).toBe(true);
  });
});
