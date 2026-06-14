import { describe, expect, it } from 'vitest';
import { getZone, ghiKwhPerM2Day, zoneGhiRangeLabel } from '../js/solar/energy-zones/energy.js';
import { ZONES } from '../js/solar/energy-zones/constants.js';

describe('energy zones', () => {
    it('assigns GHI to correct zone bands', () => {
        expect(getZone(1.5).id).toBe(1);
        expect(getZone(2.5).id).toBe(2);
        expect(getZone(3.5).id).toBe(3);
        expect(getZone(4.5).id).toBe(4);
        expect(getZone(5.5).id).toBe(5);
        expect(getZone(6.2).id).toBe(6);
    });

    it('uses synthetic GHI when grid is null', () => {
        const ghi = ghiKwhPerM2Day(40, -74, null);
        expect(ghi).toBeGreaterThan(2);
        expect(ghi).toBeLessThan(6);
    });

    it('formats zone range labels', () => {
        expect(zoneGhiRangeLabel(ZONES[5])).toBe('6+');
        expect(zoneGhiRangeLabel(ZONES[2])).toBe('3–4');
    });
});
