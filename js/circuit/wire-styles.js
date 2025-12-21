/**
 * Wire Styles Module
 * Handles wire color, stroke width, and visual styling based on connection properties
 */

// Wire gauge specifications
export const WIRE_GAUGE_SPECS = {
    '18': { gauge: '18', amps: 14, width: 1, name: '18 AWG', resistancePer1000ft: 6.385 },
    '16': { gauge: '16', amps: 18, width: 1.5, name: '16 AWG', resistancePer1000ft: 4.016 },
    '14': { gauge: '14', amps: 20, width: 2, name: '14 AWG', resistancePer1000ft: 2.525 },
    '12': { gauge: '12', amps: 25, width: 2.5, name: '12 AWG', resistancePer1000ft: 1.588 },
    '10': { gauge: '10', amps: 30, width: 3, name: '10 AWG', resistancePer1000ft: 0.999 },
    '8': { gauge: '8', amps: 40, width: 3.5, name: '8 AWG', resistancePer1000ft: 0.628 },
    '6': { gauge: '6', amps: 55, width: 4, name: '6 AWG', resistancePer1000ft: 0.395 },
    '4': { gauge: '4', amps: 70, width: 4.5, name: '4 AWG', resistancePer1000ft: 0.249 },
    '2': { gauge: '2', amps: 95, width: 5, name: '2 AWG', resistancePer1000ft: 0.156 },
    '1/0': { gauge: '1/0', amps: 125, width: 5.5, name: '1/0 AWG', resistancePer1000ft: 0.0983 },
    '2/0': { gauge: '2/0', amps: 145, width: 6, name: '2/0 AWG', resistancePer1000ft: 0.0779 },
    '3/0': { gauge: '3/0', amps: 165, width: 6.5, name: '3/0 AWG', resistancePer1000ft: 0.0618 },
    '4/0': { gauge: '4/0', amps: 195, width: 7, name: '4/0 AWG', resistancePer1000ft: 0.0490 }
};

const WIRE_SAFETY_MARGIN_AMPS = 5;

/**
 * Get wire gauge specification for given amperage
 */
export function getWireGaugeForAmps(amps) {
    if (!amps || amps <= 0) {
        return { gauge: '10', amps: 30, width: 3, name: '10 AWG' };
    }
    
    const requiredAmps = amps + WIRE_SAFETY_MARGIN_AMPS;
    const sortedGauges = Object.entries(WIRE_GAUGE_SPECS)
        .sort((a, b) => a[1].amps - b[1].amps);
    
    for (const [gauge, spec] of sortedGauges) {
        if (requiredAmps <= spec.amps) {
            return { gauge, ...spec };
        }
    }
    
    const largestGauge = sortedGauges[sortedGauges.length - 1];
    return { gauge: largestGauge[0], ...largestGauge[1] };
}

/**
 * Get resource type color
 */
export function getResourceTypeColor(resourceType, RESOURCE_TYPES) {
    const resourceColors = {
        [RESOURCE_TYPES.POWER]: '#ffd700',
        [RESOURCE_TYPES.WATER]: '#4a90e2',
        [RESOURCE_TYPES.BIOMASS]: '#8B4513',
        [RESOURCE_TYPES.WOODGAS]: '#FFDEAD',
        [RESOURCE_TYPES.BIOCHAR]: '#404040',
        [RESOURCE_TYPES.PLASTIC]: '#888888',
        [RESOURCE_TYPES.PLASTIC_FLAKES]: '#aaaaaa',
        [RESOURCE_TYPES.WIND_TURBINES]: '#cccccc',
        [RESOURCE_TYPES.HEAT]: '#ff6b35'
    };
    return resourceColors[resourceType] || '#6fa06c';
}

/**
 * Get wire style based on connection properties
 * @param {Object} conn - Connection object
 * @param {Array} allItems - All items array (for looking up connected items)
 * @param {Object} RESOURCE_TYPES - Resource types constants
 * @returns {Object} Style object with color property
 */
export function getWireStyle(conn, allItems = [], RESOURCE_TYPES = {}) {
    const polarity = conn.polarity || 'mixed';
    
    // Resource port connections
    if (polarity === 'resource' && conn.resourceType) {
        return {
            color: getResourceTypeColor(conn.resourceType, RESOURCE_TYPES),
            width: 3
        };
    }
    
    // AC appliance connections (load)
    if (polarity === 'load') {
        const sourceItem = allItems.find(i => i.id === conn.sourceItemId);
        const targetItem = allItems.find(i => i.id === conn.targetItemId);
        const loadItem = sourceItem?.type === 'acload' ? sourceItem : (targetItem?.type === 'acload' ? targetItem : null);
        const outletItem = sourceItem?.type === 'acoutlet' ? sourceItem : (targetItem?.type === 'acoutlet' ? targetItem : null);
        
        let voltage = null;
        if (loadItem && loadItem.specs?.voltage) {
            voltage = loadItem.specs.voltage;
        } else if (outletItem && outletItem.specs?.voltage) {
            voltage = outletItem.specs.voltage;
        }
        
        if (voltage) {
            if (voltage === 120) {
                return { color: '#ffd700' };
            } else if (voltage === 240) {
                return { color: '#cc0000' };
            }
        }
    }
    
    const colors = {
        'positive': '#d9534f',
        'negative': '#333',
        'mixed': '#888',
        'ac': '#f0ad4e',
        'load': '#222',
        'parallel': '#00a8e8',
        'smart-battery': '#5cb85c'
    };
    
    return {
        color: colors[polarity] || colors['mixed']
    };
}

/**
 * Get wire stroke width based on wire gauge
 * @param {Object} conn - Connection object
 * @param {Function} calculateWireCurrent - Function to calculate current for a connection
 * @returns {number} Stroke width in pixels
 */
export function getWireStrokeWidth(conn, calculateWireCurrent) {
    if (!conn) {
        return WIRE_GAUGE_SPECS['10'].width;
    }
    
    if (conn.wireGauge && WIRE_GAUGE_SPECS[conn.wireGauge]) {
        return WIRE_GAUGE_SPECS[conn.wireGauge].width;
    }
    
    if (calculateWireCurrent) {
        const currentAmps = calculateWireCurrent(conn);
        const wireSpec = getWireGaugeForAmps(currentAmps);
        return wireSpec.width;
    }
    
    return WIRE_GAUGE_SPECS['10'].width;
}
