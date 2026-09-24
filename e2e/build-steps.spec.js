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
});
