import { test, expect } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.js';

test.describe('App router', () => {
    test('defaults to linkage view on /index.html', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await expect(page.locator('#view-linkage')).toHaveClass(/active/);
        await expect(page.locator('#view-linkage')).not.toHaveAttribute('hidden', '');
        await expect(page.locator('#view-solar-design')).toBeHidden();

        const hasStateBus = await page.evaluate(
            () => typeof globalThis.AppRouter?.getAppStateBus === 'function',
        );
        expect(hasStateBus).toBe(true);

        const mode = await page.evaluate(() => globalThis.AppRouter.getCurrentMode());
        expect(mode).toBe('linkage');
    });

    test('topbar solar button navigates in-app with staged export', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await page.locator('#btn-mode-solar').click();

        await expect.poll(async () => page.evaluate(() => globalThis.AppRouter.getCurrentMode())).toBe('solar-design');
        await expect(page.locator('#view-solar-design')).toHaveClass(/active/);
        await expect(page.locator('#view-solar-design .app-view-placeholder')).toContainText(/panels staged/i);

        const busPanels = await page.evaluate(() => {
            const exp = globalThis.AppRouter.getAppStateBus().linkageExport;
            return exp?.solarPanels?.count ?? 0;
        });
        expect(busPanels).toBeGreaterThan(0);

        await page.locator('#view-solar-design [data-app-nav-mode="linkage"]').click();
        await expect.poll(async () => page.evaluate(() => globalThis.AppRouter.getCurrentMode())).toBe('linkage');
        await waitForAppReady(page);
    });

    test('hash route shows solar design placeholder and can return to linkage', async ({ page }) => {
        await page.goto('/index.html#/solar/design');
        await expect(page.locator('#view-solar-design .app-view-placeholder')).toContainText('Solar Design');
        await expect(page.locator('#view-solar-design')).toHaveClass(/active/);
        await expect(page.locator('#view-linkage')).toBeHidden();

        await page.locator('#view-solar-design [data-app-nav-mode="linkage"]').click();
        await expect.poll(async () => page.evaluate(() => globalThis.AppRouter.getCurrentMode())).toBe('linkage');
        await waitForAppReady(page);

        await expect(page.locator('#view-linkage')).toHaveClass(/active/);
        await expect(page.locator('#view-linkage #canvas-webgl')).toBeVisible();

        const mode = await page.evaluate(() => globalThis.AppRouter.getCurrentMode());
        expect(mode).toBe('linkage');
    });
});
