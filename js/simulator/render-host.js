// ============================================================================
// Simulator render host — canvas/SVG mount helpers (Phase 6 boundary)
// Delegates to runtime globals after solar-simulator.runtime.js loads.
// ============================================================================

/** @returns {{ render?: Function, updateSvgDimensions?: Function } | null} */
export function getSimulatorRenderApi() {
    return {
        render: globalThis.render,
        updateSvgDimensions: globalThis.updateSvgDimensions,
        bootSimulatorApplication: globalThis.bootSimulatorApplication,
    };
}

export default getSimulatorRenderApi;
