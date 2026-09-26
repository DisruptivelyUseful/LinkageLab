import { describe, expect, it, beforeAll } from 'vitest';
import { createTestState } from './helpers/state-fixture.js';
import { solveLinkage } from '../js/linkage/solver.js';
import { collectParts, matchSelector, partKey, jointKey } from '../js/linkage/part-keys.js';
import { generateDefaultBuildSteps, groupBeamsForBench, planBench, stockLengthFor, needsCut, dedupeHoles, beamLengthIn } from '../js/linkage/build-steps.js';

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
        expect(needsCut(96, 96)).toBe(false);
        expect(needsCut(95.99, 96)).toBe(false);
        expect(needsCut(95, 96)).toBe(true);
    });

    it('merges holes that land on the same spot', () => {
        const holes = [
            { through: 'W', posL: -46.5, posT: 0, posW: 1, radius: 0.25 },
            { through: 'W', posL: -46.51, posT: 0.01, posW: 1, radius: 0.3125 },
            { through: 'T', posL: -46.5, posT: 0, posW: 0, radius: 0.25 },
            { through: 'W', posL: 10, posT: 0, posW: 1, radius: 0.25 },
        ];
        const out = dedupeHoles(holes);
        expect(out.length).toBe(3);
        expect(out[0].radius).toBe(0.3125);
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
        let needCut = 0;
        for (const rec of parts.filter(p => p.kind === 'beam')) {
            const cut = firstIndex(rec, 'cut');
            const drill = firstIndex(rec, 'drill');
            const place = firstIndex(rec, 'place');
            expect(place, `${rec.key} never placed`).toBeGreaterThanOrEqual(0);
            const len = beamLengthIn(rec.obj);
            if (needsCut(len, stockLengthFor(len))) {
                needCut += 1;
                expect(cut, `${rec.key} never cut`).toBeGreaterThanOrEqual(0);
                expect(cut).toBeLessThan(place);
            } else {
                expect(cut, `${rec.key} fits its stock but has a cut step`).toBe(-1);
            }
            if (getBeamBoltIntersections(rec.obj, data.bolts).length) {
                expect(drill, `${rec.key} never drilled`).toBeGreaterThanOrEqual(0);
                expect(drill).toBeLessThan(place);
            } else {
                expect(drill, `${rec.key} has no holes but a drill step`).toBe(-1);
            }
        }
        // The fixture has 96 in V-beams (no cut) and 120 in H-beams (cut from 120 in stock: no cut either)
        // plus whatever else; at least the counts must be consistent
        const cutCounts = steps.filter(s => s.kind === 'cut').map(s => parts.filter(p => p.kind === 'beam' && matches(p, s)).length);
        expect(cutCounts.reduce((a, b) => a + b, 0)).toBe(needCut);
        // Drill steps never list the same hole twice (shared pivots produce two bolts on one spot)
        for (const s of steps.filter(s => s.kind === 'drill')) {
            const rec = parts.find(p => p.kind === 'beam' && matches(p, s));
            const raw = getBeamBoltIntersections(rec.obj, data.bolts);
            const count = Number(/\((\d+) hole/.exec(s.title)[1]);
            expect(count).toBe(dedupeHoles(raw).length);
            expect(count).toBeLessThanOrEqual(raw.length);
        }

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

        // Hardware steps (brackets, bolts) are close-ups framed on their parts; beam steps stay wide
        const closeups = steps.filter(s => s.view && s.view.frame === 'targets');
        expect(closeups.length).toBeGreaterThanOrEqual(modules * 5);
        closeups.forEach(s => { expect(s.view.radial).toBe(true); expect(s.view.detail).toBe(true); expect(s.view.foldAngleDeg).toBe(40); expect(s.kind === 'fasten' || /brackets/.test(s.title)).toBe(true); });
        // Module fasten steps bolt joint by joint, with time for each joint
        steps.filter(s => s.kind === 'fasten' && s.groupId).forEach(s => { expect(s.op.sequential).toBe(true); expect(s.durationMs).toBeGreaterThanOrEqual(2600); });
        steps.filter(s => /H-beams|assemble the V module/.test(s.title)).forEach(s => expect(s.view.frame).toBeUndefined());
        expect(steps.find(s => /fit the bottom brackets/.test(s.title)).view.pitch).toBeCloseTo(0.75);
        expect(steps.find(s => /V module centre/.test(s.title)).view.pitch).toBeCloseTo(0.3);
        // Assembly steps carry the folded pose, deploy step the deployed pose
        expect(steps.find(s => s.title.startsWith('Module 1')).view.foldAngleDeg).toBe(40);
        const deploy = steps.find(s => s.title === 'Deploy the structure');
        expect(deploy.view.foldAngleDeg).toBe(135);
        expect(steps.every(s => s.id && s.title)).toBe(true);
    });

    it('emits a cut step only when the beam is shorter than its stock, and mounts panels one at a time', () => {
        const data = solve({ vLengthFt: 7.5, hLengthFt: 9.5 });
        const steps = generate(data);
        const lens = new Set(data.beams.map(b => Math.round(beamLengthIn(b) * 16) / 16));
        const shorter = [...lens].filter(l => needsCut(l, stockLengthFor(l)));
        expect(shorter.length).toBeGreaterThan(0);
        expect(steps.filter(s => s.kind === 'cut').length).toBeGreaterThan(0);
        // Forcing 96 in stock on 96 in beams drops those cuts
        const fixed = generate(solve(), { stockLengthIn: 96 });
        expect(fixed.some(s => s.kind === 'cut' && /96 in$/.test(s.title))).toBe(false);

        const panel = (i) => ({ type: 'panel', index: i, center: { x: i * 40, y: 100, z: 0 }, width: 39, length: 65, thickness: 1.5, axisX: { x: 1, y: 0, z: 0 }, axisY: { x: 0, y: 1, z: 0 }, axisZ: { x: 0, y: 0, z: 1 } });
        const withPanels = generateDefaultBuildSteps({ beams: [], bolts: [], brackets: [], washers: [], hardwareAssemblyPlacements: [], panels: [panel(0), panel(1), panel(2), panel(3)] }, { modules: 2, deployedAngleDeg: 135 });
        const mount = withPanels.find(s => s.kind === 'place' && s.targets.some(t => t.kind === 'panel'));
        expect(mount).toBeTruthy();
        expect(mount.op.sequential).toBe(true);
        expect(mount.durationMs).toBe(600 * 4 + 800);
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

describe('coverings in generated steps', () => {
    const wall = (spanIndex, band, coverType = 'plywood') => ({
        type: 'covering', kind: coverType === 'fabric' ? 'fabric' : (band === 'table' ? 'table' : 'wall'), band, spanIndex, moduleIndex: spanIndex, coverType,
        corners3D: [{ x: 0, y: 0, z: 0 }, { x: 90, y: 0, z: 0 }, { x: 80, y: 48, z: 5 }, { x: 10, y: 48, z: 5 }], center: { x: 45, y: 24, z: 2.5 },
    });
    const panel = (i) => ({ type: 'panel', index: i, center: { x: i * 40, y: 100, z: 0 }, width: 39, length: 65, thickness: 1.5, axisX: { x: 1, y: 0, z: 0 }, axisY: { x: 0, y: 1, z: 0 }, axisZ: { x: 0, y: 0, z: 1 } });

    it('places lower walls, fabric, tables and upper coverings after the roof, one span at a time', () => {
        const data = { beams: [], bolts: [], brackets: [], washers: [], hardwareAssemblyPlacements: [], panels: [panel(0)],
            coverings: { supported: true, shapes: [wall(0, 'lower'), wall(1, 'lower'), wall(2, 'lower', 'fabric'), wall(0, 'table'), wall(0, 'upper', 'fabric')] } };
        const steps = generateDefaultBuildSteps(data, { modules: 3, deployedAngleDeg: 135 });
        const titles = steps.map(s => s.title);
        const iPanels = titles.indexOf('Mount the solar panels');
        const iWalls = titles.indexOf('Install the lower wall panels');
        const iFabric = titles.indexOf('Hang the lower fabric bands');
        const iTables = titles.indexOf('Fit the tables');
        const iUpper = titles.indexOf('Install the upper coverings');
        expect(iPanels).toBeGreaterThanOrEqual(0);
        expect(iWalls).toBeGreaterThan(iPanels);
        expect(iFabric).toBeGreaterThan(iWalls);
        expect(iTables).toBeGreaterThan(iFabric);
        expect(iUpper).toBeGreaterThan(iTables);
        const wallsStep = steps[iWalls];
        expect(wallsStep.kind).toBe('place');
        expect(wallsStep.op.sequential).toBe(true);
        expect(wallsStep.op.approach).toBe('radial');
        expect(wallsStep.durationMs).toBe(700 * 2 + 800);
        expect(steps[iTables].op.approach).toBe('above');
        expect(steps[iTables].targets).toEqual([{ kind: 'wall', band: 'table' }]);
    });

    it('adds the deploy step when only coverings exist, and nothing when none do', () => {
        const withWalls = generateDefaultBuildSteps({ beams: [], bolts: [], brackets: [], washers: [], hardwareAssemblyPlacements: [], panels: [], coverings: { supported: true, shapes: [wall(0, 'lower')] } }, { modules: 2 });
        expect(withWalls.map(s => s.title)).toEqual(['Deploy the structure', 'Install the lower wall panels']);
        const none = generateDefaultBuildSteps({ beams: [], bolts: [], brackets: [], washers: [], hardwareAssemblyPlacements: [], panels: [], coverings: null }, { modules: 2 });
        expect(none).toEqual([]);
    });
});

describe('floor in generated steps', () => {
    it('lays floor beams then the deck after the roof and before the walls', () => {
        const beam = (i, side) => ({ type: 'beam', stackType: 'floor-beam-reciprocal', moduleIndex: i, stackId: 2100 + i * 2 + side, patternId: side ? 'B' : 'A', p1: { x: 0, y: 5, z: 0 }, p2: { x: 96, y: 5, z: 0 }, center: { x: 48, y: 5, z: 0 }, w: 2.5, t: 1.5, corners: [] });
        const deck = { type: 'covering', kind: 'wall', band: 'floor', spanIndex: 0, moduleIndex: 0, coverType: 'plywood', corners3D: [{ x: 0, y: 7, z: 0 }, { x: 90, y: 7, z: 0 }, { x: 90, y: 7, z: 90 }, { x: 0, y: 7, z: 90 }], center: { x: 45, y: 7, z: 45 } };
        const wall = { type: 'covering', kind: 'wall', band: 'lower', spanIndex: 1, moduleIndex: 1, coverType: 'plywood', corners3D: [{ x: 0, y: 0, z: 0 }, { x: 90, y: 0, z: 0 }, { x: 80, y: 48, z: 5 }, { x: 10, y: 48, z: 5 }], center: { x: 45, y: 24, z: 2.5 } };
        const data = { beams: [beam(0, 0), beam(0, 1)], bolts: [], brackets: [], washers: [], hardwareAssemblyPlacements: [], panels: [], coverings: { supported: true, shapes: [wall] }, floor: { deck, beams: [beam(0, 0), beam(0, 1)] } };
        const steps = generateDefaultBuildSteps(data, { modules: 1, deployedAngleDeg: 135, stockLengthIn: 96 });
        const titles = steps.map(s => s.title);
        const iBeams = titles.indexOf('Lay the floor beams'), iDeck = titles.indexOf('Lay the floor deck'), iWalls = titles.indexOf('Install the lower wall panels'), iDeploy = titles.indexOf('Deploy the structure');
        expect(iDeploy).toBeGreaterThanOrEqual(0);
        expect(iBeams).toBeGreaterThan(iDeploy);
        expect(iDeck).toBeGreaterThan(iBeams);
        expect(iWalls).toBeGreaterThan(iDeck);
        expect(steps[iDeck].targets).toEqual([{ kind: 'wall', band: 'floor' }]);
        const parts = collectParts(data);
        expect(parts.filter(p => p.kind === 'wall').map(p => p.key)).toEqual(['wall:s1:lower', 'wall:s0:floor']);
    });
});
