import { test, expect } from '@playwright/test';
import { navigateAppMode, waitForAppReady } from './helpers/app-ready.js';

test.describe('App router', () => {
    test('defaults to linkage view on /index.html', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await expect(page.locator('#view-linkage')).toHaveClass(/active/);
        await expect(page.locator('#view-linkage')).not.toHaveAttribute('hidden', '');
        await expect(page.locator('#view-solar')).toBeHidden();

        const hasStateBus = await page.evaluate(
            () => typeof globalThis.AppRouter?.getAppStateBus === 'function',
        );
        expect(hasStateBus).toBe(true);

        const mode = await page.evaluate(() => globalThis.AppRouter.getCurrentMode());
        expect(mode).toBe('linkage');
    });

    test('shared solar canvas loads after the view becomes visible', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await navigateAppMode(page, 'solar-design');

        await page.waitForFunction(() => {
            const container = document.getElementById('canvas-container');
            const svg = document.querySelector('#canvas-container svg#canvas');
            return container
                && svg
                && container.clientWidth > 100
                && container.clientHeight > 100;
        }, { timeout: 15_000 });

        const center = await page.evaluate(() => {
            const container = document.getElementById('canvas-container');
            const svg = document.querySelector('#canvas-container svg#canvas');
            const transform = globalThis.d3.zoomTransform(svg);
            return {
                width: container.clientWidth,
                height: container.clientHeight,
                x: transform.x,
                y: transform.y,
            };
        });

        expect(center.width).toBeGreaterThan(100);
        expect(center.height).toBeGreaterThan(100);
    });

    test('topbar solar button navigates in-app and loads shared canvas', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await navigateAppMode(page, 'solar-design');

        await expect(page.locator('#view-solar')).toHaveClass(/active/);
        await expect(page.locator('#view-solar #canvas-container svg#canvas')).toBeVisible();

        await expect.poll(async () => page.evaluate(() => {
            return typeof globalThis.SolarDesigner !== 'undefined'
                && globalThis.SolarDesigner.isInitialized();
        })).toBe(true);

        const busPanels = await page.evaluate(() => {
            const exp = globalThis.AppRouter.getAppStateBus().linkageExport;
            return exp?.solarPanels?.count ?? 0;
        });
        expect(busPanels).toBeGreaterThan(0);

        await page.locator('#view-solar [data-app-nav-mode="linkage"]').click();
        await expect.poll(async () => page.evaluate(() => globalThis.AppRouter.getCurrentMode())).toBe('linkage');
        await waitForAppReady(page);
    });

    test('simulate mode uses the same canvas with simulation controls', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await navigateAppMode(page, 'solar-design');
        const designCount = await page.evaluate(() => globalThis.SolarDesigner.getItems().length);

        await navigateAppMode(page, 'solar-simulate');
        await expect(page.locator('#view-solar .simulator-native-stage')).toBeVisible({ timeout: 60_000 });
        await expect(page.locator('#view-solar #playPauseButton')).toBeVisible();

        const simCount = await page.evaluate(() => globalThis.SolarDesigner.getItems().length);
        expect(simCount).toBe(designCount);
    });

    test('legacy solar_designer.html redirects to unified app', async ({ page }) => {
        await page.goto('/solar_designer.html?import=linkageLab');
        await page.waitForURL(/index\.html#\/solar\/design/);
        await waitForAppReady(page);
        await expect(page.locator('#view-solar #canvas-container svg#canvas')).toBeVisible();
    });

    test('hash route loads solar canvas and can return to linkage', async ({ page }) => {
        await page.goto('/index.html#/solar/design');
        await waitForAppReady(page);

        await expect(page.locator('#view-solar')).toHaveClass(/active/);
        await expect(page.locator('#view-linkage')).toBeHidden();

        await page.locator('#view-solar [data-app-nav-mode="linkage"]').click();
        await expect.poll(async () => page.evaluate(() => globalThis.AppRouter.getCurrentMode())).toBe('linkage');
        await waitForAppReady(page);

        await expect(page.locator('#view-linkage')).toHaveClass(/active/);
        await expect(page.locator('#view-linkage #canvas-webgl')).toBeVisible();

        const mode = await page.evaluate(() => globalThis.AppRouter.getCurrentMode());
        expect(mode).toBe('linkage');
    });
});
