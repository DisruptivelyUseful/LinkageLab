import { describe, expect, it, vi } from 'vitest';
import { createFaultDetection } from '../js/circuit/fault-detection.js';
import { resetControllerFault } from '../js/circuit/controller-faults.js';

describe('fault-detection', () => {
    it('detects controller voc overload fault', () => {
        const controller = {
            id: 'c1',
            type: 'controller',
            destroyed: false,
            specs: { maxVoc: 100, maxIsc: 30, supportedVoltages: [12, 24, 48] },
            handles: { pvPositive: { connectedTo: [] }, pvNegative: { connectedTo: [] } },
        };

        const { detectFaults } = createFaultDetection({
            getItems: () => [controller],
            getConnections: () => [],
            getLiveView: () => ({ state: { active: false, loadStates: {}, powerFlow: {}, breakerStates: {} } }),
            calculateConnectedArraySpecs: () => ({ voc: 150, imp: 10, wmp: 1000 }),
            calculateConnectedBatterySpecs: () => ({ voltage: 0, kWh: 0 }),
            calculateWireCurrent: () => 0,
            getWireGaugeForAmps: () => ({ amps: 20, gauge: 10 }),
        });

        const { faults } = detectFaults();
        expect(faults.some((f) => f.type === 'controller_voc_overload')).toBe(true);
    });

    it('processes voc overload through effects hook', () => {
        const controller = {
            id: 'c1',
            type: 'controller',
            destroyed: false,
            vocFaultSuppressed: false,
            specs: { maxVoc: 100, maxIsc: 30, supportedVoltages: [12, 24, 48] },
            handles: {
                pvPositive: { connectedTo: [{}] },
                pvNegative: { connectedTo: [{}] },
                batteryPositive: { connectedTo: [] },
                batteryNegative: { connectedTo: [] },
            },
        };

        const triggerOverloadEffect = vi.fn();
        const { processFaultsAndWarnings } = createFaultDetection({
            getItems: () => [controller],
            getConnections: () => [],
            getLiveView: () => ({ state: { active: false, loadStates: {}, powerFlow: {}, breakerStates: {} } }),
            calculateConnectedArraySpecs: () => ({ voc: 150, imp: 10, wmp: 1000 }),
            calculateConnectedBatterySpecs: () => ({ voltage: 0, kWh: 0 }),
            calculateWireCurrent: () => 0,
            getWireGaugeForAmps: () => ({ amps: 20, gauge: 10 }),
            effects: { triggerOverloadEffect },
        });

        processFaultsAndWarnings();
        expect(controller.destroyed).toBe(true);
        expect(triggerOverloadEffect).toHaveBeenCalledOnce();

        resetControllerFault(controller);
        processFaultsAndWarnings();
        expect(controller.destroyed).toBe(false);
        expect(triggerOverloadEffect).toHaveBeenCalledOnce();
    });
});
