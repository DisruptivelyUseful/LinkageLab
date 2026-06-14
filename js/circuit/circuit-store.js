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

    const items = doc.items || [];
    return {
        items,
        connections: normalizeDesignerConnections(items, doc.connections || []),
        itemIdCounter: doc.itemIdCounter,
        connectionIdCounter: doc.connectionIdCounter,
        sourceHandleKey: doc.sourceHandleKey,
    };
}

/**
 * Resolve designer connection endpoints (simulator uses handle ids; designer uses keys).
 * @param {object[]} items
 * @param {object[]} connections
 * @returns {object[]}
 */
export function normalizeDesignerConnections(items, connections) {
    const findHandleKey = (item, conn, role) => {
        if (!item?.handles) return null;
        const keyField = role === 'source' ? 'sourceHandleKey' : 'targetHandleKey';
        const altField = role === 'source' ? 'sourceHandle' : 'targetHandle';
        const idField = role === 'source' ? 'sourceHandleId' : 'targetHandleId';

        const existingKey = conn[keyField] || conn[altField];
        if (existingKey && item.handles[existingKey]) return existingKey;

        const handleId = conn[idField];
        if (handleId) {
            const entry = Object.entries(item.handles).find(([, handle]) => handle?.id === handleId);
            if (entry) return entry[0];
        }

        return existingKey || null;
    };

    return (connections || []).map((conn) => {
        const sourceItem = items.find((item) => item.id === conn.sourceItemId);
        const targetItem = items.find((item) => item.id === conn.targetItemId);
        const sourceHandleKey = findHandleKey(sourceItem, conn, 'source');
        const targetHandleKey = findHandleKey(targetItem, conn, 'target');

        return {
            ...conn,
            sourceHandleKey: sourceHandleKey || conn.sourceHandleKey || conn.sourceHandle,
            targetHandleKey: targetHandleKey || conn.targetHandleKey || conn.targetHandle,
        };
    });
}

/**
 * @returns {CircuitDocument | null}
 */
export function resolveCircuitDocument() {
    const bus = globalThis.AppRouter?.getAppStateBus?.();
    if (bus?.circuitDocument) return bus.circuitDocument;
    if (bus?.projectDocument?.circuit) return bus.projectDocument.circuit;

    try {
        const projectRaw = localStorage.getItem('linkageLabProject');
        if (projectRaw) {
            const project = JSON.parse(projectRaw);
            if (project?.circuit?.items) return project.circuit;
        }
    } catch (err) {
        console.warn('[CircuitStore] Failed to read circuit from project document:', err);
    }

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
    notifySubscribers(doc);
    return doc;
}

const subscribers = new Set();

/** @returns {CircuitDocument | null} */
export function getState() {
    return resolveCircuitDocument();
}

/**
 * Merge partial circuit data into the canonical document.
 * @param {object} partial
 * @param {object} [meta]
 * @returns {CircuitDocument}
 */
export function setState(partial, meta = {}) {
    const current = resolveCircuitDocument() || createCircuitDocument({ items: [], connections: [] });
    const mergedConfig = {
        ...toDesignerConfig(current),
        ...partial,
        items: partial.items ?? partial.components ?? current.items,
        connections: partial.connections ?? current.connections,
        itemIdCounter: partial.itemIdCounter ?? current.itemIdCounter,
        connectionIdCounter: partial.connectionIdCounter ?? current.connectionIdCounter,
    };
    const doc = createCircuitDocument(mergedConfig, {
        automation: partial.automation ?? meta.automation ?? current.automation,
        simulation: partial.simulation ?? meta.simulation ?? current.simulation,
        summary: partial.summary ?? meta.summary ?? current.summary,
        ...meta,
    });
    publishCircuitDocument(doc, meta);
    notifySubscribers(doc);
    return doc;
}

/**
 * @param {(doc: CircuitDocument) => void} fn
 * @returns {() => void}
 */
export function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
}

function notifySubscribers(doc) {
    subscribers.forEach((fn) => {
        try {
            fn(doc);
        } catch (err) {
            console.warn('[CircuitStore] subscriber failed:', err);
        }
    });
}

/** Hydrate bus + legacy aliases from storage. @returns {CircuitDocument | null} */
export function initCircuitStore() {
    const doc = resolveCircuitDocument();
    if (doc) {
        publishCircuitDocument(doc);
    }
    return doc;
}

export default {
    CIRCUIT_DOCUMENT_KEY,
    createCircuitDocument,
    fromDesignerExport,
    toDesignerExport,
    toDesignerConfig,
    normalizeDesignerConnections,
    resolveCircuitDocument,
    publishCircuitDocument,
    saveFromDesignerConfig,
    getState,
    setState,
    subscribe,
    initCircuitStore,
};
