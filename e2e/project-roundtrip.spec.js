import { test, expect } from '@playwright/test';
import { navigateAppMode, waitForAppReady } from './helpers/app-ready.js';

test.describe('Unified project document (Phase 12–13)', () => {
    test('saveProject persists circuit across design ↔ simulate hops', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await navigateAppMode(page, 'solar-design');

        const before = await page.evaluate(() => ({
            items: globalThis.SolarDesigner.getItems().length,
            connections: globalThis.SolarDesigner.getConnections().length,
        }));
        expect(before.items).toBeGreaterThan(0);
        expect(before.connections).toBeGreaterThan(0);

        await page.evaluate(() => globalThis.saveProject());

        const saved = await page.evaluate(() => {
            const raw = localStorage.getItem('linkageLabProject');
            const doc = raw ? JSON.parse(raw) : null;
            return {
                itemCount: doc?.circuit?.items?.length ?? 0,
                connCount: doc?.circuit?.connections?.length ?? 0,
                schemaVersion: doc?.schemaVersion ?? null,
            };
        });
        expect(saved.schemaVersion).toBe(4);
        expect(saved.itemCount).toBe(before.items);
        expect(saved.connCount).toBe(before.connections);

        await navigateAppMode(page, 'solar-simulate');
        await navigateAppMode(page, 'solar-design');

        const after = await page.evaluate(() => {
            const raw = localStorage.getItem('linkageLabProject');
            const doc = raw ? JSON.parse(raw) : null;
            return {
                items: globalThis.SolarDesigner.getItems().length,
                storedItems: doc?.circuit?.items?.length ?? 0,
                storedConnections: doc?.circuit?.connections?.length ?? 0,
                schemaVersion: doc?.schemaVersion ?? null,
            };
        });

        expect(after.schemaVersion).toBe(4);
        expect(after.storedItems).toBe(before.items);
        expect(after.storedConnections).toBe(before.connections);
        expect(after.items).toBeGreaterThanOrEqual(before.items);
    });

    test('linkage round-trip preserves designer panel positions', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await navigateAppMode(page, 'linkage');
        await navigateAppMode(page, 'solar-design');

        await expect.poll(async () => page.evaluate(() => {
            return globalThis.SolarDesigner.getItems().filter((item) => item.type === 'panel').length;
        }), { timeout: 15_000 }).toBeGreaterThan(1);

        const before = await page.evaluate(() => {
            return globalThis.SolarDesigner.getItems()
                .filter((item) => item.type === 'panel')
                .map((item) => ({ id: item.id, x: item.x, y: item.y }));
        });
        expect(before.length).toBeGreaterThan(0);

        await navigateAppMode(page, 'linkage');
        await navigateAppMode(page, 'solar-design');

        const after = await page.evaluate(() => {
            return globalThis.SolarDesigner.getItems()
                .filter((item) => item.type === 'panel')
                .map((item) => ({ id: item.id, x: item.x, y: item.y }));
        });

        expect(after).toHaveLength(before.length);
        before.forEach((panel) => {
            const match = after.find((item) => item.id === panel.id);
            expect(match).toBeTruthy();
            expect(match.x).toBeCloseTo(panel.x, 0);
            expect(match.y).toBeCloseTo(panel.y, 0);
        });
    });

    test('simulator wires use polarity colors after design handoff', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await navigateAppMode(page, 'solar-design');
        await navigateAppMode(page, 'solar-simulate');

        await expect.poll(async () => page.evaluate(() => {
            const paths = [...document.querySelectorAll('#view-solar .wires-layer path.wire')];
            return paths.length;
        }), { timeout: 10_000 }).toBeGreaterThan(0);

        await expect.poll(async () => page.evaluate(() => {
            const paths = [...document.querySelectorAll('#view-solar .wires-layer path.wire')];
            return paths.some((path) => {
                const cls = path.getAttribute('class') || '';
                const stroke = path.getAttribute('style') || '';
                return cls.includes('positive')
                    || cls.includes('negative')
                    || stroke.includes('rgb')
                    || stroke.includes('#');
            });
        }), { timeout: 10_000 }).toBe(true);
    });

    test('wires stay visible after design → simulate → design → simulate', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await navigateAppMode(page, 'solar-design');
        const designConnections = await page.evaluate(() => globalThis.SolarDesigner.getConnections().length);
        expect(designConnections).toBeGreaterThan(0);

        await navigateAppMode(page, 'solar-simulate');
        await navigateAppMode(page, 'solar-design');
        await navigateAppMode(page, 'solar-simulate');

        await expect.poll(async () => page.evaluate(() => {
            const paths = document.querySelectorAll('#view-solar .wires-layer path.wire');
            return [...paths].filter((path) => Boolean(path.getAttribute('d'))).length;
        }), { timeout: 10_000 }).toBeGreaterThan(0);
    });

    test('panel handles stay aligned with wire endpoints after design ↔ simulate hops', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await navigateAppMode(page, 'solar-design');

        const before = await page.evaluate(() => {
            const panels = globalThis.SolarDesigner.getItems().filter((item) => item.type === 'panel');
            const connections = globalThis.SolarDesigner.getConnections();
            return { panels, connections };
        });
        expect(before.panels.length).toBeGreaterThan(0);
        expect(before.connections.length).toBeGreaterThan(0);

        await navigateAppMode(page, 'solar-simulate');
        await navigateAppMode(page, 'solar-design');

        const misaligned = await page.evaluate(() => {
            const items = globalThis.SolarDesigner.getItems();
            const connections = globalThis.SolarDesigner.getConnections();

            const resolveHandle = (item, conn, role) => {
                const keyField = role === 'source' ? 'sourceHandleKey' : 'targetHandleKey';
                const altField = role === 'source' ? 'sourceHandle' : 'targetHandle';
                const key = conn[keyField] || conn[altField];
                return key ? item.handles?.[key] : null;
            };

            let count = 0;
            for (const conn of connections) {
                const sourceItem = items.find((item) => item.id === conn.sourceItemId);
                const targetItem = items.find((item) => item.id === conn.targetItemId);
                if (!sourceItem || !targetItem) continue;

                const sourceHandle = resolveHandle(sourceItem, conn, 'source');
                const targetHandle = resolveHandle(targetItem, conn, 'target');
                if (!sourceHandle || !targetHandle) continue;

                const sx = sourceItem.x + sourceHandle.x;
                const sy = sourceItem.y + sourceHandle.y;
                const tx = targetItem.x + targetHandle.x;
                const ty = targetItem.y + targetHandle.y;

                const path = document.querySelector(`#view-solar .wire-group[data-connection-id="${conn.id}"] path.wire`);
                if (!path) continue;
                const d = path.getAttribute('d') || '';
                const nums = d.match(/-?\d+\.?\d*/g)?.map(Number) || [];
                if (nums.length < 4) continue;

                const startX = nums[0];
                const startY = nums[1];
                const endX = nums[nums.length - 2];
                const endY = nums[nums.length - 1];

                if (Math.hypot(startX - sx, startY - sy) > 8 || Math.hypot(endX - tx, endY - ty) > 8) {
                    count += 1;
                }
            }
            return count;
        });

        expect(misaligned).toBe(0);
    });

    test('design and simulate share the same component and connection counts after round-trip', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await navigateAppMode(page, 'solar-design');
        await navigateAppMode(page, 'solar-simulate');

        const simCounts = await page.evaluate(() => ({
            items: globalThis.getSimulatorProjectSnapshot?.().circuit?.items?.length ?? 0,
            connections: globalThis.getSimulatorProjectSnapshot?.().circuit?.connections?.length ?? 0,
        }));
        expect(simCounts.items).toBeGreaterThan(0);
        expect(simCounts.connections).toBeGreaterThan(0);

        await navigateAppMode(page, 'solar-design');

        const designCounts = await page.evaluate(() => ({
            items: globalThis.SolarDesigner.getItems().length,
            connections: globalThis.SolarDesigner.getConnections().length,
            unresolved: globalThis.SolarDesigner.getConnections().filter((conn) => {
                const items = globalThis.SolarDesigner.getItems();
                const source = items.find((item) => item.id === conn.sourceItemId);
                const target = items.find((item) => item.id === conn.targetItemId);
                const sourceKey = conn.sourceHandleKey || conn.sourceHandle;
                const targetKey = conn.targetHandleKey || conn.targetHandle;
                return !source?.handles?.[sourceKey] || !target?.handles?.[targetKey];
            }).length,
        }));

        expect(designCounts.items).toBe(simCounts.items);
        expect(designCounts.connections).toBe(simCounts.connections);
        expect(designCounts.unresolved).toBe(0);
    });

    test('legacy solar_simulator.html redirects to unified simulate route', async ({ page }) => {
        await page.goto('/solar_simulator.html?import=solarDesigner');
        await page.waitForURL(/index\.html.*#\/solar\/simulate/);
        await page.waitForFunction(() => globalThis.AppRouter?.getCurrentMode?.() === 'solar-simulate');
        await expect(page.locator('#view-solar')).toHaveClass(/active/);
    });
});
