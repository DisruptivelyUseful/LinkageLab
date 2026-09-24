import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeAll } from 'vitest';
import { createTestState } from './helpers/state-fixture.js';
import { solveLinkage } from '../js/linkage/solver.js';
import {
    collectParts,
    describePart,
    jointKey,
    matchSelector,
    partKey,
    partsBounds,
    resolveTargets,
    selectorForPart,
    selectorLabel,
} from '../js/linkage/part-keys.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const presets = JSON.parse(fs.readFileSync(path.join(root, 'configs', 'presets.json'), 'utf8'));

let applyConfig;
let ensureHardwareAssemblies;

beforeAll(async () => {
    globalThis.resetSupportBeamsToDefaults = () => {};
    globalThis.applyLegacyPanelsSupport = () => {};
    globalThis.applySupportBeamsConfig = (cfg) => {
        Object.assign(globalThis.state.supportBeams, cfg);
    };
    globalThis.getOptimalClosedAngleForAnimation = () => 0;
    globalThis.invalidateGeometryCache = () => {};
    globalThis.threeRenderer = null;

    await import('../js/linkage/beam-bolt-helpers.js');
    const hw = await import('../js/linkage/hardware-detail.js');
    ensureHardwareAssemblies = hw.ensureHardwareAssemblies || globalThis.ensureHardwareAssemblies;
    ({ applyConfig } = await import('../js/linkage/config-persistence.js'));
});

function solveWith(overrides) {
    // 45° (the fixture default) folds the ring flat enough that no vertical
    // module is generated; use a deployed pose so every part type exists.
    globalThis.state = createTestState({ showBolts: true, showBrackets: true, foldAngle: (100 * Math.PI) / 180, ...overrides });
    if (globalThis.state.showHardwareFullDetail && ensureHardwareAssemblies) ensureHardwareAssemblies();
    return solveLinkage(globalThis.state.foldAngle);
}

function expectUniqueKeys(data, label) {
    const parts = collectParts(data);
    expect(parts.length, `${label}: no parts collected`).toBeGreaterThan(0);
    const seen = new Map();
    const dupes = [];
    for (const rec of parts) {
        if (seen.has(rec.key)) dupes.push(rec.key);
        seen.set(rec.key, rec);
    }
    expect(dupes, `${label}: duplicate keys`).toEqual([]);
    // Every solver object must be addressable
    const counts = ['beams', 'bolts', 'washers', 'brackets', 'hardwareAssemblyPlacements']
        .reduce((n, k) => n + ((data[k] && data[k].length) || 0), 0);
    expect(parts.length, `${label}: some parts produced no key`).toBe(counts);
    return parts;
}

describe('part-keys: uniqueness over solver output', () => {
    it.each([
        ['default fixture', {}],
        ['even stacks 4/4', { hStackCount: 4, vStackCount: 4 }],
        ['odd stacks 5/3 with reverse', { hStackCount: 5, vStackCount: 3, vStackReverse: true }],
        ['array of 2', { arrayCount: 2, modules: 4 }],
        ['arch with cap uprights', { orientation: 'vertical', archCapUprights: true, modules: 5 }],
        ['arch with fixed beams and caps', { orientation: 'vertical', useFixedBeams: true, archCapUprights: true, modules: 5 }],
        ['washers with thickness', { vWasherThickness: 0.0625, hWasherThickness: 0.0625 }],
    ])('%s', (label, overrides) => {
        expectUniqueKeys(solveWith(overrides), label);
    });

    it('full-detail hardware placements are unique and replace legacy bolts', () => {
        const legacy = solveWith({ modules: 6 });
        const detailed = solveWith({ modules: 6, showHardwareFullDetail: true });
        expect(detailed.hardwareAssemblyPlacements.length).toBeGreaterThan(0);
        expectUniqueKeys(detailed, 'full detail');
        // Outer V-beam bolts disappear from data.bolts when the assembly takes over
        const legacyOuter = legacy.bolts.filter(b => b.boltType === 'vstack' && b.role === 'outer');
        const detailedOuter = detailed.bolts.filter(b => b.boltType === 'vstack' && b.role === 'outer');
        expect(legacyOuter.length).toBeGreaterThan(0);
        expect(detailedOuter.length).toBe(0);
        // ...but every legacy outer bolt joint is present as a placement joint
        const placementJoints = new Set(detailed.hardwareAssemblyPlacements.map(p => jointKey(p)));
        for (const bolt of legacyOuter) {
            expect(placementJoints.has(jointKey(bolt)), `missing joint for ${partKey(bolt)}`).toBe(true);
        }
    });

    it.each(presets)('unique for preset $name', (preset) => {
        const config = JSON.parse(fs.readFileSync(path.join(root, 'configs', preset.file), 'utf8'));
        globalThis.state = createTestState({ showBolts: true });
        applyConfig(config, false);
        globalThis.state.showBolts = true;
        if (ensureHardwareAssemblies) ensureHardwareAssemblies();
        expectUniqueKeys(solveLinkage(globalThis.state.foldAngle), preset.name);
    });
});

describe('part-keys: stability and joints', () => {
    it('keys are identical across fold angles', () => {
        const a = solveWith({ foldAngle: (80 * Math.PI) / 180 });
        const b = solveWith({ foldAngle: (120 * Math.PI) / 180 });
        const ka = new Set(collectParts(a).map(r => r.key));
        const kb = new Set(collectParts(b).map(r => r.key));
        expect([...ka].sort()).toEqual([...kb].sort());
    });

    it('beams carry layerIndex and produce readable labels', () => {
        const data = solveWith({ hStackCount: 3, modules: 4 });
        const topBeams = data.beams.filter(b => b.stackType === 'horizontal-top' && b.moduleIndex === 1);
        expect(topBeams.map(b => b.layerIndex)).toEqual([0, 1, 2]);
        expect(describePart(topBeams[1])).toBe('Top H-beam, module 2, layer 2 (B)');
        expect(partKey(topBeams[1])).toBe('beam:horizontal-top:a0:m1:s3:B:L1');
    });

    it('a bolt, its washers and its bracket share one joint key', () => {
        const data = solveWith({ modules: 4, vWasherThickness: 0.0625 });
        const bolt = data.bolts.find(b => b.boltType === 'vstack' && b.role === 'inner' && b.ring === 'bottom' && b.moduleIndex === 2);
        expect(bolt).toBeTruthy();
        const jk = jointKey(bolt);
        expect(jk).toBe('joint:a0:m2:bottom:inner');
        const bracket = data.brackets.find(b => b.moduleIndex === 2 && b.ring === 'bottom' && b.pivotRole === 'inner');
        expect(jointKey(bracket)).toBe(jk);
        const hpivot = data.bolts.find(b => b.boltType === 'hpivot' && b.role === 'inner' && b.ring === 'bottom' && b.moduleIndex === 2);
        expect(jointKey(hpivot)).toBe(jk);
        const washers = data.washers.filter(w => jointKey(w) === jk && w.washerType === 'vstack');
        expect(washers.length).toBeGreaterThan(0);
    });
});

describe('part-keys: selectors', () => {
    it('exact selector resolves to exactly the same part', () => {
        const data = solveWith({ modules: 4, arrayCount: 2 });
        const parts = collectParts(data);
        for (const rec of parts) {
            const sel = selectorForPart(rec.obj, rec.kind);
            const res = resolveTargets(data, [sel], parts);
            expect(res.items.length, `selector for ${rec.key} matched ${res.items.length}`).toBe(1);
            expect(res.items[0].key).toBe(rec.key);
        }
    });

    it('wildcards, arrays and ranges match groups', () => {
        const data = solveWith({ modules: 6, hStackCount: 2, vWasherThickness: 0.0625, hWasherThickness: 0.0625 });
        const allTop = resolveTargets(data, [{ kind: 'beam', stackType: 'horizontal-top' }]);
        expect(allTop.beams.length).toBe(6 * 2);
        const mods = resolveTargets(data, [{ kind: 'beam', stackType: 'horizontal-top', moduleIndex: [0, 1] }]);
        expect(mods.beams.length).toBe(4);
        const range = resolveTargets(data, [{ kind: 'beam', stackType: 'vertical', moduleIndex: { min: 2, max: 3 } }]);
        expect(range.beams.every(b => b.moduleIndex >= 2 && b.moduleIndex <= 3)).toBe(true);
        expect(range.beams.length).toBe(2 * globalThis.state.vStackCount);
        const joint = resolveTargets(data, [{ kind: 'joint', moduleIndex: 3, ring: 'bottom', role: 'outer' }]);
        expect(joint.bolts.length).toBe(2); // vstack outer + hpivot outer
        expect(joint.brackets.length).toBe(1);
        expect(joint.washers.length).toBeGreaterThan(0);
        expect(matchSelector(data.beams[0], { kind: 'bolt' })).toBe(false);
        expect(matchSelector(data.beams[0], { kind: '*' })).toBe(true);
    });

    it('joint selector reaches placements when full detail replaces bolts', () => {
        const data = solveWith({ modules: 4, showHardwareFullDetail: true });
        const joint = resolveTargets(data, [{ kind: 'joint', moduleIndex: 1, ring: 'top', role: 'outer' }]);
        expect(joint.placements.length).toBe(1);
        expect(joint.placements[0].assemblyId).toBe('outerVBeam');
    });

    it('bounds and labels are sane', () => {
        const data = solveWith({ modules: 4 });
        const res = resolveTargets(data, [{ kind: 'beam', moduleIndex: 0 }]);
        const b = partsBounds(res.items);
        expect(b.radius).toBeGreaterThan(1);
        expect(b.max.y).toBeGreaterThan(b.min.y);
        expect(selectorLabel({ kind: 'beam', stackType: 'horizontal-top', moduleIndex: 2 })).toBe('Top H-beam · module 3');
        expect(selectorLabel({ kind: 'joint', moduleIndex: 0, ring: 'bottom', role: 'inner' })).toBe('Joint · bottom · inner · module 1');
        expect(selectorLabel({ kind: 'beam', stackType: 'vertical' })).toBe('V-beam · all modules');
    });
});
