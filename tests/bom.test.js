import { describe, expect, it, beforeEach } from 'vitest';
import { createTestState } from './helpers/state-fixture.js';
import { countStructureCopies, countBasePanels, computeBillOfMaterials } from '../js/linkage/bom.js';

const helpers = {
    computeSupportBomContribution: () => ({ structureItems: [], supportBeamCost: 0, supportBeamWeight: 0, radialQty: 0, reciprocalQty: 0, sbBolts: 0, sbThrough: 0, sbWashers: 0 }),
    getActivePanelConfig: () => ({ ratedWatts: 250, weight: 45 }),
    getAssemblyHardwareItems: () => [],
};

function panelsFor(copies, perCopy) {
    const out = [];
    for (let c = 0; c < copies; c++) for (let i = 0; i < perCopy; i++) out.push({ arrayIndex: c, weight: 45 });
    return out;
}

function baseState(overrides = {}) {
    return createTestState({
        modules: 8, hStackCount: 2, vStackCount: 3, costHBeam: 12, costVBeam: 10, costBracket: 5,
        costBoltVInner: 0.75, costBoltVOuter: 0.5, costBoltH: 0.75, costBoltHPivot: 0.75,
        weightBracket: 0.5, weightBolt: 0.1, woodDensity: 0.02, costSolarPanel: 150,
        solarPanels: { ...createTestState().solarPanels, enabled: true },
        ...overrides,
    });
}

describe('bom: structure copies', () => {
    beforeEach(() => { globalThis.state = baseState(); });

    it('is one structure without arrays', () => {
        expect(countStructureCopies({}, globalThis.state)).toEqual({ radial: 1, linear: 1, total: 1, label: '1 structure' });
    });

    it('counts visible radial copies and arch tunnel segments', () => {
        const radial = { visibleCount: 6, slots: [] };
        expect(countStructureCopies({ radialArray: radial }, globalThis.state).total).toBe(6);
        const arch = baseState({ orientation: 'vertical', arrayCount: 3 });
        expect(countStructureCopies({}, arch)).toMatchObject({ linear: 3, total: 3 });
        expect(countStructureCopies({ radialArray: { visibleCount: 4 } }, arch)).toMatchObject({ radial: 4, linear: 3, total: 12, label: '12 structures' });
    });

    it('counts only the base copy of the panels', () => {
        expect(countBasePanels(panelsFor(6, 4))).toBe(4);
        expect(countBasePanels([])).toBe(0);
        expect(countBasePanels(undefined)).toBe(0);
    });
});

describe('bom: per structure vs all copies', () => {
    beforeEach(() => { globalThis.state = baseState(); });

    it('reports the single structure unchanged and identical totals', () => {
        const data = { panels: panelsFor(1, 4) };
        const bom = computeBillOfMaterials(data, globalThis.state, helpers);
        expect(bom.copies.total).toBe(1);
        expect(bom.perStructure.counts).toMatchObject({ hBeams: 32, vBeams: 24, uBrackets: 32, nBolts: 88, panels: 4 });
        expect(bom.perStructure.cost.hBeam).toBe(32 * 12);
        expect(bom.perStructure.cost.solar).toBe(4 * 150);
        expect(bom.total).toBe(bom.perStructure);
        expect(bom.perStructure.cost.total).toBeCloseTo(bom.perStructure.cost.structure + bom.perStructure.cost.solar + bom.perStructure.cost.enclosure, 9);
    });

    it('scales quantities, costs and weights by the copy count but keeps unit prices', () => {
        const data = { panels: panelsFor(6, 4), radialArray: { visibleCount: 6 } };
        const bom = computeBillOfMaterials(data, globalThis.state, helpers);
        expect(bom.copies.total).toBe(6);
        expect(bom.perStructure.counts.panels).toBe(4);
        expect(bom.panelsAll).toBe(24);
        expect(bom.total.counts.hBeams).toBe(6 * bom.perStructure.counts.hBeams);
        expect(bom.total.cost.total).toBeCloseTo(6 * bom.perStructure.cost.total, 6);
        expect(bom.total.weight.total).toBeCloseTo(6 * bom.perStructure.weight.total, 6);
        const h = bom.total.items.find(it => it.id === 'hBeams');
        expect(h.qty).toBe(6 * 32);
        expect(h.unit).toBe(12);
        expect(h.total).toBe(6 * 32 * 12);
    });

    it('includes the floor beams in the structure weight and the hardware extras in the cost', () => {
        const st = baseState();
        st.floor.enabled = true;
        globalThis.state = st;
        const withHw = { ...helpers, getAssemblyHardwareItems: () => [{ qty: 8, item: 'Bushings', unit: 1.5, total: 12 }] };
        const bom = computeBillOfMaterials({ panels: [] }, st, withHw);
        expect(bom.perStructure.weight.floor).toBeGreaterThan(0);
        expect(bom.perStructure.weight.structure).toBeCloseTo(
            bom.perStructure.weight.hBeam + bom.perStructure.weight.vBeam + bom.perStructure.weight.bracket + bom.perStructure.weight.bolt + bom.perStructure.weight.support + bom.perStructure.weight.floor, 9);
        expect(bom.perStructure.cost.assemblyHardware).toBe(12);
        expect(bom.perStructure.items.some(it => it.label === 'Bushings')).toBe(true);
    });

    it('uses the inner price for every V-stack bolt when bolts are not split', () => {
        const bom = computeBillOfMaterials({ panels: [] }, globalThis.state, helpers);
        if (!bom.splitBolts) {
            expect(bom.prices.costBoltVOuter).toBe(bom.prices.costBoltVInner);
            expect(bom.perStructure.items.find(it => it.id === 'vBolts').qty).toBe(bom.perStructure.counts.totalVBolts);
        }
    });
});
