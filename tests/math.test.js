import { describe, expect, it } from 'vitest';
import { clamp, degToRad, radToDeg, v3, vAdd, vDot } from '../js/linkage/math.js';

describe('math', () => {
    it('clamp limits values', () => {
        expect(clamp(5, 0, 10)).toBe(5);
        expect(clamp(-1, 0, 10)).toBe(0);
        expect(clamp(99, 0, 10)).toBe(10);
    });

    it('converts degrees and radians', () => {
        expect(degToRad(180)).toBeCloseTo(Math.PI);
        expect(radToDeg(Math.PI)).toBeCloseTo(180);
    });

    it('supports vector helpers', () => {
        const a = v3(1, 2, 3);
        const b = v3(4, 5, 6);
        expect(vAdd(a, b)).toEqual({ x: 5, y: 7, z: 9 });
        expect(vDot(a, b)).toBe(32);
    });
});
