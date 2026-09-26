import { describe, expect, it } from 'vitest';
import { nestPolygonOnSheets, clipPolygonToRect, polygonArea, cutAngleDeg, describeMark } from '../js/linkage/sheet-nesting.js';

const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
// Sample lower band from the 8-module design: 101.8" bottom, 86.4" top, 48" tall (slant)
const trap = () => [{ s: 0, t: 0 }, { s: 101.8, t: 0 }, { s: 94.1, t: 48 }, { s: 7.7, t: 48 }];
const stock = (o = {}) => ({ widthIn: 48, lengthIn: 96, thicknessIn: 0.5, orientation: 'auto', align: 'center', kerfIn: 0.125, ...o });

describe('sheet-nesting: primitives', () => {
    it('clips a polygon to a rectangle', () => {
        const out = clipPolygonToRect(rect(10, 10), 5, -1, 20, 4);
        expect(polygonArea(out)).toBeCloseTo(5 * 4, 6);
    });
    it('folds cut angles into [0,180)', () => {
        expect(cutAngleDeg({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(0);
        expect(cutAngleDeg({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(45);
        expect(cutAngleDeg({ x: 1, y: 1 }, { x: 0, y: 0 })).toBe(45);
        expect(cutAngleDeg({ x: 0, y: 0 }, { x: -1, y: 1 })).toBe(135);
    });
});

describe('sheet-nesting: nestPolygonOnSheets', () => {
    it('a full 96x48 rectangle is exactly one uncut landscape sheet', () => {
        const nest = nestPolygonOnSheets(rect(96, 48), stock());
        expect(nest.sheetCount).toBe(1);
        expect(nest.orientation).toBe('landscape');
        expect(nest.pieces[0].isFullSheet).toBe(true);
        expect(nest.pieces[0].hasCut).toBe(false);
        expect(nest.pieces[0].edges.every(e => e.isStock)).toBe(true);
        expect(nest.utilization).toBeCloseTo(1, 6);
        expect(nest.warnings).toHaveLength(0);
    });

    it('100x48 centred gives two 50" pieces with one seam and a batten note', () => {
        const nest = nestPolygonOnSheets(rect(100, 48), stock({ orientation: 'landscape', align: 'center' }));
        expect(nest.sheetCount).toBe(2);
        nest.pieces.forEach(p => expect(p.bboxW).toBeCloseTo(50, 3));
        expect(nest.seamCount).toBe(1);
        expect(nest.seamLinearIn).toBeCloseTo(48, 3);
        expect(nest.warnings.some(w => w.code === 'batten')).toBe(true);
        // the vertical cut on each piece is a real cut, the seam side is stock
        const p = nest.pieces[0];
        expect(p.edges.filter(e => !e.isStock)).toHaveLength(1);
        expect(p.edges.filter(e => e.isSeam)).toHaveLength(1);
    });

    it('the sample trapezoid needs 2 landscape sheets with ~81° tapers and edge marks', () => {
        const nest = nestPolygonOnSheets(trap(), stock({ orientation: 'landscape' }));
        expect(nest.sheetCount).toBe(2);
        expect(nest.rows).toBe(1);
        expect(nest.cols).toBe(2);
        nest.pieces.forEach(p => {
            const cuts = p.edges.filter(e => !e.isStock);
            expect(cuts).toHaveLength(1);
            const ang = cuts[0].angleDeg;
            expect(Math.min(ang, 180 - ang)).toBeCloseTo(80.9, 0);
            expect(p.marks.length).toBe(2);
            expect(p.marks.map(m => m.side).sort()).toEqual(['bottom', 'top']);
        });
        // The taper offsets: 7.7" at the top → top mark is 7.7" further in than the bottom mark
        const left = nest.pieces.find(p => p.col === 0);
        const bottom = left.marks.find(m => m.side === 'bottom');
        const top = left.marks.find(m => m.side === 'top');
        expect(top.x - bottom.x).toBeCloseTo(7.7, 1);
        expect(bottom.fromCorner).toBe('BL');
        expect(top.fromCorner).toBe('TR'); // nearer corner wins: 43.2 from TR vs 52.8 from TL
        expect(nest.utilization).toBeCloseTo(polygonArea(trap().map(p => ({ x: p.s, y: p.t }))) / (2 * 96 * 48), 4);
        expect(describeMark(bottom)).toMatch(/bottom edge, .* from the bottom-left corner/);
    });

    it('auto orientation picks fewer sheets, then better utilization', () => {
        // 60 wide x 90 tall: portrait (48x96) needs 2 sheets; landscape (96x48) needs 2 as well but lower utilization? both 2 → same util → choose fewer cut pieces
        const tall = nestPolygonOnSheets(rect(40, 90), stock());
        expect(tall.orientation).toBe('portrait');
        expect(tall.sheetCount).toBe(1);
        const wide = nestPolygonOnSheets(rect(90, 40), stock());
        expect(wide.orientation).toBe('landscape');
        expect(wide.sheetCount).toBe(1);
    });

    it('prefers two half sheets over a full sheet plus a strip when counts tie', () => {
        // 95" wide x 52" slant: landscape = 96x48 + a 4" strip, portrait = two ~47.5 x 52 pieces
        const wall = [{ x: 0, y: 0 }, { x: 95, y: 0 }, { x: 87, y: 52 }, { x: 8, y: 52 }];
        const nest = nestPolygonOnSheets(wall, stock());
        expect(nest.sheetCount).toBe(2);
        expect(nest.orientation).toBe('portrait');
        nest.pieces.forEach(p => expect(Math.min(p.bboxW, p.bboxH)).toBeGreaterThan(40));
    });

    it('flags slivers and tapers that cross a seam', () => {
        // 98" wide rectangle centered → two 49" pieces (no sliver); left aligned → 96 + 2" sliver
        const nest = nestPolygonOnSheets(rect(98, 48), stock({ orientation: 'landscape', align: 'left' }));
        expect(nest.warnings.some(w => w.code === 'sliver')).toBe(true);
        // A tall trapezoid 2 rows: the taper crosses the horizontal seam
        const tallTrap = [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 70, y: 90 }, { x: 20, y: 90 }];
        const n2 = nestPolygonOnSheets(tallTrap, stock({ orientation: 'landscape', align: 'left' }));
        expect(n2.rows).toBe(2);
        expect(n2.warnings.some(w => w.code === 'seam-on-taper')).toBe(true);
    });

    it('accepts {s,t} points and re-bases pieces to the sheet corner', () => {
        const nest = nestPolygonOnSheets(trap(), stock({ orientation: 'landscape', align: 'left' }));
        const p0 = nest.pieces[0];
        expect(p0.cellX).toBe(0);
        expect(p0.polygon2D.every(v => v.x >= -1e-9 && v.x <= 96 + 1e-9 && v.y >= -1e-9 && v.y <= 48 + 1e-9)).toBe(true);
        expect(p0.polygon2D.some(v => v.x === 0 && v.y === 0)).toBe(true);
    });
});
