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
