// ============================================================================
// Convert LinkageLab export payload → SolarDesigner sync config
// ============================================================================

/**
 * @param {object | null | undefined} exportData - linkageLab export (v2)
 * @returns {{ panels: object[], specs: object, layout: object } | null}
 */
export function linkageExportToSyncConfig(exportData) {
    if (!exportData?.solarPanels) return null;

    const count = exportData.solarPanels.count || 0;
    if (count <= 0) return null;

    const specs = exportData.solarPanels.specs || {};
    const cfg = exportData.solarPanels.configuration || {};

    return {
        panels: Array.from({ length: count }, (_, index) => ({ index })),
        specs: {
            name: specs.name || 'LinkageLab Panel',
            wmp: specs.wmp || 400,
            vmp: specs.vmp || 41.5,
            voc: specs.voc || 49.5,
            isc: specs.isc || 10.2,
            imp: specs.imp || 9.65,
            width: specs.width || 990,
            height: specs.height || 1651,
            cost: specs.cost || 150,
        },
        layout: {
            isArchMode: !!cfg.isArchMode,
            gridRows: cfg.gridRows || Math.ceil(Math.sqrt(count)),
            gridCols: cfg.gridCols || Math.ceil(Math.sqrt(count)),
            paddingX: cfg.paddingX ?? 2,
            paddingY: cfg.paddingY ?? 2,
        },
    };
}

/**
 * Whether linkage panel specs/count changed enough to warrant a full panel re-sync.
 * @param {object[]} currentPanels
 * @param {object} specs
 */
export function panelSpecsChanged(currentPanels, specs) {
    if (!currentPanels.length) return true;
    const first = currentPanels[0];
    return first.specs?.wmp !== specs.wmp
        || first.specs?.width !== specs.width
        || first.specs?.height !== specs.height;
}

/**
 * Avoid tearing down designer panels on every mode switch when nothing changed.
 * @param {object} SolarDesigner
 * @param {{ panels: object[], specs: object, layout: object } | null} syncConfig
 * @param {{ force?: boolean }} [options]
 */
export function shouldSyncPanelsFromLinkage(SolarDesigner, syncConfig, options = {}) {
    if (!syncConfig?.panels?.length) return false;
    if (options.force) return true;
    if (!SolarDesigner?.isInitialized?.()) return true;

    const currentPanels = SolarDesigner.getItems().filter((item) => item.type === 'panel');
    if (currentPanels.length === 0) return true;
    if (currentPanels.length !== syncConfig.panels.length) return true;
    return panelSpecsChanged(currentPanels, syncConfig.specs);
}
