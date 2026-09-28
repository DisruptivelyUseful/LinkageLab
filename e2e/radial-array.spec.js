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

test.describe('Radial array: copies and 3D export', () => {
    test.beforeEach(async ({ page }) => {
        await installOfflineCdn(page);
        await page.goto('/index.html');
        await waitForAppReady(page);
        await openSidebar(page);
    });

    test('the 3D export button opens a visible dialog and exporting downloads a GLB of the whole array', async ({ page }) => {
        await page.locator('#chk-radial-arr-enabled').check();
        const count = page.locator('#nb-radial-arr-count');
        await count.fill('3');
        await count.dispatchEvent('change');
        await expect.poll(() => page.evaluate(() => globalThis.state.radialCount)).toBe(3);

        await page.locator('#btn-export-gltf').click();
        const dialog = page.locator('#gltf-export-modal');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.modal')).toBeInViewport();
        await expect(dialog.getByText('Export 3D Model')).toBeVisible();

        const download = page.waitForEvent('download');
        await dialog.getByRole('button', { name: 'Export', exact: true }).click();
        const file = await download;
        expect(file.suggestedFilename()).toMatch(/^LinkageLab_Export_\d+\.glb$/);
        await expect(dialog).toBeHidden();

        // The exported scene groups every visible copy under its own Structure_* node
        const names = await page.evaluate(async () => {
            const res = await globalThis.exportToGLTF('gltf', 'meters', 'yup', { download: false, silent: true });
            const nodes = res.result.nodes || [];
            return nodes.map(n => n.name).filter(n => /^Structure_/.test(n)).sort();
        });
        expect(names).toEqual(['Structure_1', 'Structure_2', 'Structure_3', 'Structure_Center']);
    });

    test('copies fold in place: the ring plan is fixed across fold angles', async ({ page }) => {
        await page.locator('#chk-radial-arr-enabled').check();
        await expect.poll(() => page.evaluate(() => globalThis.state.radialArrayEnabled)).toBe(true);
        const planAt = (deg) => page.evaluate((deg) => {
            globalThis.state.foldAngle = deg * Math.PI / 180;
            const plan = globalThis.buildLinkageGeometry({ useCache: false }).radialArray;
            return { anchor: plan.anchor, radius: plan.radius, offsets: plan.slots.map(sl => [sl.offset.x, sl.offset.z]) };
        }, deg);
        const deployed = await planAt(130);
        const folded = await planAt(40);
        expect(folded.radius).toBeCloseTo(deployed.radius, 6);
        expect(folded.anchor.x).toBeCloseTo(deployed.anchor.x, 6);
        expect(folded.anchor.z).toBeCloseTo(deployed.anchor.z, 6);
        folded.offsets.forEach((o, i) => {
            expect(o[0]).toBeCloseTo(deployed.offsets[i][0], 6);
            expect(o[1]).toBeCloseTo(deployed.offsets[i][1], 6);
        });
        // The "fold one at a time" option appears once the design holds several structures
        await expect(page.locator('#anim-sequential-row')).toBeAttached();
        await expect.poll(() => page.evaluate(() => document.getElementById('anim-sequential-row').hidden)).toBe(false);
    });

    test('sequential fold moves one copy at a time; the deploy preview packs every copy and labels them', async ({ page }) => {
        await page.locator('#chk-radial-arr-enabled').check();
        const count = page.locator('#nb-radial-arr-count');
        await count.fill('3');
        await count.dispatchEvent('change');
        await expect.poll(() => page.evaluate(() => globalThis.state.radialCount)).toBe(3);
        // The Animation group is collapsed by default; drive the checkbox directly
        await page.evaluate(() => { const c = document.getElementById('chk-anim-sequential'); c.checked = true; c.dispatchEvent(new Event('change')); });
        await expect.poll(() => page.evaluate(() => globalThis.state.animation.sequentialFold)).toBe(true);

        const sched = await page.evaluate(() => {
            const r = globalThis.getFoldSweepRange(globalThis.state);
            globalThis.state.foldAngle = r.min + 0.5 * (r.max - r.min);
            const d = globalThis.buildLinkageGeometry({ useCache: false });
            const s = d.foldSchedule;
            return { K: s.K, sequential: s.sequential, distinct: s.distinctAngles.length, labels: s.copies.map(c => c.label), progress: s.copies.map(c => +c.progress.toFixed(2)), beams: d.beams.length };
        });
        expect(sched.K).toBe(4);
        expect(sched.sequential).toBe(true);
        expect(sched.distinct).toBeLessThanOrEqual(3);
        expect(sched.labels).toEqual(['Center', 'Copy 1', 'Copy 2', 'Copy 3']);
        expect(sched.progress).toEqual([1, 1, 0, 0]);
        expect(sched.beams).toBeGreaterThan(0);

        // Packed view: one carrier per copy, each parked at its own pack slot
        await page.evaluate(() => { globalThis.state.foldAngle = globalThis.getOptimalClosedAngleForAnimation(); globalThis.requestRender(); });
        await page.evaluate(() => document.getElementById('btn-deploy-pack').click());
        await expect.poll(() => page.evaluate(() => globalThis.isDeployPreviewActive()), { timeout: 120_000 }).toBe(true);
        await expect(page.locator('#deploy-phase')).toContainText('Packed');
        await expect(page.locator('#deploy-pack-summary')).toContainText('4 bundles');
        const packed = await page.evaluate(() => {
            const w = globalThis.threeRenderer.mainScene.getObjectByName('DeployPreview');
            const st = w.getObjectByName('Structure');
            const carriers = st.children.filter(c => /^Structure_/.test(c.name));
            const centers = carriers.map(c => new THREE.Box3().setFromObject(c).getCenter(new THREE.Vector3()).toArray().map(v => +v.toFixed(1)));
            return { names: carriers.map(c => c.name).sort(), centers, meta: globalThis.deployPreview.meta };
        });
        expect(packed.names).toEqual(['Structure_1', 'Structure_2', 'Structure_3', 'Structure_Center']);
        expect(new Set(packed.centers.map(c => c.join(','))).size).toBe(4);
        expect(packed.meta.copies).toBe(4);
        expect(packed.meta.sequential).toBe(true);
        expect(packed.meta.pack.bundles).toBe(4);
        expect(packed.meta.timeline.copies.map(c => c.label)).toEqual(['Center', 'Copy 1', 'Copy 2', 'Copy 3']);

        // Scrubbing into the second window names that copy
        await page.evaluate(() => globalThis.setDeployT(0.3));
        await expect(page.locator('#deploy-phase')).toContainText(/Copy 1 · /);
        await page.evaluate(() => globalThis.setDeployT(1));
        await expect(page.locator('#deploy-phase')).toContainText('Deployed');
        await page.evaluate(() => document.getElementById('btn-deploy-exit').click());
        await expect.poll(() => page.evaluate(() => globalThis.isDeployPreviewActive())).toBe(false);
    });

    test('individual copies can be hidden, which the viewport and the export both honour', async ({ page }) => {
        const before = await beamCount(page);
        await page.locator('#chk-radial-arr-enabled').check();
        const count = page.locator('#nb-radial-arr-count');
        await count.fill('2');
        await count.dispatchEvent('change');
        await expect.poll(() => beamCount(page)).toBe(before * 3);

        const grid = page.locator('#radial-copy-toggles');
        await expect(grid.locator('input')).toHaveCount(3);
        await expect(grid).toContainText('Center');
        await expect(grid).toContainText('Copy 1');
        await expect(grid).toContainText('Copy 2');

        await page.locator('#chk-radial-copy-1').uncheck();
        await expect.poll(() => page.evaluate(() => globalThis.state.radialHiddenSlots)).toEqual([1]);
        await expect.poll(() => beamCount(page)).toBe(before * 2);
        await expect(page.locator('#radial-array-readout')).toContainText('1 hidden');

        // The export only carries the visible copies
        const exported = await page.evaluate(async () => {
            const res = await globalThis.exportToGLTF('gltf', 'meters', 'yup', { download: false, silent: true });
            return (res.result.nodes || []).map(n => n.name).filter(n => /^Structure_/.test(n)).sort();
        });
        expect(exported).toEqual(['Structure_2', 'Structure_Center']);

        // Centre only, then the last visible copy cannot be hidden, then show all
        await page.locator('#btn-radial-copies-center').click();
        await expect.poll(() => page.evaluate(() => globalThis.state.radialHiddenSlots)).toEqual([1, 2]);
        await expect.poll(() => beamCount(page)).toBe(before);
        // A plain click: the guard re-checks the box, which uncheck() would report as a failure
        await page.locator('#chk-radial-copy-0').click();
        await expect(page.locator('#chk-radial-copy-0')).toBeChecked();
        await expect.poll(() => page.evaluate(() => globalThis.state.radialHiddenSlots)).toEqual([1, 2]);
        await page.locator('#btn-radial-copies-all').click();
        await expect.poll(() => page.evaluate(() => globalThis.state.radialHiddenSlots)).toEqual([]);
        await expect.poll(() => beamCount(page)).toBe(before * 3);

        // Hidden copies survive a save / load round trip
        await page.locator('#chk-radial-copy-2').uncheck();
        const restored = await page.evaluate(() => {
            const snapshot = globalThis.getConfigSnapshot();
            globalThis.state.radialHiddenSlots = [];
            globalThis.applyConfig(snapshot, true);
            return { saved: snapshot.mode.radialArray.hiddenSlots, hidden: globalThis.state.radialHiddenSlots,
                     box: document.getElementById('chk-radial-copy-2').checked };
        });
        expect(restored).toEqual({ saved: [2], hidden: [2], box: false });
    });
});
