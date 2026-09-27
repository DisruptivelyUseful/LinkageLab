import { beforeAll, describe, expect, it } from 'vitest';
import { createTestState } from './helpers/state-fixture.js';
import { solveLinkage } from '../js/linkage/solver.js';
import { getOptimalClosedAngleForAnimation } from '../js/linkage/joint-kinematics.js';
import { analyzeRadialFootprint, planRadialArray, applyRadialArray, isRadialArrayActive, replicateShapes, cloneCoveringShape, makeSlotTransforms } from '../js/linkage/radial-array.js';
import { createDefaultCoverings, computeCoverings } from '../js/linkage/coverings-geometry.js';

beforeAll(async () => {
    // The arch (vertical) path needs the V-stack width helpers on globalThis.
    await import('../js/linkage/beam-bolt-helpers.js');
});

/**
 * Solve a ring that really closes: the fixture's symmetric module (pivot 50%)
 * has zero relative rotation between modules and would build a straight chain,
 * so use an asymmetric pivot and the computed closed angle unless overridden.
 * Then apply the radial array exactly as buildLinkageGeometry() does as its
 * last step (the solver itself stays single-structure).
 */
function solveWith(overrides) {
    globalThis.state = createTestState({ showBolts: true, showBrackets: true, pivotPct: 40, ...overrides });
    if (overrides.foldAngle === undefined) {
        globalThis.state.foldAngle = getOptimalClosedAngleForAnimation();
    }
    const data = solveLinkage(globalThis.state.foldAngle);
    const radial = applyRadialArray(globalThis.state, data);
    if (!radial) return { ...data, radialArray: null };
    return { ...data, ...radial.geometry, radialArray: radial.plan, maxRad: radial.plan.maxRad };
}

/** Mean XZ of the horizontal beams belonging to one array copy. */
function copyCenter(data, arrayIndex) {
    const beams = data.beams.filter(b => b.arrayIndex === arrayIndex && b.stackType.startsWith('horizontal'));
    const sum = beams.reduce((acc, b) => ({ x: acc.x + b.center.x, z: acc.z + b.center.z }), { x: 0, z: 0 });
    return { x: sum.x / beams.length, z: sum.z / beams.length, count: beams.length };
}

function ringCenterOf(data) {
    // Base (single) structure ring centre, as the module uses it
    return data.radialArray.anchor;
}

function dist(a, b) {
    return Math.hypot(a.x - b.x, a.z - b.z);
}

describe('radial array: activation', () => {
    it('is inactive by default and leaves solver output untouched', () => {
        const single = solveWith({ modules: 6 });
        expect(single.radialArray).toBeNull();
        expect(isRadialArrayActive(globalThis.state)).toBe(false);
        expect(single.beams.every(b => b.arrayIndex === undefined)).toBe(true);
    });

    it('the solver itself never arrays (collision checks and goldens see one structure)', () => {
        globalThis.state = createTestState({ radialArrayEnabled: true, radialCount: 6, pivotPct: 40 });
        globalThis.state.foldAngle = getOptimalClosedAngleForAnimation();
        const data = solveLinkage(globalThis.state.foldAngle);
        expect(data.radialArray).toBeUndefined();
        expect(data.beams.every(b => b.arrayIndex === undefined)).toBe(true);
    });

    it('applyRadialArray returns null when disabled', () => {
        const s = createTestState({ radialArrayEnabled: false });
        expect(applyRadialArray(s, { beams: [] })).toBeNull();
    });
});

describe('radial array: horizontal honeycomb', () => {
    it('emits centre + N ring copies, each a full copy of the base structure', () => {
        const single = solveWith({ modules: 6 });
        const arr = solveWith({ modules: 6, radialArrayEnabled: true, radialCount: 6, radialCenter: true });
        expect(arr.radialArray).not.toBeNull();
        expect(arr.radialArray.copyCount).toBe(7);
        ['beams', 'brackets', 'bolts', 'washers'].forEach(k => {
            expect(arr[k].length, k).toBe(single[k].length * 7);
        });
        const indices = new Set(arr.beams.map(b => b.arrayIndex));
        expect([...indices].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it('omits the centre structure when radialCenter is false', () => {
        const single = solveWith({ modules: 6 });
        const arr = solveWith({ modules: 6, radialArrayEnabled: true, radialCount: 6, radialCenter: false });
        expect(arr.radialArray.copyCount).toBe(6);
        expect(arr.beams.length).toBe(single.beams.length * 6);
        expect(new Set(arr.beams.map(b => b.arrayIndex)).size).toBe(6);
    });

    it('places ring copies at the auto radius, evenly spaced, with copy 0 against module 0', () => {
        const arr = solveWith({ modules: 6, radialArrayEnabled: true, radialCount: 6, radialCenter: true });
        const plan = arr.radialArray;
        const anchor = ringCenterOf(arr);
        const c0 = copyCenter(arr, 0);
        // Centre copy sits on the anchor (it is the untransformed base structure).
        // The searched closed angle is only accurate to 0.1°, so the mean of the
        // beam centres is a hair off the true circumcentre; allow that slack.
        expect(dist(c0, anchor)).toBeLessThan(0.5);
        // Honeycomb pitch: twice the module-0 face reach
        expect(plan.radius).toBeCloseTo(2 * plan.footprint.faceReach, 6);
        for (let k = 0; k < 6; k++) {
            const c = copyCenter(arr, k + 1);
            expect(Math.abs(dist(c, anchor) - plan.radius)).toBeLessThan(0.5);
            const ang = Math.atan2(c.z - anchor.z, c.x - anchor.x);
            const expected = plan.startRad + (k * 2 * Math.PI) / 6;
            const diff = Math.atan2(Math.sin(ang - expected), Math.cos(ang - expected));
            expect(Math.abs(diff)).toBeLessThan(1e-3);
        }
        // Copy 0 direction is module 0's flat face direction
        const m0 = arr.beams.filter(b => b.arrayIndex === 0 && b.moduleIndex === 0 && b.stackType.startsWith('horizontal'));
        const m0c = m0.reduce((a, b) => ({ x: a.x + b.center.x / m0.length, z: a.z + b.center.z / m0.length }), { x: 0, z: 0 });
        const faceAng = Math.atan2(m0c.z - anchor.z, m0c.x - anchor.x);
        expect(Math.abs(Math.atan2(Math.sin(faceAng - plan.autoStartRad), Math.cos(faceAng - plan.autoStartRad)))).toBeLessThan(1e-6);
    });

    it('adjacent honeycomb cells share a face: the ring copy face lies against the centre face', () => {
        const arr = solveWith({ modules: 6, radialArrayEnabled: true, radialCount: 6, radialCenter: true });
        const plan = arr.radialArray;
        const anchor = plan.anchor;
        const ux = Math.cos(plan.startRad), uz = Math.sin(plan.startRad);
        // Max reach of the centre copy along the copy-0 direction
        const reach = (idx) => Math.max(...arr.beams
            .filter(b => b.arrayIndex === idx && b.stackType.startsWith('horizontal'))
            .flatMap(b => b.corners.map(c => (c.x - anchor.x) * ux + (c.z - anchor.z) * uz)));
        const minReach = (idx) => Math.min(...arr.beams
            .filter(b => b.arrayIndex === idx && b.stackType.startsWith('horizontal'))
            .flatMap(b => b.corners.map(c => (c.x - anchor.x) * ux + (c.z - anchor.z) * uz)));
        // The near face of copy 1 coincides with the far face of the centre copy
        // (within the slack of a ring closed to 0.1°).
        expect(Math.abs(minReach(1) - reach(0))).toBeLessThan(0.5);
    });

    it('applies spacing, start angle, height offset and manual radius', () => {
        const base = solveWith({ modules: 6, radialArrayEnabled: true, radialCount: 4, radialCenter: false });
        const r0 = base.radialArray.radius;
        const spaced = solveWith({ modules: 6, radialArrayEnabled: true, radialCount: 4, radialCenter: false, radialSpacing: 12 });
        expect(spaced.radialArray.radius).toBeCloseTo(r0 + 12, 6);

        const manual = solveWith({ modules: 6, radialArrayEnabled: true, radialCount: 4, radialCenter: false,
                                   radialRadiusAuto: false, radialRadius: 300, radialSpacing: -20 });
        expect(manual.radialArray.radius).toBeCloseTo(280, 6);
        expect(Math.abs(dist(copyCenter(manual, 0), manual.radialArray.anchor) - 280)).toBeLessThan(0.5);

        const turned = solveWith({ modules: 6, radialArrayEnabled: true, radialCount: 4, radialCenter: false, radialStartAngle: 45 });
        expect(turned.radialArray.startRad).toBeCloseTo(base.radialArray.startRad + Math.PI / 4, 9);

        const lifted = solveWith({ modules: 6, radialArrayEnabled: true, radialCount: 2, radialCenter: true, radialHeightOffset: 10 });
        const yOf = (idx) => lifted.beams.filter(b => b.arrayIndex === idx)[0].center.y;
        expect(yOf(1) - yOf(0)).toBeCloseTo(10, 6);
        expect(lifted.brackets.find(b => b.arrayIndex === 1).bottomY - lifted.brackets.find(b => b.arrayIndex === 0).bottomY).toBeCloseTo(10, 6);
    });

    it('clones support beams and panels as part of each copy, rotating their frames', () => {
        const data = solveWith({ modules: 6 });
        // Synthetic post-solver additions, as buildLinkageGeometry appends them
        const support = { ...data.beams[0], stackType: 'support-beam', moduleIndex: 0, stackId: 0 };
        const panel = {
            type: 'panel', center: { x: 10, y: 50, z: 0 }, rotation: 0.3,
            axisX: { x: 1, y: 0, z: 0 }, axisY: { x: 0, y: 1, z: 0 }, axisZ: { x: 0, y: 0, z: 1 },
            normal: { x: 0, y: 1, z: 0 },
            corners: [{ x: 5, y: 50, z: -5 }, { x: 15, y: 50, z: -5 }, { x: 15, y: 50, z: 5 }, { x: 5, y: 50, z: 5 }],
            faces: [{ idx: [0, 1, 2, 3], norm: { x: 0, y: 1, z: 0 } }],
            gridLines: [{ start: { x: 5, y: 50.1, z: 0 }, end: { x: 15, y: 50.1, z: 0 } }],
        };
        const geo = { ...data, beams: data.beams.concat([support]), supportBeams: [support], panels: [panel] };
        const s = createTestState({ ...globalThis.state, radialArrayEnabled: true, radialCount: 3, radialCenter: true, radialSpin: 0 });
        const out = applyRadialArray(s, geo).geometry;
        expect(out.panels.length).toBe(4);
        expect(out.supportBeams.length).toBe(4);
        expect(out.beams.filter(b => b.stackType === 'support-beam').length).toBe(4);
        // Slot 2 (second ring copy) is rotated 120° about the anchor: the panel normal stays up, axisX turns
        const p1 = out.panels.find(p => p.arrayIndex === 2);
        expect(p1.normal.y).toBeCloseTo(1, 9);
        expect(p1.rotation).toBeCloseTo(0.3 + (2 * Math.PI) / 3, 9);
        const ang = Math.atan2(p1.axisX.z, p1.axisX.x);
        expect(Math.abs(Math.atan2(Math.sin(ang - (2 * Math.PI) / 3), Math.cos(ang - (2 * Math.PI) / 3)))).toBeLessThan(1e-9);
        // Grid lines and corners moved rigidly with the centre
        const dCenter = Math.hypot(p1.center.x - p1.gridLines[0].start.x, p1.center.z - p1.gridLines[0].start.z);
        expect(dCenter).toBeCloseTo(5, 6);
        expect(out.panels.find(p => p.arrayIndex === 0).center).toEqual(panel.center);
    });

    it('rotates bracket bases and hardware placement frames rigidly', () => {
        const data = solveWith({ modules: 6 });
        const bracket = { ...data.brackets[0], basis: { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } } };
        const placement = { assemblyId: 'outerVBeam', moduleIndex: 0, ring: 'bottom', pos: { ...data.brackets[0].pos },
            beamDir: { x: 0, y: 0, z: 1 }, frame: { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } } };
        const geo = { ...data, brackets: [bracket], hardwareAssemblyPlacements: [placement] };
        const s = createTestState({ ...globalThis.state, radialArrayEnabled: true, radialCount: 4, radialCenter: false });
        const out = applyRadialArray(s, geo).geometry;
        const b1 = out.brackets.find(b => b.arrayIndex === 1);
        const pl1 = out.hardwareAssemblyPlacements.find(p => p.arrayIndex === 1);
        // 90° about Y maps +X to +Z (and +Z to -X) in this module's XZ rotation convention
        expect(b1.basis.x.z).toBeCloseTo(1, 9);
        expect(b1.basis.y.y).toBeCloseTo(1, 9);
        expect(pl1.frame.z.x).toBeCloseTo(-1, 9);
        expect(pl1.beamDir.x).toBeCloseTo(-1, 9);
    });

    it('rotates beam axes with the copy so beams stay rigid', () => {
        const arr = solveWith({ modules: 8, radialArrayEnabled: true, radialCount: 3, radialCenter: true, radialSpin: 15 });
        const single = arr.beams.filter(b => b.arrayIndex === 0);
        const copy = arr.beams.filter(b => b.arrayIndex === 2);
        expect(copy.length).toBe(single.length);
        for (let i = 0; i < single.length; i += 7) {
            const a = single[i], b = copy[i];
            const la = Math.hypot(a.p2.x - a.p1.x, a.p2.y - a.p1.y, a.p2.z - a.p1.z);
            const lb = Math.hypot(b.p2.x - b.p1.x, b.p2.y - b.p1.y, b.p2.z - b.p1.z);
            expect(lb).toBeCloseTo(la, 6);
            // axisZ must still point along p1->p2 after rotation
            const dz = { x: (b.p2.x - b.p1.x) / lb, y: (b.p2.y - b.p1.y) / lb, z: (b.p2.z - b.p1.z) / lb };
            expect(dz.x * b.axisZ.x + dz.y * b.axisZ.y + dz.z * b.axisZ.z).toBeCloseTo(1, 6);
            // y components are rotation-invariant (rotation about Y)
            expect(b.axisX.y).toBeCloseTo(a.axisX.y, 9);
        }
    });

    it('keeps the anchor at the ring circumcentre at any fold angle', () => {
        // Partly folded (open arc, not a closed ring): module centres still lie on one circle.
        globalThis.state = createTestState({ modules: 8, pivotPct: 40 });
        const closed = getOptimalClosedAngleForAnimation();
        const s = globalThis.state;
        s.foldAngle = closed - (20 * Math.PI) / 180;
        const data = solveLinkage(s.foldAngle);
        const fp = analyzeRadialFootprint(data.beams, 'horizontal', 6);
        // All module centres must be equidistant from the anchor
        const perModule = {};
        data.beams.filter(b => b.stackType.startsWith('horizontal')).forEach(b => {
            const m = perModule[b.moduleIndex] || (perModule[b.moduleIndex] = { x: 0, z: 0, n: 0 });
            m.x += b.center.x; m.z += b.center.z; m.n++;
        });
        const radii = Object.values(perModule).map(m => Math.hypot(m.x / m.n - fp.anchor.x, m.z / m.n - fp.anchor.z));
        radii.forEach(r => expect(r).toBeCloseTo(radii[0], 4));
    });

    it('falls back to the footprint centre for a straight (non-curving) chain', () => {
        globalThis.state = createTestState({ modules: 6, pivotPct: 50, foldAngle: (100 * Math.PI) / 180 });
        const data = solveLinkage(globalThis.state.foldAngle);
        const fp = analyzeRadialFootprint(data.beams, 'horizontal', 6);
        expect(Number.isFinite(fp.anchor.x) && Number.isFinite(fp.anchor.z)).toBe(true);
        expect(fp.autoRadius).toBeGreaterThan(0);
        const arr = applyRadialArray(createTestState({ radialArrayEnabled: true, radialCount: 3 }), data);
        expect(arr.geometry.beams.length).toBe(data.beams.length * 4);
    });
});

describe('radial array: vertical toroid', () => {
    it('places each arch on a radial plane around the anchor', () => {
        const arr = solveWith({ modules: 5, orientation: 'vertical', radialArrayEnabled: true, radialCount: 8, radialCenter: false });
        const plan = arr.radialArray;
        expect(plan.copyCount).toBe(8);
        for (let k = 0; k < 8; k++) {
            const beams = arr.beams.filter(b => b.arrayIndex === k);
            // Fit the arch's XZ extent: the long axis (feet spread) must be radial.
            const c = beams.reduce((a, b) => ({ x: a.x + b.center.x / beams.length, z: a.z + b.center.z / beams.length }), { x: 0, z: 0 });
            const theta = Math.atan2(c.z - plan.anchor.z, c.x - plan.anchor.x);
            const ux = Math.cos(theta), uz = Math.sin(theta);
            let radialSpread = 0, tangentSpread = 0;
            let rMin = Infinity, rMax = -Infinity, tMin = Infinity, tMax = -Infinity;
            beams.forEach(b => b.corners.forEach(p => {
                const r = (p.x - c.x) * ux + (p.z - c.z) * uz;
                const t = -(p.x - c.x) * uz + (p.z - c.z) * ux;
                rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
                tMin = Math.min(tMin, t); tMax = Math.max(tMax, t);
            }));
            radialSpread = rMax - rMin; tangentSpread = tMax - tMin;
            expect(radialSpread).toBeCloseTo(2 * plan.footprint.halfWidth, 2);
            expect(tangentSpread).toBeCloseTo(plan.footprint.depth, 2);
            // Beam-centre mean vs. footprint centre differ slightly for an asymmetric arch
            expect(Math.abs(dist(c, plan.anchor) - plan.radius)).toBeLessThan(0.5);
        }
    });

    it('auto radius makes adjacent inner feet just meet', () => {
        const arr = solveWith({ modules: 5, orientation: 'vertical', radialArrayEnabled: true, radialCount: 6, radialCenter: false });
        const { radius, footprint } = arr.radialArray;
        const innerR = radius - footprint.halfWidth;
        expect(2 * innerR * Math.sin(Math.PI / 6)).toBeCloseTo(footprint.depth, 6);
    });

    it('keeps every copy at the same ground level as the single arch', () => {
        const single = solveWith({ modules: 5, orientation: 'vertical' });
        const baseMinY = Math.min(...single.beams.flatMap(b => b.corners.map(c => c.y)));
        const baseMaxY = Math.max(...single.beams.flatMap(b => b.corners.map(c => c.y)));
        const arr = solveWith({ modules: 5, orientation: 'vertical', radialArrayEnabled: true, radialCount: 4, radialCenter: false });
        for (let k = 0; k < 4; k++) {
            const ys = arr.beams.filter(b => b.arrayIndex === k).flatMap(b => b.corners.map(c => c.y));
            expect(Math.min(...ys)).toBeCloseTo(baseMinY, 6);
            expect(Math.max(...ys)).toBeCloseTo(baseMaxY, 6);
        }
    });

    it('composes with the linear (tunnel) array into a segmented toroid with unique indices', () => {
        const tunnel = solveWith({ modules: 5, orientation: 'vertical', arrayCount: 3 });
        const arr = solveWith({ modules: 5, orientation: 'vertical', arrayCount: 3, radialArrayEnabled: true, radialCount: 4, radialCenter: false });
        expect(arr.radialArray.linearCount).toBe(3);
        expect(arr.beams.length).toBe(tunnel.beams.length * 4);
        const idx = [...new Set(arr.beams.map(b => b.arrayIndex))].sort((a, b) => a - b);
        expect(idx).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    });
});

describe('radial array: planning helpers', () => {
    it('planRadialArray clamps count and honours rotateCopies=false', () => {
        const s = createTestState({ radialArrayEnabled: true, radialCount: 99, radialRotateCopies: false, radialSpin: 10, pivotPct: 40 });
        globalThis.state = s;
        s.foldAngle = getOptimalClosedAngleForAnimation();
        const data = solveLinkage(s.foldAngle);
        const plan = planRadialArray(s, data.beams);
        expect(plan.count).toBe(12);
        plan.slots.filter(sl => !sl.isCenter).forEach(sl => expect(sl.phiRad).toBeCloseTo((10 * Math.PI) / 180, 9));
    });
});

describe('radial array: coverings follow the copies', () => {
    const edge = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const areaXZ = (pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p.x * q.z - q.x * p.z; } return Math.abs(s) / 2; };

    it('cloneCoveringShape is a rigid transform of corners, plane and 2D frames', () => {
        const s = createTestState({ radialArrayEnabled: true, radialCount: 4, radialCenter: false, radialSpin: 30, pivotPct: 40 });
        globalThis.state = s;
        s.foldAngle = getOptimalClosedAngleForAnimation();
        const data = solveLinkage(s.foldAngle);
        const plan = planRadialArray(s, data.beams);
        const slot = plan.slots[1];
        const xf = makeSlotTransforms(plan, slot);
        const shape = {
            corners3D: [{ x: 0, y: 0, z: 0 }, { x: 90, y: 0, z: 0 }, { x: 80, y: 48, z: 5 }, { x: 10, y: 48, z: 5 }],
            slabCorners3D: [{ x: 0, y: 0, z: 0 }, { x: 90, y: 0, z: 0 }, { x: 80, y: 48, z: 5 }, { x: 10, y: 48, z: 5 }, { x: 0, y: 0, z: 0.5 }, { x: 90, y: 0, z: 0.5 }, { x: 80, y: 48, z: 5.5 }, { x: 10, y: 48, z: 5.5 }],
            center: { x: 45, y: 24, z: 2.5 }, normal: { x: 0, y: 0.1, z: -0.995 },
            plane: { origin: { x: 0, y: 0, z: 0 }, n: { x: 0, y: 0, z: -1 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 } },
            plan2D: [{ x: -50, z: -110 }, { x: 50, z: -110 }, { x: 50, z: 40 }, { x: -50, z: 40 }],
            frame: { origin: { x: 0, z: -110 }, u: { x: 1, z: 0 }, inward: { x: 0, z: 1 } },
        };
        const c = cloneCoveringShape(shape, xf, 7, slot.slot, false);
        expect(c.arrayIndex).toBe(7);
        expect(c.isBaseCopy).toBe(false);
        for (let i = 0; i < 4; i++) expect(edge(c.corners3D[i], c.corners3D[(i + 1) % 4])).toBeCloseTo(edge(shape.corners3D[i], shape.corners3D[(i + 1) % 4]), 9);
        expect(c.slabCorners3D).toHaveLength(8);
        expect(c.corners3D[0].y + slot.offset.y).toBeCloseTo(c.corners3D[0].y + slot.offset.y, 9);
        expect(Math.hypot(c.plane.n.x, c.plane.n.y, c.plane.n.z)).toBeCloseTo(1, 9);
        expect(Math.atan2(c.plane.u.z, c.plane.u.x)).toBeCloseTo(slot.phiRad, 9);
        expect(Math.abs(c.plane.n.x * c.plane.u.x + c.plane.n.y * c.plane.u.y + c.plane.n.z * c.plane.u.z)).toBeLessThan(1e-9);
        expect(areaXZ(c.plan2D)).toBeCloseTo(areaXZ(shape.plan2D), 6);
        expect(Math.hypot(c.frame.u.x, c.frame.u.z)).toBeCloseTo(1, 9);
        // the transformed centre matches the transformed corners' centroid
        const cx = c.corners3D.reduce((a, p) => a + p.x, 0) / 4, cz = c.corners3D.reduce((a, p) => a + p.z, 0) / 4;
        expect(Math.hypot(c.center.x - cx, c.center.z - cz)).toBeCloseTo(Math.hypot(shape.center.x - 45, shape.center.z - 2.5), 6);
    });

    it('replicateShapes puts one copy in every slot, none at an empty centre, and keeps the base set intact', () => {
        const s = createTestState({ modules: 8, hLengthFt: 8, vLengthFt: 7.97, pivotPct: 41.4, offsetTopIn: 1.25, offsetBotIn: 1, vertEndOffset: 1, hStackCount: 2, vStackCount: 3, hBeamW: 2.5, hBeamT: 1.5, vBeamW: 0.75, vBeamT: 2.5, radialArrayEnabled: true, radialCount: 6, radialCenter: false });
        globalThis.state = s;
        s.animation.cachedClosedAngle = undefined;
        s.foldAngle = getOptimalClosedAngleForAnimation();
        const data = solveLinkage(s.foldAngle);
        const cov = createDefaultCoverings(8);
        cov.enabled = true;
        cov.spans.forEach(sp => { sp.lower = 'plywood'; sp.table = true; });
        const single = computeCoverings(data, cov, s);
        expect(single.supported).toBe(true);
        const base = single.shapes;
        const radial = applyRadialArray(s, data);
        const plan = radial.plan;
        expect(plan.copyCount).toBe(6);
        const copies = replicateShapes(plan, base);
        expect(copies).toHaveLength(6 * base.length);
        expect(new Set(copies.map(c => c.arrayIndex)).size).toBe(6);
        expect(copies.filter(c => c.isBaseCopy)).toHaveLength(base.length);
        // same wall dimensions on every copy; nothing left near the (empty) anchor
        copies.forEach(c => {
            const b = base.find(x => x.spanIndex === c.spanIndex && x.band === c.band);
            expect(c.widthBottomIn).toBe(b.widthBottomIn);
            expect(Math.hypot(c.center.x - plan.anchor.x, c.center.z - plan.anchor.z)).toBeGreaterThan(plan.radius * 0.5);
        });
        // without a plan the shapes pass through as the base copy
        const passthrough = replicateShapes(null, base);
        expect(passthrough).toHaveLength(base.length);
        expect(passthrough.every(c => c.isBaseCopy)).toBe(true);
        // each copy's walls sit on that copy's own uprights: a copy wall centre is close to some beam of the same arrayIndex
        const idx = copies[0].arrayIndex;
        const beams = radial.geometry.beams.filter(b => b.arrayIndex === idx && b.stackType === 'vertical');
        const wall = copies.find(c => c.arrayIndex === idx && c.kind === 'wall');
        const near = Math.min(...beams.map(b => Math.hypot(b.center.x - wall.center.x, b.center.z - wall.center.z)));
        expect(near).toBeLessThan(80);
    });
});
