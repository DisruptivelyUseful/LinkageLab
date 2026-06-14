import { test, expect } from '@playwright/test';
import { navigateAppMode, waitForAppReady } from './helpers/app-ready.js';

test.describe('Cross-mode smoke', () => {
    test('linkage → design → simulate → design → linkage keeps each view functional', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await expect(page.locator('#view-linkage #canvas-webgl')).toBeVisible();

        await navigateAppMode(page, 'solar-design');
        await expect(page.locator('#view-solar #canvas-container svg#canvas')).toBeVisible();
        const designComponents = await page.evaluate(() => globalThis.SolarDesigner?.getItems?.()?.length ?? 0);
        expect(designComponents).toBeGreaterThan(0);

        await navigateAppMode(page, 'solar-simulate');
        await expect(page.locator('#view-solar #playPauseButton')).toBeVisible();
        await expect(page.locator('#view-solar .simulator-native-stage #main-content')).toBeVisible();

        const afterSim = await page.evaluate(() => globalThis.SolarDesigner?.getItems?.()?.length ?? 0);
        expect(afterSim).toBe(designComponents);

        await navigateAppMode(page, 'solar-design');
        await expect(page.locator('#view-solar #canvas-container svg#canvas')).toBeVisible();

        await navigateAppMode(page, 'linkage');
        await expect(page.locator('#view-linkage #canvas-webgl')).toBeVisible();

        const hit = await page.evaluate(() => {
            const el = document.getElementById('canvas-webgl');
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            return document.elementFromPoint(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
            )?.id ?? null;
        });
        expect(hit).toBe('canvas-webgl');
    });

    test('mode toggle buttons are clickable on linkage topbar', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await page.locator('#btn-mode-solar').click({ timeout: 10_000 });
        await expect.poll(async () => page.evaluate(() => globalThis.AppRouter.getCurrentMode())).toBe('solar-design');

        await page.locator('#view-solar [data-app-nav-mode="linkage"]').click({ timeout: 10_000 });
        await expect.poll(async () => page.evaluate(() => globalThis.AppRouter.getCurrentMode())).toBe('linkage');
        await waitForAppReady(page);
    });
});
