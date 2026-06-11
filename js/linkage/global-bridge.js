// ============================================================================
// Temporary bridge — publishes ESM exports to globalThis for classic scripts
// and HTML onclick handlers until all modules are converted.
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
