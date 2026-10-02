import { test, expect } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.js';
import { installOfflineCdn } from './helpers/offline-cdn.js';

test.describe('actuation planner', () => {
    test.beforeEach(async ({ page }) => {
        await installOfflineCdn(page);
        await page.addInitScript(() => localStorage.clear());
    });

    test('sidebar group shows stroke and force, draws the drive, compares placements, persists', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto('/index.html');
        await waitForAppReady(page);

        // The deleted legacy analysis UI must stay gone; the new group uses act-* ids
        await expect(page.locator('#btn-analyze-actuators')).toHaveCount(0);
        const group = page.locator('#sidebar .group[data-group="actuation"]');
        await expect(group).toBeVisible();
        await group.locator('.group-title').click();
        await expect(group).not.toHaveClass(/collapsed/);

        await page.locator('#chk-act-enable').check();
        await expect(page.locator('#act-controls')).toBeVisible();
        await expect(page.locator('#sel-act-placement')).toHaveValue('hScissor');

        // Readouts fill in for the default H-scissor placement
        await expect(page.locator('#act-stat-stroke')).not.toHaveText('--');
        await expect(page.locator('#act-stat-peak')).toContainText('lb');
        const hs = await page.evaluate(() => {
            const d = globalThis.buildLinkageGeometry({ useCache: true });
            const r = globalThis.getActuationAnalysis(d).selected;
            return { stroke: r.stroke, peak: r.peakForce, flat: r.gravityFlatness, n: r.nDrives, senses: r.senses };
        });
        expect(hs.n).toBe(await page.evaluate(() => globalThis.state.modules));
        expect(hs.flat).toBeGreaterThan(0.5);
        expect(hs.senses).toEqual(['push']);
        expect(hs.stroke).toBeGreaterThan(5);

        // The drive is drawn in 3D (bodies, rods, mounts, label) for every module
        await expect.poll(() => page.evaluate(() => globalThis.threeRenderer.actuatorLineGroup.children.length)).toBeGreaterThan(hs.n * 3);
        await expect(page.locator('#act-spark polyline')).toHaveCount(1);

        // Switching to the track cable changes the stroke and reports a pull with a kick-off
        await page.locator('#sel-act-placement').selectOption('trackCable');
        await expect(page.locator('#act-params-track')).toBeVisible();
        await expect.poll(() => page.evaluate(() => globalThis.state.actuation.placement)).toBe('trackCable');
        const tc = await page.evaluate(() => {
            const d = globalThis.buildLinkageGeometry({ useCache: true });
            const r = globalThis.getActuationAnalysis(d).selected;
            return { stroke: r.stroke, kick: r.kickoffForce, dep: r.deployedForce, senses: r.senses, kickoff: !!r.kickoff };
        });
        expect(tc.stroke).not.toBeCloseTo(hs.stroke, 0);
        expect(tc.senses).toEqual(['pull']);
        expect(tc.kick).toBeGreaterThan(tc.dep * 5);
        await expect(page.locator('#act-stat-kickoff')).toContainText(/Needed|Not needed/);

        // Compare table lists the whole catalog; clicking a row selects that placement
        await page.locator('#btn-act-compare').click();
        const rows = page.locator('#act-compare tbody tr');
        const catalog = await page.evaluate(() => globalThis.PLACEMENT_IDS.length);
        await expect(rows).toHaveCount(catalog);
        await page.locator('#act-compare tr[data-placement="verticalJack"]').click();
        await expect.poll(() => page.evaluate(() => globalThis.state.actuation.placement)).toBe('verticalJack');

        // Hiding the drive clears the 3D group; persisted through the config snapshot
        await page.locator('#chk-act-show3d').uncheck();
        await expect.poll(() => page.evaluate(() => globalThis.threeRenderer.actuatorLineGroup.children.length)).toBe(0);
        const snap = await page.evaluate(() => globalThis.getConfigSnapshot());
        expect(snap.actuation.enabled).toBe(true);
        expect(snap.actuation.placement).toBe('verticalJack');
        expect(snap.actuation.show3D).toBe(false);

        // BOM carries the drives line
        const bom = await page.evaluate(() => {
            const b = globalThis.computeBom ? globalThis.computeBom() : null;
            return b ? b.items.filter(i => i.id === 'drives').map(i => i.qty) : null;
        });
        if (bom) expect(bom[0]).toBeGreaterThan(0);

        await page.locator('#chk-act-show3d').check();
        expect(errors).toEqual([]);
    });

    test('floor radial beams become slotted track feet under the ring', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto('/index.html');
        await waitForAppReady(page);

        const group = page.locator('#sidebar .group[data-group="floor"]');
        await group.locator('.group-title').click();
        await page.locator('#chk-floor').check();
        await page.locator('#chk-floor-radial').check();
        await expect(page.locator('#floor-radial-controls')).toBeVisible();
        await page.locator('#sel-floor-rad-mode').selectOption('track');
        await expect(page.locator('#floor-rad-track-controls')).toBeVisible();
        await expect(page.locator('#floor-rad-offset-controls')).toBeHidden();
        await expect.poll(() => page.evaluate(() => globalThis.state.floor.beams.radialMode)).toBe('track');

        const modules = await page.evaluate(() => globalThis.state.modules);
        const geo = await page.evaluate(() => {
            const d = globalThis.buildLinkageGeometry({ useCache: true });
            const tracks = d.floorTracks || [];
            return {
                tracks: tracks.length,
                beams: d.beams.filter(b => b.stackType === 'floor-beam-track').length,
                bolts: d.bolts.filter(b => b.boltType === 'track-bolt').length,
                groundY: d.structureBounds.min.y,
                bottomY: tracks.length ? tracks[0].bottomY : null,
                slot: tracks.length ? tracks[0].slotLengthIn : 0,
            };
        });
        expect(geo.tracks).toBe(modules);
        expect(geo.beams).toBe(modules);
        expect(geo.bolts).toBe(modules);
        expect(geo.slot).toBeGreaterThan(10);
        // the feet are the lowest point: the ground drops to their underside
        expect(geo.groundY).toBeCloseTo(geo.bottomY, 3);
        await expect(page.locator('#floor-stat-track-slot')).toContainText('from the pin');
        await expect(page.locator('#floor-stat-track-swing')).toContainText('°');

        // Scrub to a packed angle: the track beams stay (reciprocal beams would hide) and the bolt stays in the slot
        await page.evaluate(() => { globalThis.state.foldAngle = 15 * Math.PI / 180; globalThis.requestRender(); });
        const packed = await page.evaluate(() => {
            const d = globalThis.buildLinkageGeometry({ useCache: false });
            const t = d.floorTracks[0], mp = d.modulePivots[0];
            const rel = { x: mp.botInner.x - t.pin.x, z: mp.botInner.z - t.pin.z };
            const along = rel.x * t.dir.x + rel.z * t.dir.z;
            return { n: d.floorTracks.length, along, from: t.spanDeployed, to: t.spanPacked, rcp: d.beams.filter(b => b.stackType === 'floor-beam-reciprocal').length };
        });
        expect(packed.n).toBe(modules);
        expect(packed.along).toBeGreaterThanOrEqual(packed.from - 0.2);
        expect(packed.along).toBeLessThanOrEqual(packed.to + 0.2);

        // The track cable drive rides on the track; persisted in the snapshot
        const act = page.locator('#sidebar .group[data-group="actuation"]');
        await act.locator('.group-title').click();
        await page.locator('#chk-act-enable').check();
        await page.locator('#sel-act-placement').selectOption('trackCable');
        await expect(page.locator('#act-stat-stroke')).not.toHaveText('--');
        const snap = await page.evaluate(() => globalThis.getConfigSnapshot());
        expect(snap.floor.beams.radialMode).toBe('track');
        expect(snap.actuation.placement).toBe('trackCable');
        expect(errors).toEqual([]);
    });
});
