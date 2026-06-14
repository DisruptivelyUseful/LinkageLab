import { describe, expect, it, beforeEach, vi } from 'vitest';
import { buildSimulatorFrameSrc, publishCircuitExport, resolveCircuitExport } from '../js/solar/circuit-export.js';

describe('circuit-export', () => {
    beforeEach(() => {
        localStorage.clear();
        delete globalThis.AppRouter;
    });

    it('publishCircuitExport stores on bus and localStorage', () => {
        const bus = { circuitData: null, circuitDocument: null };
        globalThis.AppRouter = { getAppStateBus: () => bus };

        const payload = { version: 2, schematic: { components: [{ id: 1 }], connections: [] } };
        publishCircuitExport(payload);

        expect(bus.circuitDocument?.items).toEqual([{ id: 1 }]);
        expect(bus.circuitData?.schematic?.components).toEqual([{ id: 1 }]);
        expect(resolveCircuitExport()?.schematic?.components).toEqual([{ id: 1 }]);
        expect(localStorage.getItem('linkageLab_circuitDocument')).toBeTruthy();
    });

    it('buildSimulatorFrameSrc includes embedded import params', () => {
        vi.stubGlobal('location', { origin: 'http://localhost:8765', href: 'http://localhost:8765/index.html' });
        const src = buildSimulatorFrameSrc();
        expect(src).toContain('index.html');
        expect(src).toContain('#/solar/simulate');
        expect(src).toContain('import=solarDesigner');
        expect(src).toContain('embedded=1');
    });
});
