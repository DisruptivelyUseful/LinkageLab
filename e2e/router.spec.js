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

    test('topbar solar button navigates in-app and loads SolarDesigner', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await page.locator('#btn-mode-solar').click();

        await expect.poll(async () => page.evaluate(() => globalThis.AppRouter.getCurrentMode())).toBe('solar-design');
        await expect(page.locator('#view-solar-design')).toHaveClass(/active/);
        await expect(page.locator('#view-solar-design #solar-canvas')).toBeVisible();

        await expect.poll(async () => page.evaluate(() => {
            return typeof globalThis.SolarDesigner !== 'undefined'
                && globalThis.SolarDesigner.isInitialized();
        })).toBe(true);

        const busPanels = await page.evaluate(() => {
            const exp = globalThis.AppRouter.getAppStateBus().linkageExport;
            return exp?.solarPanels?.count ?? 0;
        });
        expect(busPanels).toBeGreaterThan(0);

        await page.locator('#view-solar-design [data-app-nav-mode="linkage"]').click();
        await expect.poll(async () => page.evaluate(() => globalThis.AppRouter.getCurrentMode())).toBe('linkage');
        await waitForAppReady(page);
    });

    test('simulate button opens in-app simulator with staged circuit', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await page.locator('#btn-mode-solar').click();
        await expect.poll(async () => page.evaluate(() => globalThis.AppRouter.getCurrentMode())).toBe('solar-design');
        await expect.poll(async () => page.evaluate(() => globalThis.SolarDesigner?.isInitialized?.())).toBe(true);

        await page.locator('#btn-solar-simulate').click();
        await expect.poll(async () => page.evaluate(() => globalThis.AppRouter.getCurrentMode())).toBe('solar-simulate');
        await expect(page.locator('#view-solar-simulate .solar-simulator-frame')).toBeVisible();

        const busCircuit = await page.evaluate(() => {
            const data = globalThis.AppRouter.getAppStateBus().circuitData;
            return data?.schematic?.components?.length ?? 0;
        });
        expect(busCircuit).toBeGreaterThan(0);
    });

    test('hash route loads solar designer and can return to linkage', async ({ page }) => {
        await page.goto('/index.html#/solar/design');
        await waitForAppReady(page);

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
