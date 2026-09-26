import { describe, expect, it, beforeAll } from 'vitest';
import { createTestState } from './helpers/state-fixture.js';
import { degToRad } from '../js/linkage/math.js';

let getConfigSnapshot;
let applyV30Config;

beforeAll(async () => {
    globalThis.resetSupportBeamsToDefaults = () => {};
    globalThis.applyLegacyPanelsSupport = () => {};
    globalThis.applySupportBeamsConfig = (cfg) => {
        Object.assign(globalThis.state.supportBeams, cfg);
    };
    await import('../js/linkage/hardware-detail.js');
    const mod = await import('../js/linkage/config-persistence.js');
    getConfigSnapshot = mod.getConfigSnapshot;
    applyV30Config = mod.applyV30Config;
});

describe('config-persistence', () => {
    it('getConfigSnapshot captures structure parameters from state', () => {
        globalThis.state = createTestState({
            modules: 10,
            hLengthFt: 9,
            vLengthFt: 7,
            pivotPct: 42,
            foldAngle: degToRad(90),
        });

        const snapshot = getConfigSnapshot();

        expect(snapshot.structure.modules).toBe(10);
        expect(snapshot.structure.beamLengths.horizontal).toBe(9);
        expect(snapshot.structure.beamLengths.vertical).toBe(7);
        expect(snapshot.structure.pivotPercent).toBe(42);
        expect(snapshot.foldAngle).toBeCloseTo(90);
    });

    it('applyV30Config updates state from v30 structure block', () => {
        globalThis.state = createTestState({ modules: 8 });

        applyV30Config({
            structure: {
                modules: 14,
                beamLengths: { horizontal: 11, vertical: 6 },
                pivotPercent: 55,
                stackCounts: { horizontal: 2, vertical: 4 },
                offsets: { top: 2, bottom: 1.5, vertEnd: 1, hStackGap: 0.1, vStackGap: 0.2 },
            },
            mode: { type: 'cylinder', flipVertical: true, rotation: 15, useFixedBeams: true, arrayCount: 2 },
        });

        expect(globalThis.state.modules).toBe(14);
        expect(globalThis.state.hLengthFt).toBe(11);
        expect(globalThis.state.vLengthFt).toBe(6);
        expect(globalThis.state.pivotPct).toBe(55);
        expect(globalThis.state.hStackCount).toBe(2);
        expect(globalThis.state.vStackCount).toBe(4);
        expect(globalThis.state.offsetTopIn).toBe(2);
        expect(globalThis.state.hStackGap).toBe(0.1);
        expect(globalThis.state.orientation).toBe('horizontal');
        expect(globalThis.state.archFlipVertical).toBe(true);
        expect(globalThis.state.useFixedBeams).toBe(true);
        expect(globalThis.state.arrayCount).toBe(2);
    });

    it('round-trips structure fields through snapshot and apply', () => {
        globalThis.state = createTestState({
            modules: 9,
            hLengthFt: 8,
            vLengthFt: 8,
            pivotPct: 41,
            foldAngle: degToRad(120),
        });

        const snapshot = getConfigSnapshot();
        globalThis.state = createTestState({ modules: 1, hLengthFt: 1, vLengthFt: 1, pivotPct: 0 });
        applyV30Config(snapshot);

        expect(globalThis.state.modules).toBe(9);
        expect(globalThis.state.hLengthFt).toBe(8);
        expect(globalThis.state.vLengthFt).toBe(8);
        expect(globalThis.state.pivotPct).toBe(41);
        expect(globalThis.state.supportBeams.enabled).toBe(false);
    });
});

describe('config-persistence: coverings', () => {
    it('round-trips the coverings block and the enclosure costs', () => {
        globalThis.state = createTestState({ modules: 8 });
        globalThis.state.coverings.enabled = true;
        globalThis.state.coverings.lowerLean = 'vertical';
        globalThis.state.coverings.upperLean = 'custom';
        globalThis.state.coverings.upperTiltDeg = -12;
        globalThis.state.coverings.table.slideIn = 6;
        globalThis.state.coverings.splitHeightIn = 40;
        globalThis.state.coverings.spans[2].lower = 'plywood';
        globalThis.state.coverings.spans[2].table = true;
        globalThis.state.coverings.spans[5].upper = 'fabric';
        globalThis.state.coverings.pickMode = true;
        globalThis.state.costPlywoodSheet = 52;
        globalThis.state.costFabricYard = 11;
        globalThis.state.costGrommet = 0.4;

        const snapshot = getConfigSnapshot();
        expect(snapshot.coverings.enabled).toBe(true);
        expect(snapshot.coverings.spans).toHaveLength(8);
        expect(snapshot.coverings.pickMode).toBeUndefined();
        expect(snapshot.costs.plywoodSheet).toBe(52);
        expect(snapshot.visibility.coverings).toBe(true);

        globalThis.state = createTestState({ modules: 8 });
        applyV30Config(JSON.parse(JSON.stringify(snapshot)));
        const c = globalThis.state.coverings;
        expect(c.enabled).toBe(true);
        expect(c.lowerLean).toBe('vertical');
        expect(c.upperLean).toBe('custom');
        expect(c.upperTiltDeg).toBe(-12);
        expect(c.table.slideIn).toBe(6);
        expect(c.splitHeightIn).toBe(40);
        expect(c.spans[2]).toEqual({ lower: 'plywood', upper: 'none', table: true });
        expect(c.spans[5].upper).toBe('fabric');
        expect(c.pickMode).toBe(false);
        expect(globalThis.state.costPlywoodSheet).toBe(52);
        expect(globalThis.state.costFabricYard).toBe(11);
        expect(globalThis.state.costGrommet).toBe(0.4);
    });

    it('resets coverings to defaults when a config has no coverings block', () => {
        globalThis.state = createTestState({ modules: 8 });
        globalThis.state.coverings.enabled = true;
        globalThis.state.coverings.spans[0].lower = 'plywood';
        applyV30Config({ structure: { modules: 6 } });
        expect(globalThis.state.coverings.enabled).toBe(false);
        expect(globalThis.state.coverings.spans).toHaveLength(6);
        expect(globalThis.state.coverings.spans.every(s => s.lower === 'none')).toBe(true);
    });

    it('resizes the span list to the loaded module count', () => {
        globalThis.state = createTestState({ modules: 8 });
        const snap = getConfigSnapshot();
        snap.structure.modules = 10;
        snap.coverings.spans[7].lower = 'fabric';
        applyV30Config(snap);
        expect(globalThis.state.coverings.spans).toHaveLength(10);
        expect(globalThis.state.coverings.spans[7].lower).toBe('fabric');
    });
});

describe('config-persistence: floor', () => {
    it('round-trips the floor block and resets it when absent', () => {
        globalThis.state = createTestState({ modules: 8 });
        globalThis.state.floor.enabled = true;
        globalThis.state.floor.beams.parallelSwingAngle = 12;
        globalThis.state.floor.beams.radialEnabled = true;
        globalThis.state.floor.deck.insetIn = 3;
        const snap = getConfigSnapshot();
        expect(snap.floor.enabled).toBe(true);
        globalThis.state = createTestState({ modules: 8 });
        applyV30Config(JSON.parse(JSON.stringify(snap)));
        expect(globalThis.state.floor.enabled).toBe(true);
        expect(globalThis.state.floor.beams.parallelSwingAngle).toBe(12);
        expect(globalThis.state.floor.beams.radialEnabled).toBe(true);
        expect(globalThis.state.floor.deck.insetIn).toBe(3);
        applyV30Config({ structure: { modules: 6 } });
        expect(globalThis.state.floor.enabled).toBe(false);
    });
});
