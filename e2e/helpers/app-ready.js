import { expect } from '@playwright/test';

export const REQUIRED_MODULES = [
    'main',
    'solver',
    'renderer3d',
    'uiBindings',
    'configPersistence',
    'validation',
];

export const BUILD_ID_PATTERN = /phase-5b/;

/** Wait until LinkageLab bootstrap finishes and the workspace is interactive. */
export async function waitForAppReady(page) {
    await expect(page.locator('text=LinkageLab failed to start')).toHaveCount(0);

    await page.waitForFunction((modules) => {
        const linkageModules = globalThis.LinkageModules;
        if (!linkageModules) return false;
        return modules.every((name) => linkageModules[name]);
    }, REQUIRED_MODULES, { timeout: 60_000 });

    await expect(page.locator('#view-linkage #canvas-webgl')).toBeAttached();
    await expect(page.locator('#view-linkage #sidebar')).toBeVisible();
}
