import { chromium } from 'playwright';
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, stageRun, withArchiveLock } from './archive.mjs';
import { renderGallery } from './build-gallery.mjs';
import { acceptCookies, settlePage } from './readiness.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

async function main() {
  await withArchiveLock(root, async () => {
    const pages = await readJson(path.join(root, 'config/pages.json'));
    const startedAt = new Date().toISOString();
    const browser = await chromium.launch({ headless: true });
    try {
      const run = await stageRun({
        root, pages, startedAt, render: renderGallery,
        capture: async ({ page: source, layout, image, thumbnail }) => {
          const { id, ...options } = layout;
          const context = await browser.newContext({ ...options, locale: 'sv-SE', timezoneId: 'Europe/Stockholm',
            colorScheme: 'light', reducedMotion: 'reduce' });
          try {
            const page = await context.newPage();
            page.setDefaultTimeout(30_000);
            const response = await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
            if (!response?.ok()) throw new Error(`Navigation failed: ${response?.status()} ${source.url}`);
            if (new URL(page.url()).pathname.replace(/\/$/, '') !== new URL(source.url).pathname) {
              throw new Error(`Unexpected redirect: ${source.url} -> ${page.url()}`);
            }
            await acceptCookies(page);
            await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }' });
            await settlePage(page);
            const capturedAt = new Date().toISOString();
            const png = await page.screenshot({ type: 'png', fullPage: true, animations: 'disabled', timeout: 60_000 });
            const metadata = await sharp(png).metadata();
            if (metadata.width > 16383 || metadata.height > 16383) {
              throw new Error(`WebP supports at most 16383 pixels per dimension; captured ${metadata.width}x${metadata.height} for ${source.id}/${id}. Archive unchanged.`);
            }
            const { width, height } = await sharp(png).webp({ quality: 90, effort: 5 }).toFile(image);
            const small = await sharp(png).resize({ width: id === 'desktop' ? 720 : 360, height: 840,
              fit: 'cover', position: 'top', withoutEnlargement: true }).webp({ quality: 75 }).toFile(thumbnail);
            return { capturedAt, width, height, thumbnailWidth: small.width, thumbnailHeight: small.height };
          } finally {
            await context.close();
          }
        },
      });
      console.log(`Published complete run ${run.id}: ${run.captures.length} captures`);
    } finally {
      await browser.close();
    }
  });
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
