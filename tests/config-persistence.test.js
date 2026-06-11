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
