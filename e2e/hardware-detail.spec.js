import { test, expect } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.js';
import { installOfflineCdn } from './helpers/offline-cdn.js';

/** Screen-space (NDC) position of the part-view focus target and of the focused instance's bbox centre. */
async function focusOnScreen(page) {
    await page.evaluate(() => globalThis.render?.());
    await page.waitForTimeout(80);
    return page.evaluate(() => {
        const tr = globalThis.threeRenderer;
        const cam = tr.mainCamera;
        const proj = (p) => { const v = new THREE.Vector3(p.x, p.y, p.z).project(cam); return { x: v.x, y: v.y }; };
        let inst = null;
        tr.hardwareAssemblyGroup.traverse((o) => { if (o.uuid === globalThis.hwDetail.focusGroupUuid) inst = o; });
        let bbox = null;
        if (inst) {
            inst.updateWorldMatrix(true, true);
            const b = new THREE.Box3().setFromObject(inst);
            bbox = proj(b.getCenter(new THREE.Vector3()));
        }
        return { target: tr._hwFocusTarget ? proj(tr._hwFocusTarget) : null, bbox, yaw: globalThis.state.cam.yaw, dist: globalThis.state.cam.dist };
    });
}

async function setModalFold(page, deg) {
    await page.evaluate((d) => {
        const sl = document.getElementById('hw-fold-slider');
        sl.value = String(d);
        sl.dispatchEvent(new Event('input', { bubbles: true }));
    }, deg);
    await page.waitForTimeout(150);
}

async function openPartView(page) {
    await page.goto('/index.html');
    await waitForAppReady(page);
    await page.evaluate(() => globalThis.openHardwareDetail());
    await expect(page.locator('#hardware-detail-modal')).toHaveClass(/visible/);
    await page.waitForFunction(() => !!globalThis.hwDetail?.focusGroupUuid, null, { timeout: 15_000 });
    await page.waitForTimeout(200);
}

test.describe('Hardware assembly detail', () => {
    test.beforeEach(async ({ page }) => {
        await installOfflineCdn(page);
    });

    test('stays centred on the assembly across fold angles, even with a stale pinned camera target', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);
        // What the step editor's "Go to view" leaves behind
        await page.evaluate(() => { globalThis.state.cam.target = { x: 0, y: 0, z: 0 }; });
        await page.evaluate(() => globalThis.openHardwareDetail());
        await page.waitForFunction(() => !!globalThis.hwDetail?.focusGroupUuid, null, { timeout: 15_000 });

        for (const deg of [60, 90, 120, 150]) {
            await setModalFold(page, deg);
            const s = await focusOnScreen(page);
            expect(Math.abs(s.target.x), `fold ${deg}`).toBeLessThan(0.05);
            expect(Math.abs(s.target.y), `fold ${deg}`).toBeLessThan(0.05);
            expect(Math.abs(s.bbox.x), `bbox fold ${deg}`).toBeLessThan(0.05);
            expect(Math.abs(s.bbox.y), `bbox fold ${deg}`).toBeLessThan(0.05);
        }
        expect(await page.evaluate(() => globalThis.state.cam.target)).toBeNull();
    });

    test('orbit and wheel move the camera but keep the look-at on the assembly; Recenter restores head-on', async ({ page }) => {
        await openPartView(page);
        const before = await focusOnScreen(page);
        const box = await page.locator('#canvas-webgl').boundingBox();
        await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.7 + 150, box.y + box.height * 0.7 + 40, { steps: 10 });
        await page.mouse.up();
        await page.mouse.wheel(0, -300);
        await page.waitForTimeout(150);

        const after = await focusOnScreen(page);
        expect(after.yaw).not.toBeCloseTo(before.yaw, 2);
        expect(after.dist).not.toBeCloseTo(before.dist, 1);
        expect(Math.abs(after.target.x)).toBeLessThan(0.05);
        expect(Math.abs(after.target.y)).toBeLessThan(0.05);
        expect(await page.evaluate(() => globalThis.hwDetail.lockRadialView)).toBe(false);

        await page.locator('#hw-btn-recenter').click();
        await page.waitForTimeout(150);
        const recentred = await focusOnScreen(page);
        expect(recentred.dist).toBeCloseTo(before.dist, 1);
        expect(await page.evaluate(() => globalThis.hwDetail.lockRadialView)).toBe(true);
    });

    test('stack is tight by construction, a gap pushes later parts, and Tighten closes it', async ({ page }) => {
        await openPartView(page);
        await page.evaluate(() => {
            const s = document.getElementById('hw-assembly-select');
            s.value = 'outerVBeam';
            s.dispatchEvent(new Event('change'));
        });
        await page.waitForTimeout(200);

        const intervals = () => page.evaluate(() => {
            const asm = globalThis.getActiveHardwareAssembly();
            const l = globalThis.hwComputeAxisLayout(asm, 'right');
            return l.items.map((it) => ({ id: it.part.id, kind: it.kind, start: it.baseStart, end: it.end, gap: it.gapBefore }));
        });
        const tight = await intervals();
        const solids = tight.filter((it) => it.kind === 'member' || it.kind === 'nut').sort((a, b) => a.start - b.start);
        for (let i = 1; i < solids.length; i++) {
            expect(solids[i].start, `${solids[i].id} flush against ${solids[i - 1].id}`).toBeCloseTo(solids[i - 1].end, 4);
        }

        // Type a gap before the lock washer: it and the bolt head move, the beam does not
        const beamBefore = tight.find((it) => it.id === 'r-beam').start;
        const lockBefore = tight.find((it) => it.id === 'r-lock').start;
        await page.evaluate(() => {
            const asm = globalThis.getActiveHardwareAssembly();
            globalThis.hwApplyPartGap(asm.parts.find((p) => p.id === 'r-lock'), asm, 0.25);
            globalThis.renderHardwareEditPanel();
        });
        const gapped = await intervals();
        expect(gapped.find((it) => it.id === 'r-lock').start).toBeCloseTo(lockBefore + 0.25, 4);
        expect(gapped.find((it) => it.id === 'r-beam').start).toBeCloseTo(beamBefore, 4);
        await expect(page.locator('.hw-part-card input[title*="Space before"]').first()).toBeVisible();

        await page.locator('#hw-btn-tighten').click();
        await page.waitForTimeout(150);
        const again = await intervals();
        expect(again.find((it) => it.id === 'r-lock').start).toBeCloseTo(lockBefore, 4);
        expect(again.every((it) => it.gap === 0)).toBe(true);
    });

    test('explode keeps stack order with uniform spacing and re-fits the view', async ({ page }) => {
        await openPartView(page);
        const distBefore = await page.evaluate(() => globalThis.state.cam.dist);
        await page.evaluate(() => {
            const sl = document.getElementById('hw-explode-slider');
            sl.value = '100';
            sl.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForTimeout(250);
        const rows = await page.evaluate(() => {
            const asm = globalThis.getActiveHardwareAssembly();
            const axis = asm.parts.find((p) => p.type !== 'bracket' && p.type !== 'beam')?.axis || 'right';
            const l = globalThis.hwComputeAxisLayout(asm, axis);
            const gap = globalThis.hwGetExplodeGap(asm);
            const solids = l.items.filter((it) => it.kind !== 'bolt').sort((a, b) => a.rank - b.rank);
            return { gap, solids: solids.map((it) => ({ start: it.explodedStart, len: it.len, rank: it.rank })) };
        });
        for (let i = 1; i < rows.solids.length; i++) {
            const space = rows.solids[i].start - (rows.solids[i - 1].start + rows.solids[i - 1].len);
            expect(space, `gap between rank ${i - 1} and ${i}`).toBeCloseTo(rows.gap, 3);
        }
        const distAfter = await page.evaluate(() => globalThis.state.cam.dist);
        expect(distAfter).toBeGreaterThan(distBefore);
        const s = await focusOnScreen(page);
        expect(Math.abs(s.bbox.x)).toBeLessThan(0.05);
    });

    test('legacy per-part offsets migrate to a flush stack', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);
        const res = await page.evaluate(() => {
            const cfg = JSON.parse(JSON.stringify(globalThis.serializeHardwareAssembliesForConfig()));
            delete cfg.stackModelV3;
            const inner = cfg.assemblies.innerVBeam;
            inner.parts.forEach((p) => { if (p.type !== 'bracket') { p.posAssembled = -5.54; p.posExploded = 2; delete p.gapBefore; } });
            globalThis.state.hardwareAssemblies = cfg;
            globalThis.ensureHardwareAssemblies();
            const asm = globalThis.state.hardwareAssemblies.assemblies.innerVBeam;
            const l = globalThis.hwComputeAxisLayout(asm, 'right');
            const solids = l.items.filter((it) => it.kind === 'member' || it.kind === 'nut').sort((a, b) => a.baseStart - b.baseStart);
            let flush = true;
            for (let i = 1; i < solids.length; i++) if (Math.abs(solids[i].baseStart - solids[i - 1].end) > 1e-6) flush = false;
            return { v3: globalThis.state.hardwareAssemblies.stackModelV3, leftovers: asm.parts.filter((p) => p.posAssembled != null || p.posExploded != null).length, flush, gaps: asm.parts.filter((p) => p.type !== 'bracket').every((p) => p.gapBefore === 0) };
        });
        expect(res.v3).toBe(true);
        expect(res.leftovers).toBe(0);
        expect(res.flush).toBe(true);
        expect(res.gaps).toBe(true);
    });
});
