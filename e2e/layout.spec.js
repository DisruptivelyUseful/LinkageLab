import { test, expect } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.js';
import { installOfflineCdn } from './helpers/offline-cdn.js';

/** Audit the top bar: no button text overflow, no overlapping controls, nothing outside the bar. */
async function auditTopbar(page) {
    return page.evaluate(() => {
        const bar = document.getElementById('topbar');
        const els = [...bar.querySelectorAll('button, input, select, label, h1, span.topbar-deg')]
            .filter((e) => e.offsetParent !== null && !e.closest('.number-spin-buttons'));
        const boxes = els.map((e) => ({ id: e.id || e.className, r: e.getBoundingClientRect(), sw: e.scrollWidth, cw: e.clientWidth, tag: e.tagName }));
        const overflow = boxes.filter((b) => b.tag === 'BUTTON' && b.sw > b.cw + 1).map((b) => b.id);
        const overlaps = [];
        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
                const a = boxes[i].r, b = boxes[j].r;
                const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (ox > 2 && oy > 2) overlaps.push(`${boxes[i].id} x ${boxes[j].id}`);
            }
        }
        const barR = bar.getBoundingClientRect();
        const outside = boxes
            .filter((b) => b.r.left < barR.left - 1 || b.r.right > barR.right + 1 || b.r.top < barR.top - 1 || b.r.bottom > barR.bottom + 1)
            .map((b) => b.id);
        const nb = document.getElementById('nb-fold');
        return { barH: barR.height, overflow, overlaps, outside, foldVisible: nb.scrollWidth <= nb.clientWidth + 1 };
    });
}

test.describe('Linkage layout', () => {
    test.beforeEach(async ({ page }) => {
        await installOfflineCdn(page);
    });

    for (const [w, h] of [[1366, 768], [1536, 864], [1920, 1080]]) {
        test(`top bar fits on one row at ${w}x${h}`, async ({ page }) => {
            await page.setViewportSize({ width: w, height: h });
            await page.goto('/index.html');
            await waitForAppReady(page);
            await page.waitForTimeout(300);

            const audit = await auditTopbar(page);
            expect(audit.overflow, 'button text overflows its box').toEqual([]);
            expect(audit.overlaps, 'top bar controls overlap').toEqual([]);
            expect(audit.outside, 'controls outside the bar').toEqual([]);
            expect(audit.foldVisible, 'fold angle value is clipped').toBe(true);
            expect(audit.barH).toBe(52);

            const vp = await page.evaluate(() => {
                const r = document.getElementById('viewport').getBoundingClientRect();
                return { left: r.left, right: r.right, top: r.top, rightPanel: !!document.getElementById('right-panel') };
            });
            expect(vp.rightPanel).toBe(false);
            expect(vp.right).toBe(w);
            expect(vp.top).toBe(52);
            expect(vp.left).toBe(340);
        });
    }

    test('bill of materials drawer opens, updates and closes', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        const drawer = page.locator('#bom-drawer');
        await expect(drawer).not.toHaveClass(/open/);
        await page.locator('#btn-bom-toggle').click();
        await expect(drawer).toHaveClass(/open/);
        await expect(page.locator('#bom-total')).not.toHaveText(/^0?(\.00)?$/);

        // Wheel over the drawer must not zoom the camera
        const before = await page.evaluate(() => globalThis.state.cam.dist);
        const box = await drawer.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, 300);
        await page.waitForTimeout(100);
        expect(await page.evaluate(() => globalThis.state.cam.dist)).toBe(before);

        await page.keyboard.press('Escape');
        await expect(drawer).not.toHaveClass(/open/);
    });

    test('sidebar collapses and the actuator analysis group is gone', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        await expect(page.locator('#btn-analyze-actuators')).toHaveCount(0);
        await expect(page.locator('#sidebar-footer #btn-undo')).toBeVisible();

        await page.locator('#sidebar-toggle').click({ force: true });
        await expect(page.locator('#sidebar')).toHaveClass(/collapsed/);
        await expect.poll(() => page.evaluate(() => document.getElementById('viewport').getBoundingClientRect().left)).toBe(0);
        await page.locator('#sidebar-toggle').click({ force: true });
        await expect.poll(() => page.evaluate(() => document.getElementById('viewport').getBoundingClientRect().left)).toBe(340);
    });

    test('number boxes commit on blur, not while typing', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);
        await page.evaluate(() => {
            globalThis.unitConverter.setPreferredUnitSystem('imperial');
            globalThis.unitConverter.applyUnitSystemToUI();
            Object.keys(globalThis.idMap).forEach((k) => globalThis.syncUI(globalThis.idMap[k]));
        });

        const before = await page.evaluate(() => globalThis.state.hLengthFt);
        const input = page.locator('#nb-len');
        await input.click({ clickCount: 3 });
        await page.keyboard.type('12.35', { delay: 30 });
        await expect(input).toHaveValue('12.35');
        expect(await page.evaluate(() => globalThis.state.hLengthFt)).toBe(before);

        await page.keyboard.press('Tab');
        await expect.poll(() => page.evaluate(() => globalThis.state.hLengthFt)).toBe(12.35);
        await expect(input).toHaveValue('12.35');

        // Below-minimum text is left alone while typing and clamped only on commit
        const mod = page.locator('#nb-mod');
        await mod.click({ clickCount: 3 });
        await page.keyboard.type('1');
        await expect(mod).toHaveValue('1');
        await page.keyboard.press('Enter');
        await expect.poll(() => page.evaluate(() => globalThis.state.modules)).toBe(3);
        await expect(mod).toHaveValue('3');
    });
});
