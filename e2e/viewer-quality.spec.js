import { test, expect } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.js';
import { installOfflineCdn } from './helpers/offline-cdn.js';

const setSunTime = (page, value) => page.evaluate((v) => {
    const sl = document.getElementById('sl-sun-time');
    sl.value = String(v);
    sl.dispatchEvent(new Event('input'));
}, value);

const enablePanelsDeployed = (page) => page.evaluate(() => {
    const s = globalThis.state;
    s.solarPanels.enabled = true;
    s.animation.panelsVisibleAngle = 5;
    s.foldAngle = globalThis.getOptimalClosedAngleForAnimation();
    globalThis.invalidateGeometryCache();
    globalThis.requestRender();
});

test.describe('Viewer quality (studio rendering)', () => {
    test.beforeEach(async ({ page }) => {
        await installOfflineCdn(page);
        await page.goto('/index.html');
        await waitForAppReady(page);
    });

    test('renderer runs the studio pipeline: sRGB, ACES, physical lights, IBL, CSS sky', async ({ page }) => {
        const flags = await page.evaluate(() => {
            const tr = globalThis.threeRenderer;
            const r = tr.main;
            return {
                toneMapping: r.toneMapping,
                outputEncoding: r.outputEncoding,
                physical: r.physicallyCorrectLights,
                shadowType: r.shadowMap.type,
                background: tr.mainScene.background,
                environment: !!tr.mainScene.environment,
                studio: !!tr.studio,
                keyIsSun: tr.sunLight === tr.studio.key,
                ground: !!tr.mainScene.getObjectByName('StudioGround'),
                grid: !!tr.mainScene.getObjectByName('StudioGrid'),
                skyTop: getComputedStyle(document.documentElement).getPropertyValue('--sky-top').trim(),
            };
        });
        expect(flags.toneMapping).toBe(4);       // THREE.ACESFilmicToneMapping
        expect(flags.outputEncoding).toBe(3001); // THREE.sRGBEncoding
        expect(flags.physical).toBe(true);
        expect(flags.shadowType).toBe(2);        // THREE.PCFSoftShadowMap
        expect(flags.background).toBeNull();
        expect(flags.environment).toBe(true);
        expect(flags.studio).toBe(true);
        expect(flags.keyIsSun).toBe(true);
        expect(flags.ground).toBe(true);
        expect(flags.grid).toBe(true);
        expect(flags.skyTop).toMatch(/^#[0-9a-f]{6}$/);
    });

    test('beams carry the wood grain and panels the textured clearcoat cell material', async ({ page }) => {
        await enablePanelsDeployed(page);
        await expect.poll(() => page.evaluate(() => globalThis.threeRenderer.panelGroup.children.length)).toBeGreaterThan(0);
        const mats = await page.evaluate(() => {
            const tr = globalThis.threeRenderer;
            const beam = tr.beamGroup.children.find((m) => m.userData && m.userData.beam);
            const panel = tr.panelGroup.children[0];
            const pm = Array.isArray(panel.material) ? panel.material : [panel.material];
            return {
                beamType: beam.material.type,
                beamHasMap: !!beam.material.map,
                beamHasUv: !!beam.geometry.attributes.uv,
                panelIsMesh: panel.isMesh === true,
                panelTagged: panel.userData.type === 'panel' && !!panel.userData.panel,
                panelTop: pm[0].type,
                panelTopHasMap: !!pm[0].map,
                panelGroups: panel.geometry.groups.length,
            };
        });
        expect(mats.beamType).toBe('MeshStandardMaterial');
        expect(mats.beamHasMap).toBe(true);
        expect(mats.beamHasUv).toBe(true);
        expect(mats.panelIsMesh).toBe(true);
        expect(mats.panelTagged).toBe(true);
        expect(mats.panelTop).toBe('MeshPhysicalMaterial');
        expect(mats.panelTopHasMap).toBe(true);
        expect(mats.panelGroups).toBe(3);
    });

    test('the time-of-day slider runs a full day: moon, stars and a night sky at 02:00', async ({ page }) => {
        await setSunTime(page, 50);
        const noon = await page.evaluate(() => {
            const s = globalThis.threeRenderer.studio;
            return { night: s.model.night, key: s.key.intensity, moon: s.moon.visible, stars: s.stars.visible, clock: document.getElementById('sun-time-display').textContent };
        });
        expect(noon.night).toBeLessThan(0.05);
        expect(noon.key).toBeGreaterThan(1);
        expect(noon.moon).toBe(false);
        expect(noon.stars).toBe(false);
        expect(noon.clock).toBe('12:00 PM');

        await setSunTime(page, 8.333);
        const night = await page.evaluate(() => {
            const s = globalThis.threeRenderer.studio;
            return { night: s.model.night, key: s.key.visible, moon: s.moon.visible, moonI: s.moon.intensity, stars: s.stars.visible, clock: document.getElementById('sun-time-display').textContent, skyTop: getComputedStyle(document.documentElement).getPropertyValue('--sky-top').trim() };
        });
        expect(night.night).toBeGreaterThan(0.95);
        expect(night.key).toBe(false);
        expect(night.moon).toBe(true);
        expect(night.moonI).toBeGreaterThan(0.3);
        expect(night.stars).toBe(true);
        expect(night.clock).toBe('2:00 AM');
        expect(night.skyTop).toBe('#04060f');
    });

    test('IBC totes get the battery gauge and the night glow rig', async ({ page }) => {
        await page.evaluate(() => {
            globalThis.state.ibc.enabled = true;
            globalThis.invalidateGeometryCache();
            globalThis.requestRender();
        });
        await expect.poll(() => page.evaluate(() => globalThis.threeRenderer.ibcPivot.children.length), { timeout: 30_000 }).toBeGreaterThan(0);
        await setSunTime(page, 8.333);
        const ibc = await page.evaluate(() => {
            const tr = globalThis.threeRenderer;
            const bottles = [];
            tr.ibcPivot.traverse((o) => { if (o.isMesh && o.userData.ibcBottle) bottles.push(o); });
            const rig = tr.ibcPowerRig;
            return {
                tanks: tr.ibcPivot.children.length,
                bottles: bottles.length,
                battery: bottles.every((b) => b.material.userData.ibcBattery === true),
                rigVisible: rig.visible,
                lightsOn: rig.children.filter((c) => c.isPointLight && c.visible && c.intensity > 0).length,
                soc: globalThis.getIbcSoc(),
            };
        });
        expect(ibc.bottles).toBe(ibc.tanks);
        expect(ibc.battery).toBe(true);
        expect(ibc.rigVisible).toBe(true);
        expect(ibc.lightsOn).toBe(3);
        expect(ibc.soc).toBeCloseTo(0.6, 6);
    });
});

test.describe('Deploy preview', () => {
    test.beforeEach(async ({ page }) => {
        await installOfflineCdn(page);
        await page.goto('/index.html');
        await waitForAppReady(page);
        await enablePanelsDeployed(page);
    });

    test('plays the baked deploy sequence in place of the live structure and exits on edit', async ({ page }) => {
        const before = await page.evaluate(() => ({
            beams: globalThis.threeRenderer.beamGroup.children.length,
            structureVisible: globalThis.threeRenderer.structureGroup.visible,
        }));
        await expect(page.locator('#deploy-preview-controls')).toBeHidden();

        await page.evaluate(() => document.getElementById('btn-deploy-preview').click());
        await expect.poll(() => page.evaluate(() => globalThis.isDeployPreviewActive()), { timeout: 60_000 }).toBe(true);
        await expect(page.locator('#deploy-preview-controls')).toBeAttached();
        await expect(page.locator('#deploy-preview-controls')).not.toHaveAttribute('hidden', '');
        await expect(page.locator('#btn-deploy-enter')).toHaveAttribute('hidden', '');
        await expect(page.locator('#btn-deploy-preview')).toHaveAttribute('aria-pressed', 'true');

        const entered = await page.evaluate(() => ({
            structureVisible: globalThis.threeRenderer.structureGroup.visible,
            panelsVisible: globalThis.threeRenderer.panelGroupRoot.visible,
            preview: !!globalThis.threeRenderer.mainScene.getObjectByName('DeployPreview'),
            phase: document.getElementById('deploy-phase').textContent,
        }));
        expect(entered.structureVisible).toBe(false);
        expect(entered.panelsVisible).toBe(false);
        expect(entered.preview).toBe(true);
        expect(entered.phase).toContain('Deployed');

        // Scrubbing moves the baked nodes and relabels the phase
        const posAt = (t) => page.evaluate((t) => {
            globalThis.setDeployT(t);
            const s = globalThis.threeRenderer.mainScene.getObjectByName('DeployPreview').getObjectByName('Structure');
            return { pos: s.position.toArray(), phase: document.getElementById('deploy-phase').textContent };
        }, t);
        const packed = await posAt(0);
        expect(packed.phase).toContain('Packed');
        const mid = await posAt(0.4);
        expect(mid.phase).toMatch(/Unfolding \d+°/);
        const deployed = await posAt(1);
        expect(deployed.phase).toContain('Deployed');
        expect(packed.pos).not.toEqual(deployed.pos);

        // A full render must not un-hide the live structure while previewing
        await page.evaluate(() => globalThis.requestRender());
        await expect.poll(() => page.evaluate(() => globalThis.threeRenderer.structureGroup.visible)).toBe(false);

        // Transport buttons drive the preview
        await page.evaluate(() => document.getElementById('btn-anim-play').click());
        await expect.poll(() => page.evaluate(() => globalThis.deployPreview.playing)).toBe(true);
        await page.evaluate(() => document.getElementById('btn-anim-pause').click());
        await expect.poll(() => page.evaluate(() => globalThis.deployPreview.playing)).toBe(false);

        // Editing the structure leaves the preview and restores the live scene
        await page.evaluate(() => globalThis.updateState('modules', 10));
        await expect.poll(() => page.evaluate(() => globalThis.isDeployPreviewActive())).toBe(false);
        await expect(page.locator('#deploy-preview-controls')).toHaveAttribute('hidden', '');
        const after = await page.evaluate(() => ({
            structureVisible: globalThis.threeRenderer.structureGroup.visible,
            panelsVisible: globalThis.threeRenderer.panelGroupRoot.visible,
            preview: !!globalThis.threeRenderer.mainScene.getObjectByName('DeployPreview'),
            beams: globalThis.threeRenderer.beamGroup.children.length,
        }));
        expect(after.structureVisible).toBe(true);
        expect(after.panelsVisible).toBe(true);
        expect(after.preview).toBe(false);
        expect(after.beams).toBeGreaterThan(before.beams);
        expect(before.structureVisible).toBe(true);
    });

    test('the sidebar button enters and the Exit button restores the live structure', async ({ page }) => {
        await page.evaluate(() => document.getElementById('btn-deploy-enter').click());
        await expect.poll(() => page.evaluate(() => globalThis.isDeployPreviewActive()), { timeout: 60_000 }).toBe(true);
        await page.evaluate(() => document.getElementById('btn-deploy-exit').click());
        await expect.poll(() => page.evaluate(() => globalThis.isDeployPreviewActive())).toBe(false);
        await expect.poll(() => page.evaluate(() => globalThis.threeRenderer.structureGroup.visible)).toBe(true);
        await expect(page.locator('#btn-deploy-preview')).toHaveAttribute('aria-pressed', 'false');
    });
});
