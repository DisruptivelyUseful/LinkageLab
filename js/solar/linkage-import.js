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
