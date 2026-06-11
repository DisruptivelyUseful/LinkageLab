import { describe, expect, it } from 'vitest';
import { degToRad } from '../js/linkage/math.js';
import { calculateJointPositions, getEffectiveMinFoldAngle } from '../js/linkage/solver.js';

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
});
