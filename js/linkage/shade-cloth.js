// ============================================================================
// LINKAGE LAB — Roof shade tarps: one rectangle per module, laid radially
//
// Each module of the top ring gets its own tarp. Its width is the distance
// between that module's two outer pivots (the roof polygon's edge), it starts
// a little past the outer edge and runs inward toward the ring centre, so the
// N tarps fan around the roof and overlap at the middle. Width and length can
// be overridden, the whole array rotated, and every second tarp lifted so the
// overlaps drape over/under. Nothing is cut. Pure math (no DOM / THREE).
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { degToRad } from './math.js';
import { clipPolygonToRect, polygonArea } from './sheet-nesting.js';

export const DEFAULT_SHADE = Object.freeze({
    enabled: false,
    widthMode: 'auto',      // 'auto': the module's outer pivot distance; 'custom': widthIn
    widthIn: 120,
    widthTrimIn: 0,         // signed inches added to the width (+ overlap neighbours, − gap)
    lengthMode: 'auto',     // 'auto': outer edge → ring centre + centerOverlapIn; 'custom': lengthIn
    lengthIn: 240,
    centerOverlapIn: 12,    // how far an auto-length tarp runs past the ring centre
    overhangIn: 6,          // outer edge past the outer pivots (signed)
    rotationDeg: 0,         // rotate the whole array about the ring centre
    staggerIn: 0,           // every second tarp is lifted by this (signed)
    liftIn: 2,
    color: '#6f8f86',
    opacity: 0.75,
    visible: true,
});

export const SHADE_PRESETS = {
    '10x10': { widthIn: 120, lengthIn: 120 },
    '10x20': { widthIn: 120, lengthIn: 240 },
    '12x20': { widthIn: 144, lengthIn: 240 },
    '20x20': { widthIn: 240, lengthIn: 240 },
};

export const SHADE_SWATCHES = [
    { name: 'Shade mesh', color: '#6f8f86' },
    { name: 'Tarp blue', color: '#2f6fb3' },
    { name: 'Silver', color: '#b8bcc0' },
    { name: 'Canvas', color: '#c8b08a' },
    { name: 'Black', color: '#222222' },
];

const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (v, def) => (typeof v === 'number' && Number.isFinite(v)) ? v : def;
const clampNum = (v, def, min, max) => Math.max(min, Math.min(max, num(v, def)));
export const OFF_MAX = 1200;
export const LEN_MIN = 0.05, LEN_MAX = 2400;
export const PRICE_MAX = 100000;
const round = (v, p = 3) => +(+v).toFixed(p);

export function normalizeHexColor(v, def) {
    if (typeof v !== 'string') return def;
    const m = v.trim().match(/^#?([0-9a-fA-F]{6})$/);
    if (m) return '#' + m[1].toLowerCase();
    const s3 = v.trim().match(/^#?([0-9a-fA-F]{3})$/);
    if (s3) return '#' + s3[1].split('').map(ch => ch + ch).join('').toLowerCase();
    return def;
}

export function createDefaultShade() {
    return clone(DEFAULT_SHADE);
}

export function normalizeShade(raw) {
    const d = DEFAULT_SHADE;
    const r = raw && typeof raw === 'object' ? raw : {};
    // Phase-4/5 configs tiled a grid of stock cloths: keep their size as custom values.
    const legacy = r.widthMode === undefined && (r.overlapIn !== undefined || r.offsetXIn !== undefined || r.widthIn !== undefined);
    const mode = (v, fallback) => (v === 'auto' || v === 'custom') ? v : fallback;
    return {
        enabled: !!r.enabled,
        widthMode: mode(r.widthMode, legacy ? 'custom' : d.widthMode),
        widthIn: clampNum(r.widthIn, d.widthIn, LEN_MIN, LEN_MAX),
        widthTrimIn: clampNum(r.widthTrimIn, d.widthTrimIn, -OFF_MAX, OFF_MAX),
        lengthMode: mode(r.lengthMode, legacy ? 'custom' : d.lengthMode),
        lengthIn: clampNum(r.lengthIn, d.lengthIn, LEN_MIN, LEN_MAX),
        centerOverlapIn: clampNum(r.centerOverlapIn, d.centerOverlapIn, -OFF_MAX, OFF_MAX),
        overhangIn: clampNum(r.overhangIn, legacy ? 0 : d.overhangIn, -OFF_MAX, OFF_MAX),
        rotationDeg: clampNum(r.rotationDeg, d.rotationDeg, -360, 360),
        staggerIn: clampNum(r.staggerIn, d.staggerIn, -OFF_MAX, OFF_MAX),
        liftIn: clampNum(r.liftIn, d.liftIn, -OFF_MAX, OFF_MAX),
        color: normalizeHexColor(r.color, d.color),
        opacity: clampNum(r.opacity, d.opacity, 0.05, 1),
        visible: r.visible !== false,
    };
}

export function serializeShade(s) {
    return s ? clone(s) : null;
}

function beamTopY(b) {
    if (b.corners && b.corners.length) return Math.max(...b.corners.map(p => p.y));
    return Math.max(b.p1.y, b.p2.y);
}

/**
 * Outer polygon of the top ring: the outer ends of each module's top scissor
 * legs, clustered by angle into one vertex per shared outer pivot.
 */
export function calculateRoofPolygon(data, numModules) {
    const beams = (data && data.beams) || [];
    const top = beams.filter(b => b.stackType === 'horizontal-top' && b.p1 && b.p2);
    if (!top.length) return null;
    let cx = 0, cz = 0;
    top.forEach(b => { cx += (b.p1.x + b.p2.x) / 2; cz += (b.p1.z + b.p2.z) / 2; });
    cx /= top.length; cz /= top.length;
    const raw = [];
    for (let i = 0; i < numModules; i++) {
        top.filter(b => b.moduleIndex === i).forEach(b => {
            const far = Math.hypot(b.p1.x - cx, b.p1.z - cz) >= Math.hypot(b.p2.x - cx, b.p2.z - cz) ? b.p1 : b.p2;
            raw.push({ x: far.x, z: far.z });
        });
    }
    if (raw.length < 3) return null;
    const ang = (p) => Math.atan2(p.z - cz, p.x - cx);
    raw.sort((a, b) => ang(a) - ang(b));
    const tol = Math.PI / Math.max(3, numModules);
    const clusters = [];
    raw.forEach(p => {
        const last = clusters[clusters.length - 1];
        if (last && Math.abs(ang(p) - last.ang) < tol) { last.pts.push(p); last.ang = last.pts.reduce((a, q) => a + ang(q), 0) / last.pts.length; }
        else clusters.push({ pts: [p], ang: ang(p) });
    });
    if (clusters.length > 1) {
        const first = clusters[0], last = clusters[clusters.length - 1];
        if (Math.abs((last.ang - 2 * Math.PI) - first.ang) < tol) { first.pts.push(...last.pts); clusters.pop(); }
    }
    const pts = clusters.map(cl => ({ x: cl.pts.reduce((a, p) => a + p.x, 0) / cl.pts.length, z: cl.pts.reduce((a, p) => a + p.z, 0) / cl.pts.length }));
    if (pts.length < 3) return null;
    const c = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, z: pts.reduce((a, p) => a + p.z, 0) / pts.length };
    pts.sort((a, b) => Math.atan2(a.z - c.z, a.x - c.x) - Math.atan2(b.z - c.z, b.x - c.x));
    const topY = Math.max(...top.map(beamTopY));
    // Per-module outer midpoints (mean of the far ends of that module's top legs) to map edges → modules
    const modMid = [];
    for (let i = 0; i < numModules; i++) {
        const ends = top.filter(b => b.moduleIndex === i).map(b => (Math.hypot(b.p1.x - cx, b.p1.z - cz) >= Math.hypot(b.p2.x - cx, b.p2.z - cz) ? b.p1 : b.p2));
        if (ends.length) modMid.push({ moduleIndex: i, x: ends.reduce((a, p) => a + p.x, 0) / ends.length, z: ends.reduce((a, p) => a + p.z, 0) / ends.length });
    }
    const edges = pts.map((a, i) => {
        const b = pts[(i + 1) % pts.length];
        const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
        const chordIn = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const u = { x: (b.x - a.x) / chordIn, z: (b.z - a.z) / chordIn };
        const apothemIn = Math.hypot(mid.x - c.x, mid.z - c.z) || 1;
        const nOut = { x: (mid.x - c.x) / apothemIn, z: (mid.z - c.z) / apothemIn };
        let moduleIndex = i, best = Infinity;
        modMid.forEach(m => { const dd = Math.hypot(m.x - mid.x, m.z - mid.z); if (dd < best) { best = dd; moduleIndex = m.moduleIndex; } });
        return { index: i, a, b, mid, chordIn, apothemIn, u, nOut, moduleIndex };
    });
    return { vertices: pts, center: c, topY, edges };
}

/**
 * One tarp per module, laid radially from the outer pivots toward the centre.
 * @param {Object} data - geometry AFTER recentering
 * @param {Object} shade - state.shadeCloth
 * @param {Object} st - app state
 * @param {Object} [opts] - { coveringsTopY }
 */
export function calculateShadeCloths(data, shade, st, opts = {}) {
    const empty = { enabled: !!(shade && shade.enabled), supported: false, shapes: [], count: 0, coveragePct: 0, overhangIn2: 0, canopyAreaIn2: 0, polygon: null, sizes: [], warnings: [] };
    if (!shade || !shade.enabled || !st || st.orientation === 'vertical') return { ...empty, unsupportedReason: st && st.orientation === 'vertical' ? 'arch' : null };
    const roof = calculateRoofPolygon(data, st.modules);
    if (!roof || !roof.edges || !roof.edges.length) return { ...empty, unsupportedReason: 'no-ring' };

    const c = roof.center;
    const widthAuto = shade.widthMode !== 'custom';
    const lengthAuto = shade.lengthMode !== 'custom';
    const trim = num(shade.widthTrimIn, 0);
    const overhang = num(shade.overhangIn, 0);
    const centerOverlap = num(shade.centerOverlapIn, 0);
    const rot = degToRad(num(shade.rotationDeg, 0));
    const stagger = num(shade.staggerIn, 0);
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    const rotXZ = (p) => ({ x: c.x + (p.x - c.x) * cosR - (p.z - c.z) * sinR, z: c.z + (p.x - c.x) * sinR + (p.z - c.z) * cosR });
    const rotDir = (d) => ({ x: d.x * cosR - d.z * sinR, z: d.x * sinR + d.z * cosR });

    // Tarp Y: above the support / reciprocal beams when present, else the ring's top face,
    // and never below the top edge of the upper wall/fabric bands when those reach higher
    const beams = (data && data.beams) || [];
    const overBeams = beams.filter(b => b.stackType && b.stackType.startsWith('support-beam'));
    let baseY = overBeams.length ? Math.max(...overBeams.map(beamTopY)) : roof.topY;
    if (Number.isFinite(num(opts.coveringsTopY, NaN))) baseY = Math.max(baseY, opts.coveringsTopY);
    const yBase = baseY + num(shade.liftIn, 0);

    const roofXZ = roof.vertices;
    const canopyArea = polygonArea(roofXZ.map(p => ({ x: p.x, y: p.z })));
    const t = 0.1;
    const shapes = [];
    const warnings = [];
    let overhangTotal = 0;
    roof.edges.forEach((e, i) => {
        const W = Math.max(0.05, (widthAuto ? e.chordIn : num(shade.widthIn, 120)) + trim);
        const L = Math.max(0.05, lengthAuto ? e.apothemIn + overhang + centerOverlap : num(shade.lengthIn, 240));
        const u = rotDir(e.u), nOut = rotDir(e.nOut);
        const oc = rotXZ({ x: e.mid.x + e.nOut.x * overhang, z: e.mid.z + e.nOut.z * overhang });
        const y = yBase + (i % 2 ? stagger : 0);
        const cornersXZ = [
            { x: oc.x - u.x * W / 2, z: oc.z - u.z * W / 2 },
            { x: oc.x + u.x * W / 2, z: oc.z + u.z * W / 2 },
            { x: oc.x + u.x * W / 2 - nOut.x * L, z: oc.z + u.z * W / 2 - nOut.z * L },
            { x: oc.x - u.x * W / 2 - nOut.x * L, z: oc.z - u.z * W / 2 - nOut.z * L },
        ];
        // Roof polygon in the tarp frame (s along u from the outer-edge centre, t inward), for the covered area
        const toLocal = (p) => ({ x: (p.x - oc.x) * u.x + (p.z - oc.z) * u.z, y: -((p.x - oc.x) * nOut.x + (p.z - oc.z) * nOut.z) });
        const inside = clipPolygonToRect(roofXZ.map(toLocal), -W / 2, 0, W / 2, L);
        const insideArea = inside.length >= 3 ? polygonArea(inside) : 0;
        const corners3D = cornersXZ.map(p => ({ x: p.x, y, z: p.z }));
        shapes.push({
            type: 'covering',
            kind: 'shade',
            band: 'roof',
            coverType: 'shade',
            spanIndex: i,
            moduleIndex: e.moduleIndex,
            label: `Shade tarp ${i + 1} · Module ${e.moduleIndex + 1}`,
            corners3D,
            slabCorners3D: corners3D.map(p => ({ x: p.x, y: p.y - t / 2, z: p.z })).concat(corners3D.map(p => ({ x: p.x, y: p.y + t / 2, z: p.z }))),
            center: { x: (cornersXZ[0].x + cornersXZ[2].x) / 2, y, z: (cornersXZ[0].z + cornersXZ[2].z) / 2 },
            normal: { x: 0, y: 1, z: 0 },
            plan2D: cornersXZ.map(p => ({ x: round(p.x), z: round(p.z) })),
            frame: { origin: oc, u, inward: { x: -nOut.x, z: -nOut.z } },
            widthIn: round(W), lengthIn: round(L),
            outerPivotDistIn: round(e.chordIn),
            insideAreaIn2: round(insideArea, 1),
            overhangIn2: round(W * L - insideArea, 1),
            thicknessIn: t,
            areaIn2: round(W * L, 1),
            warnings: [],
        });
        overhangTotal += W * L - insideArea;
    });

    // Coverage: sample the roof polygon on a grid and count points under any tarp
    const xs = roofXZ.map(p => p.x), zs = roofXZ.map(p => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const insidePoly = (p) => {
        let inside = false;
        for (let i = 0, j = roofXZ.length - 1; i < roofXZ.length; j = i++) {
            const a = roofXZ[i], b = roofXZ[j];
            if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
        }
        return inside;
    };
    const underTarp = (p) => shapes.some(sh => {
        const f = sh.frame;
        const s = (p.x - f.origin.x) * f.u.x + (p.z - f.origin.z) * f.u.z;
        const d = (p.x - f.origin.x) * f.inward.x + (p.z - f.origin.z) * f.inward.z;
        return s >= -sh.widthIn / 2 - 1e-6 && s <= sh.widthIn / 2 + 1e-6 && d >= -1e-6 && d <= sh.lengthIn + 1e-6;
    });
    let hits = 0, total = 0;
    const N = 48;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const p = { x: minX + (i + 0.5) / N * (maxX - minX), z: minZ + (j + 0.5) / N * (maxZ - minZ) };
            if (!insidePoly(p)) continue;
            total++;
            if (underTarp(p)) hits++;
        }
    }
    const coveragePct = total ? round(100 * hits / total, 1) : 0;
    if (coveragePct < 99) warnings.push({ code: 'gaps', message: `Tarps cover ${coveragePct}% of the roof; add width trim, centre overlap or length to close the gaps.` });

    // Size groups for the BOM (rounded to 1/4")
    const sizeMap = new Map();
    shapes.forEach(sh => {
        const w = Math.round(sh.widthIn * 4) / 4, l = Math.round(sh.lengthIn * 4) / 4;
        const key = `${w}x${l}`;
        if (!sizeMap.has(key)) sizeMap.set(key, { widthIn: w, lengthIn: l, qty: 0 });
        sizeMap.get(key).qty++;
    });
    const sizes = [...sizeMap.values()].sort((a, b) => b.qty - a.qty || b.widthIn - a.widthIn);

    return {
        enabled: true,
        supported: true,
        unsupportedReason: null,
        polygon: { vertices: roofXZ.map(p => ({ x: p.x, y: yBase, z: p.z })), center: { x: c.x, y: yBase, z: c.z } },
        y: round(yBase),
        shapes,
        count: shapes.length,
        canopyAreaIn2: round(canopyArea, 1),
        clothAreaIn2: round(shapes.reduce((a, sh) => a + sh.areaIn2, 0), 1),
        overhangIn2: round(overhangTotal, 1),
        coveragePct,
        sizes,
        widthIn: sizes.length ? sizes[0].widthIn : 0,
        lengthIn: sizes.length ? sizes[0].lengthIn : 0,
        widthMode: widthAuto ? 'auto' : 'custom',
        lengthMode: lengthAuto ? 'auto' : 'custom',
        rotationDeg: num(shade.rotationDeg, 0),
        staggerIn: stagger,
        overhangIn: overhang,
        color: normalizeHexColor(shade.color, DEFAULT_SHADE.color),
        opacity: clampNum(shade.opacity, DEFAULT_SHADE.opacity, 0.05, 1),
        warnings,
    };
}

const ft = (v) => (v / 12).toFixed(Math.abs(v % 12) > 1e-6 ? 1 : 0);

/** BOM rows for the ENCLOSURE section, one per tarp size (empty when no tarps). */
export function shadeBomItems(shadeData, st) {
    if (!shadeData || !shadeData.count) return [];
    const unit = num(st && st.costShadeCloth, 60);
    const sizes = shadeData.sizes && shadeData.sizes.length ? shadeData.sizes : [{ widthIn: shadeData.widthIn, lengthIn: shadeData.lengthIn, qty: shadeData.count }];
    return sizes.map((sz, i) => ({
        key: i === 0 ? 'shadeCloth' : `shadeCloth${i}`, stateKey: 'costShadeCloth', sidebarId: 'nb-cost-shade',
        qty: sz.qty,
        item: `Shade tarps ${ft(sz.widthIn)} × ${ft(sz.lengthIn)} ft${i === 0 ? ` (one per module, ${shadeData.coveragePct}% roof coverage)` : ''}`,
        unit, total: round(sz.qty * unit, 2),
    }));
}

/** Single summary row (first size group, total across all tarps) for callers that want one line. */
export function shadeBomItem(shadeData, st) {
    const rows = shadeBomItems(shadeData, st);
    if (!rows.length) return null;
    return { ...rows[0], qty: shadeData.count, total: round(rows.reduce((a, r) => a + r.total, 0), 2) };
}

const _moduleExports = { DEFAULT_SHADE, SHADE_PRESETS, SHADE_SWATCHES, createDefaultShade, normalizeShade, normalizeHexColor, serializeShade, calculateRoofPolygon, calculateShadeCloths, shadeBomItems, shadeBomItem, OFF_MAX, LEN_MIN, LEN_MAX, PRICE_MAX };
bridgeGlobals(_moduleExports, 'shadeCloth');
