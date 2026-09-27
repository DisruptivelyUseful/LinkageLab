import { describe, expect, it } from 'vitest';
import { deployPhaseLabel } from '../js/linkage/deploy-preview.js';

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
