import { describe, expect, it } from 'vitest';
import { MAX_FOLD_ANGLE, MIN_FOLD_ANGLE } from '../js/linkage/constants.js';
import { degToRad } from '../js/linkage/math.js';
import {
    calculateJointPositions,
    getOptimalClosedAngleForAnimation,
} from '../js/linkage/joint-kinematics.js';

describe('joint-kinematics', () => {
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

    it('getOptimalClosedAngleForAnimation returns a deploy angle for default state', () => {
        globalThis.state.animation.cachedClosedAngle = undefined;

        const closedAngle = getOptimalClosedAngleForAnimation();

        expect(closedAngle).toBeGreaterThanOrEqual(MIN_FOLD_ANGLE);
        expect(closedAngle).toBeLessThanOrEqual(MAX_FOLD_ANGLE);
        expect(Number.isFinite(closedAngle)).toBe(true);
    });

    it('reuses cached closed angle for unchanged structure parameters', () => {
        globalThis.state.animation.cachedClosedAngle = undefined;

        const first = getOptimalClosedAngleForAnimation();
        const second = getOptimalClosedAngleForAnimation();

        expect(second).toBe(first);
    });
});
