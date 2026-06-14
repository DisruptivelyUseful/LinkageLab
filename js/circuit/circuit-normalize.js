// ============================================================================
// Circuit item normalization — shared handle repair for import/handoff
// ============================================================================

function repairPanelHandles(item) {
    if (item.type !== 'panel' || !item.width || !item.height) return item;
    const w = item.width;
    const h = item.height;
    const posId = item.handles?.positive?.id || `${item.id}-pos`;
    const negId = item.handles?.negative?.id || `${item.id}-neg`;
    item.handles = {
        positive: {
            ...(item.handles?.positive || {}),
            id: posId,
            polarity: 'positive',
            x: 0,
            y: h / 2,
            side: 'left',
            connectedTo: item.handles?.positive?.connectedTo || [],
        },
        negative: {
            ...(item.handles?.negative || {}),
            id: negId,
            polarity: 'negative',
            x: w,
            y: h / 2,
            side: 'right',
            connectedTo: item.handles?.negative?.connectedTo || [],
        },
    };
    return item;
}

/**
 * Repair handle geometry on a single circuit item after store import.
 * @param {object} item
 * @returns {object}
 */
export function repairCircuitItemHandles(item) {
    if (!item) return item;
    const clean = { ...item };
    delete clean.mesh;
    delete clean.node3D;
    if (clean.type === 'panel') {
        return repairPanelHandles(clean);
    }
    if (clean.handles) {
        Object.values(clean.handles).forEach((handle) => {
            if (handle && !handle.connectedTo) handle.connectedTo = [];
        });
    }
    return clean;
}

/**
 * @param {object[]} items
 * @returns {object[]}
 */
export function normalizeCircuitItems(items) {
    return (items || []).map(repairCircuitItemHandles);
}

export const CircuitNormalize = {
    repairCircuitItemHandles,
    normalizeCircuitItems,
};
