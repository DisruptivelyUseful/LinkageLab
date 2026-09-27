import { describe, expect, it } from 'vitest';
import { createTestState } from './helpers/state-fixture.js';
import '../js/linkage/beam-bolt-helpers.js';
import { solveLinkage } from '../js/linkage/solver.js';
import { getOptimalClosedAngleForAnimation } from '../js/linkage/joint-kinematics.js';
import { createDefaultShade, calculateShadeCloths, calculateRoofPolygon, normalizeShade, shadeBomItem } from '../js/linkage/shade-cloth.js';

function ring() {
    const st = createTestState({ modules: 8, hLengthFt: 8, vLengthFt: 7.97, pivotPct: 41.4, offsetTopIn: 1.25, offsetBotIn: 1, vertEndOffset: 1, hStackCount: 2, vStackCount: 3, hBeamW: 2.5, hBeamT: 1.5, vBeamW: 0.75, vBeamT: 2.5 });
    globalThis.state = st;
    st.animation.cachedClosedAngle = undefined;
    st.foldAngle = getOptimalClosedAngleForAnimation();
    return { st, data: solveLinkage(st.foldAngle) };
}

describe('shade-cloth', () => {
    it('roof polygon is the outer octagon of the top ring', () => {
        const { data } = ring();
        const roof = calculateRoofPolygon(data, 8);
        expect(roof.vertices).toHaveLength(8);
        const r = roof.vertices.map(p => Math.hypot(p.x - roof.center.x, p.z - roof.center.z));
        r.forEach(v => { expect(v).toBeGreaterThan(120); expect(v).toBeLessThan(145); });
        expect(roof.topY).toBeGreaterThan(80);
    });

    it('tiles the roof with whole 10x20 cloths that cover it fully and overhang', () => {
        const { st, data } = ring();
        const shade = createDefaultShade();
        shade.enabled = true;
        const res = calculateShadeCloths(data, shade, st);
        expect(res.supported).toBe(true);
        expect(res.count).toBeGreaterThanOrEqual(4);
        expect(res.coveragePct).toBeGreaterThanOrEqual(99);
        expect(res.overhangIn2).toBeGreaterThan(0);
        res.shapes.forEach(s => {
            expect(s.kind).toBe('shade');
            expect(s.corners3D).toHaveLength(4);
            expect(s.slabCorners3D).toHaveLength(8);
            expect(s.insideAreaIn2).toBeGreaterThan(1);
            expect(Math.hypot(s.corners3D[1].x - s.corners3D[0].x, s.corners3D[1].z - s.corners3D[0].z)).toBeCloseTo(240, 3);
            expect(Math.hypot(s.corners3D[3].x - s.corners3D[0].x, s.corners3D[3].z - s.corners3D[0].z)).toBeCloseTo(120, 3);
            expect(s.corners3D[0].y).toBeCloseTo(res.y, 2);
        });
        expect(res.y).toBeGreaterThan(80);
        // bigger cloths → fewer of them; overlap shrinks the pitch so more cloths may be needed
        const big = calculateShadeCloths(data, { ...shade, widthIn: 240, lengthIn: 240 }, st);
        expect(big.count).toBeLessThan(res.count);
        const tight = calculateShadeCloths(data, { ...shade, overlapIn: 60 }, st);
        expect(tight.count).toBeGreaterThanOrEqual(res.count);
    });

    it('rotation by 90° swaps rows and columns; disabled / arch produce nothing', () => {
        const { st, data } = ring();
        const shade = createDefaultShade();
        shade.enabled = true;
        const a = calculateShadeCloths(data, shade, st);
        const b = calculateShadeCloths(data, { ...shade, rotationDeg: 90 }, st);
        // the roof is (almost) square, so the local grid keeps its shape; the cloths rotate in world space
        expect(b.rows).toBe(a.rows);
        expect(b.cols).toBe(a.cols);
        expect(b.count).toBe(a.count);
        // rotated cloth edges are rotated in world space
        const e = b.shapes[0];
        const dx = e.corners3D[1].x - e.corners3D[0].x, dz = e.corners3D[1].z - e.corners3D[0].z;
        const e0 = a.shapes[0];
        const dx0 = e0.corners3D[1].x - e0.corners3D[0].x, dz0 = e0.corners3D[1].z - e0.corners3D[0].z;
        expect(Math.abs(dx * dx0 + dz * dz0)).toBeLessThan(1e-6); // perpendicular
        // a negative lift lowers the cloths; a higher coverings top edge raises the base
        const y0 = calculateShadeCloths(data, shade, st).shapes[0].corners3D[0].y;
        expect(calculateShadeCloths(data, { ...shade, liftIn: shade.liftIn - 5 }, st).shapes[0].corners3D[0].y).toBeCloseTo(y0 - 5, 6);
        expect(calculateShadeCloths(data, shade, st, { coveringsTopY: y0 + 20 }).shapes[0].corners3D[0].y).toBeCloseTo(y0 + 20 + shade.liftIn, 6);
        expect(calculateShadeCloths(data, shade, st, { coveringsTopY: 1 }).shapes[0].corners3D[0].y).toBeCloseTo(y0, 6);
        expect(calculateShadeCloths(data, { ...shade, enabled: false }, st).count).toBe(0);
        expect(calculateShadeCloths(data, shade, { ...st, orientation: 'vertical' }).unsupportedReason).toBe('arch');
    });

    it('normalize and BOM item', () => {
        const s = normalizeShade({ enabled: 1, widthIn: 0.001, opacity: 3, rotationDeg: 4000, liftIn: -30, overlapIn: -4 });
        expect(s.enabled).toBe(true);
        expect(s.widthIn).toBe(0.05);
        expect(s.opacity).toBe(1);
        expect(s.rotationDeg).toBe(360);
        expect(s.liftIn).toBe(-30);
        expect(s.overlapIn).toBe(-4);
        const item = shadeBomItem({ count: 6, widthIn: 120, lengthIn: 240, coveragePct: 100 }, { costShadeCloth: 55 });
        expect(item.qty).toBe(6);
        expect(item.total).toBe(330);
        expect(item.item).toContain('10 × 20 ft');
        expect(shadeBomItem({ count: 0 }, {})).toBeNull();
    });
});
