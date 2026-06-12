import { test, expect } from '@playwright/test';
import { navigateAppMode, waitForAppReady } from './helpers/app-ready.js';

test.describe('Simulator handoff regressions (Phase 9)', () => {
    test('simulator shows wired paths immediately after design handoff', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await navigateAppMode(page, 'solar-design');
        const designConnections = await page.evaluate(() => globalThis.SolarDesigner.getConnections().length);
        expect(designConnections).toBeGreaterThan(0);

        await navigateAppMode(page, 'solar-simulate');

        await expect.poll(async () => page.evaluate(() => {
            const paths = document.querySelectorAll('#view-solar-simulate .wires-layer path.wire');
            return [...paths].filter((path) => Boolean(path.getAttribute('d'))).length;
        }), { timeout: 5000 }).toBeGreaterThan(0);
    });

    test('destroyed controller shows RESET button after circuit import', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await navigateAppMode(page, 'solar-design');
        await navigateAppMode(page, 'solar-simulate');
        await page.evaluate(() => {
            const bus = globalThis.AppRouter.getAppStateBus();
            const data = JSON.parse(JSON.stringify(bus.circuitData));
            const controller = data.schematic?.components?.find((item) => item.type === 'controller');
            if (!controller) throw new Error('No controller in staged circuit export');
            controller.destroyed = true;
            globalThis.applySimulatorCircuitImport(data);
        });

        await expect(page.locator('#view-solar-simulate .reset-button')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#view-solar-simulate .destroyed-label')).toContainText('DESTROYED');
    });
});
