import { describe, expect, it } from 'vitest';
import { WOOD_COLOR } from '../js/linkage/constants.js';
import { degToRad, v3 } from '../js/linkage/math.js';
import {
    calculateJointPositions,
    calculateBeamCostByVolume,
    createBeamStack,
    getEffectiveMinFoldAngle,
    solveLinkage,
} from '../js/linkage/solver.js';

describe('solver', () => {
    it('calculateJointPositions returns four joints and lengths', () => {
        const result = calculateJointPositions(Math.PI / 4, {
            hActiveIn: 120,
            pivotPct: 50,
            hobermanAng: 0,
            pivotAng: 0,
        });

        expect(result.joints).toHaveProperty('bl');
        expect(result.joints).toHaveProperty('br');
        expect(result.joints).toHaveProperty('tl');
        expect(result.joints).toHaveProperty('tr');
        expect(result.activeLength).toBeCloseTo(60);
        expect(result.passiveLength).toBeCloseTo(60);
        expect(Number.isFinite(result.relativeRotation)).toBe(true);
    });

    it('getEffectiveMinFoldAngle honors user override in state.animation', () => {
        globalThis.state.animation.minFoldAngle = 10;
        expect(getEffectiveMinFoldAngle()).toBeCloseTo(degToRad(10));
        globalThis.state.animation.minFoldAngle = null;
    });

    it('createBeamStack builds alternating beams with metadata', () => {
        const beams = [];
        const thickness = createBeamStack({
            p1_A: v3(0, 0, 0),
            p2_A: v3(100, 0, 0),
            p1_B: v3(0, 0, 5),
            p2_B: v3(100, 0, 5),
            count: 3,
            width: 3.5,
            thick: 1.5,
            color: WOOD_COLOR,
            offsetDir: v3(0, 1, 0),
            moduleIndex: 2,
            stackType: 'horizontal-top',
            stackId: 0,
            beamsArray: beams,
            gap: 0,
        });

        expect(thickness).toBeCloseTo(4.5);
        expect(beams).toHaveLength(3);
        expect(beams[0].moduleIndex).toBe(2);
        expect(beams[0].corners).toHaveLength(8);
    });

    it('solveLinkage returns beams and brackets for default test state', () => {
        const data = solveLinkage(globalThis.state.foldAngle);
        expect(data.beams.length).toBeGreaterThan(0);
        expect(Array.isArray(data.brackets)).toBe(true);
        expect(data.maxRad).toBeGreaterThan(0);
        expect(data.maxHeight).toBeGreaterThan(0);
    });

    it('calculateBeamCostByVolume scales with beam volume', () => {
        globalThis.state.refBeamWidth = 3.5;
        globalThis.state.refBeamThick = 1.5;
        globalThis.state.refBeamLength = 8;
        globalThis.state.refBeamPrice = 5.48;

        const small = calculateBeamCostByVolume(3.5, 1.5, 4);
        const large = calculateBeamCostByVolume(3.5, 1.5, 8);
        expect(large).toBeGreaterThan(small);
    });
});
