// ============================================================================
// Unified project document (Phase 12)
// Linkage + circuit + automation + simulation prefs in one canonical store
// ============================================================================

import { showToast } from './feedback.js';
import { ExportFormat } from './export-format.js';
import {
    createCircuitDocument,
    fromDesignerExport,
    publishCircuitDocument,
    resolveCircuitDocument,
    toDesignerExport,
} from '../circuit/circuit-store.js';

export const PROJECT_SCHEMA_VERSION = 4;
export const PROJECT_STORAGE_KEY = 'linkageLabProject';

const LEGACY_PROJECT_KEYS = [
    'solarUnifiedConfig',
    'unifiedSolarConfig',
    'linkageLab_config',
];

/**
 * @typedef {object} UnifiedProjectDocument
 * @property {number} schemaVersion
 * @property {string} exportType
 * @property {number} updatedAt
 * @property {object} [linkage]
 * @property {object} [circuit]
 * @property {object} [simulation]
 * @property {object} [automation]
 * @property {object} [structureGeometry]
 * @property {object} [cameraState]
 * @property {object} [handoff]
 * @property {object} [summary]
 */

/** @returns {UnifiedProjectDocument} */
export function createEmptyProjectDocument() {
    return {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        exportType: 'linkageLab.project',
        updatedAt: Date.now(),
    };
}

function designerExportToCircuit(designerExport) {
    const schematic = designerExport?.schematic;
    if (!schematic) return null;

    return createCircuitDocument({
        items: (schematic.components || []).map((c) => ({
            ...c,
            handles: c.handles || {},
        })),
        connections: (schematic.connections || []).map((c) => ({
            id: c.id,
            sourceItemId: c.sourceItemId,
            sourceHandleKey: c.sourceHandleKey || c.sourceHandle,
            targetItemId: c.targetItemId,
            targetHandleKey: c.targetHandleKey || c.targetHandle,
        })),
    }, {
        automation: designerExport.automation,
        simulation: designerExport.simulation,
        summary: designerExport.summary,
    });
}

function compactSolarToCircuit(compact) {
    if (!compact?.items?.length) return null;
    return createCircuitDocument({
        items: compact.items.map((item) => ({
            id: item.id,
            type: item.type,
            x: item.x,
            y: item.y,
            specs: item.specs || {},
            handles: {},
        })),
        connections: (compact.connections || []).map((conn) => ({
            id: conn.id,
            sourceItemId: conn.src,
            sourceHandleKey: conn.srcH,
            targetItemId: conn.tgt,
            targetHandleKey: conn.tgtH,
        })),
    });
}

function circuitSliceFromLegacy(raw) {
    if (raw.circuit?.items?.length) {
        return fromDesignerExport({ circuit: raw.circuit, automation: raw.automation, simulation: raw.simulation });
    }
    if (raw.items && raw.connections) {
        return createCircuitDocument(raw, {
            automation: raw.automations || raw.automation,
            simulation: raw.simulation,
        });
    }
    if (raw.handoff?.designer) return designerExportToCircuit(raw.handoff.designer);
    if (raw.schematic) return fromDesignerExport(raw);
    if (raw.solarDesigner) return compactSolarToCircuit(raw.solarDesigner);
    return null;
}

/**
 * Normalize legacy export shapes into UnifiedProjectDocument v4.
 * @param {object} raw
 * @returns {UnifiedProjectDocument}
 */
export function normalizeProjectDocument(raw) {
    if (!raw || typeof raw !== 'object') {
        throw new Error('Invalid project file');
    }

    if (raw.exportType === 'linkageLab.project' && raw.schemaVersion >= 3) {
        const doc = {
            ...raw,
            schemaVersion: PROJECT_SCHEMA_VERSION,
            exportType: 'linkageLab.project',
            updatedAt: raw.updatedAt || Date.now(),
        };
        if (!doc.circuit) {
            doc.circuit = circuitSliceFromLegacy(raw);
        }
        return doc;
    }

    if (raw.version === 'unified-v2' || (raw.circuit && raw.summary)) {
        return {
            schemaVersion: PROJECT_SCHEMA_VERSION,
            exportType: 'linkageLab.project',
            updatedAt: Date.now(),
            version: raw.version,
            linkage: raw.structure || raw.mode ? {
                structure: raw.structure,
                mode: raw.mode,
                foldAngle: raw.foldAngle,
                panels: raw.panels,
                costs: raw.costs,
                geometrySnapshot: raw.geometrySnapshot,
            } : undefined,
            circuit: circuitSliceFromLegacy(raw),
            simulation: raw.simulation,
            structureGeometry: raw.structureGeometry || raw.geometrySnapshot,
            cameraState: raw.cameraState,
            summary: raw.summary,
            handoff: raw.handoff,
        };
    }

    if (raw.source === ExportFormat.SOURCES.COMBINED && raw.linkage && raw.designer) {
        return {
            schemaVersion: PROJECT_SCHEMA_VERSION,
            exportType: 'linkageLab.project',
            updatedAt: Date.now(),
            ...raw.linkage,
            circuit: designerExportToCircuit(raw.designer),
            handoff: { linkage: raw.linkage, designer: raw.designer },
            automation: raw.designer?.automation || raw.automation,
            simulation: raw.designer?.simulation,
        };
    }

    if (raw.source === ExportFormat.SOURCES.SOLAR_DESIGNER && raw.schematic) {
        return {
            schemaVersion: PROJECT_SCHEMA_VERSION,
            exportType: 'linkageLab.project',
            updatedAt: Date.now(),
            circuit: designerExportToCircuit(raw),
            handoff: { designer: raw },
            automation: raw.automation,
            simulation: raw.simulation,
            summary: raw.summary,
        };
    }

    return {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        exportType: 'linkageLab.project',
        updatedAt: Date.now(),
        ...raw,
        circuit: circuitSliceFromLegacy(raw) || raw.circuit,
    };
}

/** @returns {UnifiedProjectDocument | null} */
export function resolveProjectDocument() {
    const bus = globalThis.AppRouter?.getAppStateBus?.();
    if (bus?.projectDocument) return bus.projectDocument;

    try {
        const saved = localStorage.getItem(PROJECT_STORAGE_KEY);
        if (saved) return normalizeProjectDocument(JSON.parse(saved));
    } catch (err) {
        console.warn('[ProjectStore] Failed to parse project document:', err);
    }

    for (const key of LEGACY_PROJECT_KEYS) {
        try {
            const legacy = localStorage.getItem(key);
            if (!legacy) continue;
            return normalizeProjectDocument(JSON.parse(legacy));
        } catch (err) {
            console.warn(`[ProjectStore] Failed to migrate ${key}:`, err);
        }
    }

    const circuitDoc = resolveCircuitDocument();
    if (circuitDoc) {
        return {
            ...createEmptyProjectDocument(),
            circuit: circuitDoc,
            handoff: {
                designer: toDesignerExport(circuitDoc),
            },
        };
    }

    return null;
}

/**
 * Convert project document to legacy unified-v2 shape for simulator applyUnifiedConfig.
 * @param {UnifiedProjectDocument} doc
 * @returns {object}
 */
export function projectDocumentToLegacyUnified(doc) {
    if (!doc) return null;

    const circuitConfig = doc.circuit
        ? {
            items: doc.circuit.items || [],
            connections: doc.circuit.connections || [],
            itemIdCounter: doc.circuit.itemIdCounter,
            connectionIdCounter: doc.circuit.connectionIdCounter,
        }
        : null;

    return {
        version: 'unified-v2',
        exportType: doc.exportType || 'linkageLab.project',
        schemaVersion: doc.schemaVersion,
        timestamp: new Date(doc.updatedAt || Date.now()).toISOString(),
        circuit: circuitConfig,
        simulation: doc.simulation || doc.circuit?.simulation,
        automation: doc.automation || doc.circuit?.automation,
        structureGeometry: doc.structureGeometry || doc.geometrySnapshot,
        geometrySnapshot: doc.geometrySnapshot || doc.structureGeometry,
        cameraState: doc.cameraState,
        structure: doc.linkage?.structure || doc.structure,
        mode: doc.linkage?.mode || doc.mode,
        foldAngle: doc.linkage?.foldAngle || doc.foldAngle,
        panels: doc.linkage?.panels || doc.panels,
        costs: doc.linkage?.costs || doc.costs,
        summary: doc.summary,
        handoff: doc.handoff,
    };
}

/**
 * Strip bulky slices before localStorage persistence (geometry lives in linkageLabGeometry).
 * @param {UnifiedProjectDocument} doc
 * @returns {object}
 */
export function compactProjectForStorage(doc) {
    return {
        schemaVersion: doc.schemaVersion,
        exportType: doc.exportType,
        updatedAt: doc.updatedAt,
        version: doc.version,
        linkage: doc.linkage,
        structure: doc.structure,
        mode: doc.mode,
        foldAngle: doc.foldAngle,
        panels: doc.panels,
        costs: doc.costs,
        supportBeams: doc.supportBeams,
        circuit: doc.circuit,
        simulation: doc.simulation,
        summary: doc.summary,
        cameraState: doc.cameraState,
        automation: doc.automation,
    };
}

/**
 * @param {UnifiedProjectDocument} doc
 * @param {{ syncCircuit?: boolean }} [options]
 */
export function publishProjectDocument(doc, options = {}) {
    if (!doc) return;

    const normalized = normalizeProjectDocument(doc);
    normalized.updatedAt = Date.now();

    const bus = globalThis.AppRouter?.getAppStateBus?.();
    if (bus) {
        bus.projectDocument = normalized;
    }

    try {
        localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(compactProjectForStorage(normalized)));
    } catch (err) {
        console.warn('[ProjectStore] Failed to persist project document:', err);
        try {
            const minimal = compactProjectForStorage(normalized);
            delete minimal.linkage;
            localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(minimal));
        } catch (fallbackErr) {
            console.warn('[ProjectStore] Failed to persist minimal project document:', fallbackErr);
        }
    }

    if (options.syncCircuit !== false && normalized.circuit) {
        publishCircuitDocument(normalized.circuit, {
            structureGeometry: normalized.structureGeometry,
            cameraState: normalized.cameraState,
        });
    }

    if (normalized.structureGeometry) {
        try {
            localStorage.setItem('linkageLabGeometry', JSON.stringify(normalized.structureGeometry));
            globalThis.linkageLabGeometry = normalized.structureGeometry;
        } catch (err) {
            console.warn('[ProjectStore] Failed to persist geometry:', err);
        }
    }

    if (normalized.handoff?.linkage && typeof globalThis.publishLinkageExport === 'function') {
        globalThis.publishLinkageExport(normalized.handoff.linkage);
    }
}

/**
 * Merge simulator runtime snapshot into the canonical project document.
 * @param {object} snapshot
 * @returns {UnifiedProjectDocument}
 */
export function saveSimulatorSnapshot(snapshot) {
    const current = resolveProjectDocument() || createEmptyProjectDocument();
    const circuit = snapshot.circuit
        ? createCircuitDocument(snapshot.circuit, {
            automation: snapshot.automation,
            simulation: snapshot.simulation,
            summary: snapshot.summary,
        })
        : current.circuit;

    const doc = normalizeProjectDocument({
        ...current,
        circuit,
        simulation: snapshot.simulation || current.simulation,
        structureGeometry: snapshot.structureGeometry || current.structureGeometry,
        cameraState: snapshot.cameraState || current.cameraState,
        summary: snapshot.summary || current.summary,
        linkage: snapshot.linkage || current.linkage,
    });

    publishProjectDocument(doc);
    return doc;
}

/** Hydrate bus from storage. @returns {UnifiedProjectDocument | null} */
export function initProjectStore() {
    const doc = resolveProjectDocument();
    if (doc) {
        publishProjectDocument(doc, { syncCircuit: true });
    }
    return doc;
}

/** @deprecated alias */
export const normalizeProjectImport = normalizeProjectDocument;

export default {
    PROJECT_SCHEMA_VERSION,
    PROJECT_STORAGE_KEY,
    createEmptyProjectDocument,
    normalizeProjectDocument,
    normalizeProjectImport,
    resolveProjectDocument,
    publishProjectDocument,
    projectDocumentToLegacyUnified,
    saveSimulatorSnapshot,
    initProjectStore,
};
