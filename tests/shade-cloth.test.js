import { describe, expect, it } from 'vitest';
import { createTestState } from './helpers/state-fixture.js';
import '../js/linkage/beam-bolt-helpers.js';
import { solveLinkage } from '../js/linkage/solver.js';
import { getOptimalClosedAngleForAnimation } from '../js/linkage/joint-kinematics.js';
import { createDefaultShade, calculateShadeCloths, calculateRoofPolygon, normalizeShade, normalizeHexColor, shadeBomItems, shadeBomItem } from '../js/linkage/shade-cloth.js';

function ring() {
    const st = createTestState({ modules: 8, hLengthFt: 8, vLengthFt: 7.97, pivotPct: 41.4, offsetTopIn: 1.25, offsetBotIn: 1, vertEndOffset: 1, hStackCount: 2, vStackCount: 3, hBeamW: 2.5, hBeamT: 1.5, vBeamW: 0.75, vBeamT: 2.5 });
    globalThis.state = st;
    st.animation.cachedClosedAngle = undefined;
    st.foldAngle = getOptimalClosedAngleForAnimation();
    return { st, data: solveLinkage(st.foldAngle) };
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

describe('shade-cloth', () => {
    it('roof polygon is the outer octagon of the top ring with one edge per module', () => {
        const { data } = ring();
        const roof = calculateRoofPolygon(data, 8);
        expect(roof.vertices).toHaveLength(8);
        const r = roof.vertices.map(p => Math.hypot(p.x - roof.center.x, p.z - roof.center.z));
        r.forEach(v => { expect(v).toBeGreaterThan(120); expect(v).toBeLessThan(145); });
        expect(roof.topY).toBeGreaterThan(80);
        expect(roof.edges).toHaveLength(8);
        expect(new Set(roof.edges.map(e => e.moduleIndex)).size).toBe(8);
        roof.edges.forEach(e => {
            expect(e.chordIn).toBeCloseTo(dist(e.a, e.b), 6);
            expect(Math.abs(e.u.x * e.nOut.x + e.u.z * e.nOut.z)).toBeLessThan(1e-4);
        });
    });

    it('lays one tarp per module, as wide as its outer pivot spacing, from past the pivots to beyond the centre', () => {
        const { st, data } = ring();
        const shade = createDefaultShade();
        shade.enabled = true;
        const res = calculateShadeCloths(data, shade, st);
        const roof = calculateRoofPolygon(data, 8);
        expect(res.supported).toBe(true);
        expect(res.count).toBe(8);
        expect(res.coveragePct).toBeGreaterThanOrEqual(99);
        expect(res.warnings).toHaveLength(0);
        expect(new Set(res.shapes.map(s => s.moduleIndex)).size).toBe(8);
        res.shapes.forEach((s, i) => {
            const e = roof.edges[i];
            expect(s.kind).toBe('shade');
            expect(s.corners3D).toHaveLength(4);
            expect(s.slabCorners3D).toHaveLength(8);
            // width = outer pivot distance of that edge; length = apothem + overhang + centre overlap
            expect(dist(s.corners3D[0], s.corners3D[1])).toBeCloseTo(e.chordIn, 3);
            expect(s.widthIn).toBeCloseTo(e.chordIn, 2);
            expect(dist(s.corners3D[1], s.corners3D[2])).toBeCloseTo(e.apothemIn + 6 + 12, 3);
            // outer edge midpoint sits `overhang` past the pivot chord, inner edge runs 12" past the centre
            const om = { x: (s.corners3D[0].x + s.corners3D[1].x) / 2, z: (s.corners3D[0].z + s.corners3D[1].z) / 2 };
            expect(dist(om, roof.center)).toBeCloseTo(e.apothemIn + 6, 3);
            const im = { x: (s.corners3D[2].x + s.corners3D[3].x) / 2, z: (s.corners3D[2].z + s.corners3D[3].z) / 2 };
            expect(dist(im, roof.center)).toBeCloseTo(12, 3);
            expect(s.corners3D[0].y).toBeCloseTo(res.y, 2);
            expect(s.insideAreaIn2).toBeGreaterThan(1000);
        });
        expect(res.sizes.reduce((a, sz) => a + sz.qty, 0)).toBe(8);
        expect(res.y).toBeGreaterThan(80);
    });

    it('width trim, custom sizes, overhang, rotation and stagger move the tarps as labelled', () => {
        const { st, data } = ring();
        const base = createDefaultShade();
        base.enabled = true;
        const ref = calculateShadeCloths(data, base, st);
        const gen = (over) => calculateShadeCloths(data, { ...base, ...over }, st);
        // width trim adds to every tarp; a big negative trim leaves gaps and warns
        gen({ widthTrimIn: 6 }).shapes.forEach((s, i) => expect(s.widthIn - ref.shapes[i].widthIn).toBeCloseTo(6, 2));
        const gappy = gen({ widthTrimIn: -40 });
        expect(gappy.coveragePct).toBeLessThan(99);
        expect(gappy.warnings.some(w => w.code === 'gaps')).toBe(true);
        // custom width / length are honoured exactly
        const custom = gen({ widthMode: 'custom', widthIn: 100, lengthMode: 'custom', lengthIn: 150 });
        custom.shapes.forEach(s => { expect(s.widthIn).toBeCloseTo(100, 6); expect(s.lengthIn).toBeCloseTo(150, 6); });
        expect(custom.sizes).toEqual([{ widthIn: 100, lengthIn: 150, qty: 8 }]);
        // overhang pushes the outer edge out by the same amount (auto length grows with it)
        const far = gen({ overhangIn: 18 });
        const roof = calculateRoofPolygon(data, 8);
        const om = (s) => ({ x: (s.corners3D[0].x + s.corners3D[1].x) / 2, z: (s.corners3D[0].z + s.corners3D[1].z) / 2 });
        expect(dist(om(far.shapes[0]), roof.center) - dist(om(ref.shapes[0]), roof.center)).toBeCloseTo(12, 3);
        expect(far.shapes[0].lengthIn - ref.shapes[0].lengthIn).toBeCloseTo(12, 2);
        // rotation turns every corner about the roof centre by the same angle
        const rot = gen({ rotationDeg: 22.5 });
        rot.shapes.forEach((s, i) => s.corners3D.forEach((p, k) => {
            const q = ref.shapes[i].corners3D[k];
            expect(dist(p, roof.center)).toBeCloseTo(dist(q, roof.center), 3);
            const a1 = Math.atan2(p.z - roof.center.z, p.x - roof.center.x), a0 = Math.atan2(q.z - roof.center.z, q.x - roof.center.x);
            let d = (a1 - a0) * 180 / Math.PI; d = ((d + 540) % 360) - 180;
            expect(Math.abs(d)).toBeCloseTo(22.5, 3);
        }));
        // stagger lifts every second tarp; a negative lift lowers everything; coverings top raises the base
        const st1 = gen({ staggerIn: 1 });
        expect(st1.shapes[1].corners3D[0].y - st1.shapes[0].corners3D[0].y).toBeCloseTo(1, 6);
        expect(st1.shapes[2].corners3D[0].y).toBeCloseTo(st1.shapes[0].corners3D[0].y, 6);
        const y0 = ref.shapes[0].corners3D[0].y;
        expect(gen({ liftIn: base.liftIn - 5 }).shapes[0].corners3D[0].y).toBeCloseTo(y0 - 5, 6);
        expect(calculateShadeCloths(data, base, st, { coveringsTopY: y0 + 20 }).shapes[0].corners3D[0].y).toBeCloseTo(y0 + 20 + base.liftIn, 6);
        expect(gen({ enabled: false }).count).toBe(0);
        expect(calculateShadeCloths(data, base, { ...st, orientation: 'vertical' }).unsupportedReason).toBe('arch');
    });

    it('normalize (incl. legacy grid configs and colours) and BOM rows', () => {
        const s = normalizeShade({ enabled: 1, widthMode: 'auto', widthIn: 0.001, opacity: 3, rotationDeg: 4000, liftIn: -30, staggerIn: -2, color: '#2F6FB3' });
        expect(s.enabled).toBe(true);
        expect(s.widthMode).toBe('auto');
        expect(s.widthIn).toBe(0.05);
        expect(s.opacity).toBe(1);
        expect(s.rotationDeg).toBe(360);
        expect(s.liftIn).toBe(-30);
        expect(s.staggerIn).toBe(-2);
        expect(s.color).toBe('#2f6fb3');
        // legacy grid config → custom sizes so the tarps keep their stock dimensions
        const legacy = normalizeShade({ enabled: true, widthIn: 144, lengthIn: 240, overlapIn: 6, offsetXIn: 3 });
        expect(legacy.widthMode).toBe('custom');
        expect(legacy.lengthMode).toBe('custom');
        expect(legacy.widthIn).toBe(144);
        expect(legacy.overhangIn).toBe(0);
        expect(legacy.overlapIn).toBeUndefined();
        expect(normalizeShade({}).widthMode).toBe('auto');
        expect(normalizeShade({ color: 'red' }).color).toBe('#6f8f86');
        expect(normalizeHexColor('#abc', '#000000')).toBe('#aabbcc');
        expect(normalizeHexColor('2f6fb3', '#000000')).toBe('#2f6fb3');
        const rows = shadeBomItems({ count: 8, coveragePct: 100, sizes: [{ widthIn: 101.5, lengthIn: 150, qty: 6 }, { widthIn: 90, lengthIn: 150, qty: 2 }] }, { costShadeCloth: 55 });
        expect(rows).toHaveLength(2);
        expect(rows[0].qty).toBe(6);
        expect(rows[0].total).toBe(330);
        expect(rows[0].stateKey).toBe('costShadeCloth');
        const one = shadeBomItem({ count: 8, coveragePct: 100, sizes: rows.map(r => ({ widthIn: 100, lengthIn: 150, qty: r.qty })) }, { costShadeCloth: 55 });
        expect(one.qty).toBe(8);
        expect(one.total).toBe(440);
        expect(shadeBomItems({ count: 0 }, {})).toEqual([]);
    });
});
