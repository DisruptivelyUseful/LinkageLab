import { describe, expect, it, vi } from 'vitest';
import { WOOD_COLOR } from '../js/linkage/constants.js';
import { degToRad } from '../js/linkage/math.js';
import { Beam3D } from '../js/linkage/geometry-classes.js';
import { detectCollisions } from '../js/linkage/collision.js';
import * as solver from '../js/linkage/solver.js';

describe('collision', () => {
    it('returns no collisions for an empty geometry payload', () => {
        globalThis.state.foldAngle = degToRad(45);
        globalThis.state.modules = 12;

        const collisions = detectCollisions({ beams: [], brackets: [] });
        expect(collisions).toEqual([]);
    });

    it('flags geometric over-fold when the ring exceeds 360 degrees', () => {
        const spy = vi.spyOn(solver, 'calculateJointPositions').mockReturnValue({
            relativeRotation: degToRad(30),
            joints: {},
        });
        globalThis.state.modules = 13;

        const beams = [
            { moduleIndex: 0, stackType: 'horizontal-top' },
            { moduleIndex: 12, stackType: 'horizontal-top' },
        ];

        const collisions = detectCollisions({ beams, brackets: [] });
        spy.mockRestore();

        expect(collisions.length).toBeGreaterThan(0);
        expect(collisions[0].type).toBe('geometric-overfold');
    });

    it('detects vertical-horizontal beam overlap with real Beam3D geometry', () => {
        globalThis.state.modules = 12;
        globalThis.state.foldAngle = degToRad(45);

        const vertical = new Beam3D(
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 48, z: 0 },
            3.5,
            1.5,
            WOOD_COLOR,
            { moduleIndex: 0, stackType: 'vertical' },
        );
        const horizontal = new Beam3D(
            { x: -24, y: 22, z: -8 },
            { x: 24, y: 26, z: 8 },
            3.5,
            1.5,
            WOOD_COLOR,
            { moduleIndex: 5, stackType: 'horizontal-top' },
        );

        const collisions = detectCollisions({ beams: [vertical, horizontal], brackets: [] });
        expect(collisions.some(c => c.type === 'vertical-horizontal')).toBe(true);
    });
});