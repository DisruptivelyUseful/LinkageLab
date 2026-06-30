// ============================================================================
// Viewport culling helpers for simulator canvas (Phase 11)
// ============================================================================

/**
 * @param {object} ctx
 * @param {() => object[]} ctx.getAllItems
 * @param {() => object[]} ctx.getConnections
 * @param {() => object | null} ctx.getSelectedItem
 * @param {() => object | null} ctx.getSelectedConnection
 * @param {() => boolean} ctx.isInitialRenderDone
 * @param {() => { width: number, height: number }} ctx.getSvgDimensions
 * @param {() => object | null} ctx.getZoomTransform
 */
export function createViewportCulling(ctx) {
    function getVisibleItems() {
        if (!ctx.isInitialRenderDone()) {
            return ctx.getAllItems();
        }

        try {
            const transform = ctx.getZoomTransform();
            const { width: svgWidth, height: svgHeight } = ctx.getSvgDimensions();
            if (!transform || !svgWidth || !svgHeight) return ctx.getAllItems();

            const viewport = {
                x: -transform.x / transform.k,
                y: -transform.y / transform.k,
                width: svgWidth / transform.k,
                height: svgHeight / transform.k,
            };
            const buffer = 200 / transform.k;

            const allItems = ctx.getAllItems();
            const filtered = allItems.filter((item) => {
                if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) return true;
                const itemRight = item.x + (item.width || 100);
                const itemBottom = item.y + (item.height || 100);
                return itemRight >= viewport.x - buffer
                    && item.x <= viewport.x + viewport.width + buffer
                    && itemBottom >= viewport.y - buffer
                    && item.y <= viewport.y + viewport.height + buffer;
            });

            // Degenerate viewport guard: never cull everything when items exist.
            if (filtered.length === 0 && allItems.length > 0) {
                return allItems;
            }

            return filtered;
        } catch (err) {
            return ctx.getAllItems();
        }
    }

    function getVisibleConnections() {
        const visibleItems = getVisibleItems();
        const visibleItemIds = new Set(visibleItems.map((i) => i.id));
        const selectedItem = ctx.getSelectedItem();

        return ctx.getConnections().filter((conn) => {
            const sourceVisible = visibleItemIds.has(conn.sourceItemId);
            const targetVisible = visibleItemIds.has(conn.targetItemId);
            const sourceSelected = selectedItem && selectedItem.id === conn.sourceItemId;
            const targetSelected = selectedItem && selectedItem.id === conn.targetItemId;
            return (sourceVisible && targetVisible) || sourceSelected || targetSelected;
        });
    }

    return { getVisibleItems, getVisibleConnections };
}

export default createViewportCulling;
