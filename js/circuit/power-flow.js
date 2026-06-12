/**
 * Power Flow Module — shared designer + simulate calculations
 */

export class SimulateModePowerFlow {
    constructor() {
        this.powerFlow = {};
        this.resourceFlow = {};
        this._powerFlowCache = null;
        this._powerFlowCacheKey = null;
    }

    calculateResourceFlow(allItems, connections, currentMode) {
        this.resourceFlow = {};
        if (currentMode !== 'simulate') return;

        const recipeLoads = allItems.filter((i) =>
            i.type === 'acload' && i.specs?.recipes?.length > 0 && i.isProcessing,
        );

        recipeLoads.forEach((load) => {
            const recipe = load.specs.recipes[load.activeRecipeIndex || 0];
            if (!recipe) return;

            Object.values(load.handles || {}).forEach((handle) => {
                (handle.connectedTo || []).forEach((conn) => {
                    const connObj = connections.find((c) => c.id === conn.connectionId);
                    if (!connObj) return;
                    this.resourceFlow[connObj.id] = {
                        isFlowing: true,
                        direction: handle.polarity === 'output' ? 'producing' : 'consuming',
                        resourceType: handle.resourceType,
                    };
                });
            });
        });
    }

    calculatePowerFlow(context) {
        const {
            currentMode,
            isPlaying,
            simStats = {},
            allItems = [],
            connections = [],
        } = context;

        const cacheKey = `${simStats.currentLoadPower || 0}_${simStats.currentSolarOutput || 0}_${simStats.batteryCharge || 0}`;
        const forceRecalculate = currentMode === 'simulate' && isPlaying;

        if (!forceRecalculate && this._powerFlowCache && this._powerFlowCacheKey === cacheKey) {
            this.powerFlow = this._powerFlowCache;
            return this.powerFlow;
        }

        this.powerFlow = {};
        this.calculateResourceFlow(allItems, connections, currentMode);

        if (currentMode !== 'simulate') {
            this._powerFlowCache = { ...this.powerFlow };
            this._powerFlowCacheKey = cacheKey;
            return this.powerFlow;
        }

        this._powerFlowCache = { ...this.powerFlow };
        this._powerFlowCacheKey = cacheKey;
        return this.powerFlow;
    }

    invalidateCache() {
        this._powerFlowCache = null;
        this._powerFlowCacheKey = null;
    }
}

/**
 * Designer-mode power flow (live wire check). Accepts full context from solar-designer.
 */
export class DesignerPowerFlow {
    constructor() {
        this._cache = null;
        this._cacheKey = null;
    }

    /**
     * @param {object} ctx
     * @param {object[]} ctx.allItems
     * @param {object[]} ctx.connections
     * @param {object} ctx.liveView - { active, loadStates, powerFlow }
     * @param {object} ctx.simulation - { currentSolarWatts, currentLoadWatts, currentBatteryFlow }
     * @param {object} [ctx.breakerManager]
     * @param {function} [ctx.calculateFull] - optional legacy full calculator
     */
    calculate(ctx) {
        if (typeof ctx.calculateFull === 'function') {
            return ctx.calculateFull(ctx);
        }

        const { allItems, connections, liveView, simulation } = ctx;
        if (!liveView?.active) {
            liveView.powerFlow = {};
            return liveView.powerFlow;
        }

        const solar = simulation?.currentSolarWatts || 0;
        const loadWatts = simulation?.currentLoadWatts || 0;
        const activeLoads = Object.values(liveView.loadStates || {}).filter(Boolean).length;
        const cacheKey = `${solar.toFixed(0)}_${loadWatts.toFixed(0)}_${activeLoads}`;

        if (this._cache && this._cacheKey === cacheKey) {
            liveView.powerFlow = this._cache;
            return liveView.powerFlow;
        }

        const powerFlow = {};
        let totalAC = 0;
        allItems.filter((i) => i.type === 'acload').forEach((load) => {
            if (liveView.loadStates?.[load.id]) {
                totalAC += load.specs?.watts || 0;
            }
        });

        allItems.filter((i) => i.type === 'controller').forEach((controller) => {
            const acHandle = controller.handles?.acOutput;
            if (!acHandle?.connectedTo?.length) return;
            acHandle.connectedTo.forEach((ref) => {
                powerFlow[ref.connectionId] = {
                    isLive: totalAC > 0 || solar > 0,
                    watts: totalAC,
                    amps: totalAC / 120,
                    voltage: 120,
                    hasActiveFlow: totalAC > 0,
                };
            });

            const pvPos = controller.handles?.pvPositive;
            if (pvPos?.connectedTo?.length && solar > 0) {
                pvPos.connectedTo.forEach((ref) => {
                    powerFlow[ref.connectionId] = {
                        isLive: true,
                        watts: solar,
                        amps: solar / (controller.specs?.mppVoltageMin || 120),
                        voltage: controller.specs?.mppVoltageMin || 120,
                        isPV: true,
                        direction: 'pv-to-controller',
                        hasActiveFlow: solar > loadWatts,
                    };
                });
            }
        });

        liveView.powerFlow = powerFlow;
        this._cache = powerFlow;
        this._cacheKey = cacheKey;
        return powerFlow;
    }

    invalidateCache() {
        this._cache = null;
        this._cacheKey = null;
    }
}

export const SimulateMode = new SimulateModePowerFlow();
