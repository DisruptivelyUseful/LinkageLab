import { expect } from '@playwright/test';

export const REQUIRED_MODULES = [
    'main',
    'solver',
    'renderer3d',
    'uiBindings',
    'configPersistence',
    'validation',
];

export const BUILD_ID_PATTERN = /phase-5d/;

async function waitForLinkageReady(page) {
    await page.waitForFunction((modules) => {
        const linkageModules = globalThis.LinkageModules;
        if (!linkageModules) return false;
        return modules.every((name) => linkageModules[name]);
    }, REQUIRED_MODULES, { timeout: 60_000 });

    await expect(page.locator('#view-linkage #canvas-webgl')).toBeAttached();
    await expect(page.locator('#view-linkage #sidebar')).toBeVisible();
}

async function waitForSolarDesignReady(page) {
    await page.waitForFunction(() => {
        return typeof globalThis.SolarDesigner !== 'undefined'
            && globalThis.SolarDesigner.isInitialized();
    }, { timeout: 60_000 });

    await expect(page.locator('#view-solar-design #solar-canvas')).toBeVisible();
}

async function waitForSolarSimulateReady(page) {
    await expect(page.locator('#view-solar-simulate')).toHaveClass(/active/);
    await expect(page.locator('#view-solar-simulate .solar-simulator-frame')).toBeVisible();
}

/** Wait until the unified app shell finishes booting for the active mode. */
export async function waitForAppReady(page) {
    await expect(page.locator('text=LinkageLab failed to start')).toHaveCount(0);

    await page.waitForFunction(() => {
        return typeof globalThis.AppRouter?.getCurrentMode === 'function';
    }, { timeout: 60_000 });

    await page.waitForFunction(() => {
        const normalized = (location.hash || '').replace(/^#/, '').replace(/^\//, '');
        let expected = 'linkage';
        if (normalized === 'solar/design') expected = 'solar-design';
        else if (normalized === 'solar/simulate') expected = 'solar-simulate';
        return globalThis.AppRouter.getCurrentMode() === expected;
    }, { timeout: 60_000 });

    const mode = await page.evaluate(() => globalThis.AppRouter.getCurrentMode());

    if (mode === 'solar-design') {
        await waitForSolarDesignReady(page);
        return;
    }

    if (mode === 'solar-simulate') {
        await waitForSolarSimulateReady(page);
        return;
    }

    await waitForLinkageReady(page);
}
