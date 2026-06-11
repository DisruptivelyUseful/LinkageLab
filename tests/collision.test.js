import { describe, expect, it } from 'vitest';
import { degToRad } from '../js/linkage/math.js';
import { detectCollisions } from '../js/linkage/collision.js';

describe('collision', () => {
    it('returns no collisions for an empty geometry payload', () => {
        globalThis.state.foldAngle = degToRad(45);
        globalThis.state.modules = 12;

        const collisions = detectCollisions({ beams: [], brackets: [] });
        expect(collisions).toEqual([]);
    });

    it('flags geometric over-fold when the ring exceeds 360 degrees', () => {
        const original = globalThis.calculateJointPositions;
        globalThis.calculateJointPositions = () => ({ relativeRotation: degToRad(30), joints: {} });
        globalThis.state.modules = 13;

        const beams = [
            { moduleIndex: 0, stackType: 'horizontal-top' },
            { moduleIndex: 12, stackType: 'horizontal-top' },
        ];

        const collisions = detectCollisions({ beams, brackets: [] });
        globalThis.calculateJointPositions = original;

        expect(collisions.length).toBeGreaterThan(0);
        expect(collisions[0].type).toBe('geometric-overfold');
    });
});
