/* global window, document, localStorage, HTMLImageElement, requestAnimationFrame -- browser callbacks */
import assert from 'node:assert/strict';

/** Real entry and cancellation while an actual embedded-image decode is pending. */
export async function checkMapLoading(browser, url) {
  for (const phone of [false, true]) {
    const page = await browser.newPage({
      viewport: phone ? { width: 390, height: 844 } : { width: 1920, height: 1080 },
      deviceScaleFactor: phone ? 2 : 1,
      isMobile: phone,
      hasTouch: phone,
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && /frame fail/.test(m.text())) errors.push(m.text());
    });
    await page.addInitScript((phone) => {
      localStorage.setItem('vd.locale', phone ? 'en' : 'ru');
      const decode = HTMLImageElement.prototype.decode;
      const pending = new Promise((resolve) => {
        window.releaseMapImage = resolve;
      });
      HTMLImageElement.prototype.decode = function () {
        return pending.then(() => decode.call(this));
      };
    }, phone);
    await page.goto(url);
    const start = async () => {
      for (const id of ['hub-solo', 'sp-go', 'setupgo']) await page.locator('#' + id).click();
      await page.locator('#maploading').waitFor({ state: 'visible' });
    };
    await page.locator('#cnew').click();
    await start();
    const read = () =>
      page.evaluate(() => ({
        value: document.querySelector('#maploading-progress').value,
        max: document.querySelector('#maploading-progress').max,
        busy: document.querySelector('#map').getAttribute('aria-busy'),
        title: document.querySelector('#maploading-title').textContent,
        quote: document.querySelector('#maploading-quote').textContent,
      }));
    const cold = await read();
    assert.equal(cold.value, 0, 'a pending decode must not invent progress');
    assert.equal(cold.busy, 'true');
    assert.match(cold.title, phone ? /Deploying/ : /Развёртывание/);
    assert(cold.quote.length > 20 && !cold.quote.includes('map-loading.'));
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'maploading-cancel');
    if (phone) {
      await page.setViewportSize({ width: 844, height: 390 });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      assert.equal((await read()).value, 0, 'resize restarts preparation against the new viewport');
    }
    await page.screenshot({ path: `/tmp/void-loading-${phone ? 'phone' : 'desktop'}.png` });
    await page.keyboard.press('Escape');
    await page.locator('#maploading').waitFor({ state: 'hidden' });
    await page.locator('#hub').waitFor({ state: 'visible' });
    assert.equal((await read()).busy, null);
    await start();
    assert.notEqual((await read()).quote, cold.quote, 'new entry chooses the next original quote');
    await page.evaluate(() => window.releaseMapImage());
    await page.locator('#maploading').waitFor({ state: 'hidden' });
    const ready = await read();
    assert.equal(ready.value, ready.max);
    assert.equal(ready.busy, null);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'map');
    // A warm re-entry must finish without another externally released decode.
    await page.evaluate(() => document.querySelector('#tomenu').click());
    for (const id of ['hub-solo', 'sp-go', 'setupgo']) await page.locator('#' + id).click();
    await page.waitForFunction(
      () =>
        document.querySelector('#maploading').style.display === 'none' &&
        document.querySelector('#setup').style.display === 'none',
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('MAP_LOADING_PASS desktop RU / phone EN, decode, resize, cancellation, warm entry');
}
