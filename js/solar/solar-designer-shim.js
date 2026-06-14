// ============================================================================
// SolarDesigner compatibility shim — proxies to unified simulator canvas API
// ============================================================================

/**
 * Install globalThis.SolarDesigner backed by the shared simulator runtime.
 */
export function installSolarDesignerShim() {
    globalThis.SolarDesigner = {
        isInitialized() {
            return Boolean(globalThis.__simulatorBootComplete);
        },

        getItems() {
            return globalThis.getSimulatorCircuitItems?.() ?? [];
        },

        getConnections() {
            return globalThis.getSimulatorCircuitConnections?.() ?? [];
        },

        render() {
            globalThis.requestSimulatorRender?.();
        },

        updateStats() {
            globalThis.updateSimulatorScores?.();
        },

        removeAllPanels() {
            return globalThis.removeSimulatorPanels?.() ?? 0;
        },

        syncPanelsFromLinkage(config) {
            return globalThis.syncPanelsFromLinkage?.(config) ?? { synced: false };
        },

        loadSolarConfig(config) {
            if (!config) return;
            globalThis.applySimulatorCircuitImport?.(config);
        },

        getSolarConfig() {
            const snapshot = globalThis.getSimulatorProjectSnapshot?.();
            if (!snapshot?.circuit) {
                return { items: [], connections: [] };
            }
            return {
                items: snapshot.circuit.items,
                connections: snapshot.circuit.connections,
                itemIdCounter: snapshot.circuit.itemIdCounter,
                connectionIdCounter: snapshot.circuit.connectionIdCounter,
                simulation: snapshot.simulation,
            };
        },

        syncExportToStorage() {
            globalThis.saveSimulatorCircuitToStore?.();
        },

        exportToSimulator() {
            globalThis.AppRouter?.navigateTo?.('solar-simulate').catch((err) => {
                console.error('[SolarDesigner shim] navigate to simulate failed:', err);
            });
        },

        normalizeCircuitItems(items) {
            return globalThis.CircuitNormalize?.normalizeCircuitItems?.(items) ?? items;
        },
    };
}
