import { test, expect } from '@playwright/test';
import { navigateAppMode, waitForAppReady } from './helpers/app-ready.js';

test.describe('Unified app polish', () => {
    test('first-run loads starter circuit from simulator-default.json', async ({ page }) => {
        await page.goto('/index.html');
        await page.evaluate(() => {
            localStorage.clear();
            sessionStorage.clear();
        });
        await page.reload();
        await navigateAppMode(page, 'solar-design');
        await waitForAppReady(page);

        const itemCount = await page.evaluate(() => globalThis.getSimulatorCircuitItems?.()?.length ?? 0);
        expect(itemCount).toBeGreaterThanOrEqual(3);
    });

    test('canvas edits persist after refresh (autosave)', async ({ page }) => {
        await page.goto('/index.html#/solar/design');
        await waitForAppReady(page);

        const beforeCount = await page.evaluate(() => globalThis.getSimulatorCircuitItems?.()?.length ?? 0);

        await page.evaluate(() => {
            const items = globalThis.getSimulatorCircuitItems?.() || [];
            const maxX = items.reduce((m, i) => Math.max(m, i.x || 0), 0);
            if (typeof globalThis.applySimulatorCircuitImport === 'function') {
                const snapshot = globalThis.getSimulatorProjectSnapshot?.();
                if (snapshot?.circuit) {
                    snapshot.circuit.items = [...items, {
                        id: 'panel-test-autosave',
                        type: 'panel',
                        x: maxX + 120,
                        y: 140,
                        width: 120,
                        height: 80,
                        specs: { wmp: 100, vmp: 18, voc: 22, isc: 6, imp: 5.5, width: 1000, height: 600, cost: 80 },
                        handles: {
                            positive: { id: 'panel-test-autosave-pos', polarity: 'positive', x: 0, y: 40, side: 'left', connectedTo: [] },
                            negative: { id: 'panel-test-autosave-neg', polarity: 'negative', x: 120, y: 40, side: 'right', connectedTo: [] },
                        },
                    }];
                    snapshot.circuit.itemIdCounter = (snapshot.circuit.itemIdCounter || items.length) + 1;
                    globalThis.applySimulatorCircuitImport({
                        schematic: {
                            components: snapshot.circuit.items,
                            connections: snapshot.circuit.connections,
                        },
                        itemIdCounter: snapshot.circuit.itemIdCounter,
                        connectionIdCounter: snapshot.circuit.connectionIdCounter,
                    }, { fitView: false });
                }
            }
            globalThis.flushSimulatorAutosave?.();
        });

        const afterCount = await page.evaluate(() => globalThis.getSimulatorCircuitItems?.()?.length ?? 0);
        expect(afterCount).toBeGreaterThan(beforeCount);

        await page.reload();
        await waitForAppReady(page);

        const reloadedCount = await page.evaluate(() => globalThis.getSimulatorCircuitItems?.()?.length ?? 0);
        expect(reloadedCount).toBe(afterCount);
    });

    test('floating canvas toolbar zoom and undo controls work', async ({ page }) => {
        await page.goto('/index.html#/solar/design');
        await waitForAppReady(page);

        await expect(page.locator('#canvas-toolbar')).toBeVisible();
        await expect(page.locator('#canvasModeBadge')).toHaveText(/Design|Simulate/);

        await page.locator('#zoomInButton').click();
        await page.locator('#zoomFitButton').click();

        await page.locator('#shortcutsHelpButton').click();
        await expect(page.locator('#shortcutsOverlay')).toBeVisible();
        await page.locator('#shortcutsOverlayClose').click();
        await expect(page.locator('#shortcutsOverlay')).toBeHidden();
    });
});
