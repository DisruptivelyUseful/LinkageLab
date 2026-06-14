// ============================================================================
// Simulator render host — canvas/SVG mount helpers (Phase 6/11 boundary)
// ============================================================================

import { createViewportCulling } from './viewport-culling.js';

/** @returns {{ render?: Function, updateSvgDimensions?: Function } | null} */
export function getSimulatorRenderApi() {
    return {
        render: globalThis.render,
        updateSvgDimensions: globalThis.updateSvgDimensions,
        bootSimulatorApplication: globalThis.bootSimulatorApplication,
        createViewportCulling,
    };
}

export { createViewportCulling };

export default getSimulatorRenderApi;
