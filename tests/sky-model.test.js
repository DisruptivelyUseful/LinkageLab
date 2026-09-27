import { describe, expect, it } from 'vitest';
import {
    SKY_PALETTE, hexToRgb, rgbToHex, hexToLinear, linearToHex, smoothstep01,
    hourOfDayFromSunTime, formatClock, studioModel, skyModel, skyModelForState,
} from '../js/linkage/sky-model.js';
import { createTestState } from './helpers/state-fixture.js';

describe('sky-model: colour helpers', () => {
    it('round-trips hex through rgb and linear', () => {
        expect(rgbToHex(hexToRgb('#22d3ee'))).toBe('#22d3ee');
        expect(linearToHex(hexToLinear('#22d3ee'))).toBe('#22d3ee');
        const lin = hexToLinear('#808080');
        expect(lin.r).toBeCloseTo(0.2158, 3);     // sRGB mid grey is ~21.6 % linear
    });

    it('smoothstep is clamped and monotonic', () => {
        expect(smoothstep01(-1)).toBe(0);
        expect(smoothstep01(2)).toBe(1);
        expect(smoothstep01(0.5)).toBeCloseTo(0.5, 6);
        expect(smoothstep01(0.25)).toBeLessThan(smoothstep01(0.75));
    });
});

describe('sky-model: clock', () => {
    it('maps the 0-100 slider onto a 24 h day with noon at 50', () => {
        expect(hourOfDayFromSunTime(0)).toBe(0);
        expect(hourOfDayFromSunTime(50)).toBe(12);
        expect(hourOfDayFromSunTime(100)).toBe(24);
        expect(formatClock(12)).toBe('12:00 PM');
        expect(formatClock(0)).toBe('12:00 AM');
        expect(formatClock(6.25)).toBe('6:15 AM');
    });
});

describe('sky-model: day / night model', () => {
    const noon = skyModel({ sunElevationDeg: 75 });
    const dusk = skyModel({ sunElevationDeg: 2 });
    const night = skyModel({ sunElevationDeg: -30 });

    it('is fully day at high sun and fully night well below the horizon', () => {
        expect(noon.daylight).toBeCloseTo(1, 3);
        expect(noon.night).toBeCloseTo(0, 3);
        expect(noon.starOpacity).toBe(0);
        expect(night.daylight).toBeCloseTo(0, 3);
        expect(night.night).toBeCloseTo(1, 3);
        expect(night.starOpacity).toBeGreaterThan(0.9);
    });

    it('hands the shadows from the sun to the moon at night', () => {
        expect(noon.key.intensity).toBeGreaterThan(1);
        expect(noon.moon.intensity).toBe(0);
        expect(noon.moonCastsShadows).toBe(false);
        expect(night.key.intensity).toBe(0);
        expect(night.moon.intensity).toBeGreaterThan(0.3);
        expect(night.moonCastsShadows).toBe(true);
    });

    it('is brighter and more exposed by day than at dusk than at night', () => {
        expect(noon.key.intensity).toBeGreaterThan(dusk.key.intensity);
        expect(dusk.key.intensity).toBeGreaterThan(night.key.intensity);
        expect(noon.hemi.intensity).toBeGreaterThan(night.hemi.intensity);
        expect(noon.envScale).toBeGreaterThan(night.envScale);
        expect(noon.exposure).toBeGreaterThan(night.exposure);
        [noon, dusk, night].forEach((m) => {
            expect(m.exposure).toBeGreaterThanOrEqual(0.85);
            expect(m.exposure).toBeLessThanOrEqual(1.1);
        });
    });

    it('produces a warm low sun and a white high sun', () => {
        const low = skyModel({ sunElevationDeg: 4 }).key.color;
        const high = noon.key.color;
        expect(low.r / low.b).toBeGreaterThan(high.r / high.b);
    });

    it('interpolates the sky gradient through dawn', () => {
        expect(noon.skyTop).toBe(SKY_PALETTE.skyDay.top);
        expect(noon.skyBottom).toBe(SKY_PALETTE.skyDay.bottom);
        expect(night.skyTop).toBe(SKY_PALETTE.skyNight.top);
        // dusk sits between the palettes: not pure day, not pure night
        expect(dusk.skyBottom).not.toBe(SKY_PALETTE.skyDay.bottom);
        expect(dusk.skyBottom).not.toBe(SKY_PALETTE.skyNight.bottom);
    });

    it('is continuous across the horizon (no jumps between neighbouring elevations)', () => {
        let prev = skyModel({ sunElevationDeg: -20 });
        for (let e = -19.5; e <= 40; e += 0.5) {
            const cur = skyModel({ sunElevationDeg: e });
            expect(Math.abs(cur.key.intensity - prev.key.intensity)).toBeLessThan(0.15);
            expect(Math.abs(cur.daylight - prev.daylight)).toBeLessThan(0.1);
            expect(Math.abs(cur.exposure - prev.exposure)).toBeLessThan(0.02);
            prev = cur;
        }
    });

    it('studio model is neutral daylight with no sky', () => {
        const s = studioModel();
        expect(s.neutral).toBe(true);
        expect(s.night).toBe(0);
        expect(s.skyTop).toBeNull();
        expect(s.moon.intensity).toBe(0);
    });
});

describe('sky-model: from app state', () => {
    it('reads the time of day and solar geometry from state', () => {
        const noon = skyModelForState(createTestState({ sunTime: 50, simulationLatitude: 35, simulationDayOfYear: 172 }));
        expect(noon.hourOfDay).toBe(12);
        expect(noon.clock).toBe('12:00 PM');
        expect(noon.elevationDeg).toBeGreaterThan(60);
        expect(noon.daylight).toBeCloseTo(1, 3);

        const small = skyModelForState(createTestState({ sunTime: 8, simulationLatitude: 35, simulationDayOfYear: 172 }));
        expect(small.clock).toMatch(/AM$/);
        expect(small.elevationDeg).toBeLessThan(0);
        expect(small.night).toBeGreaterThan(0.9);
        expect(small.starOpacity).toBeGreaterThan(0.9);
    });
});
