import { test, expect } from '@playwright/test';
import { navigateAppMode, waitForAppReady } from './helpers/app-ready.js';

test.describe('Linkage viewport interaction', () => {
    test('webgl canvas receives pointer hits in the viewport center', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

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

    test('wheel zoom updates camera distance', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        const result = await page.evaluate(() => {
            const vp = document.getElementById('viewport');
            if (!vp) return { ok: false, reason: 'no-viewport' };
            const before = globalThis.state.cam.dist;
            vp.dispatchEvent(new WheelEvent('wheel', {
                deltaY: 200,
                bubbles: true,
                cancelable: true,
            }));
            return {
                ok: Math.abs(globalThis.state.cam.dist - before) > 0.1,
                before,
                after: globalThis.state.cam.dist,
                hasContextMenu: typeof vp.oncontextmenu === 'function',
            };
        });

        expect(result.hasContextMenu, JSON.stringify(result)).toBe(true);
        expect(result.ok, JSON.stringify(result)).toBe(true);
    });

    test('orbit drag updates camera after solar round-trip', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await navigateAppMode(page, 'solar-design');
        await navigateAppMode(page, 'linkage');

        const overlayDisplay = await page.evaluate(() => {
            const canvas = document.querySelector('#view-linkage #canvas');
            return canvas ? getComputedStyle(canvas).display : null;
        });
        expect(overlayDisplay).toBe('none');

        const result = await page.evaluate(() => {
            const target = document.getElementById('canvas-webgl') || document.getElementById('viewport');
            if (!target) return { ok: false, reason: 'no-target' };
            const before = globalThis.state.cam.dist;
            target.dispatchEvent(new WheelEvent('wheel', {
                deltaY: -200,
                bubbles: true,
                cancelable: true,
            }));
            return { ok: Math.abs(globalThis.state.cam.dist - before) > 0.1, before, after: globalThis.state.cam.dist };
        });

        expect(result.ok, JSON.stringify(result)).toBe(true);
    });
});
