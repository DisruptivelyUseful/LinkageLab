import { test, expect } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.js';
import { installOfflineCdn } from './helpers/offline-cdn.js';

async function openApp(page) {
    await installOfflineCdn(page);
    await page.goto('/index.html');
    await waitForAppReady(page);
    await page.waitForFunction(() => {
        const m = globalThis.LinkageModules || {};
        return m.buildSteps && m.buildStepsAnim && m.buildStepsUi && m.partKeys;
    }, null, { timeout: 60_000 });
    await page.evaluate(() => document.getElementById('build-steps-group')?.classList.remove('collapsed'));
}

test.describe('Build steps', () => {
    test('steps can be added, targeted, reordered and persisted', async ({ page }) => {
        await openApp(page);

        await page.click('#bs-btn-add');
        await page.click('#bs-btn-add');
        await expect(page.locator('#bs-step-list .bs-step')).toHaveCount(2);

        // Give the first step a target through the picker and auto-frame it
        await page.click('#bs-step-list .bs-step:nth-child(1)');
        await page.selectOption('#bs-pick-kind', 'beam');
        await page.selectOption('#bs-pick-stack', 'horizontal-top');
        await page.selectOption('#bs-pick-module', '0');
        await page.click('#bs-pick-add');
        await page.click('#bs-ed-autoframe');

        const first = await page.evaluate(() => {
            const s = globalThis.state.buildSteps.steps[0];
            const data = globalThis.buildLinkageGeometry({ useCache: true });
            const resolved = globalThis.resolveTargets(data, s.targets);
            return { targets: s.targets, matched: resolved.items.length, hasView: !!s.view, anchor: s.view && s.view.anchor };
        });
        expect(first.targets).toEqual([{ kind: 'beam', stackType: 'horizontal-top', moduleIndex: 0 }]);
        expect(first.matched).toBe(await page.evaluate(() => globalThis.state.hStackCount));
        expect(first.hasView).toBe(true);
        expect(first.anchor).toEqual({ kind: 'beam', stackType: 'horizontal-top', moduleIndex: 0 });

        // Rename the second step and drag it above the first
        await page.click('#bs-step-list .bs-step:nth-child(2)');
        await page.fill('#bs-ed-title', 'Rear view');
        await page.fill('#bs-ed-notes', 'Look from the back.');
        // Filling the editor scrolls the sidebar; bring the list back under the (fixed) topbar
        await page.evaluate(() => document.getElementById('bs-step-list').scrollIntoView({ block: 'center' }));
        const grip = page.locator('#bs-step-list .bs-step:nth-child(2) .bs-grip');
        const target = page.locator('#bs-step-list .bs-step:nth-child(1)');
        await grip.dragTo(target, { targetPosition: { x: 40, y: 3 } });
        await expect.poll(() => page.evaluate(() => globalThis.state.buildSteps.steps.map((s) => s.title))).toEqual(['Rear view', 'Step 1']);

        // Steps survive the config snapshot and a reload
        const snapshot = await page.evaluate(() => globalThis.getConfigSnapshot().buildSteps);
        expect(snapshot.steps.map((s) => s.title)).toEqual(['Rear view', 'Step 1']);
        expect(snapshot.steps[0].notes).toBe('Look from the back.');
        await page.waitForTimeout(1200); // debounced autosave
        await page.reload();
        await openApp(page);
        await expect(page.locator('#bs-step-list .bs-step')).toHaveCount(2);
        await expect(page.locator('#bs-step-list .bs-step:nth-child(1) .bs-title')).toHaveText('Rear view');
    });

    test('build mode plays through the sequence and hides future parts', async ({ page }) => {
        await openApp(page);

        await page.evaluate(() => {
            const bs = globalThis.state.buildSteps;
            globalThis.addStep(bs, globalThis.createStep('view', { title: 'Overview', transitionMs: 100, durationMs: 200 }));
            globalThis.addStep(bs, globalThis.createStep('place', {
                title: 'Place bottom ring',
                transitionMs: 100,
                durationMs: 200,
                targets: [{ kind: 'beam', stackType: 'horizontal-bottom' }],
            }));
            globalThis.addStep(bs, globalThis.createStep('place', {
                title: 'Place uprights',
                transitionMs: 100,
                durationMs: 200,
                targets: [{ kind: 'beam', stackType: 'vertical' }],
            }));
            globalThis.refreshBuildStepsUI();
        });

        await page.click('#bs-btn-mode');
        await expect(page.locator('#build-steps-bar')).toBeVisible();
        await expect(page.locator('#bs-caption-title')).toHaveText('Overview');

        // On the overview step every placed-later beam is hidden
        const staged = await page.evaluate(() => {
            const pb = globalThis.state.buildPlayback;
            const beams = globalThis.threeRenderer.beamGroup.children;
            return {
                active: pb.active,
                pinned: !!globalThis.state.cam.target,
                total: beams.length,
                hidden: beams.filter((m) => !m.visible).length,
            };
        });
        expect(staged.active).toBe(true);
        expect(staged.pinned).toBe(true);
        expect(staged.total).toBeGreaterThan(0);
        expect(staged.hidden).toBeGreaterThan(0);
        expect(staged.hidden).toBeLessThan(staged.total);

        // Step 2 reveals the bottom ring; the transport reflects the index
        await page.click('#bs-tr-next');
        await expect(page.locator('#bs-tr-pos')).toHaveText('2 / 3');
        const afterNext = await page.evaluate(() => {
            const beams = globalThis.threeRenderer.beamGroup.children;
            const visibleBottom = beams.filter((m) => m.visible && m.userData.beam && m.userData.beam.stackType === 'horizontal-bottom').length;
            const visibleVertical = beams.filter((m) => m.visible && m.userData.beam && m.userData.beam.stackType === 'vertical').length;
            return { visibleBottom, visibleVertical };
        });
        expect(afterNext.visibleBottom).toBeGreaterThan(0);
        expect(afterNext.visibleVertical).toBe(0);

        // Play to the end (short steps) and confirm the sequence finishes
        await page.click('#bs-tr-first');
        await page.click('#bs-tr-play');
        await expect.poll(
            () => page.evaluate(() => `${globalThis.state.buildPlayback.stepIndex}:${globalThis.state.buildPlayback.phase}`),
            { timeout: 30_000 },
        ).toBe('2:done');

        // Escape leaves build mode and restores the scene
        await page.keyboard.press('Escape');
        await expect(page.locator('#build-steps-bar')).toBeHidden();
        const restored = await page.evaluate(() => ({
            active: globalThis.state.buildPlayback.active,
            target: globalThis.state.cam.target,
            hidden: globalThis.threeRenderer.beamGroup.children.filter((m) => !m.visible).length,
        }));
        expect(restored.active).toBe(false);
        expect(restored.target).toBeNull();
        expect(restored.hidden).toBe(0);
    });

    test('auto-generate builds a full sequence with bench, place and pick support', async ({ page }) => {
        await openApp(page);
        page.on('dialog', (d) => d.accept());

        await page.click('#bs-btn-auto');
        await expect.poll(() => page.evaluate(() => globalThis.state.buildSteps.steps.length)).toBeGreaterThan(10);
        const kinds = await page.evaluate(() => globalThis.state.buildSteps.steps.map((s) => s.kind));
        expect(kinds[0]).toBe('cut');
        expect(kinds).toContain('drill');
        expect(kinds).toContain('place');
        expect(kinds).toContain('fasten');
        expect(kinds.indexOf('place')).toBeGreaterThan(kinds.lastIndexOf('drill'));

        // Cut step shows the workbench instead of the structure
        await page.click('#bs-btn-mode');
        await expect(page.locator('#build-steps-bar')).toBeVisible();
        await expect.poll(() => page.evaluate(() => ({
            bench: globalThis.threeRenderer.benchGroup ? globalThis.threeRenderer.benchGroup.children.length : 0,
            benchVisible: !!(globalThis.threeRenderer.benchGroup && globalThis.threeRenderer.benchGroup.visible),
            structure: globalThis.threeRenderer.structureGroup.visible,
        }))).toEqual(expect.objectContaining({ benchVisible: true, structure: false }));
        await expect(page.locator('#bs-caption-notes')).toContainText('×');

        // A place step moves its parts in from the approach offset
        const placeIdx = kinds.indexOf('place');
        await page.evaluate((i) => globalThis.goToStep(i, { immediate: true }), placeIdx);
        await page.waitForTimeout(600); // let the scene rebuild for the new step
        const moved = await page.evaluate(() => {
            globalThis.stepFrame(0);
            const find = () => globalThis.threeRenderer.beamGroup.children.find((m) => m.visible && m.userData.beam && m.userData.beam.stackType === 'horizontal-bottom' && m.userData.beam.moduleIndex === 0);
            const before = find().position.y;
            globalThis.state.buildPlayback.playing = true;
            for (let k = 0; k < 40; k++) globalThis.stepFrame(100);
            globalThis.state.buildPlayback.playing = false;
            const after = find().position.y;
            return { before, after, structure: globalThis.threeRenderer.structureGroup.visible, bench: globalThis.threeRenderer.benchGroup.visible };
        });
        expect(moved.structure).toBe(true);
        expect(moved.bench).toBe(false);
        expect(Math.abs(moved.before - moved.after)).toBeGreaterThan(5);

        await page.keyboard.press('Escape');
        await expect(page.locator('#build-steps-bar')).toBeHidden();

        // Pick in 3D adds whatever is under the cursor to the selected step
        await page.evaluate(() => {
            const s = globalThis.state.buildSteps.steps[0];
            s.targets = [];
            globalThis.refreshBuildStepsUI();
            globalThis.selectBuildStep(s.id);
        });
        // Playback left the camera framed on one module; reset it so the center hits the structure
        await page.evaluate(() => document.getElementById('btn-fit').click());
        await page.waitForTimeout(400);
        await page.click('#bs-pick-3d');
        await expect(page.locator('#viewport')).toHaveClass(/bs-picking/);
        // Click where a bottom H-beam projects on screen (the viewport center holds the IBC tank reference)
        const pt = await page.evaluate(() => {
            const mesh = globalThis.threeRenderer.beamGroup.children.find((m) => m.visible && m.userData.beam && m.userData.beam.stackType === 'horizontal-bottom');
            const v = new THREE.Vector3();
            mesh.getWorldPosition(v);
            v.project(globalThis.threeRenderer.mainCamera);
            const r = document.getElementById('canvas-webgl').getBoundingClientRect();
            return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
        });
        await page.mouse.click(pt.x, pt.y);
        await expect.poll(() => page.evaluate(() => globalThis.state.buildSteps.steps[0].targets.length)).toBe(1);
        expect(await page.evaluate(() => globalThis.state.buildSteps.steps[0].targets[0].kind)).toBe('beam');
        await page.keyboard.press('Escape');
        await expect(page.locator('#viewport')).not.toHaveClass(/bs-picking/);
    });

    test('build guide lists the steps with thumbnails and exports a PDF', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => {
            const bs = globalThis.state.buildSteps;
            bs.steps.length = 0;
            globalThis.addStep(bs, globalThis.createStep('view', { title: 'Overview', notes: 'Start here.', transitionMs: 100, durationMs: 200 }));
            globalThis.addStep(bs, globalThis.createStep('cut', { title: 'Cut top beams', targets: [{ kind: 'beam', stackType: 'horizontal-top' }], transitionMs: 100, durationMs: 200 }));
            globalThis.addStep(bs, globalThis.createStep('place', { title: 'Place bottom ring', targets: [{ kind: 'beam', stackType: 'horizontal-bottom' }], transitionMs: 100, durationMs: 200 }));
            globalThis.refreshBuildStepsUI();
        });
        await page.click('#btn-build-guide-top');
        await expect(page.locator('#build-guide-modal')).toHaveClass(/visible/);
        await expect(page.locator('.guide-step')).toHaveCount(3);
        await expect(page.locator('.guide-step').first()).toContainText('Overview');
        await expect(page.locator('.guide-step').first()).toContainText('Start here.');
        await expect.poll(() => page.locator('.guide-step img').count(), { timeout: 60_000 }).toBe(3);
        // Capturing the thumbnails must leave the viewport as it was
        const restored = await page.evaluate(() => ({ active: globalThis.state.buildPlayback.active, target: globalThis.state.cam.target }));
        expect(restored.active).toBe(false);
        expect(restored.target).toBeNull();

        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60_000 }),
            page.evaluate(() => globalThis.exportGuidePDFAsync()),
        ]);
        expect(download.suggestedFilename()).toMatch(/LinkageLab_BuildGuide_.*\.pdf$/);
    });

    test('auto-generated groups skip repeats and can be toggled to fast-forward', async ({ page }) => {
        await openApp(page);
        page.on('dialog', (d) => d.accept());
        await page.click('#bs-btn-auto');
        await expect.poll(() => page.evaluate(() => globalThis.state.buildSteps.steps.length)).toBeGreaterThan(10);

        const info = await page.evaluate(() => {
            const steps = globalThis.state.buildSteps.steps;
            const modules = globalThis.state.modules;
            const firstGrouped = steps.findIndex((s) => s.groupId);
            const g = globalThis.groupOf(steps, firstGrouped);
            return { modules, firstGrouped, count: g.count, next: globalThis.nextIndexAfter(steps, firstGrouped, 'skip'), badge: document.querySelectorAll('.bs-group-badge').length, mode: globalThis.state.buildSteps.settings.repeatMode };
        });
        expect(info.count).toBe(info.modules);
        expect(info.next).toBe(info.firstGrouped + info.modules);
        expect(info.badge).toBeGreaterThan(5);
        expect(info.mode).toBe('skip');

        // Play the first grouped step to its end: skip mode jumps past the whole group
        await page.evaluate((i) => { globalThis.enterPlayback(i); globalThis.play(); }, info.firstGrouped);
        await expect(page.locator('#bs-caption-repeat')).toContainText(`Do this ${info.modules}×`);
        await expect.poll(() => page.evaluate(() => globalThis.state.buildPlayback.stepIndex), { timeout: 60_000 }).toBe(info.next);
        await page.evaluate(() => globalThis.pause());
        await page.waitForTimeout(400);
        const visibleBottom = await page.evaluate(() => globalThis.threeRenderer.beamGroup.children.filter((m) => m.visible && m.userData.beam && m.userData.beam.stackType === 'horizontal-bottom').length);
        expect(visibleBottom).toBe(await page.evaluate(() => globalThis.state.modules * globalThis.state.hStackCount)); // one bottom stack per module

        // Fast-forward mode plays every member; the second member runs faster
        await page.selectOption('#bs-sel-repeat', 'fast');
        await page.evaluate((i) => { globalThis.goToStep(i, { immediate: true }); globalThis.state.buildPlayback.playing = true; for (let k = 0; k < 40; k++) globalThis.stepFrame(100); globalThis.state.buildPlayback.playing = false; }, info.firstGrouped);
        await expect.poll(() => page.evaluate(() => globalThis.state.buildPlayback.stepIndex)).toBe(info.firstGrouped + 1);
        await expect(page.locator('#bs-caption-notes')).toContainText('fast-forward');
        await page.keyboard.press('Escape');

        // Manual grouping of two adjacent ungrouped steps
        await page.evaluate(() => {
            const bs = globalThis.state.buildSteps;
            bs.steps = bs.steps.slice(0, 2).map((s) => ({ ...s, groupId: null }));
            globalThis.refreshBuildStepsUI();
        });
        await page.click('#bs-step-list .bs-step:nth-child(1)');
        await page.click('#bs-step-list .bs-step:nth-child(2)', { modifiers: ['Control'] });
        await page.click('#bs-btn-group');
        await expect.poll(() => page.evaluate(() => globalThis.state.buildSteps.steps.map((s) => !!s.groupId))).toEqual([true, true]);
        await expect(page.locator('.bs-group-badge')).toHaveText('×2');
    });
});
