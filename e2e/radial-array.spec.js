import { test, expect } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.js';
import { installOfflineCdn } from './helpers/offline-cdn.js';

async function openSidebar(page) {
    const sidebar = page.locator('#sidebar');
    if (await sidebar.evaluate((el) => el.classList.contains('collapsed'))) {
        await page.locator('#sidebar-toggle').click({ force: true });
        await expect(sidebar).not.toHaveClass(/collapsed/);
    }
    const group = page.locator('#radial-array-group');
    if (await group.evaluate((el) => el.classList.contains('collapsed'))) {
        await group.locator(':scope > .group-title').click();
        await expect(group).not.toHaveClass(/collapsed/);
    }
}

const beamCount = (page) => page.evaluate(() => globalThis.buildLinkageGeometry({ useCache: false }).beams.length);

test.describe('Radial array', () => {
    test.beforeEach(async ({ page }) => {
        await installOfflineCdn(page);
        await page.goto('/index.html');
        await waitForAppReady(page);
        await openSidebar(page);
    });

    test('enabling the array multiplies the structure and reveals its controls', async ({ page }) => {
        await expect(page.locator('#radial-array-controls')).toBeHidden();
        const before = await beamCount(page);

        await page.locator('#chk-radial-arr-enabled').check();
        await expect.poll(() => page.evaluate(() => globalThis.state.radialArrayEnabled)).toBe(true);
        await expect(page.locator('#radial-array-controls')).toBeVisible();

        // Default: 6 ring copies + centre = 7 structures
        await expect.poll(() => beamCount(page)).toBe(before * 7);
        await expect(page.locator('#radial-array-readout')).toContainText('7 copies');
        await expect(page.locator('#radial-array-readout')).toContainText('(auto)');

        // Ring count and centre toggle drive the copy count
        const count = page.locator('#nb-radial-arr-count');
        await count.fill('3');
        await count.dispatchEvent('change');
        await expect.poll(() => page.evaluate(() => globalThis.state.radialCount)).toBe(3);
        await expect.poll(() => beamCount(page)).toBe(before * 4);

        await page.locator('#chk-radial-arr-center').uncheck();
        await expect.poll(() => page.evaluate(() => globalThis.state.radialCenter)).toBe(false);
        await expect.poll(() => beamCount(page)).toBe(before * 3);

        // Untick auto radius: the manual radius box becomes editable and starts from the auto value
        const radius = page.locator('#nb-radial-arr-radius');
        await expect(radius).toHaveAttribute('readonly', '');
        const autoRadius = await page.evaluate(() => globalThis.state._radialLastAutoRadius);
        expect(autoRadius).toBeGreaterThan(0);
        await page.locator('#chk-radial-arr-auto-radius').uncheck();
        await expect(radius).not.toHaveAttribute('readonly', '');
        await expect.poll(() => page.evaluate(() => globalThis.state.radialRadius)).toBeCloseTo(autoRadius, 3);
        // Typed in the preferred display unit; state and the plan are in inches.
        const radiusIn = await page.evaluate(() => globalThis.unitConverter.displayToImperial(500, 'in'));
        await radius.fill('500');
        await radius.dispatchEvent('change');
        await expect.poll(() => page.evaluate(() => globalThis.state.radialRadius)).toBeCloseTo(radiusIn, 6);
        await expect.poll(() => page.evaluate(() => globalThis.buildLinkageGeometry({ useCache: false }).radialArray.radius)).toBeCloseTo(radiusIn, 6);

        // Fit backs the camera off in proportion to the pattern footprint
        const defaultDist = await page.evaluate(() => globalThis.DEFAULT_CAM_DIST);
        await page.locator('#btn-fit').click();
        await expect.poll(() => page.evaluate(() => globalThis.state.cam.dist)).toBeGreaterThan(defaultDist);

        // Disabling puts everything back
        await page.locator('#chk-radial-arr-enabled').uncheck();
        await expect.poll(() => beamCount(page)).toBe(before);
        await expect(page.locator('#radial-array-controls')).toBeHidden();
        await page.locator('#btn-fit').click();
        await expect.poll(() => page.evaluate(() => globalThis.state.cam.dist)).toBe(defaultDist);
    });

    test('heavy render options are forced off while active and restored afterwards', async ({ page }) => {
        const fullDetail = page.locator('#chk-hw-full-detail');
        const shadows = page.locator('#chk-shadows');
        const physics = page.locator('#chk-collide');

        await fullDetail.check();
        await shadows.check();
        await expect.poll(() => page.evaluate(() => globalThis.state.showHardwareFullDetail)).toBe(true);
        await expect.poll(() => page.evaluate(() => globalThis.state.shadowsEnabled)).toBe(true);

        await page.locator('#chk-radial-arr-enabled').check();
        await expect.poll(() => page.evaluate(() => ({
            full: globalThis.state.showHardwareFullDetail,
            shadows: globalThis.state.shadowsEnabled,
        }))).toEqual({ full: false, shadows: false });
        await expect(fullDetail).toBeDisabled();
        await expect(shadows).toBeDisabled();
        await expect(fullDetail).not.toBeChecked();
        await expect(shadows).not.toBeChecked();
        // Physics Check runs on the single solver structure, so it stays available
        await expect(physics).toBeEnabled();
        await expect(page.locator('#hw-spacing-override-note')).toBeHidden();

        await page.locator('#chk-radial-arr-enabled').uncheck();
        await expect(fullDetail).toBeEnabled();
        await expect(shadows).toBeEnabled();
        await expect.poll(() => page.evaluate(() => ({
            full: globalThis.state.showHardwareFullDetail,
            shadows: globalThis.state.shadowsEnabled,
        }))).toEqual({ full: true, shadows: true });
        await expect(fullDetail).toBeChecked();
        await expect(shadows).toBeChecked();
        await expect(page.locator('#hw-spacing-override-note')).toBeVisible();
    });

    test('vertical structures array into a toroid and the hint says so', async ({ page }) => {
        await page.locator('#sel-orientation').selectOption('vertical');
        await expect(page.locator('#radial-array-mode-hint')).toContainText('toroid');

        const before = await beamCount(page);
        await page.locator('#chk-radial-arr-enabled').check();
        await page.locator('#chk-radial-arr-center').uncheck();
        const count = page.locator('#nb-radial-arr-count');
        await count.fill('8');
        await count.dispatchEvent('change');

        await expect.poll(() => beamCount(page)).toBe(before * 8);
        const plan = await page.evaluate(() => {
            const d = globalThis.buildLinkageGeometry({ useCache: false });
            return { orientation: d.radialArray.orientation, copies: d.radialArray.copyCount,
                     indices: [...new Set(d.beams.map(b => b.arrayIndex))].length };
        });
        expect(plan).toEqual({ orientation: 'vertical', copies: 8, indices: 8 });
        await expect(page.locator('#radial-array-readout')).toContainText('on the toroid');

        await page.locator('#sel-orientation').selectOption('horizontal');
        await expect(page.locator('#radial-array-mode-hint')).toContainText('honeycomb');
    });

    test('radial array settings survive a save / load round trip', async ({ page }) => {
        await page.locator('#chk-radial-arr-enabled').check();
        // Length inputs are shown in the preferred unit system; state is always inches.
        const spacingIn = await page.evaluate(() => globalThis.unitConverter.displayToImperial(12, 'in'));
        const spacing = page.locator('#nb-radial-arr-spacing');
        await spacing.fill('12');
        await spacing.dispatchEvent('change');
        const start = page.locator('#nb-radial-arr-start');
        await start.fill('30');
        await start.dispatchEvent('change');
        await expect.poll(() => page.evaluate(() => globalThis.state.radialSpacing)).toBeCloseTo(spacingIn, 6);

        const restored = await page.evaluate(() => {
            const snapshot = globalThis.getConfigSnapshot();
            globalThis.state.radialArrayEnabled = false;
            globalThis.state.radialSpacing = 0;
            globalThis.state.radialStartAngle = 0;
            globalThis.applyConfig(snapshot, true);
            return {
                saved: snapshot.mode.radialArray,
                enabled: globalThis.state.radialArrayEnabled,
                spacing: globalThis.state.radialSpacing,
                start: globalThis.state.radialStartAngle,
                checkbox: document.getElementById('chk-radial-arr-enabled').checked,
                spacingBox: document.getElementById('nb-radial-arr-spacing').value,
            };
        });
        expect(restored.saved.enabled).toBe(true);
        expect(restored.saved.spacing).toBeCloseTo(spacingIn, 6);
        expect(restored.enabled).toBe(true);
        expect(restored.spacing).toBeCloseTo(spacingIn, 6);
        expect(restored.start).toBe(30);
        expect(restored.checkbox).toBe(true);
        expect(parseFloat(restored.spacingBox)).toBeCloseTo(12, 1);
    });
});
