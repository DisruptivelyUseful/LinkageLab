// ============================================================================
// Bridge — publishes ESM exports to globalThis for HTML onclick handlers and
// embed integrations. Phase 4: linkage modules use explicit imports; bridge
// remains for partials and external callers until Phase 5 shell migration.
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
