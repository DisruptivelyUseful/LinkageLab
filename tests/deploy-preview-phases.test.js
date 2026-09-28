import { describe, expect, it } from 'vitest';
import { deployPhaseLabel, describePackMeta } from '../js/linkage/deploy-preview.js';
import { buildDeployTimeline } from '../js/linkage/deploy-timeline.js';

const meta = {
    minFoldDeg: 5,
    maxFoldDeg: 135,
    timeline: { unpack: [0, 0.24], fold: [0.24, 0.52], support: [0.52, 0.72], panels: [0.72, 1] },
};

describe('deploy preview: phase labels', () => {
    it('names each phase of the baked timeline', () => {
        expect(deployPhaseLabel(0, meta)).toBe('Packed');
        expect(deployPhaseLabel(0.1, meta)).toBe('Unpacking');
        expect(deployPhaseLabel(0.24, meta)).toBe('Unfolding 5°');
        expect(deployPhaseLabel(0.38, meta)).toBe('Unfolding 70°');
        expect(deployPhaseLabel(0.52, meta)).toBe('Unfolding 135°');
        expect(deployPhaseLabel(0.6, meta)).toBe('Roof beams');
        expect(deployPhaseLabel(0.9, meta)).toBe('Panels');
        expect(deployPhaseLabel(1, meta)).toBe('Deployed');
    });

    it('falls back to a percentage without fold angles, and to angles without a timeline', () => {
        expect(deployPhaseLabel(0.38, { timeline: meta.timeline })).toBe('Unfolding 50%');
        expect(deployPhaseLabel(0.5, { minFoldDeg: 10, maxFoldDeg: 110 })).toBe('60°');
        expect(deployPhaseLabel(0.25, null)).toBe('25%');
    });
});

describe('deploy preview: phase labels for a sequential array', () => {
    const tl = buildDeployTimeline({ K: 3, sequential: true, labels: ['Center', 'Copy 1', 'Copy 2'] });
    const seqMeta = { minFoldDeg: 5, maxFoldDeg: 135, timeline: tl };

    it('names the structure in its window and the phase inside it', () => {
        expect(deployPhaseLabel(0, seqMeta)).toBe('Packed');
        expect(deployPhaseLabel(1, seqMeta)).toBe('Deployed');
        const c1 = tl.copies[1];
        expect(deployPhaseLabel(c1.rise[0] + 0.01, seqMeta)).toBe('Copy 1 · Unpacking');
        const midFold = (c1.fold[0] + c1.fold[1]) / 2;
        expect(deployPhaseLabel(midFold, seqMeta)).toBe('Copy 1 · Unfolding 70°');
        expect(deployPhaseLabel((c1.support[0] + c1.support[1]) / 2, seqMeta)).toBe('Copy 1 · Roof beams');
        expect(deployPhaseLabel((c1.panels[0] + c1.panels[1]) / 2, seqMeta)).toBe('Copy 1 · Panels');
        expect(deployPhaseLabel(0.05, seqMeta)).toMatch(/^Center · /);
        expect(deployPhaseLabel(0.9, seqMeta)).toMatch(/^Copy 2 · /);
    });

    it('keeps the plain labels when the copies move together', () => {
        const together = buildDeployTimeline({ K: 3, sequential: false });
        const m = { minFoldDeg: 5, maxFoldDeg: 135, timeline: together };
        expect(deployPhaseLabel(0.38, m)).toBe('Unfolding 70°');
        expect(deployPhaseLabel(0.6, m)).toBe('Roof beams');
    });

    it('describes the pack', () => {
        const text = describePackMeta({ pack: { inIbc: true, bundles: 7, grid: { cols: 3, rows: 3 }, packBox: { x: 40, y: 104, z: 48 }, volumeFt3: 115.6, packedWeightLb: 1240 } });
        expect(text).toMatch(/^7 bundles · inside the IBC column \(3 × 3\) · pack 40 in × 48 in × 104 in high · 115.6 ft³ · 1240 lb$/);
        const flat = describePackMeta({ pack: { inIbc: false, bundles: 2, grid: { cols: 1, rows: 2 }, packBox: { x: 12, y: 16, z: 150 }, volumeFt3: 16.7, packedWeightLb: 0 } });
        expect(flat).toBe('2 bundles · flat beside the IBC in 2 layers · pack 12 in × 150 in × 16 in high · 16.7 ft³');
    });
});
