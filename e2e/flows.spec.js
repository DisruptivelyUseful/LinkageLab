import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { waitForAppReady } from './helpers/app-ready.js';

async function setFoldAngle(page, degrees) {
    const foldInput = page.locator('#nb-fold');
    await foldInput.scrollIntoViewIfNeeded();
    await foldInput.fill(String(degrees));
    await foldInput.dispatchEvent('input');
    await page.waitForTimeout(50);
}

async function setModules(page, count) {
    const moduleInput = page.locator('#nb-mod');
    await moduleInput.scrollIntoViewIfNeeded();
    await moduleInput.fill(String(count));
    await moduleInput.dispatchEvent('change');
    await page.waitForTimeout(50);
}

test.describe('LinkageLab core flows', () => {
    test('fold slider updates state and keeps the viewport rendering', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        const before = await page.evaluate(() => ({
            foldDeg: globalThis.state.foldAngle * 180 / Math.PI,
            beamCount: globalThis.solveLinkage(globalThis.state.foldAngle).beams.length,
        }));

        await setFoldAngle(page, 90);

        const after = await page.evaluate(() => ({
            foldDeg: globalThis.state.foldAngle * 180 / Math.PI,
            beamCount: globalThis.solveLinkage(globalThis.state.foldAngle).beams.length,
        }));

        expect(after.foldDeg).toBeCloseTo(90, 0);
        expect(after.foldDeg).not.toBeCloseTo(before.foldDeg, 0);
        expect(after.beamCount).toBeGreaterThan(0);
        expect(after.beamCount).toBe(before.beamCount);

        await expect(page.locator('#canvas-webgl')).toBeVisible();
    });

    test('physics check toggle shows collision status panel', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        const colStatus = page.locator('#col-status');
        await expect(colStatus).toBeHidden();

        const physicsCheck = page.locator('#chk-collide');
        await physicsCheck.scrollIntoViewIfNeeded();
        await physicsCheck.check();

        await expect.poll(async () => page.evaluate(() => globalThis.state.enforceCollision)).toBe(true);
        await expect(colStatus).toBeVisible();

        const enforced = await page.evaluate(() => ({
            enforceCollision: globalThis.state.enforceCollision,
            collisionCount: globalThis.state.collisions?.length ?? 0,
            hasCollision: globalThis.state.hasCollision,
        }));

        expect(enforced.enforceCollision).toBe(true);
        expect(enforced.collisionCount).toBeGreaterThanOrEqual(0);
        expect(typeof enforced.hasCollision).toBe('boolean');
    });

    test('export JSON round-trip via file import restores changed modules', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        const targetModules = 11;
        await setModules(page, targetModules);

        const config = await page.evaluate(() => globalThis.getUnifiedConfig());
        expect(config.structure?.modules ?? config.modules).toBe(targetModules);

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkagelab-e2e-'));
        const configPath = path.join(tempDir, 'round-trip.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        await setModules(page, 8);
        expect(await page.evaluate(() => globalThis.state.modules)).toBe(8);

        const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.locator('#btn-import-json-top').click(),
        ]);
        await fileChooser.setFiles(configPath);

        await expect.poll(async () => page.evaluate(() => globalThis.state.modules)).toBe(targetModules);

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('save and load linkage config round-trip via localStorage', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);

        const targetModules = 9;
        await setModules(page, targetModules);

        await page.locator('#btn-save-top').click();
        await expect.poll(async () => page.evaluate(() => {
            const raw = localStorage.getItem('linkageLabProject')
                || localStorage.getItem('linkageLab_config');
            if (!raw) return null;
            const config = JSON.parse(raw);
            return config.structure?.modules ?? config.linkage?.structure?.modules ?? null;
        })).toBe(targetModules);

        await setModules(page, 6);
        expect(await page.evaluate(() => globalThis.state.modules)).toBe(6);

        await page.locator('#btn-load-top').click();
        await expect.poll(async () => page.evaluate(() => globalThis.state.modules)).toBe(targetModules);
    });
});
