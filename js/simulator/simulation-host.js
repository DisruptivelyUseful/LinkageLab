// ============================================================================
// Simulator simulation host — shared time engine bridge (Phase 4/6)
// ============================================================================

import { createSimulationEngine } from '../circuit/simulation.js';

/**
 * Create a simulator time engine with optional callbacks.
 * Runtime may replace this with its inline Simulation object; this module
 * is the shared factory both views converge on.
 * @param {object} [options]
 */
export function createSimulatorTimeEngine(options = {}) {
    return createSimulationEngine(options);
}

if (typeof globalThis !== 'undefined') {
    globalThis.createSimulatorTimeEngine = createSimulatorTimeEngine;
}

export default createSimulatorTimeEngine;
