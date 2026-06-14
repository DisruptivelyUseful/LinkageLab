// ============================================================================
// @deprecated Solar designer shell — unified canvas lives in simulator-app.js
// ============================================================================

export {
    ensureSolarCanvasBoot,
    initUnifiedSolarCanvas,
    initSolarDesignerApp,
    initSolarSimulatorApp,
    refreshSolarCanvasFromCircuit,
    refreshSolarDesignerFromCircuit,
    refreshSolarSimulatorFromCircuit,
    setSolarCanvasAppMode,
    syncDesignerFromSimulatorSnapshot,
    scheduleSolarDesignerLayoutRefresh,
} from './simulator-app.js';

/** @deprecated linkage handoff now runs via main.js applyLinkagePanelSync */
export async function refreshSolarDesignerFromExport() {
    return { synced: false, panelCount: 0 };
}
