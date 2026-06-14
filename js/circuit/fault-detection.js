// ============================================================================
// Fault detection + processing (Phase 11 — shared electrical safety)
// ============================================================================

import { INCIDENT_TEMPLATES } from './incident-templates.js';

/**
 * @param {object} deps
 */
export function createFaultDetection(deps) {
    const {
        getItems,
        getConnections,
        getLiveView,
        calculateConnectedArraySpecs,
        calculateConnectedBatterySpecs,
        calculateWireCurrent,
        getWireGaugeForAmps,
        getWireGaugeSpecs,
        effects = {},
        showIncidentReport,
        setDamageState,
    } = deps;

    const templates = deps.incidentTemplates || INCIDENT_TEMPLATES;

    function detectFaults() {
        const faults = [];
        const warnings = [];
        const allItems = getItems();
        const connections = getConnections();
        const LiveView = getLiveView();

        allItems.filter((i) => i.type === 'controller').forEach((controller) => {
            if (controller.destroyed) return;

            const arraySpecs = calculateConnectedArraySpecs(controller);
            const batterySpecs = calculateConnectedBatterySpecs(controller);

            if (arraySpecs.voc > controller.specs.maxVoc && !controller.destroyed) {
                if (!controller.vocFaultSuppressed) {
                    faults.push({
                        type: 'controller_voc_overload',
                        controller,
                        actualVoltage: arraySpecs.voc,
                        maxVoltage: controller.specs.maxVoc,
                    });
                }
            }

            if (batterySpecs.voltage > 0) {
                const supportedVoltages = controller.specs.supportedVoltages || [12, 24, 48];
                const maxSupportedVoltage = Math.max(...supportedVoltages);
                const nominalBatteryVoltage = Math.round(batterySpecs.voltage / 12) * 12;

                if (batterySpecs.voltage > maxSupportedVoltage + 10 && !controller.destroyed) {
                    faults.push({
                        type: 'controller_battery_overvoltage',
                        controller,
                        batteryVoltage: batterySpecs.voltage,
                        maxSupportedVoltage,
                    });
                }

                if (!supportedVoltages.includes(nominalBatteryVoltage)
                    && batterySpecs.voltage > 12
                    && batterySpecs.voltage <= maxSupportedVoltage + 10) {
                    warnings.push({
                        type: 'incompatible_battery_voltage',
                        controller,
                        batteryVoltage: nominalBatteryVoltage,
                        supportedVoltages,
                    });
                }
            }

            const battPosConn = controller.handles?.batteryPositive?.connectedTo || [];
            const battNegConn = controller.handles?.batteryNegative?.connectedTo || [];
            if (battPosConn.length > 0 && battNegConn.length > 0) {
                let reversePolarityDetected = false;
                let faultBattery = null;

                for (const posConn of battPosConn) {
                    const battery = allItems.find((i) => i.id === posConn.itemId && i.type === 'battery');
                    if (battery) {
                        const connectedHandle = Object.values(battery.handles).find((h) => h.id === posConn.handleId);
                        if (connectedHandle?.polarity === 'negative') {
                            reversePolarityDetected = true;
                            faultBattery = battery;
                            break;
                        }
                    }
                }

                if (!reversePolarityDetected) {
                    for (const negConn of battNegConn) {
                        const battery = allItems.find((i) => i.id === negConn.itemId && i.type === 'battery');
                        if (battery) {
                            const connectedHandle = Object.values(battery.handles).find((h) => h.id === negConn.handleId);
                            if (connectedHandle?.polarity === 'positive') {
                                reversePolarityDetected = true;
                                faultBattery = battery;
                                break;
                            }
                        }
                    }
                }

                if (reversePolarityDetected && faultBattery && !controller.destroyed) {
                    faults.push({
                        type: 'battery_reverse_polarity',
                        controller,
                        battery: faultBattery,
                    });
                }
            }

            const pvPosConn = controller.handles?.pvPositive?.connectedTo || [];
            const pvNegConn = controller.handles?.pvNegative?.connectedTo || [];
            if (pvPosConn.length > 0 && pvNegConn.length > 0) {
                let reversePanelDetected = false;
                let faultPanel = null;

                for (const posConn of pvPosConn) {
                    const panel = allItems.find((i) => i.id === posConn.itemId && i.type === 'panel');
                    if (panel) {
                        const connectedHandle = Object.values(panel.handles).find((h) => h.id === posConn.handleId);
                        if (connectedHandle?.polarity === 'negative') {
                            reversePanelDetected = true;
                            faultPanel = panel;
                            break;
                        }
                    }
                }

                if (!reversePanelDetected) {
                    for (const negConn of pvNegConn) {
                        const panel = allItems.find((i) => i.id === negConn.itemId && i.type === 'panel');
                        if (panel) {
                            const connectedHandle = Object.values(panel.handles).find((h) => h.id === negConn.handleId);
                            if (connectedHandle?.polarity === 'positive') {
                                reversePanelDetected = true;
                                faultPanel = panel;
                                break;
                            }
                        }
                    }
                }

                if (reversePanelDetected && faultPanel) {
                    warnings.push({
                        type: 'reversed_panel_polarity',
                        controller,
                        panel: faultPanel,
                    });
                }
            }

            if (arraySpecs.imp > controller.specs.maxIsc) {
                warnings.push({
                    type: 'array_imp_clipping',
                    controller,
                    actualImp: arraySpecs.imp,
                    maxIsc: controller.specs.maxIsc,
                });
            }
        });

        allItems.filter((i) => i.type === 'acload').forEach((load) => {
            if (load.destroyed || load.specs.voltage !== 120) return;

            const loadConn = connections.find((c) =>
                (c.sourceItemId === load.id && c.polarity === 'load')
                || (c.targetItemId === load.id && c.polarity === 'load'));

            if (!loadConn) return;

            const sourceItem = allItems.find((i) =>
                i.id === (loadConn.sourceItemId === load.id ? loadConn.targetItemId : loadConn.sourceItemId));

            if (!sourceItem) return;

            let circuitVoltage = null;
            if (sourceItem.type === 'acoutlet') {
                circuitVoltage = sourceItem.specs.voltage;
            } else if (sourceItem.type === 'acbreaker') {
                circuitVoltage = sourceItem.specs.voltage;
            } else if (sourceItem.type === 'doublevoltagehub') {
                const hubAcOutputHandle = sourceItem.handles?.acOutput;
                if (hubAcOutputHandle
                    && (loadConn.sourceHandleId === hubAcOutputHandle.id
                        || loadConn.targetHandleId === hubAcOutputHandle.id)) {
                    circuitVoltage = 240;
                }
            }

            if (circuitVoltage === 240
                && LiveView.state.active
                && LiveView.state.loadStates[load.id]) {
                faults.push({
                    type: 'load_240v_explosion',
                    load,
                    circuitVoltage,
                });
            }
        });

        const wireGaugeSpecs = getWireGaugeSpecs?.() || {};
        connections.forEach((conn) => {
            if (conn.destroyed || conn.burned) return;

            const currentAmps = calculateWireCurrent(conn);
            const wireSpec = conn.wireGauge
                ? wireGaugeSpecs[conn.wireGauge]
                : getWireGaugeForAmps(currentAmps);

            if (!wireSpec || currentAmps <= wireSpec.amps) return;

            let hasBreaker = false;
            const sourceItem = allItems.find((i) => i.id === conn.sourceItemId);
            const targetItem = allItems.find((i) => i.id === conn.targetItemId);

            if ((sourceItem && (sourceItem.type === 'acbreaker' || sourceItem.type === 'breaker'))
                || (targetItem && (targetItem.type === 'acbreaker' || targetItem.type === 'breaker'))) {
                hasBreaker = true;
            }

            if (!hasBreaker && currentAmps > wireSpec.amps * 1.2 && LiveView.state.active) {
                const powerFlow = LiveView.state.powerFlow[conn.id];
                if (powerFlow?.isLive && powerFlow.watts > 0) {
                    faults.push({
                        type: 'wire_overcurrent',
                        connection: conn,
                        currentAmps,
                        wireRating: wireSpec.amps,
                        wireGauge: wireSpec.gauge,
                    });
                }
            }
        });

        allItems.filter((i) => i.type === 'battery').forEach((battery) => {
            if (battery.destroyed) return;

            const posHandle = battery.handles?.positive || battery.handles?.batteryPositive;
            const negHandle = battery.handles?.negative || battery.handles?.batteryNegative;
            if (!posHandle || !negHandle) return;

            for (const posConn of posHandle.connectedTo || []) {
                for (const negConn of negHandle.connectedTo || []) {
                    if (posConn.connectionId !== negConn.connectionId) continue;

                    const hasInternalProtection = battery.specs.hasInternalProtection !== false;
                    if (!hasInternalProtection) {
                        faults.push({
                            type: 'battery_dead_short',
                            battery,
                            connection: connections.find((c) => c.id === posConn.connectionId),
                        });
                    } else {
                        warnings.push({
                            type: 'battery_dead_short_protected',
                            battery,
                        });
                    }
                }
            }
        });

        return { faults, warnings };
    }

    function processFaultsAndWarnings() {
        const { faults, warnings } = detectFaults();

        faults.forEach((fault) => {
            switch (fault.type) {
                case 'controller_voc_overload':
                    if (!fault.controller.destroyed && !fault.controller.vocFaultSuppressed) {
                        fault.controller.destroyed = true;
                        effects.triggerOverloadEffect?.(
                            fault.controller,
                            fault.actualVoltage,
                            fault.maxVoltage,
                        );
                    }
                    break;
                case 'controller_battery_overvoltage':
                    if (!fault.controller.destroyed) {
                        fault.controller.destroyed = true;
                        effects.triggerBatteryOvervoltageExplosion?.(
                            fault.controller,
                            fault.batteryVoltage,
                            fault.maxSupportedVoltage,
                        );
                    }
                    break;
                case 'battery_reverse_polarity':
                    if (!fault.controller.destroyed) {
                        fault.controller.destroyed = true;
                        effects.triggerReversePolarityExplosion?.(fault.controller, fault.battery);
                    }
                    break;
                case 'load_240v_explosion':
                    if (!fault.load.destroyed) {
                        fault.load.destroyed = true;
                        effects.triggerLoadExplosion?.(fault.load, fault.circuitVoltage);
                    }
                    break;
                case 'wire_overcurrent':
                    if (!fault.connection.burned) {
                        fault.connection.burned = true;
                        effects.triggerWireBurn?.(
                            fault.connection,
                            fault.currentAmps,
                            fault.wireRating,
                        );
                    }
                    break;
                case 'battery_dead_short':
                    if (!fault.battery.destroyed) {
                        fault.battery.destroyed = true;
                        effects.triggerBatteryShort?.(fault.battery, fault.connection);
                    }
                    break;
                default:
                    break;
            }
        });

        warnings.forEach((warning) => {
            switch (warning.type) {
                case 'reversed_panel_polarity':
                    if (!warning.controller.reversedPolarityWarningShown) {
                        warning.controller.reversedPolarityWarningShown = true;
                        showIncidentReport?.(templates.reversedPanelPolarity(warning.controller, warning.panel));
                        setDamageState?.(warning.panel.id, 'warning', 0);
                    }
                    break;
                case 'battery_dead_short_protected':
                    if (!warning.battery.shortCircuitWarningShown) {
                        warning.battery.shortCircuitWarningShown = true;
                        showIncidentReport?.({
                            type: 'warning',
                            icon: '⚠️',
                            category: 'PROTECTION ACTIVATED',
                            title: 'Short Circuit Detected',
                            description: 'Battery BMS disconnected due to a dead short.',
                            math: [
                                { label: 'Condition', value: 'Direct short', status: 'danger' },
                                { label: 'Protection', value: 'BMS open', status: 'good' },
                            ],
                            solutions: ['Remove the shorted connection'],
                            learnMoreTopic: 'battery-safety',
                        });
                        setDamageState?.(warning.battery.id, 'warning', 0);
                    }
                    break;
                default:
                    break;
            }
        });
    }

    return { detectFaults, processFaultsAndWarnings };
}

export default createFaultDetection;
