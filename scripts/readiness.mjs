export async function acceptCookies(page) {
  const accept = page.getByRole('button', { name: /^(godkänn alla(?: kakor)?|acceptera alla(?: kakor| cookies)?|accept all(?: cookies)?|tillåt alla(?: kakor)?)$/i });
  const banner = page.locator('[role="dialog"], [id*="cookie" i], [class*="cookie-banner" i], [id*="consent" i]');
  try {
    await accept.first().waitFor({ state: 'visible', timeout: 12_000 });
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    if (await banner.filter({ hasText: /kakor|cookies|samtycke/i }).first().isVisible()) {
      throw new Error('Consent prompt detected, but no known accept-all control was found', { cause: error });
    }
    return;
  }
  await accept.first().click();
  await accept.first().waitFor({ state: 'hidden', timeout: 10_000 });
}

export async function settlePage(page, { maxScrolls = 160, timeout = 120_000 } = {}) {
  const deadline = Date.now() + timeout;
  await page.locator('main').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('main').getByRole('heading', { level: 2 }).first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll('main a[href]').length >= 3
    && document.querySelectorAll('main img').length > 0, null, { timeout: 30_000 });
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  let stable = 0;
  let lastHeight = 0;
  for (let step = 0; step < maxScrolls && Date.now() < deadline; step++) {
    const state = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      bottom: window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2,
    }));
    stable = state.bottom && state.height === lastHeight ? stable + 1 : 0;
    if (stable >= 3) {
      await page.waitForFunction(() => [...document.images].every((image) => {
        const bounds = image.getBoundingClientRect();
        if (!image.checkVisibility() || bounds.right <= 0 || bounds.left >= innerWidth) return true;
        return image.complete && image.naturalWidth > 0;
      }), null, { timeout: 20_000 });
      await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 20_000 });
      const finalHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      if (finalHeight === state.height) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(300);
        return;
      }
      stable = 0;
    }
    lastHeight = state.height;
    await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.75)));
    await page.waitForTimeout(500);
  }
  throw new Error(`Page did not stabilize within ${maxScrolls} scrolls / ${timeout} ms`);
}
