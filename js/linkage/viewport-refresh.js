// ============================================================================
// Linkage viewport layout refresh after app-shell view switches
// ============================================================================

import { requestRender } from './render-app.js';

/**
 * Re-hide the 2D overlay, resize canvases, and trigger a render after the
 * linkage view becomes visible again (e.g. returning from solar modes).
 * @returns {boolean} true when the viewport had measurable dimensions
 */
export function refreshLinkageViewport() {
    const viewport = document.getElementById('viewport');
    if (!viewport) return false;

    const overlay = document.getElementById('canvas');
    if (overlay) {
        overlay.style.setProperty('display', 'none', 'important');
        overlay.style.setProperty('pointer-events', 'none', 'important');
    }

    const measurement = document.getElementById('measurement-overlay');
    if (measurement) {
        measurement.style.pointerEvents = 'none';
    }

    const webgl = document.getElementById('canvas-webgl');
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    if (webgl && w > 0 && h > 0) {
        webgl.width = w;
        webgl.height = h;
    }

    if (w <= 0 || h <= 0) return false;

    requestRender();
    return true;
}

/** Defer refresh until after the linkage view is painted. */
export function scheduleLinkageViewportRefresh() {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            refreshLinkageViewport();
        });
    });
}
