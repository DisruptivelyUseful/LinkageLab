// ============================================================================
// Simulator interaction host — input/keyboard/tooltip boundary (Phase 6)
// ============================================================================

/** Re-run runtime interaction setup when DOM is remounted in embedded mode. */
export function refreshSimulatorInteraction() {
    if (typeof globalThis.bootSimulatorApplication === 'function') {
        globalThis.__simulatorBootComplete = false;
        globalThis.bootSimulatorApplication();
    }
}

export default { refreshSimulatorInteraction };
