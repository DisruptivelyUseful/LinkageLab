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
            const paths = document.querySelectorAll('#view-solar .wires-layer path.wire');
            return [...paths].filter((path) => Boolean(path.getAttribute('d'))).length;
        }), { timeout: 5000 }).toBeGreaterThan(0);
    });

    test('destroyed controller shows RESET button after circuit import', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await navigateAppMode(page, 'solar-design');
        await page.evaluate(() => {
            const controller = globalThis.getSimulatorCircuitItems?.()?.find((item) => item.type === 'controller');
            if (!controller) throw new Error('No controller on canvas');
            controller.destroyed = true;
            const group = document.querySelector(`[data-item-id="${controller.id}"]`);
            if (group) group.removeAttribute('data-destroyed');
            globalThis.requestSimulatorRender?.();
        });

        await expect.poll(async () => {
            return page.locator('#view-solar .reset-button').count();
        }, { timeout: 10_000 }).toBeGreaterThan(0);
        await expect(page.locator('#view-solar .destroyed-label')).toContainText('DESTROYED');
    });
});
