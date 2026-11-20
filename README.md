# SR page snapshots

A one-shot Node.js tool and public static gallery for full-page Sveriges Radio screenshots. No server, scheduler, or frontend framework.

[Open the gallery](https://karlerikjonatan.github.io/sr-page-snapshots/).

Each manual run captures these pages in order:

1. [Poddar](https://www.sverigesradio.se/poddar)
2. [Barn](https://www.sverigesradio.se/barn)
3. [Barn 3-8 år](https://www.sverigesradio.se/barn/3-8-ar)
4. [Barn 9-13 år](https://www.sverigesradio.se/barn/9-13-ar)

Desktop uses Chromium at 1440 × 900. Mobile uses Chromium at 390 × 844 with mobile and touch emulation, not Safari. Both use a scale factor of 1, Swedish locale, Stockholm timezone and light mode. Each page/layout gets a clean browser context.

## Setup and local usage

Requires Node.js 26 LTS and npm. Install locked dependencies and Chromium:

```sh
npm ci
npx playwright install --with-deps chromium
npm test
npm run capture
```

`npm run capture` captures all pages and rebuilds `docs/index.html`. `npm run build` only validates the archive and rebuilds the HTML. Open `docs/index.html` directly or serve `docs` using any static HTTP server. All asset links are relative, including when hosted under a repository Pages subpath.

Use **View capture history** next to a page to browse its desktop and mobile captures, newest first. Scroll sideways to browse and select a thumbnail to open the full image. The history view reads the capture manifest, so serve `docs` over HTTP to use it locally.

## Capture behavior and archive

The tool accepts **all** cookies when a recognized consent prompt appears. It waits for the main content, a section heading, content links and images, disables animation, incrementally scrolls without clicking "show more", waits for on-page images and fonts, and requires stable page height before returning to the top. Images outside the horizontal viewport in carousels are not required because they are not rendered in the screenshot. Loading, consent, navigation and stabilization failures stop the run; timeouts and scroll counts are bounded.

Screenshots are captured as full-page PNG buffers and encoded to WebP at quality 90. Thumbnails are separate, top-cropped WebP previews of at most 720 × 840 pixels (360 × 840 for mobile); full-image links always open the complete screenshot. WebP's hard maximum is 16,383 pixels in either dimension. A page exceeding that limit fails explicitly rather than silently truncating or reducing the full image.

All captures in a run share a UTC filename such as `2026-11-20T08-00-00.000Z.webp`. The manifest also records each actual capture time, source URL, viewport/emulation settings and image dimensions:

```text
config/pages.json
scripts/capture.mjs
scripts/build-gallery.mjs
docs/captures.json
docs/index.html
docs/styles.css
docs/screenshots/<page>/<desktop|mobile>/<UTC timestamp>.webp
docs/thumbnails/<page>/<desktop|mobile>/<UTC timestamp>.webp
```

The manifest snapshots each run's page configuration so later configuration changes do not alter historical runs. The gallery orders runs newest first and preserves configured page order within each run.

All page/layout captures must succeed. Work is staged outside `docs`, validated and rendered before replacing the archive; capture failures leave the previous manifest, images and site untouched. A local exclusive `.capture.lock` prevents concurrent writers. Timestamp or filename collisions fail rather than overwrite. Run only on a clean worktree before committing all of `docs` together.

After an abrupt process or machine termination, inspect `.capture.lock` and `.capture-*` directories before removing them. Ensure no capture process is running. If an interrupted directory swap left `docs` absent, restore the `previous` directory from the matching staging directory first. Never remove the only copy of an archive.

## Manual GitHub Actions and Pages

In repository **Settings → Pages**, choose **GitHub Actions** as the build source. Allow Actions to write repository contents; branch rules must permit the workflow bot's archive commit. The repository and deployed screenshots are public. The `github-pages` environment must allow the default branch and any required deployment approval.

After the implementation and lockfile are on the default branch, open **Actions → Capture and publish → Run workflow**, select the default branch and run it. `workflow_dispatch` is the only trigger: there are no scheduled, push, or pull-request runs.

To publish the committed gallery without taking new screenshots, run **Actions → Publish existing gallery** on the default branch.

The workflow uses Node 26, `npm ci`, Chromium system dependencies and the focused tests. It captures and renders all eight images, commits all of `docs` in one commit, pushes without force, then uploads `docs` and deploys using the official Pages actions. A serialized workflow group prevents capture workflows racing. If an unrelated push races with the commit, the non-fast-forward push fails and no deployment occurs; rerun from the latest default branch.

Capture uses only contents-write permission; the separate deployment job uses pages-write and id-token-write. It does not rely on a bot commit triggering another workflow.

If capture or tests fail, inspect the logs and rerun after fixing the cause; no partial archive is committed or deployed. If deployment fails after the archive commit, the prior published site remains available. Use **Re-run failed jobs** to retry only deployment without capturing again. The Pages artifact is retained for 30 days; after expiry a new manual capture is needed. If upload fails after commit, that complete run is still in Git, but a full rerun creates another complete run.

## Adding pages

Append an entry to `config/pages.json` with a unique lowercase kebab-case `id`, readable `title`, and HTTPS `url` on `www.sverigesradio.se`. Inspect both layouts and the actual accept-all cookie control when updating selectors in `scripts/readiness.mjs`. Each configured page adds two required captures per run.

## Retention and capacity

Successful captures are retained indefinitely: there is no automatic pruning. This is a retention policy, **not infinite hosting capacity**. Binary images grow the Git history permanently; deleting current files does not shrink history. Monitor repository size, GitHub Pages published-site size and bandwidth limits, Actions artifact limits and workflow duration. Consult [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) and [repository limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits) before the archive outgrows this small-repository design. Changing storage or retention requires an explicit future decision.
