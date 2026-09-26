import { describe, expect, it, beforeEach } from 'vitest';
import { createTestState } from './helpers/state-fixture.js';
import '../js/linkage/beam-bolt-helpers.js';
import { solveLinkage } from '../js/linkage/solver.js';
import { getOptimalClosedAngleForAnimation } from '../js/linkage/joint-kinematics.js';
import { computeCoverings, createDefaultCoverings } from '../js/linkage/coverings-geometry.js';
import { computeCoveringCutPlan, resetCoveringPlanCache, coveringBomItems, coveringEnclosureCost, coveringEntrySvg, coveringEntryFilename } from '../js/linkage/coverings-plan.js';

function ring() {
    const st = createTestState({ modules: 8, hLengthFt: 8, vLengthFt: 7.97, pivotPct: 41.4, offsetTopIn: 1.25, offsetBotIn: 1, vertEndOffset: 1, hStackCount: 2, vStackCount: 3, vStackGap: 0.45, hBeamW: 2.5, hBeamT: 1.5, vBeamW: 0.75, vBeamT: 2.5 });
    globalThis.state = st;
    st.animation.cachedClosedAngle = undefined;
    st.foldAngle = getOptimalClosedAngleForAnimation();
    return { st, data: solveLinkage(st.foldAngle) };
}

describe('coverings-plan', () => {
    beforeEach(() => resetCoveringPlanCache());

    it('nests every wall/table and patterns every fabric band, with totals and memoization', () => {
        const { st, data } = ring();
        const cov = createDefaultCoverings(8);
        cov.enabled = true;
        cov.spans.forEach((s, i) => { s.lower = 'plywood'; s.upper = i < 4 ? 'fabric' : 'none'; s.table = i === 0; });
        const covData = computeCoverings(data, cov, st);
        const plan = computeCoveringCutPlan(covData, cov);
        expect(plan.walls).toHaveLength(8);
        expect(plan.tables).toHaveLength(1);
        expect(plan.fabric).toHaveLength(4);
        expect(plan.totals.sheets).toBeGreaterThanOrEqual(16); // each ~95" wide lower wall needs 2 sheets
        expect(plan.totals.fabricYards).toBeGreaterThan(0);
        expect(plan.totals.grommets).toBeGreaterThan(0);
        expect(plan.totals.utilization).toBeGreaterThan(0.3);
        // memo: same inputs → same object; changed stock → new plan
        expect(computeCoveringCutPlan(covData, cov)).toBe(plan);
        cov.sheet = { ...cov.sheet, lengthIn: 120 };
        const plan2 = computeCoveringCutPlan(covData, cov);
        expect(plan2).not.toBe(plan);
        expect(plan2.totals.sheets).toBeLessThanOrEqual(plan.totals.sheets);
    });

    it('produces ENCLOSURE BOM rows from state prices', () => {
        const { st, data } = ring();
        const cov = createDefaultCoverings(8);
        cov.enabled = true;
        cov.spans[1].lower = 'plywood';
        cov.spans[2].upper = 'fabric';
        st.costPlywoodSheet = 50; st.costFabricYard = 10; st.costGrommet = 0.5;
        const plan = computeCoveringCutPlan(computeCoverings(data, cov, st), cov);
        const items = coveringBomItems(plan, st);
        expect(items.map(i => i.key)).toEqual(['plywoodSheet', 'fabricYard', 'grommet']);
        expect(items[0].qty).toBe(plan.totals.sheets);
        expect(items[0].total).toBeCloseTo(plan.totals.sheets * 50, 6);
        expect(coveringEnclosureCost(plan, st)).toBeCloseTo(items.reduce((a, i) => a + i.total, 0), 6);
    });

    it('renders an SVG per entry with a stable filename', () => {
        const { st, data } = ring();
        const cov = createDefaultCoverings(8);
        cov.enabled = true;
        cov.spans[3].lower = 'plywood';
        cov.spans[3].upper = 'fabric';
        const plan = computeCoveringCutPlan(computeCoverings(data, cov, st), cov);
        const wallSvg = coveringEntrySvg(plan.walls[0], st);
        expect(wallSvg).toContain('<svg');
        expect(wallSvg).toContain('Span 4');
        expect(coveringEntryFilename(plan.walls[0])).toBe('linkagelab-span4-lower-wall.svg');
        expect(coveringEntryFilename(plan.fabric[0])).toBe('linkagelab-span4-upper-fabric.svg');
        expect(coveringEntrySvg(plan.fabric[0], st)).toContain('fabric pattern');
    });

    it('returns an empty plan when coverings are unsupported', () => {
        const plan = computeCoveringCutPlan({ supported: false }, createDefaultCoverings(4));
        expect(plan.totals.sheets).toBe(0);
        expect(coveringBomItems(plan, {})).toEqual([]);
    });
});
