import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { degToRad } from '../js/linkage/math.js';
import { calculateActuatorStroke, solveLinkage } from '../js/linkage/solver.js';
import { getOptimalClosedAngleForAnimation } from '../js/linkage/joint-kinematics.js';
import {
    PLACEMENT_IDS,
    analyzePlacement,
    clearActuationMemo,
    comparePlacements,
    createDefaultActuation,
    driveModuleIndices,
    evaluatePlacementOnData,
    normalizeActuation,
    pivotsFromState,
    sampleDeploySweep,
} from '../js/linkage/actuation.js';

function soak() {
    // StarShade V1 SOAK 2026 geometry (8 modules, 2x4s)
    Object.assign(globalThis.state, {
        modules: 8, hLengthFt: 8, vLengthFt: 7.85, pivotPct: 41.4, hobermanAng: 0, pivotAng: 0,
        hStackCount: 2, vStackCount: 3, offsetTopIn: 1.75, offsetBotIn: 2, vertEndOffset: 1,
        hBeamW: 3.5, hBeamT: 1.5, vBeamW: 1.5, vBeamT: 3.5, useFixedBeams: false,
    });
    globalThis.state.animation.minFoldAngle = 6;
    globalThis.state.animation.cachedClosedAngle = undefined;
    globalThis.state.actuation = createDefaultActuation();
}

describe('actuation planner', () => {
    beforeAll(async () => {
        await import('../js/linkage/beam-bolt-helpers.js');
        await import('../js/linkage/hardware-detail.js');
    });
    beforeEach(() => { soak(); clearActuationMemo(); });

    it('solver exposes module pivots that match the upright endpoints', () => {
        const data = solveLinkage(degToRad(100));
        expect(data.modulePivots).toHaveLength(8);
        expect(data.frame.yMin).toBeGreaterThan(0);
        const mp = data.modulePivots[3];
        const verts = data.beams.filter(b => b.stackType === 'vertical' && b.moduleIndex === 3);
        expect(verts.length).toBeGreaterThan(0);
        // every upright's low end sits at yMin-ish and near one of the two bottom pivots in plan
        verts.forEach(v => {
            const lo = v.p1.y <= v.p2.y ? v.p1 : v.p2;
            const dIn = Math.hypot(lo.x - mp.botInner.x, lo.z - mp.botInner.z);
            const dOut = Math.hypot(lo.x - mp.botOuter.x, lo.z - mp.botOuter.z);
            expect(Math.min(dIn, dOut)).toBeLessThan(6); // stack offset + end extension
        });
        expect(Math.abs(mp.botInner.y - data.frame.yMin)).toBeLessThan(1e-9);
        expect(Math.abs(mp.topInner.y - data.frame.yMax)).toBeLessThan(1e-9);
    });

    it('pivotsFromState reproduces the solver pivots without a solve', () => {
        const theta = degToRad(80);
        const data = solveLinkage(theta);
        const quick = pivotsFromState(globalThis.state, theta);
        expect(quick.modules).toHaveLength(8);
        for (let i = 0; i < 8; i++) {
            ['botInner', 'botOuter', 'topInner', 'topOuter', 'hCross'].forEach(k => {
                expect(quick.modules[i][k].x).toBeCloseTo(data.modulePivots[i][k].x, 6);
                expect(quick.modules[i][k].y).toBeCloseTo(data.modulePivots[i][k].y, 6);
                expect(quick.modules[i][k].z).toBeCloseTo(data.modulePivots[i][k].z, 6);
            });
        }
        expect(quick.zHeight).toBeCloseTo(data.frame.zHeight, 6);
    });

    it('samples the sweep from packed to deployed with rising potential energy', () => {
        const samples = sampleDeploySweep(globalThis.state, { key: 'k1', samples: 9 });
        expect(samples).toHaveLength(9);
        expect(samples[0].thetaDeg).toBeCloseTo(6, 3);
        expect(samples[8].theta).toBeCloseTo(getOptimalClosedAngleForAnimation(), 9);
        for (let i = 1; i < samples.length; i++) expect(samples[i].U).toBeGreaterThan(samples[i - 1].U);
        expect(samples[0].totalWeight).toBeGreaterThan(400);
        expect(samples[0].totalWeight).toBeLessThan(700);
        // memo hit on the same key
        expect(sampleDeploySweep(globalThis.state, { key: 'k1', samples: 9 })).toBe(samples);
    });

    it('vertical jack force is flat and equal to the lifted weight per module', () => {
        const a = createDefaultActuation();
        a.load.efficiencyPct = 100; a.load.groundMu = 0;
        const samples = sampleDeploySweep(globalThis.state, { samples: 21 });
        const r = analyzePlacement('verticalJack', a, samples, { modules: 8 });
        const forces = r.curve.map(c => c.force);
        const mean = forces.reduce((x, y) => x + y, 0) / forces.length;
        forces.forEach(f => expect(Math.abs(f - mean) / mean).toBeLessThan(0.08));
        expect(mean).toBeCloseTo(r.liftedWeightLb / 8, 0);
        expect(mean).toBeGreaterThan(20);
        expect(mean).toBeLessThan(45);
        expect(r.senses).toEqual(['push']);
        expect(r.stroke).toBeGreaterThan(70);
    });

    it('track cable pull equals jack force times span/height and is a pure pull', () => {
        const a = createDefaultActuation();
        a.load.efficiencyPct = 100; a.load.groundMu = 0;
        const samples = sampleDeploySweep(globalThis.state, { samples: 21 });
        const jack = analyzePlacement('verticalJack', a, samples, { modules: 8 });
        const cable = analyzePlacement('trackCable', a, samples, { modules: 8 });
        expect(cable.senses).toEqual(['pull']);
        expect(cable.cableOk).toBe(true);
        for (let i = 2; i < samples.length - 2; i++) {
            const ratio = cable.curve[i].span / cable.curve[i].height;
            expect(cable.curve[i].force / jack.curve[i].force).toBeCloseTo(ratio, 0);
        }
        expect(cable.kickoffForce).toBeGreaterThan(cable.deployedForce * 10);
        expect(cable.stroke).toBeCloseTo(calculateActuatorStroke().stroke, 0);
    });

    it('H-scissor cross drive has a nearly flat force curve and short stroke', () => {
        const a = createDefaultActuation();
        a.load.efficiencyPct = 100; a.load.groundMu = 0;
        const samples = sampleDeploySweep(globalThis.state, { samples: 21 });
        const r = analyzePlacement('hScissor', a, samples, { modules: 8 });
        expect(r.flatness).toBeGreaterThan(0.5);
        expect(r.gravityFlatness).toBeGreaterThan(0.5);
        // packed at 6°: L = 2(r·sin3° + e·cos3°) with r = 24, e = 4
        expect(r.lenMin).toBeCloseTo(2 * (24 * Math.sin(degToRad(3)) + 4 * Math.cos(degToRad(3))), 2);
        expect(r.senses).toEqual(['push']);
        expect(r.stroke).toBeLessThan(45);
        expect(r.peakForce).toBeLessThan(100);
    });

    it('reports energy, power and a kick-off hand-over for the span drive', () => {
        const a = createDefaultActuation();
        a.motor.ratedForceLb = 150;
        const samples = sampleDeploySweep(globalThis.state, { samples: 21 });
        const r = analyzePlacement('trackCable', a, samples, { modules: 8 });
        expect(r.energyWh).toBeGreaterThan(0.3);
        expect(r.energyWh).toBeLessThan(20);
        expect(r.avgElectricalW).toBeGreaterThan(0);
        expect(r.currentA).toBeGreaterThan(0);
        expect(r.kickoff).not.toBeNull();
        expect(r.kickoff.handoverAngleDeg).toBeGreaterThan(6);
        expect(r.kickoff.equivalentLiftLb).toBeGreaterThan(0);
        expect(r.suggestedRatingLb).toBeGreaterThanOrEqual(Math.ceil(r.peakForce * 1.5));
    });

    it('fewer drives share the load and compare covers the whole catalog', () => {
        const a = createDefaultActuation();
        const samples = sampleDeploySweep(globalThis.state, { samples: 11 });
        const all = analyzePlacement('hScissor', a, samples, { modules: 8 });
        a.drives.pattern = 'alternate';
        const half = analyzePlacement('hScissor', a, samples, { modules: 8 });
        expect(half.nDrives).toBe(4);
        expect(half.peakForce).toBeCloseTo(all.peakForce * 2, 3);
        expect(driveModuleIndices(8, { count: 3, pattern: 'all' })).toEqual([0, 3, 5]);
        const rows = comparePlacements(a, samples, { modules: 8 });
        expect(rows.map(r => r.id)).toEqual(PLACEMENT_IDS);
    });

    it('evaluates placement endpoints on solved data for the 3D view', () => {
        const data = solveLinkage(degToRad(120));
        const ends = evaluatePlacementOnData('hScissor', { hScissorR: 20, hScissorE: 0 }, data, { count: 0, pattern: 'all' });
        expect(ends).toHaveLength(8);
        const e = ends[0];
        // both ends lie 20 in from the crossing in plan, at ring level
        expect(Math.hypot(e.a.x - data.modulePivots[0].hCross.x, e.a.z - data.modulePivots[0].hCross.z)).toBeCloseTo(20, 6);
        expect(Math.hypot(e.b.x - data.modulePivots[0].hCross.x, e.b.z - data.modulePivots[0].hCross.z)).toBeCloseTo(20, 6);
        expect(e.a.y).toBe(0);
        expect(e.length).toBeCloseTo(2 * 20 * Math.sin(degToRad(120) / 2), 4);
    });

    it('normalizes bad configs to defaults', () => {
        const n = normalizeActuation({ placement: 'nope', drives: { count: -3, pattern: 'x' }, load: { efficiencyPct: 500 } });
        expect(n.placement).toBe('hScissor');
        expect(n.drives).toEqual({ count: 0, pattern: 'all' });
        expect(n.load.efficiencyPct).toBe(100);
        expect(normalizeActuation(null).motor.deployTimeSec).toBe(60);
    });
});
