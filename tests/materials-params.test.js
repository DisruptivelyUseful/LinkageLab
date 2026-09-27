import { describe, expect, it } from 'vitest';
import { WOOD_GRAIN_REPEAT_IN, CELL_PITCH_IN, woodUvScale, panelCellGrid, woodColorFor } from '../js/linkage/materials.js';

describe('materials: wood', () => {
    it('scales the grain so it repeats every WOOD_GRAIN_REPEAT_IN inches', () => {
        expect(woodUvScale(WOOD_GRAIN_REPEAT_IN)).toBe(1);
        expect(woodUvScale(96)).toBeCloseTo(96 / WOOD_GRAIN_REPEAT_IN, 9);
        expect(woodUvScale(0)).toBeGreaterThan(0);
        expect(woodUvScale(undefined)).toBeGreaterThan(0);
    });

    it('keeps the renderer darkening formula and keys by base colour', () => {
        const c = woodColorFor({ colorBase: { r: 200, g: 150, b: 100 } });
        expect(c.key).toBe('wood-200-150-100');
        expect(c.r).toBeCloseTo((200 * 0.7 - 20) / 255, 9);
        expect(c.g).toBeCloseTo((150 * 0.65 - 15) / 255, 9);
        expect(c.b).toBeCloseTo((100 * 0.5 - 10) / 255, 9);
        expect(woodColorFor({ colorBase: { r: 0, g: 0, b: 0 } }).r).toBe(0);   // never negative
    });

    it('tints colliding and kinematic-state beams', () => {
        expect(woodColorFor({}, true).key).toBe('collide');
        expect(woodColorFor({ kinematicState: 'error' }).key).toBe('kin-error');
        expect(woodColorFor({ kinematicState: 'warning' }).key).toBe('kin-warning');
        expect(woodColorFor({ kinematicState: 'warning' }, true).key).toBe('collide');   // collision wins
    });
});

describe('materials: solar panel cell grid', () => {
    it('gives a 60-cell layout for a 39" x 65" module', () => {
        const g = panelCellGrid(39, 65);
        expect(g.cols).toBe(Math.round(39 / CELL_PITCH_IN));
        expect(g.rows).toBe(Math.round(65 / CELL_PITCH_IN));
        expect(g.cols * g.rows).toBe(60);
        expect(g.busbarsAlongU).toBe(false);   // busbars run along the long edge
        expect(g.key).toBe('6x10v');
    });

    it('runs the busbars along the longer edge and never drops below 4 cells', () => {
        expect(panelCellGrid(65, 39).busbarsAlongU).toBe(true);
        expect(panelCellGrid(10, 10)).toMatchObject({ cols: 4, rows: 4 });
        expect(panelCellGrid(0, -5)).toMatchObject({ cols: 4, rows: 4 });
    });
});
