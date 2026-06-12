// ============================================================================
// Electrical validation — breakers, voltage mismatch (shared)
// ============================================================================

/**
 * Check if connected AC voltages are compatible.
 * @param {object[]} allItems
 * @param {object[]} connections
 * @returns {{ mismatches: object[] }}
 */
export function checkVoltageMismatch(allItems, connections) {
    const mismatches = [];
    const loads = allItems.filter((i) => i.type === 'acload');

    loads.forEach((load) => {
        const loadVoltage = load.specs?.voltage || 120;
        const connectedHandles = Object.values(load.handles || {}).flatMap((h) => h.connectedTo || []);
        connectedHandles.forEach((ref) => {
            const conn = connections.find((c) => c.id === ref.connectionId);
            if (!conn) return;
            const otherItem = allItems.find((i) =>
                i.id === conn.sourceItemId || i.id === conn.targetItemId,
            );
            if (otherItem?.type === 'acoutlet' && otherItem.specs?.voltage) {
                if (otherItem.specs.voltage !== loadVoltage) {
                    mismatches.push({
                        loadId: load.id,
                        loadVoltage,
                        sourceVoltage: otherItem.specs.voltage,
                        connectionId: conn.id,
                    });
                }
            }
        });
    });

    return { mismatches };
}

/**
 * Check breakers for overcurrent tripping.
 * @param {object} params
 * @param {object[]} params.allItems
 * @param {object} params.powerFlow - map connectionId -> { amps, watts }
 * @param {object} params.breakerStates - map breakerId -> { isClosed, wasTripped }
 * @param {function} [params.onTrip] - callback(breakerId, reason)
 * @returns {string[]} trippedBreakerIds
 */
export function checkBreakerTripping({
    allItems,
    powerFlow = {},
    breakerStates = {},
    onTrip,
}) {
    const tripped = [];

    allItems.filter((i) => i.type === 'acbreaker' || i.type === 'dcbreaker' || i.type === 'breaker').forEach((breaker) => {
        const rating = breaker.specs?.rating || breaker.rating || 20;
        const state = breakerStates[breaker.id] || { isClosed: breaker.isClosed !== false };
        if (!state.isClosed) return;

        let maxAmps = 0;
        Object.entries(powerFlow).forEach(([connId, flow]) => {
            if (flow.isLive && flow.amps > maxAmps) {
                const conn = { id: connId };
                const touchesBreaker = Object.values(breaker.handles || {}).some((h) =>
                    (h.connectedTo || []).some((c) => c.connectionId === connId),
                );
                if (touchesBreaker) {
                    maxAmps = flow.amps;
                }
            }
        });

        if (maxAmps > rating * 1.1) {
            tripped.push(breaker.id);
            if (onTrip) onTrip(breaker.id, `Overcurrent: ${maxAmps.toFixed(1)}A > ${rating}A`);
        }
    });

    return tripped;
}

export default { checkVoltageMismatch, checkBreakerTripping };
