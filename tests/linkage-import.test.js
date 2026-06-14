import { describe, expect, it } from 'vitest';
import {
    linkageExportToSyncConfig,
    panelSpecsChanged,
    shouldSyncPanelsFromLinkage,
} from '../js/solar/linkage-import.js';

describe('linkageExportToSyncConfig', () => {
    it('returns null when export has no solar panels', () => {
        expect(linkageExportToSyncConfig(null)).toBeNull();
        expect(linkageExportToSyncConfig({})).toBeNull();
        expect(linkageExportToSyncConfig({ solarPanels: { count: 0 } })).toBeNull();
    });

    it('builds panel stubs and layout from linkage export', () => {
        const config = linkageExportToSyncConfig({
            solarPanels: {
                count: 6,
                specs: { name: 'Test Panel', wmp: 420 },
                configuration: { gridRows: 2, gridCols: 3, isArchMode: true, paddingX: 3, paddingY: 4 },
            },
        });

        expect(config.panels).toHaveLength(6);
        expect(config.specs.wmp).toBe(420);
        expect(config.layout.gridRows).toBe(2);
        expect(config.layout.gridCols).toBe(3);
        expect(config.layout.isArchMode).toBe(true);
        expect(config.layout.paddingX).toBe(3);
        expect(config.layout.paddingY).toBe(4);
    });
});

describe('shouldSyncPanelsFromLinkage', () => {
    it('skips panel re-sync when count and specs are unchanged', () => {
        const exportData = {
            solarPanels: {
                count: 2,
                specs: { wmp: 200, width: 990, height: 1651 },
                configuration: { gridRows: 1, gridCols: 2 },
            },
        };
        const syncConfig = linkageExportToSyncConfig(exportData);
        const SolarDesigner = {
            isInitialized: () => true,
            getItems: () => [
                { type: 'panel', specs: { wmp: 200, width: 990, height: 1651 } },
                { type: 'panel', specs: { wmp: 200, width: 990, height: 1651 } },
            ],
        };

        expect(shouldSyncPanelsFromLinkage(SolarDesigner, syncConfig)).toBe(false);
        expect(panelSpecsChanged(SolarDesigner.getItems(), syncConfig.specs)).toBe(false);
    });

    it('requires sync when panel count differs', () => {
        const exportData = {
            solarPanels: {
                count: 3,
                specs: { wmp: 200, width: 990, height: 1651 },
                configuration: {},
            },
        };
        const syncConfig = linkageExportToSyncConfig(exportData);
        const SolarDesigner = {
            isInitialized: () => true,
            getItems: () => [
                { type: 'panel', specs: { wmp: 200, width: 990, height: 1651 } },
            ],
        };

        expect(shouldSyncPanelsFromLinkage(SolarDesigner, syncConfig)).toBe(true);
    });
});
