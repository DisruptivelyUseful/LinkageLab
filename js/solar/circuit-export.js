// ============================================================================
// Circuit export for designer → simulator handoff (Phase 5d)
// ============================================================================

import { ExportFormat } from '../core/export-format.js';

/**
 * @param {object | null | undefined} circuitData
 */
export function publishCircuitExport(circuitData) {
    if (!circuitData) return;
    ExportFormat.saveToStorage(ExportFormat.STORAGE_KEYS.DESIGNER_EXPORT, circuitData);
    const bus = globalThis.AppRouter?.getAppStateBus?.();
    if (bus) {
        bus.circuitData = circuitData;
    }
}

/**
 * Resolve staged circuit export from AppStateBus or localStorage.
 * @returns {object | null}
 */
export function resolveCircuitExport() {
    const bus = globalThis.AppRouter?.getAppStateBus?.();
    if (bus?.circuitData) return bus.circuitData;
    return ExportFormat.loadFromStorage(ExportFormat.STORAGE_KEYS.DESIGNER_EXPORT);
}

/**
 * @returns {string}
 */
export function buildSimulatorFrameSrc() {
    const url = ExportFormat.buildImportURL('solar_simulator.html', 'solarDesigner');
    const parsed = new URL(url, globalThis.location?.origin || 'http://localhost');
    parsed.searchParams.set('embedded', '1');
    parsed.searchParams.set('ts', String(Date.now()));
    return `${parsed.pathname}${parsed.search}`;
}
