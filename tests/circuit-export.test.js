import { describe, expect, it, beforeEach, vi } from 'vitest';
import { buildSimulatorFrameSrc, publishCircuitExport, resolveCircuitExport } from '../js/solar/circuit-export.js';

describe('circuit-export', () => {
    beforeEach(() => {
        localStorage.clear();
        delete globalThis.AppRouter;
    });

    it('publishCircuitExport stores on bus and localStorage', () => {
        const bus = { circuitData: null };
        globalThis.AppRouter = { getAppStateBus: () => bus };

        const payload = { version: 2, schematic: { components: [{ id: 1 }], connections: [] } };
        publishCircuitExport(payload);

        expect(bus.circuitData).toEqual(payload);
        expect(resolveCircuitExport()).toEqual(payload);
    });

    it('buildSimulatorFrameSrc includes embedded import params', () => {
        vi.stubGlobal('location', { origin: 'http://localhost:8765', href: 'http://localhost:8765/index.html' });
        const src = buildSimulatorFrameSrc();
        expect(src).toContain('solar_simulator.html');
        expect(src).toContain('import=solarDesigner');
        expect(src).toContain('embedded=1');
    });
});
