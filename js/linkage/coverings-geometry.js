// ============================================================================
// LINKAGE LAB — Coverings geometry (plywood walls, tables, tensioned fabric)
//
// Pure math: no DOM, no THREE. Turns the solved beams of a cylinder-mode ring
// into per-span covering shapes.
//
// Vocabulary
//   upright  one vertical X-scissor stack (stackType 'vertical', one per module),
//            lying in a near-radial vertical plane on the edge shared by module
//            i and module i+1.
//   span     the perimeter gap between two neighbouring uprights. Span j is
//            module j's wedge: left upright = j-1, right upright = j.
//   band     'lower' (bottomIn → splitHeightIn) or 'upper' (splitHeightIn →
//            top-ring underside − clearance). Each band is none/plywood/fabric.
//   table    horizontal slab on the lower band's top edge, extending inward.
//
// The inward-leaning beams (pattern B) of two neighbouring uprights, extended,
// meet on the ring axis by rotational symmetry, so one flat plane contains
// both: that plane is the default wall plane ('inward' lean). Individual beam
// layers are offset tangentially, so the coplanar object is the pivot-to-pivot
// pattern line in each stack's mid-plane; we project the beams onto it.
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { v3, vAdd, vSub, vScale, vDot, vCross, vNorm, vMag, radToDeg, degToRad } from './math.js';

export const COVER_TYPES = ['none', 'plywood', 'fabric'];
export const LEAN_MODES = ['inward', 'outward', 'vertical', 'custom'];
export const MOUNT_MODES = ['outside', 'centerline', 'inside'];
export const SHEET_PRESETS = {
    '4x8': { widthIn: 48, lengthIn: 96 },
    '5x5': { widthIn: 60, lengthIn: 60 },
    '4x10': { widthIn: 48, lengthIn: 120 },
};

/** Ring closes when the last→first upright gap is within this many degrees of the mean gap. */
const CLOSURE_TOLERANCE_DEG = 1.0;
/** Wall planes tilted more than this from vertical are rejected (degenerate bands). */
const MAX_TILT_DEG = 80;
/** Warn when the four guide-line endpoints miss the fitted plane by more than this. */
const PLANARITY_WARN_IN = 0.25;

export const DEFAULT_COVERINGS = Object.freeze({
    enabled: false,
    lean: 'inward',
    customTiltDeg: 0,
    splitHeightIn: 48,
    bottomIn: 0,
    topClearanceIn: 1,
    edgeGapIn: 0.25,
    mount: 'outside',
    sheet: { widthIn: 48, lengthIn: 96, thicknessIn: 0.5, orientation: 'auto', align: 'center', kerfIn: 0.125 },
    fabric: { rollWidthIn: 60, hemIn: 1, seamIn: 0.5, stretchPct: 2, grommetSpacingIn: 12 },
    table: { depthIn: 24, thicknessIn: 0.75 },
    spans: [],
    visibility: { walls: true, fabric: true, tables: true },
    showDimensions: false,
    pickMode: false,
});

const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (v, def) => (typeof v === 'number' && Number.isFinite(v)) ? v : def;
const clampNum = (v, def, min, max) => Math.max(min, Math.min(max, num(v, def)));
const pick = (v, allowed, def) => (allowed.includes(v) ? v : def);

export function createDefaultSpan() {
    return { lower: 'none', upper: 'none', table: false };
}

/** Fresh coverings state, with `n` empty spans. */
export function createDefaultCoverings(n = 0) {
    const cov = clone(DEFAULT_COVERINGS);
    resizeCoveringSpans(cov, n);
    return cov;
}

/** Grow/shrink the per-span array to `n`, preserving existing selections (in place). */
export function resizeCoveringSpans(cov, n) {
    if (!cov) return cov;
    const count = Math.max(0, Math.floor(num(n, 0)));
    if (!Array.isArray(cov.spans)) cov.spans = [];
    cov.spans = cov.spans.slice(0, count).map(normalizeSpan);
    while (cov.spans.length < count) cov.spans.push(createDefaultSpan());
    return cov;
}

function normalizeSpan(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
        lower: pick(s.lower, COVER_TYPES, 'none'),
        upper: pick(s.upper, COVER_TYPES, 'none'),
        table: !!s.table,
    };
}

/** Validate/clamp a loaded coverings block against the defaults. */
export function normalizeCoverings(raw, n) {
    const d = DEFAULT_COVERINGS;
    const r = raw && typeof raw === 'object' ? raw : {};
    const sheet = r.sheet || {};
    const fabric = r.fabric || {};
    const table = r.table || {};
    const vis = r.visibility || {};
    const cov = {
        enabled: !!r.enabled,
        lean: pick(r.lean, LEAN_MODES, d.lean),
        customTiltDeg: clampNum(r.customTiltDeg, d.customTiltDeg, -MAX_TILT_DEG, MAX_TILT_DEG),
        splitHeightIn: clampNum(r.splitHeightIn, d.splitHeightIn, 1, 600),
        bottomIn: clampNum(r.bottomIn, d.bottomIn, 0, 600),
        topClearanceIn: clampNum(r.topClearanceIn, d.topClearanceIn, 0, 60),
        edgeGapIn: clampNum(r.edgeGapIn, d.edgeGapIn, 0, 6),
        mount: pick(r.mount, MOUNT_MODES, d.mount),
        sheet: {
            widthIn: clampNum(sheet.widthIn, d.sheet.widthIn, 6, 240),
            lengthIn: clampNum(sheet.lengthIn, d.sheet.lengthIn, 6, 480),
            thicknessIn: clampNum(sheet.thicknessIn, d.sheet.thicknessIn, 0.1, 3),
            orientation: pick(sheet.orientation, ['auto', 'landscape', 'portrait'], d.sheet.orientation),
            align: pick(sheet.align, ['center', 'left'], d.sheet.align),
            kerfIn: clampNum(sheet.kerfIn, d.sheet.kerfIn, 0, 1),
        },
        fabric: {
            rollWidthIn: clampNum(fabric.rollWidthIn, d.fabric.rollWidthIn, 12, 240),
            hemIn: clampNum(fabric.hemIn, d.fabric.hemIn, 0, 12),
            seamIn: clampNum(fabric.seamIn, d.fabric.seamIn, 0, 6),
            stretchPct: clampNum(fabric.stretchPct, d.fabric.stretchPct, 0, 20),
            grommetSpacingIn: clampNum(fabric.grommetSpacingIn, d.fabric.grommetSpacingIn, 2, 120),
        },
        table: {
            depthIn: clampNum(table.depthIn, d.table.depthIn, 1, 240),
            thicknessIn: clampNum(table.thicknessIn, d.table.thicknessIn, 0.1, 3),
        },
        spans: Array.isArray(r.spans) ? r.spans.map(normalizeSpan) : [],
        visibility: {
            walls: vis.walls !== false,
            fabric: vis.fabric !== false,
            tables: vis.tables !== false,
        },
        showDimensions: !!r.showDimensions,
        pickMode: false,
    };
    if (n !== undefined) resizeCoveringSpans(cov, n);
    return cov;
}

/** Persistable copy (drops transient UI state). */
export function serializeCoverings(cov) {
    if (!cov) return null;
    const out = clone(cov);
    delete out.pickMode;
    return out;
}

// ----------------------------------------------------------------------------
// Small geometry helpers
// ----------------------------------------------------------------------------

const Y_UP = Object.freeze({ x: 0, y: 1, z: 0 });
const EPS = 1e-9;

/** Least-squares (Kasa) circle fit in the XZ plane. Returns {x, z, r} or null. */
export function fitCircleXZ(points) {
    const pts = (points || []).filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.z));
    if (pts.length < 3) return null;
    // Solve [Σx² Σxz Σx; Σxz Σz² Σz; Σx Σz n] [a b c]ᵀ = [-Σx(x²+z²); -Σz(x²+z²); -Σ(x²+z²)]
    let sxx = 0, sxz = 0, szz = 0, sx = 0, sz = 0, sxr = 0, szr = 0, sr = 0;
    for (const p of pts) {
        const r2 = p.x * p.x + p.z * p.z;
        sxx += p.x * p.x; sxz += p.x * p.z; szz += p.z * p.z;
        sx += p.x; sz += p.z; sxr += p.x * r2; szr += p.z * r2; sr += r2;
    }
    const n = pts.length;
    const sol = solve3([[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, n]], [-sxr, -szr, -sr]);
    if (!sol) return null;
    const [a, b, c] = sol;
    const cx = -a / 2, cz = -b / 2;
    const r2 = cx * cx + cz * cz - c;
    if (!(r2 > 0)) return null;
    return { x: cx, z: cz, r: Math.sqrt(r2) };
}

function solve3(m, r) {
    const [[a, b, c], [d, e, f], [g, h, i]] = m;
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(det) < 1e-12) return null;
    const inv = [
        [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
        [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
        [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
    ];
    return inv.map(row => row[0] * r[0] + row[1] * r[1] + row[2] * r[2]);
}

/** Normalize degrees into (-180, 180]. */
export function wrapDeg(a) {
    let d = ((a + 180) % 360 + 360) % 360 - 180;
    if (d === -180) d = 180;
    return d;
}

/** Intersection of 2D lines p + s·d (XZ). Returns null when parallel. */
function lineLineXZ(p1, d1, p2, d2) {
    const den = d1.x * d2.z - d1.z * d2.x;
    if (Math.abs(den) < 1e-12) return null;
    const s = ((p2.x - p1.x) * d2.z - (p2.z - p1.z) * d2.x) / den;
    return { x: p1.x + d1.x * s, y: p1.y, z: p1.z + d1.z * s };
}

/** Interior angle at vertex b of polygon a-b-c (degrees). */
function interiorAngleDeg(a, b, c) {
    const v1 = { x: a.s - b.s, t: a.t - b.t };
    const v2 = { x: c.s - b.s, t: c.t - b.t };
    const dot = v1.x * v2.x + v1.t * v2.t;
    const m = Math.hypot(v1.x, v1.t) * Math.hypot(v2.x, v2.t) || 1;
    return radToDeg(Math.acos(Math.max(-1, Math.min(1, dot / m))));
}

function polygonArea2D(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        a += p.s * q.t - q.s * p.t;
    }
    return Math.abs(a) / 2;
}

const round = (v, places = 3) => +(+v).toFixed(places);

// ----------------------------------------------------------------------------
// Uprights
// ----------------------------------------------------------------------------

/**
 * Builds one upright record per vertical X-stack from the solved beams.
 * @param {Object} data - buildLinkageGeometry / solveLinkage output
 * @param {Object} [opts] - { vertEndOffset }
 * @returns {Array} uprights sorted by moduleIndex (cap last)
 */
export function collectUprights(data, opts = {}) {
    const vertEndOffset = num(opts.vertEndOffset, 0);
    const groups = new Map();
    (data && data.beams || []).forEach(b => {
        if (!b || (b.stackType !== 'vertical' && b.stackType !== 'vertical-cap')) return;
        if (!b.p1 || !b.p2 || !b.center) return;
        const key = `${b.stackType}:${b.stackId}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(b);
    });

    const uprights = [];
    groups.forEach((beams) => {
        const A = beams.filter(b => b.patternId === 'A');
        const B = beams.filter(b => b.patternId === 'B');
        if (!A.length || !B.length) return;
        const orient = (b) => (b.p1.y <= b.p2.y ? { bot: b.p1, top: b.p2 } : { bot: b.p2, top: b.p1 });
        const dirA = vNorm(vSub(orient(A[0]).top, orient(A[0]).bot));
        const dirB = vNorm(vSub(orient(B[0]).top, orient(B[0]).bot));
        let normal = vCross(dirA, dirB);
        if (vMag(normal) < 1e-3) {
            // Parallel patterns: use the horizontal perpendicular to the average direction
            const avg = vNorm(vAdd(dirA, dirB));
            normal = vCross(avg, Y_UP);
        }
        normal = vNorm(normal);
        if (normal.y < 0) normal = vScale(normal, -1);
        // Keep the normal horizontal-ish sign-stable: prefer +x/+z hemisphere for determinism
        const centerSum = beams.reduce((acc, b) => vAdd(acc, b.center), v3(0, 0, 0));
        const center = vScale(centerSum, 1 / beams.length);
        const project = (p) => vSub(p, vScale(normal, vDot(vSub(p, center), normal)));
        const lineFrom = (list) => {
            let bot = v3(0, 0, 0), top = v3(0, 0, 0);
            list.forEach(b => {
                const o = orient(b);
                bot = vAdd(bot, project(o.bot));
                top = vAdd(top, project(o.top));
            });
            bot = vScale(bot, 1 / list.length);
            top = vScale(top, 1 / list.length);
            const dir = vNorm(vSub(top, bot));
            return {
                bot, top, dir,
                pivotBot: vAdd(bot, vScale(dir, vertEndOffset)),
                pivotTop: vSub(top, vScale(dir, vertEndOffset)),
            };
        };
        let halfWidthIn = 0;
        beams.forEach(b => {
            const off = Math.abs(vDot(vSub(b.center, center), normal)) + (num(b.w, 0) / 2);
            if (off > halfWidthIn) halfWidthIn = off;
        });
        const first = beams[0];
        uprights.push({
            index: -1,
            moduleIndex: first.moduleIndex,
            stackId: first.stackId,
            stackType: first.stackType,
            isCap: first.stackType === 'vertical-cap',
            center,
            normal,
            halfWidthIn,
            azimuthDeg: 0,
            A: lineFrom(A),
            B: lineFrom(B),
            beams,
        });
    });

    uprights.sort((a, b) => {
        if (a.isCap !== b.isCap) return a.isCap ? 1 : -1;
        return (a.moduleIndex - b.moduleIndex) || (a.stackId - b.stackId);
    });
    uprights.forEach((u, i) => { u.index = i; });
    return uprights;
}

// ----------------------------------------------------------------------------
// Spans
// ----------------------------------------------------------------------------

/**
 * Pairs neighbouring uprights into spans and decides whether the ring closes.
 * @returns {{ spans: Array, closed: boolean, closureErrorDeg: number, ringCenter: {x,z}, meanGapDeg: number }}
 */
export function collectSpans(uprights, ringCenterHint) {
    const regular = uprights.filter(u => !u.isCap);
    const cap = uprights.find(u => u.isCap) || null;
    const N = regular.length;
    const fit = fitCircleXZ(regular.map(u => u.B.pivotBot));
    const ringCenter = fit ? { x: fit.x, z: fit.z } : { x: num(ringCenterHint && ringCenterHint.x, 0), z: num(ringCenterHint && ringCenterHint.z, 0) };
    uprights.forEach(u => {
        u.azimuthDeg = radToDeg(Math.atan2(u.B.pivotBot.z - ringCenter.z, u.B.pivotBot.x - ringCenter.x));
    });

    let closed = false;
    let closureErrorDeg = NaN;
    let meanGapDeg = 0;
    if (N >= 3) {
        const gaps = [];
        for (let i = 1; i < N; i++) gaps.push(wrapDeg(regular[i].azimuthDeg - regular[i - 1].azimuthDeg));
        meanGapDeg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        const closingGap = wrapDeg(regular[0].azimuthDeg - regular[N - 1].azimuthDeg);
        closureErrorDeg = Math.abs(closingGap - meanGapDeg);
        closed = closureErrorDeg < CLOSURE_TOLERANCE_DEG;
    }

    const spans = [];
    for (let j = 0; j < N; j++) {
        const right = regular[j];
        let left = null;
        let closing = false;
        if (j > 0) {
            left = regular[j - 1];
        } else if (closed) {
            left = regular[N - 1];
            closing = true;
        } else if (cap) {
            left = cap;
        }
        if (!left) continue;
        spans.push({
            index: j,
            moduleIndex: right.moduleIndex,
            left: left.index,
            right: right.index,
            closing,
            azimuthLeftDeg: left.azimuthDeg,
            azimuthRightDeg: right.azimuthDeg,
            azimuthDeg: left.azimuthDeg + wrapDeg(right.azimuthDeg - left.azimuthDeg) / 2,
            chordBottomIn: vMag(vSub(right.B.pivotBot, left.B.pivotBot)),
        });
    }
    return { spans, closed, closureErrorDeg, ringCenter, meanGapDeg };
}

// ----------------------------------------------------------------------------
// Wall plane per span
// ----------------------------------------------------------------------------

/**
 * Solves the covering plane for a span.
 * @returns {{ plane, planarityErrorIn, tiltFromVerticalDeg, guide:'A'|'B'|null, warnings:[] } | null}
 */
export function solveSpanPlane(span, L, R, lean, customTiltDeg, ringCenter) {
    const warnings = [];
    const lL = lean === 'outward' ? L.A : L.B;
    const lR = lean === 'outward' ? R.A : R.B;
    const outwardOf = (origin) => ({ x: origin.x - ringCenter.x, y: 0, z: origin.z - ringCenter.z });

    let origin, n, planarityErrorIn = 0, guide = null;
    const u0 = vNorm(vSub(lR.pivotBot, lL.pivotBot));
    if (lean === 'inward' || lean === 'outward') {
        guide = lean === 'outward' ? 'A' : 'B';
        const P = [lL.pivotBot, lL.pivotTop, lR.pivotBot, lR.pivotTop];
        origin = vScale(P.reduce((a, b) => vAdd(a, b), v3(0, 0, 0)), 0.25);
        const w = vNorm(vAdd(lL.dir, lR.dir));
        n = vNorm(vCross(u0, w));
        if (vDot(n, outwardOf(origin)) < 0) n = vScale(n, -1);
        planarityErrorIn = Math.max(...P.map(p => Math.abs(vDot(vSub(p, origin), n))));
        if (planarityErrorIn > PLANARITY_WARN_IN) {
            warnings.push({ code: 'non-planar', message: `Guide beams are not coplanar (off by ${planarityErrorIn.toFixed(2)} in); using a best-fit plane.` });
        }
    } else {
        origin = vScale(vAdd(lL.pivotBot, lR.pivotBot), 0.5);
        let nh = vNorm(vCross(Y_UP, u0));
        if (vDot(nh, outwardOf(origin)) < 0) nh = vScale(nh, -1);
        if (lean === 'custom') {
            const tau = degToRad(num(customTiltDeg, 0));
            n = vNorm(vAdd(vScale(nh, Math.cos(tau)), vScale(Y_UP, Math.sin(tau))));
        } else {
            n = nh;
        }
    }

    if (!Number.isFinite(n.x) || vMag(n) < 0.5) return null;
    let u = vNorm(vCross(Y_UP, n));
    if (vMag(u) < 1e-6) return null;
    if (vDot(u, u0) < 0) u = vScale(u, -1);
    let v = vCross(n, u);
    if (v.y < 0) v = vScale(v, -1);
    const tiltFromVerticalDeg = radToDeg(Math.asin(Math.max(-1, Math.min(1, n.y))));
    if (Math.abs(tiltFromVerticalDeg) > MAX_TILT_DEG) {
        warnings.push({ code: 'too-flat', message: `Wall plane is tilted ${tiltFromVerticalDeg.toFixed(0)}° from vertical; span skipped.` });
        return { plane: null, planarityErrorIn, tiltFromVerticalDeg, guide, warnings };
    }
    return { plane: { origin, n, u, v }, planarityErrorIn, tiltFromVerticalDeg, guide, warnings };
}

/** Plane ∩ plane → line {p, dir} (dir.y > 0), or null when (nearly) parallel. */
function planePlaneLine(n1, d1, n2, d2) {
    const dot = vDot(n1, n2);
    const den = 1 - dot * dot;
    if (den < 1e-4) return null;
    let dir = vNorm(vCross(n1, n2));
    if (dir.y < 0) dir = vScale(dir, -1);
    const p = vScale(vAdd(vScale(n1, d1 - d2 * dot), vScale(n2, d2 - d1 * dot)), 1 / den);
    return { p, dir };
}

/**
 * Side edge of the covering: wall plane ∩ the upright's side face plane
 * (offset from the stack mid-plane by halfWidth + edgeGap toward the span).
 * Returned as a 2D line in plane coords: s(t) = s0 + (t - t0) * slope.
 */
function sideLineFor(plane, upright, spanMid, edgeGapIn) {
    const sigma = vDot(vSub(spanMid, upright.center), upright.normal) >= 0 ? 1 : -1;
    const q = vAdd(upright.center, vScale(upright.normal, sigma * (upright.halfWidthIn + edgeGapIn)));
    const line = planePlaneLine(plane.n, vDot(plane.n, plane.origin), upright.normal, vDot(upright.normal, q));
    if (!line) return null;
    const rel = vSub(line.p, plane.origin);
    const s0 = vDot(rel, plane.u), t0 = vDot(rel, plane.v);
    const ds = vDot(line.dir, plane.u), dt = vDot(line.dir, plane.v);
    if (Math.abs(dt) < 1e-6) return null;
    return { s0, t0, slope: ds / dt, line3D: line };
}

// ----------------------------------------------------------------------------
// Shapes
// ----------------------------------------------------------------------------

/**
 * Builds the trapezoid for one band of one span.
 * @param {Object} ctx - { plane, sideL, sideR, mountOffsetIn, tiltFromVerticalDeg }
 */
export function buildBandShape(ctx, yBottom, yTop, thicknessIn) {
    const { plane, sideL, sideR } = ctx;
    if (!plane || !sideL || !sideR || !(yTop > yBottom)) return null;
    const vy = plane.v.y;
    if (Math.abs(vy) < 1e-6) return null;
    const tBot = (yBottom - plane.origin.y) / vy;
    const tTop = (yTop - plane.origin.y) / vy;
    const sAt = (side, t) => side.s0 + (t - side.t0) * side.slope;
    const raw = [
        { s: sAt(sideL, tBot), t: tBot }, // BL
        { s: sAt(sideR, tBot), t: tBot }, // BR
        { s: sAt(sideR, tTop), t: tTop }, // TR
        { s: sAt(sideL, tTop), t: tTop }, // TL
    ];
    if (!(raw[1].s > raw[0].s) || !(raw[2].s > raw[3].s)) return null;

    const mount = num(ctx.mountOffsetIn, 0);
    const to3D = (p, d) => vAdd(plane.origin, vAdd(vScale(plane.u, p.s), vAdd(vScale(plane.v, p.t), vScale(plane.n, d))));
    const corners3D = raw.map(p => to3D(p, mount));
    const half = thicknessIn / 2;
    const slabCorners3D = raw.map(p => to3D(p, mount - half)).concat(raw.map(p => to3D(p, mount + half)));
    const center = vScale(corners3D.reduce((a, b) => vAdd(a, b), v3(0, 0, 0)), 0.25);

    const s0 = raw[0].s;
    const corners2D = raw.map(p => ({ s: round(p.s - s0, 4), t: round(p.t - tBot, 4) }));
    const widthBottomIn = raw[1].s - raw[0].s;
    const widthTopIn = raw[2].s - raw[3].s;
    const slantHeightIn = tTop - tBot;
    const cornerAnglesDeg = corners2D.map((p, i, arr) =>
        round(interiorAngleDeg(arr[(i + 3) % 4], p, arr[(i + 1) % 4]), 2));

    return {
        type: 'covering',
        plane,
        corners3D,
        slabCorners3D,
        center,
        normal: plane.n,
        corners2D,
        widthBottomIn: round(widthBottomIn),
        widthTopIn: round(widthTopIn),
        slantHeightIn: round(slantHeightIn),
        verticalHeightIn: round(yTop - yBottom),
        yBottom: round(yBottom),
        yTop: round(yTop),
        tiltFromVerticalDeg: round(ctx.tiltFromVerticalDeg, 2),
        sideTaperDeg: {
            left: round(radToDeg(Math.atan2(raw[3].s - raw[0].s, slantHeightIn)), 2),
            right: round(radToDeg(Math.atan2(raw[1].s - raw[2].s, slantHeightIn)), 2),
        },
        cornerAnglesDeg,
        areaIn2: round(polygonArea2D(corners2D), 1),
        thicknessIn,
        mountOffsetIn: round(mount),
        warnings: [],
    };
}

/**
 * Horizontal table slab on the lower band's top edge.
 * @param {Object} ctx - { plane, L, R, edgeGapIn, wallInnerOffsetIn, ySurface, depthIn, thicknessIn }
 */
export function buildTableShape(ctx) {
    const { plane, L, R } = ctx;
    if (!plane) return null;
    const ySurface = ctx.ySurface;
    const vy = plane.v.y;
    if (Math.abs(vy) < 1e-6) return null;
    // Outer line: wall inner face ∩ y = ySurface (direction u is horizontal)
    const o = vAdd(plane.origin, vAdd(vScale(plane.n, ctx.wallInnerOffsetIn), vScale(plane.v, (ySurface - plane.origin.y) / vy)));
    const outerDir = plane.u;
    // Horizontal inward direction
    const nh = { x: plane.n.x, y: 0, z: plane.n.z };
    const nhMag = vMag(nh);
    if (nhMag < 1e-6) return null;
    const inward = vScale(nh, -1 / nhMag);
    const innerPoint = vAdd(o, vScale(inward, ctx.depthIn));
    // Side lines: upright side planes ∩ y = ySurface
    const spanMid = vScale(vAdd(L.B.pivotBot, R.B.pivotBot), 0.5);
    const sideAt = (U) => {
        const sigma = vDot(vSub(spanMid, U.center), U.normal) >= 0 ? 1 : -1;
        let q = vAdd(U.center, vScale(U.normal, sigma * (U.halfWidthIn + ctx.edgeGapIn)));
        q = { x: q.x, y: ySurface, z: q.z };
        // re-project onto the side plane in case the stack plane is not perfectly vertical
        const ref = vAdd(U.center, vScale(U.normal, sigma * (U.halfWidthIn + ctx.edgeGapIn)));
        q = vSub(q, vScale(U.normal, vDot(vSub(q, ref), U.normal)));
        let d = vCross(Y_UP, U.normal);
        if (vMag(d) < 1e-6) return null;
        d = vNorm(d);
        return { p: q, d };
    };
    const sL = sideAt(L), sR = sideAt(R);
    if (!sL || !sR) return null;
    const outerL = lineLineXZ(o, outerDir, sL.p, sL.d);
    const outerR = lineLineXZ(o, outerDir, sR.p, sR.d);
    const innerR = lineLineXZ(innerPoint, outerDir, sR.p, sR.d);
    const innerL = lineLineXZ(innerPoint, outerDir, sL.p, sL.d);
    if (!outerL || !outerR || !innerR || !innerL) return null;
    const fix = (p) => ({ x: p.x, y: ySurface, z: p.z });
    const corners3D = [outerL, outerR, innerR, innerL].map(fix);
    const to2D = (p) => {
        const rel = vSub(p, corners3D[0]);
        return { s: round(vDot(rel, outerDir), 4), t: round(vDot(rel, inward), 4) };
    };
    const corners2D = corners3D.map(to2D);
    const widthOuterIn = vMag(vSub(corners3D[1], corners3D[0]));
    const widthInnerIn = vMag(vSub(corners3D[2], corners3D[3]));
    if (!(widthOuterIn > 0.5) || !(widthInnerIn > 0)) return null;
    const t = ctx.thicknessIn;
    const down = (p) => ({ x: p.x, y: p.y - t, z: p.z });
    const slabCorners3D = corners3D.map(down).concat(corners3D);
    const center = vScale(corners3D.reduce((a, b) => vAdd(a, b), v3(0, 0, 0)), 0.25);
    center.y -= t / 2;
    const cornerAnglesDeg = corners2D.map((p, i, arr) =>
        round(interiorAngleDeg(arr[(i + 3) % 4], p, arr[(i + 1) % 4]), 2));
    return {
        type: 'covering',
        plane: { origin: corners3D[0], n: { x: 0, y: 1, z: 0 }, u: outerDir, v: inward },
        corners3D,
        slabCorners3D,
        center,
        normal: { x: 0, y: 1, z: 0 },
        corners2D,
        widthBottomIn: round(widthOuterIn),
        widthTopIn: round(widthInnerIn),
        widthOuterIn: round(widthOuterIn),
        widthInnerIn: round(widthInnerIn),
        slantHeightIn: round(ctx.depthIn),
        depthIn: round(ctx.depthIn),
        verticalHeightIn: 0,
        yBottom: round(ySurface - t),
        yTop: round(ySurface),
        tiltFromVerticalDeg: 90,
        sideTaperDeg: {
            left: round(radToDeg(Math.atan2(corners2D[3].s - corners2D[0].s, ctx.depthIn)), 2),
            right: round(radToDeg(Math.atan2(corners2D[1].s - corners2D[2].s, ctx.depthIn)), 2),
        },
        cornerAnglesDeg,
        areaIn2: round(polygonArea2D(corners2D), 1),
        thicknessIn: t,
        mountOffsetIn: 0,
        warnings: [],
    };
}

// ----------------------------------------------------------------------------
// Main entry
// ----------------------------------------------------------------------------

function unsupported(reason, cov) {
    return {
        enabled: !!(cov && cov.enabled),
        supported: false,
        unsupportedReason: reason,
        ringCenter: null, closed: false, closureErrorDeg: NaN,
        ringTopY: 0, ringUndersideY: 0,
        uprights: [], spans: [], shapes: [], pickQuads: [], warnings: [],
        totals: emptyTotals(),
    };
}

function emptyTotals() {
    return { plywoodWalls: 0, fabricBands: 0, tables: 0, plywoodAreaIn2: 0, fabricAreaIn2: 0, tableAreaIn2: 0, spansCovered: 0 };
}

/**
 * Computes every covering shape for the current geometry.
 * @param {Object} data - buildLinkageGeometry output (after recentering)
 * @param {Object} cov - state.coverings
 * @param {Object} st - app state (orientation, useFixedBeams, vertEndOffset, modules)
 */
export function computeCoverings(data, cov, st) {
    const c = cov || DEFAULT_COVERINGS;
    if (!st || st.orientation === 'vertical') return unsupported('arch', c);
    if (st.useFixedBeams) return unsupported('fixed-beams', c);

    const uprights = collectUprights(data, { vertEndOffset: num(st.vertEndOffset, 0) });
    if (uprights.filter(u => !u.isCap).length < 2) return unsupported('no-uprights', c);

    const { spans, closed, closureErrorDeg, ringCenter, meanGapDeg } = collectSpans(uprights, data && data.structureCenter);

    // Ring reference heights from the horizontal scissors
    let ringTopY = -Infinity, ringUndersideY = Infinity;
    const hBeams = [];
    (data.beams || []).forEach(b => {
        if (!b || !b.stackType || !b.stackType.startsWith('horizontal')) return;
        hBeams.push(b);
        const ys = (b.corners && b.corners.length ? b.corners : [b.p1, b.p2]).map(p => p.y);
        if (b.stackType === 'horizontal-bottom') ringTopY = Math.max(ringTopY, ...ys);
        if (b.stackType === 'horizontal-top') ringUndersideY = Math.min(ringUndersideY, ...ys);
    });
    if (!Number.isFinite(ringTopY)) ringTopY = 0;
    if (!Number.isFinite(ringUndersideY)) {
        ringUndersideY = Math.max(...uprights.map(u => Math.max(u.A.top.y, u.B.top.y)));
    }

    const warnings = [];
    const shapes = [];
    const pickQuads = [];
    const totals = emptyTotals();
    const sheetThick = num(c.sheet && c.sheet.thicknessIn, 0.5);
    const fabricThick = 0.1;
    const bottomIn = num(c.bottomIn, 0);
    const upperTop = ringUndersideY - num(c.topClearanceIn, 0);
    const splitIn = Math.min(num(c.splitHeightIn, 48), upperTop - 6);
    const guidePattern = c.lean === 'outward' ? 'A' : 'B';

    // Pass 1: planes and side lines
    spans.forEach(span => {
        const L = uprights[span.left], R = uprights[span.right];
        const solved = solveSpanPlane(span, L, R, c.lean, c.customTiltDeg, ringCenter);
        span.plane = solved ? solved.plane : null;
        span.planarityErrorIn = solved ? round(solved.planarityErrorIn) : null;
        span.tiltFromVerticalDeg = solved ? round(solved.tiltFromVerticalDeg, 2) : null;
        span.guide = solved ? solved.guide : null;
        (solved ? solved.warnings : []).forEach(w => warnings.push({ spanIndex: span.index, band: null, ...w }));
        if (!span.plane) return;
        const spanMid = vScale(vAdd(L.B.pivotBot, R.B.pivotBot), 0.5);
        span.sideL = sideLineFor(span.plane, L, spanMid, num(c.edgeGapIn, 0));
        span.sideR = sideLineFor(span.plane, R, spanMid, num(c.edgeGapIn, 0));
        if (!span.sideL || !span.sideR) {
            warnings.push({ spanIndex: span.index, band: null, code: 'side-parallel', message: 'Wall plane is parallel to an upright; span skipped.' });
            span.plane = null;
            return;
        }
        // Mount offset from the guide beams' physical faces
        let dMax = -Infinity, dMin = Infinity;
        [L, R].forEach(U => U.beams.forEach(b => {
            if (b.patternId !== guidePattern) return;
            (b.corners || []).forEach(p => {
                const d = vDot(vSub(p, span.plane.origin), span.plane.n);
                if (d > dMax) dMax = d;
                if (d < dMin) dMin = d;
            });
        }));
        if (!Number.isFinite(dMax)) { dMax = 0; dMin = 0; }
        span.faceOutsideIn = round(dMax);
        span.faceInsideIn = round(dMin);
    });

    // Dihedral to neighbours (for corner bevel reporting)
    const byIndex = new Map(spans.map(s => [s.index, s]));
    const N = uprights.filter(u => !u.isCap).length;
    spans.forEach(span => {
        const next = byIndex.get((span.index + 1) % N);
        if (span.plane && next && next.plane) {
            span.dihedralToNextDeg = round(radToDeg(Math.acos(Math.max(-1, Math.min(1, vDot(span.plane.n, next.plane.n))))), 2);
        } else {
            span.dihedralToNextDeg = null;
        }
    });

    const mountFor = (span, thick) => {
        if (c.mount === 'centerline') return 0;
        if (c.mount === 'inside') return span.faceInsideIn - thick / 2;
        return span.faceOutsideIn + thick / 2;
    };

    // Pass 2: shapes
    spans.forEach(span => {
        const cfg = (c.spans && c.spans[span.index]) || createDefaultSpan();
        span.config = cfg;
        span.lower = null; span.upper = null; span.table = null;
        if (!span.plane) return;
        const L = uprights[span.left], R = uprights[span.right];
        const bands = [
            { band: 'lower', type: cfg.lower, yBot: bottomIn, yTop: splitIn },
            { band: 'upper', type: cfg.upper, yBot: splitIn, yTop: upperTop },
        ];
        bands.forEach(bd => {
            const isFabric = bd.type === 'fabric';
            const thick = isFabric ? fabricThick : sheetThick;
            const ctx = {
                plane: span.plane, sideL: span.sideL, sideR: span.sideR,
                mountOffsetIn: mountFor(span, bd.type === 'none' ? sheetThick : thick),
                tiltFromVerticalDeg: span.tiltFromVerticalDeg,
            };
            const shape = buildBandShape(ctx, bd.yBot, bd.yTop, bd.type === 'none' ? sheetThick : thick);
            if (!shape) return;
            shape.spanIndex = span.index;
            shape.moduleIndex = span.moduleIndex;
            shape.band = bd.band;
            shape.dihedralToNextDeg = span.dihedralToNextDeg;
            shape.edgeBevelDeg = span.dihedralToNextDeg != null ? round(span.dihedralToNextDeg / 2, 2) : null;
            shape.planarityErrorIn = span.planarityErrorIn;
            shape.label = `Span ${span.index + 1} · ${bd.band === 'lower' ? 'Lower' : 'Upper'}`;
            pickQuads.push({ spanIndex: span.index, band: bd.band, corners3D: shape.corners3D, type: bd.type });
            if (bd.type === 'none') return;
            shape.coverType = bd.type;
            shape.kind = isFabric ? 'fabric' : 'wall';
            // Clearance: does any H-beam of this wedge poke through the slab's inner face?
            const innerFace = ctx.mountOffsetIn - thick / 2;
            const sL = span.sideL, sR = span.sideR;
            let worst = 0;
            hBeams.forEach(b => {
                const mi = b.moduleIndex;
                if (mi !== span.moduleIndex && mi !== ((span.moduleIndex + N - 1) % N)) return;
                (b.corners || []).forEach(p => {
                    if (p.y < bd.yBot - 0.01 || p.y > bd.yTop + 0.01) return;
                    const rel = vSub(p, span.plane.origin);
                    const d = vDot(rel, span.plane.n) - innerFace;
                    if (d <= 0.5) return;
                    const s = vDot(rel, span.plane.u), t = vDot(rel, span.plane.v);
                    const sMin = sL.s0 + (t - sL.t0) * sL.slope + 2;
                    const sMax = sR.s0 + (t - sR.t0) * sR.slope - 2;
                    if (s > sMin && s < sMax && d > worst) worst = d;
                });
            });
            if (worst > 0) {
                const w = { spanIndex: span.index, band: bd.band, code: 'beam-protrudes', message: `A horizontal beam pokes ${worst.toFixed(1)} in through the ${bd.band} covering of span ${span.index + 1}. Raise Bottom or change Mount.` };
                shape.warnings.push(w); warnings.push(w);
            }
            span[bd.band] = shape;
            shapes.push(shape);
            if (isFabric) { totals.fabricBands++; totals.fabricAreaIn2 += shape.areaIn2; }
            else { totals.plywoodWalls++; totals.plywoodAreaIn2 += shape.areaIn2; }
        });

        if (cfg.table) {
            const lowerWall = span.lower && span.lower.kind === 'wall' ? span.lower : null;
            const wallInner = lowerWall ? (lowerWall.mountOffsetIn - lowerWall.thicknessIn / 2) : 0;
            const table = buildTableShape({
                plane: span.plane, L, R,
                edgeGapIn: num(c.edgeGapIn, 0),
                wallInnerOffsetIn: wallInner,
                ySurface: splitIn,
                depthIn: num(c.table && c.table.depthIn, 24),
                thicknessIn: num(c.table && c.table.thicknessIn, 0.75),
            });
            if (table) {
                table.spanIndex = span.index;
                table.moduleIndex = span.moduleIndex;
                table.band = 'table';
                table.kind = 'table';
                table.coverType = 'table';
                table.label = `Span ${span.index + 1} · Table`;
                if (!lowerWall) {
                    const w = { spanIndex: span.index, band: 'table', code: 'table-unsupported', message: `Table on span ${span.index + 1} has no plywood lower wall to rest on.` };
                    table.warnings.push(w); warnings.push(w);
                }
                span.table = table;
                shapes.push(table);
                totals.tables++;
                totals.tableAreaIn2 += table.areaIn2;
            }
        }
        if (cfg.lower !== 'none' || cfg.upper !== 'none') totals.spansCovered++;
    });

    if (!closed && N >= 3) {
        warnings.push({ spanIndex: 0, band: null, code: 'ring-open', message: `Ring is open (${closureErrorDeg.toFixed(1)}° off); span 1 is unavailable until the ring closes.` });
    }

    totals.plywoodAreaIn2 = round(totals.plywoodAreaIn2, 1);
    totals.fabricAreaIn2 = round(totals.fabricAreaIn2, 1);
    totals.tableAreaIn2 = round(totals.tableAreaIn2, 1);

    return {
        enabled: !!c.enabled,
        supported: true,
        unsupportedReason: null,
        ringCenter,
        closed,
        closureErrorDeg: Number.isFinite(closureErrorDeg) ? round(closureErrorDeg, 2) : null,
        meanGapDeg: round(meanGapDeg, 2),
        ringTopY: round(ringTopY),
        ringUndersideY: round(ringUndersideY),
        splitHeightIn: round(splitIn),
        upperTopIn: round(upperTop),
        uprights,
        spans,
        shapes,
        pickQuads,
        warnings,
        totals,
    };
}

/** Stable identity for a covering shape (used by build steps / picking). */
export function coveringKey(shape) {
    if (!shape) return null;
    return `wall:s${shape.spanIndex}:${shape.band}`;
}

/** Split height that makes the lower band exactly one sheet (short side) tall along the slant. */
export function splitHeightForOneSheet(cov, tiltFromVerticalDeg) {
    const short = Math.min(num(cov.sheet.widthIn, 48), num(cov.sheet.lengthIn, 96));
    const cosT = Math.cos(degToRad(num(tiltFromVerticalDeg, 0)));
    const h = num(cov.bottomIn, 0) + short * cosT;
    return Math.floor(h * 4) / 4;
}

/** Compact snapshot of shapes for config exports. */
export function snapshotCoverings(covData, roundVec) {
    if (!covData) return null;
    const rv = roundVec || ((v) => ({ x: round(v.x, 2), y: round(v.y, 2), z: round(v.z, 2) }));
    return {
        supported: !!covData.supported,
        unsupportedReason: covData.unsupportedReason || null,
        closed: !!covData.closed,
        ringCenter: covData.ringCenter ? { x: round(covData.ringCenter.x, 2), z: round(covData.ringCenter.z, 2) } : null,
        splitHeightIn: covData.splitHeightIn,
        shapes: (covData.shapes || []).map(s => ({
            kind: s.kind,
            band: s.band,
            spanIndex: s.spanIndex,
            moduleIndex: s.moduleIndex,
            coverType: s.coverType,
            corners: (s.corners3D || []).map(rv),
            normal: s.normal ? rv(s.normal) : null,
            corners2D: s.corners2D,
            widthBottomIn: s.widthBottomIn,
            widthTopIn: s.widthTopIn,
            slantHeightIn: s.slantHeightIn,
            verticalHeightIn: s.verticalHeightIn,
            tiltFromVerticalDeg: s.tiltFromVerticalDeg,
            sideTaperDeg: s.sideTaperDeg,
            cornerAnglesDeg: s.cornerAnglesDeg,
            edgeBevelDeg: s.edgeBevelDeg ?? null,
            areaIn2: s.areaIn2,
            thicknessIn: s.thicknessIn,
        })),
        totals: covData.totals,
        warnings: covData.warnings,
    };
}

const _moduleExports = {
    COVER_TYPES,
    LEAN_MODES,
    MOUNT_MODES,
    SHEET_PRESETS,
    DEFAULT_COVERINGS,
    createDefaultSpan,
    createDefaultCoverings,
    resizeCoveringSpans,
    normalizeCoverings,
    serializeCoverings,
    fitCircleXZ,
    wrapDeg,
    collectUprights,
    collectSpans,
    solveSpanPlane,
    buildBandShape,
    buildTableShape,
    computeCoverings,
    coveringKey,
    splitHeightForOneSheet,
    snapshotCoverings,
};

bridgeGlobals(_moduleExports, 'coveringsGeometry');
