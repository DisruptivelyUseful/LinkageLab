// ============================================================================
// Circuit export for designer → simulator handoff (Phase 5d + Phase 10 store)
// ============================================================================

import {
    fromDesignerExport,
    publishCircuitDocument,
    resolveCircuitDocument,
    saveFromDesignerConfig,
    toDesignerExport,
} from '../circuit/circuit-store.js';
import { ExportFormat } from '../core/export-format.js';

/**
 * @param {object | null | undefined} circuitData
 */
export function publishCircuitExport(circuitData) {
    if (!circuitData) return;

    if (circuitData.items && !circuitData.schematic) {
        saveFromDesignerConfig(circuitData);
        return;
    }

    publishCircuitDocument(fromDesignerExport(circuitData));
}

/**
 * Resolve staged circuit export from AppStateBus or unified circuit store.
 * @returns {object | null}
 */
export function resolveCircuitExport() {
    const bus = globalThis.AppRouter?.getAppStateBus?.();
    if (bus?.circuitData) return bus.circuitData;

    const doc = resolveCircuitDocument();
    if (doc) return toDesignerExport(doc);

    return ExportFormat.loadFromStorage(ExportFormat.STORAGE_KEYS.DESIGNER_EXPORT);
}

/**
 * @returns {string}
 */
export function buildSimulatorFrameSrc() {
    const parsed = new URL('index.html', globalThis.location?.href || 'http://localhost/index.html');
    parsed.hash = '#/solar/simulate';
    parsed.searchParams.set('import', 'solarDesigner');
    parsed.searchParams.set('embedded', '1');
    parsed.searchParams.set('ts', String(Date.now()));
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export {
    fromDesignerExport,
    publishCircuitDocument,
    resolveCircuitDocument,
    saveFromDesignerConfig,
    toDesignerConfig,
    toDesignerExport,
} from '../circuit/circuit-store.js';
