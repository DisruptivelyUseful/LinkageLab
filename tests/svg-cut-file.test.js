import { describe, expect, it } from 'vitest';
import { buildSheetCutSvg, buildFabricPatternSvg, buildWallOverviewSvg, svgForInline } from '../js/core/svg-cut-file.js';
import { nestPolygonOnSheets } from '../js/linkage/sheet-nesting.js';
import { buildFabricPattern } from '../js/linkage/fabric-patterns.js';

const trap = () => [{ s: 0, t: 0 }, { s: 101.8, t: 0 }, { s: 94.1, t: 48 }, { s: 7.7, t: 48 }];
const shape = () => ({ kind: 'wall', label: 'Span 3 · Lower', corners2D: trap(), widthBottomIn: 101.8, widthTopIn: 86.4, slantHeightIn: 48, tiltFromVerticalDeg: 24.5, cornerAnglesDeg: [80.9, 80.9, 99.1, 99.1] });

function parse(svg) {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const err = doc.querySelector('parsererror');
    if (err) throw new Error('bad svg: ' + err.textContent);
    return doc.documentElement;
}

describe('svg-cut-file', () => {
    it('sheet cut file is valid SVG sized in inches with one piece path per sheet', () => {
        const nest = nestPolygonOnSheets(trap(), { widthIn: 48, lengthIn: 96, orientation: 'landscape', align: 'center' });
        const svg = buildSheetCutSvg(nest, { title: 'Span 3 · Lower sheet cuts', lines: ['Cuts assume fold angle 134.9°'] });
        const root = parse(svg);
        expect(root.tagName.toLowerCase()).toBe('svg');
        expect(root.getAttribute('width')).toMatch(/in$/);
        expect(root.getAttribute('viewBox').split(' ').every(v => Number.isFinite(+v))).toBe(true);
        expect(root.querySelectorAll('path.piece')).toHaveLength(nest.sheetCount);
        expect(root.querySelectorAll('rect.stock')).toHaveLength(nest.sheetCount);
        expect(root.querySelectorAll('line.cut').length).toBeGreaterThan(0);
        expect(svg).toContain('134.9°');
        expect(svg).toContain('@ ');
    });

    it('fabric pattern SVG draws grommets and seams', () => {
        const pat = buildFabricPattern(trap(), { rollWidthIn: 60, hemIn: 1, seamIn: 0.5, stretchPct: 2, grommetSpacingIn: 12 });
        const root = parse(buildFabricPatternSvg(pat, { title: 'x' }));
        expect(root.querySelectorAll('path.fabric-cut')).toHaveLength(pat.panelCount);
        expect(root.querySelectorAll('circle.grommet')).toHaveLength(pat.grommetCount);
        expect(root.querySelectorAll('line.seam').length).toBe(2);
    });

    it('overview SVG shows the polygon, sheet grid and dimensions; inline strips physical size', () => {
        const nest = nestPolygonOnSheets(trap(), { widthIn: 48, lengthIn: 96 });
        const svg = buildWallOverviewSvg(shape(), nest);
        const root = parse(svg);
        expect(root.querySelectorAll('path.outline')).toHaveLength(1);
        expect(root.querySelectorAll('rect.grid').length).toBe(nest.rows * nest.cols);
        expect(svg).toContain('101 13/16&quot;'); // bottom width as a fraction
        const inline = svgForInline(svg);
        expect(inline.startsWith('<svg')).toBe(true);
        expect(inline).not.toMatch(/width="\d+(\.\d+)?in"/);
        expect(inline).toContain('style="width:100%');
    });

    it('escapes text', () => {
        const nest = nestPolygonOnSheets(trap(), { widthIn: 48, lengthIn: 96 });
        const svg = buildSheetCutSvg(nest, { title: 'A & B <C>' });
        expect(svg).toContain('A &amp; B &lt;C&gt;');
        parse(svg);
    });
});
