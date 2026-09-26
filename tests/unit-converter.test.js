import { describe, expect, it } from 'vitest';
import { unitConverter } from '../js/core/unit-converter.js';

describe('unit-converter', () => {
    it('converts feet and inches with fallback math', () => {
        expect(unitConverter.feetToInches(1)).toBeCloseTo(12);
        expect(unitConverter.inchesToFeet(12)).toBeCloseTo(1);
        expect(unitConverter.inchesToMeters(39.3701)).toBeCloseTo(1, 2);
    });

    it('round-trips display conversion for length state keys', () => {
        const imperial = 10;
        const display = unitConverter.imperialToDisplay(imperial, 'in');
        const back = unitConverter.displayToImperial(display, 'in');
        expect(back).toBeCloseTo(imperial);
    });

    it('formats dimensions with units', () => {
        unitConverter.setPreferredUnitSystem('imperial');
        expect(unitConverter.formatDimensionWithUnit(12, 0)).toMatch(/12/);
    });
});

describe('formatInchesFraction', () => {
    it('formats shop fractions', () => {
        expect(unitConverter.formatInchesFraction(0.1875)).toBe('3/16"');
        expect(unitConverter.formatInchesFraction(22.1875)).toBe('22 3/16"');
        expect(unitConverter.formatInchesFraction(95.999)).toBe('96"');
        expect(unitConverter.formatInchesFraction(1.03125, 32)).toBe('1 1/32"');
        expect(unitConverter.formatInchesFraction(1.02, 16)).toBe('1"');
        expect(unitConverter.formatInchesFraction(2.5, 16, { unit: ' in' })).toBe('2 1/2 in');
        expect(unitConverter.formatInchesFraction(-0.75)).toBe('-3/4"');
    });
});
