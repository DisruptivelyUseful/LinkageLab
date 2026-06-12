// ============================================================================
// Unified circuit document store (Phase 10)
// Single canonical circuit state for designer ↔ simulator handoff
// ============================================================================

import { ExportFormat } from '../core/export-format.js';

export const CIRCUIT_DOCUMENT_KEY = 'linkageLab_circuitDocument';

/**
 * @typedef {object} CircuitDocument
 * @property {number} version
 * @property {number} updatedAt
 * @property {object[]} items
 * @property {object[]} connections
 * @property {number} [itemIdCounter]
 * @property {number} [connectionIdCounter]
 * @property {string} [sourceHandleKey]
 * @property {object} [automation]
 * @property {object} [simulation]
 * @property {object} [summary]
 */

/**
 * @param {object} config
 * @param {object} [meta]
 * @returns {CircuitDocument}
 */
export function createCircuitDocument(config, meta = {}) {
    const items = config.items || config.components || [];
    const connections = config.connections || [];

    return {
        version: 1,
        updatedAt: Date.now(),
        items,
        connections,
        itemIdCounter: config.itemIdCounter
            ?? (items.length > 0 ? Math.max(...items.map((i) => i.id || 0)) + 1 : 1),
        connectionIdCounter: config.connectionIdCounter
            ?? (connections.length > 0 ? Math.max(...connections.map((c) => c.id || 0)) + 1 : 1),
        sourceHandleKey: config.sourceHandleKey,
        automation: meta.automation,
        simulation: meta.simulation,
        summary: meta.summary || {
            totalPanelWatts: meta.totalPanelWatts,
            totalBatteryKwh: meta.totalBatteryKwh,
            componentCount: meta.componentCount,
        },
    };
}

/**
 * @param {object} exportData
 * @returns {CircuitDocument}
 */
export function fromDesignerExport(exportData) {
    if (!exportData) {
        return createCircuitDocument({ items: [], connections: [] });
    }

    if (exportData.schematic) {
        return createCircuitDocument(
            {
                items: exportData.schematic.components || [],
                connections: exportData.schematic.connections || [],
            },
            {
                automation: exportData.automation,
                simulation: exportData.simulation,
                summary: exportData.summary,
            },
        );
    }

    if (exportData.circuit) {
        return createCircuitDocument(exportData.circuit, {
            automation: exportData.automation,
            simulation: exportData.simulation,
        });
    }

    return createCircuitDocument(exportData, {
        automation: exportData.automation,
        simulation: exportData.simulation,
        summary: exportData.summary,
    });
}

/**
 * @param {CircuitDocument} doc
 * @param {object} [extra]
 * @returns {object}
 */
export function toDesignerExport(doc, extra = {}) {
    if (!doc) return null;

    return ExportFormat.createDesignerExport({
        components: doc.items || [],
        connections: doc.connections || [],
        automationRules: doc.automation || extra.automationRules,
        timeOfDay: doc.simulation?.timeOfDay ?? extra.timeOfDay,
        isLiveMode: doc.simulation?.isLiveMode ?? extra.isLiveMode,
        loadStates: doc.simulation?.loadStates ?? extra.loadStates,
        breakerStates: doc.simulation?.breakerStates ?? extra.breakerStates,
        totalPanelWatts: doc.summary?.totalPanelWatts ?? extra.totalPanelWatts,
        totalBatteryKwh: doc.summary?.totalBatteryKwh ?? extra.totalBatteryKwh,
        componentCount: doc.summary?.componentCount ?? extra.componentCount ?? doc.items?.length ?? 0,
        canvasWidth: extra.canvasWidth ?? 2000,
        canvasHeight: extra.canvasHeight ?? 1500,
        zoom: extra.zoom ?? 1,
        panX: extra.panX ?? 0,
        panY: extra.panY ?? 0,
        structureGeometry: extra.structureGeometry,
        cameraState: extra.cameraState,
    });
}

/**
 * @param {CircuitDocument} doc
 * @returns {object}
 */
export function toDesignerConfig(doc) {
    if (!doc) return { items: [], connections: [] };

    return {
        items: doc.items || [],
        connections: doc.connections || [],
        itemIdCounter: doc.itemIdCounter,
        connectionIdCounter: doc.connectionIdCounter,
        sourceHandleKey: doc.sourceHandleKey,
    };
}

/**
 * @returns {CircuitDocument | null}
 */
export function resolveCircuitDocument() {
    const bus = globalThis.AppRouter?.getAppStateBus?.();
    if (bus?.circuitDocument) return bus.circuitDocument;

    try {
        const saved = localStorage.getItem(CIRCUIT_DOCUMENT_KEY);
        if (saved) return JSON.parse(saved);
    } catch (err) {
        console.warn('[CircuitStore] Failed to parse circuit document:', err);
    }

    const designerExport = ExportFormat.loadFromStorage(ExportFormat.STORAGE_KEYS.DESIGNER_EXPORT);
    if (designerExport) return fromDesignerExport(designerExport);

    try {
        const legacyConfig = localStorage.getItem('linkageLab_solarConfig');
        if (legacyConfig) return fromDesignerExport(JSON.parse(legacyConfig));
    } catch (err) {
        console.warn('[CircuitStore] Failed to migrate linkageLab_solarConfig:', err);
    }

    try {
        const unifiedConfig = localStorage.getItem('solarUnifiedConfig');
        if (unifiedConfig) {
            const parsed = JSON.parse(unifiedConfig);
            if (parsed?.circuit) return fromDesignerExport(parsed);
        }
    } catch (err) {
        console.warn('[CircuitStore] Failed to migrate solarUnifiedConfig:', err);
    }

    return null;
}

/**
 * @param {CircuitDocument} doc
 */
export function publishCircuitDocument(doc, extra = {}) {
    if (!doc) return;

    const bus = globalThis.AppRouter?.getAppStateBus?.();
    if (bus) {
        bus.circuitDocument = doc;
        bus.circuitData = toDesignerExport(doc, extra);
    }

    try {
        localStorage.setItem(CIRCUIT_DOCUMENT_KEY, JSON.stringify(doc));
    } catch (err) {
        console.warn('[CircuitStore] Failed to persist circuit document:', err);
    }

    ExportFormat.saveToStorage(
        ExportFormat.STORAGE_KEYS.DESIGNER_EXPORT,
        toDesignerExport(doc, extra),
    );
}

/**
 * @param {object} config
 * @param {object} [meta]
 * @returns {CircuitDocument}
 */
export function saveFromDesignerConfig(config, meta = {}) {
    const doc = createCircuitDocument(config, meta);
    publishCircuitDocument(doc, meta);
    return doc;
}

export default {
    CIRCUIT_DOCUMENT_KEY,
    createCircuitDocument,
    fromDesignerExport,
    toDesignerExport,
    toDesignerConfig,
    resolveCircuitDocument,
    publishCircuitDocument,
    saveFromDesignerConfig,
};
