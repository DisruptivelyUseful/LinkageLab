// ============================================================================
// LINKAGE LAB — Roof shade cloths: whole rectangles tiled over the top ring
//
// Off-the-shelf shade cloths are rectangles, so instead of cutting fabric to
// the roof outline we tile the outer polygon of the top ring with a rotatable
// grid of whole cloths (pitch = cloth size − overlap) and keep every cloth
// that touches the roof. Cloths overhang the edges; nothing is cut.
// Pure math (no DOM / THREE).
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { degToRad } from './math.js';
import { clipPolygonToRect, polygonArea } from './sheet-nesting.js';

export const DEFAULT_SHADE = Object.freeze({
    enabled: false,
    widthIn: 120,
    lengthIn: 240,
    rotationDeg: 0,
    overlapIn: 6,
    liftIn: 2,
    offsetXIn: 0,
    offsetZIn: 0,
    opacity: 0.75,
    visible: true,
});

export const SHADE_PRESETS = {
    '10x10': { widthIn: 120, lengthIn: 120 },
    '10x20': { widthIn: 120, lengthIn: 240 },
    '12x20': { widthIn: 144, lengthIn: 240 },
    '20x20': { widthIn: 240, lengthIn: 240 },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (v, def) => (typeof v === 'number' && Number.isFinite(v)) ? v : def;
const clampNum = (v, def, min, max) => Math.max(min, Math.min(max, num(v, def)));
const round = (v, p = 3) => +(+v).toFixed(p);

export function createDefaultShade() {
    return clone(DEFAULT_SHADE);
}

export function normalizeShade(raw) {
    const d = DEFAULT_SHADE;
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
        enabled: !!r.enabled,
        widthIn: clampNum(r.widthIn, d.widthIn, 12, 960),
        lengthIn: clampNum(r.lengthIn, d.lengthIn, 12, 960),
        rotationDeg: clampNum(r.rotationDeg, d.rotationDeg, -180, 180),
        overlapIn: clampNum(r.overlapIn, d.overlapIn, 0, 120),
        liftIn: clampNum(r.liftIn, d.liftIn, 0, 120),
        offsetXIn: clampNum(r.offsetXIn, d.offsetXIn, -480, 480),
        offsetZIn: clampNum(r.offsetZIn, d.offsetZIn, -480, 480),
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
    return { vertices: pts, center: c, topY };
}

/**
 * Tiles the roof polygon with whole cloths.
 * @param {Object} data - geometry AFTER recentering
 * @param {Object} shade - state.shadeCloth
 * @param {Object} st - app state
 */
export function calculateShadeCloths(data, shade, st) {
    const empty = { enabled: !!(shade && shade.enabled), supported: false, shapes: [], count: 0, coveragePct: 0, overhangIn2: 0, canopyAreaIn2: 0, polygon: null };
    if (!shade || !shade.enabled || !st || st.orientation === 'vertical') return { ...empty, unsupportedReason: st && st.orientation === 'vertical' ? 'arch' : null };
    const roof = calculateRoofPolygon(data, st.modules);
    if (!roof) return { ...empty, unsupportedReason: 'no-ring' };

    const W = num(shade.widthIn, 120), L = num(shade.lengthIn, 240);
    const ov = Math.min(num(shade.overlapIn, 0), Math.min(W, L) - 1);
    const rot = degToRad(num(shade.rotationDeg, 0));
    const c = roof.center;
    // Cloth Y: above the support / reciprocal beams when present, else the ring's top face
    const beams = (data && data.beams) || [];
    const overBeams = beams.filter(b => b.stackType && b.stackType.startsWith('support-beam'));
    const baseY = overBeams.length ? Math.max(...overBeams.map(beamTopY)) : roof.topY;
    const y = baseY + num(shade.liftIn, 0);

    // Work in a frame rotated by −rot about the roof centre (cloth edges axis-aligned)
    const cosR = Math.cos(-rot), sinR = Math.sin(-rot);
    const toLocal = (p) => ({ x: (p.x - c.x) * cosR - (p.z - c.z) * sinR, y: (p.x - c.x) * sinR + (p.z - c.z) * cosR });
    const toWorld = (q) => ({ x: c.x + q.x * Math.cos(rot) - q.y * Math.sin(rot), z: c.z + q.x * Math.sin(rot) + q.y * Math.cos(rot) });
    const local = roof.vertices.map(toLocal);
    const minX = Math.min(...local.map(p => p.x)), maxX = Math.max(...local.map(p => p.x));
    const minY = Math.min(...local.map(p => p.y)), maxY = Math.max(...local.map(p => p.y));
    const pitchX = L - ov, pitchY = W - ov;
    const cols = Math.max(1, Math.ceil((maxX - minX - ov) / pitchX));
    const rows = Math.max(1, Math.ceil((maxY - minY - ov) / pitchY));
    const extentX = cols * pitchX + ov, extentY = rows * pitchY + ov;
    const x0 = (minX + maxX) / 2 - extentX / 2 + num(shade.offsetXIn, 0);
    const y0 = (minY + maxY) / 2 - extentY / 2 + num(shade.offsetZIn, 0);
    const canopyArea = polygonArea(local);

    const shapes = [];
    let overhang = 0;
    for (let r = 0; r < rows; r++) {
        for (let k = 0; k < cols; k++) {
            const rx = x0 + k * pitchX, ry = y0 + r * pitchY;
            const inside = clipPolygonToRect(local, rx, ry, rx + L, ry + W);
            const insideArea = inside.length >= 3 ? polygonArea(inside) : 0;
            if (insideArea < 1) continue;
            const cornersL = [{ x: rx, y: ry }, { x: rx + L, y: ry }, { x: rx + L, y: ry + W }, { x: rx, y: ry + W }];
            const cornersW = cornersL.map(toWorld);
            const corners3D = cornersW.map(p => ({ x: p.x, y, z: p.z }));
            const t = 0.1;
            const idx = shapes.length;
            shapes.push({
                type: 'covering',
                kind: 'shade',
                band: 'roof',
                coverType: 'shade',
                spanIndex: idx,
                moduleIndex: 0,
                label: `Shade cloth ${idx + 1}`,
                row: r, col: k,
                corners3D,
                slabCorners3D: corners3D.map(p => ({ x: p.x, y: p.y - t / 2, z: p.z })).concat(corners3D.map(p => ({ x: p.x, y: p.y + t / 2, z: p.z }))),
                center: { x: (cornersW[0].x + cornersW[2].x) / 2, y, z: (cornersW[0].z + cornersW[2].z) / 2 },
                normal: { x: 0, y: 1, z: 0 },
                widthIn: W, lengthIn: L,
                insideAreaIn2: round(insideArea, 1),
                overhangIn2: round(L * W - insideArea, 1),
                localRect: { x: round(rx), y: round(ry), w: L, h: W },
                thicknessIn: t,
                areaIn2: L * W,
                warnings: [],
            });
            overhang += L * W - insideArea;
        }
    }

    // Coverage: sample the roof polygon on a grid and count points under any cloth
    let hits = 0, total = 0;
    const N = 48;
    const insidePoly = (p) => {
        let inside = false;
        for (let i = 0, j = local.length - 1; i < local.length; j = i++) {
            const a = local[i], b = local[j];
            if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
        }
        return inside;
    };
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const p = { x: minX + (i + 0.5) / N * (maxX - minX), y: minY + (j + 0.5) / N * (maxY - minY) };
            if (!insidePoly(p)) continue;
            total++;
            if (shapes.some(s => p.x >= s.localRect.x - 1e-6 && p.x <= s.localRect.x + s.localRect.w + 1e-6 && p.y >= s.localRect.y - 1e-6 && p.y <= s.localRect.y + s.localRect.h + 1e-6)) hits++;
        }
    }
    return {
        enabled: true,
        supported: true,
        unsupportedReason: null,
        polygon: { vertices: roof.vertices.map(p => ({ x: p.x, y, z: p.z })), center: { x: c.x, y, z: c.z }, local, localCenter: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } },
        y: round(y),
        rows, cols,
        shapes,
        count: shapes.length,
        canopyAreaIn2: round(canopyArea, 1),
        clothAreaIn2: round(shapes.length * L * W, 1),
        overhangIn2: round(overhang, 1),
        coveragePct: total ? round(100 * hits / total, 1) : 0,
        widthIn: W, lengthIn: L, rotationDeg: num(shade.rotationDeg, 0), overlapIn: ov,
    };
}

/** BOM row for the ENCLOSURE section (null when no cloths). */
export function shadeBomItem(shadeData, st) {
    if (!shadeData || !shadeData.count) return null;
    const unit = num(st && st.costShadeCloth, 60);
    return {
        key: 'shadeCloth', stateKey: 'costShadeCloth', sidebarId: 'nb-cost-shade',
        qty: shadeData.count,
        item: `Shade cloths ${(shadeData.widthIn / 12).toFixed(shadeData.widthIn % 12 ? 1 : 0)} × ${(shadeData.lengthIn / 12).toFixed(shadeData.lengthIn % 12 ? 1 : 0)} ft (${shadeData.coveragePct}% roof coverage)`,
        unit, total: round(shadeData.count * unit, 2),
    };
}

const _moduleExports = { DEFAULT_SHADE, SHADE_PRESETS, createDefaultShade, normalizeShade, serializeShade, calculateRoofPolygon, calculateShadeCloths, shadeBomItem };
bridgeGlobals(_moduleExports, 'shadeCloth');
