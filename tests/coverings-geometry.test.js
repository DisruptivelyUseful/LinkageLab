import { describe, expect, it, beforeEach } from 'vitest';
import { createTestState } from './helpers/state-fixture.js';
import '../js/linkage/beam-bolt-helpers.js';
import { solveLinkage } from '../js/linkage/solver.js';
import { getOptimalClosedAngleForAnimation } from '../js/linkage/joint-kinematics.js';
import {
    computeCoverings,
    collectUprights,
    createDefaultCoverings,
    resizeCoveringSpans,
    normalizeCoverings,
    fitCircleXZ,
    splitHeightForOneSheet,
} from '../js/linkage/coverings-geometry.js';

/** 8-module cylinder close to the StarShade 8m reference design. */
function makeRingState(overrides = {}) {
    return createTestState({
        modules: 8,
        hLengthFt: 8,
        vLengthFt: 7.97,
        pivotPct: 41.4,
        offsetTopIn: 1.25,
        offsetBotIn: 1,
        vertEndOffset: 1,
        hStackCount: 2,
        vStackCount: 3,
        vStackGap: 0.45,
        hStackGap: 0.1,
        hBeamW: 2.5,
        hBeamT: 1.5,
        vBeamW: 0.75,
        vBeamT: 2.5,
        vBeamDimensionsLinked: false,
        vBeamInnerW: 1.5,
        vBeamInnerT: 2.5,
        vBeamOuterW: 0.75,
        vBeamOuterT: 2.5,
        archCapUprights: true,
        ...overrides,
    });
}

function solveClosed(st) {
    globalThis.state = st;
    st.animation.cachedClosedAngle = undefined;
    const closedAngle = getOptimalClosedAngleForAnimation();
    st.foldAngle = closedAngle;
    return { data: solveLinkage(closedAngle), closedAngle };
}

function enclosed(n) {
    const cov = createDefaultCoverings(n);
    cov.enabled = true;
    cov.spans.forEach(s => { s.lower = 'plywood'; s.upper = 'fabric'; s.table = true; });
    return cov;
}

describe('coverings-geometry: state helpers', () => {
    it('createDefaultCoverings / resizeCoveringSpans preserve selections', () => {
        const cov = createDefaultCoverings(4);
        expect(cov.spans).toHaveLength(4);
        cov.spans[1].lower = 'plywood';
        resizeCoveringSpans(cov, 6);
        expect(cov.spans).toHaveLength(6);
        expect(cov.spans[1].lower).toBe('plywood');
        expect(cov.spans[5]).toEqual({ lower: 'none', upper: 'none', table: false });
        resizeCoveringSpans(cov, 2);
        expect(cov.spans).toHaveLength(2);
    });

    it('normalizeCoverings clamps and falls back to defaults', () => {
        const cov = normalizeCoverings({ enabled: 1, lean: 'sideways', splitHeightIn: -5, spans: [{ lower: 'steel', upper: 'fabric', table: 'yes' }], pickMode: true }, 3);
        expect(cov.enabled).toBe(true);
        expect(cov.lowerLean).toBe('inward');
        expect(cov.upperLean).toBe('outward');
        expect(cov.splitHeightIn).toBe(1);
        expect(cov.spans).toHaveLength(3);
        expect(cov.spans[0]).toEqual({ lower: 'none', upper: 'fabric', table: true });
        expect(cov.pickMode).toBe(false);
        expect(cov.sheet.widthIn).toBe(48);
    });

    it('fitCircleXZ recovers a circle', () => {
        const pts = [0, 1, 2, 3, 4].map(i => ({ x: 10 + 5 * Math.cos(i), y: 0, z: -3 + 5 * Math.sin(i) }));
        const c = fitCircleXZ(pts);
        expect(c.x).toBeCloseTo(10, 6);
        expect(c.z).toBeCloseTo(-3, 6);
        expect(c.r).toBeCloseTo(5, 6);
    });
});

describe('coverings-geometry: closed 8-module ring', () => {
    let data, st, cov, result;
    beforeEach(() => {
        st = makeRingState();
        ({ data } = solveClosed(st));
        cov = enclosed(8);
        result = computeCoverings(data, cov, st);
    });

    it('finds 8 uprights (cap ignored when closed) and 8 spans with a closing span', () => {
        expect(result.supported).toBe(true);
        const uprights = collectUprights(data, { vertEndOffset: 1 });
        expect(uprights.filter(u => !u.isCap)).toHaveLength(8);
        expect(uprights.some(u => u.isCap)).toBe(true);
        expect(result.closed).toBe(true);
        expect(result.spans).toHaveLength(8);
        expect(result.spans[0].closing).toBe(true);
        expect(result.spans.slice(1).every(s => !s.closing)).toBe(true);
        expect(Math.abs(result.meanGapDeg)).toBeCloseTo(45, 0);
    });

    it('inward-lean planes contain both B lines (coplanar) and tilt ≈ 24° inward', () => {
        result.spans.forEach(span => {
            expect(span.plane).toBeTruthy();
            expect(span.planarityErrorIn).toBeLessThan(0.05);
            expect(span.tiltFromVerticalDeg).toBeGreaterThan(18);
            expect(span.tiltFromVerticalDeg).toBeLessThan(32);
        });
    });

    it('lower band is a 48"-tall trapezoid narrower than the foot chord, symmetric tapers', () => {
        const lower = result.spans[3].lower;
        expect(lower).toBeTruthy();
        expect(lower.kind).toBe('wall');
        expect(lower.verticalHeightIn).toBeCloseTo(48, 1);
        expect(lower.slantHeightIn).toBeGreaterThan(48);
        expect(lower.widthBottomIn).toBeLessThan(result.spans[3].chordBottomIn);
        expect(lower.widthBottomIn).toBeGreaterThan(result.spans[3].chordBottomIn - 12);
        expect(lower.widthTopIn).toBeLessThan(lower.widthBottomIn);
        expect(lower.sideTaperDeg.left).toBeCloseTo(lower.sideTaperDeg.right, 1);
        expect(lower.sideTaperDeg.left).toBeGreaterThan(5);
        expect(lower.corners2D[0]).toEqual({ s: 0, t: 0 });
        expect(lower.cornerAnglesDeg[0] + lower.cornerAnglesDeg[3]).toBeCloseTo(180, 0);
        expect(lower.areaIn2).toBeCloseTo((lower.widthBottomIn + lower.widthTopIn) / 2 * lower.slantHeightIn, 0);
        expect(lower.slabCorners3D).toHaveLength(8);
        expect(lower.mountOffsetIn).toBeGreaterThan(0); // 'outside' mount sits past the beam faces
    });

    it('upper band runs from the split height to the top ring underside minus clearance', () => {
        const upper = result.spans[3].upper;
        expect(upper.kind).toBe('fabric');
        expect(upper.yBottom).toBeCloseTo(48, 1);
        expect(upper.yTop).toBeCloseTo(result.ringUndersideY - 1, 1);
        expect(result.ringUndersideY).toBeGreaterThan(80);
    });

    it('table sits at the split height, converges inward, and spans the wall inner face', () => {
        const table = result.spans[3].table;
        expect(table).toBeTruthy();
        expect(table.kind).toBe('table');
        expect(table.yTop).toBeCloseTo(48, 1);
        expect(table.depthIn).toBe(24);
        expect(table.widthInnerIn).toBeLessThan(table.widthOuterIn);
        expect(table.corners3D.every(c => Math.abs(c.y - 48) < 0.01)).toBe(true);
        expect(table.warnings).toHaveLength(0);
    });

    it('totals and pick quads cover every span/band', () => {
        expect(result.totals.plywoodWalls).toBe(8);
        expect(result.totals.fabricBands).toBe(8);
        expect(result.totals.tables).toBe(8);
        expect(result.shapes).toHaveLength(24);
        expect(result.pickQuads).toHaveLength(16);
        const wallWarnings = result.warnings.filter(w => w.code === 'beam-protrudes');
        expect(wallWarnings).toHaveLength(0);
    });

    it('all wall corners lie outside the B foot radius (walls sit outside the bottom ring)', () => {
        const rc = result.ringCenter;
        const footR = Math.hypot(result.uprights[0].B.pivotBot.x - rc.x, result.uprights[0].B.pivotBot.z - rc.z);
        result.spans.forEach(span => {
            const bl = span.lower.corners3D[0];
            const r = Math.hypot(bl.x - rc.x, bl.z - rc.z);
            expect(r).toBeGreaterThan(footR - 12); // corner is near the foot radius, not deep inside
        });
    });
});

describe('coverings-geometry: variants', () => {
    it('vertical lean gives zero tilt; outward lean tilts the other way', () => {
        const st = makeRingState();
        const { data } = solveClosed(st);
        const cov = enclosed(8);
        cov.lowerLean = 'vertical';
        const vert = computeCoverings(data, cov, st);
        vert.spans.forEach(s => expect(Math.abs(s.tiltFromVerticalDeg)).toBeLessThan(0.01));
        cov.lowerLean = 'outward';
        const out = computeCoverings(data, cov, st);
        out.spans.forEach(s => expect(s.tiltFromVerticalDeg).toBeLessThan(-15));
        cov.lowerLean = 'custom';
        cov.lowerTiltDeg = 10;
        const cust = computeCoverings(data, cov, st);
        cust.spans.forEach(s => expect(s.tiltFromVerticalDeg).toBeCloseTo(10, 1));
    });

    it('by default the upper band mirrors the lower band: lower leans in, upper leans out', () => {
        const st = makeRingState();
        const { data } = solveClosed(st);
        const r = computeCoverings(data, enclosed(8), st);
        r.spans.forEach(s => {
            expect(s.lower.tiltFromVerticalDeg).toBeGreaterThan(15);
            expect(s.upper.tiltFromVerticalDeg).toBeLessThan(-15);
            expect(s.upper.tiltFromVerticalDeg).toBeCloseTo(-s.lower.tiltFromVerticalDeg, 0);
            expect(s.upper.lean).toBe('outward');
            expect(s.upper.yBottom).toBeCloseTo(48, 1);
            const rc = r.ringCenter;
            const rad = (p) => Math.hypot(p.x - rc.x, p.z - rc.z);
            // the upper band's top edge is further out than the lower band's top edge (it leans away)
            expect(rad(s.upper.corners3D[3])).toBeGreaterThan(rad(s.lower.corners3D[3]));
        });
        expect(r.pickQuads.filter(x => x.spanIndex === 2)).toHaveLength(2);
        const legacy = normalizeCoverings({ enabled: true, lean: 'vertical', customTiltDeg: 5 }, 8);
        expect(legacy.lowerLean).toBe('vertical');
        expect(legacy.lowerTiltDeg).toBe(5);
        expect(legacy.upperLean).toBe('outward');
    });

    it('table slide moves every table corner toward the ring centre', () => {
        const st = makeRingState();
        const { data } = solveClosed(st);
        const cov = enclosed(8);
        const base = computeCoverings(data, cov, st);
        const baseTable = base.spans[1].table;
        cov.table.slideIn = 10;
        const slidTable = computeCoverings(data, cov, st).spans[1].table;
        const rad = (p) => Math.hypot(p.x - base.ringCenter.x, p.z - base.ringCenter.z);
        // the table centre sits on the span bisector, so its radius shrinks by exactly the slide
        expect(rad(baseTable.center) - rad(slidTable.center)).toBeCloseTo(10, 1);
        baseTable.corners3D.forEach((p, i) => expect(rad(p)).toBeGreaterThan(rad(slidTable.corners3D[i]) + 9));
        expect(slidTable.depthIn).toBe(baseTable.depthIn);
        expect(slidTable.widthOuterIn).toBeLessThan(baseTable.widthOuterIn);
    });

    it('two-layer stacks solve the same wall plane as three-layer stacks', () => {
        const st3 = makeRingState();
        const { data: d3 } = solveClosed(st3);
        const r3 = computeCoverings(d3, enclosed(8), st3);
        const st2 = makeRingState({ vStackCount: 2 });
        const { data: d2 } = solveClosed(st2);
        const r2 = computeCoverings(d2, enclosed(8), st2);
        expect(r2.spans[2].tiltFromVerticalDeg).toBeCloseTo(r3.spans[2].tiltFromVerticalDeg, 1);
        expect(r2.spans[2].planarityErrorIn).toBeLessThan(0.05);
    });

    it('an open ring drops span 1 and reports the closure error', () => {
        const st = makeRingState();
        const { closedAngle } = solveClosed(st);
        const openAngle = closedAngle - 0.3;
        st.foldAngle = openAngle;
        const data = solveLinkage(openAngle);
        // cap upright is emitted only when archCapUprights; disable so span 0 has no left neighbour
        st.archCapUprights = false;
        const dataNoCap = solveLinkage(openAngle);
        const r = computeCoverings(dataNoCap, enclosed(8), st);
        expect(r.closed).toBe(false);
        expect(r.spans.find(s => s.index === 0)).toBeUndefined();
        expect(r.spans).toHaveLength(7);
        expect(r.warnings.some(w => w.code === 'ring-open')).toBe(true);
        // with the cap present the open ring still gets span 0 bounded by the cap stack
        const rCap = computeCoverings(data, enclosed(8), { ...st, archCapUprights: true });
        expect(rCap.spans).toHaveLength(8);
        expect(rCap.spans[0].closing).toBe(false);
    });

    it('arch orientation and fixed beams are unsupported', () => {
        const st = makeRingState();
        const { data } = solveClosed(st);
        expect(computeCoverings(data, enclosed(8), { ...st, orientation: 'vertical' }).unsupportedReason).toBe('arch');
        expect(computeCoverings(data, enclosed(8), { ...st, useFixedBeams: true }).unsupportedReason).toBe('fixed-beams');
    });

    it('splitHeightForOneSheet accounts for the tilt', () => {
        const cov = createDefaultCoverings(8);
        expect(splitHeightForOneSheet(cov, 0)).toBe(48);
        expect(splitHeightForOneSheet(cov, 24.5)).toBeCloseTo(48 * Math.cos(24.5 * Math.PI / 180), 0);
    });

    it('unselected spans produce no shapes but still produce pick quads', () => {
        const st = makeRingState();
        const { data } = solveClosed(st);
        const cov = createDefaultCoverings(8);
        cov.enabled = true;
        cov.spans[2].lower = 'plywood';
        const r = computeCoverings(data, cov, st);
        expect(r.shapes).toHaveLength(1);
        expect(r.shapes[0].spanIndex).toBe(2);
        expect(r.pickQuads).toHaveLength(16);
    });
});
