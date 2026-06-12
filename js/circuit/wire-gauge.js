// ============================================================================
// Wire gauge calculation (shared by designer BOM and circuit analysis)
// ============================================================================

import { AWG_RATINGS } from '../core/constants.js';
import { bridgeGlobals } from '../linkage/global-bridge.js';

/**
 * @param {object} connection
 * @param {object[]} allItems
 * @param {object} [awgRatings=AWG_RATINGS]
 * @returns {{ gauge: string, distance: number, estimatedAmps: string, rating: object } | null}
 */
export function calculateWireGauge(connection, allItems, awgRatings = AWG_RATINGS) {
    const sourceItem = allItems.find((i) =>
        Object.values(i.handles || {}).some((h) =>
            (h.connectedTo || []).some((c) => c.connectionId === connection.id),
        ),
    );
    const targetItem = allItems.find((i) =>
        Object.values(i.handles || {}).some((h) =>
            (h.connectedTo || []).some((c) => c.connectionId === connection.id),
        ),
    );

    if (!sourceItem || !targetItem) return null;

    const dx = sourceItem.x - targetItem.x;
    const dy = sourceItem.y - targetItem.y;
    const distance = Math.sqrt(dx * dx + dy * dy) / 10;

    let estimatedAmps = 0;

    if (targetItem.type === 'acload') {
        estimatedAmps = targetItem.specs.watts / (targetItem.specs.voltage || 120);
    } else if (sourceItem.type === 'panel') {
        estimatedAmps = sourceItem.specs.imp || (sourceItem.specs.wmp / sourceItem.specs.vmp);
    } else if (sourceItem.type === 'battery' || sourceItem.type === 'smartbattery') {
        estimatedAmps = 50;
    } else if (sourceItem.type === 'controller') {
        if (targetItem.type === 'acload' || targetItem.type === 'acbreaker') {
            estimatedAmps = (sourceItem.specs.maxACOutputW || 1000) / 120;
        } else {
            estimatedAmps = sourceItem.specs.maxIsc || 30;
        }
    } else {
        estimatedAmps = 20;
    }

    estimatedAmps *= 1.25;

    let recommendedGauge = null;
    for (const [gauge, rating] of Object.entries(awgRatings)) {
        if (rating.amps >= estimatedAmps) {
            recommendedGauge = gauge;
            break;
        }
    }

    if (!recommendedGauge) {
        recommendedGauge = '2/0';
    }

    return {
        gauge: recommendedGauge,
        distance: Math.ceil(distance),
        estimatedAmps: estimatedAmps.toFixed(1),
        rating: awgRatings[recommendedGauge],
    };
}

/** Factory matching legacy createWireSystem().calculateGauge */
export function createWireSystem() {
    return {
        get AWG_RATINGS() {
            return AWG_RATINGS;
        },
        calculateGauge(connection, allItems) {
            return calculateWireGauge(connection, allItems, AWG_RATINGS);
        },
    };
}

bridgeGlobals({ calculateWireGauge, createWireSystem });

export default createWireSystem;
