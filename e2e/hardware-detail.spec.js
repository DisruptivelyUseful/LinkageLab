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


/** Screen position of a laid-out part in the focused instance and its on-screen axis vector (px per inch). */
async function partOnScreen(page, partId, renderAxisKey) {
    await page.waitForTimeout(60);
    return page.evaluate(({ partId, renderAxisKey }) => {
        const tr = globalThis.threeRenderer;
        const cam = tr.mainCamera;
        const r = document.getElementById('canvas-webgl').getBoundingClientRect();
        const inst = tr.hardwareAssemblyGroup.children.find((o) => o.uuid === globalThis.hwDetail.focusGroupUuid);
        inst.updateWorldMatrix(true, true);
        const root = inst.children.find((c) => c.userData.partId === partId && c.userData.build && c.userData.build.renderAxisKey === renderAxisKey);
        if (!root) return null;
        const b = root.userData.build;
        const scr = (v) => { const p = v.clone().applyMatrix4(inst.matrixWorld).project(cam); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; };
        const a = scr(root.position);
        const d = scr(root.position.clone().add(new THREE.Vector3(b.axis.x, b.axis.y, b.axis.z)));
        return { x: a.x, y: a.y, dx: d.x - a.x, dy: d.y - a.y };
    }, { partId, renderAxisKey });
}

/** Press on a part and drag it `inches` along its drawn axis. */
async function dragPart(page, partId, inches, { renderAxisKey = 'right', modifier = null } = {}) {
    const p = await partOnScreen(page, partId, renderAxisKey);
    expect(p, `${partId} on ${renderAxisKey} is drawn`).not.toBeNull();
    await page.mouse.move(p.x, p.y);
    if (modifier) await page.keyboard.down(modifier);
    await page.mouse.down();
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
        await page.mouse.move(p.x + p.dx * inches * i / steps, p.y + p.dy * inches * i / steps);
        await page.waitForTimeout(20);
    }
    await page.mouse.up();
    if (modifier) await page.keyboard.up(modifier);
    await page.waitForTimeout(200);
}

/** Seated intervals on one axis of the active assembly. */
async function axisState(page, axisKey = 'right') {
    return page.evaluate((axisKey) => {
        const asm = globalThis.getActiveHardwareAssembly();
        const l = globalThis.hwComputeAxisLayout(asm, axisKey);
        const out = { manual: l.manual, datum: l.datum, parts: {} };
        l.items.filter((it) => !it.copyIndex).forEach((it) => { out.parts[it.part.id] = { start: it.baseStart, end: it.end, seq: it.part.seq }; });
        if (l.stack.bolt) out.headUnder = l.stack.bolt.headOutside ? l.stack.bolt.headStart : l.stack.bolt.headEnd;
        return out;
    }, axisKey);
}

async function selectAssembly(page, id) {
    await page.evaluate((id) => {
        const s = document.getElementById('hw-assembly-select');
        s.value = id;
        s.dispatchEvent(new Event('change'));
    }, id);
    await page.waitForTimeout(400);
}

async function setSnap(page, on) {
    const pressed = await page.locator('#hw-btn-snap').getAttribute('aria-pressed');
    if ((pressed === 'true') !== on) await page.locator('#hw-btn-snap').click();
    await expect(page.locator('#hw-btn-snap')).toHaveAttribute('aria-pressed', on ? 'true' : 'false');
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
    test('dragging places a part freely: the axis goes manual, nothing swaps, Tighten restores', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 950 });
        await openPartView(page);
        await selectAssembly(page, 'outerVBeam');
        await setSnap(page, false);
        const before = await axisState(page);
        expect(before.manual).toBe(false);

        await dragPart(page, 'r-bolt', 0.8);
        const after = await axisState(page);
        expect(after.manual).toBe(true);
        expect(after.headUnder - before.headUnder).toBeGreaterThan(0.6);
        expect(after.headUnder - before.headUnder).toBeLessThan(1.0);
        // Beams stay on their seat and the stack order is untouched
        expect(after.parts['r-beam'].start).toBeCloseTo(before.parts['r-beam'].start, 4);
        Object.keys(before.parts).forEach((id) => expect(after.parts[id].seq).toBe(before.parts[id].seq));
        await expect(page.locator('.hw-axis-mode-manual')).toHaveCount(1);
        await expect(page.locator('.hw-part-card input[title*="from the axis datum"]').first()).toBeVisible();

        await page.locator('#hw-btn-tighten').click();
        await page.waitForTimeout(200);
        const tight = await axisState(page);
        expect(tight.manual).toBe(false);
        expect(tight.headUnder).toBeCloseTo(before.headUnder, 4);
        await expect(page.locator('.hw-axis-mode-manual')).toHaveCount(0);
    });

    test('a bolt head pushes the parts it reaches and seats them on the beam face', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 950 });
        await openPartView(page);
        await selectAssembly(page, 'outerVBeam');
        await setSnap(page, false);
        const tight = await axisState(page);
        const beamFace = tight.parts['r-beam'].end;

        // Pull the bolt out, then slide the lock washer out part-way: now there is a gap under the head
        await dragPart(page, 'r-bolt', 1.0);
        const lifted = await axisState(page);
        expect(lifted.parts['r-lock'].start).toBeCloseTo(tight.parts['r-lock'].start, 4);

        // Push the bolt back in past its old seat with snap on: the head carries the lock washer,
        // which seats on the beam face instead of sliding into it
        await setSnap(page, true);
        await dragPart(page, 'r-bolt', -1.15);
        const pushed = await axisState(page);
        expect(pushed.parts['r-lock'].start).toBeCloseTo(beamFace, 3);
        expect(pushed.headUnder).toBeCloseTo(pushed.parts['r-lock'].end, 3);

        // Ctrl slides the bolt through without pushing
        await setSnap(page, false);
        await dragPart(page, 'r-bolt', -0.5, { modifier: 'Control' });
        const through = await axisState(page);
        expect(through.parts['r-lock'].start).toBeCloseTo(pushed.parts['r-lock'].start, 4);
        expect(through.headUnder).toBeLessThan(pushed.headUnder - 0.3);
    });

    test('snap pulls a part onto a nearby face; Alt drags past it', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 950 });
        await openPartView(page);
        await selectAssembly(page, 'outerVBeam');
        await setSnap(page, true);
        const tight = await axisState(page);
        // Pull the head 0.1 in off the lock washer: snap keeps it seated
        await dragPart(page, 'r-bolt', 0.1);
        const snapped = await axisState(page);
        expect(snapped.headUnder).toBeCloseTo(tight.headUnder, 4);
        // Alt inverts snap for this drag: the small offset sticks
        await dragPart(page, 'r-bolt', 0.1, { modifier: 'Alt' });
        const free = await axisState(page);
        expect(free.headUnder - tight.headUnder).toBeGreaterThan(0.05);
    });

    test('the mirrored side drags in its own direction', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 950 });
        await openPartView(page);
        await selectAssembly(page, 'outerVBeam');
        await setSnap(page, false);
        const before = await axisState(page);
        // Drag the bolt drawn on the LEFT (mirror of right) outward along the left axis
        await dragPart(page, 'r-bolt', 0.7, { renderAxisKey: 'left' });
        const after = await axisState(page);
        expect(after.headUnder - before.headUnder).toBeGreaterThan(0.5);
    });

    test('arrow keys nudge the selected part; undo restores; hand placement survives a reload', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 950 });
        await openPartView(page);
        await selectAssembly(page, 'outerVBeam');
        const tight = await axisState(page);
        await page.waitForTimeout(2300); // let the opening history snapshot settle

        const p = await partOnScreen(page, 'r-bolt', 'right');
        await page.mouse.click(p.x, p.y);
        await expect(page.locator('.hw-part-card.selected')).toHaveCount(1);
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Shift+ArrowRight');
        const nudged = await axisState(page);
        expect(nudged.manual).toBe(true);
        expect(nudged.headUnder - tight.headUnder).toBeCloseTo(1 / 16 + 1 / 4, 4);

        await page.evaluate(() => globalThis.hwFlushHardwareConfigSync());
        await page.reload();
        await waitForAppReady(page);
        await page.evaluate(() => globalThis.openHardwareDetail());
        await page.waitForFunction(() => !!globalThis.hwDetail?.focusGroupUuid, null, { timeout: 15_000 });
        await selectAssembly(page, 'outerVBeam');
        const reloaded = await axisState(page);
        expect(reloaded.manual).toBe(true);
        expect(reloaded.headUnder).toBeCloseTo(nudged.headUnder, 4);

        // Undo after an edit: tighten, wait for the history snapshot, undo → manual placement is back
        await page.locator('#hw-btn-tighten').click();
        await page.waitForTimeout(2300);
        expect((await axisState(page)).manual).toBe(false);
        await page.evaluate(() => globalThis.undo());
        await page.waitForTimeout(200);
        const undone = await axisState(page);
        expect(undone.manual).toBe(true);
        expect(undone.headUnder).toBeCloseTo(nudged.headUnder, 4);
        expect(await page.evaluate(() => globalThis.state.hwDetailMode)).toBe(true);
        await expect(page.locator('.hw-axis-mode-manual')).toHaveCount(1);
    });
});
