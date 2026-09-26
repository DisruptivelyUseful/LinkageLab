import { describe, expect, it } from 'vitest';
import { buildFabricPattern, offsetConvexPolygon } from '../js/linkage/fabric-patterns.js';
import { polygonArea, bbox } from '../js/linkage/sheet-nesting.js';

const trap = () => [{ s: 0, t: 0 }, { s: 101, t: 0 }, { s: 93, t: 48 }, { s: 8, t: 48 }];
const cfg = (o = {}) => ({ rollWidthIn: 60, hemIn: 1, seamIn: 0.5, stretchPct: 2, grommetSpacingIn: 12, ...o });

describe('fabric-patterns', () => {
    it('offsetConvexPolygon grows a square by the allowance on every side', () => {
        const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
        const out = offsetConvexPolygon(sq, 1);
        const b = bbox(out);
        expect(b.w).toBeCloseTo(12, 6);
        expect(b.h).toBeCloseTo(12, 6);
        expect(b.minX).toBeCloseTo(-1, 6);
    });

    it('shrinks by the tension allowance and splits at the roll width', () => {
        const pat = buildFabricPattern(trap(), cfg());
        expect(pat.shrinkFactor).toBeCloseTo(0.98, 4);
        expect(pat.finishedBBox.w).toBeCloseTo(101 * 0.98, 2);
        expect(pat.panelCount).toBe(2);
        expect(pat.seamCount).toBe(1);
        pat.panels.forEach(p => {
            expect(p.fitsRoll).toBe(true);
            expect(p.bboxW).toBeLessThanOrEqual(60 + 1e-6);
        });
        expect(pat.fabricYards).toBeCloseTo(pat.fabricLinearIn / 36, 2);
    });

    it('one panel when it fits the roll, hem grows the cut outline', () => {
        const small = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }, { x: 0, y: 30 }];
        const pat = buildFabricPattern(small, cfg({ stretchPct: 0 }));
        expect(pat.panelCount).toBe(1);
        const p = pat.panels[0];
        expect(p.bboxW).toBeCloseTo(52, 3);
        expect(p.bboxH).toBeCloseTo(32, 3);
        expect(p.seamEdges).toHaveLength(0);
        expect(p.hemEdges).toHaveLength(4);
        // grommets: 50" edges → 5 each, 30" edges → 3 each, corners shared → 5+5+3+3-4 = 12
        expect(p.grommets).toHaveLength(12);
        expect(pat.grommetCount).toBe(12);
    });

    it('a 96" edge at 12" spacing gets 9 grommets', () => {
        const strip = [{ x: 0, y: 0 }, { x: 96, y: 0 }, { x: 96, y: 10 }, { x: 0, y: 10 }];
        const pat = buildFabricPattern(strip, cfg({ stretchPct: 0, rollWidthIn: 120 }));
        const p = pat.panels[0];
        const onBottom = p.grommets.filter(g => Math.abs(g.y - 1) < 1e-6); // hem re-base shifts by 1"
        expect(onBottom).toHaveLength(9);
    });

    it('seam allowance only on interior seam edges', () => {
        const pat = buildFabricPattern(trap(), cfg({ stretchPct: 0 }));
        const [a, b] = pat.panels;
        expect(a.seamEdges).toHaveLength(1);
        expect(b.seamEdges).toHaveLength(1);
        // cut outline is wider than the finished outline by hem on the outside and seam on the inside
        expect(a.bboxW).toBeGreaterThanOrEqual(bbox(a.finished2D).w + 1 + 0.5 - 1e-6); // slanted hem edges extend a little further
        expect(polygonArea(a.cut2D)).toBeGreaterThan(polygonArea(a.finished2D));
    });
});
