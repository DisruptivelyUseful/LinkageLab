import { describe, expect, it } from 'vitest';
import { createArraySpecsCalculator } from '../js/circuit/array-specs.js';
import {
    pickControllerPresetForStringVoc,
    resetControllerFault,
    shouldTriggerVocOverload,
} from '../js/circuit/controller-faults.js';

function makePanel(id, voc, overrides = {}) {
    return {
        id,
        type: 'panel',
        specs: { voc, vmp: voc * 0.82, wmp: 200, isc: 10, imp: 9, ...overrides.specs },
        handles: {
            positive: { id: `${id}-pos`, polarity: 'positive', connectedTo: [] },
            negative: { id: `${id}-neg`, polarity: 'negative', connectedTo: [] },
        },
        ...overrides,
    };
}

function wire(source, sourceHandle, target, targetHandle, connections, id) {
    const conn = {
        id,
        sourceItemId: source.id,
        sourceHandleId: source.handles[sourceHandle].id,
        targetItemId: target.id,
        targetHandleId: target.handles[targetHandle].id,
    };
    connections.push(conn);
    source.handles[sourceHandle].connectedTo.push({
        itemId: target.id, handleId: target.handles[targetHandle].id, connectionId: id,
    });
    target.handles[targetHandle].connectedTo.push({
        itemId: source.id, handleId: source.handles[sourceHandle].id, connectionId: id,
    });
}

function makeController(id, maxVoc) {
    return {
        id,
        type: 'controller',
        specs: { maxVoc, maxIsc: 30, maxWmp: 5000, supportedVoltages: [48] },
        handles: {
            pvPositive: { id: 'pv+', polarity: 'positive', connectedTo: [] },
            pvNegative: { id: 'pv-', polarity: 'negative', connectedTo: [] },
        },
    };
}

describe('array-specs', () => {
    it('sums Voc in series and takes max Voc across parallel strings', () => {
        const p1 = makePanel('p1', 24);
        const p2 = makePanel('p2', 24);
        const p3 = makePanel('p3', 24);
        const p4 = makePanel('p4', 24);
        const controller = makeController('c1', 150);
        const connections = [];

        wire(p1, 'negative', p2, 'positive', connections, 's1');
        wire(p3, 'negative', p4, 'positive', connections, 's2');
        wire(p1, 'positive', controller, 'pvPositive', connections, 'pa');
        wire(p2, 'negative', controller, 'pvNegative', connections, 'na');
        wire(p3, 'positive', controller, 'pvPositive', connections, 'pb');
        wire(p4, 'negative', controller, 'pvNegative', connections, 'nb');

        const items = [p1, p2, p3, p4, controller];
        const { calculateConnectedArraySpecs } = createArraySpecsCalculator({
            getItems: () => items,
            getConnections: () => connections,
        });

        const specs = calculateConnectedArraySpecs(controller);
        expect(specs.config).toBe('2P2S');
        expect(specs.voc).toBe(48);
        expect(specs.seriesCount).toBe(2);
        expect(specs.parallelCount).toBe(2);
        expect(specs.imp).toBeCloseTo(18, 0);
    });

    it('reports high series Voc for a single long string', () => {
        const panels = [1, 2, 3, 4, 5, 6].map((n) => makePanel(`p${n}`, 37.5));
        const controller = makeController('c1', 250);
        const connections = [];

        for (let i = 0; i < panels.length - 1; i += 1) {
            wire(panels[i], 'negative', panels[i + 1], 'positive', connections, `s${i}`);
        }
        wire(panels[0], 'positive', controller, 'pvPositive', connections, 'to-pos');
        wire(panels[panels.length - 1], 'negative', controller, 'pvNegative', connections, 'to-neg');

        const { calculateConnectedArraySpecs } = createArraySpecsCalculator({
            getItems: () => [...panels, controller],
            getConnections: () => connections,
        });

        const specs = calculateConnectedArraySpecs(controller);
        expect(specs.config).toBe('1P6S');
        expect(specs.voc).toBeCloseTo(225, 0);
    });
});

describe('controller-faults', () => {
    it('suppresses repeated Voc destruction after reset', () => {
        const controller = { destroyed: false, specs: { maxVoc: 100 } };
        const arraySpecs = { voc: 150 };

        expect(shouldTriggerVocOverload(controller, arraySpecs)).toBe(true);
        controller.destroyed = true;

        resetControllerFault(controller);
        expect(controller.destroyed).toBe(false);
        expect(controller.vocFaultSuppressed).toBe(true);
        expect(shouldTriggerVocOverload(controller, arraySpecs)).toBe(false);
    });

    it('picks smallest adequate controller preset', () => {
        const presets = [
            { name: 'Small', maxVoc: 100 },
            { name: 'Medium', maxVoc: 150 },
            { name: 'Large', maxVoc: 500 },
        ];
        const pick = pickControllerPresetForStringVoc(presets, 140);
        expect(pick.name).toBe('Medium');
    });
});
