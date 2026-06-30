import { describe, expect, it } from 'vitest';
import { createViewportCulling } from '../js/simulator/viewport-culling.js';

function makeCtx(overrides = {}) {
    const items = overrides.items ?? [{ id: 'a', x: 100, y: 100, width: 80, height: 40 }];
    return {
        getAllItems: () => items,
        getConnections: () => [],
        getSelectedItem: () => null,
        getSelectedConnection: () => null,
        isInitialRenderDone: () => overrides.initialRenderDone ?? true,
        getSvgDimensions: () => ({ width: 800, height: 600 }),
        getZoomTransform: () => overrides.transform ?? { x: 0, y: 0, k: 1 },
    };
}

describe('createViewportCulling', () => {
    it('returns all items before initial render completes', () => {
        const items = [{ id: 'a', x: 5000, y: 5000 }];
        const { getVisibleItems } = createViewportCulling(makeCtx({ items, initialRenderDone: false }));
        expect(getVisibleItems()).toHaveLength(1);
    });

    it('returns all items when viewport culling would hide everything', () => {
        const items = [
            { id: 'a', x: 5000, y: 5000 },
            { id: 'b', x: 5200, y: 5100 },
        ];
        const { getVisibleItems } = createViewportCulling(makeCtx({ items }));
        expect(getVisibleItems()).toHaveLength(2);
    });

    it('keeps items with missing coordinates visible', () => {
        const items = [{ id: 'a', x: undefined, y: undefined }];
        const { getVisibleItems } = createViewportCulling(makeCtx({ items }));
        expect(getVisibleItems()).toHaveLength(1);
    });

    it('culls items outside the viewport when some remain visible', () => {
        const items = [
            { id: 'near', x: 50, y: 50, width: 80, height: 40 },
            { id: 'far', x: 9000, y: 9000, width: 80, height: 40 },
        ];
        const { getVisibleItems } = createViewportCulling(makeCtx({ items }));
        expect(getVisibleItems().map((i) => i.id)).toEqual(['near']);
    });
});
