// ============================================================================
// Circuit core — single import surface for designer + simulator
// ============================================================================

import * as NodeFactory from './node-factory.js';
import * as WireRenderer from './wire-renderer.js';
import * as WireStyles from './wire-styles.js';
import * as ComponentLibrary from './component-library.js';
import { calculateWireGauge, createWireSystem } from './wire-gauge.js';
import { DesignerPowerFlow, SimulateModePowerFlow } from './power-flow.js';
import { checkVoltageMismatch, checkBreakerTripping } from './electrical.js';
import { createSimulationEngine } from './simulation.js';
import { bridgeGlobals } from '../linkage/global-bridge.js';

export {
    NodeFactory,
    WireRenderer,
    WireStyles,
    ComponentLibrary,
    calculateWireGauge,
    createWireSystem,
    DesignerPowerFlow,
    SimulateModePowerFlow,
    checkVoltageMismatch,
    checkBreakerTripping,
    createSimulationEngine,
};

const CircuitCore = {
    NodeFactory,
    WireRenderer,
    WireStyles,
    ComponentLibrary,
    calculateWireGauge,
    createWireSystem,
    DesignerPowerFlow,
    SimulateModePowerFlow,
    checkVoltageMismatch,
    checkBreakerTripping,
    createSimulationEngine,
    ...NodeFactory,
    ...WireRenderer,
    ...ComponentLibrary,
};

bridgeGlobals({ CircuitCore });

export default CircuitCore;
