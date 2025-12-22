// ============================================================================
// SOLAR DESIGN MODE - ELECTRICAL SIMULATION
// ============================================================================

const SolarDesigner = (function() {
    'use strict';
    
    // ============================================
    // COMPONENT PRESETS
    // ============================================
    // NOTE: All presets and constants are now loaded from js/core/constants.js
    // The following constants are expected to be defined globally:
    // - PANEL_PRESETS, BATTERY_PRESETS, CONTROLLER_PRESETS
    // - BREAKER_PRESETS, APPLIANCE_PRESETS, PRODUCER_PRESETS
    // - CONTAINER_PRESETS, RESOURCE_TYPES, AWG_RATINGS
    // - SYSTEM_REVIEW_SETTINGS
    
    // ============================================
    // WIRE SYSTEM - Wire gauge calculation
    // ============================================
    
    const WireSystem = {
        // Wire gauge ratings based on amperage
        AWG_RATINGS: {
            // AWG: { maxAmps@120V, ohmsPerFoot, cost per foot }
            14: { amps: 15, ohms: 0.00253, cost: 0.50 },
            12: { amps: 20, ohms: 0.00159, cost: 0.75 },
            10: { amps: 30, ohms: 0.00100, cost: 1.20 },
            8: { amps: 40, ohms: 0.000628, cost: 2.00 },
            6: { amps: 55, ohms: 0.000395, cost: 3.50 },
            4: { amps: 70, ohms: 0.000249, cost: 5.00 },
            2: { amps: 95, ohms: 0.000157, cost: 7.50 },
            1: { amps: 110, ohms: 0.000124, cost: 10.00 },
            '1/0': { amps: 125, ohms: 0.000098, cost: 12.50 },
            '2/0': { amps: 145, ohms: 0.000078, cost: 15.00 }
        },
        
        // Calculate required wire gauge for a connection
        calculateGauge(connection, allItems) {
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
            const distance = Math.sqrt(dx * dx + dy * dy) / 10;
            
            // Estimate current based on components
            let estimatedAmps = 0;
            
            if (targetItem.type === 'acload') {
                estimatedAmps = targetItem.specs.watts / (targetItem.specs.voltage || 120);
            } else if (sourceItem.type === 'panel') {
                estimatedAmps = sourceItem.specs.imp || (sourceItem.specs.wmp / sourceItem.specs.vmp);
            } else if (sourceItem.type === 'battery') {
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
            
            // Add 25% safety margin
            estimatedAmps *= 1.25;
            
            // Find smallest gauge that can handle the current
            let recommendedGauge = null;
            for (const [gauge, rating] of Object.entries(this.AWG_RATINGS)) {
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
                rating: this.AWG_RATINGS[recommendedGauge]
            };
        }
    };
    
    // ============================================
    // SYSTEM REVIEW - Analysis & Optimization
    // ============================================
    
    const SystemReview = {
        settings: {
            electricityRate: 0.12,
            solarIncentive: 0.26,
            avgDailySunHours: 5.5,
            systemLifeYears: 25,
            degradationRate: 0.005
        }
    };
    
    // ResourceSystem placeholder (can be extended later)
    let ResourceSystem = null;
    let BOMSystem = null;
    
    // ============================================
    // STATE MANAGEMENT
    // ============================================
    
    let allItems = [];
    let connections = [];
    let selectedItem = null;
    let selectedConnection = null;
    let selectedPanels = []; // For multi-panel selection
    let itemIdCounter = 0;
    let connectionIdCounter = 0;
    let currentSolarMode = 'build'; // 'build' or 'live'
    let panelGridPadding = 10; // Pixels between panels when snapping to grid
    
    // Drag state
    let isDragging = false;
    let dragStartPos = { x: 0, y: 0 };
    let dragOffset = { x: 0, y: 0 };
    let tempWire = null;
    let draggingHandle = null;
    
    // D3 references
    let svg = null;
    let zoomGroup = null;
    let wiresGroup = null;
    let itemsGroup = null;
    let tempGroup = null;
    let zoomBehavior = null;
    let isInitialized = false;
    
    // Linkage Lab configuration (passed from index.html)
    let linkageConfig = null;
    
    // LiveView state
    const LiveView = {
        state: {
            active: false,
            loadStates: {},
            breakerStates: {},
            powerFlow: {}
        },
        
        // Breaker Management System
        // Power Flow Calculation System
        PowerFlow: {
            // Find all loads on a circuit by tracing from a handle
            findAllLoadsOnCircuit(traceHandle, circuitVoltage = 120) {
                const loads = [];
                const visited = new Set();
                const visitedItems = new Set();
                
                if (!traceHandle || !traceHandle.connectedTo) return loads;
                
                function traceFromHandle(handle, currentVoltage = circuitVoltage) {
                    if (!handle || !handle.connectedTo || visited.has(handle.id)) return;
                    visited.add(handle.id);
                    
                    handle.connectedTo.forEach(conn => {
                        const connObj = connections.find(c => c.id === conn.connectionId);
                        if (!connObj) return;
                        
                        // Find the item on the other end
                        const sourceItem = allItems.find(i => i.id === connObj.sourceItemId);
                        const targetItem = allItems.find(i => i.id === connObj.targetItemId);
                        
                        let nextItem = null;
                        if (sourceItem && sourceItem.handles && 
                            (connObj.sourceHandleId === handle.id || 
                             Object.values(sourceItem.handles).some(h => h.id === handle.id))) {
                            nextItem = targetItem;
                        } else if (targetItem && targetItem.handles && 
                                   (connObj.targetHandleId === handle.id ||
                                    Object.values(targetItem.handles).some(h => h.id === handle.id))) {
                            nextItem = sourceItem;
                        }
                        
                        if (!nextItem || visitedItems.has(nextItem.id)) return;
                        visitedItems.add(nextItem.id);
                        
                        // If it's an outlet, check for loads and trace through output
                        if (nextItem.type === 'acoutlet') {
                            const outletVoltage = nextItem.specs?.voltage || currentVoltage;
                            
                            // Check for loads connected to this outlet
                            if (nextItem.handles?.load) {
                                nextItem.handles.load.connectedTo.forEach(loadConn => {
                                    const loadConnObj = connections.find(c => c.id === loadConn.connectionId);
                                    if (loadConnObj) {
                                        let load = allItems.find(i => i.id === loadConnObj.targetItemId);
                                        if (!load || load.type !== 'acload') {
                                            load = allItems.find(i => i.id === loadConnObj.sourceItemId);
                                        }
                                        if (load && load.type === 'acload') {
                                            const loadVoltage = load.specs.voltage || 120;
                                            // Voltage must match (or 240V outlet can power 120V load)
                                            if (loadVoltage === outletVoltage || (outletVoltage === 240 && loadVoltage === 120)) {
                                                if (LiveView.state.loadStates[load.id] && !loads.find(l => l.id === load.id)) {
                                                    loads.push({
                                                        id: load.id,
                                                        name: load.specs.name,
                                                        watts: load.specs.watts || 0,
                                                        voltage: loadVoltage
                                                    });
                                                }
                                            }
                                        }
                                    }
                                });
                            }
                            
                            // Trace through outlet output (daisy-chained outlets)
                            if (nextItem.handles?.output) {
                                traceFromHandle(nextItem.handles.output, outletVoltage);
                            }
                        } else if (nextItem.type === 'acload') {
                            // Direct load connection
                            const loadVoltage = nextItem.specs.voltage || 120;
                            if (loadVoltage === currentVoltage || (currentVoltage === 240 && loadVoltage === 120)) {
                                if (LiveView.state.loadStates[nextItem.id] && !loads.find(l => l.id === nextItem.id)) {
                                    loads.push({
                                        id: nextItem.id,
                                        name: nextItem.specs.name,
                                        watts: nextItem.specs.watts || 0,
                                        voltage: loadVoltage
                                    });
                                }
                            }
                        }
                    });
                }
                
                traceFromHandle(traceHandle);
                return loads;
            },
            
            // Calculate AC circuit info for a breaker
            calculateACCircuit(breaker) {
                if (!breaker || !LiveView.BreakerManager.isBreakerClosed(breaker)) {
                    return { totalWatts: 0, totalAmps: 0, loads: [], voltage: 120 };
                }
                
                const circuitVoltage = breaker.specs?.voltage || 120; // Get voltage from breaker specs
                const loads = this.findAllLoadsOnCircuit(breaker.handles?.loadOut, circuitVoltage);
                
                let totalWatts = 0;
                loads.forEach(load => {
                    totalWatts += load.watts;
                });
                
                const totalAmps = circuitVoltage > 0 ? totalWatts / circuitVoltage : 0;
                
                return {
                    totalWatts: totalWatts,
                    totalAmps: totalAmps,
                    loads: loads,
                    voltage: circuitVoltage
                };
            },
            
            // Calculate DC circuit info for a DC breaker
            calculateDCCircuit(breaker) {
                if (!breaker || !LiveView.BreakerManager.isBreakerClosed(breaker)) {
                    return { totalWatts: 0, totalAmps: 0, voltage: 48 };
                }
                
                // DC circuits typically run at battery voltage
                const circuitVoltage = breaker.specs?.maxVoltage || 48;
                
                // Calculate power flow through DC breaker based on connected PV or battery
                let totalWatts = 0;
                
                // Check if connected to PV (solar) side
                if (breaker.handles?.linePositive?.connectedTo?.length > 0) {
                    // Trace to find connected panels
                    breaker.handles.linePositive.connectedTo.forEach(conn => {
                        const connObj = connections.find(c => c.id === conn.connectionId);
                        if (connObj) {
                            const sourceItem = allItems.find(i => i.id === connObj.sourceItemId);
                            const targetItem = allItems.find(i => i.id === connObj.targetItemId);
                            
                            // Check for panels
                            const panel = sourceItem?.type === 'panel' ? sourceItem : 
                                         targetItem?.type === 'panel' ? targetItem : null;
                            if (panel) {
                                totalWatts += (panel.specs.wmp || 0) * (Simulation.solarIrradiance || 1);
                            }
                            
                            // Check for combiners
                            const combiner = sourceItem?.type === 'solarcombiner' ? sourceItem :
                                            targetItem?.type === 'solarcombiner' ? targetItem : null;
                            if (combiner) {
                                // Sum all connected panel wattage through combiner
                                for (let i = 0; i < (combiner.specs?.inputs || 0); i++) {
                                    const inputHandle = combiner.handles?.[`input${i}Positive`];
                                    if (inputHandle?.connectedTo) {
                                        inputHandle.connectedTo.forEach(inputConn => {
                                            const inputConnObj = connections.find(c => c.id === inputConn.connectionId);
                                            if (inputConnObj) {
                                                const inputPanel = allItems.find(i => 
                                                    (i.id === inputConnObj.sourceItemId || i.id === inputConnObj.targetItemId) &&
                                                    i.type === 'panel'
                                                );
                                                if (inputPanel) {
                                                    totalWatts += (inputPanel.specs.wmp || 0) * (Simulation.solarIrradiance || 1);
                                                }
                                            }
                                        });
                                    }
                                }
                            }
                        }
                    });
                }
                
                const totalAmps = circuitVoltage > 0 ? totalWatts / circuitVoltage : 0;
                
                return {
                    totalWatts: totalWatts,
                    totalAmps: totalAmps,
                    voltage: circuitVoltage
                };
            },
            
            // Calculate breaker panel or spider box circuit info
            calculateBreakerPanelCircuit(panel, circuitHandle) {
                if (!panel || !circuitHandle) {
                    return { totalWatts: 0, totalAmps: 0, loads: [], voltage: 120 };
                }
                
                // Get circuit voltage from handle or panel specs
                const circuitVoltage = circuitHandle.voltage || 120;
                
                // Find all loads connected to this circuit
                const loads = this.findAllLoadsOnCircuit(circuitHandle, circuitVoltage);
                
                let totalWatts = 0;
                loads.forEach(load => {
                    totalWatts += load.watts;
                });
                
                const totalAmps = circuitVoltage > 0 ? totalWatts / circuitVoltage : 0;
                
                return {
                    totalWatts: totalWatts,
                    totalAmps: totalAmps,
                    loads: loads,
                    voltage: circuitVoltage
                };
            }
        },
        
        BreakerManager: {
            // Helper function to get breaker state from LiveView.state
            getBreakerState(breakerId) {
                return LiveView.state.breakerStates[breakerId] || null;
            },
            
            // Check if a regular AC/DC breaker is closed and not tripped
            isBreakerClosed(breaker) {
                if (!breaker) return false;
                const breakerState = LiveView.state.breakerStates[breaker.id];
                // Breaker must be closed AND not tripped
                return breaker.isClosed === true && !(breakerState && breakerState.wasTripped);
            },
            
            // Check if a breaker panel circuit is closed and not tripped
            isBreakerPanelCircuitClosed(panel, circuitIndex) {
                if (!panel) return false;
                // Check main breaker first
                if (panel.mainBreakerOn === false) return false;
                // Check circuit breaker state
                const circuitOn = panel.breakerStates && panel.breakerStates[circuitIndex] !== false;
                if (!circuitOn) return false;
                // Check if tripped in live view state
                const breakerId = `${panel.id}-circuit-${circuitIndex + 1}`;
                const breakerState = LiveView.state.breakerStates[breakerId];
                return !(breakerState && breakerState.wasTripped);
            },
            
            // Check if a spider box circuit is closed and not tripped
            isSpiderBoxCircuitClosed(spiderbox, circuitIndex) {
                if (!spiderbox || !spiderbox.handles) return false;
                // Check main breaker first
                if (spiderbox.mainBreakerOn === false) return false;
                const handleKey = `circuit${circuitIndex + 1}`;
                const circuitHandle = spiderbox.handles[handleKey];
                if (!circuitHandle) return false;
                // Check if circuit breaker is closed
                const circuitOn = circuitHandle.isClosed !== false;
                if (!circuitOn) return false;
                // Check if tripped in live view state
                const breakerId = `${spiderbox.id}-circuit-${circuitIndex + 1}`;
                const breakerState = LiveView.state.breakerStates[breakerId];
                return !(breakerState && breakerState.wasTripped);
            },
            
            // Check if a solar combiner input breaker is closed
            isSolarCombinerInputClosed(combiner, inputIndex) {
                if (!combiner) return false;
                // Check combiner breaker state array
                if (combiner.breakerStates && combiner.breakerStates[inputIndex] === false) {
                    return false;
                }
                // Check if tripped in live view state
                const breakerId = `${combiner.id}-input-${inputIndex}`;
                const breakerState = LiveView.state.breakerStates[breakerId];
                return !(breakerState && breakerState.wasTripped);
            },
            
            // Check all breakers for overload and trip them
            // Uses 3-phase approach: collect → calculate → apply (to avoid state race conditions)
            checkTripping() {
                if (!LiveView.state.active) return;
                
                // PHASE 1: Collect all breakers/circuits that need checking (before any state changes)
                const acBreakersToCheck = [];
                const acBreakers = allItems.filter(i => i.type === 'acbreaker');
                
                acBreakers.forEach(breaker => {
                    if (this.isBreakerClosed(breaker)) {
                        acBreakersToCheck.push(breaker);
                    }
                });
                
                const dcBreakersToCheck = [];
                const dcBreakers = allItems.filter(i => i.type === 'dcbreaker');
                
                dcBreakers.forEach(breaker => {
                    if (this.isBreakerClosed(breaker)) {
                        dcBreakersToCheck.push(breaker);
                    }
                });
                
                const breakerPanels = allItems.filter(i => i.type === 'breakerpanel');
                const panelCircuitsToCheck = [];
                
                breakerPanels.forEach(panel => {
                    if (panel.mainBreakerOn === false) return;
                    if (!panel.breakerStates) panel.breakerStates = Array(8).fill(true);
                    
                    for (let i = 0; i < 8; i++) {
                        const handleKey = `circuit${i + 1}`;
                        const circuitHandle = panel.handles?.[handleKey];
                        if (!circuitHandle) continue;
                        
                        if (this.isBreakerPanelCircuitClosed(panel, i)) {
                            panelCircuitsToCheck.push({
                                panel: panel,
                                index: i,
                                handle: circuitHandle,
                                breakerId: `${panel.id}-circuit-${i + 1}`
                            });
                        }
                    }
                });
                
                const spiderBoxes = allItems.filter(i => i.type === 'spiderbox');
                const spiderBoxCircuitsToCheck = [];
                
                spiderBoxes.forEach(spiderbox => {
                    if (!spiderbox.handles || !spiderbox.specs?.circuits) return;
                    if (spiderbox.mainBreakerOn === false) return;
                    
                    for (let i = 0; i < spiderbox.specs.circuits.length; i++) {
                        const handleKey = `circuit${i + 1}`;
                        const circuitHandle = spiderbox.handles[handleKey];
                        if (!circuitHandle) continue;
                        
                        if (this.isSpiderBoxCircuitClosed(spiderbox, i)) {
                            spiderBoxCircuitsToCheck.push({
                                spiderbox: spiderbox,
                                index: i,
                                handle: circuitHandle,
                                breakerId: `${spiderbox.id}-circuit-${i + 1}`
                            });
                        }
                    }
                });
                
                // PHASE 2: Calculate all circuit info (before any state changes)
                const acBreakerResults = [];
                acBreakersToCheck.forEach(breaker => {
                    const circuitInfo = LiveView.PowerFlow.calculateACCircuit(breaker);
                    const breakerRating = breaker.specs.rating || 20;
                    
                    if (circuitInfo.totalAmps > breakerRating) {
                        acBreakerResults.push({
                            breaker: breaker,
                            circuitInfo: circuitInfo,
                            breakerRating: breakerRating
                        });
                    }
                });
                
                const dcBreakerResults = [];
                dcBreakersToCheck.forEach(breaker => {
                    const circuitInfo = LiveView.PowerFlow.calculateDCCircuit(breaker);
                    const breakerRating = breaker.specs.rating || 30;
                    
                    if (circuitInfo.totalAmps > breakerRating) {
                        dcBreakerResults.push({
                            breaker: breaker,
                            circuitInfo: circuitInfo,
                            breakerRating: breakerRating
                        });
                    }
                });
                
                const panelCircuitResults = [];
                panelCircuitsToCheck.forEach(({ panel, index, handle, breakerId }) => {
                    const circuitInfo = LiveView.PowerFlow.calculateBreakerPanelCircuit(panel, handle);
                    const breakerRating = handle.maxAmps || 20;
                    
                    if (circuitInfo.totalAmps > breakerRating) {
                        panelCircuitResults.push({
                            panel: panel,
                            index: index,
                            handle: handle,
                            breakerId: breakerId,
                            circuitInfo: circuitInfo,
                            breakerRating: breakerRating
                        });
                    }
                });
                
                const spiderBoxCircuitResults = [];
                spiderBoxCircuitsToCheck.forEach(({ spiderbox, index, handle, breakerId }) => {
                    const circuitInfo = LiveView.PowerFlow.calculateBreakerPanelCircuit(spiderbox, handle);
                    const breakerRating = handle.maxAmps || spiderbox.specs?.circuits?.[index]?.amps || 20;
                    
                    if (circuitInfo.totalAmps > breakerRating) {
                        spiderBoxCircuitResults.push({
                            spiderbox: spiderbox,
                            index: index,
                            handle: handle,
                            breakerId: breakerId,
                            circuitInfo: circuitInfo,
                            breakerRating: breakerRating
                        });
                    }
                });
                
                // PHASE 3: Apply state changes (all calculations done, now apply trips)
                let anyTrips = false;
                
                // Trip AC breakers
                acBreakerResults.forEach(({ breaker, circuitInfo, breakerRating }) => {
                    anyTrips = true;
                    breaker.isClosed = false;
                    if (!LiveView.state.breakerStates[breaker.id]) {
                        LiveView.state.breakerStates[breaker.id] = { isClosed: false, wasTripped: true };
                    } else {
                        LiveView.state.breakerStates[breaker.id].isClosed = false;
                        LiveView.state.breakerStates[breaker.id].wasTripped = true;
                    }
                    
                    // Add visual failure state and effects
                    const breakerGroup = itemsGroup?.select(`[data-id="${breaker.id}"]`);
                    if (breakerGroup && !breakerGroup.empty()) {
                        breakerGroup.classed('failure-breaker-tripped', true);
                    }
                    
                    // Trigger spark effect at breaker location
                    if (typeof FailureEffects !== 'undefined') {
                        const cx = breaker.x + breaker.width / 2;
                        const cy = breaker.y + breaker.height / 2;
                        FailureEffects.createSparks(cx, cy, 6);
                    }
                    
                    // Show incident report
                    if (typeof showIncidentReport === 'function' && typeof INCIDENT_TEMPLATES !== 'undefined') {
                        showIncidentReport(INCIDENT_TEMPLATES.breakerTripped(breakerRating, circuitInfo.totalAmps, null));
                    }
                    
                    // Turn off all loads on this circuit
                    circuitInfo.loads.forEach(load => {
                        LiveView.state.loadStates[load.id] = false;
                    });
                    
                    console.log(`AC Breaker ${breaker.id} tripped: ${circuitInfo.totalAmps.toFixed(1)}A on ${breakerRating}A breaker`);
                });
                
                // Trip DC breakers
                dcBreakerResults.forEach(({ breaker, circuitInfo, breakerRating }) => {
                    anyTrips = true;
                    breaker.isClosed = false;
                    if (!LiveView.state.breakerStates[breaker.id]) {
                        LiveView.state.breakerStates[breaker.id] = { isClosed: false, wasTripped: true };
                    } else {
                        LiveView.state.breakerStates[breaker.id].isClosed = false;
                        LiveView.state.breakerStates[breaker.id].wasTripped = true;
                    }
                    
                    // Add visual failure state and effects
                    const breakerGroup = itemsGroup?.select(`[data-id="${breaker.id}"]`);
                    if (breakerGroup && !breakerGroup.empty()) {
                        breakerGroup.classed('failure-breaker-tripped', true);
                    }
                    
                    // Trigger spark effect at DC breaker location
                    if (typeof FailureEffects !== 'undefined') {
                        const cx = breaker.x + breaker.width / 2;
                        const cy = breaker.y + breaker.height / 2;
                        FailureEffects.createSparks(cx, cy, 6);
                    }
                    
                    // Show incident report
                    if (typeof showIncidentReport === 'function' && typeof INCIDENT_TEMPLATES !== 'undefined') {
                        showIncidentReport(INCIDENT_TEMPLATES.breakerTripped(breakerRating, circuitInfo.totalAmps, 'DC Circuit'));
                    }
                    
                    console.log(`DC Breaker ${breaker.id} tripped: ${circuitInfo.totalAmps.toFixed(1)}A on ${breakerRating}A breaker`);
                });
                
                // Trip breaker panel circuits
                panelCircuitResults.forEach(({ panel, index, handle, breakerId, circuitInfo, breakerRating }) => {
                    anyTrips = true;
                    panel.breakerStates[index] = false;
                    
                    if (!LiveView.state.breakerStates[breakerId]) {
                        LiveView.state.breakerStates[breakerId] = { isClosed: false, wasTripped: true };
                    } else {
                        LiveView.state.breakerStates[breakerId].isClosed = false;
                        LiveView.state.breakerStates[breakerId].wasTripped = true;
                    }
                    
                    // Add visual failure state and effects
                    const panelGroup = itemsGroup?.select(`[data-id="${panel.id}"]`);
                    if (panelGroup && !panelGroup.empty()) {
                        panelGroup.classed('failure-breaker-tripped', true);
                    }
                    
                    // Trigger spark effect at panel circuit breaker location
                    if (typeof FailureEffects !== 'undefined') {
                        // Calculate approximate position of the circuit breaker within panel
                        const cx = panel.x + (handle.x || panel.width / 2);
                        const cy = panel.y + (handle.y || panel.height / 2);
                        FailureEffects.createSparks(cx, cy, 4);
                    }
                    
                    // Show incident report
                    const circuitName = handle.circuitName || `Circuit ${index + 1}`;
                    if (typeof showIncidentReport === 'function' && typeof INCIDENT_TEMPLATES !== 'undefined') {
                        showIncidentReport(INCIDENT_TEMPLATES.breakerTripped(breakerRating, circuitInfo.totalAmps, circuitName));
                    }
                    
                    // Turn off all loads on this circuit
                    circuitInfo.loads.forEach(load => {
                        LiveView.state.loadStates[load.id] = false;
                    });
                    
                    console.log(`Panel circuit ${circuitName} tripped: ${circuitInfo.totalAmps.toFixed(1)}A on ${breakerRating}A breaker`);
                });
                
                // Trip spider box circuits
                spiderBoxCircuitResults.forEach(({ spiderbox, index, handle, breakerId, circuitInfo, breakerRating }) => {
                    anyTrips = true;
                    handle.isClosed = false;
                    
                    if (!LiveView.state.breakerStates[breakerId]) {
                        LiveView.state.breakerStates[breakerId] = { isClosed: false, wasTripped: true };
                    } else {
                        LiveView.state.breakerStates[breakerId].isClosed = false;
                        LiveView.state.breakerStates[breakerId].wasTripped = true;
                    }
                    
                    // Add visual failure state and effects
                    const spiderBoxGroup = itemsGroup?.select(`[data-id="${spiderbox.id}"]`);
                    if (spiderBoxGroup && !spiderBoxGroup.empty()) {
                        spiderBoxGroup.classed('failure-breaker-tripped', true);
                    }
                    
                    // Trigger spark effect at spider box circuit location
                    if (typeof FailureEffects !== 'undefined') {
                        const cx = spiderbox.x + (handle.x || spiderbox.width / 2);
                        const cy = spiderbox.y + (handle.y || spiderbox.height / 2);
                        FailureEffects.createSparks(cx, cy, 4);
                    }
                    
                    // Show incident report
                    const circuitName = handle.circuitName || `Circuit ${index + 1}`;
                    if (typeof showIncidentReport === 'function' && typeof INCIDENT_TEMPLATES !== 'undefined') {
                        showIncidentReport(INCIDENT_TEMPLATES.breakerTripped(breakerRating, circuitInfo.totalAmps, `Spider Box ${circuitName}`));
                    }
                    
                    // Turn off all loads on this circuit
                    circuitInfo.loads.forEach(load => {
                        LiveView.state.loadStates[load.id] = false;
                    });
                    
                    console.log(`Spider box circuit ${circuitName} tripped: ${circuitInfo.totalAmps.toFixed(1)}A on ${breakerRating}A breaker`);
                });
                
                // Schedule update if any breakers tripped
                if (anyTrips) {
                    // Invalidate cache and recalculate power flow
                    invalidatePowerFlowCache();
                    calculatePowerFlow();
                    render();
                }
            },
            
            // Turn off all loads connected to a breaker
            turnOffCircuitLoads(breaker) {
                const loads = LiveView.PowerFlow.findAllLoadsOnCircuit(breaker.handles?.loadOut);
                loads.forEach(load => {
                    LiveView.state.loadStates[load.id] = false;
                });
            },
            
            // Reset a tripped breaker (manual reset)
            resetBreaker(breakerId) {
                const breakerState = LiveView.state.breakerStates[breakerId];
                if (breakerState) {
                    breakerState.wasTripped = false;
                    breakerState.isClosed = true;
                }
                
                // Find and update the breaker item itself
                const breaker = allItems.find(i => i.id === breakerId);
                if (breaker) {
                    breaker.isClosed = true;
                    
                    // Remove visual failure state
                    const breakerGroup = itemsGroup?.select(`[data-id="${breakerId}"]`);
                    if (breakerGroup && !breakerGroup.empty()) {
                        breakerGroup.classed('failure-breaker-tripped', false);
                    }
                }
                
                // Recalculate power flow
                invalidatePowerFlowCache();
                calculatePowerFlow();
                render();
            },
            
            // Reset all tripped breakers
            resetAllBreakers() {
                // Reset all breaker states
                Object.keys(LiveView.state.breakerStates).forEach(breakerId => {
                    this.resetBreaker(breakerId);
                });
                
                // Also reset panel and spider box circuits
                allItems.filter(i => i.type === 'breakerpanel').forEach(panel => {
                    if (panel.breakerStates) {
                        panel.breakerStates = panel.breakerStates.map(() => true);
                    }
                    const panelGroup = itemsGroup?.select(`[data-id="${panel.id}"]`);
                    if (panelGroup && !panelGroup.empty()) {
                        panelGroup.classed('failure-breaker-tripped', false);
                    }
                });
                
                allItems.filter(i => i.type === 'spiderbox').forEach(spiderbox => {
                    if (spiderbox.handles) {
                        Object.keys(spiderbox.handles).forEach(key => {
                            if (key.startsWith('circuit')) {
                                spiderbox.handles[key].isClosed = true;
                            }
                        });
                    }
                    const spiderBoxGroup = itemsGroup?.select(`[data-id="${spiderbox.id}"]`);
                    if (spiderBoxGroup && !spiderBoxGroup.empty()) {
                        spiderBoxGroup.classed('failure-breaker-tripped', false);
                    }
                });
                
                // Recalculate power flow
                invalidatePowerFlowCache();
                calculatePowerFlow();
                render();
            }
        }
    };
    
    // ResourceSystem - Resource production tracking
    ResourceSystem = {
        containerLevels: {},
        
        initContainer(containerId, capacity) {
            if (this.containerLevels[containerId] === undefined) {
                this.containerLevels[containerId] = 0;
            }
        },
        
        getContainerLevel(containerId, capacity) {
            const level = this.containerLevels[containerId] || 0;
            return Math.min(1, level / capacity);
        },
        
        addToContainer(containerId, amount, capacity) {
            if (this.containerLevels[containerId] === undefined) {
                this.containerLevels[containerId] = 0;
            }
            this.containerLevels[containerId] = Math.min(capacity, this.containerLevels[containerId] + amount);
            return this.containerLevels[containerId];
        },
        
        removeFromContainer(containerId, amount) {
            if (this.containerLevels[containerId] === undefined) return 0;
            const removed = Math.min(this.containerLevels[containerId], amount);
            this.containerLevels[containerId] -= removed;
            return removed;
        },
        
        processProduction(deltaHours) {
            if (!LiveView.state.active) return;
            
            const producers = allItems.filter(i => i.type === 'producer' && LiveView.state.loadStates[i.id]);
            
            producers.forEach(producer => {
                const recipe = producer.specs.recipe;
                if (!recipe || recipe.isStorage) return;
                
                const productionAmount = recipe.rate * deltaHours;
                
                if (recipe.input) {
                    const inputContainer = this.findConnectedContainer(producer, recipe.input);
                    if (!inputContainer) return;
                    
                    const inputNeeded = productionAmount * 2;
                    const consumed = this.removeFromContainer(inputContainer.id, inputNeeded);
                    if (consumed < inputNeeded * 0.5) return;
                }
                
                const outputContainer = this.findConnectedContainer(producer, recipe.output);
                if (outputContainer) {
                    this.addToContainer(outputContainer.id, productionAmount, outputContainer.specs.capacity);
                } else if (producer.specs.tankSize) {
                    producer.internalStorage = Math.min(
                        producer.specs.tankSize,
                        (producer.internalStorage || 0) + productionAmount
                    );
                }
            });
        },
        
        findConnectedContainer(producer, resourceType) {
            const containers = allItems.filter(i => i.type === 'container' && i.specs.resource === resourceType);
            return containers[0] || null;
        },
        
        exportState() {
            return { containerLevels: { ...this.containerLevels } };
        },
        
        importState(data) {
            if (data && data.containerLevels) {
                this.containerLevels = { ...data.containerLevels };
            }
        },
        
        clearAll() {
            this.containerLevels = {};
        }
    };
    
    // ============================================
    // PHASE 3: TIME-BASED SIMULATION
    // ============================================
    
    const Simulation = {
        // Time state
        time: 12 * 60, // Minutes since midnight (start at noon)
        speed: 60,     // Simulation speed: minutes per real second
        isPlaying: false,
        lastTick: 0,
        animationFrameId: null,  // Store animation frame ID for cleanup
        
        // Location settings (default: roughly US average)
        latitude: 35,  // degrees
        dayOfYear: 172, // June 21st (summer solstice for max solar)
        
        // Battery states (keyed by item.id)
        batterySOC: {},  // State of charge (0-1)
        
        // Current calculated values
        solarIrradiance: 1.0,  // 0-1 (% of rated power)
        currentSolarWatts: 0,
        currentLoadWatts: 0,
        currentBatteryFlow: 0, // + charging, - discharging
        deratedPower: 0, // Cumulative derated power (Wh) when battery at 100%
        
        // Performance tracking
        possibleSolarInput: 0, // Theoretical max (all panels at 100% irradiance, Wh)
        actualSolarInput: 0,   // Actual captured/stored (Wh)
        efficiencyScore: 0,      // Percentage: (actual / possible) * 100
        
        // Initialize battery states
        initBatteries() {
            allItems.forEach(item => {
                if (item.type === 'battery' || item.type === 'smartbattery') {
                    if (this.batterySOC[item.id] === undefined) {
                        this.batterySOC[item.id] = 0.8; // Start at 80%
                    }
                } else if (item.type === 'controller' && item.specs.internalBatteryKWh > 0) {
                    if (this.batterySOC[item.id] === undefined) {
                        this.batterySOC[item.id] = 0.8;
                    }
                }
            });
        },
        
        // Calculate solar position from daylight slider (0-100) for 35° latitude, summer solstice
        calculateSunPositionFromDaylight(daylightPercent) {
            // For 35° latitude, summer solstice (June 21):
            // Sunrise: ~5:30 AM, Sunset: ~7:30 PM
            // Solar noon: 12:00 PM (elevation ~78°, azimuth 180°)
            const latitude = 35; // degrees
            const declination = 23.45; // Summer solstice declination
            const sunriseHour = 5.5; // 5:30 AM
            const sunsetHour = 19.5; // 7:30 PM
            const dayLength = sunsetHour - sunriseHour; // 14 hours
            
            // Map daylight slider (0-100) to time of day
            const hours = sunriseHour + (daylightPercent / 100) * dayLength;
            
            // Calculate solar elevation using solar equations
            const hourAngle = (hours - 12) * 15; // degrees (15° per hour)
            const latRad = latitude * Math.PI / 180;
            const decRad = declination * Math.PI / 180;
            const hourRad = hourAngle * Math.PI / 180;
            
            // Solar elevation angle
            const sinElevation = Math.sin(latRad) * Math.sin(decRad) + 
                                Math.cos(latRad) * Math.cos(decRad) * Math.cos(hourRad);
            const elevation = Math.asin(Math.max(-1, Math.min(1, sinElevation))) * 180 / Math.PI;
            
            // Solar azimuth angle (0° = North, 90° = East, 180° = South, 270° = West)
            const cosAzimuth = (Math.sin(decRad) - Math.sin(latRad) * sinElevation) / 
                              (Math.cos(latRad) * Math.cos(Math.asin(sinElevation)));
            let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAzimuth))) * 180 / Math.PI;
            if (hourAngle > 0) azimuth = 360 - azimuth; // Afternoon: azimuth > 180°
            
            return { elevation: Math.max(0, elevation), azimuth, hours };
        },
        
        // Calculate solar irradiance based on time of day (or daylight slider)
        calculateSolarIrradiance() {
            // Check if daylight slider is being used
            const daylightSlider = document.getElementById('sl-daylight');
            let hours = this.time / 60;
            
            if (daylightSlider && daylightSlider.value !== undefined) {
                // Use daylight slider value (0-100)
                const daylightPercent = parseFloat(daylightSlider.value);
                const sunPos = this.calculateSunPositionFromDaylight(daylightPercent);
                hours = sunPos.hours;
                
                // Update simulation time to match slider
                this.time = hours * 60;
            }
            
            // Simple sinusoidal model for solar irradiance
            // Peak at solar noon (12:00), zero before sunrise and after sunset
            const sunrise = 5.5;  // 5:30 AM (for 35° latitude, summer solstice)
            const sunset = 19.5;  // 7:30 PM
            
            if (hours < sunrise || hours > sunset) {
                return 0;
            }
            
            // Sinusoidal curve from sunrise to sunset
            const dayLength = sunset - sunrise;
            const hoursSinceSunrise = hours - sunrise;
            const normalizedTime = hoursSinceSunrise / dayLength;
            
            // Sin curve peaks at 0.5 (solar noon)
            const baseIrradiance = Math.sin(normalizedTime * Math.PI);
            
            // Apply atmospheric effects (clearer at noon, hazier at dawn/dusk)
            const atmosphericFactor = 0.7 + 0.3 * baseIrradiance;
            
            return Math.max(0, baseIrradiance * atmosphericFactor);
        },
        
        // Calculate actual solar power output
        calculateSolarOutput() {
            this.solarIrradiance = this.calculateSolarIrradiance();
            
            let totalSolarWatts = 0;
            const panels = allItems.filter(i => i.type === 'panel');
            
            panels.forEach(panel => {
                // Check if panel is connected to something
                const hasConnection = panel.handles.positive?.connectedTo.length > 0 ||
                                     panel.handles.negative?.connectedTo.length > 0;
                if (hasConnection) {
                    totalSolarWatts += (panel.specs.wmp || 0) * this.solarIrradiance;
                }
            });
            
            this.currentSolarWatts = totalSolarWatts;
            return totalSolarWatts;
        },
        
        // Calculate current load consumption
        calculateLoadConsumption() {
            let totalLoadWatts = 0;
            
            allItems.filter(i => i.type === 'acload').forEach(load => {
                if (LiveView.state.loadStates[load.id]) {
                    totalLoadWatts += load.specs.watts || 0;
                }
            });
            
            this.currentLoadWatts = totalLoadWatts;
            return totalLoadWatts;
        },
        
        // Get total battery capacity in Wh
        getTotalBatteryCapacityWh() {
            let totalWh = 0;
            
            allItems.forEach(item => {
                if (item.type === 'battery') {
                    totalWh += (item.specs.kWh || 0) * 1000;
                } else if (item.type === 'smartbattery') {
                    totalWh += (item.specs.kWh || 0) * 1000;
                } else if (item.type === 'controller' && item.specs.internalBatteryKWh > 0) {
                    totalWh += item.specs.internalBatteryKWh * 1000;
                }
            });
            
            return totalWh;
        },
        
        // Get current stored energy in Wh
        getCurrentStoredWh() {
            let storedWh = 0;
            
            allItems.forEach(item => {
                const soc = this.batterySOC[item.id];
                if (soc === undefined) return;
                
                if (item.type === 'battery') {
                    storedWh += (item.specs.kWh || 0) * 1000 * soc;
                } else if (item.type === 'smartbattery') {
                    storedWh += (item.specs.kWh || 0) * 1000 * soc;
                } else if (item.type === 'controller' && item.specs.internalBatteryKWh > 0) {
                    storedWh += item.specs.internalBatteryKWh * 1000 * soc;
                }
            });
            
            return storedWh;
        },
        
        // Get average battery SOC
        getAverageSOC() {
            const capacities = [];
            
            allItems.forEach(item => {
                const soc = this.batterySOC[item.id];
                if (soc === undefined) return;
                
                let capacityWh = 0;
                if (item.type === 'battery') {
                    capacityWh = (item.specs.kWh || 0) * 1000;
                } else if (item.type === 'smartbattery') {
                    capacityWh = (item.specs.kWh || 0) * 1000;
                } else if (item.type === 'controller' && item.specs.internalBatteryKWh > 0) {
                    capacityWh = item.specs.internalBatteryKWh * 1000;
                }
                
                if (capacityWh > 0) {
                    capacities.push({ soc, capacityWh });
                }
            });
            
            if (capacities.length === 0) return 0;
            
            // Weighted average by capacity
            const totalCapacity = capacities.reduce((sum, c) => sum + c.capacityWh, 0);
            const weightedSOC = capacities.reduce((sum, c) => sum + c.soc * c.capacityWh, 0);
            
            return totalCapacity > 0 ? weightedSOC / totalCapacity : 0;
        },
        
        // Simulation tick - called every frame when playing
        tick(deltaSeconds) {
            if (!this.isPlaying || !LiveView.state.active) return;
            
            // Advance simulation time
            const deltaMinutes = deltaSeconds * this.speed;
            this.time += deltaMinutes;
            
            // Wrap around at midnight
            if (this.time >= 24 * 60) {
                this.time -= 24 * 60;
            }
            
            // Calculate solar output and load consumption
            let solarWatts = this.calculateSolarOutput();
            const loadWatts = this.calculateLoadConsumption();
            
            // Track possible solar input (theoretical max at current irradiance)
            const panels = allItems.filter(i => i.type === 'panel');
            const possibleWatts = panels.reduce((sum, panel) => {
                const hasConnection = panel.handles.positive?.connectedTo.length > 0 ||
                                     panel.handles.negative?.connectedTo.length > 0;
                return hasConnection ? sum + (panel.specs.wmp || 0) * this.solarIrradiance : sum;
            }, 0);
            this.possibleSolarInput += possibleWatts * (deltaMinutes / 60); // Convert to Wh
            
            // Battery float/derating logic: if battery at 100% and loads insufficient, derate solar
            // This models realistic "float" behavior when battery is fully charged
            const maxBatterySOC = this.getAverageSOC();
            const isBatteryFull = maxBatterySOC >= 0.999; // 99.9% or higher (essentially 100%)
            
            if (isBatteryFull && solarWatts > loadWatts) {
                // Derate solar output to match load demand only (float behavior)
                // When battery is full, excess solar is wasted/curtailed
                const originalSolarWatts = solarWatts;
                solarWatts = loadWatts; // Match load exactly, no excess charging
                
                // Track derated power for statistics
                const deratedWatts = originalSolarWatts - solarWatts;
                if (!this.deratedPower) this.deratedPower = 0;
                this.deratedPower += deratedWatts * (deltaMinutes / 60); // Convert to Wh
            }
            
            // Update currentSolarWatts to reflect any derating
            this.currentSolarWatts = solarWatts;
            
            // Net power (positive = excess going to battery, negative = deficit from battery)
            // After derating, if battery is full, netWatts should be 0 or negative
            const netWatts = solarWatts - loadWatts;
            this.currentBatteryFlow = netWatts;
            
            // Track actual solar input (what's actually used: load consumption + battery charging)
            // Only count when solar is available and being used
            if (solarWatts > 0) {
                // Actual = load consumption + battery charging (if any)
                const actualWatts = loadWatts + Math.max(0, netWatts);
                this.actualSolarInput += actualWatts * (deltaMinutes / 60); // Convert to Wh
            }
            
            // Calculate efficiency score
            if (this.possibleSolarInput > 0) {
                this.efficiencyScore = (this.actualSolarInput / this.possibleSolarInput) * 100;
            } else {
                this.efficiencyScore = 0;
            }
            
            // Update battery states
            const totalCapacityWh = this.getTotalBatteryCapacityWh();
            if (totalCapacityWh > 0) {
                // Convert power to energy for this time step
                const deltaHours = deltaMinutes / 60;
                const deltaWh = netWatts * deltaHours;
                
                // Distribute charge/discharge across all batteries proportionally
                allItems.forEach(item => {
                    if (this.batterySOC[item.id] === undefined) return;
                    
                    let capacityWh = 0;
                    if (item.type === 'battery') {
                        capacityWh = (item.specs.kWh || 0) * 1000;
                    } else if (item.type === 'smartbattery') {
                        capacityWh = (item.specs.kWh || 0) * 1000;
                    } else if (item.type === 'controller' && item.specs.internalBatteryKWh > 0) {
                        capacityWh = item.specs.internalBatteryKWh * 1000;
                    }
                    
                    if (capacityWh > 0) {
                        const proportion = capacityWh / totalCapacityWh;
                        const batteryDeltaWh = deltaWh * proportion;
                        const deltaSOC = batteryDeltaWh / capacityWh;
                        
                        // Apply charge/discharge with limits
                        this.batterySOC[item.id] = Math.max(0.05, Math.min(1.0, this.batterySOC[item.id] + deltaSOC));
                    }
                });
            }
            
            // Recalculate power flow and check breaker tripping
            calculatePowerFlow();
            
            // Update displays
            this.updateTimeDisplay();
            this.updateSimulationStats();
            this.updateBackgroundColor();
            
            // Evaluate automations
            Automations.evaluate();
            
            // Process resource production
            ResourceSystem.processProduction(deltaSeconds / 3600); // Convert seconds to hours
            
            // Re-render components periodically (throttled for performance)
            // Reduced from 10 to 30 frames to prevent memory issues
            this.renderCounter = (this.renderCounter || 0) + 1;
            if (this.renderCounter >= 30) { // Every ~30 frames (~0.5 seconds at 60fps)
                this.renderCounter = 0;
                render();
            }
        },
        
        // Format time for display
        formatTime() {
            const hours = Math.floor(this.time / 60);
            const minutes = Math.floor(this.time % 60);
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours % 12 || 12;
            return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
        },
        
        // Update time display in UI (both sidebar and topbar)
        updateTimeDisplay() {
            const timeEls = [
                document.getElementById('sim-time-display'),
                document.getElementById('sim-time-display-top'),
                document.getElementById('topbar-sim-time')
            ];
            const formattedTime = this.formatTime();
            timeEls.forEach(el => {
                if (el) el.textContent = formattedTime;
            });
            
            // Update daylight sliders and time displays (sidebar and topbar)
            const daylightSliders = [
                document.getElementById('sl-daylight'),
                document.getElementById('sl-daylight-top')
            ];
            const daylightTimeDisplays = [
                document.getElementById('daylight-time-display'),
                document.getElementById('daylight-time-display-top')
            ];
            
            const hours = this.time / 60;
            const sunrise = 5.5;
            const sunset = 19.5;
            const dayLength = sunset - sunrise;
            let daylightPercent = 50;
            
            if (hours >= sunrise && hours <= sunset) {
                daylightPercent = ((hours - sunrise) / dayLength) * 100;
            } else if (hours < sunrise) {
                daylightPercent = 0;
            } else {
                daylightPercent = 100;
            }
            
            daylightSliders.forEach(slider => {
                if (slider) slider.value = daylightPercent;
            });
            
            const h = Math.floor(hours);
            const m = Math.floor((hours - h) * 60);
            const ampm = h >= 12 ? 'PM' : 'AM';
            const displayHours = h % 12 || 12;
            const timeText = `${displayHours}:${m.toString().padStart(2, '0')} ${ampm}`;
            
            daylightTimeDisplays.forEach(display => {
                if (display) display.textContent = timeText;
            });
            
            // Update sun position indicator
            const sunEl = document.getElementById('sim-sun-indicator');
            if (sunEl) {
                const hours = this.time / 60;
                const sunProgress = Math.max(0, Math.min(1, (hours - 5.5) / 14)); // 5:30am to 7:30pm
                sunEl.style.left = `${sunProgress * 100}%`;
                sunEl.style.opacity = this.solarIrradiance > 0 ? 1 : 0.3;
            }
        },
        
        // Update simulation stats display (sidebar and live panel)
        updateSimulationStats() {
            const solarEl = document.getElementById('sim-solar-output');
            const loadEl = document.getElementById('sim-load-draw');
            const flowEl = document.getElementById('sim-battery-flow');
            const socEl = document.getElementById('sim-battery-soc');
            const irradianceEl = document.getElementById('sim-irradiance');
            
            // Live stats panel elements (topbar panel)
            const liveSolarEl = document.getElementById('live-solar-output') || document.getElementById('live-solar-watts');
            const liveLoadEl = document.getElementById('live-load-draw') || document.getElementById('live-load-watts');
            const liveBatteryEl = document.getElementById('live-battery-flow');
            const liveIrradianceEl = document.getElementById('live-irradiance');
            const liveSocEl = document.getElementById('live-battery-soc');
            const liveLoadCountEl = document.getElementById('live-load-count');
            
            const solarWatts = Math.round(this.currentSolarWatts);
            const loadWatts = Math.round(this.currentLoadWatts);
            const flow = Math.round(this.currentBatteryFlow);
            const soc = Math.round(this.getAverageSOC() * 100);
            const irradiance = Math.round(this.solarIrradiance * 100);
            
            // Update sidebar stats
            if (solarEl) {
                solarEl.textContent = `${solarWatts} W`;
                solarEl.style.color = solarWatts > 0 ? '#f0ad4e' : '#666';
            }
            
            if (loadEl) {
                loadEl.textContent = `${loadWatts} W`;
                loadEl.style.color = loadWatts > 0 ? '#d9534f' : '#666';
            }
            
            if (flowEl) {
                if (flow > 0) {
                    flowEl.textContent = `+${flow} W`;
                    flowEl.style.color = '#5cb85c';
                } else if (flow < 0) {
                    flowEl.textContent = `${flow} W`;
                    flowEl.style.color = '#d9534f';
                } else {
                    flowEl.textContent = '0 W';
                    flowEl.style.color = '#666';
                }
            }
            
            if (socEl) {
                socEl.textContent = `${soc}%`;
                if (soc < 20) {
                    socEl.style.color = '#d9534f';
                } else if (soc < 50) {
                    socEl.style.color = '#f0ad4e';
                } else {
                    socEl.style.color = '#5cb85c';
                }
            }
            
            if (irradianceEl) {
                irradianceEl.textContent = `${irradiance}%`;
            }
            
            // Update live stats panel
            if (liveSolarEl) {
                liveSolarEl.textContent = `${solarWatts} W`;
            }
            if (liveIrradianceEl) {
                liveIrradianceEl.textContent = `${irradiance}% irradiance`;
            }
            if (liveLoadEl) {
                liveLoadEl.textContent = `${loadWatts} W`;
            }
            if (liveLoadCountEl) {
                const activeLoads = allItems.filter(i => i.type === 'acload' && LiveView.state.loadStates[i.id]).length;
                liveLoadCountEl.textContent = `${activeLoads} loads active`;
            }
            if (liveBatteryEl) {
                if (flow > 0) {
                    liveBatteryEl.textContent = `+${flow} W`;
                    liveBatteryEl.className = 'live-stat-value charging';
                } else if (flow < 0) {
                    liveBatteryEl.textContent = `${Math.abs(flow)} W`;
                    liveBatteryEl.className = 'live-stat-value discharging';
                } else {
                    liveBatteryEl.textContent = 'Idle';
                    liveBatteryEl.className = 'live-stat-value';
                }
            }
            if (liveSocEl) {
                liveSocEl.textContent = `${soc}%`;
                if (soc < 20) {
                    liveSocEl.className = 'live-stat-value discharging';
                } else if (soc >= 80) {
                    liveSocEl.className = 'live-stat-value charging';
                } else {
                    liveSocEl.className = 'live-stat-value';
                }
            }
            
            // Update efficiency score display (possible vs actual solar)
            const efficiencyEl = document.getElementById('live-efficiency-score');
            if (efficiencyEl) {
                const efficiency = this.possibleSolarInput > 0 
                    ? (this.actualSolarInput / this.possibleSolarInput * 100).toFixed(1)
                    : '0.0';
                efficiencyEl.textContent = `${efficiency}%`;
                // Color code: green >= 80%, yellow >= 60%, red < 60%
                const effValue = parseFloat(efficiency);
                if (effValue >= 80) {
                    efficiencyEl.className = 'live-stat-value charging';
                } else if (effValue >= 60) {
                    efficiencyEl.className = 'live-stat-value';
                    efficiencyEl.style.color = '#f0ad4e';
                } else {
                    efficiencyEl.className = 'live-stat-value discharging';
                }
            }
            
            // Update possible vs actual solar display
            const possibleEl = document.getElementById('live-possible-solar');
            const actualEl = document.getElementById('live-actual-solar');
            if (possibleEl) {
                const possibleKwh = (this.possibleSolarInput / 1000).toFixed(2);
                possibleEl.textContent = `Possible: ${possibleKwh} kWh`;
            }
            if (actualEl) {
                const actualKwh = (this.actualSolarInput / 1000).toFixed(2);
                actualEl.textContent = `Actual: ${actualKwh} kWh`;
            }
        },
        
        // Start simulation
        play() {
            if (this.isPlaying) return; // Prevent multiple loops
            
            // Cancel any existing animation frame
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }
            
            this.isPlaying = true;
            this.lastTick = performance.now();
            
            this.initBatteries();
            
            // Start animation loop using stored reference
            this._animate();
            
            // Update button states (both sidebar and topbar)
            const playBtns = [document.getElementById('btn-sim-play'), document.getElementById('btn-sim-play-top')];
            const pauseBtns = [document.getElementById('btn-sim-pause'), document.getElementById('btn-sim-pause-top')];
            playBtns.forEach(btn => { if (btn) btn.classList.add('active'); });
            pauseBtns.forEach(btn => { if (btn) btn.classList.remove('active'); });
        },
        
        // Animation loop function (defined once, not recreated)
        _animate() {
            if (!this.isPlaying) {
                this.animationFrameId = null;
                return;
            }
            
            const now = performance.now();
            const deltaSeconds = (now - this.lastTick) / 1000;
            this.lastTick = now;
            
            this.tick(deltaSeconds);
            
            // Schedule next frame and store ID
            this.animationFrameId = requestAnimationFrame(() => this._animate());
        },
        
        // Pause simulation
        pause() {
            this.isPlaying = false;
            
            // Cancel animation frame to stop the loop
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }
            
            const playBtns = [document.getElementById('btn-sim-play'), document.getElementById('btn-sim-play-top')];
            const pauseBtns = [document.getElementById('btn-sim-pause'), document.getElementById('btn-sim-pause-top')];
            playBtns.forEach(btn => { if (btn) btn.classList.remove('active'); });
            pauseBtns.forEach(btn => { if (btn) btn.classList.add('active'); });
        },
        
        // Set time directly
        setTime(minutes) {
            this.time = Math.max(0, Math.min(24 * 60 - 1, minutes));
            this.calculateSolarOutput();
            this.updateTimeDisplay();
            this.updateSimulationStats();
        },
        
        // Set simulation speed
        setSpeed(speed) {
            this.speed = speed;
            const speedEls = [
                document.getElementById('sim-speed-display'),
                document.getElementById('sim-speed-display-top')
            ];
            const speedText = speed >= 60 ? `${speed / 60}h/s` : `${speed}m/s`;
            speedEls.forEach(el => {
                if (el) el.textContent = speedText;
            });
        },
        
        // Reset simulation
        reset() {
            this.pause();
            this.time = 12 * 60; // Reset to noon
            this.batterySOC = {};
            this.initBatteries();
            this.calculateSolarOutput();
            this.updateTimeDisplay();
            this.updateSimulationStats();
            this.updateBackgroundColor();
            render();
        },
        
        // Update canvas background based on time of day
        updateBackgroundColor() {
            const container = document.getElementById('solar-canvas-container');
            if (!container || !LiveView.state.active) return;
            
            const hours = this.time / 60;
            
            // Define sky colors throughout the day
            let bgColor, gridColor;
            
            if (hours < 5 || hours > 21) {
                // Night (dark blue)
                bgColor = '#0a1520';
                gridColor = 'rgba(100, 150, 200, 0.03)';
            } else if (hours < 6) {
                // Dawn (dark to twilight)
                const t = (hours - 5);
                bgColor = `rgb(${10 + t * 20}, ${21 + t * 20}, ${32 + t * 30})`;
                gridColor = 'rgba(150, 180, 200, 0.04)';
            } else if (hours < 7) {
                // Sunrise (twilight to warm)
                const t = hours - 6;
                bgColor = `rgb(${30 + t * 30}, ${41 + t * 30}, ${62 + t * 20})`;
                gridColor = 'rgba(200, 180, 150, 0.05)';
            } else if (hours < 18) {
                // Day (bright blue-gray)
                const noon = Math.abs(hours - 12) / 5;
                const brightness = 1 - noon * 0.2;
                bgColor = `rgb(${Math.round(26 * brightness + 20)}, ${Math.round(43 * brightness + 20)}, ${Math.round(60 * brightness + 20)})`;
                gridColor = 'rgba(240, 173, 78, 0.04)';
            } else if (hours < 19) {
                // Sunset (warm to twilight)
                const t = hours - 18;
                bgColor = `rgb(${60 - t * 30}, ${63 - t * 22}, ${80 - t * 18})`;
                gridColor = 'rgba(240, 173, 78, 0.05)';
            } else if (hours < 20) {
                // Dusk (twilight to dark)
                const t = hours - 19;
                bgColor = `rgb(${30 - t * 15}, ${41 - t * 15}, ${62 - t * 25})`;
                gridColor = 'rgba(150, 150, 200, 0.04)';
            } else {
                // Late evening
                const t = hours - 20;
                bgColor = `rgb(${15 - t * 5}, ${26 - t * 5}, ${37 - t * 17})`;
                gridColor = 'rgba(100, 150, 200, 0.03)';
            }
            
            container.style.backgroundColor = bgColor;
            container.style.backgroundImage = `
                linear-gradient(${gridColor} 1px, transparent 1px),
                linear-gradient(90deg, ${gridColor} 1px, transparent 1px)
            `;
            
            // Add/update celestial objects (sun, moon, stars)
            this.updateCelestialObjects(hours);
        },
        
        // Add/update celestial objects overlay
        updateCelestialObjects(hours) {
            const container = document.getElementById('solar-canvas-container');
            if (!container) return;
            
            // Only update when hour changes significantly (reduce DOM updates)
            const hourKey = Math.floor(hours * 2); // Update every 30 minutes
            if (this._lastCelestialUpdate === hourKey) return;
            this._lastCelestialUpdate = hourKey;
            
            // Create or get celestial overlay
            let overlay = document.getElementById('celestial-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'celestial-overlay';
                overlay.style.cssText = `
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    pointer-events: none;
                    overflow: hidden;
                    z-index: 1;
                `;
                container.appendChild(overlay);
            }
            
            // Clear previous celestials (reuse container instead of innerHTML)
            while (overlay.firstChild) {
                overlay.removeChild(overlay.firstChild);
            }
            
            const isNight = hours < 6 || hours > 19;
            const isDawn = hours >= 5 && hours < 7;
            const isDusk = hours >= 18 && hours < 20;
            const isDay = hours >= 7 && hours < 18;
            
            // Calculate sun/moon position (arc across sky)
            // Sun: 6am (left) -> 12pm (top) -> 6pm (right)
            // Moon: 6pm (left) -> 12am (top) -> 6am (right)
            
            if (isDay || isDawn) {
                // Show sun
                const sunProgress = (hours - 6) / 12; // 0 at 6am, 1 at 6pm
                const sunX = 10 + sunProgress * 80; // 10% to 90%
                const sunY = 10 + Math.sin(sunProgress * Math.PI) * -40 + 40; // Arc from 50% to 10% back to 50%
                
                const sunSize = isDawn ? 40 + (hours - 5) * 10 : 60;
                const sunOpacity = isDawn ? 0.3 + (hours - 5) * 0.4 : 1;
                
                const sun = document.createElement('div');
                sun.style.cssText = `
                    position: absolute;
                    left: ${sunX}%;
                    top: ${sunY}%;
                    width: ${sunSize}px;
                    height: ${sunSize}px;
                    background: radial-gradient(circle, #FFD700 0%, #FFA500 40%, transparent 70%);
                    border-radius: 50%;
                    opacity: ${sunOpacity};
                    box-shadow: 0 0 ${sunSize}px ${sunSize/2}px rgba(255, 215, 0, 0.3);
                    transition: all 1s ease;
                `;
                overlay.appendChild(sun);
            }
            
            if (isNight || isDusk) {
                // Show moon
                const moonProgress = hours < 12 ? (hours + 6) / 12 : (hours - 18) / 12;
                const moonX = 10 + moonProgress * 80;
                const moonY = 10 + Math.sin(moonProgress * Math.PI) * -30 + 30;
                
                const moonSize = isDusk ? 30 + (20 - hours) * 5 : 40;
                const moonOpacity = isDusk ? 0.3 + (20 - hours) * 0.35 : 0.8;
                
                const moon = document.createElement('div');
                moon.style.cssText = `
                    position: absolute;
                    left: ${moonX}%;
                    top: ${moonY}%;
                    width: ${moonSize}px;
                    height: ${moonSize}px;
                    background: radial-gradient(circle at 30% 30%, #FFF 0%, #E0E0E0 50%, #A0A0A0 100%);
                    border-radius: 50%;
                    opacity: ${moonOpacity};
                    box-shadow: 0 0 ${moonSize}px ${moonSize/3}px rgba(255, 255, 255, 0.2);
                    transition: all 1s ease;
                `;
                overlay.appendChild(moon);
            }
            
            // Show stars at night
            if (isNight) {
                const starCount = 50;
                const starsContainer = document.createElement('div');
                starsContainer.style.cssText = `
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                `;
                
                for (let i = 0; i < starCount; i++) {
                    const star = document.createElement('div');
                    const x = Math.random() * 100;
                    const y = Math.random() * 60; // Top 60% of screen
                    const size = 1 + Math.random() * 2;
                    const opacity = 0.3 + Math.random() * 0.7;
                    const twinkleDelay = Math.random() * 3;
                    
                    star.style.cssText = `
                        position: absolute;
                        left: ${x}%;
                        top: ${y}%;
                        width: ${size}px;
                        height: ${size}px;
                        background: white;
                        border-radius: 50%;
                        opacity: ${opacity};
                        box-shadow: 0 0 ${size * 2}px ${size}px rgba(255, 255, 255, 0.5);
                        animation: twinkle ${2 + Math.random() * 2}s ease-in-out ${twinkleDelay}s infinite;
                    `;
                    starsContainer.appendChild(star);
                }
                
                overlay.appendChild(starsContainer);
                
                // Add twinkle animation if not exists
                if (!document.getElementById('star-twinkle-style')) {
                    const style = document.createElement('style');
                    style.id = 'star-twinkle-style';
                    style.textContent = `
                        @keyframes twinkle {
                            0%, 100% { opacity: 0.3; }
                            50% { opacity: 1; }
                        }
                    `;
                    document.head.appendChild(style);
                }
            }
        }
    };
    
    // ============================================
    // PHASE 5: AUTOMATIONS SYSTEM
    // ============================================
    
    const Automations = {
        rules: [],
        ruleIdCounter: 0,
        lastTriggerTime: {}, // Track last trigger to prevent spam
        
        // Trigger types
        TRIGGER_TYPES: {
            TIME: 'time',           // Trigger at specific time
            TIME_RANGE: 'time_range', // Trigger during time range
            BATTERY_BELOW: 'battery_below',
            BATTERY_ABOVE: 'battery_above',
            SOLAR_ABOVE: 'solar_above',
            SOLAR_BELOW: 'solar_below',
            SUNRISE: 'sunrise',
            SUNSET: 'sunset'
        },
        
        // Action types
        ACTION_TYPES: {
            TURN_ON: 'turn_on',
            TURN_OFF: 'turn_off',
            TOGGLE: 'toggle'
        },
        
        // Create a new automation rule
        createRule(name, trigger, action) {
            const rule = {
                id: `auto-${++this.ruleIdCounter}`,
                name: name || 'Unnamed Rule',
                enabled: true,
                trigger: {
                    type: trigger.type,
                    value: trigger.value,       // Primary value (time, percentage, watts)
                    value2: trigger.value2,     // Secondary value (for ranges)
                    ...trigger
                },
                action: {
                    type: action.type,
                    targetIds: action.targetIds || [], // Array of item IDs to affect
                    targetType: action.targetType || 'acload' // Type of items to target
                },
                lastTriggered: null
            };
            this.rules.push(rule);
            return rule;
        },
        
        // Delete a rule
        deleteRule(ruleId) {
            const idx = this.rules.findIndex(r => r.id === ruleId);
            if (idx !== -1) {
                this.rules.splice(idx, 1);
                return true;
            }
            return false;
        },
        
        // Toggle rule enabled state
        toggleRule(ruleId) {
            const rule = this.rules.find(r => r.id === ruleId);
            if (rule) {
                rule.enabled = !rule.enabled;
                return rule.enabled;
            }
            return null;
        },
        
        // Check if a trigger condition is met
        checkTrigger(rule) {
            const t = rule.trigger;
            const hours = Simulation.time / 60;
            const soc = Simulation.getAverageSOC() * 100;
            const solarWatts = Simulation.currentSolarWatts;
            
            switch (t.type) {
                case this.TRIGGER_TYPES.TIME:
                    // Trigger at specific time (within 2 minute window)
                    const targetMinutes = t.value;
                    const currentMinutes = Simulation.time;
                    return Math.abs(currentMinutes - targetMinutes) < 2;
                    
                case this.TRIGGER_TYPES.TIME_RANGE:
                    // Trigger during time range
                    const startMinutes = t.value;
                    const endMinutes = t.value2;
                    if (startMinutes < endMinutes) {
                        return Simulation.time >= startMinutes && Simulation.time < endMinutes;
                    } else {
                        // Wraps around midnight
                        return Simulation.time >= startMinutes || Simulation.time < endMinutes;
                    }
                    
                case this.TRIGGER_TYPES.BATTERY_BELOW:
                    return soc < t.value;
                    
                case this.TRIGGER_TYPES.BATTERY_ABOVE:
                    return soc > t.value;
                    
                case this.TRIGGER_TYPES.SOLAR_ABOVE:
                    return solarWatts > t.value;
                    
                case this.TRIGGER_TYPES.SOLAR_BELOW:
                    return solarWatts < t.value;
                    
                case this.TRIGGER_TYPES.SUNRISE:
                    // Trigger around 6 AM (within 10 minute window)
                    return hours >= 5.83 && hours < 6.17;
                    
                case this.TRIGGER_TYPES.SUNSET:
                    // Trigger around 6 PM (within 10 minute window)
                    return hours >= 17.83 && hours < 18.17;
                    
                default:
                    return false;
            }
        },
        
        // Execute an action
        executeAction(rule) {
            const action = rule.action;
            let affectedItems = [];
            
            // Get target items
            if (action.targetIds && action.targetIds.length > 0) {
                affectedItems = allItems.filter(i => action.targetIds.includes(i.id));
            } else if (action.targetType) {
                affectedItems = allItems.filter(i => i.type === action.targetType);
            }
            
            affectedItems.forEach(item => {
                if (item.type === 'acload') {
                    switch (action.type) {
                        case this.ACTION_TYPES.TURN_ON:
                            LiveView.state.loadStates[item.id] = true;
                            break;
                        case this.ACTION_TYPES.TURN_OFF:
                            LiveView.state.loadStates[item.id] = false;
                            break;
                        case this.ACTION_TYPES.TOGGLE:
                            LiveView.state.loadStates[item.id] = !LiveView.state.loadStates[item.id];
                            break;
                    }
                } else if (item.type === 'acbreaker' || item.type === 'dcbreaker') {
                    switch (action.type) {
                        case this.ACTION_TYPES.TURN_ON:
                            item.isClosed = true;
                            break;
                        case this.ACTION_TYPES.TURN_OFF:
                            item.isClosed = false;
                            break;
                        case this.ACTION_TYPES.TOGGLE:
                            item.isClosed = !item.isClosed;
                            break;
                    }
                }
            });
            
            return affectedItems.length;
        },
        
        // Evaluate all rules (called from simulation tick)
        evaluate() {
            if (!LiveView.state.active || !Simulation.isPlaying) return;
            
            const now = Simulation.time;
            
            this.rules.forEach(rule => {
                if (!rule.enabled) return;
                
                const triggered = this.checkTrigger(rule);
                const lastTrigger = this.lastTriggerTime[rule.id] || 0;
                const timeSinceLastTrigger = Math.abs(now - lastTrigger);
                
                // Prevent re-triggering within 5 simulation minutes
                if (triggered && timeSinceLastTrigger > 5) {
                    const affected = this.executeAction(rule);
                    if (affected > 0) {
                        rule.lastTriggered = now;
                        this.lastTriggerTime[rule.id] = now;
                        this.showTriggerNotification(rule, affected);
                    }
                }
            });
        },
        
        // Show notification when automation triggers
        showTriggerNotification(rule, affectedCount) {
            const actionText = rule.action.type === 'turn_on' ? 'ON' : 
                              rule.action.type === 'turn_off' ? 'OFF' : 'toggled';
            showToast(`⚡ ${rule.name}: ${affectedCount} device(s) ${actionText}`, 'info');
        },
        
        // Get trigger description for UI
        getTriggerDescription(trigger) {
            switch (trigger.type) {
                case this.TRIGGER_TYPES.TIME:
                    return `At ${this.formatTime(trigger.value)}`;
                case this.TRIGGER_TYPES.TIME_RANGE:
                    return `${this.formatTime(trigger.value)} - ${this.formatTime(trigger.value2)}`;
                case this.TRIGGER_TYPES.BATTERY_BELOW:
                    return `Battery < ${trigger.value}%`;
                case this.TRIGGER_TYPES.BATTERY_ABOVE:
                    return `Battery > ${trigger.value}%`;
                case this.TRIGGER_TYPES.SOLAR_ABOVE:
                    return `Solar > ${trigger.value}W`;
                case this.TRIGGER_TYPES.SOLAR_BELOW:
                    return `Solar < ${trigger.value}W`;
                case this.TRIGGER_TYPES.SUNRISE:
                    return 'At Sunrise';
                case this.TRIGGER_TYPES.SUNSET:
                    return 'At Sunset';
                default:
                    return 'Unknown trigger';
            }
        },
        
        // Format time from minutes
        formatTime(minutes) {
            const hours = Math.floor(minutes / 60);
            const mins = Math.floor(minutes % 60);
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours % 12 || 12;
            return `${displayHours}:${mins.toString().padStart(2, '0')} ${ampm}`;
        },
        
        // Get action description for UI
        getActionDescription(action) {
            const typeText = action.type === 'turn_on' ? 'Turn ON' :
                           action.type === 'turn_off' ? 'Turn OFF' : 'Toggle';
            if (action.targetIds && action.targetIds.length > 0) {
                return `${typeText} ${action.targetIds.length} item(s)`;
            }
            return `${typeText} all ${action.targetType}s`;
        },
        
        // Preset automation templates
        presets: [
            {
                name: 'Night Lights',
                description: 'Turn on lights at sunset',
                trigger: { type: 'sunset' },
                action: { type: 'turn_on', targetType: 'acload' }
            },
            {
                name: 'Morning Off',
                description: 'Turn off lights at sunrise',
                trigger: { type: 'sunrise' },
                action: { type: 'turn_off', targetType: 'acload' }
            },
            {
                name: 'Low Battery Saver',
                description: 'Turn off loads when battery < 20%',
                trigger: { type: 'battery_below', value: 20 },
                action: { type: 'turn_off', targetType: 'acload' }
            },
            {
                name: 'High Solar Boost',
                description: 'Turn on loads when solar > 500W',
                trigger: { type: 'solar_above', value: 500 },
                action: { type: 'turn_on', targetType: 'acload' }
            },
            {
                name: 'Evening Schedule',
                description: 'Turn on loads from 6-10 PM',
                trigger: { type: 'time_range', value: 18 * 60, value2: 22 * 60 },
                action: { type: 'turn_on', targetType: 'acload' }
            }
        ],
        
        // Create rule from preset
        createFromPreset(presetIndex) {
            const preset = this.presets[presetIndex];
            if (!preset) return null;
            return this.createRule(preset.name, preset.trigger, preset.action);
        },
        
        // Export rules for save
        exportRules() {
            return {
                rules: this.rules.map(r => ({...r})),
                ruleIdCounter: this.ruleIdCounter
            };
        },
        
        // Import rules from save
        importRules(data) {
            if (!data) return;
            this.rules = data.rules || [];
            this.ruleIdCounter = data.ruleIdCounter || 0;
            this.lastTriggerTime = {};
        },
        
        // Clear all rules
        clearAll() {
            this.rules = [];
            this.ruleIdCounter = 0;
            this.lastTriggerTime = {};
        }
    };
    
    // BOMSystem - Bill of Materials generation
    BOMSystem = {
        generateBOM() {
            const bom = {
                panels: [], batteries: [], controllers: [], distribution: [],
                loads: [], producers: [], containers: [], wiring: [], totalCost: 0
            };
            
            allItems.forEach(item => {
                let bomItem = {
                    name: item.specs.name || item.type,
                    quantity: 1,
                    unitCost: item.specs.cost || 0,
                    totalCost: item.specs.cost || 0,
                    specs: {}
                };
                
                if (item.type === 'panel') {
                    bomItem.specs = { power: `${item.specs.wmp}W`, voltage: `${item.specs.vmp}V`, current: `${item.specs.imp}A` };
                    bom.panels.push(bomItem);
                } else if (item.type === 'battery' || item.type === 'smartbattery') {
                    bomItem.specs = { voltage: `${item.specs.voltage}V`, capacity: item.type === 'battery' ? `${item.specs.ah}Ah` : `${item.specs.kWh}kWh` };
                    bom.batteries.push(bomItem);
                } else if (item.type === 'controller') {
                    bomItem.specs = { type: item.subtype || 'MPPT', maxPV: `${item.specs.maxWmp}W`, maxVoc: `${item.specs.maxVoc}V` };
                    bom.controllers.push(bomItem);
                } else if (['breakerpanel', 'spiderbox', 'solarcombiner', 'doublevoltagehub', 'acbreaker', 'dcbreaker', 'combiner', 'acoutlet'].includes(item.type)) {
                    if (item.type === 'acbreaker' || item.type === 'dcbreaker') {
                        bomItem.specs = { rating: `${item.specs.rating}A` };
                    }
                    bom.distribution.push(bomItem);
                } else if (item.type === 'acload') {
                    bomItem.specs = { power: `${item.specs.watts}W`, voltage: `${item.specs.voltage}V` };
                    bom.loads.push(bomItem);
                } else if (item.type === 'producer') {
                    bomItem.specs = { power: `${item.specs.watts}W`, output: item.specs.recipe.output };
                    bom.producers.push(bomItem);
                } else if (item.type === 'container') {
                    bomItem.specs = { capacity: `${item.specs.capacity} ${item.specs.unit}`, resource: item.specs.resource };
                    bom.containers.push(bomItem);
                }
            });
            
            // Calculate wiring
            const wiringCosts = {};
            connections.forEach(conn => {
                const wireInfo = WireSystem.calculateGauge(conn, allItems);
                if (wireInfo) {
                    const key = `${wireInfo.gauge} AWG`;
                    if (!wiringCosts[key]) {
                        wiringCosts[key] = { gauge: wireInfo.gauge, totalFeet: 0, unitCost: wireInfo.rating.cost, connections: 0 };
                    }
                    wiringCosts[key].totalFeet += wireInfo.distance;
                    wiringCosts[key].connections++;
                }
            });
            
            Object.values(wiringCosts).forEach(wire => {
                bom.wiring.push({
                    name: `${wire.gauge} AWG Wire`,
                    quantity: Math.ceil(wire.totalFeet),
                    unitCost: wire.unitCost,
                    totalCost: Math.ceil(wire.totalFeet) * wire.unitCost,
                    specs: { unit: 'feet', connections: wire.connections }
                });
            });
            
            // Consolidate duplicates
            const consolidate = (items) => {
                const consolidated = {};
                items.forEach(item => {
                    const key = item.name;
                    if (consolidated[key]) {
                        consolidated[key].quantity++;
                        consolidated[key].totalCost += item.unitCost;
                    } else {
                        consolidated[key] = { ...item };
                    }
                });
                return Object.values(consolidated);
            };
            
            bom.panels = consolidate(bom.panels);
            bom.batteries = consolidate(bom.batteries);
            bom.controllers = consolidate(bom.controllers);
            bom.distribution = consolidate(bom.distribution);
            bom.loads = consolidate(bom.loads);
            bom.producers = consolidate(bom.producers);
            bom.containers = consolidate(bom.containers);
            
            // Total cost
            [bom.panels, bom.batteries, bom.controllers, bom.distribution, bom.loads, bom.producers, bom.containers, bom.wiring]
                .forEach(cat => cat.forEach(item => bom.totalCost += item.totalCost || 0));
            
            return bom;
        },
        
        exportBOMText(bom) {
            let text = '=== BILL OF MATERIALS ===\n\n';
            
            const addSection = (title, items) => {
                if (items.length === 0) return;
                text += `${title}:\n`;
                items.forEach(item => {
                    text += `  ${item.quantity}× ${item.name} @ $${item.unitCost.toFixed(2)} = $${item.totalCost.toFixed(2)}\n`;
                    if (item.specs && Object.keys(item.specs).length > 0) {
                        const specsStr = Object.entries(item.specs).map(([k,v]) => `${k}: ${v}`).join(', ');
                        text += `      (${specsStr})\n`;
                    }
                });
                text += '\n';
            };
            
            addSection('SOLAR PANELS', bom.panels);
            addSection('BATTERIES & STORAGE', bom.batteries);
            addSection('CONTROLLERS & INVERTERS', bom.controllers);
            addSection('DISTRIBUTION & BREAKERS', bom.distribution);
            addSection('WIRING', bom.wiring);
            addSection('LOADS & APPLIANCES', bom.loads);
            addSection('PRODUCERS', bom.producers);
            addSection('RESOURCE CONTAINERS', bom.containers);
            
            text += `TOTAL COST: $${bom.totalCost.toFixed(2)}\n`;
            text += `\nGenerated: ${new Date().toLocaleString()}\n`;
            
            return text;
        }
    };
    
    // ============================================
    // D3 SETUP
    // ============================================
    
    function initSVG() {
        svg = d3.select("#solar-canvas");
        
        // Set up zoom
        zoomBehavior = d3.zoom()
            .scaleExtent([0.25, 4])
            .filter(event => {
                if (event.type.includes('dblclick')) return false;
                if (event.target.closest('.item-group') || event.target.closest('.handle')) return false;
                return true;
            })
            .on("zoom", (event) => {
                zoomGroup.attr("transform", event.transform);
            });
        
        svg.call(zoomBehavior);
        
        // Add drag-and-drop handlers for library items
        const svgNode = svg.node();
        if (svgNode) {
            svgNode.ondragover = (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
            };
            
            svgNode.ondrop = (e) => {
                e.preventDefault();
                
                try {
                    const data = JSON.parse(e.dataTransfer.getData('application/json'));
                    if (!data || !data.type || !data.preset) return;
                    
                    // Get drop position in canvas coordinates
                    const transform = d3.zoomTransform(svgNode);
                    const rect = svgNode.getBoundingClientRect();
                    const x = transform.invertX(e.clientX - rect.left);
                    const y = transform.invertY(e.clientY - rect.top);
                    
                    // Check if dropping on an existing component of the same type
                    const overlappingItem = allItems.find(item => {
                        if (item.type !== data.type) return false;
                        const dx = x - item.x;
                        const dy = y - item.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        const tolerance = Math.max(item.width, item.height) * 0.5;
                        return distance < tolerance;
                    });
                    
                    if (overlappingItem) {
                        // Replace existing component
                        replaceComponent(overlappingItem, data.type, data.preset);
                        selectItem(overlappingItem);
                        render();
                        showToast(`Replaced ${overlappingItem.type} with ${data.preset.name}`, 'success');
                    } else {
                        // Create new component at drop position
                        let newItem;
                        if (data.type === 'panel') {
                            newItem = createPanel(x, y, data.preset);
                        } else if (data.type === 'battery') {
                            newItem = createBattery(x, y, data.preset);
                        } else if (data.type === 'smartbattery') {
                            newItem = createSmartBattery(x, y, data.preset);
                        } else if (data.type === 'controller') {
                            newItem = createController(x, y, data.preset);
                        }
                        
                        if (newItem) {
                            allItems.push(newItem);
                            selectItem(newItem);
                            render();
                            showToast(`Added ${data.preset.name}`, 'info');
                        }
                    }
                } catch (err) {
                    console.error('Error handling drop:', err);
                }
            };
        }
        
        // Add SVG filters for glow effects and shadows
        const defs = svg.append("defs");
        
        // Yellow glow for AC power and active components
        const yellowGlow = defs.append("filter")
            .attr("id", "solar-yellow-glow")
            .attr("x", "-100%").attr("y", "-100%")
            .attr("width", "300%").attr("height", "300%");
        yellowGlow.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "4").attr("result", "blur");
        yellowGlow.append("feColorMatrix").attr("in", "blur").attr("type", "matrix")
            .attr("values", "1 0 0 0 0  0.8 0.6 0 0 0  0 0 0 0 0  0 0 0 1.2 0");
        const yellowMerge = yellowGlow.append("feMerge");
        yellowMerge.append("feMergeNode").attr("in", "coloredBlur");
        yellowMerge.append("feMergeNode").attr("in", "SourceGraphic");
        
        // Cyan glow for solar panels producing power
        const cyanGlow = defs.append("filter")
            .attr("id", "solar-cyan-glow")
            .attr("x", "-100%").attr("y", "-100%")
            .attr("width", "300%").attr("height", "300%");
        cyanGlow.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "3").attr("result", "blur");
        cyanGlow.append("feColorMatrix").attr("in", "blur").attr("type", "matrix")
            .attr("values", "0 0.6 0.8 0 0  0 0.8 1 0 0  0.6 0.8 1 0 0  0 0 0 1 0");
        const cyanMerge = cyanGlow.append("feMerge");
        cyanMerge.append("feMergeNode");
        cyanMerge.append("feMergeNode").attr("in", "SourceGraphic");
        
        // Green glow for batteries charging
        const greenGlow = defs.append("filter")
            .attr("id", "solar-green-glow")
            .attr("x", "-100%").attr("y", "-100%")
            .attr("width", "300%").attr("height", "300%");
        greenGlow.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "3").attr("result", "blur");
        greenGlow.append("feColorMatrix").attr("in", "blur").attr("type", "matrix")
            .attr("values", "0 0.7 0 0 0  0 0.9 0 0 0  0 0.4 0 0 0  0 0 0 1 0");
        const greenMerge = greenGlow.append("feMerge");
        greenMerge.append("feMergeNode");
        greenMerge.append("feMergeNode").attr("in", "SourceGraphic");
        
        // Red glow for batteries discharging
        const redGlow = defs.append("filter")
            .attr("id", "solar-red-glow")
            .attr("x", "-100%").attr("y", "-100%")
            .attr("width", "300%").attr("height", "300%");
        redGlow.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "3").attr("result", "blur");
        redGlow.append("feColorMatrix").attr("in", "blur").attr("type", "matrix")
            .attr("values", "1 0 0 0 0  0 0.3 0 0 0  0 0 0.3 0 0  0 0 0 1 0");
        const redMerge = redGlow.append("feMerge");
        redMerge.append("feMergeNode");
        redMerge.append("feMergeNode").attr("in", "SourceGraphic");
        
        // Subtle green glow for batteries in live mode (idle state)
        const greenGlowSubtle = defs.append("filter")
            .attr("id", "solar-green-glow-subtle")
            .attr("x", "-100%").attr("y", "-100%")
            .attr("width", "300%").attr("height", "300%");
        greenGlowSubtle.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "2").attr("result", "blur");
        greenGlowSubtle.append("feColorMatrix").attr("in", "blur").attr("type", "matrix")
            .attr("values", "0 0.5 0 0 0  0 0.7 0 0 0  0 0.3 0 0 0  0 0 0 0.8 0");
        const greenSubtleMerge = greenGlowSubtle.append("feMerge");
        greenSubtleMerge.append("feMergeNode");
        greenSubtleMerge.append("feMergeNode").attr("in", "SourceGraphic");
        
        // Soft shadow for depth
        const shadow = defs.append("filter")
            .attr("id", "solar-shadow")
            .attr("x", "-50%").attr("y", "-50%")
            .attr("width", "200%").attr("height", "200%");
        shadow.append("feGaussianBlur").attr("in", "SourceAlpha").attr("stdDeviation", "2");
        shadow.append("feOffset").attr("dx", "2").attr("dy", "2").attr("result", "offsetblur");
        shadow.append("feComponentTransfer")
            .append("feFuncA").attr("type", "linear").attr("slope", "0.3");
        const shadowMerge = shadow.append("feMerge");
        shadowMerge.append("feMergeNode");
        shadowMerge.append("feMergeNode").attr("in", "SourceGraphic");
        
        // Create layer groups
        zoomGroup = svg.append("g").attr("class", "zoom-group");
        wiresGroup = zoomGroup.append("g").attr("class", "wires-layer");
        itemsGroup = zoomGroup.append("g").attr("class", "items-layer");
        tempGroup = zoomGroup.append("g").attr("class", "temp-layer");
        
        // Handle canvas click for deselection
        svg.on("click", (event) => {
            if (event.target === svg.node() || event.target.closest('.zoom-group') === zoomGroup.node()) {
                if (!event.target.closest('.item-group') && !event.target.closest('.handle')) {
                    deselectAll();
                }
            }
        });
        
        // Center view initially
        const container = document.getElementById('solar-canvas-container');
        if (container) {
            const width = container.clientWidth;
            const height = container.clientHeight;
            svg.call(zoomBehavior.transform, d3.zoomIdentity.translate(width / 2, height / 2));
        }
    }
    
    // ============================================
    // COMPONENT CREATION
    // ============================================
    
    function createPanel(x, y, specs = PANEL_PRESETS[0]) {
        const id = `panel-${++itemIdCounter}`;
        const imp = specs.imp || (specs.wmp / specs.vmp) || (specs.isc * 0.9);
        
        // Scale: 120px per meter
        const scale = 120 / 1000;
        const panelHeightPx = Math.max(60, Math.min(150, (specs.height || 770) * scale));
        const panelWidthPx = Math.max(80, Math.min(200, (specs.width || 1150) * scale));
        
        return {
            id, type: 'panel', x, y,
            width: panelWidthPx, height: panelHeightPx,
            specs: { ...specs, imp: parseFloat(imp.toFixed(2)) },
            handles: {
                positive: { id: `${id}-pos`, polarity: 'positive', x: 0, y: panelHeightPx / 2, connectedTo: [] },
                negative: { id: `${id}-neg`, polarity: 'negative', x: panelWidthPx, y: panelHeightPx / 2, connectedTo: [] }
            }
        };
    }
    
    function createBattery(x, y, specs = BATTERY_PRESETS[0]) {
        const id = `battery-${++itemIdCounter}`;
        const kWh = (specs.voltage * specs.ah) / 1000;
        
        const scale = 120 / 1000;
        let batteryHeightPx = Math.max(50, Math.min(120, (specs.height || 175) * scale));
        let batteryWidthPx = Math.max(60, Math.min(150, (specs.width || 330) * scale));
        
        return {
            id, type: 'battery', x, y,
            width: batteryWidthPx, height: batteryHeightPx,
            specs: { ...specs, kWh },
            handles: {
                positive: { id: `${id}-pos`, polarity: 'positive', x: batteryWidthPx * 0.25, y: -5, connectedTo: [] },
                negative: { id: `${id}-neg`, polarity: 'negative', x: batteryWidthPx * 0.75, y: -5, connectedTo: [] }
            }
        };
    }
    
    function createController(x, y, specs = CONTROLLER_PRESETS[0]) {
        const id = `controller-${++itemIdCounter}`;
        const isHybrid = specs.type === 'hybrid_inverter' || specs.type === 'all_in_one';
        const isAllInOne = specs.type === 'all_in_one';
        
        const scale = 120 / 1000;
        let controllerHeightPx = Math.max(80, Math.min(160, (specs.height || 600) * scale));
        let controllerWidthPx = Math.max(80, Math.min(200, (specs.width || 400) * scale));
        
        const handles = {
            pvPositive: { id: `${id}-pv-pos`, polarity: 'pv-positive', x: controllerWidthPx * 0.35, y: -5, connectedTo: [] },
            pvNegative: { id: `${id}-pv-neg`, polarity: 'pv-negative', x: controllerWidthPx * 0.65, y: -5, connectedTo: [] }
        };
        
        // Battery terminals (if not all-in-one)
        if (!isAllInOne) {
            handles.batteryPositive = { id: `${id}-batt-pos`, polarity: 'positive', x: controllerWidthPx * 0.35, y: controllerHeightPx + 5, connectedTo: [] };
            handles.batteryNegative = { id: `${id}-batt-neg`, polarity: 'negative', x: controllerWidthPx * 0.65, y: controllerHeightPx + 5, connectedTo: [] };
        }
        
        // AC output (for hybrid inverters and all-in-one units)
        // Positioned at middle bottom, between battery + and - ports when they exist
        if (isHybrid) {
            // Calculate middle position: between batteryPositive (0.35) and batteryNegative (0.65)
            // Middle = (0.35 + 0.65) / 2 = 0.5, which is controllerWidthPx / 2
            const acOutputX = controllerWidthPx / 2; // Middle between battery terminals
            handles.acOutput = { id: `${id}-ac-out`, polarity: 'ac', x: acOutputX, y: controllerHeightPx + 5, connectedTo: [] };
        }
        
        return {
            id, type: 'controller', subtype: specs.type, x, y,
            width: controllerWidthPx, height: controllerHeightPx,
            specs: { ...specs },
            handles
        };
    }
    
    function createACBreaker(x, y, rating = 20) {
        const id = `acbreaker-${++itemIdCounter}`;
        const width = 60, height = 80;
        
        return {
            id, type: 'acbreaker', x, y,
            width, height, isClosed: true,
            specs: { name: `AC Breaker ${rating}A`, rating, voltage: 120, cost: 25 },
            handles: {
                lineIn: { id: `${id}-line`, polarity: 'ac', x: width / 2, y: -5, connectedTo: [] },
                loadOut: { id: `${id}-load`, polarity: 'ac', x: width / 2, y: height + 5, connectedTo: [] }
            }
        };
    }
    
    function createACOutlet(x, y, voltage = 120) {
        const id = `acoutlet-${++itemIdCounter}`;
        const width = 50, height = 70;
        
        return {
            id, type: 'acoutlet', x, y,
            width, height,
            specs: { name: `${voltage}V Outlet`, voltage, cost: 15 },
            handles: {
                input: { id: `${id}-in`, polarity: 'ac', x: width / 2, y: -5, connectedTo: [] },
                load: { id: `${id}-load`, polarity: 'load', x: width / 2, y: height + 5, connectedTo: [] }
            }
        };
    }
    
    function createACLoad(x, y, preset = APPLIANCE_PRESETS[0]) {
        const id = `acload-${++itemIdCounter}`;
        const width = 70, height = 55;
        
        return {
            id, type: 'acload', x, y,
            width, height,
            specs: { 
                name: preset.name, 
                watts: preset.watts, 
                voltage: preset.voltage || 120, 
                icon: preset.icon || '💡',
                cost: 0 
            },
            handles: {
                cord: { id: `${id}-cord`, polarity: 'load', x: 0, y: height / 2, connectedTo: [] }
            }
        };
    }
    
    function createDCBreaker(x, y, rating = 30) {
        const id = `dcbreaker-${++itemIdCounter}`;
        const width = 50, height = 60;
        
        return {
            id, type: 'dcbreaker', x, y,
            width, height, isClosed: true,
            specs: { name: `DC Breaker ${rating}A`, rating, maxVoltage: 150, cost: 20 },
            handles: {
                linePositive: { id: `${id}-line-pos`, polarity: 'positive', x: width * 0.3, y: -5, connectedTo: [] },
                lineNegative: { id: `${id}-line-neg`, polarity: 'negative', x: width * 0.7, y: -5, connectedTo: [] },
                loadPositive: { id: `${id}-load-pos`, polarity: 'positive', x: width * 0.3, y: height + 5, connectedTo: [] },
                loadNegative: { id: `${id}-load-neg`, polarity: 'negative', x: width * 0.7, y: height + 5, connectedTo: [] }
            }
        };
    }
    
    function createCombiner(x, y, inputs = 4) {
        const id = `combiner-${++itemIdCounter}`;
        const width = 100, height = 60;
        const handles = {};
        
        for (let i = 0; i < inputs; i++) {
            const xRatio = (i + 0.5) / inputs;
            handles[`input${i}Positive`] = { id: `${id}-in${i}-pos`, polarity: 'positive', x: width * xRatio - 6, y: -5, connectedTo: [] };
            handles[`input${i}Negative`] = { id: `${id}-in${i}-neg`, polarity: 'negative', x: width * xRatio + 6, y: -5, connectedTo: [] };
        }
        
        handles.outputPositive = { id: `${id}-out-pos`, polarity: 'pv-positive', x: width * 0.35, y: height + 5, connectedTo: [] };
        handles.outputNegative = { id: `${id}-out-neg`, polarity: 'pv-negative', x: width * 0.65, y: height + 5, connectedTo: [] };
        
        return {
            id, type: 'combiner', x, y,
            width, height,
            specs: { name: `${inputs}-String Combiner`, inputs, cost: 20 + inputs * 15 },
            handles
        };
    }
    
    // ============================================
    // PHASE 2: ADVANCED DISTRIBUTION COMPONENTS
    // ============================================
    
    function createSolarCombinerBox(x, y, inputs = 4) {
        const id = `solarcombiner-${++itemIdCounter}`;
        const width = 120, height = 80;
        const handles = {};
        
        // Per-string breaker inputs on top
        for (let i = 0; i < inputs; i++) {
            const xRatio = (i + 0.5) / inputs;
            handles[`input${i}Positive`] = { id: `${id}-in${i}-pos`, polarity: 'pv-positive', x: width * xRatio - 6, y: -5, connectedTo: [], breakerClosed: true };
            handles[`input${i}Negative`] = { id: `${id}-in${i}-neg`, polarity: 'pv-negative', x: width * xRatio + 6, y: -5, connectedTo: [] };
        }
        
        // Combined output on bottom
        handles.outputPositive = { id: `${id}-out-pos`, polarity: 'pv-positive', x: width * 0.35, y: height + 5, connectedTo: [] };
        handles.outputNegative = { id: `${id}-out-neg`, polarity: 'pv-negative', x: width * 0.65, y: height + 5, connectedTo: [] };
        
        return {
            id, type: 'solarcombiner', x, y,
            width, height,
            specs: { name: `${inputs}-String Solar Combiner`, inputs, breakerRating: 15, maxVoltage: 150, cost: 30 + inputs * 25 },
            breakerStates: new Array(inputs).fill(true),
            handles
        };
    }
    
    function createBreakerPanel(x, y) {
        const id = `breakerpanel-${++itemIdCounter}`;
        const width = 140, height = 200;
        const handles = {
            // Main 240V input on top
            mainInput: { id: `${id}-main-in`, polarity: 'ac', x: width / 2, y: -5, connectedTo: [], voltage: 240 }
        };
        
        // 8 circuit outputs (4 on each side)
        const circuitNames = ['Kitchen', 'Living', 'Bedroom 1', 'Bedroom 2', 'Bath', 'Garage', 'Outdoor', 'Spare'];
        for (let i = 0; i < 8; i++) {
            const side = i < 4 ? 'left' : 'right';
            const row = i % 4;
            const xPos = side === 'left' ? -5 : width + 5;
            const yPos = 50 + row * 38;
            handles[`circuit${i + 1}`] = { 
                id: `${id}-c${i + 1}`, 
                polarity: 'ac', 
                x: xPos, 
                y: yPos, 
                connectedTo: [],
                circuitName: circuitNames[i],
                maxAmps: 20,
                rating: 20, // Keep for backwards compatibility
                voltage: 120
            };
        }
        
        return {
            id, type: 'breakerpanel', x, y,
            width, height,
            mainBreakerOn: true,
            breakerStates: Array(8).fill(true),
            specs: { name: 'Breaker Panel', circuits: 8, mainRating: 100, cost: 200 },
            handles
        };
    }
    
    function createSpiderBox(x, y) {
        const id = `spiderbox-${++itemIdCounter}`;
        const width = 130, height = 100;
        const handles = {
            // Main 240V/50A input on left
            mainInput: { id: `${id}-main-in`, polarity: 'ac', x: -5, y: height / 2, connectedTo: [], voltage: 240 }
        };
        
        // 6 circuit outputs on right side
        const circuits = [
            { name: 'L1-20A', rating: 20, voltage: 120 },
            { name: 'L2-20A', rating: 20, voltage: 120 },
            { name: 'L3-20A', rating: 20, voltage: 120 },
            { name: 'L4-20A', rating: 20, voltage: 120 },
            { name: 'L5-30A', rating: 30, voltage: 120 },
            { name: '240V-30A', rating: 30, voltage: 240 }
        ];
        
        circuits.forEach((circuit, i) => {
            const yPos = 15 + i * 14;
            handles[`circuit${i + 1}`] = {
                id: `${id}-c${i + 1}`,
                polarity: 'ac',
                x: width + 5,
                y: yPos,
                connectedTo: [],
                circuitName: circuit.name,
                maxAmps: circuit.rating,
                rating: circuit.rating, // Keep for backwards compatibility
                voltage: circuit.voltage,
                isClosed: true
            };
        });
        
        return {
            id, type: 'spiderbox', x, y,
            width, height,
            mainBreakerOn: true,
            specs: { name: 'CEP Spider Box', circuits: circuits, mainRating: 50, inputVoltage: 240, cost: 450 },
            handles
        };
    }
    
    function createDoubleVoltageHub(x, y) {
        const id = `dvhub-${++itemIdCounter}`;
        const width = 100, height = 70;
        
        return {
            id, type: 'doublevoltagehub', x, y,
            width, height,
            specs: { name: 'Double Voltage Hub', maxInputControllers: 2, outputVoltage: '120V/240V', maxOutputW: 7200, cost: 400 },
            handles: {
                // Two parallel inputs on left (for connecting two Delta Pro units)
                input1: { id: `${id}-in1`, polarity: 'parallel', x: -5, y: height * 0.33, connectedTo: [] },
                input2: { id: `${id}-in2`, polarity: 'parallel', x: -5, y: height * 0.67, connectedTo: [] },
                // Combined 240V AC output on right
                acOutput: { id: `${id}-ac-out`, polarity: 'ac', x: width + 5, y: height * 0.5, connectedTo: [], voltage: 240 }
            }
        };
    }
    
    function createSmartBattery(x, y, kWh = 3.6, parentControllerId = null) {
        const id = `smartbatt-${++itemIdCounter}`;
        const width = 90, height = 70;
        
        return {
            id, type: 'smartbattery', x, y,
            width, height,
            parentControllerId,
            specs: { name: 'Smart Battery', kWh, voltage: 48, cost: 2700 },
            handles: {
                // Smart battery ports on both sides for daisy-chaining
                smartPort1: { id: `${id}-smart-1`, polarity: 'smart-battery', x: width + 5, y: height * 0.5, connectedTo: [] },
                smartPort2: { id: `${id}-smart-2`, polarity: 'smart-battery', x: -5, y: height * 0.5, connectedTo: [] }
            }
        };
    }
    
    // ============================================
    // PHASE 6: PRODUCER & CONTAINER CREATION
    // ============================================
    
    function createProducer(x, y, preset = PRODUCER_PRESETS[0]) {
        const id = `producer-${++itemIdCounter}`;
        const width = 80, height = 70;
        
        return {
            id, type: 'producer', x, y,
            width, height,
            internalStorage: 0,
            specs: {
                name: preset.name,
                icon: preset.icon,
                watts: preset.watts,
                voltage: preset.voltage,
                recipe: { ...preset.recipe },
                tankSize: preset.tankSize,
                cost: preset.cost
            },
            handles: {
                // Power input
                power: { id: `${id}-power`, polarity: 'load', x: width / 2, y: -5, connectedTo: [] },
                // Resource output (pipe connection)
                output: { id: `${id}-output`, polarity: 'pipe', x: width + 5, y: height / 2, connectedTo: [] }
            }
        };
    }
    
    function createContainer(x, y, preset = CONTAINER_PRESETS[0]) {
        const id = `container-${++itemIdCounter}`;
        const width = 60, height = 80;
        
        // Initialize container level
        ResourceSystem.initContainer(id, preset.capacity);
        
        return {
            id, type: 'container', x, y,
            width, height,
            specs: {
                name: preset.name,
                resource: preset.resource,
                capacity: preset.capacity,
                unit: preset.unit,
                icon: preset.icon,
                cost: preset.cost
            },
            handles: {
                // Pipe connections on both sides
                input: { id: `${id}-in`, polarity: 'pipe', x: -5, y: height / 2, connectedTo: [] },
                output: { id: `${id}-out`, polarity: 'pipe', x: width + 5, y: height / 2, connectedTo: [] }
            }
        };
    }
    
    // ============================================
    // HELPER FUNCTION ALIASES
    // ============================================
    
    // Generic breaker creator (routes to AC or DC based on type)
    function createBreaker(x, y, preset, type = 'dc') {
        const rating = preset.rating || 20;
        return type === 'ac' ? createACBreaker(x, y, rating) : createDCBreaker(x, y, rating);
    }
    
    // Alias for createACLoad
    function createLoad(x, y, preset) {
        return createACLoad(x, y, preset);
    }
    
    // Alias for createSolarCombinerBox
    function createSolarCombiner(x, y, options) {
        return createSolarCombinerBox(x, y, options?.inputs || 4);
    }
    
    // ============================================
    // CONNECTION HANDLING
    // ============================================
    
    function canConnect(sourceHandle, targetHandle) {
        if (!sourceHandle || !targetHandle) return false;
        if (sourceHandle.id === targetHandle.id) return false;
        
        const sp = sourceHandle.polarity;
        const tp = targetHandle.polarity;
        
        // Define polarity groups
        const positives = ['positive', 'pv-positive'];
        const negatives = ['negative', 'pv-negative'];
        
        // PARALLEL connections (same polarity) - for combining outputs
        if (positives.includes(sp) && positives.includes(tp)) return true;
        if (negatives.includes(sp) && negatives.includes(tp)) return true;
        
        // SERIES connections (opposite polarity) - for increasing voltage
        // Positive can connect to negative for series wiring
        if (positives.includes(sp) && negatives.includes(tp)) return true;
        if (negatives.includes(sp) && positives.includes(tp)) return true;
        
        // AC connections
        if (sp === 'ac' && (tp === 'ac' || tp === 'load')) return true;
        if (tp === 'ac' && (sp === 'ac' || sp === 'load')) return true;
        if (sp === 'load' && tp === 'load') return true;
        
        // Parallel ports can connect to AC outputs from controllers/inverters
        if (sp === 'parallel' && tp === 'ac') return true;
        if (tp === 'parallel' && sp === 'ac') return true;
        
        // Smart battery ports connect to each other
        if (sp === 'smart-battery' && tp === 'smart-battery') return true;
        
        // Pipe connections for resource transfer
        if (sp === 'pipe' && tp === 'pipe') return true;
        
        return false;
    }
    
    function createConnection(sourceItem, sourceHandleKey, targetItem, targetHandleKey) {
        const sourceHandle = sourceItem.handles[sourceHandleKey];
        const targetHandle = targetItem.handles[targetHandleKey];
        
        if (!canConnect(sourceHandle, targetHandle)) return null;
        
        // Voltage validation: Check if connecting a load to an outlet with mismatched voltage
        if (sourceItem.type === 'acoutlet' && targetItem.type === 'acload') {
            const outletVoltage = sourceItem.specs.voltage || 120;
            const loadVoltage = targetItem.specs.voltage || 120;
            
            // 240V outlet can power 120V load, but 120V outlet cannot power 240V load
            if (loadVoltage === 240 && outletVoltage === 120) {
                showHint('Voltage Mismatch', `Cannot connect ${loadVoltage}V load to ${outletVoltage}V outlet. This will cause damage or trip the breaker.`);
                return null;
            }
        } else if (sourceItem.type === 'acload' && targetItem.type === 'acoutlet') {
            const outletVoltage = targetItem.specs.voltage || 120;
            const loadVoltage = sourceItem.specs.voltage || 120;
            
            if (loadVoltage === 240 && outletVoltage === 120) {
                showHint('Voltage Mismatch', `Cannot connect ${loadVoltage}V load to ${outletVoltage}V outlet. This will cause damage or trip the breaker.`);
                return null;
            }
        }
        
        const connId = `conn-${++connectionIdCounter}`;
        
        const conn = {
            id: connId,
            sourceItemId: sourceItem.id,
            sourceHandleKey,
            targetItemId: targetItem.id,
            targetHandleKey
        };
        
        // Update handle connections
        sourceHandle.connectedTo.push({ connectionId: connId, itemId: targetItem.id, handleKey: targetHandleKey });
        targetHandle.connectedTo.push({ connectionId: connId, itemId: sourceItem.id, handleKey: sourceHandleKey });
        
        connections.push(conn);
        return conn;
    }
    
    function deleteConnection(conn) {
        // Remove from handles
        const sourceItem = allItems.find(i => i.id === conn.sourceItemId);
        const targetItem = allItems.find(i => i.id === conn.targetItemId);
        
        if (sourceItem && sourceItem.handles[conn.sourceHandleKey]) {
            const handle = sourceItem.handles[conn.sourceHandleKey];
            handle.connectedTo = handle.connectedTo.filter(c => c.connectionId !== conn.id);
        }
        if (targetItem && targetItem.handles[conn.targetHandleKey]) {
            const handle = targetItem.handles[conn.targetHandleKey];
            handle.connectedTo = handle.connectedTo.filter(c => c.connectionId !== conn.id);
        }
        
        // Remove from connections array
        connections = connections.filter(c => c.id !== conn.id);
    }
    
    function deleteItem(item) {
        // Delete all connections first
        const itemConns = connections.filter(c => c.sourceItemId === item.id || c.targetItemId === item.id);
        itemConns.forEach(deleteConnection);
        
        // Remove item
        allItems = allItems.filter(i => i.id !== item.id);
        
        if (selectedItem && selectedItem.id === item.id) {
            selectedItem = null;
        }
    }
    
    /**
     * Remove all panels while preserving other components
     * @returns {number} Number of panels removed
     */
    function removeAllPanels() {
        const panels = allItems.filter(i => i.type === 'panel');
        panels.forEach(panel => {
            // Delete connections associated with this panel
            const panelConns = connections.filter(c => c.sourceItemId === panel.id || c.targetItemId === panel.id);
            panelConns.forEach(deleteConnection);
        });
        
        const count = panels.length;
        allItems = allItems.filter(i => i.type !== 'panel');
        
        if (selectedItem && selectedItem.type === 'panel') {
            selectedItem = null;
        }
        
        return count;
    }
    
    /**
     * Sync panels from linkage mode configuration
     * Removes existing panels and creates new ones matching linkage layout
     * Preserves all non-panel components (batteries, controllers, loads, etc.)
     * Auto-wires panels: columns in series, rows in parallel
     * Adds default controller and battery if none exist
     * @param {Object} config - Configuration from linkage mode
     * @returns {Object} Sync result with panel count and layout info
     */
    function syncPanelsFromLinkage(config) {
        if (!config || !config.panels || config.panels.length === 0) {
            return { synced: false, message: 'No panels to sync' };
        }
        
        // Remove existing panels (this also removes their connections)
        const removedCount = removeAllPanels();
        
        // Extract configuration
        const {
            panels: linkagePanels,
            specs: panelSpecs,
            layout: layoutConfig
        } = config;
        
        const isArchMode = layoutConfig.isArchMode || false;
        const gridRows = layoutConfig.gridRows || Math.ceil(Math.sqrt(linkagePanels.length));
        const gridCols = layoutConfig.gridCols || Math.ceil(linkagePanels.length / gridRows);
        const panelsPerSide = gridRows * gridCols;
        
        // Calculate panel pixel dimensions from actual linkage specs
        // panelSpecs.width and .height are in mm (converted from inches * 25.4)
        const specWidthMm = panelSpecs.width || 990;  // Default ~39 inches
        const specHeightMm = panelSpecs.height || 1651; // Default ~65 inches
        
        // Scale: maintain aspect ratio, target ~100-150px for typical panels
        const scaleFactor = 0.09; // ~90px per meter
        const panelWidthPx = Math.max(60, Math.min(180, specWidthMm * scaleFactor));
        const panelHeightPx = Math.max(80, Math.min(220, specHeightMm * scaleFactor));
        
        // Calculate spacing from linkage padding (inches -> pixels)
        // paddingX/Y are in inches, convert to pixels with scale
        const paddingScale = 2.5; // pixels per inch of padding
        const spacingX = Math.max(15, (layoutConfig.paddingX || 2) * paddingScale);
        const spacingY = Math.max(15, (layoutConfig.paddingY || 2) * paddingScale);
        
        // Store created panels in a 2D grid for wiring
        const panelGrid = []; // panelGrid[row][col] = panel
        for (let r = 0; r < gridRows; r++) {
            panelGrid[r] = [];
        }
        
        // Create panels with correct layout
        if (isArchMode) {
            // Arch mode: Group panels by A/B sides
            const numSides = Math.ceil(linkagePanels.length / panelsPerSide);
            const arrayWidth = gridCols * (panelWidthPx + spacingX) - spacingX;
            const arrayHeight = gridRows * (panelHeightPx + spacingY) - spacingY;
            const groupSpacing = 60;
            
            const numPairs = Math.ceil(numSides / 2);
            const totalWidth = numPairs * (arrayWidth * 2 + groupSpacing) - groupSpacing;
            const startX = -totalWidth / 2;
            const startY = -arrayHeight / 2 - 100;
            
            linkagePanels.forEach((panel, idx) => {
                const sideIndex = Math.floor(idx / panelsPerSide);
                const pairIndex = Math.floor(sideIndex / 2);
                const isASide = sideIndex % 2 === 0;
                const withinSide = idx % panelsPerSide;
                const row = Math.floor(withinSide / gridCols);
                const col = withinSide % gridCols;
                
                const pairStartX = startX + pairIndex * (arrayWidth * 2 + groupSpacing + 40);
                const arrayOffsetX = isASide ? 0 : arrayWidth + groupSpacing;
                
                const x = pairStartX + arrayOffsetX + col * (panelWidthPx + spacingX);
                const y = startY + row * (panelHeightPx + spacingY);
                
                const newPanel = addPanelFromLinkageWithDimensions(x, y, panelSpecs, panelWidthPx, panelHeightPx);
                
                // Only wire first side for now (can extend later)
                if (sideIndex === 0 && row < gridRows && col < gridCols) {
                    panelGrid[row][col] = newPanel;
                }
            });
        } else {
            // Top panel mode: Use exact grid layout
            const totalWidth = gridCols * (panelWidthPx + spacingX) - spacingX;
            const totalHeight = gridRows * (panelHeightPx + spacingY) - spacingY;
            const startX = -totalWidth / 2;
            const startY = -totalHeight / 2 - 150;
            
            linkagePanels.forEach((panel, idx) => {
                const row = Math.floor(idx / gridCols);
                const col = idx % gridCols;
                const x = startX + col * (panelWidthPx + spacingX);
                const y = startY + row * (panelHeightPx + spacingY);
                
                const newPanel = addPanelFromLinkageWithDimensions(x, y, panelSpecs, panelWidthPx, panelHeightPx);
                panelGrid[row][col] = newPanel;
            });
        }
        
        // Auto-wire panels: columns in series, rows in parallel
        // Each column forms a "string" wired in series
        // All strings connect in parallel to the controller PV inputs
        
        // Check if controller and battery exist, if not create defaults
        const existingControllers = allItems.filter(i => i.type === 'controller');
        const existingBatteries = allItems.filter(i => i.type === 'battery');
        
        let controller = existingControllers[0];
        let battery = existingBatteries[0];
        
        // Calculate positions below panel array
        const arrayBottomY = panelGrid[gridRows - 1]?.[0]?.y + panelHeightPx + 80 || 100;
        const arrayCenterX = (panelGrid[0]?.[0]?.x + panelGrid[0]?.[gridCols-1]?.x + panelWidthPx) / 2 || 0;
        
        if (!controller) {
            // Find PowMR 5000W Hybrid in presets
            const powmrPreset = CONTROLLER_PRESETS.find(p => p.name.includes('PowMR 5000W')) || CONTROLLER_PRESETS[3];
            const controllerWidth = powmrPreset.width ? powmrPreset.width * 0.12 : 100;
            controller = createController(arrayCenterX - controllerWidth/2 - 50, arrayBottomY, powmrPreset);
            allItems.push(controller);
        }
        
        if (!battery) {
            // Find Ruixu 48V 314Ah in presets
            const ruixuPreset = BATTERY_PRESETS.find(p => p.name.includes('Ruixu 48V 314Ah')) || 
                               BATTERY_PRESETS.find(p => p.name.includes('48V') && p.ah >= 200) ||
                               BATTERY_PRESETS[0];
            battery = createBattery(controller.x + controller.width + 40, arrayBottomY, ruixuPreset);
            allItems.push(battery);
        }
        
        // Wire panels in series within each column (string)
        // Connect negative (right side) of upper panel to positive (left side) of lower panel
        for (let col = 0; col < gridCols; col++) {
            for (let row = 0; row < gridRows - 1; row++) {
                const upperPanel = panelGrid[row]?.[col];
                const lowerPanel = panelGrid[row + 1]?.[col];
                
                if (upperPanel && lowerPanel) {
                    createConnection(upperPanel, 'negative', lowerPanel, 'positive');
                }
            }
        }
        
        // Connect each string to controller in parallel
        // Top of each string (first row positive) → Controller PV+
        // Bottom of each string (last row negative) → Controller PV-
        if (gridCols > 0 && gridRows > 0 && controller) {
            for (let col = 0; col < gridCols; col++) {
                const stringTopPanel = panelGrid[0]?.[col];
                const stringBottomPanel = panelGrid[gridRows - 1]?.[col];
                
                // Connect string positive to controller PV+
                if (stringTopPanel && controller.handles?.pvPositive) {
                    createConnection(stringTopPanel, 'positive', controller, 'pvPositive');
                }
                // Connect string negative to controller PV-
                if (stringBottomPanel && controller.handles?.pvNegative) {
                    createConnection(stringBottomPanel, 'negative', controller, 'pvNegative');
                }
            }
            
            // Connect controller to battery
            if (controller.handles?.batteryPositive && battery?.handles?.positive) {
                createConnection(controller, 'batteryPositive', battery, 'positive');
            }
            if (controller.handles?.batteryNegative && battery?.handles?.negative) {
                createConnection(controller, 'batteryNegative', battery, 'negative');
            }
        }
        
        render();
        
        const layoutDesc = isArchMode 
            ? `${Math.ceil(linkagePanels.length / panelsPerSide)} sides (${gridRows}×${gridCols} per side)`
            : `${gridRows}×${gridCols} grid`;
        
        return {
            synced: true,
            added: linkagePanels.length,
            removed: removedCount,
            layout: layoutDesc,
            message: `Synced ${linkagePanels.length} panels (${layoutDesc}), auto-wired ${gridCols} strings × ${gridRows} series`
        };
    }
    
    /**
     * Add panel from linkage with specific pixel dimensions
     */
    function addPanelFromLinkageWithDimensions(x, y, specs, widthPx, heightPx) {
        const id = `panel-${++itemIdCounter}`;
        const imp = specs.imp || (specs.wmp / specs.vmp) || (specs.isc * 0.9);
        
        const panel = {
            id, type: 'panel', x, y,
            width: widthPx, height: heightPx,
            specs: {
                name: specs.name,
                wmp: specs.wmp,
                vmp: specs.vmp,
                voc: specs.voc,
                isc: specs.isc,
                imp: parseFloat(imp.toFixed(2)),
                width: specs.width,
                height: specs.height,
                cost: specs.cost || 150
            },
            handles: {
                positive: { id: `${id}-pos`, polarity: 'positive', x: 0, y: heightPx / 2, connectedTo: [] },
                negative: { id: `${id}-neg`, polarity: 'negative', x: widthPx, y: heightPx / 2, connectedTo: [] }
            }
        };
        
        allItems.push(panel);
        return panel;
    }
    
    // ============================================
    // RENDERING
    // ============================================
    
    function render() {
        if (!isInitialized || !wiresGroup) return;
        renderWires();
        renderItems();
        updateStats();
    }
    
    // Generate smooth bezier curve between two points
    function generateCurvePath(sx, sy, ex, ey, sourceSide, targetSide) {
        sourceSide = sourceSide || 'right';
        targetSide = targetSide || 'left';
        
        // Calculate distance for dynamic curve strength
        const dist = Math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2);
        const curveStrength = Math.min(80, Math.max(30, dist * 0.4));
        
        let sc1x = sx, sc1y = sy, sc2x = ex, sc2y = ey;
        
        // Source control point - extends outward from the handle
        switch (sourceSide) {
            case 'top': sc1y = sy - curveStrength; break;
            case 'bottom': sc1y = sy + curveStrength; break;
            case 'left': sc1x = sx - curveStrength; break;
            case 'right': sc1x = sx + curveStrength; break;
        }
        
        // Target control point - extends outward from the handle
        switch (targetSide) {
            case 'top': sc2y = ey - curveStrength; break;
            case 'bottom': sc2y = ey + curveStrength; break;
            case 'left': sc2x = ex - curveStrength; break;
            case 'right': sc2x = ex + curveStrength; break;
        }
        
        return `M ${sx} ${sy} C ${sc1x} ${sc1y}, ${sc2x} ${sc2y}, ${ex} ${ey}`;
    }
    
    // Detect handle side based on position relative to item center
    function getHandleSide(item, handle) {
        if (handle.side) return handle.side; // Use explicit side if set
        
        const centerX = item.width / 2;
        const centerY = item.height / 2;
        
        const dx = handle.x - centerX;
        const dy = handle.y - centerY;
        
        // Determine which side based on which offset is larger
        if (Math.abs(dx) > Math.abs(dy)) {
            return dx > 0 ? 'right' : 'left';
        } else {
            return dy > 0 ? 'bottom' : 'top';
        }
    }
    
    // Calculate power flowing through a wire connection
    function calculateWirePower(conn) {
        if (!LiveView.state.active) return 0;
        
        const sourceItem = allItems.find(i => i.id === conn.sourceItemId);
        const targetItem = allItems.find(i => i.id === conn.targetItemId);
        if (!sourceItem || !targetItem) return 0;
        
        const sourceHandle = sourceItem.handles[conn.sourceHandleKey];
        const polarity = sourceHandle?.polarity || '';
        
        // For PV wires, use solar output
        if (polarity === 'pv-positive' || polarity === 'pv-negative') {
            return Simulation.currentSolarWatts || 0;
        }
        
        // For AC wires, calculate total load power downstream
        if (polarity === 'ac' || polarity === 'load') {
            let totalWatts = 0;
            
            // Recursively find all loads downstream from this connection
            function findDownstreamLoads(itemId, handleKey, visited = new Set()) {
                const key = `${itemId}-${handleKey}`;
                if (visited.has(key)) return;
                visited.add(key);
                
                const item = allItems.find(i => i.id === itemId);
                if (!item) return;
                
                const handle = item.handles[handleKey];
                if (!handle) return;
                
                // If this is a load, add its power
                if (item.type === 'acload' && LiveView.state.loadStates[item.id]) {
                    totalWatts += item.specs.watts || 0;
                }
                
                // If this is an outlet, check its loads
                if (item.type === 'acoutlet' && item.handles.load) {
                    item.handles.load.connectedTo.forEach(loadConn => {
                        const loadConnObj = connections.find(c => c.id === loadConn.connectionId);
                        if (loadConnObj) {
                            const loadItem = allItems.find(i => i.id === loadConnObj.targetItemId && i.type === 'acload');
                            if (loadItem && LiveView.state.loadStates[loadItem.id]) {
                                totalWatts += loadItem.specs.watts || 0;
                            }
                        }
                    });
                }
                
                // Trace downstream connections
                handle.connectedTo.forEach(downstreamConn => {
                    const downstreamConnObj = connections.find(c => c.id === downstreamConn.connectionId);
                    if (downstreamConnObj) {
                        const nextItemId = downstreamConnObj.targetItemId === itemId 
                            ? downstreamConnObj.sourceItemId 
                            : downstreamConnObj.targetItemId;
                        const nextHandleKey = downstreamConnObj.targetItemId === itemId
                            ? downstreamConnObj.sourceHandleKey
                            : downstreamConnObj.targetHandleKey;
                        findDownstreamLoads(nextItemId, nextHandleKey, visited);
                    }
                });
            }
            
            // Start from target item
            findDownstreamLoads(conn.targetItemId, conn.targetHandleKey);
            return totalWatts;
        }
        
        return 0;
    }
    
    // Calculate animation duration based on power (60W = 1.2s slow, 2000W = 0.3s fast)
    // Animation speed scales with power: higher power = faster animation (lower duration)
    function getAnimationDuration(powerWatts) {
        if (powerWatts <= 0) return 1.2; // Default slow for no power
        
        // Clamp power range
        const minPower = 60;
        const maxPower = 2000;
        const clampedPower = Math.max(minPower, Math.min(maxPower, powerWatts));
        
        // Linear interpolation: 60W -> 1.2s (slow), 2000W -> 0.3s (fast)
        const minDuration = 1.2; // Slow animation for low power
        const maxDuration = 0.3; // Fast animation for high power
        const ratio = (clampedPower - minPower) / (maxPower - minPower);
        const duration = minDuration + (maxDuration - minDuration) * (1 - ratio); // Inverted: higher power = lower duration
        
        return duration;
    }
    
    // Get wire ampacity (current carrying capacity) based on AWG gauge
    // Uses AWG_RATINGS constant if available, otherwise uses common defaults
    function getWireAmpacity(wireGauge) {
        // Check for AWG_RATINGS constant from constants.js
        if (typeof AWG_RATINGS !== 'undefined' && AWG_RATINGS[wireGauge]) {
            return AWG_RATINGS[wireGauge].ampacity || AWG_RATINGS[wireGauge].amps || 0;
        }
        
        // Fallback: Common AWG ampacity ratings (for copper, 60°C insulation)
        const defaultAmpacity = {
            18: 7,    // 18 AWG - 7A
            16: 10,   // 16 AWG - 10A
            14: 15,   // 14 AWG - 15A (typical household circuit)
            12: 20,   // 12 AWG - 20A (common outlet circuit)
            10: 30,   // 10 AWG - 30A (dryer, water heater)
            8: 40,    // 8 AWG - 40A (range, large appliance)
            6: 55,    // 6 AWG - 55A (subpanel, EV charger)
            4: 70,    // 4 AWG - 70A (large subpanel)
            2: 95,    // 2 AWG - 95A (main service)
            1: 110,   // 1 AWG - 110A
            '1/0': 125, // 1/0 AWG - 125A
            '2/0': 145, // 2/0 AWG - 145A
            '3/0': 165, // 3/0 AWG - 165A
            '4/0': 195  // 4/0 AWG - 195A (large service entrance)
        };
        
        return defaultAmpacity[wireGauge] || 20; // Default to 20A (12 AWG equivalent)
    }
    
    // Helper to determine wire flow direction relative to breaker panel
    function getWireFlowDirection(conn) {
        const sourceItem = allItems.find(i => i.id === conn.sourceItemId);
        const targetItem = allItems.find(i => i.id === conn.targetItemId);
        if (!sourceItem || !targetItem) return 'right'; // Default
        
        // Find breaker panel in the circuit by tracing through connections
        let breakerPanel = null;
        
        // Direct check
        if (sourceItem.type === 'breakerpanel') {
            breakerPanel = sourceItem;
        } else if (targetItem.type === 'breakerpanel') {
            breakerPanel = targetItem;
        } else {
            // Trace through circuit to find breaker panel
            const visited = new Set();
            const queue = [{ item: sourceItem, handleKey: conn.sourceHandleKey }, { item: targetItem, handleKey: conn.targetHandleKey }];
            
            while (queue.length > 0 && !breakerPanel) {
                const { item, handleKey } = queue.shift();
                if (!item || visited.has(item.id)) continue;
                visited.add(item.id);
                
                // Check if this is a breaker panel
                if (item.type === 'breakerpanel') {
                    breakerPanel = item;
                    break;
                }
                
                // Check if this is a spider box (also has circuits)
                if (item.type === 'spiderbox') {
                    breakerPanel = item; // Use spider box as reference too
                    break;
                }
                
                // Trace through all connections from this item
                if (item.handles) {
                    Object.values(item.handles).forEach(handle => {
                        if (handle.connectedTo) {
                            handle.connectedTo.forEach(handleConn => {
                                const connObj = connections.find(c => c.id === handleConn.connectionId);
                                if (connObj) {
                                    const nextItemId = connObj.sourceItemId === item.id ? connObj.targetItemId : connObj.sourceItemId;
                                    const nextItem = allItems.find(i => i.id === nextItemId);
                                    if (nextItem && !visited.has(nextItem.id)) {
                                        const nextHandleKey = connObj.sourceItemId === item.id ? connObj.targetHandleKey : connObj.sourceHandleKey;
                                        queue.push({ item: nextItem, handleKey: nextHandleKey });
                                    }
                                }
                            });
                        }
                    });
                }
            }
        }
        
        if (!breakerPanel) return 'right'; // Default if no breaker panel found
        
        // Calculate midpoint of wire
        const sourceHandle = sourceItem.handles[conn.sourceHandleKey];
        const targetHandle = targetItem.handles[conn.targetHandleKey];
        if (!sourceHandle || !targetHandle) return 'right';
        
        const wireMidX = (sourceItem.x + sourceHandle.x + targetItem.x + targetHandle.x) / 2;
        const panelCenterX = breakerPanel.x + breakerPanel.width / 2;
        
        // Determine direction: wires on right side of breaker panel flow right (outward), left side flow left (outward)
        return wireMidX > panelCenterX ? 'right' : 'left';
    }
    
    function renderWires() {
        const wireSelection = wiresGroup.selectAll(".wire").data(connections, d => d.id);
        
        wireSelection.exit().remove();
        
        const wireEnter = wireSelection.enter()
            .append("path")
            .attr("data-connection-id", d => d.id)
            .attr("class", d => {
                const sourceItem = allItems.find(i => i.id === d.sourceItemId);
                const sourceHandle = sourceItem?.handles[d.sourceHandleKey];
                const polarity = sourceHandle?.polarity || '';
                
                let wireClass = "wire";
                if (polarity === 'ac' || polarity === 'load') wireClass += " ac";
                else if (polarity === 'positive' || polarity === 'pv-positive') wireClass += " dc-positive";
                else if (polarity === 'negative' || polarity === 'pv-negative') wireClass += " dc-negative";
                else if (polarity === 'resource' || polarity === 'input' || polarity === 'output') wireClass += " resource";
                else wireClass += " dc-negative"; // Default fallback
                
                if (selectedConnection && selectedConnection.id === d.id) wireClass += " selected";
                
                // Initial power flow state (will be updated on merge)
                const powerFlow = LiveView.state.powerFlow[d.id];
                if (LiveView.state.active && powerFlow?.isLive) {
                    wireClass += " wire-live power-flowing";
                    
                    if (powerFlow.isPV) wireClass += " pv-live";
                    if (powerFlow.isBattery) wireClass += " battery-live";
                }
                
                return wireClass;
            })
            .on("click", (event, d) => {
                event.stopPropagation();
                selectConnection(d);
            });
        
        wireSelection.merge(wireEnter)
            .attr("d", d => {
                const sourceItem = allItems.find(i => i.id === d.sourceItemId);
                const targetItem = allItems.find(i => i.id === d.targetItemId);
                if (!sourceItem || !targetItem) return "";
                
                const sourceHandle = sourceItem.handles[d.sourceHandleKey];
                const targetHandle = targetItem.handles[d.targetHandleKey];
                
                const x1 = sourceItem.x + sourceHandle.x;
                const y1 = sourceItem.y + sourceHandle.y;
                const x2 = targetItem.x + targetHandle.x;
                const y2 = targetItem.y + targetHandle.y;
                
                // Detect handle sides for proper curve direction
                const sourceSide = getHandleSide(sourceItem, sourceHandle);
                const targetSide = getHandleSide(targetItem, targetHandle);
                
                // Use bezier curve path
                return generateCurvePath(x1, y1, x2, y2, sourceSide, targetSide);
            })
            .attr("class", d => {
                const sourceItem = allItems.find(i => i.id === d.sourceItemId);
                const sourceHandle = sourceItem?.handles[d.sourceHandleKey];
                const polarity = sourceHandle?.polarity || '';
                
                let wireClass = "wire";
                if (polarity === 'ac' || polarity === 'load') wireClass += " ac";
                else if (polarity === 'positive' || polarity === 'pv-positive') wireClass += " dc-positive";
                else if (polarity === 'negative' || polarity === 'pv-negative') wireClass += " dc-negative";
                else if (polarity === 'resource' || polarity === 'input' || polarity === 'output') wireClass += " resource";
                else wireClass += " dc-negative"; // Default fallback
                
                // Add polarity-specific classes for battery connections
                if (polarity === 'positive') wireClass += " positive";
                if (polarity === 'negative') wireClass += " negative";
                
                if (selectedConnection && selectedConnection.id === d.id) wireClass += " selected";
                
                // Determine flow direction for AC wires
                if ((polarity === 'ac' || polarity === 'load') && LiveView.state.active) {
                    const flowDir = getWireFlowDirection(d);
                    wireClass += ` flow-${flowDir}`;
                }
                
                // Wire visual states: live (glow) vs flowing (glow + animation)
                // Rules:
                // - Not live: no glow, no animation
                // - Live but no flow: glow only (wire-live class)
                // - Live and flowing: glow + animation (wire-live + wire-flowing classes)
                const powerFlow = LiveView.state.powerFlow[d.id];
                if (LiveView.state.active && powerFlow) {
                    if (powerFlow.isLive) {
                        wireClass += " wire-live"; // Glow when live
                        
                        // For AC wires: animate only when actively flowing
                        if ((polarity === 'ac' || polarity === 'load') && powerFlow.hasActiveFlow) {
                            wireClass += " wire-flowing"; // Animate when actively flowing
                        }
                        
                        // For PV wires: animate based on direction and charging state
                        if (powerFlow.isPV) {
                            wireClass += " pv-live"; // PV-specific glow
                            
                            // Only animate when actively charging (hasActiveFlow = true)
                            if (powerFlow.hasActiveFlow) {
                                if (powerFlow.direction === 'controller-to-pv') {
                                    // Negative wire: controller → panels (electron flow direction)
                                    wireClass += " pv-flowing-reverse";
                                } else if (powerFlow.direction === 'pv-to-controller') {
                                    // Positive wire: panels → controller (conventional current)
                                    wireClass += " pv-flowing";
                                }
                            }
                        }
                        
                        // For battery wires: animate based on charge/discharge state
                        if (powerFlow.isBattery) {
                            wireClass += " battery-live"; // Battery-specific glow
                            
                            if (powerFlow.hasActiveFlow) {
                                if (powerFlow.direction === 'charging') {
                                    wireClass += " battery-charging";
                                } else if (powerFlow.direction === 'discharging') {
                                    wireClass += " battery-discharging";
                                }
                            }
                        }
                        
                        // For resource flow (pipes, conveyors, etc.)
                        if (powerFlow.isResource) {
                            if (powerFlow.direction === 'consuming') {
                                wireClass += " resource-consuming";
                            } else if (powerFlow.direction === 'producing') {
                                wireClass += " resource-producing";
                            }
                        }
                        
                        // High power indication for wires carrying significant current
                        // Typically above 30A or 3600W at 120V
                        if (powerFlow.watts > 3600 || powerFlow.amps > 30) {
                            wireClass += " high-power";
                        }
                        
                        // Wire thermal/overload warning states
                        // Check wire ampacity against current
                        const wireGauge = d.wireGauge || 12; // Default 12 AWG
                        const wireAmpacity = getWireAmpacity(wireGauge);
                        if (wireAmpacity > 0 && powerFlow.amps > 0) {
                            const loadPercent = (powerFlow.amps / wireAmpacity) * 100;
                            
                            if (loadPercent > 100) {
                                // Critical overload - wire is exceeding its rating
                                wireClass += " critical-heat overloaded";
                            } else if (loadPercent > 80) {
                                // Warning - approaching limit
                                wireClass += " overheating";
                            }
                        }
                    }
                }
                
                return wireClass;
            })
            .style("--animation-duration", d => {
                // Calculate animation speed based on power flow
                if (!LiveView.state.active) return "0.6s";
                
                // Use pre-calculated watts from powerFlow state if available
                const powerFlow = LiveView.state.powerFlow[d.id];
                const powerWatts = powerFlow?.watts || calculateWirePower(d);
                const duration = getAnimationDuration(powerWatts);
                return `${duration}s`;
            });
    }
    
    function renderItems() {
        const itemSelection = itemsGroup.selectAll(".item-group").data(allItems, d => d.id);
        
        itemSelection.exit().remove();
        
        const itemEnter = itemSelection.enter()
            .append("g")
            .attr("class", "item-group")
            .attr("data-id", d => d.id)
            .call(d3.drag()
                .on("start", itemDragStart)
                .on("drag", itemDragMove)
                .on("end", itemDragEnd)
            )
            .on("click", (event, d) => {
                event.stopPropagation();
                
                // Multi-select for panels: Ctrl+click or Shift+click
                if (d.type === 'panel' && (event.ctrlKey || event.shiftKey)) {
                    const index = selectedPanels.findIndex(p => p.id === d.id);
                    if (index >= 0) {
                        // Deselect if already selected
                        selectedPanels.splice(index, 1);
                    } else {
                        // Add to selection
                        selectedPanels.push(d);
                    }
                    render();
                    if (selectedPanels.length > 0) {
                        updatePropertiesPanelForArray();
                    } else {
                        selectItem(d);
                    }
                } else {
                    // Single select
                    selectedPanels = [];
                    selectItem(d);
                }
            });
        
        itemEnter.each(function(d) {
            const g = d3.select(this);
            renderItemContent(g, d);
        });
        
        itemSelection.merge(itemEnter)
            .attr("transform", d => `translate(${d.x}, ${d.y})`)
            .classed("selected", d => selectedItem && selectedItem.id === d.id)
            .classed("array-selected", d => d.type === 'panel' && selectedPanels.some(p => p.id === d.id));
        
        // Update existing items
        itemSelection.each(function(d) {
            const g = d3.select(this);
            updateItemContent(g, d);
        });
    }
    
    function renderItemContent(g, d) {
        const radius = 6;
        
        // Common background rect
        const fillColor = getItemFillColor(d);
        const strokeColor = getItemStrokeColor(d);
        
        g.append("rect")
            .attr("class", "item-rect")
            .attr("width", d.width)
            .attr("height", d.height)
            .attr("rx", radius)
            .attr("ry", radius)
            .attr("fill", fillColor)
            .attr("stroke", strokeColor)
            .attr("stroke-width", 2);
        
        // Type-specific content
        if (d.type === 'panel') {
            renderPanel(g, d);
        } else if (d.type === 'battery') {
            renderBattery(g, d);
        } else if (d.type === 'controller') {
            renderController(g, d);
        } else if (d.type === 'acbreaker' || d.type === 'dcbreaker') {
            renderBreaker(g, d);
        } else if (d.type === 'acoutlet') {
            renderOutlet(g, d);
        } else if (d.type === 'acload') {
            renderLoad(g, d);
        } else if (d.type === 'combiner') {
            renderCombiner(g, d);
        } else if (d.type === 'solarcombiner') {
            renderSolarCombinerBox(g, d);
        } else if (d.type === 'breakerpanel') {
            renderBreakerPanel(g, d);
        } else if (d.type === 'spiderbox') {
            renderSpiderBox(g, d);
        } else if (d.type === 'doublevoltagehub') {
            renderDoubleVoltageHub(g, d);
        } else if (d.type === 'smartbattery') {
            renderSmartBattery(g, d);
        } else if (d.type === 'producer') {
            renderProducer(g, d);
        } else if (d.type === 'container') {
            renderContainer(g, d);
        }
        
        // Render handles
        renderHandles(g, d);
    }
    
    function getItemFillColor(d) {
        const colors = {
            panel: 'linear-gradient(135deg, #1a1a4a 0%, #2a2a6a 100%)',
            battery: '#2a3a4a',
            controller: '#2a2a3a',
            acbreaker: '#3a3a3a',
            dcbreaker: '#3a3a3a',
            acoutlet: '#2a2a2a',
            acload: '#3a3a4a',
            combiner: '#2a3a3a',
            solarcombiner: '#2a3a3a',
            breakerpanel: '#2a2a3a',
            spiderbox: '#3a3a2a',
            doublevoltagehub: '#2a3a4a',
            smartbattery: '#1a2a3a',
            producer: '#2a3a2a',
            container: '#2a2a3a'
        };
        return colors[d.type] || '#2a2a2a';
    }
    
    function getItemStrokeColor(d) {
        const colors = {
            panel: '#4a4a8a',
            battery: '#5cb85c',
            controller: '#f0ad4e',
            acbreaker: '#f0ad4e',
            dcbreaker: '#5bc0de',
            acoutlet: '#f0ad4e',
            acload: '#d9534f',
            combiner: '#5bc0de',
            solarcombiner: '#5bc0de',
            breakerpanel: '#f0ad4e',
            spiderbox: '#f0ad4e',
            doublevoltagehub: '#5cb85c',
            smartbattery: '#5cb85c',
            producer: '#27ae60',
            container: '#3498db'
        };
        return colors[d.type] || '#555';
    }
    
    function renderPanel(g, d) {
        // Calculate current output based on solar irradiance
        const irradiance = Simulation.solarIrradiance;
        const currentOutput = Math.round(d.specs.wmp * irradiance);
        
        // Apply glow effect when producing significant power
        if (LiveView.state.active && irradiance > 0.5) {
            g.attr("filter", "url(#solar-cyan-glow)");
        }
        
        // Add shadow for depth
        if (!LiveView.state.active || irradiance < 0.3) {
            g.attr("filter", "url(#solar-shadow)");
        }
        
        // Solar cell grid - brightness varies with irradiance in live mode
        const cellsX = 4, cellsY = 3;
        const cellW = (d.width - 8) / cellsX;
        const cellH = (d.height - 8) / cellsY;
        
        // Base cell color varies with irradiance in live mode
        let cellColor = '#1a1a3a';
        let strokeColor = '#3a3a5a';
        if (LiveView.state.active && irradiance > 0) {
            const brightness = Math.round(30 + irradiance * 40);
            cellColor = `rgb(${brightness}, ${brightness}, ${brightness + 30})`;
            strokeColor = `rgb(${brightness + 20}, ${brightness + 20}, ${brightness + 50})`;
        }
        
        for (let i = 0; i < cellsX; i++) {
            for (let j = 0; j < cellsY; j++) {
                g.append("rect")
                    .attr("x", 4 + i * cellW + 1)
                    .attr("y", 4 + j * cellH + 1)
                    .attr("width", cellW - 2)
                    .attr("height", cellH - 2)
                    .attr("fill", cellColor)
                    .attr("stroke", strokeColor)
                    .attr("stroke-width", 0.5);
            }
        }
        
        // Label - show current output in live mode
        if (LiveView.state.active) {
            g.append("text")
                .attr("x", d.width / 2)
                .attr("y", d.height - 8)
                .attr("text-anchor", "middle")
                .attr("fill", irradiance > 0 ? "#f0ad4e" : "#666")
                .attr("font-size", "10px")
                .attr("font-weight", "bold")
                .text(`${currentOutput}W`);
        } else {
            g.append("text")
                .attr("x", d.width / 2)
                .attr("y", d.height - 8)
                .attr("text-anchor", "middle")
                .attr("fill", "#fff")
                .attr("font-size", "10px")
                .attr("font-weight", "bold")
                .text(`${d.specs.wmp}W`);
        }
    }
    
    function renderBattery(g, d) {
        // Get SOC from simulation
        const soc = Simulation.batterySOC[d.id] !== undefined ? Simulation.batterySOC[d.id] : 0.8;
        const socPercent = Math.round(soc * 100);
        
        // Apply glow based on charge/discharge state and SOC
        // Battery should glow green (stronger when charging) and show SOC progress bar
        if (LiveView.state.active) {
            const batteryFlow = Simulation.currentBatteryFlow;
            if (batteryFlow > 50) {
                // Charging - strong green glow
                g.attr("filter", "url(#solar-green-glow)");
            } else if (batteryFlow < -50) {
                // Discharging - amber/red glow
                g.attr("filter", "url(#solar-red-glow)");
            } else {
                // Idle but in live mode - subtle green glow to indicate battery presence
                g.attr("filter", "url(#solar-green-glow-subtle)");
            }
        } else {
            g.attr("filter", "url(#solar-shadow)");
        }
        
        // Battery terminal bump
        g.append("rect")
            .attr("x", d.width * 0.35)
            .attr("y", -3)
            .attr("width", d.width * 0.3)
            .attr("height", 6)
            .attr("fill", "#4a4a4a")
            .attr("rx", 2);
        
        // Capacity bar background
        g.append("rect")
            .attr("x", 4)
            .attr("y", 4)
            .attr("width", d.width - 8)
            .attr("height", d.height - 8)
            .attr("fill", "#1a2a1a")
            .attr("rx", 3);
        
        // SOC fill bar (shown in live mode)
        if (LiveView.state.active) {
            const barWidth = (d.width - 12) * soc;
            let fillColor = '#5cb85c';
            if (soc < 0.2) fillColor = '#d9534f';
            else if (soc < 0.5) fillColor = '#f0ad4e';
            
            g.append("rect")
                .attr("class", "battery-soc-fill")
                .attr("x", 6)
                .attr("y", 6)
                .attr("width", barWidth)
                .attr("height", d.height - 12)
                .attr("fill", fillColor)
                .attr("opacity", 0.6)
                .attr("rx", 2);
            
            // SOC percentage text
            g.append("text")
                .attr("class", "battery-soc")
                .attr("x", d.width / 2)
                .attr("y", d.height / 2 + 3)
                .attr("text-anchor", "middle")
                .attr("fill", "#fff")
                .attr("font-size", "12px")
                .attr("font-weight", "bold")
                .text(`${socPercent}%`);
        } else {
            // Labels (build mode)
            g.append("text")
                .attr("class", "battery-voltage")
                .attr("x", d.width / 2)
                .attr("y", d.height / 2 - 5)
                .attr("text-anchor", "middle")
                .attr("fill", "#5cb85c")
                .attr("font-size", "11px")
                .attr("font-weight", "bold")
                .text(`${d.specs.voltage}V`);
            
            g.append("text")
                .attr("class", "battery-ah")
                .attr("x", d.width / 2)
                .attr("y", d.height / 2 + 10)
                .attr("text-anchor", "middle")
                .attr("fill", "#aaa")
                .attr("font-size", "9px")
                .text(`${d.specs.ah}Ah`);
        }
    }
    
    function renderController(g, d) {
        const isHybrid = d.subtype === 'hybrid_inverter' || d.subtype === 'all_in_one';
        const isAllInOne = d.subtype === 'all_in_one';
        
        // Get SOC for all-in-one units
        const soc = isAllInOne && Simulation.batterySOC[d.id] !== undefined ? Simulation.batterySOC[d.id] : 0.8;
        const socPercent = Math.round(soc * 100);
        
        // Top section (gray for panel input)
        g.append("rect")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", d.width)
            .attr("height", d.height * 0.4)
            .attr("fill", "#4a4a4a")
            .attr("rx", 6);
        
        // Type label
        let typeLabel = "MPPT";
        if (d.subtype === 'hybrid_inverter') typeLabel = "HYBRID";
        if (d.subtype === 'all_in_one') typeLabel = "AIO";
        
        g.append("text")
            .attr("x", d.width / 2)
            .attr("y", 15)
            .attr("text-anchor", "middle")
            .attr("fill", "#f0ad4e")
            .attr("font-size", "10px")
            .attr("font-weight", "bold")
            .text(typeLabel);
        
        // For all-in-one units in live mode, show battery SOC
        if (isAllInOne && LiveView.state.active) {
            // SOC bar background
            g.append("rect")
                .attr("x", 6)
                .attr("y", d.height * 0.45)
                .attr("width", d.width - 12)
                .attr("height", 16)
                .attr("fill", "#1a2a1a")
                .attr("rx", 3);
            
            // SOC fill
            const barWidth = (d.width - 16) * soc;
            let fillColor = '#5cb85c';
            if (soc < 0.2) fillColor = '#d9534f';
            else if (soc < 0.5) fillColor = '#f0ad4e';
            
            g.append("rect")
                .attr("x", 8)
                .attr("y", d.height * 0.45 + 2)
                .attr("width", barWidth)
                .attr("height", 12)
                .attr("fill", fillColor)
                .attr("opacity", 0.7)
                .attr("rx", 2);
            
            g.append("text")
                .attr("x", d.width / 2)
                .attr("y", d.height * 0.45 + 12)
                .attr("text-anchor", "middle")
                .attr("fill", "#fff")
                .attr("font-size", "9px")
                .attr("font-weight", "bold")
                .text(`🔋 ${socPercent}%`);
            
            // AC output label
            if (d.specs.maxACOutputW) {
                g.append("text")
                    .attr("x", d.width / 2)
                    .attr("y", d.height - 8)
                    .attr("text-anchor", "middle")
                    .attr("fill", "#f0ad4e")
                    .attr("font-size", "8px")
                    .text(`AC: ${d.specs.maxACOutputW}W`);
            }
        } else {
            // Build mode - show specs
            g.append("text")
                .attr("x", d.width / 2)
                .attr("y", d.height / 2 + 5)
                .attr("text-anchor", "middle")
                .attr("fill", "#fff")
                .attr("font-size", "9px")
                .text(`${d.specs.maxWmp}W`);
            
            g.append("text")
                .attr("x", d.width / 2)
                .attr("y", d.height / 2 + 18)
                .attr("text-anchor", "middle")
                .attr("fill", "#aaa")
                .attr("font-size", "8px")
                .text(`${d.specs.maxVoc}V/${d.specs.maxIsc}A`);
            
            if (isHybrid && d.specs.maxACOutputW) {
                g.append("text")
                    .attr("x", d.width / 2)
                    .attr("y", d.height - 10)
                    .attr("text-anchor", "middle")
                    .attr("fill", "#f0ad4e")
                    .attr("font-size", "8px")
                    .text(`AC: ${d.specs.maxACOutputW}W`);
            }
        }
    }
    
    function renderBreaker(g, d) {
        const isAC = d.type === 'acbreaker';
        const isTripped = LiveView.state.active && LiveView.state.breakerStates[d.id]?.wasTripped;
        
        // Determine colors based on state
        let trackColor = d.isClosed ? "#2a4a2a" : "#4a2a2a";
        let leverColor = d.isClosed ? "#5cb85c" : "#d9534f";
        let strokeWidth = 2;
        
        if (isTripped) {
            trackColor = "#4a2020";
            leverColor = "#ff4444";
            strokeWidth = 3;
        }
        
        // Switch track
        g.append("rect")
            .attr("class", "breaker-track")
            .attr("x", d.width * 0.2)
            .attr("y", d.height * 0.35)
            .attr("width", d.width * 0.6)
            .attr("height", d.height * 0.3)
            .attr("fill", trackColor)
            .attr("stroke", isTripped ? "#ff6600" : (d.isClosed ? "#5cb85c" : "#d9534f"))
            .attr("stroke-width", strokeWidth)
            .attr("rx", 4);
        
        // Switch lever
        g.append("rect")
            .attr("class", "breaker-lever")
            .attr("x", d.isClosed ? d.width * 0.5 : d.width * 0.25)
            .attr("y", d.height * 0.35)
            .attr("width", d.width * 0.25)
            .attr("height", d.height * 0.3)
            .attr("fill", leverColor)
            .attr("rx", 3)
            .style("cursor", "pointer")
            .on("click", (event) => {
                event.stopPropagation();
                d.isClosed = !d.isClosed;
                // Clear tripped flag when manually toggling
                if (LiveView.state.breakerStates[d.id]) {
                    LiveView.state.breakerStates[d.id].wasTripped = false;
                }
                calculatePowerFlow();
                render();
            });
        
        // Rating label
        g.append("text")
            .attr("x", d.width / 2)
            .attr("y", d.height - 8)
            .attr("text-anchor", "middle")
            .attr("fill", isTripped ? "#ff6600" : (isAC ? "#f0ad4e" : "#5bc0de"))
            .attr("font-size", "9px")
            .attr("font-weight", "bold")
            .text(`${d.specs.rating}A`);
        
        // Show TRIPPED indicator
        if (isTripped) {
            g.append("text")
                .attr("x", d.width / 2)
                .attr("y", d.height * 0.2)
                .attr("text-anchor", "middle")
                .attr("fill", "#ff6600")
                .attr("font-size", "7px")
                .attr("font-weight", "bold")
                .text("TRIPPED");
        }
    }
    
    function renderOutlet(g, d) {
        const is240V = d.specs.voltage === 240;
        
        // Outlet face
        g.append("rect")
            .attr("x", 8)
            .attr("y", 15)
            .attr("width", d.width - 16)
            .attr("height", d.height - 30)
            .attr("fill", "#1a1a1a")
            .attr("rx", 4);
        
        // Outlet slots
        const slotY = 25;
        g.append("rect")
            .attr("x", d.width * 0.25)
            .attr("y", slotY)
            .attr("width", 4)
            .attr("height", 12)
            .attr("fill", "#333");
        g.append("rect")
            .attr("x", d.width * 0.65)
            .attr("y", slotY)
            .attr("width", 4)
            .attr("height", 12)
            .attr("fill", "#333");
        
        // Ground
        g.append("circle")
            .attr("cx", d.width / 2)
            .attr("cy", slotY + 22)
            .attr("r", 3)
            .attr("fill", "#333");
        
        // Voltage label
        g.append("text")
            .attr("x", d.width / 2)
            .attr("y", d.height - 5)
            .attr("text-anchor", "middle")
            .attr("fill", is240V ? "#ff6b6b" : "#f0ad4e")
            .attr("font-size", "9px")
            .attr("font-weight", "bold")
            .text(`${d.specs.voltage}V`);
    }
    
    function renderLoad(g, d) {
        const isOn = LiveView.state.loadStates[d.id];
        const is240V = d.specs.voltage === 240;
        
        // Apply glow when load is active
        if (LiveView.state.active && isOn) {
            g.attr("filter", "url(#solar-yellow-glow)");
        } else {
            g.attr("filter", "url(#solar-shadow)");
        }
        
        // Icon circle background
        g.append("circle")
            .attr("cx", d.width / 2)
            .attr("cy", d.height / 2 - 8)
            .attr("r", 14)
            .attr("fill", isOn ? (is240V ? "#ff6b6b" : "#ffd700") : "#3a3a3a")
            .attr("stroke", is240V ? "#d9534f" : "#f0ad4e")
            .attr("stroke-width", 2);
        
        // Icon text
        g.append("text")
            .attr("x", d.width / 2)
            .attr("y", d.height / 2 - 5)
            .attr("text-anchor", "middle")
            .attr("font-size", "12px")
            .attr("pointer-events", "none")
            .text(d.specs.icon || "💡");
        
        // Watts label - use class for easy updates
        const wattsLabel = g.append("text")
            .attr("class", "load-watts")
            .attr("x", d.width / 2)
            .attr("y", d.height - 4)
            .attr("text-anchor", "middle")
            .attr("fill", isOn ? "#ffd700" : "#aaa")
            .attr("font-size", "9px")
            .attr("font-weight", "bold");
        
        wattsLabel.text(isOn ? `${d.specs.watts}W` : "OFF");
        
        // Voltage indicator for 240V
        if (is240V) {
            g.append("text")
                .attr("x", d.width - 4)
                .attr("y", 10)
                .attr("text-anchor", "end")
                .attr("fill", "#ff6b6b")
                .attr("font-size", "7px")
                .attr("font-weight", "bold")
                .text("240V");
        }
        
        // Make clickable for toggle in live mode
        g.style("cursor", "pointer")
            .on("dblclick", (event) => {
                event.stopPropagation();
                if (currentSolarMode === 'live' && LiveView.state.active) {
                    LiveView.state.loadStates[d.id] = !LiveView.state.loadStates[d.id];
                    
                    // Check voltage mismatch when turning load on
                    if (LiveView.state.loadStates[d.id]) {
                        // Find connected outlet
                        const loadConn = connections.find(c => 
                            (c.sourceItemId === d.id && allItems.find(i => i.id === c.targetItemId)?.type === 'acoutlet') ||
                            (c.targetItemId === d.id && allItems.find(i => i.id === c.sourceItemId)?.type === 'acoutlet')
                        );
                        
                        if (loadConn) {
                            const outlet = allItems.find(i => 
                                (i.id === loadConn.sourceItemId && i.type === 'acoutlet') ||
                                (i.id === loadConn.targetItemId && i.type === 'acoutlet')
                            );
                            
                            if (outlet) {
                                const outletVoltage = outlet.specs.voltage || 120;
                                const loadVoltage = d.specs.voltage || 120;
                                
                                if (loadVoltage === 240 && outletVoltage === 120) {
                                    LiveView.state.loadStates[d.id] = false; // Turn it back off
                                    showHint('Voltage Mismatch', `Cannot power ${loadVoltage}V load from ${outletVoltage}V outlet. This will damage equipment.`);
                                    return;
                                }
                            }
                        }
                    }
                    
                    calculatePowerFlow();
                    render();
                    updateStats();
                }
            });
    }
    
    function renderCombiner(g, d) {
        // Title
        g.append("text")
            .attr("x", d.width / 2)
            .attr("y", 15)
            .attr("text-anchor", "middle")
            .attr("fill", "#5bc0de")
            .attr("font-size", "9px")
            .attr("font-weight", "bold")
            .text("COMBINER");
        
        // Input count
        g.append("text")
            .attr("x", d.width / 2)
            .attr("y", d.height / 2 + 5)
            .attr("text-anchor", "middle")
            .attr("fill", "#aaa")
            .attr("font-size", "10px")
            .text(`${d.specs.inputs} strings`);
    }
    
    // ============================================
    // PHASE 2: ADVANCED COMPONENT RENDERING
    // ============================================
    
    function renderSolarCombinerBox(g, d) {
        // Title
        g.append("text")
            .attr("x", d.width / 2)
            .attr("y", 14)
            .attr("text-anchor", "middle")
            .attr("fill", "#5bc0de")
            .attr("font-size", "9px")
            .attr("font-weight", "bold")
            .text("SOLAR COMBINER");
        
        // Per-string breaker indicators
        const inputs = d.specs.inputs;
        for (let i = 0; i < inputs; i++) {
            const xRatio = (i + 0.5) / inputs;
            const isClosed = d.breakerStates ? d.breakerStates[i] : true;
            
            // Breaker slot
            g.append("rect")
                .attr("class", `string-breaker-${i}`)
                .attr("x", d.width * xRatio - 8)
                .attr("y", 25)
                .attr("width", 16)
                .attr("height", 20)
                .attr("fill", isClosed ? "#2a4a2a" : "#4a2a2a")
                .attr("stroke", isClosed ? "#5cb85c" : "#d9534f")
                .attr("stroke-width", 1)
                .attr("rx", 2)
                .attr("cursor", "pointer")
                .on("click", (event) => {
                    event.stopPropagation();
                    if (d.breakerStates) {
                        d.breakerStates[i] = !d.breakerStates[i];
                        render();
                    }
                });
            
            // Breaker number
            g.append("text")
                .attr("x", d.width * xRatio)
                .attr("y", 39)
                .attr("text-anchor", "middle")
                .attr("fill", "#fff")
                .attr("font-size", "8px")
                .text(i + 1);
        }
        
        // Rating info
        g.append("text")
            .attr("x", d.width / 2)
            .attr("y", d.height - 10)
            .attr("text-anchor", "middle")
            .attr("fill", "#aaa")
            .attr("font-size", "8px")
            .text(`${d.specs.breakerRating}A | ${d.specs.maxVoltage}V`);
    }
    
    function renderBreakerPanel(g, d) {
        // Panel label
        g.append("text")
            .attr("x", d.width / 2)
            .attr("y", 14)
            .attr("text-anchor", "middle")
            .attr("fill", "#f0ad4e")
            .attr("font-size", "9px")
            .attr("font-weight", "bold")
            .text("BREAKER PANEL");
        
        // Main breaker
        const mainOn = d.mainBreakerOn !== false;
        g.append("rect")
            .attr("class", "main-breaker")
            .attr("x", d.width / 2 - 20)
            .attr("y", 22)
            .attr("width", 40)
            .attr("height", 18)
            .attr("fill", mainOn ? "#2a4a2a" : "#4a2a2a")
            .attr("stroke", mainOn ? "#5cb85c" : "#d9534f")
            .attr("stroke-width", 2)
            .attr("rx", 3)
            .attr("cursor", "pointer")
            .on("click", (event) => {
                event.stopPropagation();
                d.mainBreakerOn = !d.mainBreakerOn;
                render();
                updateStats();
            });
        
        g.append("text")
            .attr("x", d.width / 2)
            .attr("y", 35)
            .attr("text-anchor", "middle")
            .attr("fill", "#fff")
            .attr("font-size", "9px")
            .attr("font-weight", "bold")
            .text(`MAIN ${mainOn ? 'ON' : 'OFF'}`);
        
        // Individual circuit breakers (4 per side)
        for (let i = 0; i < 8; i++) {
            const side = i < 4 ? 'left' : 'right';
            const row = i % 4;
            const xPos = side === 'left' ? 15 : d.width - 35;
            const yPos = 50 + row * 38;
            const isClosed = d.breakerStates ? d.breakerStates[i] : true;
            const handle = d.handles[`circuit${i + 1}`];
            
            // Check if tripped
            const breakerId = `${d.id}-circuit-${i + 1}`;
            const isTripped = LiveView.state.active && LiveView.state.breakerStates[breakerId]?.wasTripped;
            
            // Breaker slot
            const breakerRect = g.append("rect")
                .attr("class", `circuit-breaker-${i}`)
                .attr("x", xPos)
                .attr("y", yPos - 10)
                .attr("width", 20)
                .attr("height", 24)
                .attr("fill", isTripped ? "#4a2020" : (isClosed ? "#2a3a2a" : "#3a2a2a"))
                .attr("stroke", isTripped ? "#ff6600" : (isClosed ? "#5cb85c" : "#d9534f"))
                .attr("stroke-width", isTripped ? 2 : 1)
                .attr("rx", 2)
                .attr("cursor", "pointer");
            
            if (isTripped) {
                breakerRect.classed('failure-breaker-tripped', true);
            }
            
            breakerRect.on("click", (event) => {
                event.stopPropagation();
                if (!d.breakerStates) d.breakerStates = Array(8).fill(true);
                d.breakerStates[i] = !d.breakerStates[i];
                
                // Clear tripped state when manually toggling
                if (LiveView.state.active && LiveView.state.breakerStates[breakerId]) {
                    LiveView.state.breakerStates[breakerId].wasTripped = false;
                }
                
                calculatePowerFlow();
                render();
                updateStats();
                updatePropertiesPanel();
            });
            
            // Circuit label
            g.append("text")
                .attr("x", side === 'left' ? xPos + 25 : xPos - 5)
                .attr("y", yPos + 4)
                .attr("text-anchor", side === 'left' ? "start" : "end")
                .attr("fill", "#aaa")
                .attr("font-size", "7px")
                .text(handle?.circuitName || `C${i + 1}`);
            
            // Rating
            g.append("text")
                .attr("x", xPos + 10)
                .attr("y", yPos + 2)
                .attr("text-anchor", "middle")
                .attr("fill", isTripped ? "#ff6600" : "#fff")
                .attr("font-size", "7px")
                .attr("font-weight", isTripped ? "bold" : "normal")
                .text(isTripped ? "TRIP" : `${handle?.maxAmps || handle?.rating || 20}A`);
        }
    }
    
    function renderSpiderBox(g, d) {
        // Title
        g.append("text")
            .attr("x", d.width / 2)
            .attr("y", 12)
            .attr("text-anchor", "middle")
            .attr("fill", "#f0ad4e")
            .attr("font-size", "9px")
            .attr("font-weight", "bold")
            .text("SPIDER BOX");
        
        // Main input indicator
        const mainOn = d.mainBreakerOn !== false;
        g.append("rect")
            .attr("x", 5)
            .attr("y", d.height / 2 - 15)
            .attr("width", 25)
            .attr("height", 30)
            .attr("fill", mainOn ? "#2a4a2a" : "#4a2a2a")
            .attr("stroke", mainOn ? "#5cb85c" : "#d9534f")
            .attr("stroke-width", 1.5)
            .attr("rx", 3)
            .attr("cursor", "pointer")
            .on("click", (event) => {
                event.stopPropagation();
                d.mainBreakerOn = !d.mainBreakerOn;
                render();
                updateStats();
            });
        
        g.append("text")
            .attr("x", 17)
            .attr("y", d.height / 2 + 4)
            .attr("text-anchor", "middle")
            .attr("fill", "#fff")
            .attr("font-size", "7px")
            .text(mainOn ? "50A" : "OFF");
        
        // Circuit outputs (6 on right side) - make them clickable
        const circuits = d.specs.circuits;
        circuits.forEach((circuit, i) => {
            const yPos = 15 + i * 14;
            const handle = d.handles[`circuit${i + 1}`];
            const isClosed = handle?.isClosed !== false;
            const breakerId = `${d.id}-circuit-${i + 1}`;
            const isTripped = LiveView.state.active && LiveView.state.breakerStates[breakerId]?.wasTripped;
            
            // Circuit indicator box - clickable
            const circuitRect = g.append("rect")
                .attr("class", `spider-circuit-${i}`)
                .attr("x", d.width - 45)
                .attr("y", yPos - 5)
                .attr("width", 40)
                .attr("height", 10)
                .attr("fill", isTripped ? "#4a2020" : (isClosed ? "#2a3a3a" : "#3a2a2a"))
                .attr("stroke", isTripped ? "#ff6600" : (circuit.voltage === 240 ? "#d9534f" : "#f0ad4e"))
                .attr("stroke-width", isTripped ? 2 : 0.5)
                .attr("rx", 2)
                .attr("cursor", "pointer");
            
            if (isTripped) {
                circuitRect.classed('failure-breaker-tripped', true);
            }
            
            circuitRect.on("click", (event) => {
                event.stopPropagation();
                if (handle) {
                    handle.isClosed = !handle.isClosed;
                    
                    // Clear tripped state when manually toggling
                    if (LiveView.state.active && LiveView.state.breakerStates[breakerId]) {
                        LiveView.state.breakerStates[breakerId].wasTripped = false;
                    }
                    
                    calculatePowerFlow();
                    render();
                    updateStats();
                    updatePropertiesPanel();
                }
            });
            
            // Circuit label
            g.append("text")
                .attr("x", d.width - 25)
                .attr("y", yPos + 3)
                .attr("text-anchor", "middle")
                .attr("fill", isTripped ? "#ff6600" : "#fff")
                .attr("font-size", "7px")
                .attr("font-weight", isTripped ? "bold" : "normal")
                .text(isTripped ? "TRIP" : circuit.name);
        });
    }
    
    function renderDoubleVoltageHub(g, d) {
        // Title
        g.append("text")
            .attr("x", d.width / 2)
            .attr("y", 12)
            .attr("text-anchor", "middle")
            .attr("fill", "#5cb85c")
            .attr("font-size", "8px")
            .attr("font-weight", "bold")
            .text("VOLTAGE HUB");
        
        // Input indicators
        g.append("text")
            .attr("x", 10)
            .attr("y", d.height * 0.33 + 4)
            .attr("text-anchor", "start")
            .attr("fill", "#aaa")
            .attr("font-size", "8px")
            .text("IN 1");
        
        g.append("text")
            .attr("x", 10)
            .attr("y", d.height * 0.67 + 4)
            .attr("text-anchor", "start")
            .attr("fill", "#aaa")
            .attr("font-size", "8px")
            .text("IN 2");
        
        // Parallel symbol
        g.append("text")
            .attr("x", d.width / 2)
            .attr("y", d.height / 2 - 5)
            .attr("text-anchor", "middle")
            .attr("fill", "#5cb85c")
            .attr("font-size", "14px")
            .text("⚡");
        
        // Output label
        g.append("text")
            .attr("x", d.width / 2)
            .attr("y", d.height - 8)
            .attr("text-anchor", "middle")
            .attr("fill", "#f0ad4e")
            .attr("font-size", "8px")
            .text("240V OUT");
    }
    
    function renderSmartBattery(g, d) {
        // Get SOC from simulation
        const soc = Simulation.batterySOC[d.id] !== undefined ? Simulation.batterySOC[d.id] : 0.8;
        const socPercent = Math.round(soc * 100);
        
        // Battery icon
        g.append("rect")
            .attr("x", d.width * 0.35)
            .attr("y", 5)
            .attr("width", d.width * 0.3)
            .attr("height", 4)
            .attr("fill", "#4a5a4a")
            .attr("rx", 1);
        
        // Title
        g.append("text")
            .attr("x", d.width / 2)
            .attr("y", 18)
            .attr("text-anchor", "middle")
            .attr("fill", "#5cb85c")
            .attr("font-size", "7px")
            .attr("font-weight", "bold")
            .text("SMART BATTERY");
        
        // Capacity display background
        g.append("rect")
            .attr("x", 8)
            .attr("y", 24)
            .attr("width", d.width - 16)
            .attr("height", 26)
            .attr("fill", "#1a2a1a")
            .attr("rx", 3);
        
        if (LiveView.state.active) {
            // SOC fill bar
            const barWidth = (d.width - 20) * soc;
            let fillColor = '#5cb85c';
            if (soc < 0.2) fillColor = '#d9534f';
            else if (soc < 0.5) fillColor = '#f0ad4e';
            
            g.append("rect")
                .attr("x", 10)
                .attr("y", 26)
                .attr("width", barWidth)
                .attr("height", 22)
                .attr("fill", fillColor)
                .attr("opacity", 0.6)
                .attr("rx", 2);
            
            // SOC percentage
            g.append("text")
                .attr("x", d.width / 2)
                .attr("y", 41)
                .attr("text-anchor", "middle")
                .attr("fill", "#fff")
                .attr("font-size", "11px")
                .attr("font-weight", "bold")
                .text(`${socPercent}%`);
        } else {
            // Capacity label (build mode)
            g.append("text")
                .attr("x", d.width / 2)
                .attr("y", 41)
                .attr("text-anchor", "middle")
                .attr("fill", "#5cb85c")
                .attr("font-size", "11px")
                .attr("font-weight", "bold")
                .text(`${d.specs.kWh} kWh`);
        }
        
        // Smart port indicators
        g.append("text")
            .attr("x", d.width - 8)
            .attr("y", d.height - 8)
            .attr("text-anchor", "end")
            .attr("fill", "#aaa")
            .attr("font-size", "5px")
            .text("◀ SMART");
        
        g.append("text")
            .attr("x", 8)
            .attr("y", d.height - 8)
            .attr("text-anchor", "start")
            .attr("fill", "#aaa")
            .attr("font-size", "5px")
            .text("SMART ▶");
    }
    
    // ============================================
    // PHASE 6: PRODUCER & CONTAINER RENDERING
    // ============================================
    
    function renderProducer(g, d) {
        const isOn = LiveView.state.loadStates[d.id];
        const recipe = d.specs.recipe;
        const resourceInfo = RESOURCE_TYPES[recipe.output] || { color: '#888', icon: '📦' };
        
        // Icon
        g.append("text")
            .attr("x", d.width / 2)
            .attr("y", 20)
            .attr("text-anchor", "middle")
            .attr("font-size", "16px")
            .text(d.specs.icon);
        
        // Name
        g.append("text")
            .attr("x", d.width / 2)
            .attr("y", 35)
            .attr("text-anchor", "middle")
            .attr("fill", "#fff")
            .attr("font-size", "7px")
            .attr("font-weight", "bold")
            .text(d.specs.name);
        
        // Production rate
        if (LiveView.state.active) {
            const currentRate = isOn ? recipe.rate : 0;
            g.append("text")
                .attr("x", d.width / 2)
                .attr("y", 48)
                .attr("text-anchor", "middle")
                .attr("fill", isOn ? resourceInfo.color : "#666")
                .attr("font-size", "8px")
                .text(isOn ? `${currentRate} ${recipe.unit}` : "OFF");
            
            // Internal storage indicator
            if (d.specs.tankSize && d.internalStorage > 0) {
                const fillPct = d.internalStorage / d.specs.tankSize;
                g.append("rect")
                    .attr("x", 5)
                    .attr("y", d.height - 12)
                    .attr("width", d.width - 10)
                    .attr("height", 6)
                    .attr("fill", "#1a2a1a")
                    .attr("rx", 2);
                g.append("rect")
                    .attr("x", 6)
                    .attr("y", d.height - 11)
                    .attr("width", (d.width - 12) * fillPct)
                    .attr("height", 4)
                    .attr("fill", resourceInfo.color)
                    .attr("opacity", 0.7)
                    .attr("rx", 1);
            }
        } else {
            // Power rating
            g.append("text")
                .attr("x", d.width / 2)
                .attr("y", 48)
                .attr("text-anchor", "middle")
                .attr("fill", "#f0ad4e")
                .attr("font-size", "8px")
                .text(`${d.specs.watts}W`);
            
            // Output type
            g.append("text")
                .attr("x", d.width / 2)
                .attr("y", d.height - 6)
                .attr("text-anchor", "middle")
                .attr("fill", resourceInfo.color)
                .attr("font-size", "6px")
                .text(`→ ${resourceInfo.icon} ${recipe.rate} ${recipe.unit}`);
        }
    }
    
    function renderContainer(g, d) {
        const resourceInfo = RESOURCE_TYPES[d.specs.resource] || { color: '#888', icon: '📦', name: 'Unknown' };
        const level = ResourceSystem.getContainerLevel(d.id, d.specs.capacity);
        const levelPct = Math.round(level * 100);
        const currentAmount = (ResourceSystem.containerLevels[d.id] || 0).toFixed(1);
        
        // Tank body
        g.append("rect")
            .attr("x", 8)
            .attr("y", 15)
            .attr("width", d.width - 16)
            .attr("height", d.height - 30)
            .attr("fill", "#1a2a3a")
            .attr("stroke", resourceInfo.color)
            .attr("stroke-width", 1)
            .attr("rx", 4);
        
        // Fill level
        const fillHeight = (d.height - 34) * level;
        if (fillHeight > 0) {
            g.append("rect")
                .attr("x", 10)
                .attr("y", 17 + (d.height - 34) - fillHeight)
                .attr("width", d.width - 20)
                .attr("height", fillHeight)
                .attr("fill", resourceInfo.color)
                .attr("opacity", 0.6)
                .attr("rx", 3);
        }
        
        // Icon at top
        g.append("text")
            .attr("x", d.width / 2)
            .attr("y", 10)
            .attr("text-anchor", "middle")
            .attr("font-size", "10px")
            .text(d.specs.icon);
        
        // Level percentage in center
        g.append("text")
            .attr("x", d.width / 2)
            .attr("y", d.height / 2 + 5)
            .attr("text-anchor", "middle")
            .attr("fill", "#fff")
            .attr("font-size", "12px")
            .attr("font-weight", "bold")
            .text(`${levelPct}%`);
        
        // Capacity at bottom
        g.append("text")
            .attr("x", d.width / 2)
            .attr("y", d.height - 5)
            .attr("text-anchor", "middle")
            .attr("fill", "#aaa")
            .attr("font-size", "6px")
            .text(`${currentAmount}/${d.specs.capacity} ${d.specs.unit}`);
    }
    
    function renderHandles(g, d) {
        Object.entries(d.handles).forEach(([key, handle]) => {
            let fillColor = '#70a0d0';
            let strokeColor = '#4a7aa0';
            let symbol = '';
            
            if (handle.polarity === 'positive' || handle.polarity === 'pv-positive') {
                fillColor = '#d9534f';
                strokeColor = '#a0403a';
                symbol = '+';
            } else if (handle.polarity === 'negative' || handle.polarity === 'pv-negative') {
                fillColor = '#333';
                strokeColor = '#222';
                symbol = '−';
            } else if (handle.polarity === 'ac') {
                fillColor = '#f0ad4e';
                strokeColor = '#ffd700';
                symbol = '~';
            } else if (handle.polarity === 'load') {
                fillColor = '#f0ad4e';
                strokeColor = '#d0a040';
            } else if (handle.polarity === 'parallel') {
                fillColor = '#5cb85c';
                strokeColor = '#4a9a4a';
                symbol = '‖';
            } else if (handle.polarity === 'smart-battery') {
                fillColor = '#5bc0de';
                strokeColor = '#3aa0be';
                symbol = '⬤';
            } else if (handle.polarity === 'pipe') {
                fillColor = '#3498db';
                strokeColor = '#2980b9';
                symbol = '○';
            }
            
            g.append("circle")
                .attr("class", `handle ${handle.polarity}`)
                .attr("cx", handle.x)
                .attr("cy", handle.y)
                .attr("r", 10)
                .attr("fill", fillColor)
                .attr("stroke", strokeColor)
                .attr("stroke-width", 2)
                .attr("data-handle-key", key)
                .style("cursor", "pointer")
                .call(d3.drag()
                    .on("start", (event) => handleDragStart(event, d, key, handle))
                    .on("drag", handleDragMove)
                    .on("end", handleDragEnd)
                );
            
            if (symbol) {
                g.append("text")
                    .attr("x", handle.x)
                    .attr("y", handle.y)
                    .attr("text-anchor", "middle")
                    .attr("dominant-baseline", "central")
                    .attr("fill", "#fff")
                    .attr("font-size", "12px")
                    .attr("font-weight", "bold")
                    .attr("pointer-events", "none")
                    .text(symbol);
            }
        });
    }
    
    function updateItemContent(g, d) {
        // Update load visual state
        if (d.type === 'acload') {
            const isOn = LiveView.state.loadStates[d.id];
            const is240V = d.specs.voltage === 240;
            
            g.select("circle")
                .attr("fill", isOn ? (is240V ? "#ff6b6b" : "#ffd700") : "#3a3a3a");
            
            // Update label text
            const wattsLabel = g.select(".load-watts");
            if (!wattsLabel.empty()) {
                wattsLabel
                    .text(isOn ? `${d.specs.watts}W` : "OFF")
                    .attr("fill", isOn ? "#ffd700" : "#aaa");
            }
            
            // Update glow filter
            if (LiveView.state.active) {
                g.attr("filter", isOn ? "url(#solar-yellow-glow)" : "url(#solar-shadow)");
            }
        }
        
        // Update breaker visual state
        if (d.type === 'acbreaker' || d.type === 'dcbreaker') {
            const isTripped = LiveView.state.active && LiveView.state.breakerStates[d.id]?.wasTripped;
            let trackColor = d.isClosed ? "#2a4a2a" : "#4a2a2a";
            let leverColor = d.isClosed ? "#5cb85c" : "#d9534f";
            
            if (isTripped) {
                trackColor = "#4a2020";
                leverColor = "#ff4444";
            }
            
            g.select(".breaker-track")
                .attr("fill", trackColor)
                .attr("stroke", isTripped ? "#ff6600" : (d.isClosed ? "#5cb85c" : "#d9534f"))
                .attr("stroke-width", isTripped ? 3 : 2);
            
            g.select(".breaker-lever")
                .attr("x", d.isClosed ? d.width * 0.5 : d.width * 0.25)
                .attr("fill", leverColor);
        }
        
        // Update breaker panel circuit states
        if (d.type === 'breakerpanel') {
            if (!d.breakerStates) d.breakerStates = Array(8).fill(true);
            
            for (let i = 0; i < 8; i++) {
                const isClosed = d.breakerStates[i] !== false;
                const breakerId = `${d.id}-circuit-${i + 1}`;
                const isTripped = LiveView.state.active && LiveView.state.breakerStates[breakerId]?.wasTripped;
                const circuitRect = g.select(`.circuit-breaker-${i}`);
                
                if (!circuitRect.empty()) {
                    circuitRect
                        .attr("fill", isTripped ? "#4a2020" : (isClosed ? "#2a3a2a" : "#3a2a2a"))
                        .attr("stroke", isTripped ? "#ff6600" : (isClosed ? "#5cb85c" : "#d9534f"))
                        .attr("stroke-width", isTripped ? 2 : 1);
                    
                    if (isTripped) {
                        circuitRect.classed('failure-breaker-tripped', true);
                    } else {
                        circuitRect.classed('failure-breaker-tripped', false);
                    }
                }
            }
        }
        
        // Update spiderbox circuit states
        if (d.type === 'spiderbox') {
            if (d.specs.circuits) {
                d.specs.circuits.forEach((circuit, i) => {
                    const handle = d.handles[`circuit${i + 1}`];
                    const isClosed = handle?.isClosed !== false;
                    const breakerId = `${d.id}-circuit-${i + 1}`;
                    const isTripped = LiveView.state.active && LiveView.state.breakerStates[breakerId]?.wasTripped;
                    const circuitRect = g.select(`.spider-circuit-${i}`);
                    
                    if (!circuitRect.empty()) {
                        circuitRect
                            .attr("fill", isTripped ? "#4a2020" : (isClosed ? "#2a3a3a" : "#3a2a2a"))
                            .attr("stroke", isTripped ? "#ff6600" : (circuit.voltage === 240 ? "#d9534f" : "#f0ad4e"))
                            .attr("stroke-width", isTripped ? 2 : 0.5);
                        
                        if (isTripped) {
                            circuitRect.classed('failure-breaker-tripped', true);
                        } else {
                            circuitRect.classed('failure-breaker-tripped', false);
                        }
                    }
                });
            }
        }
    }
    
    // ============================================
    // DRAG HANDLERS
    // ============================================
    
    function itemDragStart(event, d) {
        if (event.sourceEvent.target.closest('.handle')) return;
        
        // Check if this is array move mode
        if (arrayMoveMode && selectedPanels.some(p => p.id === d.id)) {
            isDragging = true;
            dragStartPos = { x: event.x, y: event.y };
            // Store initial positions of all selected panels
            arrayMoveInitialPositions = selectedPanels.map(p => ({ id: p.id, x: p.x, y: p.y }));
            return;
        }
        
        // Normal single-item drag
        isDragging = true;
        dragOffset.x = event.x - d.x;
        dragOffset.y = event.y - d.y;
        selectItem(d);
    }
    
    function itemDragMove(event, d) {
        if (!isDragging) return;
        
        // Check if this is array move mode
        if (arrayMoveMode && selectedPanels.some(p => p.id === d.id)) {
            const deltaX = event.x - dragStartPos.x;
            const deltaY = event.y - dragStartPos.y;
            
            // Move all selected panels by the same delta
            selectedPanels.forEach((panel, index) => {
                const initial = arrayMoveInitialPositions[index];
                if (initial && initial.id === panel.id) {
                    panel.x = initial.x + deltaX;
                    panel.y = initial.y + deltaY;
                }
            });
            render();
            return;
        }
        
        // Normal single-item drag
        d.x = event.x - dragOffset.x;
        d.y = event.y - dragOffset.y;
        render();
    }
    
    function itemDragEnd(event, d) {
        if (!isDragging) return;
        
        // Check if this was array move mode
        if (arrayMoveMode) {
            arrayMoveMode = false;
            render();
            updateStats();
            showToast(`Moved ${selectedPanels.length} panels`, 'success');
            isDragging = false;
            return;
        }
        
        // Check for drag-to-replace: if dragging over an existing component of the same type
        const transform = d3.zoomTransform(svg.node());
        const [mouseX, mouseY] = transform.invert([event.sourceEvent.offsetX, event.sourceEvent.offsetY]);
        
        // Find if there's another component of the same type at this position
        const overlappingItem = allItems.find(item => {
            if (item.id === d.id) return false; // Don't check self
            if (item.type !== d.type) return false; // Must be same type
            
            // Check if mouse is within item bounds (with some tolerance)
            const tolerance = Math.max(item.width, item.height) * 0.5;
            const dx = mouseX - item.x;
            const dy = mouseY - item.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            return distance < tolerance;
        });
        
        // If dragging from library (d has preset data), replace the overlapping item
        if (overlappingItem && d._replacementPreset) {
            const preset = d._replacementPreset;
            let presetType = 'panel';
            if (preset.wmp !== undefined) presetType = 'panel';
            else if (preset.voltage !== undefined || preset.ah !== undefined) presetType = 'battery';
            else if (preset.maxVoc !== undefined || preset.maxWmp !== undefined) presetType = 'controller';
            
            if (overlappingItem.type === presetType) {
                replaceComponent(overlappingItem, presetType, preset);
                // Remove the temporary dragged item
                const index = allItems.findIndex(i => i.id === d.id);
                if (index >= 0) {
                    allItems.splice(index, 1);
                }
                selectItem(overlappingItem);
                render();
                showToast(`Replaced ${overlappingItem.type} with ${preset.name}`, 'success');
                isDragging = false;
                return;
            }
        }
        
        // If dragging existing item onto another same-type item, replace it
        if (overlappingItem && d.type === overlappingItem.type && d.id !== overlappingItem.id) {
            // Check if user wants to replace (could add confirmation dialog here)
            // For now, we'll use a simple heuristic: if items are very close, replace
            const dx = d.x - overlappingItem.x;
            const dy = d.y - overlappingItem.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const threshold = Math.max(overlappingItem.width, overlappingItem.height) * 0.3;
            
            if (distance < threshold) {
                // Get preset for current item (if it matches a preset)
                let currentPreset = null;
                if (d.type === 'panel') {
                    currentPreset = PANEL_PRESETS.find(p => 
                        Math.abs(p.wmp - (d.specs.wmp || 0)) < 1 &&
                        Math.abs(p.vmp - (d.specs.vmp || 0)) < 1
                    );
                } else if (d.type === 'battery') {
                    currentPreset = BATTERY_PRESETS.find(p => 
                        Math.abs(p.voltage - (d.specs.voltage || 0)) < 1 &&
                        Math.abs(p.ah - (d.specs.ah || 0)) < 1
                    );
                } else if (d.type === 'controller') {
                    currentPreset = CONTROLLER_PRESETS.find(p => 
                        Math.abs(p.maxVoc - (d.specs.maxVoc || 0)) < 10 &&
                        Math.abs(p.maxWmp - (d.specs.maxWmp || 0)) < 100
                    );
                }
                
                if (currentPreset) {
                    replaceComponent(overlappingItem, d.type, currentPreset);
                    // Remove the dragged item
                    const index = allItems.findIndex(i => i.id === d.id);
                    if (index >= 0) {
                        allItems.splice(index, 1);
                    }
                    selectItem(overlappingItem);
                    render();
                    showToast(`Replaced ${overlappingItem.type}`, 'success');
                    isDragging = false;
                    return;
                }
            }
        }
        
        isDragging = false;
    }
    
    function handleDragStart(event, item, handleKey, handle) {
        event.sourceEvent.stopPropagation();
        draggingHandle = { item, handleKey, handle };
        
        const startX = item.x + handle.x;
        const startY = item.y + handle.y;
        
        tempWire = tempGroup.append("path")
            .attr("class", "wire temp-wire")
            .attr("stroke", "#888")
            .attr("stroke-width", 2)
            .attr("stroke-dasharray", "5,5")
            .attr("fill", "none")
            .attr("d", `M ${startX} ${startY} L ${startX} ${startY}`);
    }
    
    function handleDragMove(event) {
        if (!draggingHandle || !tempWire) return;
        
        const startX = draggingHandle.item.x + draggingHandle.handle.x;
        const startY = draggingHandle.item.y + draggingHandle.handle.y;
        
        const transform = d3.zoomTransform(svg.node());
        const [mouseX, mouseY] = transform.invert([event.sourceEvent.offsetX, event.sourceEvent.offsetY]);
        
        tempWire.attr("d", `M ${startX} ${startY} L ${mouseX} ${mouseY}`);
    }
    
    function handleDragEnd(event) {
        if (!draggingHandle) return;
        
        // Remove temp wire
        if (tempWire) {
            tempWire.remove();
            tempWire = null;
        }
        
        // Check if dropped on another handle
        const transform = d3.zoomTransform(svg.node());
        const [mouseX, mouseY] = transform.invert([event.sourceEvent.offsetX, event.sourceEvent.offsetY]);
        
        let targetFound = null;
        
        allItems.forEach(item => {
            if (item.id === draggingHandle.item.id) return;
            
            Object.entries(item.handles).forEach(([key, handle]) => {
                const hx = item.x + handle.x;
                const hy = item.y + handle.y;
                const dist = Math.sqrt((mouseX - hx) ** 2 + (mouseY - hy) ** 2);
                
                if (dist < 15 && canConnect(draggingHandle.handle, handle)) {
                    targetFound = { item, handleKey: key, handle };
                }
            });
        });
        
        if (targetFound) {
            createConnection(
                draggingHandle.item, draggingHandle.handleKey,
                targetFound.item, targetFound.handleKey
            );
            render();
        }
        
        draggingHandle = null;
    }
    
    // ============================================
    // SELECTION
    // ============================================
    
    function selectItem(item) {
        selectedItem = item;
        selectedConnection = null;
        // Clear array selection when selecting single item (unless it's a panel and we're in multi-select mode)
        if (!(item.type === 'panel' && selectedPanels.length > 0)) {
            selectedPanels = [];
        }
        render();
        updatePropertiesPanel();
    }
    
    function selectConnection(conn) {
        selectedConnection = conn;
        selectedItem = null;
        render();
        updatePropertiesPanel();
    }
    
    function deselectAll() {
        selectedItem = null;
        selectedConnection = null;
        render();
        updatePropertiesPanel();
    }
    
    function deleteSelected() {
        if (selectedConnection) {
            deleteConnection(selectedConnection);
            selectedConnection = null;
            render();
        } else if (selectedItem) {
            deleteItem(selectedItem);
            selectedItem = null;
            render();
        }
    }
    
    // ============================================
    // STATS
    // ============================================
    
    function updateStats() {
        let totalArrayWatts = 0;
        let totalBatteryKwh = 0;
        let totalACOutput = 0;
        let totalLoad = 0;
        let activeLoad = 0;
        let distributionCircuits = 0;
        
        allItems.forEach(item => {
            if (item.type === 'panel') {
                totalArrayWatts += item.specs.wmp || 0;
            } else if (item.type === 'battery') {
                totalBatteryKwh += item.specs.kWh || 0;
            } else if (item.type === 'smartbattery') {
                totalBatteryKwh += item.specs.kWh || 0;
            } else if (item.type === 'controller') {
                if (item.specs.maxACOutputW) {
                    totalACOutput += item.specs.maxACOutputW;
                }
                // All-in-one units have internal batteries
                if (item.specs.internalBatteryKWh) {
                    totalBatteryKwh += item.specs.internalBatteryKWh;
                }
            } else if (item.type === 'acload') {
                totalLoad += item.specs.watts || 0;
                if (LiveView.state.loadStates[item.id]) {
                    activeLoad += item.specs.watts || 0;
                }
            } else if (item.type === 'producer') {
                totalLoad += item.specs.watts || 0;
                if (LiveView.state.loadStates[item.id]) {
                    activeLoad += item.specs.watts || 0;
                }
            } else if (item.type === 'breakerpanel') {
                distributionCircuits += item.specs.circuits || 0;
            } else if (item.type === 'spiderbox') {
                distributionCircuits += (item.specs.circuits?.length || 0);
            } else if (item.type === 'doublevoltagehub') {
                // Double voltage hub can double effective output when combining two units
                const input1Connected = item.handles.input1?.connectedTo.length > 0;
                const input2Connected = item.handles.input2?.connectedTo.length > 0;
                if (input1Connected && input2Connected) {
                    totalACOutput += item.specs.maxOutputW || 0;
                }
            }
        });
        
        const arrayWattsEl = document.getElementById('stat-array-watts');
        const batteryKwhEl = document.getElementById('stat-battery-kwh');
        const acOutputEl = document.getElementById('stat-ac-output');
        if (arrayWattsEl) arrayWattsEl.textContent = `${totalArrayWatts} W`;
        if (batteryKwhEl) batteryKwhEl.textContent = `${totalBatteryKwh.toFixed(2)} kWh`;
        if (acOutputEl) acOutputEl.textContent = `${totalACOutput} W`;
        
        // Show active load in live mode
        const loadEl = document.getElementById('stat-total-load');
        if (loadEl) {
            if (LiveView.state.active && activeLoad > 0) {
                loadEl.textContent = `${activeLoad} / ${totalLoad} W`;
                loadEl.classList.toggle('danger', activeLoad > totalACOutput);
            } else {
                loadEl.textContent = `${totalLoad} W`;
                loadEl.classList.remove('danger');
            }
        }
        
        // Load ratio
        const ratioEl = document.getElementById('stat-load-ratio');
        if (ratioEl) {
            if (totalACOutput > 0) {
                const ratio = (totalLoad / totalACOutput * 100).toFixed(0);
                ratioEl.textContent = `${ratio}%`;
                ratioEl.classList.remove('success', 'danger');
                if (totalLoad > totalACOutput) {
                    ratioEl.classList.add('danger');
                } else if (totalLoad < totalACOutput * 0.8) {
                    ratioEl.classList.add('success');
                }
            } else {
                ratioEl.textContent = '—';
                ratioEl.classList.remove('success', 'danger');
            }
        }
        
        const componentCountEl = document.getElementById('stat-component-count');
        const connectionCountEl = document.getElementById('stat-connection-count');
        if (componentCountEl) componentCountEl.textContent = allItems.length;
        if (connectionCountEl) connectionCountEl.textContent = connections.length;
        
        // Calculate total cost
        let totalCost = 0;
        allItems.forEach(item => {
            totalCost += item.specs.cost || 0;
        });
        
        // Add wiring cost estimate
        connections.forEach(conn => {
            const wireInfo = WireSystem.calculateGauge(conn, allItems);
            if (wireInfo) {
                totalCost += wireInfo.distance * wireInfo.rating.cost;
            }
        });
        
        const costEl = document.getElementById('stat-total-cost');
        if (costEl) {
            if (totalCost >= 1000) {
                costEl.textContent = `$${(totalCost / 1000).toFixed(1)}k`;
            } else {
                costEl.textContent = `$${totalCost.toFixed(0)}`;
            }
        }
        
        // Update properties panel if item selected
        updatePropertiesPanel();
    }
    
    function updatePropertiesPanel() {
        const panel = document.getElementById('solar-properties-panel');
        const inspectorEmpty = document.getElementById('inspectorEmpty');
        
        // Show/hide empty state and properties panel
        if (!selectedItem && !selectedConnection) {
            if (panel) {
                panel.classList.add('hidden');
                panel.classList.remove('visible');
            }
            if (inspectorEmpty) inspectorEmpty.style.display = 'block';
            return;
        }
        
        // Show properties panel and hide empty state
        if (panel) {
            panel.classList.remove('hidden');
            panel.classList.add('visible');
        }
        if (inspectorEmpty) inspectorEmpty.style.display = 'none';
        
        // Switch to inspector tab when item is selected
        if (selectedItem || selectedConnection) {
            switchRightPanelTab('inspector');
        }
        
        // Handle wire/connection selection
        if (selectedConnection && !selectedItem) {
            panel.classList.add('visible');
            const wireInfo = WireSystem.calculateGauge(selectedConnection, allItems);
            
            document.getElementById('prop-icon').textContent = '🔌';
            document.getElementById('prop-name').textContent = 'Wire Connection';
            
            if (wireInfo) {
                const wireCost = (wireInfo.distance * wireInfo.rating.cost).toFixed(2);
                document.getElementById('prop-content').innerHTML = `
                    <div class="prop-section-title">Wire Specifications</div>
                    <div class="prop-row"><span class="prop-label">Recommended Gauge</span><span class="prop-value" style="color:#f0ad4e; font-weight:bold;">${wireInfo.gauge} AWG</span></div>
                    <div class="prop-row"><span class="prop-label">Max Current</span><span class="prop-value">${wireInfo.rating.amps} A</span></div>
                    <div class="prop-row"><span class="prop-label">Estimated Load</span><span class="prop-value">${wireInfo.estimatedAmps} A</span></div>
                    <div class="prop-row"><span class="prop-label">Distance</span><span class="prop-value">${wireInfo.distance} ft</span></div>
                    <div class="prop-row"><span class="prop-label">Resistance</span><span class="prop-value">${(wireInfo.rating.ohms * wireInfo.distance).toFixed(4)} Ω</span></div>
                    <div class="prop-row" style="margin-top:6px; padding-top:6px; border-top:1px solid var(--border-light);"><span class="prop-label">Wire Cost</span><span class="prop-value" style="color:#5cb85c;">$${wireCost}</span></div>
                `;
            } else {
                document.getElementById('prop-content').innerHTML = `
                    <div class="prop-row"><span class="prop-label">Status</span><span class="prop-value">Connected</span></div>
                `;
            }
            return;
        }
        
        if (!selectedItem) {
            return;
        }
        const item = selectedItem;
        const itemId = item.id; // Capture for closures
        
        // Update title
        let icon = '⚡';
        let name = item.type;
        
        if (item.type === 'panel') {
            icon = '☀️';
            name = `${item.specs.wmp}W Panel`;
        } else if (item.type === 'battery') {
            icon = '🔋';
            name = `${item.specs.voltage}V ${item.specs.ah}Ah`;
        } else if (item.type === 'controller') {
            icon = '⚡';
            name = item.specs.name || 'Controller';
        } else if (item.type === 'acload') {
            icon = item.specs.icon || '💡';
            name = item.specs.name || 'Load';
        } else if (item.type === 'acbreaker' || item.type === 'dcbreaker') {
            icon = '🔌';
            name = `${item.specs.rating}A Breaker`;
        } else if (item.type === 'acoutlet') {
            icon = '🔲';
            name = `${item.specs.voltage}V Outlet`;
        } else if (item.type === 'combiner') {
            icon = '📦';
            name = `${item.specs.inputs}-String Combiner`;
        } else if (item.type === 'solarcombiner') {
            icon = '🔆';
            name = `${item.specs.inputs}-String Solar Combiner`;
        } else if (item.type === 'breakerpanel') {
            icon = '🏠';
            name = 'Breaker Panel';
        } else if (item.type === 'spiderbox') {
            icon = '🕷️';
            name = 'Spider Box';
        } else if (item.type === 'doublevoltagehub') {
            icon = '⚡';
            name = 'Voltage Hub';
        } else if (item.type === 'smartbattery') {
            icon = '🔋';
            name = `${item.specs.kWh} kWh Smart Battery`;
        } else if (item.type === 'producer') {
            icon = item.specs.icon || '🏭';
            name = item.specs.name || 'Producer';
        } else if (item.type === 'container') {
            icon = item.specs.icon || '🛢️';
            name = item.specs.name || 'Container';
        }
        
        document.getElementById('prop-icon').textContent = icon;
        document.getElementById('prop-name').textContent = name;
        
        // Build properties content with EDITABLE inputs
        let html = '';
        
        if (item.type === 'panel') {
            // Build replacement dropdown
            const replacementOptions = PANEL_PRESETS.map((preset, idx) => 
                `<option value="${idx}" ${preset.name === item.specs.name ? 'selected' : ''}>${preset.name} (${preset.wmp}W)</option>`
            ).join('');
            
            html = `
                <div class="prop-section-title">Electrical</div>
                <div class="prop-row">
                    <span class="prop-label">Power (Wmp)</span>
                    <input type="number" class="prop-input" id="prop-panel-wmp" value="${item.specs.wmp}" min="10" max="800"> W
                </div>
                <div class="prop-row">
                    <span class="prop-label">Vmp</span>
                    <input type="number" class="prop-input" id="prop-panel-vmp" value="${item.specs.vmp}" step="0.1" min="1" max="100"> V
                </div>
                <div class="prop-row">
                    <span class="prop-label">Voc</span>
                    <input type="number" class="prop-input" id="prop-panel-voc" value="${item.specs.voc}" step="0.1" min="1" max="100"> V
                </div>
                <div class="prop-row">
                    <span class="prop-label">Isc</span>
                    <input type="number" class="prop-input" id="prop-panel-isc" value="${item.specs.isc}" step="0.1" min="0.1" max="20"> A
                </div>
                <div class="prop-section-title" style="margin-top:12px;">Replace Panel</div>
                <div class="prop-row">
                    <select class="prop-select" id="prop-panel-replace" style="width:100%;">
                        ${replacementOptions}
                    </select>
                </div>
                <div class="prop-row">
                    <button class="prop-btn" id="prop-panel-replace-btn" style="width:100%; padding:6px; margin-top:4px;">Replace with Selected</button>
                </div>
                <div class="prop-section-title" style="margin-top:12px;">Panel Array Tools</div>
                <div class="prop-row">
                    <span class="prop-label">Grid Padding</span>
                    <input type="range" class="prop-input" id="prop-panel-padding" value="${panelGridPadding}" min="0" max="100" step="5" style="width:80px;">
                    <span id="prop-panel-padding-val">${panelGridPadding}px</span>
                </div>
                <div class="prop-row">
                    <button class="prop-btn" id="prop-snap-grid-btn" style="width:100%; padding:6px; margin-top:4px;">⊞ Snap All Panels to Grid</button>
                </div>
                <div class="prop-row" style="display:flex; gap:4px; margin-top:4px;">
                    <button class="prop-btn" id="prop-select-all-panels-btn" style="flex:1; padding:6px;">☑ All</button>
                    <button class="prop-btn" id="prop-select-connected-btn" style="flex:1; padding:6px;">🔗 Connected</button>
                </div>
            `;
        } else if (item.type === 'battery') {
            // Build replacement dropdown
            const replacementOptions = BATTERY_PRESETS.map((preset, idx) => 
                `<option value="${idx}" ${preset.name === item.specs.name ? 'selected' : ''}>${preset.name} (${preset.voltage}V, ${preset.ah}Ah)</option>`
            ).join('');
            
            html = `
                <div class="prop-section-title">Specifications</div>
                <div class="prop-row">
                    <span class="prop-label">Voltage</span>
                    <select class="prop-select" id="prop-battery-voltage">
                        <option value="12" ${item.specs.voltage === 12 ? 'selected' : ''}>12V</option>
                        <option value="24" ${item.specs.voltage === 24 ? 'selected' : ''}>24V</option>
                        <option value="48" ${item.specs.voltage === 48 ? 'selected' : ''}>48V</option>
                    </select>
                </div>
                <div class="prop-row">
                    <span class="prop-label">Capacity</span>
                    <input type="number" class="prop-input" id="prop-battery-ah" value="${item.specs.ah}" min="10" max="500"> Ah
                </div>
                <div class="prop-row"><span class="prop-label">Energy</span><span class="prop-value">${item.specs.kWh.toFixed(2)} kWh</span></div>
                <div class="prop-section-title" style="margin-top:12px;">Replace Battery</div>
                <div class="prop-row">
                    <select class="prop-select" id="prop-battery-replace" style="width:100%;">
                        ${replacementOptions}
                    </select>
                </div>
                <div class="prop-row">
                    <button class="prop-btn" id="prop-battery-replace-btn" style="width:100%; padding:6px; margin-top:4px;">Replace with Selected</button>
                </div>
            `;
        } else if (item.type === 'controller') {
            // Build replacement dropdown
            const replacementOptions = CONTROLLER_PRESETS.map((preset, idx) => 
                `<option value="${idx}" ${preset.name === item.specs.name ? 'selected' : ''}>${preset.name}</option>`
            ).join('');
            
            html = `
                <div class="prop-section-title">Input Limits</div>
                <div class="prop-row"><span class="prop-label">Max PV</span><span class="prop-value">${item.specs.maxWmp} W</span></div>
                <div class="prop-row"><span class="prop-label">Max Voc</span><span class="prop-value">${item.specs.maxVoc} V</span></div>
                <div class="prop-row"><span class="prop-label">Max Isc</span><span class="prop-value">${item.specs.maxIsc} A</span></div>
                ${item.specs.maxACOutputW ? `<div class="prop-row"><span class="prop-label">AC Output</span><span class="prop-value">${item.specs.maxACOutputW} W</span></div>` : ''}
                ${item.specs.internalBatteryKWh ? `<div class="prop-row"><span class="prop-label">Internal Battery</span><span class="prop-value">${item.specs.internalBatteryKWh} kWh</span></div>` : ''}
                <div class="prop-section-title" style="margin-top:12px;">Replace Controller</div>
                <div class="prop-row">
                    <select class="prop-select" id="prop-controller-replace" style="width:100%;">
                        ${replacementOptions}
                    </select>
                </div>
                <div class="prop-row">
                    <button class="prop-btn" id="prop-controller-replace-btn" style="width:100%; padding:6px; margin-top:4px;">Replace with Selected</button>
                </div>
            `;
        } else if (item.type === 'acload') {
            const isOn = LiveView.state.loadStates[item.id];
            html = `
                <div class="prop-section-title">Load Settings</div>
                <div class="prop-row">
                    <span class="prop-label">Name</span>
                    <input type="text" class="prop-input" id="prop-load-name" value="${item.specs.name || 'Load'}" style="width:100px;">
                </div>
                <div class="prop-row">
                    <span class="prop-label">Power</span>
                    <input type="number" class="prop-input" id="prop-load-watts" value="${item.specs.watts}" min="1" max="15000"> W
                </div>
                <div class="prop-row">
                    <span class="prop-label">Voltage</span>
                    <select class="prop-select" id="prop-load-voltage">
                        <option value="120" ${item.specs.voltage === 120 ? 'selected' : ''}>120V</option>
                        <option value="240" ${item.specs.voltage === 240 ? 'selected' : ''}>240V</option>
                    </select>
                </div>
                ${LiveView.state.active ? `<div class="prop-row"><span class="prop-label">Status</span><span class="prop-value" style="color:${isOn ? '#5cb85c' : '#888'}">${isOn ? 'ON' : 'OFF'}</span></div>` : ''}
            `;
        } else if (item.type === 'acbreaker' || item.type === 'dcbreaker') {
            html = `
                <div class="prop-section-title">Breaker Settings</div>
                <div class="prop-row">
                    <span class="prop-label">Rating</span>
                    <select class="prop-select" id="prop-breaker-rating">
                        ${[10, 15, 20, 30, 40, 50, 60, 100].map(r => 
                            `<option value="${r}" ${item.specs.rating === r ? 'selected' : ''}>${r}A</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="prop-row">
                    <span class="prop-label">State</span>
                    <div class="prop-toggle">
                        <button class="prop-toggle-btn ${item.isClosed ? 'active' : ''}" id="prop-breaker-closed">CLOSED</button>
                        <button class="prop-toggle-btn ${!item.isClosed ? 'active' : ''}" id="prop-breaker-open">OPEN</button>
                    </div>
                </div>
            `;
        } else if (item.type === 'acoutlet') {
            html = `
                <div class="prop-row"><span class="prop-label">Voltage</span><span class="prop-value">${item.specs.voltage} V</span></div>
                <div class="prop-row"><span class="prop-label">Rating</span><span class="prop-value">${item.specs.voltage === 240 ? '30' : '20'} A</span></div>
            `;
        } else if (item.type === 'combiner') {
            html = `
                <div class="prop-section-title">Combiner Settings</div>
                <div class="prop-row">
                    <span class="prop-label">String Inputs</span>
                    <select class="prop-select" id="prop-combiner-inputs">
                        ${[2, 3, 4, 5, 6, 8].map(n => 
                            `<option value="${n}" ${item.specs.inputs === n ? 'selected' : ''}>${n} strings</option>`
                        ).join('')}
                    </select>
                </div>
            `;
        } else if (item.type === 'solarcombiner') {
            const activeBreakers = item.breakerStates?.filter(s => s).length || item.specs.inputs;
            html = `
                <div class="prop-section-title">Solar Combiner</div>
                <div class="prop-row"><span class="prop-label">Inputs</span><span class="prop-value">${item.specs.inputs} strings</span></div>
                <div class="prop-row">
                    <span class="prop-label">Breaker Rating</span>
                    <select class="prop-select" id="prop-solarcombiner-rating">
                        ${[10, 15, 20, 25, 30].map(r => 
                            `<option value="${r}" ${item.specs.breakerRating === r ? 'selected' : ''}>${r}A</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="prop-row"><span class="prop-label">Max Voltage</span><span class="prop-value">${item.specs.maxVoltage} V</span></div>
                <div class="prop-row"><span class="prop-label">Active Circuits</span><span class="prop-value">${activeBreakers}/${item.specs.inputs}</span></div>
            `;
        } else if (item.type === 'breakerpanel') {
            if (!item.breakerStates) item.breakerStates = Array(8).fill(true);
            const activeBreakers = item.breakerStates.filter(s => s).length;
            
            // Build circuit breaker controls
            let circuitControls = '<div class="prop-section-title" style="margin-top:12px;">Circuit Breakers</div>';
            for (let i = 0; i < 8; i++) {
                const circuitNum = i + 1;
                const handleKey = `circuit${circuitNum}`;
                const handle = item.handles[handleKey];
                const isOn = item.breakerStates[i] !== false;
                const rating = handle?.maxAmps || 20;
                const voltage = handle?.voltage || 120;
                
                circuitControls += `
                    <div class="prop-row" style="margin-top:6px;">
                        <span class="prop-label">Circuit ${circuitNum} (${rating}A, ${voltage}V)</span>
                        <div class="prop-toggle">
                            <button class="prop-toggle-btn ${isOn ? 'active' : ''}" id="prop-panel-circuit${circuitNum}-on" style="padding:2px 8px; font-size:10px;">ON</button>
                            <button class="prop-toggle-btn ${!isOn ? 'active' : ''}" id="prop-panel-circuit${circuitNum}-off" style="padding:2px 8px; font-size:10px;">OFF</button>
                        </div>
                    </div>
                `;
            }
            
            html = `
                <div class="prop-section-title">Panel Settings</div>
                <div class="prop-row">
                    <span class="prop-label">Main Breaker</span>
                    <div class="prop-toggle">
                        <button class="prop-toggle-btn ${item.mainBreakerOn ? 'active' : ''}" id="prop-panel-main-on">ON</button>
                        <button class="prop-toggle-btn ${!item.mainBreakerOn ? 'active' : ''}" id="prop-panel-main-off">OFF</button>
                    </div>
                </div>
                <div class="prop-row"><span class="prop-label">Main Rating</span><span class="prop-value">${item.specs.mainRating} A</span></div>
                <div class="prop-row"><span class="prop-label">Active Circuits</span><span class="prop-value">${activeBreakers}/${item.specs.circuits}</span></div>
                ${circuitControls}
            `;
        } else if (item.type === 'spiderbox') {
            if (!item.specs.circuits) item.specs.circuits = [];
            
            // Build circuit breaker controls
            let circuitControls = '<div class="prop-section-title" style="margin-top:12px;">Circuit Breakers</div>';
            item.specs.circuits.forEach((circuit, i) => {
                const circuitNum = i + 1;
                const handleKey = `circuit${circuitNum}`;
                const handle = item.handles[handleKey];
                const isOn = handle?.isClosed !== false;
                const rating = circuit.rating || handle?.maxAmps || 20;
                const voltage = circuit.voltage || 120;
                
                circuitControls += `
                    <div class="prop-row" style="margin-top:6px;">
                        <span class="prop-label">${circuit.name} (${rating}A, ${voltage}V)</span>
                        <div class="prop-toggle">
                            <button class="prop-toggle-btn ${isOn ? 'active' : ''}" id="prop-spider-circuit${circuitNum}-on" style="padding:2px 8px; font-size:10px;">ON</button>
                            <button class="prop-toggle-btn ${!isOn ? 'active' : ''}" id="prop-spider-circuit${circuitNum}-off" style="padding:2px 8px; font-size:10px;">OFF</button>
                        </div>
                    </div>
                `;
            });
            
            html = `
                <div class="prop-section-title">Spider Box</div>
                <div class="prop-row">
                    <span class="prop-label">Main Breaker</span>
                    <div class="prop-toggle">
                        <button class="prop-toggle-btn ${item.mainBreakerOn ? 'active' : ''}" id="prop-spider-main-on">ON</button>
                        <button class="prop-toggle-btn ${!item.mainBreakerOn ? 'active' : ''}" id="prop-spider-main-off">OFF</button>
                    </div>
                </div>
                <div class="prop-row"><span class="prop-label">Input</span><span class="prop-value">${item.specs.inputVoltage}V / ${item.specs.mainRating}A</span></div>
                <div class="prop-row"><span class="prop-label">Circuits</span><span class="prop-value">${item.specs.circuits.length}</span></div>
                ${circuitControls}
            `;
        } else if (item.type === 'doublevoltagehub') {
            const in1 = item.handles.input1?.connectedTo.length > 0;
            const in2 = item.handles.input2?.connectedTo.length > 0;
            html = `
                <div class="prop-section-title">Voltage Hub</div>
                <div class="prop-row"><span class="prop-label">Input 1</span><span class="prop-value" style="color:${in1 ? '#5cb85c' : '#888'}">${in1 ? 'Connected' : 'Empty'}</span></div>
                <div class="prop-row"><span class="prop-label">Input 2</span><span class="prop-value" style="color:${in2 ? '#5cb85c' : '#888'}">${in2 ? 'Connected' : 'Empty'}</span></div>
                <div class="prop-row"><span class="prop-label">Output Mode</span><span class="prop-value">${in1 && in2 ? '240V Split-Phase' : '120V'}</span></div>
                <div class="prop-row"><span class="prop-label">Max Output</span><span class="prop-value">${item.specs.maxOutputW} W</span></div>
            `;
        } else if (item.type === 'smartbattery') {
            html = `
                <div class="prop-section-title">Smart Battery</div>
                <div class="prop-row"><span class="prop-label">Capacity</span><span class="prop-value">${item.specs.kWh} kWh</span></div>
                <div class="prop-row"><span class="prop-label">Voltage</span><span class="prop-value">${item.specs.voltage} V</span></div>
                <div class="prop-row"><span class="prop-label">Type</span><span class="prop-value">LiFePO4</span></div>
            `;
        } else if (item.type === 'producer') {
            const isOn = LiveView.state.loadStates[item.id];
            const recipe = item.specs.recipe;
            const resourceInfo = RESOURCE_TYPES[recipe.output] || { name: 'Resource', icon: '📦' };
            const storage = item.internalStorage || 0;
            const storagePct = item.specs.tankSize ? Math.round(storage / item.specs.tankSize * 100) : 0;
            
            html = `
                <div class="prop-section-title">Producer</div>
                <div class="prop-row"><span class="prop-label">Power Draw</span><span class="prop-value">${item.specs.watts} W</span></div>
                <div class="prop-row"><span class="prop-label">Output</span><span class="prop-value">${resourceInfo.icon} ${resourceInfo.name}</span></div>
                <div class="prop-row"><span class="prop-label">Rate</span><span class="prop-value">${recipe.rate} ${recipe.unit}</span></div>
                ${item.specs.tankSize ? `<div class="prop-row"><span class="prop-label">Internal Tank</span><span class="prop-value">${storage.toFixed(1)}/${item.specs.tankSize} (${storagePct}%)</span></div>` : ''}
                ${LiveView.state.active ? `<div class="prop-row"><span class="prop-label">Status</span><span class="prop-value" style="color:${isOn ? '#5cb85c' : '#888'}">${isOn ? 'RUNNING' : 'OFF'}</span></div>` : ''}
            `;
        } else if (item.type === 'container') {
            const resourceInfo = RESOURCE_TYPES[item.specs.resource] || { name: 'Resource', icon: '📦' };
            const level = ResourceSystem.containerLevels[item.id] || 0;
            const levelPct = Math.round(level / item.specs.capacity * 100);
            
            html = `
                <div class="prop-section-title">Container</div>
                <div class="prop-row"><span class="prop-label">Resource</span><span class="prop-value">${resourceInfo.icon} ${resourceInfo.name}</span></div>
                <div class="prop-row"><span class="prop-label">Capacity</span><span class="prop-value">${item.specs.capacity} ${item.specs.unit}</span></div>
                <div class="prop-row"><span class="prop-label">Current Level</span><span class="prop-value">${level.toFixed(1)} ${item.specs.unit} (${levelPct}%)</span></div>
                ${LiveView.state.active ? `<div class="prop-section">
                    <button id="prop-container-empty" class="prop-toggle-btn" style="width:100%;">Empty Container</button>
                    <button id="prop-container-fill" class="prop-toggle-btn" style="width:100%; margin-top:4px;">Fill to 50%</button>
                </div>` : ''}
            `;
        }
        
        // Connections info
        let connCount = 0;
        Object.values(item.handles).forEach(h => { connCount += h.connectedTo.length; });
        html += `<div class="prop-row" style="margin-top:6px; padding-top:6px; border-top:1px solid var(--border-light);"><span class="prop-label">Connections</span><span class="prop-value">${connCount}</span></div>`;
        
        document.getElementById('prop-content').innerHTML = html;
        
        // Bind event handlers for editable properties
        bindPropertyHandlers(item);
    }
    
    // Update automations list UI (both sidebar and inspector versions)
    function updateAutomationsList() {
        const listEls = [
            document.getElementById('auto-rules-list'),
            document.getElementById('automations-list-inspector')
        ];
        const countEl = document.getElementById('auto-rule-count');
        
        const rules = Automations.rules;
        if (countEl) countEl.textContent = `(${rules.length})`;
        
        const htmlContent = rules.length === 0 
            ? '<div class="auto-empty">No automations yet</div>'
            : rules.map(rule => `
                <div class="auto-rule-item ${rule.enabled ? '' : 'disabled'}" data-rule-id="${rule.id}">
                    <button class="auto-rule-toggle ${rule.enabled ? 'active' : ''}" title="Toggle enabled">✓</button>
                    <div class="auto-rule-info">
                        <div class="auto-rule-name">${rule.name}</div>
                        <div class="auto-rule-desc">${Automations.getTriggerDescription(rule.trigger)} → ${Automations.getActionDescription(rule.action)}</div>
                    </div>
                    <button class="auto-rule-delete" title="Delete rule">×</button>
                </div>
            `).join('');
        
        // Update both lists
        listEls.forEach(listEl => {
            if (!listEl) return;
            
            listEl.innerHTML = htmlContent;
            
            // Bind events for toggle and delete buttons
            listEl.querySelectorAll('.auto-rule-item').forEach(el => {
                const ruleId = el.dataset.ruleId;
                
                el.querySelector('.auto-rule-toggle').onclick = (e) => {
                    e.stopPropagation();
                    Automations.toggleRule(ruleId);
                    updateAutomationsList();
                };
                
                el.querySelector('.auto-rule-delete').onclick = (e) => {
                    e.stopPropagation();
                    Automations.deleteRule(ruleId);
                    updateAutomationsList();
                    showToast('Automation deleted', 'info');
                };
            });
        });
    }
    
    function bindPropertyHandlers(item) {
        const itemId = item.id;
        
        // Helper to find item by ID (in case reference changes)
        const getItem = () => allItems.find(i => i.id === itemId);
        
        // Panel properties
        if (item.type === 'panel') {
            const wmpInput = document.getElementById('prop-panel-wmp');
            const vmpInput = document.getElementById('prop-panel-vmp');
            const vocInput = document.getElementById('prop-panel-voc');
            const iscInput = document.getElementById('prop-panel-isc');
            const replaceBtn = document.getElementById('prop-panel-replace-btn');
            const replaceSelect = document.getElementById('prop-panel-replace');
            
            if (wmpInput) wmpInput.onchange = (e) => {
                const it = getItem();
                if (it) { it.specs.wmp = parseFloat(e.target.value) || 100; updateStats(); render(); }
            };
            if (vmpInput) vmpInput.onchange = (e) => {
                const it = getItem();
                if (it) { it.specs.vmp = parseFloat(e.target.value) || 20; render(); }
            };
            if (vocInput) vocInput.onchange = (e) => {
                const it = getItem();
                if (it) { it.specs.voc = parseFloat(e.target.value) || 24; render(); }
            };
            if (iscInput) iscInput.onchange = (e) => {
                const it = getItem();
                if (it) { it.specs.isc = parseFloat(e.target.value) || 5; render(); }
            };
            if (replaceBtn && replaceSelect) {
                replaceBtn.onclick = () => {
                    const it = getItem();
                    if (it) {
                        const presetIdx = parseInt(replaceSelect.value);
                        const newPreset = PANEL_PRESETS[presetIdx];
                        if (newPreset) {
                            replaceComponent(it, 'panel', newPreset);
                        }
                    }
                };
            }
            
            // Panel array tools
            const paddingSlider = document.getElementById('prop-panel-padding');
            const paddingVal = document.getElementById('prop-panel-padding-val');
            const snapGridBtn = document.getElementById('prop-snap-grid-btn');
            const selectAllPanelsBtn = document.getElementById('prop-select-all-panels-btn');
            
            if (paddingSlider) {
                paddingSlider.value = panelGridPadding;
                if (paddingVal) paddingVal.textContent = `${panelGridPadding}px`;
                
                paddingSlider.oninput = (e) => {
                    panelGridPadding = parseInt(e.target.value) || 10;
                    if (paddingVal) paddingVal.textContent = `${panelGridPadding}px`;
                };
            }
            
            if (snapGridBtn) {
                snapGridBtn.onclick = () => {
                    snapAllPanelsToGrid();
                };
            }
            
            if (selectAllPanelsBtn) {
                selectAllPanelsBtn.onclick = () => {
                    selectAllPanels();
                };
            }
            
            const selectConnectedBtn = document.getElementById('prop-select-connected-btn');
            if (selectConnectedBtn) {
                selectConnectedBtn.onclick = () => {
                    selectConnectedPanels(getItem());
                };
            }
        }
        
        // Battery properties
        if (item.type === 'battery') {
            const voltageSelect = document.getElementById('prop-battery-voltage');
            const ahInput = document.getElementById('prop-battery-ah');
            const replaceBtn = document.getElementById('prop-battery-replace-btn');
            const replaceSelect = document.getElementById('prop-battery-replace');
            
            if (voltageSelect) voltageSelect.onchange = (e) => {
                const it = getItem();
                if (it) { 
                    it.specs.voltage = parseInt(e.target.value);
                    it.specs.kWh = (it.specs.voltage * it.specs.ah) / 1000;
                    updateStats(); render(); updatePropertiesPanel();
                }
            };
            if (ahInput) ahInput.onchange = (e) => {
                const it = getItem();
                if (it) { 
                    it.specs.ah = parseFloat(e.target.value) || 100;
                    it.specs.kWh = (it.specs.voltage * it.specs.ah) / 1000;
                    updateStats(); render(); updatePropertiesPanel();
                }
            };
            if (replaceBtn && replaceSelect) {
                replaceBtn.onclick = () => {
                    const it = getItem();
                    if (it) {
                        const presetIdx = parseInt(replaceSelect.value);
                        const newPreset = BATTERY_PRESETS[presetIdx];
                        if (newPreset) {
                            replaceComponent(it, 'battery', newPreset);
                        }
                    }
                };
            }
        }
        
        // Load properties
        if (item.type === 'acload') {
            const nameInput = document.getElementById('prop-load-name');
            const wattsInput = document.getElementById('prop-load-watts');
            const voltageSelect = document.getElementById('prop-load-voltage');
            
            if (nameInput) nameInput.onchange = (e) => {
                const it = getItem();
                if (it) { it.specs.name = e.target.value || 'Load'; render(); }
            };
            if (wattsInput) wattsInput.onchange = (e) => {
                const it = getItem();
                if (it) { it.specs.watts = parseFloat(e.target.value) || 100; updateStats(); render(); }
            };
            if (voltageSelect) voltageSelect.onchange = (e) => {
                const it = getItem();
                if (it) { it.specs.voltage = parseInt(e.target.value); render(); }
            };
        }
        
        // Breaker properties
        if (item.type === 'acbreaker' || item.type === 'dcbreaker') {
            const ratingSelect = document.getElementById('prop-breaker-rating');
            const closedBtn = document.getElementById('prop-breaker-closed');
            const openBtn = document.getElementById('prop-breaker-open');
            
            if (ratingSelect) ratingSelect.onchange = (e) => {
                const it = getItem();
                if (it) { it.specs.rating = parseInt(e.target.value); render(); }
            };
            if (closedBtn) closedBtn.onclick = () => {
                const it = getItem();
                if (it) { it.isClosed = true; calculatePowerFlow(); updateStats(); render(); updatePropertiesPanel(); }
            };
            if (openBtn) openBtn.onclick = () => {
                const it = getItem();
                if (it) { it.isClosed = false; calculatePowerFlow(); updateStats(); render(); updatePropertiesPanel(); }
            };
        }
        
        // Combiner inputs
        if (item.type === 'combiner') {
            const inputsSelect = document.getElementById('prop-combiner-inputs');
            if (inputsSelect) inputsSelect.onchange = (e) => {
                // Note: Changing combiner inputs would require recreating handles
                // For now, just show info - full recreation would be complex
                showToast('To change inputs, delete and re-add combiner', 'info');
            };
        }
        
        // Solar combiner breaker rating
        if (item.type === 'solarcombiner') {
            const ratingSelect = document.getElementById('prop-solarcombiner-rating');
            if (ratingSelect) ratingSelect.onchange = (e) => {
                const it = getItem();
                if (it) { it.specs.breakerRating = parseInt(e.target.value); render(); }
            };
        }
        
        // Breaker panel main and circuits
        if (item.type === 'breakerpanel') {
            const onBtn = document.getElementById('prop-panel-main-on');
            const offBtn = document.getElementById('prop-panel-main-off');
            
            if (onBtn) onBtn.onclick = () => {
                const it = getItem();
                if (it) { it.mainBreakerOn = true; calculatePowerFlow(); updateStats(); render(); updatePropertiesPanel(); }
            };
            if (offBtn) offBtn.onclick = () => {
                const it = getItem();
                if (it) { it.mainBreakerOn = false; calculatePowerFlow(); updateStats(); render(); updatePropertiesPanel(); }
            };
            
            // Circuit breaker controls
            for (let i = 0; i < 8; i++) {
                const circuitNum = i + 1;
                const circuitOnBtn = document.getElementById(`prop-panel-circuit${circuitNum}-on`);
                const circuitOffBtn = document.getElementById(`prop-panel-circuit${circuitNum}-off`);
                
                if (circuitOnBtn) circuitOnBtn.onclick = () => {
                    const it = getItem();
                    if (it) {
                        if (!it.breakerStates) it.breakerStates = Array(8).fill(true);
                        it.breakerStates[i] = true;
                        calculatePowerFlow();
                        updateStats();
                        render();
                        updatePropertiesPanel();
                    }
                };
                
                if (circuitOffBtn) circuitOffBtn.onclick = () => {
                    const it = getItem();
                    if (it) {
                        if (!it.breakerStates) it.breakerStates = Array(8).fill(true);
                        it.breakerStates[i] = false;
                        calculatePowerFlow();
                        updateStats();
                        render();
                        updatePropertiesPanel();
                    }
                };
            }
        }
        
        // Spider box main
        if (item.type === 'spiderbox') {
            const onBtn = document.getElementById('prop-spider-main-on');
            const offBtn = document.getElementById('prop-spider-main-off');
            
            if (onBtn) onBtn.onclick = () => {
                const it = getItem();
                if (it) { it.mainBreakerOn = true; calculatePowerFlow(); updateStats(); render(); updatePropertiesPanel(); }
            };
            if (offBtn) offBtn.onclick = () => {
                const it = getItem();
                if (it) { it.mainBreakerOn = false; calculatePowerFlow(); updateStats(); render(); updatePropertiesPanel(); }
            };
        }
        
        // Controller properties
        if (item.type === 'controller') {
            const replaceBtn = document.getElementById('prop-controller-replace-btn');
            const replaceSelect = document.getElementById('prop-controller-replace');
            
            if (replaceBtn && replaceSelect) {
                replaceBtn.onclick = () => {
                    const it = getItem();
                    if (it) {
                        const presetIdx = parseInt(replaceSelect.value);
                        const newPreset = CONTROLLER_PRESETS[presetIdx];
                        if (newPreset) {
                            replaceComponent(it, 'controller', newPreset);
                        }
                    }
                };
            }
        }
        
        // Container controls
        if (item.type === 'container') {
            const emptyBtn = document.getElementById('prop-container-empty');
            const fillBtn = document.getElementById('prop-container-fill');
            
            if (emptyBtn) emptyBtn.onclick = () => {
                const it = getItem();
                if (it) {
                    ResourceSystem.containerLevels[it.id] = 0;
                    render();
                    updatePropertiesPanel();
                }
            };
            if (fillBtn) fillBtn.onclick = () => {
                const it = getItem();
                if (it) {
                    ResourceSystem.containerLevels[it.id] = it.specs.capacity * 0.5;
                    render();
                    updatePropertiesPanel();
                }
            };
        }
    }
    
    // ============================================
    // LIVE MODE
    // ============================================
    
    function startLiveMode() {
        // Check for batteries or all-in-one units
        const batteries = allItems.filter(i => i.type === 'battery');
        const smartBatteries = allItems.filter(i => i.type === 'smartbattery');
        const controllers = allItems.filter(i => i.type === 'controller');
        const hasStorage = batteries.length > 0 || smartBatteries.length > 0 || controllers.some(c => c.specs.internalBatteryKWh > 0);
        
        if (!hasStorage) {
            showToast('Add batteries or an all-in-one unit to use Live mode', 'error');
            return false;
        }
        
        LiveView.state.active = true;
        LiveView.state.loadStates = {};
        LiveView.state.breakerStates = {};
        LiveView.state.powerFlow = {};
        
        // Initialize loads to off
        allItems.filter(i => i.type === 'acload').forEach(load => {
            LiveView.state.loadStates[load.id] = false;
        });
        
        // Initialize breakers to closed
        allItems.filter(i => i.type === 'acbreaker' || i.type === 'dcbreaker').forEach(breaker => {
            LiveView.state.breakerStates[breaker.id] = { isClosed: breaker.isClosed !== false };
        });
        
        currentSolarMode = 'live';
        document.getElementById('btn-solar-build').classList.remove('active');
        document.getElementById('btn-solar-live').classList.add('active');
        const hintEl = document.getElementById('live-mode-hint');
        if (hintEl) hintEl.style.display = 'block';
        
        // Show simulation controls (both sidebar and topbar)
        const simControls = document.getElementById('sim-controls');
        if (simControls) simControls.style.display = 'block';
        const topbarControls = document.getElementById('topbar-sim-controls');
        if (topbarControls) topbarControls.classList.add('active');
        
        // Show live power stats panel
        const liveStatsPanel = document.getElementById('live-power-stats-panel');
        if (liveStatsPanel) liveStatsPanel.classList.add('active');
        
        // Initialize simulation
        Simulation.initBatteries();
        Simulation.calculateSolarOutput();
        Simulation.updateTimeDisplay();
        Simulation.updateSimulationStats();
        Simulation.updateBackgroundColor();
        
        // Sync time sliders (both sidebar and topbar)
        const timeSliders = [document.getElementById('sim-time-slider'), document.getElementById('sim-time-slider-top')];
        timeSliders.forEach(slider => {
            if (slider) slider.value = Simulation.time;
        });
        
        calculatePowerFlow();
        render();
        showToast('Live mode active - use time controls to simulate!', 'info');
        return true;
    }
    
    function stopLiveMode() {
        LiveView.state.active = false;
        currentSolarMode = 'build';
        
        // Stop simulation
        Simulation.pause();
        
        document.getElementById('btn-solar-build').classList.add('active');
        document.getElementById('btn-solar-live').classList.remove('active');
        const hintEl = document.getElementById('live-mode-hint');
        if (hintEl) hintEl.style.display = 'none';
        
        // Hide simulation controls (both sidebar and topbar)
        const simControls = document.getElementById('sim-controls');
        if (simControls) simControls.style.display = 'none';
        const topbarControls = document.getElementById('topbar-sim-controls');
        if (topbarControls) topbarControls.classList.remove('active');
        
        // Hide live power stats panel
        const liveStatsPanel = document.getElementById('live-power-stats-panel');
        if (liveStatsPanel) liveStatsPanel.classList.remove('active');
        
        // Reset background color to default and clean up celestial overlay
        const container = document.getElementById('solar-canvas-container');
        if (container) {
            container.style.backgroundColor = '#1a2b3c';
            container.style.backgroundImage = `
                linear-gradient(rgba(240, 173, 78, 0.03) 1px, transparent 1px),
                linear-gradient(90deg, rgba(240, 173, 78, 0.03) 1px, transparent 1px)
            `;
            
            // Remove celestial overlay to prevent memory accumulation
            const overlay = document.getElementById('celestial-overlay');
            if (overlay) {
                overlay.remove();
            }
        }
        
        // Reset celestial update tracker
        Simulation._lastCelestialUpdate = null;
        
        render();
    }
    
    // Power flow cache for performance optimization
    let _powerFlowCache = null;
    let _powerFlowCacheKey = null;
    
    function calculatePowerFlow() {
        // Phase 2: Power flow calculation with caching
        // Ensure solar output is calculated first
        if (LiveView.state.active) {
            Simulation.calculateSolarOutput();
        }
        
        // Only recalculate if load states or power values have changed
        const currentSolarOutput = Simulation.currentSolarWatts || 0;
        const currentLoadWatts = Simulation.currentLoadWatts || 0;
        const batteryFlow = Simulation.currentBatteryFlow || 0;
        
        // Create cache key from current state - include active load count for accuracy
        const activeLoadCount = Object.values(LiveView.state.loadStates).filter(v => v).length;
        const cacheKey = `${currentSolarOutput.toFixed(0)}_${currentLoadWatts.toFixed(0)}_${batteryFlow.toFixed(0)}_${activeLoadCount}_${LiveView.state.active}`;
        
        // Check if we can use cached result
        if (_powerFlowCache && _powerFlowCacheKey === cacheKey) {
            LiveView.state.powerFlow = _powerFlowCache;
            return;
        }
        
        // Clear and recalculate
        LiveView.state.powerFlow = {};
        
        if (!LiveView.state.active) {
            _powerFlowCache = {};
            _powerFlowCacheKey = cacheKey;
            return;
        }
        
        // Calculate total AC load power for wattage tracking
        let totalACWatts = 0;
        allItems.filter(i => i.type === 'acload').forEach(load => {
            if (LiveView.state.loadStates[load.id]) {
                totalACWatts += load.specs.watts || 0;
            }
        });
        
        // Helper to mark a connection as live with power details
        const markConnectionLive = (connId, watts, voltage = 120, direction = 'power', options = {}) => {
            LiveView.state.powerFlow[connId] = {
                watts: watts,
                amps: voltage > 0 ? watts / voltage : 0,
                voltage: voltage,
                direction: direction,
                isLive: true,
                ...options
            };
        };
        
        // Mark connections from controllers as live if they have connected panels/batteries
        const controllers = allItems.filter(i => i.type === 'controller');
        
        controllers.forEach(controller => {
            // Check if controller has connected panels
            let hasPanels = false;
            if (controller.handles.pvPositive) {
                hasPanels = controller.handles.pvPositive.connectedTo.length > 0;
            }
            
            // Check for batteries
            let hasBatteries = false;
            if (controller.handles.batteryPositive) {
                hasBatteries = controller.handles.batteryPositive.connectedTo.length > 0;
            } else if (controller.specs.internalBatteryKWh > 0) {
                hasBatteries = true;
            }
            
            // Check for smart batteries connected
            const smartBatteries = allItems.filter(i => i.type === 'smartbattery');
            smartBatteries.forEach(sb => {
                if (sb.parentControllerId === controller.id) {
                    hasBatteries = true;
                }
            });
            
            // Mark AC output connections as live with wattage
            if ((hasPanels || hasBatteries) && controller.handles.acOutput) {
                const acVoltage = 120; // Standard AC voltage
                controller.handles.acOutput.connectedTo.forEach(conn => {
                    LiveView.state.powerFlow[conn.connectionId] = { 
                        isLive: true, 
                        watts: totalACWatts,
                        amps: totalACWatts / acVoltage,
                        voltage: acVoltage,
                        hasActiveFlow: totalACWatts > 0
                    };
                });
            }
            
            // Mark DC connections as live (PV wires)
            if (hasPanels && controller.handles.pvPositive) {
                const solarOutput = Simulation.currentSolarWatts || 0;
                const isCharging = Simulation.currentBatteryFlow > 0; // Battery is charging
                
                // Check if there are any active AC loads on this controller
                let hasActiveACLoad = false;
                if (controller.handles.acOutput) {
                    // Check if AC output has active loads downstream
                    controller.handles.acOutput.connectedTo.forEach(acConn => {
                        const acConnObj = connections.find(c => c.id === acConn.connectionId);
                        if (acConnObj) {
                            // Trace to find loads
                            const targetItem = allItems.find(i => i.id === acConnObj.targetItemId);
                            if (targetItem && targetItem.type === 'acload' && LiveView.state.loadStates[targetItem.id]) {
                                hasActiveACLoad = true;
                            } else if (targetItem && targetItem.type === 'acoutlet') {
                                // Check outlet loads
                                if (targetItem.handles.load) {
                                    targetItem.handles.load.connectedTo.forEach(loadConn => {
                                        const loadConnObj = connections.find(c => c.id === loadConn.connectionId);
                                        if (loadConnObj) {
                                            const loadItem = allItems.find(i => i.id === loadConnObj.targetItemId && i.type === 'acload');
                                            if (loadItem && LiveView.state.loadStates[loadItem.id]) {
                                                hasActiveACLoad = true;
                                            }
                                        }
                                    });
                                }
                            }
                        }
                    });
                }
                
                // Animate only when: solar > 0 AND (battery charging OR active AC load)
                // If solar available but no load and not charging: glow only, no animation
                const shouldAnimate = solarOutput > 0 && (isCharging || hasActiveACLoad);
                
                // Calculate PV voltage for this controller
                let pvVoltage = controller.specs.mppVoltageMin || controller.specs.maxVoc || 150;
                const pvAmps = solarOutput > 0 ? solarOutput / pvVoltage : 0;
                const pvWattsPerConnection = solarOutput / Math.max(1, controller.handles.pvPositive.connectedTo.length);
                
                // Positive wire: conventional current flows from panels to controller
                controller.handles.pvPositive.connectedTo.forEach(conn => {
                    LiveView.state.powerFlow[conn.connectionId] = { 
                        isLive: solarOutput > 0, 
                        watts: pvWattsPerConnection,
                        amps: pvAmps / Math.max(1, controller.handles.pvPositive.connectedTo.length),
                        voltage: pvVoltage,
                        isPV: true,
                        direction: 'pv-to-controller', // Positive: panels → controller (conventional current)
                        hasActiveFlow: shouldAnimate // Animate when charging or load active
                    };
                });
                
                // Negative wire: electron flow is opposite (controller to panels)
                if (controller.handles.pvNegative) {
                    const negConnCount = controller.handles.pvNegative.connectedTo.length;
                    controller.handles.pvNegative.connectedTo.forEach(conn => {
                        LiveView.state.powerFlow[conn.connectionId] = { 
                            isLive: solarOutput > 0, 
                            watts: pvWattsPerConnection,
                            amps: pvAmps / Math.max(1, negConnCount),
                            voltage: pvVoltage,
                            isPV: true,
                            direction: 'controller-to-pv', // Negative: controller → panels (electron flow, opposite)
                            hasActiveFlow: shouldAnimate // Animate when charging or load active
                        };
                    });
                }
                
                // Trace DC connections through combiners and DC breakers to panels
                // This marks all PV wire connections in the DC path
                const tracePVConnections = (item, handle, direction, visited = new Set()) => {
                    if (!handle?.connectedTo) return;
                    
                    handle.connectedTo.forEach(conn => {
                        const connObj = connections.find(c => c.id === conn.connectionId);
                        if (!connObj || visited.has(connObj.id)) return;
                        visited.add(connObj.id);
                        
                        // Mark this connection if not already marked
                        if (!LiveView.state.powerFlow[connObj.id]) {
                            LiveView.state.powerFlow[connObj.id] = {
                                watts: solarOutput,
                                amps: pvAmps,
                                voltage: pvVoltage,
                                direction: direction,
                                isPV: true,
                                isLive: solarOutput > 0,
                                hasActiveFlow: shouldAnimate
                            };
                        }
                        
                        // Find connected item
                        const connectedItemId = connObj.sourceItemId === item.id ? connObj.targetItemId : connObj.sourceItemId;
                        const connectedItem = allItems.find(i => i.id === connectedItemId);
                        if (!connectedItem) return;
                        
                        // Handle different component types
                        if (connectedItem.type === 'solarcombiner') {
                            // Solar combiner with per-string breakers
                            // Trace through each input that has its breaker closed
                            for (let i = 0; i < (connectedItem.specs?.inputs || 0); i++) {
                                // Check if this input's breaker is closed
                                if (!LiveView.BreakerManager.isSolarCombinerInputClosed(connectedItem, i)) continue;
                                
                                const inputPosHandle = connectedItem.handles?.[`input${i}Positive`];
                                const inputNegHandle = connectedItem.handles?.[`input${i}Negative`];
                                
                                if (inputPosHandle && direction === 'pv-to-controller') {
                                    tracePVConnections(connectedItem, inputPosHandle, direction, visited);
                                }
                                if (inputNegHandle && direction === 'controller-to-pv') {
                                    tracePVConnections(connectedItem, inputNegHandle, direction, visited);
                                }
                            }
                        } else if (connectedItem.type === 'combiner') {
                            // Regular combiner (no breakers)
                            // Trace through all inputs
                            Object.entries(connectedItem.handles || {}).forEach(([key, h]) => {
                                if (key.startsWith('input') && key.includes('Positive') && direction === 'pv-to-controller') {
                                    tracePVConnections(connectedItem, h, direction, visited);
                                } else if (key.startsWith('input') && key.includes('Negative') && direction === 'controller-to-pv') {
                                    tracePVConnections(connectedItem, h, direction, visited);
                                }
                            });
                        } else if (connectedItem.type === 'dcbreaker') {
                            // DC breaker - only pass through if closed
                            if (LiveView.BreakerManager.isBreakerClosed(connectedItem)) {
                                // Find the other side of the breaker
                                const linePos = connectedItem.handles?.linePositive;
                                const lineNeg = connectedItem.handles?.lineNegative;
                                const loadPos = connectedItem.handles?.loadPositive;
                                const loadNeg = connectedItem.handles?.loadNegative;
                                
                                // Determine which side we came from and trace the other
                                if (direction === 'pv-to-controller') {
                                    if (linePos?.connectedTo?.some(c => c.connectionId === connObj.id)) {
                                        tracePVConnections(connectedItem, loadPos, direction, visited);
                                    } else if (loadPos?.connectedTo?.some(c => c.connectionId === connObj.id)) {
                                        tracePVConnections(connectedItem, linePos, direction, visited);
                                    }
                                } else {
                                    if (lineNeg?.connectedTo?.some(c => c.connectionId === connObj.id)) {
                                        tracePVConnections(connectedItem, loadNeg, direction, visited);
                                    } else if (loadNeg?.connectedTo?.some(c => c.connectionId === connObj.id)) {
                                        tracePVConnections(connectedItem, lineNeg, direction, visited);
                                    }
                                }
                            }
                        } else if (connectedItem.type === 'panel') {
                            // Mark panel terminal connections
                            Object.values(connectedItem.handles || {}).forEach(h => {
                                h.connectedTo?.forEach(panelConn => {
                                    const panelConnObj = connections.find(c => c.id === panelConn.connectionId);
                                    if (panelConnObj && !LiveView.state.powerFlow[panelConnObj.id]) {
                                        LiveView.state.powerFlow[panelConnObj.id] = {
                                            watts: connectedItem.specs?.wmp || 0,
                                            amps: (connectedItem.specs?.wmp || 0) / pvVoltage,
                                            voltage: pvVoltage,
                                            direction: h.polarity === 'positive' ? 'pv-to-controller' : 'controller-to-pv',
                                            isPV: true,
                                            isLive: solarOutput > 0,
                                            hasActiveFlow: shouldAnimate
                                        };
                                    }
                                });
                            });
                        }
                    });
                };
                
                // Trace from controller PV handles through all DC connections
                if (controller.handles.pvPositive) {
                    tracePVConnections(controller, controller.handles.pvPositive, 'pv-to-controller');
                }
                if (controller.handles.pvNegative) {
                    tracePVConnections(controller, controller.handles.pvNegative, 'controller-to-pv');
                }
                
                // Also check for multiple MPPT inputs
                for (let mppt = 1; mppt <= (controller.specs?.mpptCount || 1); mppt++) {
                    const mpptPosHandle = controller.handles?.[`pvPositive${mppt}`];
                    const mpptNegHandle = controller.handles?.[`pvNegative${mppt}`];
                    
                    if (mpptPosHandle) {
                        tracePVConnections(controller, mpptPosHandle, 'pv-to-controller');
                    }
                    if (mpptNegHandle) {
                        tracePVConnections(controller, mpptNegHandle, 'controller-to-pv');
                    }
                }
            }
            
            // Mark battery wire connections with charging/discharging state
            // Battery wires animate when either charging (PV > 0) or discharging (AC load > 0)
            const isCharging = Simulation.currentBatteryFlow > 0;
            const isDischarging = totalACWatts > 0 && Simulation.currentBatteryFlow < 0;
            const batteryActive = isCharging || isDischarging;
            
            if (batteryActive && (hasBatteries || controller.specs.internalBatteryKWh > 0)) {
                // Get battery voltage (default 48V for most systems)
                let batteryVoltage = 48;
                const connectedBatteries = allItems.filter(i => 
                    i.type === 'battery' && 
                    i.handles?.positive?.connectedTo.some(c => {
                        const conn = connections.find(cn => cn.id === c.connectionId);
                        return conn && (conn.sourceItemId === controller.id || conn.targetItemId === controller.id);
                    })
                );
                if (connectedBatteries.length > 0) {
                    batteryVoltage = connectedBatteries[0].specs.voltage || 48;
                } else if (controller.specs.supportedVoltages?.length > 0) {
                    batteryVoltage = controller.specs.supportedVoltages[0];
                }
                
                // Calculate battery power flow
                const batteryWatts = Math.abs(Simulation.currentBatteryFlow);
                const batteryAmps = batteryWatts / batteryVoltage;
                const batteryDirection = isCharging ? 'charging' : 'discharging';
                
                // Mark controller battery terminal connections
                if (controller.handles.batteryPositive) {
                    controller.handles.batteryPositive.connectedTo.forEach(conn => {
                        LiveView.state.powerFlow[conn.connectionId] = {
                            watts: batteryWatts,
                            amps: batteryAmps,
                            voltage: batteryVoltage,
                            direction: batteryDirection,
                            isBattery: true,
                            isCharging: isCharging,
                            isLive: true,
                            hasActiveFlow: batteryActive
                        };
                    });
                }
                
                if (controller.handles.batteryNegative) {
                    controller.handles.batteryNegative.connectedTo.forEach(conn => {
                        LiveView.state.powerFlow[conn.connectionId] = {
                            watts: batteryWatts,
                            amps: batteryAmps,
                            voltage: batteryVoltage,
                            direction: batteryDirection,
                            isBattery: true,
                            isCharging: isCharging,
                            isLive: true,
                            hasActiveFlow: batteryActive
                        };
                    });
                }
                
                // Trace battery connections through DC breakers and combiners
                const traceBatteryConnections = (item, handle, visited = new Set()) => {
                    if (!handle?.connectedTo) return;
                    
                    handle.connectedTo.forEach(conn => {
                        const connObj = connections.find(c => c.id === conn.connectionId);
                        if (!connObj || visited.has(connObj.id)) return;
                        visited.add(connObj.id);
                        
                        // Mark this connection if not already marked
                        if (!LiveView.state.powerFlow[connObj.id]) {
                            LiveView.state.powerFlow[connObj.id] = {
                                watts: batteryWatts,
                                amps: batteryAmps,
                                voltage: batteryVoltage,
                                direction: batteryDirection,
                                isBattery: true,
                                isCharging: isCharging,
                                isLive: true,
                                hasActiveFlow: batteryActive
                            };
                        }
                        
                        // Find connected item
                        const connectedItemId = connObj.sourceItemId === item.id ? connObj.targetItemId : connObj.sourceItemId;
                        const connectedItem = allItems.find(i => i.id === connectedItemId);
                        if (!connectedItem) return;
                        
                        // Handle DC breakers
                        if (connectedItem.type === 'dcbreaker') {
                            if (LiveView.BreakerManager.isBreakerClosed(connectedItem)) {
                                // Trace through both sides
                                const linePos = connectedItem.handles?.linePositive;
                                const lineNeg = connectedItem.handles?.lineNegative;
                                const loadPos = connectedItem.handles?.loadPositive;
                                const loadNeg = connectedItem.handles?.loadNegative;
                                
                                // Trace from line to load and vice versa
                                if (linePos) traceBatteryConnections(connectedItem, linePos, visited);
                                if (lineNeg) traceBatteryConnections(connectedItem, lineNeg, visited);
                                if (loadPos) traceBatteryConnections(connectedItem, loadPos, visited);
                                if (loadNeg) traceBatteryConnections(connectedItem, loadNeg, visited);
                            }
                        }
                        // Handle batteries
                        else if (connectedItem.type === 'battery' || connectedItem.type === 'smartbattery') {
                            // Mark battery terminal connections
                            if (connectedItem.handles?.positive) {
                                traceBatteryConnections(connectedItem, connectedItem.handles.positive, visited);
                            }
                            if (connectedItem.handles?.negative) {
                                traceBatteryConnections(connectedItem, connectedItem.handles.negative, visited);
                            }
                        }
                    });
                };
                
                // Trace from controller battery terminals
                if (controller.handles.batteryPositive) {
                    traceBatteryConnections(controller, controller.handles.batteryPositive);
                }
                if (controller.handles.batteryNegative) {
                    traceBatteryConnections(controller, controller.handles.batteryNegative);
                }
                
                // Also mark battery terminal connections directly (for batteries not going through controller)
                allItems.filter(i => i.type === 'battery' || i.type === 'smartbattery').forEach(battery => {
                    if (battery.handles?.positive?.connectedTo) {
                        battery.handles.positive.connectedTo.forEach(conn => {
                            if (!LiveView.state.powerFlow[conn.connectionId]) {
                                LiveView.state.powerFlow[conn.connectionId] = {
                                    watts: batteryWatts,
                                    amps: batteryAmps,
                                    voltage: battery.specs.voltage || batteryVoltage,
                                    direction: batteryDirection,
                                    isBattery: true,
                                    isCharging: isCharging,
                                    isLive: true,
                                    hasActiveFlow: batteryActive
                                };
                            }
                        });
                    }
                    if (battery.handles?.negative?.connectedTo) {
                        battery.handles.negative.connectedTo.forEach(conn => {
                            if (!LiveView.state.powerFlow[conn.connectionId]) {
                                LiveView.state.powerFlow[conn.connectionId] = {
                                    watts: batteryWatts,
                                    amps: batteryAmps,
                                    voltage: battery.specs.voltage || batteryVoltage,
                                    direction: batteryDirection,
                                    isBattery: true,
                                    isCharging: isCharging,
                                    isLive: true,
                                    hasActiveFlow: batteryActive
                                };
                            }
                        });
                    }
                });
            }
        });
        
        // Mark DC breaker outputs as live if input is live and breaker is closed
        allItems.filter(i => i.type === 'dcbreaker').forEach(breaker => {
            if (!LiveView.BreakerManager.isBreakerClosed(breaker)) return;
            
            // Check if line side has power
            const linePosConn = breaker.handles?.linePositive?.connectedTo?.[0];
            const lineNegConn = breaker.handles?.lineNegative?.connectedTo?.[0];
            const hasLinePower = (linePosConn && LiveView.state.powerFlow[linePosConn.connectionId]?.isLive) ||
                                (lineNegConn && LiveView.state.powerFlow[lineNegConn.connectionId]?.isLive);
            
            if (hasLinePower) {
                // Mark load side connections
                breaker.handles?.loadPositive?.connectedTo.forEach(conn => {
                    if (!LiveView.state.powerFlow[conn.connectionId]) {
                        const linePower = LiveView.state.powerFlow[linePosConn?.connectionId] || {};
                        LiveView.state.powerFlow[conn.connectionId] = { 
                            isLive: true, 
                            watts: linePower.watts || 0,
                            amps: linePower.amps || 0,
                            voltage: linePower.voltage || 48,
                            isPV: linePower.isPV,
                            isBattery: linePower.isBattery,
                            direction: linePower.direction
                        };
                    }
                });
                breaker.handles?.loadNegative?.connectedTo.forEach(conn => {
                    if (!LiveView.state.powerFlow[conn.connectionId]) {
                        const linePower = LiveView.state.powerFlow[lineNegConn?.connectionId] || {};
                        LiveView.state.powerFlow[conn.connectionId] = { 
                            isLive: true, 
                            watts: linePower.watts || 0,
                            amps: linePower.amps || 0,
                            voltage: linePower.voltage || 48,
                            isPV: linePower.isPV,
                            isBattery: linePower.isBattery,
                            direction: linePower.direction
                        };
                    }
                });
            }
        });
        
        // Mark AC breaker outputs as live if input is live and breaker is closed
        allItems.filter(i => i.type === 'acbreaker').forEach(breaker => {
            if (!LiveView.BreakerManager.isBreakerClosed(breaker)) return;
            
            const inputConn = breaker.handles?.lineIn?.connectedTo?.[0];
            if (inputConn && LiveView.state.powerFlow[inputConn.connectionId]?.isLive) {
                const inputPower = LiveView.state.powerFlow[inputConn.connectionId];
                breaker.handles?.loadOut?.connectedTo.forEach(conn => {
                    LiveView.state.powerFlow[conn.connectionId] = { 
                        isLive: true, 
                        watts: inputPower.watts || totalACWatts,
                        amps: inputPower.amps || (totalACWatts / 120),
                        voltage: inputPower.voltage || 120,
                        hasActiveFlow: inputPower.hasActiveFlow || totalACWatts > 0
                    };
                });
            }
        });
        
        // Mark outlet outputs as live (with recursive tracing for daisy-chained outlets)
        // Outlets daisy-chain through their INPUT handles (input-to-input connections)
        function markOutletAsLive(outlet, visitedOutlets = new Set()) {
            if (visitedOutlets.has(outlet.id)) return;
            visitedOutlets.add(outlet.id);
            
            // Check if this outlet has power on its input
            let hasPower = false;
            if (outlet.handles.input) {
                for (const conn of outlet.handles.input.connectedTo) {
                    const connObj = connections.find(c => c.id === conn.connectionId);
                    if (!connObj) continue;
                    
                    // Check if the connection is already marked as live
                    if (LiveView.state.powerFlow[conn.connectionId]?.isLive) {
                        hasPower = true;
                        break;
                    }
                    
                    // Check if source has power
                    const sourceItem = allItems.find(i => i.id === connObj.sourceItemId);
                    const targetItem = allItems.find(i => i.id === connObj.targetItemId);
                    
                    // If source is breaker panel circuit and it's live
                    if (sourceItem && sourceItem.type === 'breakerpanel') {
                        const mainConn = sourceItem.handles.mainInput?.connectedTo?.[0];
                        if (mainConn && LiveView.state.powerFlow[mainConn.connectionId]?.isLive && sourceItem.mainBreakerOn) {
                            const handleKey = connObj.sourceHandleKey;
                            if (handleKey && handleKey.startsWith('circuit')) {
                                const circuitNum = parseInt(handleKey.replace('circuit', '')) - 1;
                                if (sourceItem.breakerStates && sourceItem.breakerStates[circuitNum]) {
                                    hasPower = true;
                                    LiveView.state.powerFlow[conn.connectionId] = { isLive: true, watts: 0 };
                                    break;
                                }
                            }
                        }
                    }
                    // If source is another outlet that we've already processed (daisy chain)
                    else if (sourceItem && sourceItem.type === 'acoutlet' && visitedOutlets.has(sourceItem.id)) {
                        hasPower = true;
                        LiveView.state.powerFlow[conn.connectionId] = { isLive: true, watts: 0 };
                        break;
                    }
                    // If target is another outlet that we've already processed (reverse daisy chain)
                    else if (targetItem && targetItem.type === 'acoutlet' && visitedOutlets.has(targetItem.id)) {
                        hasPower = true;
                        LiveView.state.powerFlow[conn.connectionId] = { isLive: true, watts: 0 };
                        break;
                    }
                    // If source is a breaker and it's live
                    else if (sourceItem && sourceItem.type === 'acbreaker' && sourceItem.isClosed) {
                        const breakerInput = sourceItem.handles.lineIn?.connectedTo?.[0];
                        if (breakerInput && LiveView.state.powerFlow[breakerInput.connectionId]?.isLive) {
                            hasPower = true;
                            LiveView.state.powerFlow[conn.connectionId] = { isLive: true, watts: 0 };
                            break;
                        }
                    }
                    // If source is spiderbox circuit and it's live
                    else if (sourceItem && sourceItem.type === 'spiderbox' && sourceItem.mainBreakerOn) {
                        const mainConn = sourceItem.handles.mainInput?.connectedTo?.[0];
                        if (mainConn && LiveView.state.powerFlow[mainConn.connectionId]?.isLive) {
                            const handleKey = connObj.sourceHandleKey;
                            if (handleKey && handleKey.startsWith('circuit')) {
                                const handle = sourceItem.handles[handleKey];
                                if (handle && handle.isClosed !== false) {
                                    hasPower = true;
                                    LiveView.state.powerFlow[conn.connectionId] = { isLive: true, watts: 0 };
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            
            if (hasPower) {
                // Mark load connections as live
                outlet.handles.load?.connectedTo?.forEach(conn => {
                    LiveView.state.powerFlow[conn.connectionId] = { isLive: true, watts: 0 };
                });
                
                // Trace through outlet input to find daisy-chained outlets
                // Outlets daisy-chain by connecting input-to-input (bidirectional)
                if (outlet.handles.input) {
                    outlet.handles.input.connectedTo?.forEach(conn => {
                        const connObj = connections.find(c => c.id === conn.connectionId);
                        if (!connObj) return;
                        
                        // Find the other outlet in this connection (daisy chain)
                        // Can be either source or target, depending on connection direction
                        let otherItem = null;
                        if (connObj.sourceItemId === outlet.id) {
                            // This outlet is the source, find the target
                            otherItem = allItems.find(i => i.id === connObj.targetItemId && i.type === 'acoutlet');
                        } else if (connObj.targetItemId === outlet.id) {
                            // This outlet is the target, find the source
                            otherItem = allItems.find(i => i.id === connObj.sourceItemId && i.type === 'acoutlet');
                        }
                        
                        if (otherItem && !visitedOutlets.has(otherItem.id)) {
                            // Mark the connection as live
                            LiveView.state.powerFlow[conn.connectionId] = { isLive: true, watts: 0 };
                            // Recursively mark the next outlet
                            markOutletAsLive(otherItem, visitedOutlets);
                        }
                    });
                }
            }
        }
        
        // Mark all outlets - start with ones directly connected to power sources
        // The recursive function will handle daisy-chained outlets
        allItems.filter(i => i.type === 'acoutlet').forEach(outlet => {
            if (outlet.handles.input) {
                for (const conn of outlet.handles.input.connectedTo) {
                    const connObj = connections.find(c => c.id === conn.connectionId);
                    if (!connObj) continue;
                    
                    const sourceItem = allItems.find(i => i.id === connObj.sourceItemId);
                    const targetItem = allItems.find(i => i.id === connObj.targetItemId);
                    
                    // Check if connected to a power source (breaker panel, breaker, or spiderbox)
                    const powerSource = sourceItem && (sourceItem.type === 'breakerpanel' || sourceItem.type === 'acbreaker' || sourceItem.type === 'spiderbox') 
                        ? sourceItem 
                        : (targetItem && (targetItem.type === 'breakerpanel' || targetItem.type === 'acbreaker' || targetItem.type === 'spiderbox') 
                            ? targetItem 
                            : null);
                    
                    if (powerSource) {
                        let shouldMark = false;

                        if (powerSource.type === 'breakerpanel') {
                            const mainConn = powerSource.handles.mainInput?.connectedTo?.[0];
                            if (mainConn && LiveView.state.powerFlow[mainConn.connectionId]?.isLive && powerSource.mainBreakerOn) {
                                const handleKey = connObj.sourceItemId === powerSource.id ? connObj.sourceHandleKey : connObj.targetHandleKey;
                                if (handleKey && handleKey.startsWith('circuit')) {
                                    const circuitNum = parseInt(handleKey.replace('circuit', '')) - 1;
                                    if (powerSource.breakerStates && powerSource.breakerStates[circuitNum]) {
                                        shouldMark = true;
                                    }
                                }
                            }
                        } else if (powerSource.type === 'acbreaker' && powerSource.isClosed) {
                            const breakerInput = powerSource.handles.lineIn?.connectedTo?.[0];
                            if (breakerInput && LiveView.state.powerFlow[breakerInput.connectionId]?.isLive) {
                                shouldMark = true;
                            }
                        } else if (powerSource.type === 'spiderbox' && powerSource.mainBreakerOn) {
                            const mainConn = powerSource.handles.mainInput?.connectedTo?.[0];
                            if (mainConn && LiveView.state.powerFlow[mainConn.connectionId]?.isLive) {
                                const handleKey = connObj.sourceItemId === powerSource.id ? connObj.sourceHandleKey : connObj.targetHandleKey;
                                if (handleKey && handleKey.startsWith('circuit')) {
                                    const handle = powerSource.handles[handleKey];
                                    if (handle && handle.isClosed !== false) {
                                        shouldMark = true;
                                    }
                                }
                            }
                        }
                        
                        if (shouldMark) {
                            markOutletAsLive(outlet);
                        }
                    }
                }
            }
        });
        
        // Mark Double Voltage Hub outputs as live if both inputs are connected
        allItems.filter(i => i.type === 'doublevoltagehub').forEach(hub => {
            const input1Conn = hub.handles.input1?.connectedTo?.[0];
            const input2Conn = hub.handles.input2?.connectedTo?.[0];
            const hasInput1 = input1Conn && LiveView.state.powerFlow[input1Conn.connectionId]?.isLive;
            const hasInput2 = input2Conn && LiveView.state.powerFlow[input2Conn.connectionId]?.isLive;
            
            // Hub can work with one or both inputs
            if (hasInput1 || hasInput2) {
                hub.handles.acOutput?.connectedTo?.forEach(conn => {
                    LiveView.state.powerFlow[conn.connectionId] = { isLive: true, watts: 0, is240V: hasInput1 && hasInput2 };
                });
            }
        });
        
        // Mark Breaker Panel circuit outputs as live if main is on
        allItems.filter(i => i.type === 'breakerpanel').forEach(panel => {
            if (!panel.mainBreakerOn) return;

            const mainConn = panel.handles.mainInput?.connectedTo?.[0];
            if (mainConn && LiveView.state.powerFlow[mainConn.connectionId]?.isLive) {
                // Check each circuit breaker
                for (let i = 0; i < 8; i++) {
                    if (panel.breakerStates && panel.breakerStates[i]) {
                        panel.handles[`circuit${i + 1}`]?.connectedTo?.forEach(conn => {
                            LiveView.state.powerFlow[conn.connectionId] = { isLive: true, watts: 0 };
                        });
                    }
                }
            }
        });
        
        // Mark Spider Box circuit outputs as live if main is on
        allItems.filter(i => i.type === 'spiderbox').forEach(spiderbox => {
            if (!spiderbox.mainBreakerOn) return;

            const mainConn = spiderbox.handles.mainInput?.connectedTo?.[0];
            if (mainConn && LiveView.state.powerFlow[mainConn.connectionId]?.isLive) {
                // All circuits are live when main is on
                spiderbox.specs.circuits.forEach((circuit, i) => {
                    const handle = spiderbox.handles[`circuit${i + 1}`];
                    if (handle?.isClosed !== false) {
                        handle?.connectedTo?.forEach(conn => {
                            LiveView.state.powerFlow[conn.connectionId] = { isLive: true, watts: 0, voltage: circuit.voltage };
                        });
                    }
                });
            }
        });
        
        // Mark Solar Combiner outputs as live if any input has power
        // Also calculate combined wattage from all live inputs
        allItems.filter(i => i.type === 'solarcombiner').forEach(combiner => {
            let totalInputWatts = 0;
            let totalInputAmps = 0;
            let inputVoltage = 0;
            let hasLiveInput = false;
            
            for (let j = 0; j < (combiner.specs?.inputs || 0); j++) {
                // Use BreakerManager to check if this input's breaker is closed
                if (!LiveView.BreakerManager.isSolarCombinerInputClosed(combiner, j)) continue;
                
                const inputPosConn = combiner.handles?.[`input${j}Positive`]?.connectedTo?.[0];
                if (inputPosConn) {
                    const inputPower = LiveView.state.powerFlow[inputPosConn.connectionId];
                    if (inputPower?.isLive) {
                        hasLiveInput = true;
                        totalInputWatts += inputPower.watts || 0;
                        totalInputAmps += inputPower.amps || 0;
                        if (!inputVoltage && inputPower.voltage) {
                            inputVoltage = inputPower.voltage;
                        }
                    }
                }
            }
            
            if (hasLiveInput) {
                const solarOutput = Simulation.currentSolarWatts || 0;
                const shouldAnimate = solarOutput > 0 && (Simulation.currentBatteryFlow > 0 || totalACWatts > 0);
                
                // Mark positive output
                combiner.handles?.outputPositive?.connectedTo.forEach(conn => {
                    LiveView.state.powerFlow[conn.connectionId] = { 
                        isLive: true, 
                        watts: totalInputWatts,
                        amps: totalInputAmps,
                        voltage: inputVoltage || 48,
                        isPV: true,
                        direction: 'pv-to-controller',
                        hasActiveFlow: shouldAnimate
                    };
                });
                
                // Mark negative output
                combiner.handles?.outputNegative?.connectedTo.forEach(conn => {
                    LiveView.state.powerFlow[conn.connectionId] = { 
                        isLive: true, 
                        watts: totalInputWatts,
                        amps: totalInputAmps,
                        voltage: inputVoltage || 48,
                        isPV: true,
                        direction: 'controller-to-pv',
                        hasActiveFlow: shouldAnimate
                    };
                });
            }
        });
        
        // Now determine which connections have active flow (loads are ON)
        // hasActiveFlow = isLive AND has an active load consuming power
        Object.keys(LiveView.state.powerFlow).forEach(connId => {
            const flow = LiveView.state.powerFlow[connId];
            if (!flow.isLive) {
                flow.hasActiveFlow = false;
                return;
            }
            
            // Check if this connection leads to an active load
            const conn = connections.find(c => c.id === connId);
            if (!conn) {
                flow.hasActiveFlow = false;
                return;
            }
            
            const targetItem = allItems.find(i => i.id === conn.targetItemId);
            if (targetItem && targetItem.type === 'acload') {
                // Connection goes to a load - check if load is ON
                flow.hasActiveFlow = LiveView.state.loadStates[targetItem.id] === true;
            } else if (targetItem && targetItem.type === 'acoutlet') {
                // Connection goes to an outlet - check if outlet has active loads
                let hasActiveLoad = false;
                if (targetItem.handles.load) {
                    for (const loadConn of targetItem.handles.load.connectedTo) {
                        const loadConnObj = connections.find(c => c.id === loadConn.connectionId);
                        if (loadConnObj) {
                            const loadItem = allItems.find(i => i.id === loadConnObj.targetItemId && i.type === 'acload');
                            if (loadItem && LiveView.state.loadStates[loadItem.id] === true) {
                                hasActiveLoad = true;
                                break;
                            }
                        }
                    }
                }
                flow.hasActiveFlow = hasActiveLoad;
            } else {
                // For other connections, check if any downstream connection has active flow
                // This will be set recursively
                flow.hasActiveFlow = false;
            }
        });
        
        // Propagate hasActiveFlow backwards through the circuit
        // If a downstream connection has active flow, upstream connections should too
        let changed = true;
        while (changed) {
            changed = false;
            connections.forEach(conn => {
                const flow = LiveView.state.powerFlow[conn.id];
                if (!flow || !flow.isLive) return;
                
                // Check downstream connections
                const targetItem = allItems.find(i => i.id === conn.targetItemId);
                if (targetItem) {
                    // Check all connections from this target item
                    Object.values(targetItem.handles || {}).forEach(handle => {
                        handle.connectedTo.forEach(downstreamConn => {
                            const downstreamFlow = LiveView.state.powerFlow[downstreamConn.connectionId];
                            if (downstreamFlow && downstreamFlow.hasActiveFlow && !flow.hasActiveFlow) {
                                flow.hasActiveFlow = true;
                                changed = true;
                            }
                        });
                    });
                }
            });
        }
        
        // Check for breaker tripping after power flow is calculated
        LiveView.BreakerManager.checkTripping();
        
        // Save power flow result to cache for performance optimization
        _powerFlowCache = { ...LiveView.state.powerFlow };
        _powerFlowCacheKey = cacheKey;
    }
    
    // Invalidate power flow cache (call when state changes significantly)
    function invalidatePowerFlowCache() {
        _powerFlowCache = null;
        _powerFlowCacheKey = null;
    }
    
    // ============================================
    // SAVE / LOAD
    // ============================================
    
    function getSolarConfig() {
        // Build comprehensive debugging info
        const debugInfo = {
            // Power flow state - which connections are live
            powerFlow: LiveView.state.active ? Object.fromEntries(
                Object.entries(LiveView.state.powerFlow).map(([connId, flow]) => [
                    connId,
                    {
                        isLive: flow.isLive,
                        watts: flow.watts || 0,
                        voltage: flow.voltage,
                        is240V: flow.is240V
                    }
                ])
            ) : {},
            
            // Load states - which loads are on/off
            loadStates: LiveView.state.active ? LiveView.state.loadStates : {},
            
            // Breaker states - which breakers are closed/tripped
            breakerStates: LiveView.state.active ? Object.fromEntries(
                Object.entries(LiveView.state.breakerStates).map(([breakerId, state]) => [
                    breakerId,
                    {
                        isClosed: state.isClosed,
                        wasTripped: state.wasTripped || false
                    }
                ])
            ) : {},
            
            // Connection details with animation status
            connectionDetails: connections.map(conn => {
                const sourceItem = allItems.find(i => i.id === conn.sourceItemId);
                const targetItem = allItems.find(i => i.id === conn.targetItemId);
                const powerFlow = LiveView.state.powerFlow[conn.id];
                
                // Get handle info for circuit breaker ratings
                const sourceHandle = sourceItem?.handles?.[conn.sourceHandleKey];
                const targetHandle = targetItem?.handles?.[conn.targetHandleKey];
                
                return {
                    id: conn.id,
                    sourceItemId: conn.sourceItemId,
                    sourceItemType: sourceItem?.type,
                    sourceHandleKey: conn.sourceHandleKey,
                    sourceHandleRating: sourceHandle?.maxAmps || sourceHandle?.rating,
                    sourceHandleVoltage: sourceHandle?.voltage,
                    targetItemId: conn.targetItemId,
                    targetItemType: targetItem?.type,
                    targetHandleKey: conn.targetHandleKey,
                    targetHandleRating: targetHandle?.maxAmps || targetHandle?.rating,
                    targetHandleVoltage: targetHandle?.voltage,
                    isLive: powerFlow?.isLive || false,
                    watts: powerFlow?.watts || 0,
                    voltage: powerFlow?.voltage,
                    is240V: powerFlow?.is240V
                };
            }),
            
            // Circuit breaker details for breaker panels and spider boxes
            circuitBreakerDetails: (() => {
                const details = {};
                
                // Breaker panels
                allItems.filter(i => i.type === 'breakerpanel').forEach(panel => {
                    if (!panel.breakerStates) panel.breakerStates = Array(8).fill(true);
                    details[panel.id] = {
                        mainBreakerOn: panel.mainBreakerOn,
                        mainRating: panel.specs.mainRating,
                        circuits: panel.breakerStates.map((isOn, i) => {
                            const handle = panel.handles[`circuit${i + 1}`];
                            const breakerId = `${panel.id}-circuit-${i + 1}`;
                            const breakerState = LiveView.state.active ? LiveView.state.breakerStates[breakerId] : null;
                            
                            return {
                                circuitNumber: i + 1,
                                name: handle?.circuitName || `Circuit ${i + 1}`,
                                rating: handle?.maxAmps || handle?.rating || 20,
                                voltage: handle?.voltage || 120,
                                isOn: isOn,
                                isTripped: breakerState?.wasTripped || false,
                                hasConnections: handle?.connectedTo?.length > 0
                            };
                        })
                    };
                });
                
                // Spider boxes
                allItems.filter(i => i.type === 'spiderbox').forEach(spiderbox => {
                    if (!spiderbox.specs.circuits) return;
                    details[spiderbox.id] = {
                        mainBreakerOn: spiderbox.mainBreakerOn,
                        circuits: spiderbox.specs.circuits.map((circuit, i) => {
                            const handle = spiderbox.handles[`circuit${i + 1}`];
                            const breakerId = `${spiderbox.id}-circuit-${i + 1}`;
                            const breakerState = LiveView.state.active ? LiveView.state.breakerStates[breakerId] : null;
                            
                            return {
                                circuitNumber: i + 1,
                                name: circuit.name,
                                rating: circuit.rating || handle?.maxAmps || 20,
                                voltage: circuit.voltage || 120,
                                isOn: handle?.isClosed !== false,
                                isTripped: breakerState?.wasTripped || false,
                                hasConnections: handle?.connectedTo?.length > 0
                            };
                        })
                    };
                });
                
                return details;
            })(),
            
            // Current mode and state
            mode: {
                currentMode: currentSolarMode,
                liveViewActive: LiveView.state.active,
                simulationPlaying: Simulation.isPlaying,
                simulationTime: Simulation.time
            }
        };
        
        return {
            // Core data
            items: allItems.map(item => ({
                id: item.id,
                type: item.type,
                x: item.x,
                y: item.y,
                width: item.width,
                height: item.height,
                specs: item.specs,
                isClosed: item.isClosed, // For breakers
                mainBreakerOn: item.mainBreakerOn, // For panels
                breakerStates: item.breakerStates, // For panels/combiner
                handles: Object.fromEntries(
                    Object.entries(item.handles).map(([k, h]) => [
                        k,
                        {
                            id: h.id,
                            polarity: h.polarity,
                            x: h.x,
                            y: h.y,
                            side: h.side,
                            voltage: h.voltage,
                            connectedTo: h.connectedTo.map(conn => ({
                                connectionId: conn.connectionId,
                                itemId: conn.itemId,
                                handleKey: conn.handleKey
                            }))
                        }
                    ])
                )
            })),
            
            connections: connections.map(conn => ({
                id: conn.id,
                sourceItemId: conn.sourceItemId,
                sourceHandleKey: conn.sourceHandleKey,
                targetItemId: conn.targetItemId,
                targetHandleKey: conn.targetHandleKey
            })),
            
            // Counters
            itemIdCounter,
            connectionIdCounter,
            
            // Automations
            automations: Automations.exportRules(),
            
            // Simulation state
            simulation: {
                time: Simulation.time,
                speed: Simulation.speed,
                isPlaying: Simulation.isPlaying,
                batterySOC: {...Simulation.batterySOC},
                solarIrradiance: Simulation.solarIrradiance,
                currentSolarWatts: Simulation.currentSolarWatts,
                currentLoadWatts: Simulation.currentLoadWatts,
                currentBatteryFlow: Simulation.currentBatteryFlow
            },
            
            // Comprehensive debugging info
            debug: debugInfo
        };
    }
    
    function loadSolarConfig(config) {
        if (!config) return;
        
        // Load automations if present
        if (config.automations) {
            Automations.importRules(config.automations);
            updateAutomationsList();
        }
        
        // Load simulation state if present
        if (config.simulation) {
            Simulation.time = config.simulation.time || 12 * 60;
            Simulation.batterySOC = config.simulation.batterySOC || {};
        }
        
        // Load resource system state
        if (config.resources) {
            ResourceSystem.importState(config.resources);
        }
        
        allItems = config.items || [];
        connections = config.connections || [];
        itemIdCounter = config.itemIdCounter || 0;
        connectionIdCounter = config.connectionIdCounter || 0;
        
        selectedItem = null;
        selectedConnection = null;
        
        render();
    }
    
    function clearAll() {
        if (allItems.length === 0 && Automations.rules.length === 0) return;
        if (!confirm('Clear all components, connections, and automations?')) return;
        
        allItems = [];
        connections = [];
        selectedItem = null;
        selectedConnection = null;
        itemIdCounter = 0;
        connectionIdCounter = 0;
        
        // Clear automations
        Automations.clearAll();
        updateAutomationsList();
        
        // Clear resource system
        ResourceSystem.clearAll();
        
        // Reset simulation
        Simulation.reset();
        
        if (LiveView.state.active) {
            stopLiveMode();
        }
        
        render();
    }
    
    // ============================================
    // INITIALIZATION
    // ============================================
    
    function init(config) {
        if (isInitialized) return;
        
        // Store linkage configuration if provided
        if (config) {
            linkageConfig = config;
        }
        
        initSVG();
        populatePresetSelects();
        setupEventListeners();
        setupTooltips();
        populateRightSidebarLibraries();
        setupRightSidebarListeners();
        
        isInitialized = true;
        
        // Load saved config if exists
        const saved = localStorage.getItem('linkageLab_solarConfig');
        if (saved) {
            try {
                loadSolarConfig(JSON.parse(saved));
            } catch (e) {
                console.error('Error loading solar config:', e);
            }
        }
        
        render();
        updateAutomationsList();
        updateStats();
    }
    
    // Update linkage config (can be called after init to refresh)
    function setLinkageConfig(config) {
        linkageConfig = config;
    }
    
    // Get current linkage config
    function getLinkageConfig() {
        return linkageConfig;
    }
    
    function populatePresetSelects() {
        // Panel presets
        const panelSelect = document.getElementById('panel-preset-select');
        PANEL_PRESETS.forEach((preset, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = `${preset.name} (${preset.wmp}W)`;
            panelSelect.appendChild(opt);
        });
        
        // Battery presets
        const batterySelect = document.getElementById('battery-preset-select');
        BATTERY_PRESETS.forEach((preset, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = `${preset.name}`;
            batterySelect.appendChild(opt);
        });
        
        // Controller presets
        const controllerSelect = document.getElementById('controller-preset-select');
        CONTROLLER_PRESETS.forEach((preset, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            const typeLabel = preset.type === 'hybrid_inverter' ? ' [Hybrid]' : 
                             preset.type === 'all_in_one' ? ' [AIO]' : '';
            opt.textContent = `${preset.name}${typeLabel}`;
            controllerSelect.appendChild(opt);
        });
        
        // Appliance presets
        const applianceSelect = document.getElementById('appliance-preset-select');
        APPLIANCE_PRESETS.forEach((preset, i) => {
            if (preset.name === 'Custom Load') return; // Skip custom, it's in palette
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = `${preset.icon} ${preset.name}`;
            applianceSelect.appendChild(opt);
        });
        
        // Producer presets
        const producerSelect = document.getElementById('producer-preset-select');
        PRODUCER_PRESETS.forEach((preset, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = `${preset.icon} ${preset.name} (${preset.watts}W)`;
            producerSelect.appendChild(opt);
        });
        
        // Container presets
        const containerSelect = document.getElementById('container-preset-select');
        CONTAINER_PRESETS.forEach((preset, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = `${preset.icon} ${preset.name}`;
            containerSelect.appendChild(opt);
        });
    }
    
    function setupEventListeners() {
        // Preset selects
        document.getElementById('panel-preset-select').onchange = (e) => {
            if (e.target.value === '') return;
            const preset = PANEL_PRESETS[parseInt(e.target.value)];
            const item = createPanel(getRandomPosition().x, getRandomPosition().y, preset);
            allItems.push(item);
            e.target.value = '';
            selectItem(item);
            render();
            showToast(`Added ${preset.name}`, 'info');
        };
        
        document.getElementById('battery-preset-select').onchange = (e) => {
            if (e.target.value === '') return;
            const preset = BATTERY_PRESETS[parseInt(e.target.value)];
            const item = createBattery(getRandomPosition().x, getRandomPosition().y + 100, preset);
            allItems.push(item);
            e.target.value = '';
            selectItem(item);
            render();
            showToast(`Added ${preset.name}`, 'info');
        };
        
        document.getElementById('controller-preset-select').onchange = (e) => {
            if (e.target.value === '') return;
            const preset = CONTROLLER_PRESETS[parseInt(e.target.value)];
            const item = createController(getRandomPosition().x + 150, getRandomPosition().y, preset);
            allItems.push(item);
            e.target.value = '';
            selectItem(item);
            render();
            showToast(`Added ${preset.name}`, 'info');
        };
        
        document.getElementById('appliance-preset-select').onchange = (e) => {
            if (e.target.value === '') return;
            const preset = APPLIANCE_PRESETS[parseInt(e.target.value)];
            const item = createACLoad(getRandomPosition().x + 250, getRandomPosition().y + 150, preset);
            allItems.push(item);
            e.target.value = '';
            selectItem(item);
            render();
            showToast(`Added ${preset.name}`, 'info');
        };
        
        // Producer preset select
        document.getElementById('producer-preset-select').onchange = (e) => {
            if (e.target.value === '') return;
            const preset = PRODUCER_PRESETS[parseInt(e.target.value)];
            const item = createProducer(getRandomPosition().x + 100, getRandomPosition().y + 200, preset);
            allItems.push(item);
            e.target.value = '';
            selectItem(item);
            render();
            updateStats();
            showToast(`Added ${preset.name}`, 'info');
        };
        
        // Container preset select
        document.getElementById('container-preset-select').onchange = (e) => {
            if (e.target.value === '') return;
            const preset = CONTAINER_PRESETS[parseInt(e.target.value)];
            const item = createContainer(getRandomPosition().x + 200, getRandomPosition().y + 100, preset);
            allItems.push(item);
            e.target.value = '';
            selectItem(item);
            render();
            showToast(`Added ${preset.name}`, 'info');
        };
        
        // Palette items
        document.querySelectorAll('.palette-item').forEach(el => {
            el.onclick = () => {
                const type = el.dataset.component;
                let item;
                const pos = getRandomPosition();
                
                switch (type) {
                    case 'acbreaker':
                        item = createACBreaker(pos.x, pos.y + 200);
                        break;
                    case 'acoutlet':
                        item = createACOutlet(pos.x + 100, pos.y + 200);
                        break;
                    case 'acoutlet240':
                        item = createACOutlet(pos.x + 100, pos.y + 200, 240);
                        break;
                    case 'customload':
                        item = createACLoad(pos.x + 200, pos.y + 200, APPLIANCE_PRESETS[0]);
                        break;
                    case 'dcbreaker':
                        item = createDCBreaker(pos.x, pos.y + 300);
                        break;
                    case 'combiner':
                        item = createCombiner(pos.x + 100, pos.y + 300);
                        break;
                    case 'solarcombiner':
                        item = createSolarCombinerBox(pos.x + 100, pos.y + 300);
                        break;
                    case 'breakerpanel':
                        item = createBreakerPanel(pos.x + 200, pos.y);
                        break;
                    case 'spiderbox':
                        item = createSpiderBox(pos.x + 200, pos.y + 150);
                        break;
                    case 'doublevoltagehub':
                        item = createDoubleVoltageHub(pos.x + 300, pos.y + 100);
                        break;
                    case 'smartbattery':
                        item = createSmartBattery(pos.x + 100, pos.y + 150);
                        break;
                }
                
                if (item) {
                    allItems.push(item);
                    selectItem(item);
                    render();
                    showToast(`Added ${type}`, 'info');
                }
            };
        });
        
        // Mode buttons (both sidebar and topbar)
        const buildBtns = [document.getElementById('btn-solar-build')];
        const liveBtns = [document.getElementById('btn-solar-live')];
        
        buildBtns.forEach(btn => {
            if (btn) btn.onclick = () => {
                if (LiveView.state.active) {
                    stopLiveMode();
                }
            };
        });
        
        liveBtns.forEach(btn => {
            if (btn) btn.onclick = () => {
                if (!LiveView.state.active) {
                    startLiveMode();
                }
            };
        });
        
        // Panel spacing slider (optional - may not exist in all HTML versions)
        const panelSpacingSlider = document.getElementById('panel-spacing-slider');
        if (panelSpacingSlider) {
            panelSpacingSlider.oninput = (e) => {
                const value = parseFloat(e.target.value);
                const spacingValue = document.getElementById('spacing-value');
                if (spacingValue) spacingValue.textContent = value.toFixed(1) + 'x';
                // Update the global variable (function is in index.html)
                if (typeof updateSolarPanelSpacing === 'function') {
                    updateSolarPanelSpacing(value);
                }
            };
        }
        
        // Properties panel buttons (with null checks)
        const btnPropDuplicate = document.getElementById('btn-prop-duplicate');
        const btnPropDelete = document.getElementById('btn-prop-delete');
        if (btnPropDuplicate) btnPropDuplicate.onclick = duplicateSelected;
        if (btnPropDelete) btnPropDelete.onclick = deleteSelected;
        
        // Export/Import buttons (with null checks)
        const btnSolarExport = document.getElementById('btn-solar-export');
        const btnSolarImport = document.getElementById('btn-solar-import');
        if (btnSolarExport) btnSolarExport.onclick = exportSolarConfig;
        if (btnSolarImport) btnSolarImport.onclick = importSolarConfig;
        
        // System Review button (with null check)
        const btnSolarReview = document.getElementById('btn-solar-review');
        if (btnSolarReview) btnSolarReview.onclick = showSystemReview;
        
        // BOM button (with null check)
        const btnSolarBom = document.getElementById('btn-solar-bom');
        if (btnSolarBom) btnSolarBom.onclick = showBillOfMaterials;
        
        // Clear button (with null check)
        const btnSolarClear = document.getElementById('btn-solar-clear');
        if (btnSolarClear) btnSolarClear.onclick = clearAll;
        
        // Return to Linkage button
        const linkageBtn = document.getElementById('btn-solar-to-linkage');
        if (linkageBtn) {
            linkageBtn.onclick = () => {
                // Call the global switchToLinkageMode function from index.html
                if (typeof switchToLinkageMode === 'function') {
                    switchToLinkageMode();
                }
            };
        }
        
        // Incident Report dismiss button
        const incidentDismiss = document.getElementById('incidentDismiss');
        if (incidentDismiss) {
            incidentDismiss.onclick = hideIncidentReport;
        }
        
        // Incident overlay click to dismiss
        const incidentOverlay = document.getElementById('incidentReportOverlay');
        if (incidentOverlay) {
            incidentOverlay.onclick = (e) => {
                if (e.target === incidentOverlay) {
                    hideIncidentReport();
                }
            };
        }
        
        // Simulation controls (both sidebar and topbar versions)
        const playBtns = [document.getElementById('btn-sim-play'), document.getElementById('btn-sim-play-top')];
        const pauseBtns = [document.getElementById('btn-sim-pause'), document.getElementById('btn-sim-pause-top')];
        const resetBtns = [document.getElementById('btn-sim-reset'), document.getElementById('btn-sim-reset-top')];
        const timeSliders = [document.getElementById('sim-time-slider'), document.getElementById('sim-time-slider-top')];
        
        playBtns.forEach(btn => {
            if (btn) btn.onclick = () => Simulation.play();
        });
        
        pauseBtns.forEach(btn => {
            if (btn) btn.onclick = () => Simulation.pause();
        });
        
        resetBtns.forEach(btn => {
            if (btn) btn.onclick = () => {
                Simulation.reset();
                render();
            };
        });
        
        timeSliders.forEach(slider => {
            if (slider) slider.oninput = (e) => {
                Simulation.setTime(parseInt(e.target.value));
                Simulation.updateBackgroundColor();
                render();
            };
        });
        
        // Daylight slider (topbar) - replaces azimuth/elevation in solar mode
        const daylightSliders = [
            document.getElementById('sl-daylight'),
            document.getElementById('sl-daylight-top')
        ];
        
        daylightSliders.forEach(slider => {
            if (slider) {
                slider.oninput = (e) => {
                    const daylightPercent = parseFloat(e.target.value);
                    const sunPos = Simulation.calculateSunPositionFromDaylight(daylightPercent);
                    
                    // Update simulation time to match daylight slider
                    Simulation.setTime(Math.round(sunPos.hours * 60));
                    
                    // Update time display
                    Simulation.updateTimeDisplay();
                    
                    // Update daylight time display
                    const timeDisplays = [
                        document.getElementById('daylight-time-display'),
                        document.getElementById('daylight-time-display-top')
                    ];
                    const formattedTime = Simulation.formatTime();
                    timeDisplays.forEach(display => {
                        if (display) display.textContent = formattedTime;
                    });
                    
                    // Update background and render
                    Simulation.updateBackgroundColor();
                    Simulation.calculateSolarOutput();
                    Simulation.updateSimulationStats();
                    render();
                };
            }
        });
        
        // Speed controls
        const speeds = [15, 30, 60, 120, 240, 480, 960]; // minutes per real second
        let currentSpeedIndex = 2; // Start at 60 (1h/s)
        
        const slowerBtns = [document.getElementById('btn-sim-slower'), document.getElementById('btn-sim-slower-top')];
        const fasterBtns = [document.getElementById('btn-sim-faster'), document.getElementById('btn-sim-faster-top')];
        
        slowerBtns.forEach(btn => {
            if (btn) btn.onclick = () => {
                if (currentSpeedIndex > 0) {
                    currentSpeedIndex--;
                    Simulation.setSpeed(speeds[currentSpeedIndex]);
                }
            };
        });
        
        fasterBtns.forEach(btn => {
            if (btn) btn.onclick = () => {
                if (currentSpeedIndex < speeds.length - 1) {
                    currentSpeedIndex++;
                    Simulation.setSpeed(speeds[currentSpeedIndex]);
                }
            };
        });
        
        // Speed select dropdowns (topbar)
        const speedSelects = [
            document.getElementById('sim-speed-select'),
            document.getElementById('sim-speed-select-top')
        ];
        
        speedSelects.forEach(select => {
            if (select) {
                select.onchange = (e) => {
                    const multiplier = parseInt(e.target.value);
                    // Speed is in minutes per real second: 60 = 1 hour per second
                    Simulation.setSpeed(60 * multiplier);
                };
            }
        });
        
        // ============================================
        // AUTOMATION EVENT HANDLERS
        // ============================================
        
        // Preset select (both sidebar and inspector versions)
        const presetSelects = [
            document.getElementById('auto-preset-select'),
            document.getElementById('auto-preset-select-inspector')
        ];
        
        presetSelects.forEach(select => {
            if (select) select.onchange = (e) => {
                const presetIndex = parseInt(e.target.value);
                if (!isNaN(presetIndex)) {
                    const rule = Automations.createFromPreset(presetIndex);
                    if (rule) {
                        updateAutomationsList();
                        showToast(`Added automation: ${rule.name}`, 'info');
                    }
                    e.target.value = '';
                }
            };
        });
        
        // Trigger type change - update UI
        document.getElementById('auto-trigger-type').onchange = (e) => {
            const type = e.target.value;
            const timeInput = document.getElementById('auto-trigger-time');
            const numInput = document.getElementById('auto-trigger-number');
            const unitSpan = document.getElementById('auto-trigger-unit');
            const valueRow = document.getElementById('auto-trigger-value-row');
            const value2Row = document.getElementById('auto-trigger-value2-row');
            
            // Show/hide appropriate inputs
            if (type === 'time') {
                timeInput.style.display = 'block';
                numInput.style.display = 'none';
                unitSpan.textContent = '';
                valueRow.style.display = 'flex';
                value2Row.style.display = 'none';
            } else if (type === 'time_range') {
                timeInput.style.display = 'block';
                numInput.style.display = 'none';
                unitSpan.textContent = '';
                valueRow.style.display = 'flex';
                value2Row.style.display = 'flex';
            } else if (type === 'sunrise' || type === 'sunset') {
                valueRow.style.display = 'none';
                value2Row.style.display = 'none';
            } else if (type.includes('battery')) {
                timeInput.style.display = 'none';
                numInput.style.display = 'block';
                numInput.value = type === 'battery_below' ? 20 : 80;
                numInput.max = 100;
                unitSpan.textContent = '%';
                valueRow.style.display = 'flex';
                value2Row.style.display = 'none';
            } else if (type.includes('solar')) {
                timeInput.style.display = 'none';
                numInput.style.display = 'block';
                numInput.value = type === 'solar_below' ? 100 : 500;
                numInput.max = 10000;
                unitSpan.textContent = 'W';
                valueRow.style.display = 'flex';
                value2Row.style.display = 'none';
            }
        };
        
        // Create rule button
        document.getElementById('btn-auto-create').onclick = () => {
            const name = document.getElementById('auto-rule-name').value || 'Custom Rule';
            const triggerType = document.getElementById('auto-trigger-type').value;
            const actionType = document.getElementById('auto-action-type').value;
            const targetType = document.getElementById('auto-action-target').value;
            
            // Build trigger
            let trigger = { type: triggerType };
            
            if (triggerType === 'time') {
                const timeVal = document.getElementById('auto-trigger-time').value;
                const [hours, mins] = timeVal.split(':').map(Number);
                trigger.value = hours * 60 + mins;
            } else if (triggerType === 'time_range') {
                const timeVal = document.getElementById('auto-trigger-time').value;
                const timeVal2 = document.getElementById('auto-trigger-time2').value;
                const [h1, m1] = timeVal.split(':').map(Number);
                const [h2, m2] = timeVal2.split(':').map(Number);
                trigger.value = h1 * 60 + m1;
                trigger.value2 = h2 * 60 + m2;
            } else if (triggerType.includes('battery') || triggerType.includes('solar')) {
                trigger.value = parseFloat(document.getElementById('auto-trigger-number').value);
            }
            
            // Build action
            let action = { type: actionType };
            if (targetType === 'all_loads') {
                action.targetType = 'acload';
            } else if (targetType === 'selected' && selectedItem) {
                action.targetIds = [selectedItem.id];
            } else {
                action.targetType = 'acload';
            }
            
            const rule = Automations.createRule(name, trigger, action);
            updateAutomationsList();
            showToast(`Created automation: ${rule.name}`, 'info');
            
            // Clear name input
            document.getElementById('auto-rule-name').value = '';
        };
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (!document.body.classList.contains('solar-mode')) return;
            
            // Don't trigger shortcuts when typing in inputs
            const isTyping = e.target.matches('input, textarea, select');
            
            // Delete/Backspace - delete selected item
            if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping) {
                e.preventDefault();
                deleteSelected();
            }
            
            // Escape - deselect all
            if (e.key === 'Escape') {
                deselectAll();
            }
            
            // Ctrl+D - duplicate selected
            if (e.ctrlKey && e.key === 'd' && !isTyping) {
                e.preventDefault();
                duplicateSelected();
            }
            
            // Ctrl+S - save/export config
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                exportSolarConfig();
                showToast('Configuration saved!', 'success');
            }
            
            // Ctrl+Z - undo (placeholder for future implementation)
            if (e.ctrlKey && e.key === 'z' && !isTyping) {
                e.preventDefault();
                showToast('Undo not yet implemented', 'info');
            }
            
            // ? or F1 - show help
            if (e.key === '?' || e.key === 'F1') {
                e.preventDefault();
                showHelpModal();
            }
            
            // Space - toggle simulation play/pause in live mode
            if (e.key === ' ' && !isTyping && LiveView.state.active) {
                e.preventDefault();
                if (Simulation.isPlaying) {
                    Simulation.pause();
                } else {
                    Simulation.play();
                }
            }
            
            // R - reset simulation time
            if (e.key === 'r' && !isTyping && LiveView.state.active) {
                e.preventDefault();
                Simulation.reset();
            }
            
            // B - toggle between build/live mode
            if (e.key === 'b' && !isTyping) {
                e.preventDefault();
                if (LiveView.state.active) {
                    stopLiveMode();
                } else {
                    startLiveMode();
                }
            }
            
            // H - toggle hints/tooltips
            if (e.key === 'h' && !isTyping) {
                e.preventDefault();
                toggleHints();
            }
            
            // K - show keyboard shortcuts
            if (e.key === 'k' && !isTyping) {
                e.preventDefault();
                showKeyboardShortcuts();
            }
        });
        
        // Auto-save
        setInterval(() => {
            if (allItems.length > 0 || connections.length > 0) {
                localStorage.setItem('linkageLab_solarConfig', JSON.stringify(getSolarConfig()));
            }
        }, 5000);
    }
    
    // ============================================
    // PHASE 10: HELP & TUTORIAL SYSTEM
    // ============================================
    
    function showHelpModal() {
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.9);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: var(--bg-darker);
            border: 2px solid var(--clr-primary);
            border-radius: 8px;
            max-width: 900px;
            width: 100%;
            max-height: 90vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        `;
        
        content.innerHTML = `
            <div style="padding: 20px; border-bottom: 2px solid var(--clr-primary); background: linear-gradient(135deg, rgba(var(--clr-primary-rgb), 0.1) 0%, transparent 100%); display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 2rem;">❓</span>
                    <span style="font-size: 1.3rem; font-weight: 600; color: var(--clr-primary);">Solar Designer Help</span>
                </div>
                <button id="help-close" style="background: none; border: none; color: var(--text-primary); font-size: 2rem; cursor: pointer; padding: 0; width: 40px; height: 40px;">×</button>
            </div>
            
            <div style="flex: 1; overflow-y: auto; padding: 24px;">
                <style>
                    .help-section { margin-bottom: 32px; }
                    .help-section-title { font-size: 1.2rem; font-weight: 600; color: var(--clr-primary); margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
                    .help-item { margin-bottom: 16px; padding: 12px; background: var(--bg-input); border-left: 3px solid var(--clr-primary); border-radius: 4px; }
                    .help-item-title { font-weight: 600; margin-bottom: 6px; color: var(--text-primary); }
                    .help-item-desc { color: var(--text-muted); font-size: 0.9rem; line-height: 1.5; }
                    .help-tip { padding: 12px; background: rgba(var(--clr-success-rgb), 0.1); border: 1px solid var(--clr-success); border-radius: 6px; margin-top: 16px; }
                </style>
                
                <div class="help-section">
                    <div class="help-section-title">🎯 Getting Started</div>
                    <div class="help-item">
                        <div class="help-item-title">1. Switch to Solar Mode</div>
                        <div class="help-item-desc">Click the "⚡ Solar" button in the top bar to enter Solar Designer mode.</div>
                    </div>
                    <div class="help-item">
                        <div class="help-item-title">2. Add Components</div>
                        <div class="help-item-desc">Use the left sidebar to select component presets. Click a preset to place it on the canvas. You can drag components to reposition them.</div>
                    </div>
                    <div class="help-item">
                        <div class="help-item-title">3. Connect Components</div>
                        <div class="help-item-desc">Click and drag from a component's connection point (handle) to another compatible handle to create wires. Red = DC+, Dark = DC-, Orange = AC.</div>
                    </div>
                    <div class="help-item">
                        <div class="help-item-title">4. Test Your System</div>
                        <div class="help-item-desc">Click "▶ Live" to simulate your solar system over a 24-hour cycle. Use the time controls to scrub through the day and watch power flow.</div>
                    </div>
                </div>
                
                <div class="help-section">
                    <div class="help-section-title">🔌 Component Types</div>
                    <div class="help-item">
                        <div class="help-item-title">Solar Panels</div>
                        <div class="help-item-desc">Generate DC power from sunlight. Output varies with time of day and solar irradiance. Connect to charge controllers.</div>
                    </div>
                    <div class="help-item">
                        <div class="help-item-title">Batteries</div>
                        <div class="help-item-desc">Store energy for later use. Charge during sunny periods, discharge when needed. Monitor SOC (State of Charge) in live mode.</div>
                    </div>
                    <div class="help-item">
                        <div class="help-item-title">Charge Controllers</div>
                        <div class="help-item-desc">Regulate power from solar panels to batteries. Support MPPT or PWM types. Some include built-in inverters.</div>
                    </div>
                    <div class="help-item">
                        <div class="help-item-title">Inverters</div>
                        <div class="help-item-desc">Convert DC power to AC for household appliances. Match voltage (120V/240V) to your loads.</div>
                    </div>
                    <div class="help-item">
                        <div class="help-item-title">Loads & Appliances</div>
                        <div class="help-item-desc">AC devices that consume power. Toggle on/off in live mode. Production appliances can create resources (water, ice, etc.).</div>
                    </div>
                </div>
                
                <div class="help-section">
                    <div class="help-section-title">⚡ Automations</div>
                    <div class="help-item">
                        <div class="help-item-desc">Create rules to automatically control loads based on time, battery level, or solar input. Use quick presets or build custom rules.</div>
                    </div>
                </div>
                
                <div class="help-section">
                    <div class="help-section-title">📊 Analysis Tools</div>
                    <div class="help-item">
                        <div class="help-item-title">System Review</div>
                        <div class="help-item-desc">Get a comprehensive analysis with optimization score, energy metrics, and financial projections. Adjust calculation settings for your location.</div>
                    </div>
                    <div class="help-item">
                        <div class="help-item-title">Bill of Materials (BOM)</div>
                        <div class="help-item-desc">Generate a complete parts list with costs. Download as JSON or text for procurement.</div>
                    </div>
                </div>
                
                <div class="help-tip">
                    💡 <strong>Pro Tip:</strong> Press <kbd>K</kbd> to view all keyboard shortcuts, or <kbd>?</kbd> to reopen this help dialog.
                </div>
            </div>
        `;
        
        modal.appendChild(content);
        document.body.appendChild(modal);
        
        document.getElementById('help-close').onclick = () => document.body.removeChild(modal);
        modal.onclick = (e) => { if (e.target === modal) document.body.removeChild(modal); };
    }
    
    function showKeyboardShortcuts() {
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.85);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: var(--bg-darker);
            border: 2px solid var(--clr-primary);
            border-radius: 8px;
            max-width: 700px;
            width: 100%;
            max-height: 90vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        `;
        
        content.innerHTML = `
            <div style="padding: 16px 20px; border-bottom: 2px solid var(--clr-primary); background: linear-gradient(135deg, rgba(var(--clr-primary-rgb), 0.1) 0%, transparent 100%); display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 1.5rem;">⌨️</span>
                    <span style="font-size: 1.1rem; font-weight: 600; color: var(--clr-primary);">Keyboard Shortcuts</span>
                </div>
                <button id="shortcuts-close" style="background: none; border: none; color: var(--text-primary); font-size: 1.8rem; cursor: pointer; padding: 0; width: 36px; height: 36px;">×</button>
            </div>
            
            <div style="flex: 1; overflow-y: auto; padding: 20px;">
                <style>
                    .shortcut-group { margin-bottom: 24px; }
                    .shortcut-group-title { font-size: 1rem; font-weight: 600; color: var(--clr-primary); margin-bottom: 10px; }
                    .shortcut-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border-light); }
                    .shortcut-row:last-child { border-bottom: none; }
                    .shortcut-desc { color: var(--text-muted); font-size: 0.9rem; }
                    .shortcut-keys { display: flex; gap: 6px; }
                    .shortcut-key { 
                        background: var(--bg-input); 
                        border: 1px solid var(--border-light); 
                        border-radius: 4px; 
                        padding: 4px 10px; 
                        font-family: monospace; 
                        font-size: 0.85rem; 
                        font-weight: 600;
                        color: var(--clr-primary);
                        box-shadow: 0 2px 0 var(--border-dark);
                    }
                </style>
                
                <div class="shortcut-group">
                    <div class="shortcut-group-title">📝 General</div>
                    <div class="shortcut-row">
                        <span class="shortcut-desc">Delete selected item</span>
                        <div class="shortcut-keys"><span class="shortcut-key">Del</span> or <span class="shortcut-key">Backspace</span></div>
                    </div>
                    <div class="shortcut-row">
                        <span class="shortcut-desc">Deselect all</span>
                        <div class="shortcut-keys"><span class="shortcut-key">Esc</span></div>
                    </div>
                    <div class="shortcut-row">
                        <span class="shortcut-desc">Duplicate selected</span>
                        <div class="shortcut-keys"><span class="shortcut-key">Ctrl</span> + <span class="shortcut-key">D</span></div>
                    </div>
                    <div class="shortcut-row">
                        <span class="shortcut-desc">Save configuration</span>
                        <div class="shortcut-keys"><span class="shortcut-key">Ctrl</span> + <span class="shortcut-key">S</span></div>
                    </div>
                </div>
                
                <div class="shortcut-group">
                    <div class="shortcut-group-title">🎮 Simulation</div>
                    <div class="shortcut-row">
                        <span class="shortcut-desc">Toggle Build/Live mode</span>
                        <div class="shortcut-keys"><span class="shortcut-key">B</span></div>
                    </div>
                    <div class="shortcut-row">
                        <span class="shortcut-desc">Play/Pause simulation</span>
                        <div class="shortcut-keys"><span class="shortcut-key">Space</span></div>
                    </div>
                    <div class="shortcut-row">
                        <span class="shortcut-desc">Reset time to noon</span>
                        <div class="shortcut-keys"><span class="shortcut-key">R</span></div>
                    </div>
                </div>
                
                <div class="shortcut-group">
                    <div class="shortcut-group-title">ℹ️ Help</div>
                    <div class="shortcut-row">
                        <span class="shortcut-desc">Show help dialog</span>
                        <div class="shortcut-keys"><span class="shortcut-key">?</span> or <span class="shortcut-key">F1</span></div>
                    </div>
                    <div class="shortcut-row">
                        <span class="shortcut-desc">Show keyboard shortcuts</span>
                        <div class="shortcut-keys"><span class="shortcut-key">K</span></div>
                    </div>
                    <div class="shortcut-row">
                        <span class="shortcut-desc">Toggle hints</span>
                        <div class="shortcut-keys"><span class="shortcut-key">H</span></div>
                    </div>
                </div>
            </div>
        `;
        
        modal.appendChild(content);
        document.body.appendChild(modal);
        
        document.getElementById('shortcuts-close').onclick = () => document.body.removeChild(modal);
        modal.onclick = (e) => { if (e.target === modal) document.body.removeChild(modal); };
    }
    
    let hintsEnabled = true;
    
    function toggleHints() {
        hintsEnabled = !hintsEnabled;
        const hintElements = document.querySelectorAll('.solar-hint, .live-mode-hint');
        hintElements.forEach(el => {
            el.style.display = hintsEnabled ? '' : 'none';
        });
        showToast(hintsEnabled ? 'Hints enabled' : 'Hints disabled', 'info');
        localStorage.setItem('linkageLab_hintsEnabled', hintsEnabled);
    }
    
    function showWelcomeDialog() {
        // Check if user has seen welcome before
        if (localStorage.getItem('linkageLab_welcomeSeen')) return;
        
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.92);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            animation: fadeIn 0.3s ease;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: linear-gradient(135deg, var(--bg-darker) 0%, var(--bg-body) 100%);
            border: 3px solid var(--clr-primary);
            border-radius: 12px;
            max-width: 600px;
            width: 100%;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            animation: slideUp 0.4s ease;
        `;
        
        content.innerHTML = `
            <style>
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes slideUp { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            </style>
            <div style="padding: 32px; text-align: center;">
                <div style="font-size: 4rem; margin-bottom: 16px;">⚡</div>
                <h1 style="font-size: 2rem; font-weight: 700; color: var(--clr-primary); margin: 0 0 12px 0;">Welcome to Solar Designer!</h1>
                <p style="font-size: 1.1rem; color: var(--text-muted); margin: 0 0 24px 0; line-height: 1.6;">
                    Design, simulate, and optimize your off-grid solar power system with real-time analysis and professional-grade tools.
                </p>
                
                <div style="background: var(--bg-input); padding: 20px; border-radius: 8px; margin-bottom: 24px; text-align: left;">
                    <div style="margin-bottom: 12px;">
                        <span style="font-size: 1.2rem; margin-right: 8px;">🔌</span>
                        <strong>Drag & Drop Components</strong> - Build your system visually
                    </div>
                    <div style="margin-bottom: 12px;">
                        <span style="font-size: 1.2rem; margin-right: 8px;">⏰</span>
                        <strong>24-Hour Simulation</strong> - Watch power flow in real-time
                    </div>
                    <div style="margin-bottom: 12px;">
                        <span style="font-size: 1.2rem; margin-right: 8px;">🤖</span>
                        <strong>Smart Automations</strong> - Control loads automatically
                    </div>
                    <div>
                        <span style="font-size: 1.2rem; margin-right: 8px;">📊</span>
                        <strong>Financial Analysis</strong> - Calculate ROI and payback period
                    </div>
                </div>
                
                <button id="welcome-start" style="
                    background: var(--clr-primary);
                    color: white;
                    border: none;
                    padding: 14px 32px;
                    font-size: 1.1rem;
                    font-weight: 600;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: all 0.2s;
                    box-shadow: 0 4px 12px rgba(var(--clr-primary-rgb), 0.4);
                    margin-bottom: 12px;
                    width: 100%;
                " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(var(--clr-primary-rgb), 0.5)';" onmouseout="this.style.transform=''; this.style.boxShadow='0 4px 12px rgba(var(--clr-primary-rgb), 0.4)';">
                    🚀 Get Started
                </button>
                
                <button id="welcome-help" style="
                    background: transparent;
                    color: var(--text-muted);
                    border: 1px solid var(--border-light);
                    padding: 10px 24px;
                    font-size: 0.9rem;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: all 0.2s;
                    width: 100%;
                " onmouseover="this.style.borderColor='var(--clr-primary)'; this.style.color='var(--clr-primary)';" onmouseout="this.style.borderColor='var(--border-light)'; this.style.color='var(--text-muted)';">
                    📖 View Help & Tutorial
                </button>
                
                <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 20px;">
                    Press <strong>?</strong> anytime for help or <strong>K</strong> for keyboard shortcuts
                </p>
            </div>
        `;
        
        modal.appendChild(content);
        document.body.appendChild(modal);
        
        document.getElementById('welcome-start').onclick = () => {
            localStorage.setItem('linkageLab_welcomeSeen', 'true');
            document.body.removeChild(modal);
        };
        
        document.getElementById('welcome-help').onclick = () => {
            localStorage.setItem('linkageLab_welcomeSeen', 'true');
            document.body.removeChild(modal);
            setTimeout(showHelpModal, 100);
        };
    }
    
    // ============================================
    // HELPER FUNCTIONS
    // ============================================
    
    // Helper to get random position near center
    function getRandomPosition() {
        return {
            x: (Math.random() - 0.5) * 200,
            y: (Math.random() - 0.5) * 200
        };
    }
    
    // Replace component with new preset, preserving connections
    function replaceComponent(item, type, newPreset) {
        if (!item || item.type !== type) return;
        
        // Store original connections
        const originalConnections = {};
        Object.keys(item.handles).forEach(handleKey => {
            originalConnections[handleKey] = [...(item.handles[handleKey].connectedTo || [])];
        });
        
        // Store position and other metadata
        const x = item.x;
        const y = item.y;
        const id = item.id;
        
        // Create new item with preset
        let newItem;
        if (type === 'panel') {
            newItem = createPanel(x, y, newPreset);
        } else if (type === 'battery') {
            newItem = createBattery(x, y, newPreset);
        } else if (type === 'controller') {
            newItem = createController(x, y, newPreset);
        } else {
            return; // Unsupported type
        }
        
        if (!newItem) return;
        
        // Preserve ID and position
        newItem.id = id;
        newItem.x = x;
        newItem.y = y;
        
        // Restore connections where compatible
        Object.keys(originalConnections).forEach(handleKey => {
            if (newItem.handles[handleKey]) {
                const originalConns = originalConnections[handleKey];
                const newHandle = newItem.handles[handleKey];
                
                // Validate and restore each connection
                originalConns.forEach(conn => {
                    const targetItem = allItems.find(i => i.id === conn.itemId);
                    if (!targetItem) return;
                    
                    const targetHandle = targetItem.handles[conn.handleKey];
                    if (!targetHandle) return;
                    
                    // Check voltage compatibility for AC connections
                    if (newHandle.voltage && targetHandle.voltage) {
                        if (newHandle.voltage !== targetHandle.voltage) {
                            showHint(`Voltage mismatch: ${newHandle.voltage}V cannot connect to ${targetHandle.voltage}V`, 'warning');
                            return; // Skip incompatible connection
                        }
                    }
                    
                    // Restore connection
                    const connection = connections.find(c => c.id === conn.connectionId);
                    if (connection) {
                        // Update connection to point to new item
                        if (connection.sourceItemId === id) {
                            connection.sourceItemId = newItem.id;
                            connection.sourceHandleKey = handleKey;
                        } else if (connection.targetItemId === id) {
                            connection.targetItemId = newItem.id;
                            connection.targetHandleKey = handleKey;
                        }
                        
                        // Add to new handle
                        newHandle.connectedTo.push(conn);
                        
                        // Update target handle's connection reference
                        const targetConn = targetHandle.connectedTo.find(c => c.connectionId === conn.connectionId);
                        if (targetConn) {
                            targetConn.itemId = newItem.id;
                            targetConn.handleKey = handleKey;
                        }
                    }
                });
            }
        });
        
        // Replace item in array
        const itemIndex = allItems.findIndex(i => i.id === id);
        if (itemIndex !== -1) {
            allItems[itemIndex] = newItem;
        }
        
        // Update selection
        if (selectedItem && selectedItem.id === id) {
            selectedItem = newItem;
        }
        
        // Re-render and update
        render();
        updateStats();
        updatePropertiesPanel();
        calculatePowerFlow();
        showToast(`Replaced with ${newPreset.name}`, 'success');
    }
    
    // Duplicate selected item
    function duplicateSelected() {
        if (!selectedItem) return;
        
        const item = selectedItem;
        let newItem;
        
        if (item.type === 'panel') {
            newItem = createPanel(item.x + 30, item.y + 30, item.specs);
        } else if (item.type === 'battery') {
            newItem = createBattery(item.x + 30, item.y + 30, item.specs);
        } else if (item.type === 'controller') {
            newItem = createController(item.x + 30, item.y + 30, item.specs);
        } else if (item.type === 'acbreaker') {
            newItem = createACBreaker(item.x + 30, item.y + 30, item.specs.rating);
        } else if (item.type === 'dcbreaker') {
            newItem = createDCBreaker(item.x + 30, item.y + 30, item.specs.rating);
        } else if (item.type === 'acoutlet') {
            newItem = createACOutlet(item.x + 30, item.y + 30, item.specs.voltage);
        } else if (item.type === 'acload') {
            newItem = createACLoad(item.x + 30, item.y + 30, item.specs);
        } else if (item.type === 'combiner') {
            newItem = createCombiner(item.x + 30, item.y + 30, item.specs.inputs);
        }
        
        if (newItem) {
            allItems.push(newItem);
            selectItem(newItem);
            render();
            showToast('Duplicated', 'info');
        }
    }
    
    // Export solar config to JSON file
    function exportSolarConfig() {
        const config = getSolarConfig();
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `solar-design-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Exported solar design', 'info');
    }
    
    /**
     * Export current design to Solar Simulator (3D mode)
     * Uses the shared ExportFormat for standardized data exchange
     */
    function exportToSimulator() {
        // Get current config
        const config = getSolarConfig();
        
        // Calculate summary stats
        let totalPanelWatts = 0;
        let totalBatteryKwh = 0;
        let totalLoadWatts = 0;
        
        allItems.forEach(item => {
            if (item.type === 'panel') {
                totalPanelWatts += item.specs.wmp || 0;
            } else if (item.type === 'battery') {
                totalBatteryKwh += ((item.specs.voltage || 0) * (item.specs.ah || 0)) / 1000;
            } else if (item.type === 'smartbattery') {
                totalBatteryKwh += item.specs.kWh || 0;
            } else if (item.type === 'controller' && item.specs.internalBatteryKWh) {
                totalBatteryKwh += item.specs.internalBatteryKWh;
            } else if (item.type === 'acload' || item.type === 'producer') {
                totalLoadWatts += item.specs.watts || 0;
            }
        });
        
        // Create export using shared format
        const exportData = ExportFormat.createDesignerExport({
            // Components
            components: config.items,
            connections: config.connections,
            
            // Canvas state (get current transform from D3 if available)
            canvasWidth: 2000,
            canvasHeight: 1500,
            zoom: svg ? d3.zoomTransform(svg.node()).k : 1,
            panX: svg ? d3.zoomTransform(svg.node()).x : 0,
            panY: svg ? d3.zoomTransform(svg.node()).y : 0,
            
            // Automation rules
            automationRules: Automations.exportRules(),
            
            // Simulation state
            timeOfDay: Simulation.time,
            isLiveMode: LiveView.state.active,
            loadStates: LiveView.state.loadStates,
            breakerStates: LiveView.state.breakerStates,
            
            // Summary
            totalPanelWatts,
            totalBatteryKwh,
            totalLoadWatts,
            componentCount: allItems.length
        });
        
        // Save to localStorage
        ExportFormat.saveToStorage(ExportFormat.STORAGE_KEYS.DESIGNER_EXPORT, exportData);
        
        // Also save automation rules separately for potential sync
        ExportFormat.saveToStorage(ExportFormat.STORAGE_KEYS.AUTOMATION_RULES, Automations.exportRules());
        
        // Open Solar Simulator with import flag
        window.open('solar_simulator.html?import=solarDesigner', '_blank');
        
        showToast(`Exported ${allItems.length} components to 3D Simulator`, 'info');
    }
    
    // Import solar config from JSON file
    function importSolarConfig() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const config = JSON.parse(event.target.result);
                    loadSolarConfig(config);
                    showToast('Imported solar design', 'info');
                } catch (err) {
                    showToast('Invalid file format', 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }
    
    // Display BOM in modal
    function showBillOfMaterials() {
        const bom = BOMSystem.generateBOM();
        
        // Create modal overlay
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.85);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: var(--bg-darker);
            border: 2px solid var(--clr-warning);
            border-radius: 8px;
            max-width: 700px;
            width: 100%;
            max-height: 90vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        `;
        
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 16px 20px;
            border-bottom: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        header.innerHTML = `
            <h2 style="margin:0; color:var(--clr-warning); font-size:1.2rem;">📋 Bill of Materials</h2>
            <button id="bom-close" style="background:transparent; border:none; color:#fff; font-size:1.5rem; cursor:pointer; padding:0 8px;">&times;</button>
        `;
        
        const body = document.createElement('div');
        body.style.cssText = `
            padding: 20px;
            overflow-y: auto;
            flex: 1;
        `;
        
        // Build BOM HTML
        let html = '';
        
        const addSection = (title, items, icon) => {
            if (items.length === 0) return '';
            let section = `<div style="margin-bottom:20px;">
                <h3 style="color:var(--clr-warning); font-size:0.9rem; margin-bottom:10px;">${icon} ${title}</h3>
                <table style="width:100%; font-size:0.75rem; border-collapse:collapse;">
                    <thead>
                        <tr style="border-bottom:1px solid var(--border-light); color:var(--text-muted);">
                            <th style="text-align:left; padding:4px 8px;">Qty</th>
                            <th style="text-align:left; padding:4px 8px;">Item</th>
                            <th style="text-align:right; padding:4px 8px;">Unit $</th>
                            <th style="text-align:right; padding:4px 8px;">Total $</th>
                        </tr>
                    </thead>
                    <tbody>`;
            items.forEach(item => {
                section += `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                    <td style="padding:4px 8px;">${item.quantity}×</td>
                    <td style="padding:4px 8px;">
                        ${item.name}
                        ${item.specs && Object.keys(item.specs).length > 0 ? 
                            `<br><span style="font-size:0.65rem; color:var(--text-muted);">${Object.entries(item.specs).map(([k,v]) => `${k}: ${v}`).join(', ')}</span>` : ''}
                    </td>
                    <td style="text-align:right; padding:4px 8px;">$${item.unitCost.toFixed(2)}</td>
                    <td style="text-align:right; padding:4px 8px; font-weight:bold;">$${item.totalCost.toFixed(2)}</td>
                </tr>`;
            });
            section += `</tbody></table></div>`;
            return section;
        };
        
        html += addSection('Solar Panels', bom.panels, '☀️');
        html += addSection('Batteries & Storage', bom.batteries, '🔋');
        html += addSection('Controllers & Inverters', bom.controllers, '⚡');
        html += addSection('Distribution & Breakers', bom.distribution, '🔌');
        html += addSection('Wiring', bom.wiring, '🔧');
        html += addSection('Loads & Appliances', bom.loads, '💡');
        html += addSection('Producers', bom.producers, '🏭');
        html += addSection('Resource Containers', bom.containers, '🛢️');
        
        html += `<div style="margin-top:20px; padding:16px; background:rgba(240,173,78,0.15); border:2px solid var(--clr-warning); border-radius:6px; text-align:center;">
            <div style="font-size:1.2rem; color:var(--clr-warning); font-weight:bold;">TOTAL COST: $${bom.totalCost.toFixed(2)}</div>
            <div style="font-size:0.65rem; color:var(--text-muted); margin-top:4px;">Generated: ${new Date().toLocaleString()}</div>
        </div>`;
        
        html += `<div style="margin-top:16px; display:flex; gap:8px;">
            <button id="bom-download-json" style="flex:1; padding:8px; background:rgba(92,184,92,0.2); border:1px solid #5cb85c; color:#5cb85c; border-radius:4px; cursor:pointer; font-size:0.75rem;">💾 Download JSON</button>
            <button id="bom-download-text" style="flex:1; padding:8px; background:rgba(92,184,92,0.2); border:1px solid #5cb85c; color:#5cb85c; border-radius:4px; cursor:pointer; font-size:0.75rem;">📄 Download TXT</button>
        </div>`;
        
        body.innerHTML = html;
        
        content.appendChild(header);
        content.appendChild(body);
        modal.appendChild(content);
        document.body.appendChild(modal);
        
        // Event handlers
        document.getElementById('bom-close').onclick = () => {
            document.body.removeChild(modal);
        };
        
        modal.onclick = (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        };
        
        document.getElementById('bom-download-json').onclick = () => {
            const blob = new Blob([JSON.stringify(bom, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `solar-bom-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Downloaded BOM as JSON', 'info');
        };
        
        document.getElementById('bom-download-text').onclick = () => {
            const text = BOMSystem.exportBOMText(bom);
            const blob = new Blob([text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `solar-bom-${Date.now()}.txt`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Downloaded BOM as text', 'info');
        };
    }
    
    function showSystemReview() {
        const analysis = SystemReview.analyzeSystem();
        
        // Create modal overlay
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.85);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: var(--bg-darker);
            border: 2px solid var(--clr-primary);
            border-radius: 8px;
            max-width: 800px;
            width: 100%;
            max-height: 90vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        `;
        
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 16px 20px;
            border-bottom: 2px solid var(--clr-primary);
            background: linear-gradient(135deg, rgba(var(--clr-primary-rgb), 0.1) 0%, transparent 100%);
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        header.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 1.5rem;">📊</span>
                <span style="font-size: 1.1rem; font-weight: 600; color: var(--clr-primary);">System Review & Analysis</span>
            </div>
            <button id="review-close" style="background: none; border: none; color: var(--text-primary); font-size: 1.5rem; cursor: pointer; padding: 0; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: all 0.2s;" onmouseover="this.style.background='var(--bg-toolbar)'; this.style.color='var(--clr-danger)';" onmouseout="this.style.background='none'; this.style.color='var(--text-primary)';">×</button>
        `;
        
        const body = document.createElement('div');
        body.style.cssText = `
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 20px;
        `;
        
        // Build HTML content
        const opt = analysis.optimization;
        const comp = analysis.components;
        const energy = analysis.energy;
        const financial = analysis.financial;
        
        let html = `
            <style>
                .review-section {
                    margin-bottom: 24px;
                    padding: 16px;
                    background: var(--bg-input);
                    border: 1px solid var(--border-light);
                    border-radius: 6px;
                }
                .review-section-title {
                    font-size: 1rem;
                    font-weight: 600;
                    margin-bottom: 12px;
                    color: var(--clr-primary);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .review-row {
                    display: flex;
                    justify-content: space-between;
                    padding: 6px 0;
                    border-bottom: 1px solid var(--border-light);
                }
                .review-row:last-child {
                    border-bottom: none;
                }
                .review-label {
                    color: var(--text-muted);
                    font-size: 0.9rem;
                }
                .review-value {
                    color: var(--text-primary);
                    font-weight: 500;
                    font-size: 0.9rem;
                }
                .grade-display {
                    text-align: center;
                    padding: 20px;
                    background: var(--bg-darker);
                    border-radius: 8px;
                    margin-bottom: 16px;
                }
                .grade-letter {
                    font-size: 4rem;
                    font-weight: 700;
                    margin: 0;
                    line-height: 1;
                }
                .grade-label {
                    font-size: 1.2rem;
                    margin-top: 8px;
                    opacity: 0.9;
                }
                .grade-score {
                    font-size: 0.9rem;
                    color: var(--text-muted);
                    margin-top: 4px;
                }
                .factor-bar {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin-bottom: 10px;
                }
                .factor-name {
                    flex: 0 0 180px;
                    font-size: 0.85rem;
                    color: var(--text-muted);
                }
                .factor-track {
                    flex: 1;
                    height: 8px;
                    background: var(--bg-darker);
                    border-radius: 4px;
                    overflow: hidden;
                    position: relative;
                }
                .factor-fill {
                    height: 100%;
                    background: linear-gradient(90deg, var(--clr-success), var(--clr-primary));
                    border-radius: 4px;
                    transition: width 0.3s ease;
                }
                .factor-score {
                    flex: 0 0 50px;
                    text-align: right;
                    font-size: 0.85rem;
                    font-weight: 600;
                    color: var(--text-primary);
                }
                .insight-item {
                    padding: 8px 12px;
                    margin-bottom: 8px;
                    background: var(--bg-darker);
                    border-left: 3px solid var(--clr-primary);
                    border-radius: 4px;
                    font-size: 0.85rem;
                    line-height: 1.4;
                }
                .insight-warning {
                    border-left-color: var(--clr-warning);
                    color: var(--clr-warning);
                }
                .insight-recommendation {
                    border-left-color: var(--clr-success);
                }
                .financial-highlight {
                    text-align: center;
                    padding: 12px;
                    background: linear-gradient(135deg, rgba(var(--clr-success-rgb), 0.1) 0%, transparent 100%);
                    border: 1px solid var(--clr-success);
                    border-radius: 6px;
                    margin-top: 12px;
                }
                .financial-big {
                    font-size: 2rem;
                    font-weight: 700;
                    color: var(--clr-success);
                    margin-bottom: 4px;
                }
                .financial-label {
                    font-size: 0.9rem;
                    color: var(--text-muted);
                }
                .settings-row {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin-bottom: 8px;
                }
                .settings-label {
                    flex: 1;
                    font-size: 0.85rem;
                    color: var(--text-muted);
                }
                .settings-input {
                    width: 100px;
                    padding: 4px 8px;
                    background: var(--bg-darker);
                    border: 1px solid var(--border-light);
                    border-radius: 4px;
                    color: var(--text-primary);
                    text-align: right;
                }
            </style>
            
            <!-- Optimization Score -->
            <div class="grade-display" style="border: 2px solid ${opt.grade.color};">
                <div class="grade-letter" style="color: ${opt.grade.color};">${opt.grade.letter}</div>
                <div class="grade-label" style="color: ${opt.grade.color};">${opt.grade.label}</div>
                <div class="grade-score">${opt.totalScore} / ${opt.maxScore} points</div>
            </div>
            
            <!-- Score Breakdown -->
            <div class="review-section">
                <div class="review-section-title">📈 Score Breakdown</div>
                ${opt.factors.map(f => `
                    <div class="factor-bar">
                        <div class="factor-name">${f.name}</div>
                        <div class="factor-track">
                            <div class="factor-fill" style="width: ${(f.score / f.max) * 100}%;"></div>
                        </div>
                        <div class="factor-score">${f.score}/${f.max}</div>
                    </div>
                `).join('')}
            </div>
            
            <!-- Components Summary -->
            <div class="review-section">
                <div class="review-section-title">🔌 System Components</div>
                <div class="review-row">
                    <span class="review-label">Solar Panels</span>
                    <span class="review-value">${comp.panelCount} panels (${comp.totalPanelWatts}W total)</span>
                </div>
                <div class="review-row">
                    <span class="review-label">Battery Storage</span>
                    <span class="review-value">${comp.batteryCount} batteries (${comp.totalBatteryKwh.toFixed(2)} kWh)</span>
                </div>
                <div class="review-row">
                    <span class="review-label">Charge Controllers</span>
                    <span class="review-value">${comp.controllerCount}</span>
                </div>
                <div class="review-row">
                    <span class="review-label">Inverters</span>
                    <span class="review-value">${comp.inverterCount}</span>
                </div>
                <div class="review-row">
                    <span class="review-label">AC Loads</span>
                    <span class="review-value">${comp.loadCount} (${comp.totalLoadWatts}W)</span>
                </div>
                <div class="review-row">
                    <span class="review-label">Production Appliances</span>
                    <span class="review-value">${comp.producerCount} (${comp.totalProducerWatts}W)</span>
                </div>
                <div class="review-row">
                    <span class="review-label">Total Consumption</span>
                    <span class="review-value" style="color: var(--clr-warning); font-weight: 600;">${comp.totalConsumption}W</span>
                </div>
            </div>
            
            <!-- Energy Analysis -->
            <div class="review-section">
                <div class="review-section-title">⚡ Energy Performance</div>
                <div class="review-row">
                    <span class="review-label">Daily Solar Production</span>
                    <span class="review-value">${energy.avgDailyProduction.toFixed(2)} kWh</span>
                </div>
                <div class="review-row">
                    <span class="review-label">Daily Consumption (est.)</span>
                    <span class="review-value">${energy.avgDailyConsumption.toFixed(2)} kWh</span>
                </div>
                <div class="review-row">
                    <span class="review-label">Energy Balance</span>
                    <span class="review-value" style="color: ${energy.energyBalance >= 0 ? 'var(--clr-success)' : 'var(--clr-danger)'};">
                        ${energy.energyBalance >= 0 ? '+' : ''}${energy.energyBalance.toFixed(2)} kWh/day
                    </span>
                </div>
                <div class="review-row">
                    <span class="review-label">Self-Sufficiency</span>
                    <span class="review-value" style="color: ${energy.selfSufficiency >= 100 ? 'var(--clr-success)' : 'var(--clr-warning)'};">
                        ${energy.selfSufficiency.toFixed(1)}%
                    </span>
                </div>
                <div class="review-row">
                    <span class="review-label">Battery Autonomy</span>
                    <span class="review-value">${energy.batteryAutonomy.toFixed(1)} hours</span>
                </div>
                <div class="review-row">
                    <span class="review-label">Peak Solar Output</span>
                    <span class="review-value">${energy.peakSolarOutput.toFixed(2)} kW</span>
                </div>
                <div class="review-row">
                    <span class="review-label">Annual Production (est.)</span>
                    <span class="review-value">${energy.avgYearlyProduction.toFixed(0)} kWh/year</span>
                </div>
            </div>
            
            <!-- Financial Analysis -->
            <div class="review-section">
                <div class="review-section-title">💰 Financial Analysis</div>
                <div class="review-row">
                    <span class="review-label">System Cost</span>
                    <span class="review-value">$${financial.systemCost.toFixed(2)}</span>
                </div>
                <div class="review-row">
                    <span class="review-label">Tax Incentive (${(SystemReview.settings.solarIncentive * 100)}%)</span>
                    <span class="review-value" style="color: var(--clr-success);">-$${financial.incentive.toFixed(2)}</span>
                </div>
                <div class="review-row">
                    <span class="review-label">Net Cost</span>
                    <span class="review-value" style="font-weight: 600;">$${financial.netCost.toFixed(2)}</span>
                </div>
                <div class="review-row">
                    <span class="review-label">Annual Savings</span>
                    <span class="review-value" style="color: var(--clr-success);">$${financial.annualSavings.toFixed(2)}/year</span>
                </div>
                
                <div class="financial-highlight">
                    <div class="financial-big">${financial.simplePayback > 0 ? financial.simplePayback.toFixed(1) : 'N/A'} years</div>
                    <div class="financial-label">Simple Payback Period</div>
                </div>
                
                <div class="review-row" style="margin-top: 12px;">
                    <span class="review-label">${SystemReview.settings.systemLifeYears}-Year Lifetime Value</span>
                    <span class="review-value" style="color: var(--clr-success);">$${financial.lifetimeValue.toFixed(2)}</span>
                </div>
                <div class="review-row">
                    <span class="review-label">Net Profit (${SystemReview.settings.systemLifeYears} years)</span>
                    <span class="review-value" style="color: ${financial.netProfit >= 0 ? 'var(--clr-success)' : 'var(--clr-danger)'}; font-weight: 600;">
                        $${financial.netProfit.toFixed(2)}
                    </span>
                </div>
                <div class="review-row">
                    <span class="review-label">Return on Investment</span>
                    <span class="review-value" style="color: ${financial.roi >= 0 ? 'var(--clr-success)' : 'var(--clr-danger)'};">
                        ${financial.roi.toFixed(1)}%
                    </span>
                </div>
            </div>
            
            <!-- Warnings -->
            ${analysis.warnings.length > 0 ? `
            <div class="review-section">
                <div class="review-section-title">⚠️ Warnings</div>
                ${analysis.warnings.map(w => `<div class="insight-item insight-warning">${w}</div>`).join('')}
            </div>
            ` : ''}
            
            <!-- Recommendations -->
            ${analysis.recommendations.length > 0 ? `
            <div class="review-section">
                <div class="review-section-title">💡 Recommendations</div>
                ${analysis.recommendations.map(r => `<div class="insight-item insight-recommendation">${r}</div>`).join('')}
            </div>
            ` : ''}
            
            <!-- Settings -->
            <div class="review-section">
                <div class="review-section-title">⚙️ Calculation Settings</div>
                <div class="settings-row">
                    <span class="settings-label">Electricity Rate ($/kWh)</span>
                    <input type="number" class="settings-input" id="review-rate" value="${SystemReview.settings.electricityRate}" step="0.01" min="0">
                </div>
                <div class="settings-row">
                    <span class="settings-label">Avg Daily Sun Hours</span>
                    <input type="number" class="settings-input" id="review-sun" value="${SystemReview.settings.avgDailySunHours}" step="0.5" min="0">
                </div>
                <div class="settings-row">
                    <span class="settings-label">Tax Credit (%)</span>
                    <input type="number" class="settings-input" id="review-incentive" value="${(SystemReview.settings.solarIncentive * 100).toFixed(0)}" step="1" min="0" max="100">
                </div>
                <button id="review-recalc" style="margin-top: 8px; padding: 8px 16px; background: var(--clr-primary); border: none; border-radius: 4px; color: white; cursor: pointer; width: 100%; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='var(--clr-primary-light)';" onmouseout="this.style.background='var(--clr-primary)';">
                    🔄 Recalculate with New Settings
                </button>
            </div>
        `;
        
        body.innerHTML = html;
        
        content.appendChild(header);
        content.appendChild(body);
        modal.appendChild(content);
        document.body.appendChild(modal);
        
        // Event handlers
        document.getElementById('review-close').onclick = () => {
            document.body.removeChild(modal);
        };
        
        modal.onclick = (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        };
        
        document.getElementById('review-recalc').onclick = () => {
            SystemReview.settings.electricityRate = parseFloat(document.getElementById('review-rate').value) || 0.12;
            SystemReview.settings.avgDailySunHours = parseFloat(document.getElementById('review-sun').value) || 5.5;
            SystemReview.settings.solarIncentive = (parseFloat(document.getElementById('review-incentive').value) || 26) / 100;
            
            document.body.removeChild(modal);
            showSystemReview(); // Reopen with new calculations
            showToast('Recalculated with new settings', 'info');
        };
    }
    
    // Add panel from linkage mode specs
    function addPanelFromLinkage(x, y, specs) {
        const id = `panel-${++itemIdCounter}`;
        
        // Scale: 120px per meter
        const scale = 120 / 1000;
        const panelHeightPx = Math.max(60, Math.min(150, (specs.height || 770) * scale));
        const panelWidthPx = Math.max(80, Math.min(200, (specs.width || 1150) * scale));
        const imp = specs.imp || (specs.wmp / specs.vmp) || (specs.isc * 0.9);
        
        const panel = {
            id, type: 'panel', x, y,
            width: panelWidthPx, height: panelHeightPx,
            specs: {
                name: specs.name,
                wmp: specs.wmp,
                vmp: specs.vmp,
                voc: specs.voc,
                isc: specs.isc,
                imp: parseFloat(imp.toFixed(2)),
                cost: specs.cost || 150
            },
            handles: {
                positive: { id: `${id}-pos`, polarity: 'positive', x: 0, y: panelHeightPx / 2, connectedTo: [] },
                negative: { id: `${id}-neg`, polarity: 'negative', x: panelWidthPx, y: panelHeightPx / 2, connectedTo: [] }
            }
        };
        
        allItems.push(panel);
        return panel;
    }
    
    /**
     * Import a panel array from linkage mode with grid positioning
     * @param {Array} linkagePanels - Array of panel data from linkage mode
     * @param {Object} panelSpecs - Panel specifications
     * @param {Object} options - Import options (padding, startX, startY, columns)
     * @returns {Array} Created panel objects
     */
    function importPanelArray(linkagePanels, panelSpecs, options = {}) {
        const {
            padding = 20,           // Gap between panels
            startX = 100,           // Starting X position
            startY = 100,           // Starting Y position
            columns = 0,            // 0 = auto-calculate based on count
            preserveLinkageLayout = false  // Try to preserve 3D layout
        } = options;
        
        const count = linkagePanels.length;
        if (count === 0) return [];
        
        // Calculate panel dimensions
        const scale = 120 / 1000; // 120px per meter
        const panelWidthPx = Math.max(80, Math.min(200, (panelSpecs.width || 1150) * scale));
        const panelHeightPx = Math.max(60, Math.min(150, (panelSpecs.height || 770) * scale));
        
        // Auto-calculate columns for roughly square layout
        const cols = columns > 0 ? columns : Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);
        
        const createdPanels = [];
        
        if (preserveLinkageLayout && linkagePanels[0]?.center) {
            // Use linkage 3D positions projected to 2D
            const scalePos = 140 / 39; // pixels per inch
            
            // Find bounding box
            let minX = Infinity, maxX = -Infinity;
            let minZ = Infinity, maxZ = -Infinity;
            
            linkagePanels.forEach(p => {
                if (p.center) {
                    minX = Math.min(minX, p.center.x);
                    maxX = Math.max(maxX, p.center.x);
                    minZ = Math.min(minZ, p.center.z);
                    maxZ = Math.max(maxZ, p.center.z);
                }
            });
            
            const centerX = (minX + maxX) / 2;
            const centerZ = (minZ + maxZ) / 2;
            
            linkagePanels.forEach((lp, i) => {
                if (!lp.center) return;
                
                // Project to 2D (top-down view using X and Z)
                const x = startX + (lp.center.x - centerX) * scalePos;
                const y = startY + (lp.center.z - centerZ) * scalePos;
                
                const panel = addPanelFromLinkage(x, y, {
                    ...panelSpecs,
                    width: (lp.width || panelSpecs.width / 25.4) * 25.4,
                    height: (lp.length || panelSpecs.height / 25.4) * 25.4
                });
                panel.linkageIndex = i;
                createdPanels.push(panel);
            });
        } else {
            // Grid layout
            for (let i = 0; i < count; i++) {
                const col = i % cols;
                const row = Math.floor(i / cols);
                
                const x = startX + col * (panelWidthPx + padding);
                const y = startY + row * (panelHeightPx + padding);
                
                const panel = addPanelFromLinkage(x, y, panelSpecs);
                panel.linkageIndex = i;
                createdPanels.push(panel);
            }
        }
        
        return createdPanels;
    }
    
    /**
     * Add a controller from linkage mode, sized for the panel array
     * @param {number} totalWatts - Total array wattage
     * @param {Object} options - Position options
     * @returns {Object} Created controller
     */
    function addControllerFromLinkage(totalWatts, options = {}) {
        const { x = 400, y = 300 } = options;
        
        // Find a suitable controller preset based on wattage
        let controllerPreset = CONTROLLER_PRESETS[0]; // Default
        
        for (const preset of CONTROLLER_PRESETS) {
            if (preset.type === 'hybrid_inverter' || preset.type === 'all_in_one') {
                if (preset.maxPVInput >= totalWatts) {
                    controllerPreset = preset;
                    break;
                }
            }
        }
        
        // If no suitable preset found, use the largest available
        if (controllerPreset.maxPVInput < totalWatts) {
            const hybrid = CONTROLLER_PRESETS.filter(p => 
                p.type === 'hybrid_inverter' || p.type === 'all_in_one'
            ).sort((a, b) => b.maxPVInput - a.maxPVInput);
            if (hybrid.length > 0) {
                controllerPreset = hybrid[0];
            }
        }
        
        const controller = createController(x, y, controllerPreset);
        allItems.push(controller);
        return controller;
    }
    
    /**
     * Add a battery from linkage mode
     * @param {number} recommendedKwh - Recommended storage capacity
     * @param {Object} options - Position options
     * @returns {Object} Created battery
     */
    function addBatteryFromLinkage(recommendedKwh, options = {}) {
        const { x = 400, y = 450 } = options;
        
        // Find a suitable battery preset
        let batteryPreset = BATTERY_PRESETS[0];
        
        for (const preset of BATTERY_PRESETS) {
            const kWh = (preset.voltage * preset.ah) / 1000;
            if (kWh >= recommendedKwh * 0.8) { // Allow 20% smaller
                batteryPreset = preset;
                break;
            }
        }
        
        const battery = createBattery(x, y, batteryPreset);
        allItems.push(battery);
        return battery;
    }
    
    /**
     * Import complete system from linkage mode
     * Creates panels in grid, adds appropriate controller and battery
     * @param {Object} linkageData - Data from linkage mode
     * @returns {Object} Created items { panels, controller, battery }
     */
    function importSystemFromLinkage(linkageData) {
        const { panels: linkagePanels, panelSpecs, gridRows, gridCols, preserveLayout } = linkageData;
        
        if (!linkagePanels || linkagePanels.length === 0) {
            console.warn('No panels to import from linkage');
            return null;
        }
        
        // Clear existing items if importing fresh
        // allItems.length = 0; // Uncomment to clear existing
        
        // Calculate total array specs
        const totalWatts = linkagePanels.length * (panelSpecs.wmp || 400);
        const recommendedKwh = totalWatts * 4 / 1000; // 4 hours of storage
        
        // Calculate grid layout
        const columns = gridCols || Math.ceil(Math.sqrt(linkagePanels.length));
        
        // Scale panel dimensions
        const scale = 120 / 1000;
        const panelWidthPx = Math.max(80, Math.min(200, (panelSpecs.width || 1150) * scale));
        const panelHeightPx = Math.max(60, Math.min(150, (panelSpecs.height || 770) * scale));
        
        // Calculate positions
        const padding = 20;
        const arrayWidth = columns * (panelWidthPx + padding);
        const startX = 100;
        const startY = 100;
        
        // Create panels
        const panels = importPanelArray(linkagePanels, panelSpecs, {
            padding,
            startX,
            startY,
            columns,
            preserveLinkageLayout: preserveLayout
        });
        
        // Position controller to the right of panels
        const controllerX = startX + arrayWidth + 80;
        const controllerY = startY + 50;
        const controller = addControllerFromLinkage(totalWatts, { x: controllerX, y: controllerY });
        
        // Position battery below controller
        const batteryX = controllerX;
        const batteryY = controllerY + 200;
        const battery = addBatteryFromLinkage(recommendedKwh, { x: batteryX, y: batteryY });
        
        render();
        updateStats();
        
        return { panels, controller, battery, totalWatts, recommendedKwh };
    }
    
    /**
     * Rearrange all panels into a neat grid
     * @param {Object} options - Grid options
     */
    function arrangePanelsInGrid(options = {}) {
        const {
            padding = 20,
            startX = 100,
            startY = 100,
            columns = 0
        } = options;
        
        const panels = allItems.filter(i => i.type === 'panel');
        if (panels.length === 0) return;
        
        // Get average panel dimensions
        let avgWidth = 0, avgHeight = 0;
        panels.forEach(p => {
            avgWidth += p.width;
            avgHeight += p.height;
        });
        avgWidth /= panels.length;
        avgHeight /= panels.length;
        
        // Calculate columns
        const cols = columns > 0 ? columns : Math.ceil(Math.sqrt(panels.length));
        
        // Reposition each panel
        panels.forEach((panel, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            
            panel.x = startX + col * (avgWidth + padding);
            panel.y = startY + row * (avgHeight + padding);
        });
        
        render();
        showToast(`Arranged ${panels.length} panels in ${cols} columns`, 'success');
    }
    
    // ============================================
    // FAILURE EFFECT ANIMATIONS (Phase 6)
    // ============================================
    
    /**
     * FailureEffects - Visual effects for component failures
     * Provides spark, smoke, arc flash, and explosion effects
     */
    const FailureEffects = {
        /**
         * Create spark effect at a point
         * @param {number} x - X coordinate
         * @param {number} y - Y coordinate
         * @param {number} count - Number of sparks (default 5)
         */
        createSparks: function(x, y, count = 5) {
            if (!zoomGroup) return;
            
            for (let i = 0; i < count; i++) {
                const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
                const distance = 15 + Math.random() * 25;
                
                const spark = zoomGroup.append("circle")
                    .attr("class", "spark-effect")
                    .attr("cx", x)
                    .attr("cy", y)
                    .attr("r", 2 + Math.random() * 3)
                    .attr("fill", Math.random() > 0.5 ? "#ffff00" : "#ffffff")
                    .style("pointer-events", "none");
                
                spark.transition()
                    .duration(150 + Math.random() * 100)
                    .attr("cx", x + Math.cos(angle) * distance)
                    .attr("cy", y + Math.sin(angle) * distance)
                    .attr("r", 0)
                    .style("opacity", 0)
                    .remove();
            }
        },
        
        /**
         * Create smoke effect rising from a point
         * @param {number} x - X coordinate
         * @param {number} y - Y coordinate
         * @param {number} count - Number of smoke particles (default 8)
         */
        createSmoke: function(x, y, count = 8) {
            if (!zoomGroup) return;
            
            for (let i = 0; i < count; i++) {
                setTimeout(() => {
                    const smoke = zoomGroup.append("circle")
                        .attr("class", "smoke-particle")
                        .attr("cx", x + (Math.random() - 0.5) * 20)
                        .attr("cy", y)
                        .attr("r", 3 + Math.random() * 4)
                        .attr("fill", "#555")
                        .style("opacity", 0.6)
                        .style("pointer-events", "none");
                    
                    smoke.transition()
                        .duration(1500 + Math.random() * 1000)
                        .attr("cy", y - 40 - Math.random() * 30)
                        .attr("cx", x + (Math.random() - 0.5) * 40)
                        .attr("r", 8 + Math.random() * 8)
                        .style("opacity", 0)
                        .remove();
                }, i * 100);
            }
        },
        
        /**
         * Create arc flash effect (bright flash + sparks)
         * @param {number} x - X coordinate
         * @param {number} y - Y coordinate
         */
        createArcFlash: function(x, y) {
            if (!zoomGroup) return;
            
            // Screen flash overlay
            const flash = d3.select("svg").append("rect")
                .attr("class", "arc-flash")
                .attr("width", "100%")
                .attr("height", "100%")
                .attr("fill", "#ffffff")
                .style("opacity", 0.8)
                .style("pointer-events", "none");
            
            flash.transition()
                .duration(150)
                .style("opacity", 0)
                .remove();
            
            // Local arc glow
            const arc = zoomGroup.append("circle")
                .attr("cx", x)
                .attr("cy", y)
                .attr("r", 5)
                .attr("fill", "#ffffff")
                .style("filter", "blur(5px)")
                .style("pointer-events", "none");
            
            arc.transition()
                .duration(100)
                .attr("r", 40)
                .style("opacity", 0)
                .remove();
            
            // Multiple sparks
            this.createSparks(x, y, 12);
        },
        
        /**
         * Create explosion effect (flash + shake + sparks + smoke)
         * @param {number} x - X coordinate
         * @param {number} y - Y coordinate
         * @param {string} itemId - Optional item ID to apply shake class
         */
        createExplosion: function(x, y, itemId = null) {
            if (!zoomGroup) return;
            
            // PHASE 1: Initial flash (immediate)
            const flash = zoomGroup.append("circle")
                .attr("cx", x)
                .attr("cy", y)
                .attr("r", 10)
                .attr("fill", "#ffaa00")
                .style("filter", "blur(8px)")
                .style("pointer-events", "none");
            
            flash.transition()
                .duration(100)
                .attr("r", 50)
                .attr("fill", "#ffffff")
                .style("opacity", 0.9)
                .transition()
                .duration(200)
                .attr("r", 80)
                .style("opacity", 0)
                .remove();
            
            // PHASE 2: Sparks (50ms delay)
            setTimeout(() => {
                this.createSparks(x, y, 15);
                
                // Secondary sparks after a short delay
                setTimeout(() => this.createSparks(x - 10, y + 5, 8), 100);
                setTimeout(() => this.createSparks(x + 10, y - 5, 8), 150);
            }, 50);
            
            // PHASE 3: Smoke rising (300ms delay)
            setTimeout(() => {
                this.createSmoke(x, y, 12);
                
                // More smoke with staggered timing
                setTimeout(() => this.createSmoke(x - 10, y + 5, 6), 200);
                setTimeout(() => this.createSmoke(x + 10, y + 5, 6), 400);
            }, 300);
            
            // Apply shake class to item if provided
            if (itemId && itemsGroup) {
                const itemGroup = itemsGroup.select(`[data-id="${itemId}"]`);
                if (!itemGroup.empty()) {
                    itemGroup.classed('failure-exploded', true);
                    
                    // Remove class after animation
                    setTimeout(() => {
                        itemGroup.classed('failure-exploded', false);
                    }, 600);
                }
            }
        },
        
        /**
         * Create wire burn effect
         * @param {string} connectionId - The connection ID
         * @param {number} x - X coordinate (midpoint of wire)
         * @param {number} y - Y coordinate (midpoint of wire)
         */
        createWireBurn: function(connectionId, x, y) {
            // Add burned class to wire
            if (wiresGroup) {
                const wire = wiresGroup.select(`[data-connection-id="${connectionId}"]`);
                if (!wire.empty()) {
                    wire.classed('failure-burned', true);
                }
            }
            
            // Create sparks at burn point
            this.createSparks(x, y, 8);
            
            // Small smoke effect
            setTimeout(() => {
                this.createSmoke(x, y, 5);
            }, 100);
        },
        
        /**
         * Set wire heating visual state
         * @param {string} connectionId - The connection ID
         * @param {string} level - 'normal', 'heating', or 'critical'
         */
        setWireHeat: function(connectionId, level) {
            if (!wiresGroup) return;
            
            const wire = wiresGroup.select(`[data-connection-id="${connectionId}"]`);
            if (wire.empty()) return;
            
            wire.classed('wire-heating', level === 'heating');
            wire.classed('wire-critical', level === 'critical');
            wire.classed('failure-burned', false); // Clear burn state when setting heat
        },
        
        /**
         * Trigger breaker trip effect
         * @param {Object} item - The breaker/panel item
         * @param {number} circuitIndex - Optional circuit index for panels
         */
        triggerBreakerTrip: function(item, circuitIndex = null) {
            if (!item || !itemsGroup) return;
            
            const cx = item.x + item.width / 2;
            const cy = item.y + item.height / 2;
            
            // Small spark effect at breaker
            this.createSparks(cx, cy, 5);
            
            // Add visual failure class
            const itemGroup = itemsGroup.select(`[data-id="${item.id}"]`);
            if (!itemGroup.empty()) {
                itemGroup.classed('failure-breaker-tripped', true);
            }
        },
        
        /**
         * Trigger overload warning effect
         * @param {Object} item - The overloaded item
         */
        triggerOverloadWarning: function(item) {
            if (!item || !itemsGroup) return;
            
            const cx = item.x + item.width / 2;
            const cy = item.y + item.height / 2;
            
            // Add overload pulse class
            const itemGroup = itemsGroup.select(`[data-id="${item.id}"]`);
            if (!itemGroup.empty()) {
                itemGroup.classed('failure-overloaded', true);
            }
            
            // Small smoke wisps for severe overload
            this.createSmoke(cx, cy, 3);
        },
        
        /**
         * Clear all failure states from an item
         * @param {string} itemId - The item ID
         */
        clearFailureState: function(itemId) {
            if (!itemsGroup) return;
            
            const itemGroup = itemsGroup.select(`[data-id="${itemId}"]`);
            if (!itemGroup.empty()) {
                itemGroup
                    .classed('failure-exploded', false)
                    .classed('failure-breaker-tripped', false)
                    .classed('failure-overloaded', false);
            }
        },
        
        /**
         * Clear wire failure states
         * @param {string} connectionId - The connection ID
         */
        clearWireFailure: function(connectionId) {
            if (!wiresGroup) return;
            
            const wire = wiresGroup.select(`[data-connection-id="${connectionId}"]`);
            if (!wire.empty()) {
                wire
                    .classed('wire-heating', false)
                    .classed('wire-critical', false)
                    .classed('failure-burned', false);
            }
        }
    };
    
    // Expose FailureEffects globally for external access
    window.FailureEffects = FailureEffects;
    
    // ============================================
    // INCIDENT REPORT SYSTEM
    // ============================================
    
    function showIncidentReport(config) {
        // Don't show if hints are disabled
        if (!areHintsEnabled()) return;
        
        const overlay = document.getElementById('incidentReportOverlay');
        const modal = document.getElementById('incidentReportModal');
        
        if (!overlay || !modal) return;
        
        // Set modal class based on type
        modal.className = 'incident-report';
        if (config.type === 'warning') {
            modal.classList.add('warning-level');
        } else if (config.type === 'info') {
            modal.classList.add('info-level');
        }
        
        // Populate modal content
        document.getElementById('incidentIcon').textContent = config.icon || '💥';
        document.getElementById('incidentType').textContent = config.category || 'SYSTEM EVENT';
        document.getElementById('incidentTitle').textContent = config.title || '';
        document.getElementById('incidentDescription').textContent = config.description || '';
        
        // Solutions
        const solutionsDiv = document.getElementById('incidentSolutions');
        if (config.solutions && config.solutions.length > 0) {
            solutionsDiv.innerHTML = `
                <strong>How to Fix:</strong>
                <ul>
                    ${config.solutions.map(s => `<li>${s}</li>`).join('')}
                </ul>
            `;
            solutionsDiv.style.display = 'block';
        } else {
            solutionsDiv.style.display = 'none';
        }
        
        // Real-world impact
        const realworldDiv = document.getElementById('incidentRealworld');
        const realworldText = document.getElementById('incidentRealworldText');
        if (config.realworld) {
            realworldText.textContent = config.realworld;
            realworldDiv.style.display = 'block';
        } else {
            realworldDiv.style.display = 'none';
        }
        
        // Show overlay
        overlay.classList.add('visible');
    }
    
    function hideIncidentReport() {
        const overlay = document.getElementById('incidentReportOverlay');
        if (overlay) {
            overlay.classList.remove('visible');
        }
    }
    
    function areHintsEnabled() {
        const toggle = document.getElementById('showHintsToggle');
        return !toggle || toggle.checked !== false;
    }
    
    // ============================================
    // HINT POPUP SYSTEM
    // ============================================
    
    function showHint(title, text) {
        if (!areHintsEnabled()) return;
        
        const hintPopup = document.getElementById('hintPopup');
        if (!hintPopup) return;
        
        // Restore standard hint structure
        hintPopup.innerHTML = `
            <h3 id="hintTitle"></h3>
            <p id="hintText"></p>
            <div class="hint-buttons">
                <button id="hintDismiss">Got It</button>
            </div>
        `;
        
        document.getElementById('hintTitle').textContent = title;
        document.getElementById('hintText').textContent = text;
        hintPopup.classList.remove('hidden');
        
        // Wire up dismiss button
        document.getElementById('hintDismiss').onclick = hideHint;
    }
    
    function hideHint() {
        const hintPopup = document.getElementById('hintPopup');
        if (hintPopup) {
            hintPopup.classList.add('hidden');
        }
    }
    
    // ============================================
    // TOOLTIP SYSTEM
    // ============================================
    
    let activeTooltip = null;
    let tooltipTimeout = null;
    
    function setupTooltips() {
        // Add event listeners to all elements with data-tooltip
        document.querySelectorAll('[data-tooltip]').forEach(el => {
            el.addEventListener('mouseenter', showTooltip);
            el.addEventListener('mouseleave', hideTooltip);
        });
    }
    
    function showTooltip(e) {
        const target = e.currentTarget;
        const text = target.dataset.tooltip;
        if (!text) return;
        
        clearTimeout(tooltipTimeout);
        
        // Delay showing tooltip
        tooltipTimeout = setTimeout(() => {
            const tooltip = document.getElementById('globalTooltip');
            if (!tooltip) return;
            
            tooltip.innerHTML = text;
            tooltip.style.display = 'block';
            
            // Position tooltip
            positionTooltip(tooltip, target);
            
            // Show with fade-in
            setTimeout(() => {
                tooltip.classList.add('visible');
            }, 10);
            
            activeTooltip = tooltip;
        }, 400);
    }
    
    function hideTooltip() {
        clearTimeout(tooltipTimeout);
        
        const tooltip = document.getElementById('globalTooltip');
        if (tooltip) {
            tooltip.classList.remove('visible');
            setTimeout(() => {
                tooltip.style.display = 'none';
            }, 200);
        }
        activeTooltip = null;
    }
    
    function positionTooltip(tooltip, target) {
        const targetRect = target.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        
        let left = targetRect.right + 12;
        let top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);
        
        // Check if tooltip goes off screen right
        if (left + tooltipRect.width > window.innerWidth - 20) {
            left = targetRect.left - tooltipRect.width - 12;
            tooltip.setAttribute('data-arrow', 'right');
        } else {
            tooltip.setAttribute('data-arrow', 'left');
        }
        
        // Adjust vertical position if needed
        if (top + tooltipRect.height > window.innerHeight - 10) {
            top = window.innerHeight - tooltipRect.height - 10;
        }
        if (top < 10) {
            top = 10;
        }
        
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }
    
    // Panel array management functions
    function snapAllPanelsToGrid(forceCols = 0) {
        const panels = allItems.filter(i => i.type === 'panel');
        if (panels.length === 0) {
            showToast('No panels to snap to grid', 'info');
            return;
        }
        
        // Calculate grid dimensions based on panel sizes
        // Use average panel dimensions for consistent spacing
        let avgWidth = 0;
        let avgHeight = 0;
        panels.forEach(p => {
            avgWidth += p.width || 140;
            avgHeight += p.height || 92;
        });
        avgWidth = avgWidth / panels.length;
        avgHeight = avgHeight / panels.length;
        
        // Calculate grid size - use forced columns or auto-calculate
        const totalPanels = panels.length;
        const cols = forceCols > 0 ? Math.min(forceCols, totalPanels) : Math.ceil(Math.sqrt(totalPanels));
        const rows = Math.ceil(totalPanels / cols);
        
        // Calculate total grid dimensions with padding
        const gridWidth = cols * avgWidth + (cols - 1) * panelGridPadding;
        const gridHeight = rows * avgHeight + (rows - 1) * panelGridPadding;
        
        // Center the grid on canvas
        const startX = -gridWidth / 2;
        const startY = -gridHeight / 2 - 150; // Place above center
        
        // Snap panels to grid positions, ensuring no overlaps
        panels.forEach((panel, index) => {
            const col = index % cols;
            const row = Math.floor(index / cols);
            
            const newX = startX + col * (avgWidth + panelGridPadding);
            const newY = startY + row * (avgHeight + panelGridPadding);
            
            // Update panel position
            panel.x = newX;
            panel.y = newY;
        });
        
        // Check for any remaining overlaps and adjust if needed
        let overlapCount = 0;
        for (let i = 0; i < panels.length; i++) {
            for (let j = i + 1; j < panels.length; j++) {
                const p1 = panels[i];
                const p2 = panels[j];
                const dx = Math.abs(p1.x - p2.x);
                const dy = Math.abs(p1.y - p2.y);
                const minDistX = (p1.width + p2.width) / 2 + panelGridPadding;
                const minDistY = (p1.height + p2.height) / 2 + panelGridPadding;
                
                if (dx < minDistX && dy < minDistY) {
                    // Overlap detected - shift panel slightly
                    overlapCount++;
                    p2.x += minDistX - dx + 5;
                    p2.y += minDistY - dy + 5;
                }
            }
        }
        
        render();
        updateStats();
        if (overlapCount > 0) {
            showToast(`Snapped ${panels.length} panels to grid (resolved ${overlapCount} overlaps)`, 'success');
        } else {
            showToast(`Snapped ${panels.length} panels to ${cols}×${rows} grid`, 'success');
        }
    }
    
    function selectAllPanels() {
        const panels = allItems.filter(i => i.type === 'panel');
        if (panels.length === 0) {
            showToast('No panels to select', 'info');
            return;
        }
        
        selectedPanels = [...panels];
        
        // Visual feedback: highlight selected panels
        render();
        
        // Update properties panel to show array selection
        updatePropertiesPanelForArray();
        
        showToast(`Selected ${panels.length} panels`, 'success');
    }
    
    /**
     * Select all panels connected to the same string/controller as the currently selected panel
     * Traces through combiners and wires to find all connected panels
     */
    function selectConnectedPanels(startPanel = null) {
        const start = startPanel || selectedItem;
        if (!start || start.type !== 'panel') {
            showToast('Select a panel first', 'info');
            return;
        }
        
        const connectedPanels = new Set([start.id]);
        const visited = new Set();
        const queue = [start];
        
        // Trace through connections to find all connected panels
        while (queue.length > 0) {
            const item = queue.shift();
            if (visited.has(item.id)) continue;
            visited.add(item.id);
            
            // Check all handles for connections
            if (item.handles) {
                Object.values(item.handles).forEach(handle => {
                    if (handle.connectedTo) {
                        handle.connectedTo.forEach(conn => {
                            const connObj = connections.find(c => c.id === conn.connectionId);
                            if (!connObj) return;
                            
                            // Find the other end of this connection
                            const otherItemId = connObj.sourceItemId === item.id 
                                ? connObj.targetItemId 
                                : connObj.sourceItemId;
                            const otherItem = allItems.find(i => i.id === otherItemId);
                            
                            if (otherItem && !visited.has(otherItem.id)) {
                                if (otherItem.type === 'panel') {
                                    connectedPanels.add(otherItem.id);
                                }
                                // Continue tracing through combiners, DC breakers, etc.
                                if (['combiner', 'solarcombiner', 'dcbreaker'].includes(otherItem.type)) {
                                    queue.push(otherItem);
                                }
                            }
                        });
                    }
                });
            }
        }
        
        // Select all found panels
        selectedPanels = allItems.filter(i => connectedPanels.has(i.id));
        
        if (selectedPanels.length <= 1) {
            showToast('No connected panels found - panel may not be wired', 'info');
        } else {
            render();
            updatePropertiesPanelForArray();
            showToast(`Selected ${selectedPanels.length} connected panels`, 'success');
        }
    }
    
    // Grid configuration state
    let panelGridColumns = 0; // 0 = auto
    
    function updatePropertiesPanelForArray() {
        if (selectedPanels.length === 0) return;
        
        const panel = document.getElementById('solar-properties-panel');
        if (!panel) return;
        
        panel.classList.add('visible');
        document.getElementById('prop-icon').textContent = '☀️';
        document.getElementById('prop-name').textContent = `Panel Array (${selectedPanels.length} panels)`;
        
        // Calculate suggested columns
        const autoColumns = Math.ceil(Math.sqrt(selectedPanels.length));
        const currentColumns = panelGridColumns > 0 ? panelGridColumns : autoColumns;
        
        const totalWatts = selectedPanels.reduce((sum, p) => sum + (p.specs.wmp || 0), 0);
        const avgVmp = selectedPanels.reduce((sum, p) => sum + (p.specs.vmp || 0), 0) / selectedPanels.length;
        
        const html = `
            <div class="prop-section-title">Array Tools</div>
            <div class="prop-row">
                <span class="prop-label">Columns</span>
                <input type="number" class="prop-input" id="prop-array-cols" value="${currentColumns}" min="1" max="${selectedPanels.length}" style="width:60px;">
                <span style="color:var(--text-muted); font-size:11px; margin-left:4px;">(auto: ${autoColumns})</span>
            </div>
            <div class="prop-row">
                <span class="prop-label">Padding</span>
                <input type="range" class="prop-input" id="prop-array-padding" value="${panelGridPadding}" min="0" max="100" step="5" style="width:80px;">
                <span id="prop-array-padding-val">${panelGridPadding}px</span>
            </div>
            <div class="prop-row" style="display:flex; gap:4px; margin-top:4px;">
                <button class="prop-btn" id="prop-array-snap-btn" style="flex:1; padding:6px;">⊞ Snap to Grid</button>
                <button class="prop-btn" id="prop-array-arrange-btn" style="flex:1; padding:6px;">↔ Auto Arrange</button>
            </div>
            <div class="prop-row" style="display:flex; gap:4px; margin-top:4px;">
                <button class="prop-btn" id="prop-array-move-btn" style="flex:1; padding:6px;">⇄ Move Array</button>
                <button class="prop-btn" id="prop-array-select-all-btn" style="flex:1; padding:6px;">☑ Select All</button>
            </div>
            <div class="prop-row">
                <button class="prop-btn" id="prop-array-deselect-btn" style="width:100%; padding:6px; margin-top:4px; background:rgba(200,50,50,0.2);">✕ Deselect All</button>
            </div>
            <div class="prop-section-title" style="margin-top:10px;">Array Stats</div>
            <div class="prop-row">
                <span class="prop-label">Total Power</span>
                <span class="prop-value">${totalWatts} W (${(totalWatts/1000).toFixed(2)} kW)</span>
            </div>
            <div class="prop-row">
                <span class="prop-label">Avg Vmp</span>
                <span class="prop-value">${avgVmp.toFixed(1)} V</span>
            </div>
            <div class="prop-row">
                <span class="prop-label">Grid Layout</span>
                <span class="prop-value">${currentColumns} × ${Math.ceil(selectedPanels.length / currentColumns)} panels</span>
            </div>
        `;
        
        document.getElementById('prop-content').innerHTML = html;
        
        // Bind handlers
        const colsInput = document.getElementById('prop-array-cols');
        const paddingSlider = document.getElementById('prop-array-padding');
        const paddingVal = document.getElementById('prop-array-padding-val');
        const snapBtn = document.getElementById('prop-array-snap-btn');
        const arrangeBtn = document.getElementById('prop-array-arrange-btn');
        const moveBtn = document.getElementById('prop-array-move-btn');
        const selectAllBtn = document.getElementById('prop-array-select-all-btn');
        const deselectBtn = document.getElementById('prop-array-deselect-btn');
        
        if (colsInput) {
            colsInput.onchange = (e) => {
                panelGridColumns = parseInt(e.target.value) || 0;
            };
        }
        
        if (paddingSlider) {
            paddingSlider.oninput = (e) => {
                panelGridPadding = parseInt(e.target.value) || 10;
                if (paddingVal) paddingVal.textContent = `${panelGridPadding}px`;
            };
        }
        
        if (snapBtn) {
            snapBtn.onclick = () => {
                snapSelectedPanelsToGrid(panelGridColumns);
            };
        }
        
        if (arrangeBtn) {
            arrangeBtn.onclick = () => {
                arrangePanelsInGrid({
                    padding: panelGridPadding,
                    columns: panelGridColumns
                });
            };
        }
        
        if (moveBtn) {
            moveBtn.onclick = () => {
                enableArrayMoveMode();
            };
        }
        
        if (selectAllBtn) {
            selectAllBtn.onclick = () => {
                selectAllPanels();
            };
        }
        
        if (deselectBtn) {
            deselectBtn.onclick = () => {
                selectedPanels = [];
                selectedItem = null;
                render();
                updatePropertiesPanel();
            };
        }
    }
    
    function snapSelectedPanelsToGrid(forceCols = 0) {
        if (selectedPanels.length === 0) {
            snapAllPanelsToGrid(forceCols);
            return;
        }
        
        // Calculate grid for selected panels only
        let avgWidth = 0;
        let avgHeight = 0;
        selectedPanels.forEach(p => {
            avgWidth += p.width || 140;
            avgHeight += p.height || 92;
        });
        avgWidth = avgWidth / selectedPanels.length;
        avgHeight = avgHeight / selectedPanels.length;
        
        const totalPanels = selectedPanels.length;
        // Use forced columns or auto-calculate
        const cols = forceCols > 0 ? Math.min(forceCols, totalPanels) : Math.ceil(Math.sqrt(totalPanels));
        const rows = Math.ceil(totalPanels / cols);
        
        const gridWidth = cols * avgWidth + (cols - 1) * panelGridPadding;
        const gridHeight = rows * avgHeight + (rows - 1) * panelGridPadding;
        
        // Center on average position of selected panels
        let avgX = 0, avgY = 0;
        selectedPanels.forEach(p => {
            avgX += p.x;
            avgY += p.y;
        });
        avgX = avgX / selectedPanels.length;
        avgY = avgY / selectedPanels.length;
        
        const startX = avgX - gridWidth / 2;
        const startY = avgY - gridHeight / 2;
        
        selectedPanels.forEach((panel, index) => {
            const col = index % cols;
            const row = Math.floor(index / cols);
            
            panel.x = startX + col * (avgWidth + panelGridPadding);
            panel.y = startY + row * (avgHeight + panelGridPadding);
        });
        
        render();
        showToast(`Arranged ${totalPanels} panels in ${cols}×${rows} grid`, 'success');
        updateStats();
        showToast(`Snapped ${selectedPanels.length} panels to grid`, 'success');
    }
    
    let arrayMoveMode = false;
    let arrayMoveStartPos = { x: 0, y: 0 };
    let arrayMoveInitialPositions = [];
    
    function enableArrayMoveMode() {
        if (selectedPanels.length === 0) {
            showToast('No panels selected', 'info');
            return;
        }
        
        arrayMoveMode = true;
        // Store initial positions
        arrayMoveInitialPositions = selectedPanels.map(p => ({ id: p.id, x: p.x, y: p.y }));
        showToast('Drag any selected panel to move the entire array', 'info');
    }
    
    // Override item drag behavior when in array move mode
    function itemDragStartArray(event, d) {
        if (!arrayMoveMode || !selectedPanels.some(p => p.id === d.id)) {
            return false; // Use normal drag
        }
        
        event.sourceEvent.stopPropagation();
        isDragging = true;
        dragStartPos = { x: event.x, y: event.y };
        
        // Store initial positions of all selected panels
        arrayMoveInitialPositions = selectedPanels.map(p => ({ id: p.id, x: p.x, y: p.y }));
        
        return true; // Use array drag
    }
    
    function itemDragMoveArray(event, d) {
        if (!arrayMoveMode || !isDragging) return;
        
        const deltaX = event.x - dragStartPos.x;
        const deltaY = event.y - dragStartPos.y;
        
        // Move all selected panels by the same delta
        selectedPanels.forEach((panel, index) => {
            const initial = arrayMoveInitialPositions[index];
            if (initial && initial.id === panel.id) {
                panel.x = initial.x + deltaX;
                panel.y = initial.y + deltaY;
            }
        });
        
        render();
    }
    
    function itemDragEndArray(event, d) {
        if (!arrayMoveMode) return;
        
        isDragging = false;
        arrayMoveMode = false;
        render();
        updateStats();
        showToast(`Moved ${selectedPanels.length} panels`, 'success');
    }
    
    // Incident templates for common failures
    const INCIDENT_TEMPLATES = {
        breakerTripped: (rating, amps, circuitName) => ({
            type: 'critical',
            icon: '⚡',
            category: 'BREAKER TRIPPED',
            title: `Circuit Overload: ${amps.toFixed(1)}A on ${rating}A Breaker`,
            description: `The ${circuitName || 'circuit'} breaker has tripped due to overload. The circuit was drawing ${amps.toFixed(1)}A, which exceeds the ${rating}A rating.`,
            solutions: [
                `Reduce the total load on the circuit to below ${rating}A`,
                'Distribute loads across multiple circuits',
                `Upgrade to a higher-rated breaker if wiring supports it`,
                'Check for short circuits or damaged equipment'
            ],
            realworld: `Circuit breakers trip to protect wiring from overheating and potential fire. When a breaker trips, all loads on that circuit lose power immediately. You must manually reset the breaker after reducing the load. Repeated tripping can damage the breaker mechanism.`
        }),
        
        wireOverheated: (gauge, amps, rating) => ({
            type: 'critical',
            icon: '🔥',
            category: 'WIRE OVERHEATING',
            title: `Wire Capacity Exceeded: ${amps.toFixed(1)}A on ${gauge} AWG`,
            description: `The wire is carrying ${amps.toFixed(1)}A, which exceeds the ${rating}A rating for ${gauge} AWG wire. This creates a serious fire hazard.`,
            solutions: [
                `Reduce current to below ${rating}A`,
                'Upgrade to larger gauge wire',
                'Add circuit protection (breaker)',
                'Split load across multiple circuits'
            ],
            realworld: `Overloaded wires heat up due to resistance. The insulation can melt, creating exposed conductors that can arc and ignite nearby materials. This is one of the leading causes of electrical fires in buildings. Wire gauge must always exceed the maximum expected current.`
        }),
        
        controllerOvervoltage: (controller, actualV, maxV) => ({
            type: 'critical',
            icon: '💥',
            category: 'OVERVOLTAGE FAILURE',
            title: `Controller Destroyed: ${actualV.toFixed(1)}V on ${maxV}V Max Input`,
            description: `The charge controller received ${actualV.toFixed(1)}V, exceeding its ${maxV}V maximum rating. Internal components have been damaged.`,
            solutions: [
                `Reduce solar array voltage to below ${maxV}V`,
                'Reconfigure panels (fewer in series)',
                'Install voltage limiter/regulator',
                'Replace with higher-voltage controller'
            ],
            realworld: `Overvoltage instantly destroys semiconductor components in the controller. The protection MOSFETs short circuit, causing sparks, smoke, and potential fire. Cold temperature and open-circuit conditions can increase panel voltage by 20-25% above rated Vmp. Always check Voc in worst-case conditions.`
        })
    };
    
    // ============================================
    // RIGHT SIDEBAR TAB MANAGEMENT
    // ============================================
    
    let currentRightPanelTab = 'library'; // 'library' or 'inspector'
    
    function switchRightPanelTab(tabName, options = {}) {
        if (currentRightPanelTab === tabName && !options.force) return;
        
        currentRightPanelTab = tabName;
        
        // Update tab buttons
        document.querySelectorAll('#solar-right-sidebar .panel-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        
        const libraryContent = document.getElementById('componentLibraryTab');
        const inspectorContent = document.getElementById('inspectorTabContent');
        
        if (tabName === 'library') {
            document.getElementById('libraryTab').classList.add('active');
            if (libraryContent) libraryContent.classList.add('active');
            if (inspectorContent) inspectorContent.classList.remove('active');
            
            // Focus search input when switching to library
            if (options.focusSearch) {
                setTimeout(() => {
                    const searchInput = document.getElementById('librarySearchInput');
                    if (searchInput) searchInput.focus();
                }, 100);
            }
        } else {
            document.getElementById('inspectorTab').classList.add('active');
            if (inspectorContent) inspectorContent.classList.add('active');
            if (libraryContent) libraryContent.classList.remove('active');
        }
        
        updateRightSidebarToggle();
    }
    
    function updateRightSidebarToggle() {
        const sidebar = document.getElementById('solar-right-sidebar');
        const toggle = document.getElementById('solar-right-sidebar-toggle');
        if (sidebar && toggle) {
            toggle.innerHTML = sidebar.classList.contains('closed') ? '◀' : '▶';
        }
    }
    
    function toggleLibraryCategory(headerElement) {
        const isExpanded = headerElement.classList.contains('expanded');
        const contentElement = headerElement.nextElementSibling;
        
        if (isExpanded) {
            headerElement.classList.remove('expanded');
            contentElement.classList.remove('expanded');
        } else {
            headerElement.classList.add('expanded');
            contentElement.classList.add('expanded');
        }
    }
    
    function filterLibraryComponents(searchText) {
        const searchLower = searchText.toLowerCase().trim();
        const items = document.querySelectorAll('#componentLibraryTab .library-item');
        
        items.forEach(item => {
            const itemText = item.textContent.toLowerCase();
            const matches = searchLower === '' || itemText.includes(searchLower);
            item.classList.toggle('hidden', !matches);
        });
        
        // Expand categories that have visible items
        document.querySelectorAll('.library-category').forEach(cat => {
            const header = cat.querySelector('.library-category-header');
            const content = cat.querySelector('.library-category-content');
            const visibleItems = content.querySelectorAll('.library-item:not(.hidden)');
            
            if (searchLower !== '' && visibleItems.length > 0) {
                header.classList.add('expanded');
                content.classList.add('expanded');
            }
        });
    }
    
    function clearLibrarySearch() {
        const searchInput = document.getElementById('librarySearchInput');
        if (searchInput) {
            searchInput.value = '';
            filterLibraryComponents('');
        }
    }
    
    function showLibraryTab() {
        if (currentRightPanelTab !== 'library') {
            switchRightPanelTab('library');
        }
    }
    
    function showInspectorTab() {
        if (currentRightPanelTab !== 'inspector') {
            switchRightPanelTab('inspector');
        }
    }
    
    function populateRightSidebarLibraries() {
        // Panel library
        const panelLibrary = document.getElementById('panelLibrary');
        if (panelLibrary) {
            panelLibrary.innerHTML = '';
            PANEL_PRESETS.forEach((preset, i) => {
                const btn = document.createElement('button');
                btn.className = 'library-item';
                btn.innerHTML = `<span class="library-item-icon">☀️</span><span class="library-item-name">${preset.name}</span>`;
                btn.setAttribute('data-preset-type', 'panel');
                btn.setAttribute('data-preset-data', JSON.stringify(preset));
                btn.onclick = () => {
                    const item = createPanel(getRandomPosition().x, getRandomPosition().y, preset);
                    allItems.push(item);
                    selectItem(item);
                    render();
                    showToast(`Added ${preset.name}`, 'info');
                };
                // Make draggable for drag-to-replace
                btn.draggable = true;
                btn.ondragstart = (e) => {
                    e.dataTransfer.setData('application/json', JSON.stringify({ type: 'panel', preset }));
                    e.dataTransfer.effectAllowed = 'copy';
                };
                panelLibrary.appendChild(btn);
            });
        }
        
        // Battery library
        const batteryLibrary = document.getElementById('batteryLibrary');
        if (batteryLibrary) {
            batteryLibrary.innerHTML = '';
            BATTERY_PRESETS.forEach((preset, i) => {
                const btn = document.createElement('button');
                btn.className = 'library-item';
                const icon = preset.smartBattery ? '🔋+' : '🔋';
                btn.innerHTML = `<span class="library-item-icon">${icon}</span><span class="library-item-name">${preset.name}</span>`;
                btn.setAttribute('data-preset-type', preset.smartBattery ? 'smartbattery' : 'battery');
                btn.setAttribute('data-preset-data', JSON.stringify(preset));
                btn.onclick = () => {
                    if (preset.smartBattery) {
                        const item = createSmartBattery(getRandomPosition().x, getRandomPosition().y, preset);
                        allItems.push(item);
                        selectItem(item);
                    } else {
                        const item = createBattery(getRandomPosition().x, getRandomPosition().y, preset);
                        allItems.push(item);
                        selectItem(item);
                    }
                    render();
                    showToast(`Added ${preset.name}`, 'info');
                };
                // Make draggable for drag-to-replace
                btn.draggable = true;
                btn.ondragstart = (e) => {
                    e.dataTransfer.setData('application/json', JSON.stringify({ 
                        type: preset.smartBattery ? 'smartbattery' : 'battery', 
                        preset 
                    }));
                    e.dataTransfer.effectAllowed = 'copy';
                };
                batteryLibrary.appendChild(btn);
            });
        }
        
        // Controller library
        const controllerLibrary = document.getElementById('controllerLibrary');
        if (controllerLibrary) {
            controllerLibrary.innerHTML = '';
            CONTROLLER_PRESETS.forEach((preset, i) => {
                const btn = document.createElement('button');
                btn.className = 'library-item';
                let icon = '⚡';
                if (preset.type === 'all_in_one') icon = '📦';
                else if (preset.type === 'hybrid_inverter') icon = '🔄';
                btn.innerHTML = `<span class="library-item-icon">${icon}</span><span class="library-item-name">${preset.name}</span>`;
                btn.setAttribute('data-preset-type', 'controller');
                btn.setAttribute('data-preset-data', JSON.stringify(preset));
                btn.onclick = () => {
                    const item = createController(getRandomPosition().x, getRandomPosition().y, preset);
                    allItems.push(item);
                    selectItem(item);
                    render();
                    showToast(`Added ${preset.name}`, 'info');
                };
                // Make draggable for drag-to-replace
                btn.draggable = true;
                btn.ondragstart = (e) => {
                    e.dataTransfer.setData('application/json', JSON.stringify({ type: 'controller', preset }));
                    e.dataTransfer.effectAllowed = 'copy';
                };
                controllerLibrary.appendChild(btn);
            });
        }
        
        // Breaker library (DC Breakers)
        const breakerLibrary = document.getElementById('breakerLibrary');
        if (breakerLibrary) {
            breakerLibrary.innerHTML = '';
            BREAKER_PRESETS.forEach((preset, i) => {
                const btn = document.createElement('button');
                btn.className = 'library-item';
                btn.innerHTML = `<span class="library-item-icon">🔌</span><span class="library-item-name">${preset.name}</span>`;
                btn.onclick = () => {
                    const item = createBreaker(getRandomPosition().x, getRandomPosition().y, preset, 'dc');
                    allItems.push(item);
                    selectItem(item);
                    render();
                    showToast(`Added ${preset.name}`, 'info');
                };
                breakerLibrary.appendChild(btn);
            });
        }
        
        // AC Breaker library
        const acBreakerLibrary = document.getElementById('acBreakerLibrary');
        if (acBreakerLibrary) {
            acBreakerLibrary.innerHTML = '';
            [10, 15, 20, 30, 40, 50].forEach(rating => {
                const btn = document.createElement('button');
                btn.className = 'library-item';
                btn.innerHTML = `<span class="library-item-icon">⚡</span><span class="library-item-name">AC Breaker ${rating}A</span>`;
                btn.onclick = () => {
                    const item = createBreaker(getRandomPosition().x, getRandomPosition().y, { name: `AC Breaker ${rating}A`, rating }, 'ac');
                    allItems.push(item);
                    selectItem(item);
                    render();
                    showToast(`Added AC Breaker ${rating}A`, 'info');
                };
                acBreakerLibrary.appendChild(btn);
            });
        }
        
        // AC Outlet library
        const acOutletLibrary = document.getElementById('acOutletLibrary');
        if (acOutletLibrary) {
            acOutletLibrary.innerHTML = '';
            [
                { name: '120V Duplex Outlet', voltage: 120 },
                { name: '240V Outlet', voltage: 240 }
            ].forEach(outlet => {
                const btn = document.createElement('button');
                btn.className = 'library-item';
                btn.innerHTML = `<span class="library-item-icon">🔌</span><span class="library-item-name">${outlet.name}</span>`;
                btn.onclick = () => {
                    const item = createACOutlet(getRandomPosition().x, getRandomPosition().y, outlet);
                    allItems.push(item);
                    selectItem(item);
                    render();
                    showToast(`Added ${outlet.name}`, 'info');
                };
                acOutletLibrary.appendChild(btn);
            });
        }
        
        // Appliance library
        const applianceLibrary = document.getElementById('applianceLibrary');
        if (applianceLibrary) {
            applianceLibrary.innerHTML = '';
            APPLIANCE_PRESETS.forEach((preset, i) => {
                const btn = document.createElement('button');
                btn.className = 'library-item';
                btn.innerHTML = `<span class="library-item-icon">${preset.icon || '⚙️'}</span><span class="library-item-name">${preset.name}</span>`;
                btn.onclick = () => {
                    const item = createLoad(getRandomPosition().x, getRandomPosition().y, preset);
                    allItems.push(item);
                    selectItem(item);
                    render();
                    showToast(`Added ${preset.name}`, 'info');
                };
                applianceLibrary.appendChild(btn);
            });
        }
        
        // Processing equipment library
        const processingLibrary = document.getElementById('processingLibrary');
        if (processingLibrary) {
            processingLibrary.innerHTML = '';
            PRODUCER_PRESETS.forEach((preset, i) => {
                const btn = document.createElement('button');
                btn.className = 'library-item';
                btn.innerHTML = `<span class="library-item-icon">${preset.icon || '🏭'}</span><span class="library-item-name">${preset.name}</span>`;
                btn.onclick = () => {
                    const item = createProducer(getRandomPosition().x, getRandomPosition().y, preset);
                    allItems.push(item);
                    selectItem(item);
                    render();
                    showToast(`Added ${preset.name}`, 'info');
                };
                processingLibrary.appendChild(btn);
            });
        }
        
        // Resource container library
        const resourceContainerLibrary = document.getElementById('resourceContainerLibrary');
        if (resourceContainerLibrary) {
            resourceContainerLibrary.innerHTML = '';
            CONTAINER_PRESETS.forEach((preset, i) => {
                const btn = document.createElement('button');
                btn.className = 'library-item';
                btn.innerHTML = `<span class="library-item-icon">${preset.icon || '📦'}</span><span class="library-item-name">${preset.name}</span>`;
                btn.onclick = () => {
                    const item = createContainer(getRandomPosition().x, getRandomPosition().y, preset);
                    allItems.push(item);
                    selectItem(item);
                    render();
                    showToast(`Added ${preset.name}`, 'info');
                };
                resourceContainerLibrary.appendChild(btn);
            });
        }
        
        // Combiner library (add breaker panels, spider boxes, etc.)
        const combinerLibrary = document.getElementById('combinerLibrary');
        if (combinerLibrary) {
            combinerLibrary.innerHTML = '';
            const combiners = [
                { name: 'Breaker Panel (8-circuit)', type: 'breakerpanel', icon: '📋' },
                { name: 'Spider Box (6-circuit)', type: 'spiderbox', icon: '🕷️' },
                { name: 'Solar Combiner (4-string)', type: 'solarcombiner', icon: '🔗' },
                { name: 'DC Combiner Box', type: 'combiner', icon: '📥' }
            ];
            combiners.forEach(combo => {
                const btn = document.createElement('button');
                btn.className = 'library-item';
                btn.innerHTML = `<span class="library-item-icon">${combo.icon}</span><span class="library-item-name">${combo.name}</span>`;
                btn.onclick = () => {
                    let item;
                    if (combo.type === 'breakerpanel') {
                        item = createBreakerPanel(getRandomPosition().x, getRandomPosition().y);
                    } else if (combo.type === 'spiderbox') {
                        item = createSpiderBox(getRandomPosition().x, getRandomPosition().y);
                    } else if (combo.type === 'solarcombiner') {
                        item = createSolarCombiner(getRandomPosition().x, getRandomPosition().y, { inputs: 4 });
                    } else if (combo.type === 'combiner') {
                        item = createCombiner(getRandomPosition().x, getRandomPosition().y, { inputs: 4 });
                    }
                    if (item) {
                        allItems.push(item);
                        selectItem(item);
                        render();
                        showToast(`Added ${combo.name}`, 'info');
                    }
                };
                combinerLibrary.appendChild(btn);
            });
        }
    }
    
    function setupRightSidebarListeners() {
        const toggle = document.getElementById('solar-right-sidebar-toggle');
        if (toggle) {
            toggle.addEventListener('click', () => {
                const sidebar = document.getElementById('solar-right-sidebar');
                if (sidebar) {
                    sidebar.classList.toggle('closed');
                    updateRightSidebarToggle();
                }
            });
        }
        
        // Quick action buttons
        const duplicateBtn = document.getElementById('quickActionDuplicate');
        if (duplicateBtn) {
            duplicateBtn.onclick = () => {
                if (selectedItem) {
                    duplicateSelectedItem();
                }
            };
        }
        
        const deleteBtn = document.getElementById('quickActionDelete');
        if (deleteBtn) {
            deleteBtn.onclick = () => {
                if (selectedItem) {
                    deleteItem(selectedItem);
                }
            };
        }
    }
    
    // Expose functions globally for onclick handlers
    window.switchRightPanelTab = switchRightPanelTab;
    window.toggleLibraryCategory = toggleLibraryCategory;
    window.filterLibraryComponents = filterLibraryComponents;
    window.clearLibrarySearch = clearLibrarySearch;
    
    // Public API
    return {
        init,
        render,
        getSolarConfig,
        loadSolarConfig,
        clearAll,
        getItems: () => allItems,
        getConnections: () => connections,
        isInitialized: () => isInitialized,
        // Export functions
        exportToSimulator,  // Export to 3D Solar Simulator
        exportSolarConfig,  // Export to JSON file
        importSolarConfig,  // Import from JSON file
        // Linkage import functions
        addPanelFromLinkage,
        importPanelArray,
        addControllerFromLinkage,
        addBatteryFromLinkage,
        importSystemFromLinkage,
        arrangePanelsInGrid,
        // Panel sync (preserves other components)
        syncPanelsFromLinkage,
        removeAllPanels,
        // Stats and modes
        updateStats,
        stopLiveMode,  // Expose for cleanup on mode switch
        showWelcome: showWelcomeDialog,
        showHelp: showHelpModal,
        showShortcuts: showKeyboardShortcuts,
        setLinkageConfig,  // Update linkage config after init
        getLinkageConfig,  // Get current linkage config
        Simulation,  // Expose Simulation object for daylight slider
        switchRightPanelTab,
        showLibraryTab,
        showInspectorTab,
        populateRightSidebarLibraries,
        setupRightSidebarListeners,
        // Debug helper
        debug: () => {
            console.log('=== SolarDesigner Debug ===');
            console.log('LiveView.state.active:', LiveView.state.active);
            console.log('Items:', allItems.length, allItems.map(i => i.type));
            console.log('Connections:', connections.length);
            console.log('PowerFlow entries:', Object.keys(LiveView.state.powerFlow).length);
            console.log('PowerFlow:', LiveView.state.powerFlow);
            console.log('Solar output:', Simulation.currentSolarWatts);
            console.log('Battery flow:', Simulation.currentBatteryFlow);
            
            // Check wire elements
            const wires = document.querySelectorAll('.wire');
            console.log('Wire elements:', wires.length);
            if (wires.length > 0) {
                console.log('First wire classes:', wires[0].getAttribute('class'));
            }
            return { active: LiveView.state.active, items: allItems.length, connections: connections.length, powerFlow: LiveView.state.powerFlow };
        },
        startLiveMode  // Expose for manual testing
    };
})();

// Ensure SolarDesigner is available globally
if (typeof window !== 'undefined') {
    window.SolarDesigner = SolarDesigner;
    console.log('✅ solar-designer.js loaded - SolarDesigner version with new features is ready');
}
