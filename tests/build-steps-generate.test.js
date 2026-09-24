import { describe, expect, it, beforeAll } from 'vitest';
import { createTestState } from './helpers/state-fixture.js';
import { solveLinkage } from '../js/linkage/solver.js';
import { collectParts, matchSelector, partKey, jointKey } from '../js/linkage/part-keys.js';
import { generateDefaultBuildSteps, groupBeamsForBench, planBench, stockLengthFor } from '../js/linkage/build-steps.js';

let getBeamBoltIntersections;

beforeAll(async () => {
    globalThis.resetSupportBeamsToDefaults = () => {};
    globalThis.applyLegacyPanelsSupport = () => {};
    globalThis.applySupportBeamsConfig = () => {};
    globalThis.getOptimalClosedAngleForAnimation = () => 0;
    globalThis.invalidateGeometryCache = () => {};
    globalThis.threeRenderer = null;
    await import('../js/linkage/beam-bolt-helpers.js');
    await import('../js/linkage/hardware-detail.js');
    ({ getBeamBoltIntersections } = await import('../js/linkage/renderer-3d.js'));
});

function solve(overrides = {}) {
    // The fixture's fixed 3 in bolts only reach the middle layer of a 3-beam stack;
    // use realistic lengths so every layer gets holes.
    globalThis.state = createTestState({ showBolts: true, showBrackets: true, modules: 6, foldAngle: (100 * Math.PI) / 180, vBoltLength: 12, vBoltInnerLength: 12, vBoltOuterLength: 8, hBoltLength: 8, hPivotBoltLength: 8, ...overrides });
    if (globalThis.state.showHardwareFullDetail) globalThis.ensureHardwareAssemblies();
    return solveLinkage(globalThis.state.foldAngle);
}

function generate(data, extra = {}) {
    return generateDefaultBuildSteps(data, {
        modules: globalThis.state.modules,
        useFixedBeams: globalThis.state.useFixedBeams,
        archCapUprights: globalThis.state.archCapUprights,
        foldedAngleDeg: 40,
        deployedAngleDeg: 135,
        intersectionsFor: getBeamBoltIntersections,
        ...extra,
    });
}

function matches(rec, step) {
    return (step.targets || []).some(sel => matchSelector(rec.obj, sel, rec.kind));
}

describe('bench planning', () => {
    it('stock lengths snap up to standard lumber', () => {
        expect(stockLengthFor(94.2)).toBe(96);
        expect(stockLengthFor(96)).toBe(96);
        expect(stockLengthFor(100)).toBe(120);
        expect(stockLengthFor(200)).toBe(204);
        expect(stockLengthFor(50, 72)).toBe(72);
    });

    it('groups identical beams and lays them out in rows', () => {
        const data = solve();
        const groups = groupBeamsForBench(data.beams);
        expect(groups.reduce((n, g) => n + g.count, 0)).toBe(data.beams.length);
        const plan = planBench(groups, { stock: true });
        expect(plan.items.length).toBe(groups.length);
        expect(plan.items[0].stockLength).toBeGreaterThanOrEqual(plan.items[0].beamLength);
        expect(plan.bounds.radius).toBeGreaterThan(10);
        const zs = plan.items.map(i => i.z);
        expect(new Set(zs).size).toBe(zs.length);
    });
});

describe('generateDefaultBuildSteps', () => {
    it('cuts and drills every beam before placing it, and fastens after placing', () => {
        const data = solve();
        const steps = generate(data);
        const parts = collectParts(data);
        expect(steps.length).toBeGreaterThan(10);

        const firstIndex = (rec, kind) => steps.findIndex(s => s.kind === kind && matches(rec, s));
        for (const rec of parts.filter(p => p.kind === 'beam')) {
            const cut = firstIndex(rec, 'cut');
            const drill = firstIndex(rec, 'drill');
            const place = firstIndex(rec, 'place');
            expect(cut, `${rec.key} never cut`).toBeGreaterThanOrEqual(0);
            expect(place, `${rec.key} never placed`).toBeGreaterThanOrEqual(0);
            expect(cut).toBeLessThan(place);
            if (getBeamBoltIntersections(rec.obj, data.bolts).length) {
                expect(drill, `${rec.key} never drilled`).toBeGreaterThanOrEqual(0);
                expect(drill).toBeLessThan(place);
            } else {
                expect(drill, `${rec.key} has no holes but a drill step`).toBe(-1);
            }
        }
        // Each cut/drill step's targets resolve to exactly its group
        const cutCounts = steps.filter(s => s.kind === 'cut').map(s => parts.filter(p => p.kind === 'beam' && matches(p, s)).length);
        expect(cutCounts.reduce((a, b) => a + b, 0)).toBe(data.beams.length);

        // Fasteners are fastened after the brackets of their ring are placed, and V-stack
        // bolts only after the V module exists (bottom) or the top ring was lifted on (top)
        const liftIdx = steps.findIndex(s => s.title.startsWith('Lift the top assembly'));
        expect(liftIdx).toBeGreaterThan(0);
        for (const rec of parts.filter(p => p.kind === 'bolt')) {
            const fasten = firstIndex(rec, 'fasten');
            expect(fasten, `${rec.key} never fastened`).toBeGreaterThanOrEqual(0);
            const mod = rec.obj.moduleIndex;
            const ring = rec.obj.ring;
            const bracketPlace = steps.findIndex(s => s.kind === 'place' && s.targets.some(t => t.kind === 'bracket' && t.moduleIndex === mod && t.ring === ring));
            if (ring === 'bottom' || ring === 'top') expect(fasten, `${rec.key} before its bracket`).toBeGreaterThan(bracketPlace);
            if (rec.obj.boltType === 'vstack') {
                const vPlace = steps.findIndex(s => s.kind === 'place' && s.targets.some(t => t.kind === 'beam' && t.stackType === 'vertical' && t.moduleIndex === mod));
                expect(fasten, `${rec.key} before its V module`).toBeGreaterThan(vPlace);
                if (ring === 'top') expect(fasten, `${rec.key} before the lift`).toBeGreaterThan(liftIdx);
            }
        }

        // Shop order: bottom ring -> top ring (parked) -> V modules -> attach -> lift -> secure
        const titleIdx = (re) => steps.map((s, i) => (re.test(s.title) ? i : -1)).filter(i => i >= 0);
        const bottom = titleIdx(/set bottom H-beams|fit the bottom brackets|bolt the bottom ring/);
        const top = titleIdx(/set top H-beams|fit the top brackets|bolt the top ring/);
        const vmod = titleIdx(/assemble the V module|V module centre pivot/);
        const attach = titleIdx(/attach the V module/), secure = titleIdx(/secure the top bracket/);
        expect(Math.max(...bottom)).toBeLessThan(Math.min(...top));
        expect(Math.max(...top)).toBeLessThan(Math.min(...vmod.filter(i => !attach.includes(i))));
        expect(Math.max(...vmod.filter(i => !attach.includes(i)))).toBeLessThan(Math.min(...attach));
        expect(Math.max(...attach)).toBeLessThan(liftIdx);
        expect(liftIdx).toBeLessThan(Math.min(...secure));

        // Repeated module operations are grouped, one member per module
        const modules = globalThis.state.modules;
        const groups = new Map();
        steps.forEach((s, i) => { if (s.groupId) { if (!groups.has(s.groupId)) groups.set(s.groupId, []); groups.get(s.groupId).push(i); } });
        expect(groups.size).toBeGreaterThanOrEqual(9);
        for (const [gid, members] of groups) {
            expect(members.length, `${gid} members`).toBe(modules);
            for (let k = 1; k < members.length; k++) expect(members[k], `${gid} contiguous`).toBe(members[k - 1] + 1);
        }
        // Top ring steps are built parked beside the structure; the lift starts from parked
        steps.filter(s => s.kind === 'place' && /set top H-beams|fit the top brackets/.test(s.title)).forEach(s => expect(s.op.parkOffset).toEqual({ mode: 'beside', gapIn: 24 }));
        expect(steps[liftIdx].op.from).toBe('parked');

        // Assembly steps carry the folded pose, deploy step the deployed pose
        expect(steps.find(s => s.title.startsWith('Module 1')).view.foldAngleDeg).toBe(40);
        const deploy = steps.find(s => s.title === 'Deploy the structure');
        expect(deploy.view.foldAngleDeg).toBe(135);
        expect(steps.every(s => s.id && s.title)).toBe(true);
    });

    it('is deterministic for the same design', () => {
        const a = generate(solve()).map(s => `${s.kind}|${s.title}|${JSON.stringify(s.targets)}`);
        const b = generate(solve()).map(s => `${s.kind}|${s.title}|${JSON.stringify(s.targets)}`);
        expect(a).toEqual(b);
    });

    it('drill notes list hole positions from the beam end', () => {
        const data = solve();
        const steps = generate(data);
        const drill = steps.find(s => s.kind === 'drill');
        expect(drill.notes).toMatch(/Holes from the left end: [\d.]+ in/);
        expect(drill.op.bitDiameterIn).toBeGreaterThan(0);
    });

    it('handles fixed beams, cap uprights and full-detail hardware', () => {
        const arch = generate(solve({ orientation: 'vertical', useFixedBeams: true, archCapUprights: true, modules: 4 }));
        expect(arch.some(s => s.targets.some(t => t.stackType === 'fixed-beam'))).toBe(true);
        expect(arch.some(s => s.targets.some(t => t.stackType === 'fixed-beam-cap'))).toBe(true);

        const data = solve({ showHardwareFullDetail: true, modules: 4 });
        const detailed = generate(data);
        const parts = collectParts(data);
        const placements = parts.filter(p => p.kind === 'placement');
        expect(placements.length).toBeGreaterThan(0);
        for (const rec of placements) {
            const placed = detailed.findIndex(s => s.kind === 'place' && matches(rec, s));
            const fastened = detailed.findIndex(s => s.kind === 'fasten' && matches(rec, s));
            expect(placed, `${rec.key} never placed`).toBeGreaterThanOrEqual(0);
            expect(fastened, `${rec.key} never fastened (${jointKey(rec.obj)})`).toBeGreaterThan(placed);
        }
        // Hardware fasten steps name the assembly axes they turn (bracket bolt vs V-stack bolts)
        const hwFastens = detailed.filter(s => s.kind === 'fasten' && s.targets.some(t => t.kind === 'placement'));
        expect(hwFastens.length).toBeGreaterThan(0);
        hwFastens.forEach(s => expect(Array.isArray(s.op.axes) && s.op.axes.length > 0).toBe(true));
    });

    it('drops empty sections gracefully', () => {
        const steps = generateDefaultBuildSteps({ beams: [], bolts: [], brackets: [], washers: [], hardwareAssemblyPlacements: [], panels: [] }, { modules: 2 });
        expect(steps).toEqual([]);
        expect(partKey({})).toBeNull();
    });
});
