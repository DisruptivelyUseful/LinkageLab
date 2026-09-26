// ============================================================================
// LINKAGE LAB — Covering cut plan: nesting + fabric patterns + BOM rows
//
// Sits between the per-render geometry (data.coverings) and the consumers
// that need shop output (sidebar readout, Build Guide, downloads). Memoized on
// the rounded shape geometry and the stock/fabric settings, so it is cheap to
// call on every render and only recomputes when something that matters moved.
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { nestPolygonOnSheets } from './sheet-nesting.js';
import { buildFabricPattern } from './fabric-patterns.js';
import { buildSheetCutSvg, buildFabricPatternSvg, buildWallOverviewSvg } from '../core/svg-cut-file.js';
import { formatInchesFraction } from '../core/unit-converter.js';

let cache = { key: null, plan: null };
const round = (v, p = 2) => +(+v).toFixed(p);

function planKey(covData, cov) {
    const shapes = (covData.shapes || []).map(s => [s.kind, s.spanIndex, s.band, s.corners2D.map(p => [round(p.s, 2), round(p.t, 2)])]);
    return JSON.stringify([shapes, cov.sheet, cov.fabric, cov.table]);
}

/**
 * @param {Object} covData - data.coverings (from computeCoverings)
 * @param {Object} cov - state.coverings
 */
export function computeCoveringCutPlan(covData, cov) {
    if (!covData || !covData.supported || !cov) return emptyPlan();
    const key = planKey(covData, cov);
    if (cache.key === key && cache.plan) return cache.plan;

    const stock = { ...cov.sheet };
    const walls = [], tables = [], fabric = [];
    (covData.shapes || []).forEach(shape => {
        if (shape.kind === 'wall') walls.push({ shape, nest: nestPolygonOnSheets(shape.corners2D, stock) });
        else if (shape.kind === 'table') tables.push({ shape, nest: nestPolygonOnSheets(shape.corners2D, { ...stock, thicknessIn: cov.table.thicknessIn }) });
        else if (shape.kind === 'fabric') fabric.push({ shape, pattern: buildFabricPattern(shape.corners2D, cov.fabric) });
    });
    const order = (a, b) => (a.shape.spanIndex - b.shape.spanIndex) || String(a.shape.band).localeCompare(String(b.shape.band));
    walls.sort(order); tables.sort(order); fabric.sort(order);

    const sheetItems = walls.concat(tables);
    const totals = {
        walls: walls.length,
        tables: tables.length,
        fabricBands: fabric.length,
        sheets: sheetItems.reduce((a, w) => a + w.nest.sheetCount, 0),
        fullSheets: sheetItems.reduce((a, w) => a + w.nest.pieces.filter(p => p.isFullSheet).length, 0),
        cutPieces: sheetItems.reduce((a, w) => a + w.nest.pieces.filter(p => !p.isFullSheet).length, 0),
        plywoodAreaIn2: round(sheetItems.reduce((a, w) => a + w.nest.polygonAreaIn2, 0), 1),
        stockAreaIn2: round(sheetItems.reduce((a, w) => a + w.nest.stockAreaIn2, 0), 1),
        seams: sheetItems.reduce((a, w) => a + w.nest.seamCount, 0),
        battenLinearIn: round(sheetItems.reduce((a, w) => a + w.nest.seamLinearIn, 0), 1),
        fabricYards: round(fabric.reduce((a, f) => a + f.pattern.fabricYards, 0), 2),
        fabricAreaIn2: round(fabric.reduce((a, f) => a + f.pattern.areaIn2, 0), 1),
        fabricPanels: fabric.reduce((a, f) => a + f.pattern.panelCount, 0),
        grommets: fabric.reduce((a, f) => a + f.pattern.grommetCount, 0),
        warnings: sheetItems.reduce((a, w) => a + w.nest.warnings.filter(x => x.code !== 'batten').length, 0),
    };
    totals.utilization = totals.stockAreaIn2 > 0 ? round(totals.plywoodAreaIn2 / totals.stockAreaIn2, 3) : 0;

    const plan = { key, walls, tables, fabric, totals, stock, fabricCfg: { ...cov.fabric }, tableCfg: { ...cov.table } };
    cache = { key, plan };
    return plan;
}

function emptyPlan() {
    return {
        key: null, walls: [], tables: [], fabric: [],
        totals: { walls: 0, tables: 0, fabricBands: 0, sheets: 0, fullSheets: 0, cutPieces: 0, plywoodAreaIn2: 0, stockAreaIn2: 0, seams: 0, battenLinearIn: 0, fabricYards: 0, fabricAreaIn2: 0, fabricPanels: 0, grommets: 0, warnings: 0, utilization: 0 },
        stock: null, fabricCfg: null, tableCfg: null,
    };
}

/** Clears the memo (tests). */
export function resetCoveringPlanCache() {
    cache = { key: null, plan: null };
}

/**
 * BOM line items for the ENCLOSURE section.
 * @param {Object} plan - computeCoveringCutPlan result
 * @param {Object} st - app state (costPlywoodSheet, costFabricYard, costGrommet)
 */
export function coveringBomItems(plan, st) {
    const items = [];
    if (!plan) return items;
    const t = plan.totals;
    const sheetPrice = +(st.costPlywoodSheet ?? 45);
    const yardPrice = +(st.costFabricYard ?? 8);
    const grommetPrice = +(st.costGrommet ?? 0.25);
    if (t.sheets > 0) {
        const s = plan.stock;
        items.push({
            key: 'plywoodSheet', stateKey: 'costPlywoodSheet', sidebarId: 'nb-cost-plywood',
            qty: t.sheets,
            item: `Plywood sheets ${formatInchesFraction(s.widthIn)} × ${formatInchesFraction(s.lengthIn)} × ${formatInchesFraction(s.thicknessIn)} (${t.walls} wall${t.walls === 1 ? '' : 's'}${t.tables ? `, ${t.tables} table${t.tables === 1 ? '' : 's'}` : ''})`,
            unit: sheetPrice, total: round(t.sheets * sheetPrice),
        });
    }
    if (t.fabricYards > 0) {
        items.push({
            key: 'fabricYard', stateKey: 'costFabricYard', sidebarId: 'nb-cost-fabric',
            qty: Math.ceil(t.fabricYards),
            item: `Fabric, ${formatInchesFraction(plan.fabricCfg.rollWidthIn)} roll (${t.fabricBands} band${t.fabricBands === 1 ? '' : 's'}, ${t.fabricPanels} panel${t.fabricPanels === 1 ? '' : 's'})`,
            unit: yardPrice, total: round(Math.ceil(t.fabricYards) * yardPrice),
        });
    }
    if (t.grommets > 0) {
        items.push({
            key: 'grommet', stateKey: 'costGrommet', sidebarId: 'nb-cost-grommet',
            qty: t.grommets, item: 'Grommets', unit: grommetPrice, total: round(t.grommets * grommetPrice),
        });
    }
    return items;
}

export function coveringEnclosureCost(plan, st) {
    return round(coveringBomItems(plan, st).reduce((a, it) => a + it.total, 0));
}

/** Title lines stamped on every cut file / diagram. */
export function coveringFileLines(shape, st, extra = []) {
    const fold = st && st.foldAngle != null ? `${(st.foldAngle * 180 / Math.PI).toFixed(1)}°` : '?';
    return [
        `${shape.label || 'Covering'} · ${shape.kind === 'fabric' ? 'fabric' : 'plywood'}`,
        `Cuts assume fold angle ${fold} · ${st && st.modules ? st.modules + ' modules' : ''} · ${new Date().toISOString().slice(0, 10)}`,
        ...extra,
    ];
}

/** SVG text for one plan entry (wall/table → sheet cut file, fabric → pattern). */
export function coveringEntrySvg(entry, st) {
    const shape = entry.shape;
    if (entry.pattern) {
        return buildFabricPatternSvg(entry.pattern, {
            title: `${shape.label} fabric pattern`,
            lines: coveringFileLines(shape, st, [`Finished ${formatInchesFraction(shape.widthBottomIn)} → ${formatInchesFraction(shape.widthTopIn)} × ${formatInchesFraction(shape.slantHeightIn)} before shrink`]),
        });
    }
    return buildSheetCutSvg(entry.nest, {
        title: `${shape.label} sheet cuts`,
        lines: coveringFileLines(shape, st, [
            `Trapezoid ${formatInchesFraction(shape.widthBottomIn)} bottom · ${formatInchesFraction(shape.widthTopIn)} top · ${formatInchesFraction(shape.slantHeightIn)} ${shape.kind === 'table' ? 'deep' : 'slant'} · tilt ${(+shape.tiltFromVerticalDeg).toFixed(1)}°`,
            `${entry.nest.sheetCount} sheet${entry.nest.sheetCount === 1 ? '' : 's'} (${entry.nest.orientation}), ${Math.round(entry.nest.utilization * 100)}% used`,
        ]),
    });
}

/** Inline overview SVG (polygon + sheet grid) for one plan entry. */
export function coveringEntryOverviewSvg(entry) {
    return buildWallOverviewSvg(entry.shape, entry.nest || null);
}

/** File name for a plan entry's cut file. */
export function coveringEntryFilename(entry, prefix = 'linkagelab') {
    const s = entry.shape;
    const kind = s.kind === 'fabric' ? 'fabric' : (s.kind === 'table' ? 'table' : 'wall');
    return `${prefix}-span${(s.spanIndex ?? 0) + 1}-${s.band}-${kind}.svg`;
}

const _moduleExports = {
    computeCoveringCutPlan,
    resetCoveringPlanCache,
    coveringBomItems,
    coveringEnclosureCost,
    coveringFileLines,
    coveringEntrySvg,
    coveringEntryOverviewSvg,
    coveringEntryFilename,
};

bridgeGlobals(_moduleExports, 'coveringsPlan');
