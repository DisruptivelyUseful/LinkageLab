import { describe, expect, it } from 'vitest';
import { buildDeployTimeline, FOLD_TIMELINE } from '../js/linkage/deploy-timeline.js';

describe('deploy-timeline', () => {
    it('is the classic single-structure timeline for one copy or a simultaneous array', () => {
        const one = buildDeployTimeline({ K: 1 });
        expect(one.sequential).toBe(false);
        expect(one.durationSec).toBe(12);
        expect(one.copies).toHaveLength(1);
        expect(one.copies[0].fold).toEqual(FOLD_TIMELINE.fold);
        expect(one.unpack).toEqual([FOLD_TIMELINE.rise[0], FOLD_TIMELINE.lay[1]]);
        expect(one.ibcGap).toEqual(FOLD_TIMELINE.ibcGap);
        const together = buildDeployTimeline({ K: 4, sequential: false });
        expect(together.sequential).toBe(false);
        expect(together.copies.every(c => c.window[0] === 0 && c.window[1] === 1)).toBe(true);
        expect(together.copies[3].panels).toEqual(FOLD_TIMELINE.panels);
    });

    it('gives every copy its own window in sequence with the same phases inside', () => {
        const tl = buildDeployTimeline({ K: 3, sequential: true, perCopySec: 9, labels: ['Center', 'Copy 1', 'Copy 2'] });
        expect(tl.sequential).toBe(true);
        expect(tl.durationSec).toBe(27);
        expect(tl.copies.map(c => c.window)).toEqual([[0, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 1]]);
        const c1 = tl.copies[1];
        expect(c1.label).toBe('Copy 1');
        expect(c1.rise[0]).toBeCloseTo(1 / 3, 9);
        expect(c1.panels[1]).toBeCloseTo(2 / 3, 9);
        expect(c1.fold[0]).toBeGreaterThan(c1.lay[1] - 1e-9);
        expect(c1.support[0]).toBeGreaterThanOrEqual(c1.fold[1]);
        // The top tote settles after the last bundle has cleared the column
        expect(tl.ibcGap[0]).toBeCloseTo(tl.copies[2].rise[1], 9);
        expect(tl.ibcGap[1]).toBeGreaterThan(tl.ibcGap[0]);
        expect(tl.ibcGap[1]).toBeLessThanOrEqual(1);
        // Envelopes for single-structure consumers
        expect(tl.fold).toEqual([tl.copies[0].fold[0], tl.copies[2].fold[1]]);
        expect(tl.panels[1]).toBe(1);
    });
});
