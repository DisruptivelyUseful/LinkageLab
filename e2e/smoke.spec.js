import { test, expect } from '@playwright/test';
import { BUILD_ID_PATTERN, waitForAppReady } from './helpers/app-ready.js';

test.describe('LinkageLab smoke', () => {
    test('bootstraps modules and renders the workspace', async ({ page }) => {
        const consoleLogs = [];
        page.on('console', (msg) => consoleLogs.push(msg.text()));

        await page.goto('/index.html');

        await waitForAppReady(page);

        await expect(page.locator('#canvas-webgl')).toBeVisible();
        await expect(page.locator('#sidebar')).toBeVisible();
        await expect(page.locator('#controls')).toBeVisible();
        await expect(page.locator('#sel-orientation')).toBeVisible();

        const buildLog = consoleLogs.find((line) => line.includes('LinkageLab build:'));
        expect(buildLog).toBeTruthy();
        expect(buildLog).toMatch(BUILD_ID_PATTERN);

        const threeLog = consoleLogs.find((line) => line.includes('Three.js loaded successfully'));
        expect(threeLog).toBeTruthy();
    });

    test('exposes core globals for runtime integration', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        const globals = await page.evaluate(() => ({
            moduleCount: Object.keys(globalThis.LinkageModules || {}).length,
            hasState: !!globalThis.state,
            hasSolver: typeof globalThis.solveLinkage === 'function',
            hasUnitConverter: !!globalThis.unitConverter,
            buildId: globalThis.LINKAGE_BUILD_ID,
        }));

        expect(globals.moduleCount).toBeGreaterThan(20);
        expect(globals.hasState).toBe(true);
        expect(globals.hasSolver).toBe(true);
        expect(globals.hasUnitConverter).toBe(true);
        expect(globals.buildId).toMatch(BUILD_ID_PATTERN);
    });

    test('sidebar toggle and module input respond', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        const modulesBefore = await page.evaluate(() => globalThis.state.modules);

        const sidebar = page.locator('#sidebar');
        if (await sidebar.evaluate((el) => el.classList.contains('collapsed'))) {
            await page.locator('#sidebar-toggle').click({ force: true });
            await expect(sidebar).not.toHaveClass(/collapsed/);
        }

        const moduleInput = page.locator('#nb-mod');
        await moduleInput.scrollIntoViewIfNeeded();
        await moduleInput.fill('10');
        await moduleInput.dispatchEvent('change');

        const modulesAfter = await page.evaluate(() => globalThis.state.modules);
        expect(modulesAfter).toBe(10);
        expect(modulesAfter).not.toBe(modulesBefore);
    });
});
