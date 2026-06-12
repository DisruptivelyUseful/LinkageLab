// ============================================================================
// Component library — single source for presets and spec lookup
// ============================================================================

import {
    PANEL_PRESETS,
    BATTERY_PRESETS,
    CONTROLLER_PRESETS,
    BREAKER_PRESETS,
    APPLIANCE_PRESETS,
    PRODUCER_PRESETS,
    CONTAINER_PRESETS,
    RESOURCE_TYPES,
    AWG_RATINGS,
} from '../core/constants.js';
import { bridgeGlobals } from '../linkage/global-bridge.js';

const PRESET_BY_TYPE = Object.freeze({
    panel: PANEL_PRESETS,
    battery: BATTERY_PRESETS,
    smartbattery: BATTERY_PRESETS,
    controller: CONTROLLER_PRESETS,
    acbreaker: BREAKER_PRESETS,
    dcbreaker: BREAKER_PRESETS,
    acload: APPLIANCE_PRESETS,
    producer: PRODUCER_PRESETS,
    container: CONTAINER_PRESETS,
});

/**
 * @param {string} type
 * @param {string} name
 * @returns {object | undefined}
 */
export function findPresetByName(type, name) {
    const list = PRESET_BY_TYPE[type];
    if (!list || !name) return undefined;
    return list.find((p) => p.name === name);
}

/**
 * @param {string} type
 * @param {number} index
 * @returns {object | undefined}
 */
export function getPresetByIndex(type, index = 0) {
    const list = PRESET_BY_TYPE[type];
    return list?.[index];
}

/**
 * Normalize panel specs (compute imp if missing).
 * @param {object} specs
 */
export function normalizePanelSpecs(specs) {
    const s = { ...specs };
    if (!s.imp && s.wmp && s.vmp) {
        s.imp = s.wmp / s.vmp;
    } else if (!s.imp && s.isc) {
        s.imp = s.isc * 0.9;
    } else if (!s.imp) {
        s.imp = 0;
    }
    s.imp = parseFloat(Number(s.imp).toFixed(2));
    return s;
}

/**
 * Normalize battery specs (compute kWh).
 * @param {object} specs
 */
export function normalizeBatterySpecs(specs) {
    const s = { ...specs };
    if (!s.kWh && s.voltage && s.ah) {
        s.kWh = (s.voltage * s.ah) / 1000;
    }
    return s;
}

/**
 * Library sections for sidebar population.
 */
export function getPresetLibrary() {
    return {
        panels: PANEL_PRESETS,
        batteries: BATTERY_PRESETS,
        controllers: CONTROLLER_PRESETS,
        breakers: BREAKER_PRESETS,
        appliances: APPLIANCE_PRESETS,
        producers: PRODUCER_PRESETS,
        containers: CONTAINER_PRESETS,
        resourceTypes: RESOURCE_TYPES,
    };
}

/**
 * Apply default panel dimensions (60-cell) when missing.
 * @param {object} preset
 */
export function withPanelDimensions(preset) {
    return { width: 1650, height: 992, ...preset };
}

/** Normalized panel preset list for simulator compatibility */
export const NORMALIZED_PANEL_PRESETS = PANEL_PRESETS.map(withPanelDimensions);

bridgeGlobals({
    findPresetByName,
    getPresetByIndex,
    normalizePanelSpecs,
    normalizeBatterySpecs,
    getPresetLibrary,
    NORMALIZED_PANEL_PRESETS,
});

export {
    PANEL_PRESETS,
    BATTERY_PRESETS,
    CONTROLLER_PRESETS,
    BREAKER_PRESETS,
    APPLIANCE_PRESETS,
    PRODUCER_PRESETS,
    CONTAINER_PRESETS,
    RESOURCE_TYPES,
    AWG_RATINGS,
};
