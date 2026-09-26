import { test, expect } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.js';
import { installOfflineCdn } from './helpers/offline-cdn.js';

test.describe('coverings', () => {
    test.beforeEach(async ({ page }) => {
        await installOfflineCdn(page);
        await page.addInitScript(() => localStorage.clear());
    });

    test('sidebar group toggles spans, renders walls, and autosaves', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto('/index.html');
        await waitForAppReady(page);

        const group = page.locator('#sidebar .group[data-group="coverings"]');
        await expect(group).toBeVisible();
        await group.locator('.group-title').click();
        await expect(group).not.toHaveClass(/collapsed/);

        // Cylinder mode with a closed ring: enabling shows the ring picker with one wedge set per span
        await page.locator('#chk-coverings').check();
        await expect(page.locator('#cov-controls')).toBeVisible();
        const modules = await page.evaluate(() => globalThis.state.modules);
        await expect(page.locator('#cov-ring-picker .cov-wedge[data-band="lower"]')).toHaveCount(modules);

        // Click span 2's lower wedge: none → plywood, then the upper wedge → plywood → fabric
        await page.locator('.cov-wedge[data-span="1"][data-band="lower"]').click();
        await expect.poll(() => page.evaluate(() => globalThis.state.coverings.spans[1].lower)).toBe('plywood');
        await page.locator('.cov-wedge[data-span="1"][data-band="upper"]').click();
        await page.locator('.cov-wedge[data-span="1"][data-band="upper"]').click();
        await expect.poll(() => page.evaluate(() => globalThis.state.coverings.spans[1].upper)).toBe('fabric');
        await page.locator('.cov-wedge[data-span="1"][data-band="table"]').click();
        await expect.poll(() => page.evaluate(() => globalThis.state.coverings.spans[1].table)).toBe(true);

        // Geometry + meshes: one wall, one fabric band, one table in the scene
        await expect.poll(() => page.evaluate(() => {
            const tr = globalThis.threeRenderer;
            return [tr.coveringWallGroup.children.length, tr.coveringFabricGroup.children.length, tr.coveringTableGroup.children.length];
        })).toEqual([1, 1, 1]);
        const shape = await page.evaluate(() => {
            const d = globalThis.buildLinkageGeometry({ useCache: true });
            const s = d.coverings.shapes.find(x => x.kind === 'wall');
            return { supported: d.coverings.supported, closed: d.coverings.closed, w: s.widthBottomIn, wt: s.widthTopIn, h: s.verticalHeightIn, tilt: s.tiltFromVerticalDeg };
        });
        expect(shape.supported).toBe(true);
        expect(shape.closed).toBe(true);
        expect(shape.h).toBeCloseTo(48, 1);
        expect(shape.w).toBeGreaterThan(shape.wt);
        expect(Math.abs(shape.tilt)).toBeGreaterThan(5);
        await expect(page.locator('#cov-stat-walls')).toHaveText('1');

        // Enclose fills every span
        await page.locator('#btn-cov-enclose').click();
        await expect.poll(() => page.evaluate(() => globalThis.state.coverings.spans.every(s => s.lower === 'plywood' && s.upper === 'fabric'))).toBe(true);
        await expect.poll(() => page.evaluate(() => globalThis.threeRenderer.coveringWallGroup.children.length)).toBe(modules);

        // Persisted through the config snapshot used by autosave / project store
        const snap = await page.evaluate(() => globalThis.getConfigSnapshot());
        expect(snap.coverings.enabled).toBe(true);
        expect(snap.coverings.spans[1].table).toBe(true);
        expect(snap.coverings.spans.length).toBe(modules);

        // Arch mode: hint shown, controls hidden, no meshes
        await page.selectOption('#sel-orientation', 'vertical');
        await expect(page.locator('#cov-mode-hint')).toBeVisible();
        await expect(page.locator('#cov-controls')).toBeHidden();
        await expect.poll(() => page.evaluate(() => globalThis.threeRenderer.coveringWallGroup.children.length)).toBe(0);
        await page.selectOption('#sel-orientation', 'horizontal');
        await expect(page.locator('#cov-controls')).toBeVisible();
        await expect.poll(() => page.evaluate(() => globalThis.threeRenderer.coveringWallGroup.children.length)).toBe(modules);

        expect(errors).toEqual([]);
    });

    test('config import restores spans and the ring picker', async ({ page }) => {
        await page.goto('/index.html');
        await waitForAppReady(page);
        await page.evaluate(() => {
            const snap = globalThis.getConfigSnapshot();
            snap.coverings.enabled = true;
            snap.coverings.spans[0].lower = 'fabric';
            snap.coverings.spans[3].lower = 'plywood';
            snap.coverings.spans[3].table = true;
            globalThis.applyConfig(snap, true);
        });
        await expect(page.locator('#chk-coverings')).toBeChecked();
        await expect(page.locator('.cov-wedge[data-span="3"][data-band="lower"]')).toHaveAttribute('fill', '#c9a46a');
        await expect(page.locator('.cov-wedge[data-span="0"][data-band="lower"]')).toHaveAttribute('fill', '#5fb3a1');
        await expect(page.locator('.cov-wedge[data-span="3"][data-band="table"]')).toHaveAttribute('fill', '#e0c48a');
        await expect(page.locator('#cov-stat-tables')).toHaveText('1');
    });
});

test.describe('coverings: build guide and exports', () => {
    test.beforeEach(async ({ page }) => {
        await installOfflineCdn(page);
        await page.addInitScript(() => localStorage.clear());
    });

    test('guide lists sheet cuts and fabric patterns; SVG, CSV and PDF exports run', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto('/index.html');
        await waitForAppReady(page);
        await page.evaluate(() => {
            globalThis.state.coverings.enabled = true;
            globalThis.state.coverings.spans.forEach((s, i) => { s.lower = 'plywood'; s.upper = i % 2 ? 'fabric' : 'none'; s.table = i === 0; });
            globalThis.syncCoveringsUIFromState();
            globalThis.requestRender();
        });
        await expect(page.locator('#cov-stat-sheets')).not.toHaveText('--');
        await expect(page.locator('#cov-stat-yards')).not.toHaveText('--');
        await expect(page.locator('#cov-stat-cost')).toContainText('$');

        // Build guide sections
        await page.evaluate(() => globalThis.showBuildGuide());
        const guide = page.locator('#guide-content');
        await expect(guide).toContainText('Wall Panels & Sheet Cuts');
        await expect(guide).toContainText('Fabric Panels');
        await expect(guide).toContainText('Tables');
        await expect(guide).toContainText('ENCLOSURE');
        const modules = await page.evaluate(() => globalThis.state.modules);
        await expect(guide.locator('.guide-coverings .guide-cut-svg svg')).toHaveCount(modules + modules / 2 + 1);
        await expect(guide.locator('.guide-cut-table').first()).toContainText('@');
        // editing the plywood price in the guide updates state, sidebar and total
        const before = await page.evaluate(() => parseFloat(document.getElementById('guide-bom-grand-total').textContent.replace(/[$,]/g, '')));
        const priceInput = guide.locator('input[data-bom-state="costPlywoodSheet"]');
        await priceInput.fill('60');
        await priceInput.dispatchEvent('input');
        await expect.poll(() => page.evaluate(() => globalThis.state.costPlywoodSheet)).toBe(60);
        await expect(page.locator('#nb-cost-plywood')).toHaveValue('60.00');
        const after = await page.evaluate(() => parseFloat(document.getElementById('guide-bom-grand-total').textContent.replace(/[$,]/g, '')));
        expect(after).toBeGreaterThan(before);

        // Downloads: cut files (one per wall/table/fabric band), CSV and PDF
        const downloads = [];
        page.on('download', (d) => downloads.push(d.suggestedFilename()));
        await page.evaluate(() => globalThis.exportCoveringCutFiles());
        await expect.poll(() => downloads.length, { timeout: 15000 }).toBe(modules + modules / 2 + 1);
        expect(downloads.filter(n => n.endsWith('-wall.svg'))).toHaveLength(modules);
        expect(downloads.filter(n => n.endsWith('-fabric.svg'))).toHaveLength(modules / 2);
        expect(downloads.filter(n => n.endsWith('-table.svg'))).toHaveLength(1);
        await page.evaluate(() => globalThis.exportBOMcsv());
        await expect.poll(() => downloads.some(n => n.endsWith('.csv'))).toBe(true);
        await page.evaluate(() => globalThis.exportGuidePDF());
        await expect.poll(() => downloads.some(n => n.endsWith('.pdf')), { timeout: 30000 }).toBe(true);
        expect(errors).toEqual([]);
    });
});
