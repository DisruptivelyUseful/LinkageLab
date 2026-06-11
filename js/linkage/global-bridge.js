// ============================================================================
// Temporary bridge â€” publishes ESM exports to globalThis for classic scripts,
// HTML onclick handlers, and modules not yet migrated to explicit imports.
// ============================================================================

/**
 * @param {Record<string, unknown>} exports
 * @param {string} [linkageModuleName] - key under LinkageModules
 */
export function bridgeGlobals(exports, linkageModuleName) {
    Object.assign(globalThis, exports);
    if (linkageModuleName) {
        globalThis.LinkageModules = globalThis.LinkageModules || {};
        globalThis.LinkageModules[linkageModuleName] = exports;
    }
}
