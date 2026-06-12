// ============================================================================
// Simulator config import/export helpers (unified project format)
// ============================================================================

import { publishCircuitExport } from '../solar/circuit-export.js';

/**
 * Publish circuit data to app state bus + localStorage.
 * @param {object} circuitExport
 */
export function stageCircuitExport(circuitExport) {
    if (!circuitExport) return;
    publishCircuitExport(circuitExport);
}

/**
 * Resolve items/connections from designer export payload.
 * @param {object} data
 */
export function parseDesignerExport(data) {
    if (!data) return { items: [], connections: [], itemIdCounter: 1, connectionIdCounter: 1 };

    if (data.schematic) {
        const items = data.schematic.components || [];
        const connections = data.schematic.connections || [];
        return {
            items,
            connections,
            itemIdCounter: items.length > 0 ? Math.max(...items.map((i) => i.id || 0)) + 1 : 1,
            connectionIdCounter: connections.length > 0 ? Math.max(...connections.map((c) => c.id || 0)) + 1 : 1,
        };
    }

    return {
        items: data.items || data.circuit?.items || [],
        connections: data.connections || data.circuit?.connections || [],
        itemIdCounter: data.itemIdCounter || 0,
        connectionIdCounter: data.connectionIdCounter || 0,
    };
}

/**
 * Rebuild handle.connectedTo arrays from connection list.
 * @param {object[]} items
 * @param {object[]} connections
 */
export function rebuildHandleConnections(items, connections) {
    items.forEach((item) => {
        Object.values(item.handles || {}).forEach((h) => {
            h.connectedTo = [];
        });
    });

    connections.forEach((conn) => {
        const sourceItem = items.find((i) => i.id === conn.sourceItemId);
        const targetItem = items.find((i) => i.id === conn.targetItemId);
        if (!sourceItem || !targetItem) return;

        const sourceHandle = Object.values(sourceItem.handles).find((h) => h.id === conn.sourceHandleId);
        const targetHandle = Object.values(targetItem.handles).find((h) => h.id === conn.targetHandleId);
        if (sourceHandle && targetHandle) {
            sourceHandle.connectedTo.push({
                itemId: targetItem.id,
                handleId: targetHandle.id,
                connectionId: conn.id,
            });
            targetHandle.connectedTo.push({
                itemId: sourceItem.id,
                handleId: sourceHandle.id,
                connectionId: conn.id,
            });
        }
    });
}

export default { stageCircuitExport, parseDesignerExport, rebuildHandleConnections };
