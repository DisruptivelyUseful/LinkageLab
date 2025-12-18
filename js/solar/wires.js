// ============================================================================
// WIRE SYSTEM - Wire gauge calculation and BOM
// ============================================================================

function createWireSystem() {
    'use strict';
    
    return {
        // Wire gauge calculation based on amperage and distance
        // AWG_RATINGS is loaded from js/core/constants.js
        get AWG_RATINGS() { return AWG_RATINGS; },
        
        // Calculate required wire gauge for a connection
        calculateGauge(connection, allItems) {
            // Get source and target items
            const sourceItem = allItems.find(i => 
                Object.values(i.handles).some(h => h.connectedTo.some(c => c.connectionId === connection.id))
            );
            const targetItem = allItems.find(i => 
                Object.values(i.handles).some(h => h.connectedTo.some(c => c.connectionId === connection.id))
            );
            
            if (!sourceItem || !targetItem) return null;
            
            // Calculate distance (approximate, in feet - each unit = 10 feet)
            const dx = (sourceItem.x - targetItem.x);
            const dy = (sourceItem.y - targetItem.y);
            const distance = Math.sqrt(dx * dx + dy * dy) / 10; // Convert to feet
            
            // Estimate current based on components
            let estimatedAmps = 0;
            
            // For AC loads
            if (targetItem.type === 'acload') {
                estimatedAmps = targetItem.specs.watts / (targetItem.specs.voltage || 120);
            }
            // For panels (DC current)
            else if (sourceItem.type === 'panel') {
                estimatedAmps = sourceItem.specs.imp || (sourceItem.specs.wmp / sourceItem.specs.vmp);
            }
            // For batteries
            else if (sourceItem.type === 'battery') {
                estimatedAmps = 50; // Assume 50A for battery connections
            }
            // For controllers
            else if (sourceItem.type === 'controller') {
                if (targetItem.type === 'acload' || targetItem.type === 'acbreaker') {
                    estimatedAmps = (sourceItem.specs.maxACOutputW || 1000) / 120;
                } else {
                    estimatedAmps = sourceItem.specs.maxIsc || 30;
                }
            }
            // Default to 20A if unknown
            else {
                estimatedAmps = 20;
            }
            
            // Add 25% safety margin
            estimatedAmps *= 1.25;
            
            // Find smallest gauge that can handle the current
            let recommendedGauge = null;
            for (const [gauge, rating] of Object.entries(AWG_RATINGS)) {
                if (rating.amps >= estimatedAmps) {
                    recommendedGauge = gauge;
                    break;
                }
            }
            
            if (!recommendedGauge) {
                recommendedGauge = '2/0'; // Largest available
            }
            
            return {
                gauge: recommendedGauge,
                distance: Math.ceil(distance),
                estimatedAmps: estimatedAmps.toFixed(1),
                rating: AWG_RATINGS[recommendedGauge]
            };
        }
    };
}




