import { describe, expect, it } from 'vitest';
import {
    PANEL_PRESETS,
    BATTERY_PRESETS,
    AWG_RATINGS,
} from '../js/core/constants.js';
import {
    findPresetByName,
    getPresetLibrary,
    normalizePanelSpecs,
} from '../js/circuit/component-library.js';
import { calculateWireGauge } from '../js/circuit/wire-gauge.js';
import { generateWirePath } from '../js/circuit/wire-renderer.js';
import { createPanel } from '../js/circuit/node-factory.js';

const GOLDEN = {
    panelName: 'Rich Solar 200W Mono',
    panelWmp: 200,
    batteryName: '12V 100Ah LiFePO4',
    wirePathPrefix: 'M 150 100',
};

describe('circuit-core golden fixtures', () => {
    it('panel presets include golden panel with expected watts', () => {
        const preset = PANEL_PRESETS.find((p) => p.name === GOLDEN.panelName);
        expect(preset).toBeDefined();
        expect(preset.wmp).toBe(GOLDEN.panelWmp);
    });

    it('findPresetByName resolves battery preset', () => {
        const preset = findPresetByName('battery', GOLDEN.batteryName);
        expect(preset).toBeDefined();
        expect(preset.voltage).toBe(12.8);
        expect(preset.ah).toBe(100);
    });

    it('normalizePanelSpecs computes imp when missing', () => {
        const specs = normalizePanelSpecs({ wmp: 200, vmp: 20.5, voc: 24.6 });
        expect(specs.imp).toBeGreaterThan(0);
    });

    it('getPresetLibrary exposes all major sections', () => {
        const lib = getPresetLibrary();
        expect(lib.panels.length).toBeGreaterThan(5);
        expect(lib.batteries.length).toBeGreaterThan(5);
        expect(lib.controllers.length).toBeGreaterThan(3);
    });

    it('calculateWireGauge recommends adequate gauge for panel connection', () => {
        const items = [
            {
                id: 'panel-1',
                type: 'panel',
                x: 0,
                y: 0,
                specs: { wmp: 200, vmp: 20.5, imp: 9.76 },
                handles: {
                    positive: { id: 'p-pos', connectedTo: [{ connectionId: 'conn-1' }] },
                    negative: { id: 'p-neg', connectedTo: [] },
                },
            },
            {
                id: 'controller-1',
                type: 'controller',
                x: 200,
                y: 0,
                specs: { maxIsc: 20, maxACOutputW: 1000 },
                handles: {
                    pvPositive: { id: 'c-pos', connectedTo: [{ connectionId: 'conn-1' }] },
                },
            },
        ];
        const conn = { id: 'conn-1', sourceItemId: 'panel-1', targetItemId: 'controller-1' };
        const result = calculateWireGauge(conn, items, AWG_RATINGS);
        expect(result).not.toBeNull();
        expect(result.gauge).toBeDefined();
    });

    it('generateWirePath produces stable bezier path', () => {
        const items = [
            {
                id: 'a',
                type: 'panel',
                x: 100,
                y: 100,
                handles: {
                    out: { id: 'a-out', x: 50, y: 0, side: 'top', connectedTo: [] },
                },
            },
            {
                id: 'b',
                type: 'controller',
                x: 300,
                y: 200,
                handles: {
                    in: { id: 'b-in', x: 0, y: 40, side: 'left', connectedTo: [] },
                },
            },
        ];
        const conn = {
            id: 'w-1',
            sourceItemId: 'a',
            targetItemId: 'b',
            sourceHandleId: 'a-out',
            targetHandleId: 'b-in',
        };
        const path = generateWirePath(conn, items);
        expect(path.startsWith(GOLDEN.wirePathPrefix)).toBe(true);
    });

    it('createPanel returns valid node shape', () => {
        let id = 0;
        const panel = createPanel(10, 20, PANEL_PRESETS[0], () => ++id);
        expect(panel.type).toBe('panel');
        expect(panel.handles.positive).toBeDefined();
        expect(panel.width).toBeGreaterThan(0);
    });
});
