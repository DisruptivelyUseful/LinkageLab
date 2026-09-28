import { describe, expect, it } from 'vitest';
import { planPackLayout, describePack, IBC_MAX_COLUMN_IN } from '../js/linkage/pack-layout.js';

const ibc = { present: true, cx: 0, cz: 0, x: 40, z: 48, height: 88, minY: 0 };

describe('pack-layout', () => {
    it('stands bundles inside the IBC footprint when they fit', () => {
        const plan = planPackLayout({ K: 7, bundle: { L: 100, H: 6, W: 10 }, ibc, groundY: 0 });
        expect(plan.mode).toBe('ibc');
        expect(plan.grid.cols * plan.grid.rows).toBeGreaterThanOrEqual(7);
        expect(plan.slots).toHaveLength(7);
        plan.slots.forEach(sl => {
            expect(sl.standing).toBe(true);
            expect(sl.center.y).toBeCloseTo(2 + 50, 9);
            expect(Math.abs(sl.center.x)).toBeLessThanOrEqual(20);
            expect(Math.abs(sl.center.z)).toBeLessThanOrEqual(24);
        });
        // distinct positions
        const keys = new Set(plan.slots.map(sl => `${sl.center.x.toFixed(3)},${sl.center.z.toFixed(3)}`));
        expect(keys.size).toBe(7);
        expect(plan.ibcGap).toBeCloseTo(100 + 4 - 88, 9);
        expect(plan.packBox.y).toBeCloseTo(104, 9);
    });

    it('reproduces the single centred upright slot for one structure', () => {
        const plan = planPackLayout({ K: 1, bundle: { L: 90, H: 12, W: 30 }, ibc, groundY: -1.5 });
        expect(plan.mode).toBe('ibc');
        expect(plan.slots[0].center).toEqual({ x: 0, y: -1.5 + 2 + 45, z: 0 });
    });

    it('lays bundles flat beside the IBC when they are too tall or too many', () => {
        const tall = planPackLayout({ K: 2, bundle: { L: IBC_MAX_COLUMN_IN + 10, H: 6, W: 10 }, ibc, groundY: 0, side: { x: 0, y: 0, z: 1 }, away: { x: 1, y: 0, z: 0 }, ibcHalf: 24 });
        expect(tall.mode).toBe('flat');
        const many = planPackLayout({ K: 40, bundle: { L: 100, H: 8, W: 12 }, ibc, groundY: 0, side: { x: 0, y: 0, z: 1 }, away: { x: 1, y: 0, z: 0 }, ibcHalf: 24 });
        expect(many.mode).toBe('flat');
        expect(many.slots).toHaveLength(40);
        expect(many.grid.cols).toBe(6);
        expect(many.grid.rows).toBe(7);
        many.slots.forEach(sl => {
            expect(sl.standing).toBe(false);
            expect(sl.center.z).toBeLessThan(-24);          // on the −side of the IBC
        });
        expect(many.slots[0].center.y).toBeCloseTo(4, 9);   // first layer rests on the ground
        expect(many.slots[6].center.y).toBeCloseTo(8.25 + 4, 9);
        expect(many.packBox.y).toBeCloseTo(7 * 8 + 6 * 0.25, 9);
        expect(many.volumeIn3).toBeCloseTo(many.packBox.x * many.packBox.y * many.packBox.z, 6);
    });

    it('falls back to the nominal footprint without an IBC', () => {
        const plan = planPackLayout({ K: 3, bundle: { L: 80, H: 8, W: 10 }, ibc: null, groundY: 0 });
        expect(plan.mode).toBe('ibc');
        expect(plan.packBox.x).toBe(40);
        expect(plan.packBox.z).toBe(48);
        expect(plan.ibcGap).toBeCloseTo(84, 9);
    });

    it('describes the pack', () => {
        const plan = planPackLayout({ K: 7, bundle: { L: 100, H: 6, W: 10 }, ibc, groundY: 0 });
        const text = describePack(plan, 7, { weight: '1,200 lb' });
        expect(text).toMatch(/^7 bundles · inside the IBC column \(\d × \d\) · pack 40 in × 48 in × 104 in high · 1,200 lb$/);
    });
});
