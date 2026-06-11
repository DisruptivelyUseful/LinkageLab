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

    test('hash route shows solar design placeholder and can return to linkage', async ({ page }) => {
        await page.goto('/index.html#/solar/design');
        await expect(page.locator('.app-view-placeholder')).toContainText('Solar Design');
        await expect(page.locator('#view-solar-design')).toHaveClass(/active/);
        await expect(page.locator('#view-linkage')).toBeHidden();

        await page.locator('.app-view-placeholder a').click();
        await expect.poll(async () => page.evaluate(() => globalThis.AppRouter.getCurrentMode())).toBe('linkage');
        await waitForAppReady(page);

        await expect(page.locator('#view-linkage')).toHaveClass(/active/);
        await expect(page.locator('#view-linkage #canvas-webgl')).toBeVisible();

        const mode = await page.evaluate(() => globalThis.AppRouter.getCurrentMode());
        expect(mode).toBe('linkage');
    });
});
