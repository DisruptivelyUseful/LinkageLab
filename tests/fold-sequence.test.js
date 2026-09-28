import { describe, expect, it, beforeEach } from 'vitest';
import { createTestState } from './helpers/state-fixture.js';
import { deployOrder, masterProgress, copyProgress, computeFoldSchedule, sequentialCopyCount, getFoldSweepRange } from '../js/linkage/fold-sequence.js';

const plan = (slots) => ({ slots });
const ring = (n, center = true, hidden = []) => {
    const slots = [];
    let idx = 0;
    if (center) slots.push({ slot: idx++, isCenter: true, ringIndex: null });
    for (let k = 0; k < n; k++) slots.push({ slot: idx++, isCenter: false, ringIndex: k });
    slots.forEach(sl => { sl.hidden = hidden.includes(sl.slot); });
    return plan(slots);
};

describe('fold-sequence: deploy order', () => {
    it('runs the centre first, then the ring copies in slot order', () => {
        const order = deployOrder(ring(3), 1);
        expect(order.map(o => o.label)).toEqual(['Center', 'Copy 1', 'Copy 2', 'Copy 3']);
        expect(order.map(o => o.arrayIndex)).toEqual([0, 1, 2, 3]);
        expect(order[0].isCenter).toBe(true);
    });

    it('starts with the ring copies when there is no centre and skips hidden slots', () => {
        expect(deployOrder(ring(3, false), 1).map(o => o.label)).toEqual(['Copy 1', 'Copy 2', 'Copy 3']);
        const order = deployOrder(ring(3, true, [2]), 1);
        expect(order.map(o => o.label)).toEqual(['Center', 'Copy 1', 'Copy 3']);
        expect(order.map(o => o.slot)).toEqual([0, 1, 3]);
    });

    it('nests the tunnel segments inside each slot with unique arrayIndex values', () => {
        const order = deployOrder(ring(2), 3);
        expect(order).toHaveLength(9);
        expect(order.map(o => o.arrayIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
        expect(order[4].label).toBe('Copy 1 · Segment 2');
        expect(deployOrder(null, 3).map(o => o.label)).toEqual(['Segment 1', 'Segment 2', 'Segment 3']);
        expect(deployOrder(null, 1)).toHaveLength(1);
    });
});

describe('fold-sequence: schedule', () => {
    const min = 0.2, max = 2.2;

    it('maps the master angle onto per-copy angles one copy at a time', () => {
        expect(masterProgress(min, min, max)).toBe(0);
        expect(masterProgress(max, min, max)).toBe(1);
        expect(copyProgress(0.5, 1, 3)).toBeCloseTo(0.5, 9);
        expect(copyProgress(0.5, 0, 3)).toBe(1);
        expect(copyProgress(0.5, 2, 3)).toBe(0);
        const order = deployOrder(ring(2), 1);   // K = 3
        const s = computeFoldSchedule({ masterAngle: min + 0.5 * (max - min), min, max, order, sequential: true });
        expect(s.sequential).toBe(true);
        expect(s.K).toBe(3);
        expect(s.copies.map(c => c.progress)).toEqual([1, 0.5, 0]);
        expect(s.copies[0].angle).toBeCloseTo(max, 9);
        expect(s.copies[1].angle).toBeCloseTo(min + 0.5 * (max - min), 9);
        expect(s.copies[2].angle).toBeCloseTo(min, 9);
        expect(s.distinctAngles).toHaveLength(3);
        expect(s.activeIndex).toBe(1);
        expect(s.angleOf(2, 0)).toBeCloseTo(min, 9);
        expect(s.angleOf(99, 0)).toBeCloseTo(s.copies[1].angle, 9);   // unknown copy → master angle
    });

    it('folds the last copy first as the master progress falls', () => {
        const order = deployOrder(ring(2), 1);
        const late = computeFoldSchedule({ masterAngle: min + 0.9 * (max - min), min, max, order, sequential: true });
        expect(late.copies.map(c => c.progress)).toEqual([1, 1, expect.closeTo(0.7, 9)]);
        expect(late.activeIndex).toBe(2);
        const ends = computeFoldSchedule({ masterAngle: max, min, max, order, sequential: true });
        expect(ends.distinctAngles).toHaveLength(1);
        expect(ends.activeIndex).toBe(2);
        const packed = computeFoldSchedule({ masterAngle: min, min, max, order, sequential: true });
        expect(packed.distinctAngles).toHaveLength(1);
        expect(packed.activeIndex).toBe(0);
    });

    it('is a plain sweep when sequential is off or there is one copy', () => {
        const order = deployOrder(ring(2), 1);
        const off = computeFoldSchedule({ masterAngle: 1.0, min, max, order, sequential: false });
        expect(off.sequential).toBe(false);
        expect(off.copies.every(c => c.angle === 1.0)).toBe(true);
        expect(off.distinctAngles).toEqual([1.0]);
        const single = computeFoldSchedule({ masterAngle: 1.0, min, max, order: deployOrder(null, 1), sequential: true });
        expect(single.sequential).toBe(false);
        expect(single.K).toBe(1);
    });
});

describe('fold-sequence: state helpers', () => {
    beforeEach(() => { globalThis.state = createTestState({ modules: 8, pivotPct: 40 }); });

    it('counts the structures that fold one after another', () => {
        const s = globalThis.state;
        expect(sequentialCopyCount(s)).toBe(1);
        s.animation.sequentialFold = true;
        expect(sequentialCopyCount(s)).toBe(1);
        s.radialArrayEnabled = true; s.radialCount = 6; s.radialCenter = true;
        expect(sequentialCopyCount(s)).toBe(7);
        s.radialHiddenSlots = [1, 2];
        expect(sequentialCopyCount(s)).toBe(5);
        s._deployedFrame = { radialPlan: ring(6, true, [1, 2, 3]) };
        expect(sequentialCopyCount(s)).toBe(4);
        s.orientation = 'vertical'; s.arrayCount = 3;
        expect(sequentialCopyCount(s)).toBe(12);
    });

    it('sweeps from the effective minimum to the closed angle (or the stop angle)', () => {
        const r = getFoldSweepRange(globalThis.state);
        expect(r.max).toBeGreaterThan(r.min);
        globalThis.state.animation.stopAngle = 60;
        const r2 = getFoldSweepRange(globalThis.state);
        expect(r2.max).toBeCloseTo(Math.PI / 3, 6);
    });
});
