import { test, expect } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.js';
import { installOfflineCdn } from './helpers/offline-cdn.js';

// GitHub Pages lets browsers reuse files for 10 minutes, so a reload right after
// a deploy can mix old and new ES modules. index.html holds a self-heal that
// re-downloads the app bypassing the HTTP cache and reloads once. The cache
// mechanics need a real caching server (verified by hand); these tests pin the
// trigger and the loop guard. The trigger is the boot-error banner, because a
// stale main.js may not know about the recovery hook.
const STALE_MESSAGE = "LinkageLab failed to start: Failed to load js/linkage/build-steps-anim.js: "
    + "The requested module './scene-render.js' does not provide an export named 'renderFrameOnly'";

async function showBootBanner(page, text) {
    await page.evaluate((message) => {
        document.getElementById('app-root').insertAdjacentHTML(
            'beforeend',
            `<div class="app-boot-error">${message}</div>`,
        );
    }, text);
}

// A reload wipes window globals; the router's hash changes do not.
const markDocument = (page) => page.evaluate(() => { globalThis.__staleCacheMarker = true; });
const documentStillMarked = (page) => page.evaluate(() => globalThis.__staleCacheMarker === true);

test.describe('Stale-cache self-heal', () => {
    test.beforeEach(async ({ page }) => {
        await installOfflineCdn(page);
    });

    test('a mixed-version boot error refreshes the app files and reloads once', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        // The app loads modules as scripts; only the self-heal fetch()es .js files.
        const refetched = [];
        page.on('request', (req) => {
            const { pathname } = new URL(req.url());
            if (req.resourceType() === 'fetch' && pathname.endsWith('.js')) refetched.push(pathname);
        });

        const reloaded = page.waitForEvent('load', { timeout: 60_000 });
        await showBootBanner(page, STALE_MESSAGE);
        await reloaded;
        await waitForAppReady(page);

        await expect(page.locator('.app-boot-error')).toHaveCount(0);
        // The walk reaches modules through import statements, not only what was loaded.
        expect(refetched).toEqual(expect.arrayContaining([
            '/js/app/main.js',
            '/js/linkage/scene-render.js',
            '/js/linkage/build-steps-anim.js',
            '/js/linkage/ui-bindings.js',
            '/js/simulator/runtime-loader.js',
        ]));

        // Loop guard: a second failure within a minute shows the error instead of reloading.
        await markDocument(page);
        await showBootBanner(page, STALE_MESSAGE);
        await page.waitForTimeout(1500);
        expect(await documentStillMarked(page)).toBe(true);
        await expect(page.locator('.app-boot-error')).toHaveCount(1);
    });

    test('an unrelated boot error does not trigger a reload', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await markDocument(page);
        await showBootBanner(page, 'LinkageLab failed to start: Cannot read properties of undefined');
        await page.waitForTimeout(1500);
        expect(await documentStillMarked(page)).toBe(true);
        expect(await page.evaluate(() => sessionStorage.getItem('linkageLab:staleModuleReloadAt'))).toBeNull();
    });
});
