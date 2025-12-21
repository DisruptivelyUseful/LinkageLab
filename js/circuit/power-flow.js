/**
 * Power Flow Module
 * Handles power flow calculations for simulate mode
 */

/**
 * SimulateMode power flow calculator
 * This module calculates power flow through connections during simulation
 */
export class SimulateModePowerFlow {
    constructor() {
        this.powerFlow = {}; // { connectionId: { watts, amps, voltage, direction, isLive } }
        this.resourceFlow = {}; // { connectionId: { isFlowing, direction: 'consuming'|'producing', resourceType } }
        this._powerFlowCache = null;
        this._powerFlowCacheKey = null;
    }
    
    /**
     * Calculate resource flow for recipe-based loads
     */
    calculateResourceFlow(allItems, connections, currentMode) {
        this.resourceFlow = {};
        
        if (currentMode !== 'simulate') return;
        
        const recipeLoads = allItems.filter(i => 
            i.type === 'acload' && 
            i.specs.recipes && 
            i.specs.recipes.length > 0 &&
            i.isProcessing
        );
        
        recipeLoads.forEach(load => {
            const activeRecipeIndex = load.activeRecipeIndex || 0;
            const recipe = load.specs.recipes[activeRecipeIndex];
            if (!recipe) return;
            
            Object.values(load.handles || {}).forEach(handle => {
                if (handle.polarity === 'input' && handle.connectedTo) {
                    handle.connectedTo.forEach(conn => {
                        const connObj = connections.find(c => c.id === conn.connectionId);
                        if (connObj) {
                            this.resourceFlow[connObj.id] = {
                                isFlowing: true,
                                direction: 'consuming',
                                resourceType: handle.resourceType
                            };
                        }
                    });
                }
                
                if (handle.polarity === 'output' && handle.connectedTo) {
                    const recipeOutputs = recipe.outputs || [];
                    if (recipeOutputs.length > 0) {
                        handle.connectedTo.forEach(conn => {
                            const connObj = connections.find(c => c.id === conn.connectionId);
                            if (connObj) {
                                this.resourceFlow[connObj.id] = {
                                    isFlowing: true,
                                    direction: 'producing',
                                    resourceType: handle.resourceType
                                };
                            }
                        });
                    }
                }
            });
        });
    }
    
    /**
     * Calculate power flow during simulation
     * This is a simplified version - the full implementation is in solar_simulator.html
     * The full version should be extracted and refactored incrementally
     */
    calculatePowerFlow(context) {
        const {
            currentMode,
            isPlaying,
            simStats,
            allItems,
            connections,
            calculateConnectedBatterySpecs,
            calculateConnectedArraySpecs,
            checkOutletCircuitStatus,
            hasPowerSourceConnection,
            LiveView
        } = context;
        
        const currentLoadPower = simStats.currentLoadPower || 0;
        const currentSolarOutput = simStats.currentSolarOutput || 0;
        const batteryCharge = simStats.batteryCharge || 0;
        const acOutputEnabled = simStats.controllerACOutputEnabled !== false;
        
        const runningLoads = allItems
            .filter(i => (i.type === 'acload' || i.type === 'processor') && i.simState?.isRunning)
            .map(i => i.id)
            .sort()
            .join(',');
        
        const cacheKey = `${currentLoadPower}_${currentSolarOutput}_${batteryCharge}_${acOutputEnabled}_${runningLoads}`;
        const forceRecalculate = currentMode === 'simulate' && isPlaying;
        
        if (!forceRecalculate && this._powerFlowCache && this._powerFlowCacheKey === cacheKey) {
            this.powerFlow = this._powerFlowCache;
            return;
        }
        
        this.powerFlow = {};
        this.calculateResourceFlow(allItems, connections, currentMode);
        
        if (currentMode !== 'simulate') {
            this._powerFlowCache = this.powerFlow;
            this._powerFlowCacheKey = cacheKey;
            return;
        }
        
        // NOTE: The full power flow calculation is very complex (800+ lines)
        // This is a placeholder that should be incrementally refactored
        // The full implementation includes:
        // - Tracing AC loads back to controller
        // - Marking breaker panel connections
        // - Marking outlet connections
        // - Calculating PV power flow
        // - Calculating battery power flow
        // - Voltage mismatch detection
        
        // For now, this is a stub that will be expanded
        // The full calculatePowerFlow logic should be extracted from solar_simulator.html
        // and refactored into smaller, testable functions
        
        this._powerFlowCache = { ...this.powerFlow };
        this._powerFlowCacheKey = cacheKey;
    }
    
    /**
     * Invalidate power flow cache
     */
    invalidateCache() {
        this._powerFlowCache = null;
        this._powerFlowCacheKey = null;
    }
}

// Export singleton instance (can be replaced with dependency injection)
export const SimulateMode = new SimulateModePowerFlow();
