// ============================================================================
// LINKAGE LAB - App render loop (requestRender, render, HUD, 2D fallback)
// Depends on global: state, canvas, ctx, uiStats, uiCol, buildLinkageGeometry, renderThreeJS
// ============================================================================
(function (g) {
    'use strict';

    
    // ============================================================================
    // RENDERER - Performance Optimized
    // ============================================================================
    
    let renderPending = false;
    let lastRenderTime = 0;
    let cachedFaces = null;
    let cachedView = null;
    
    const _perfStats = { frames: 0, lastFpsUpdate: 0, fps: 0, frameStart: 0 };
    
    function requestRender() {
        if (renderPending) return;
        renderPending = true;
        requestAnimationFrame(() => {
            renderPending = false;
            _perfStats.frameStart = performance.now();
            render();
            const elapsed = performance.now() - _perfStats.frameStart;
            _perfStats.frames++;
            const now = performance.now();
            if (now - _perfStats.lastFpsUpdate > 500) {
                _perfStats.fps = Math.round(_perfStats.frames * 1000 / (now - _perfStats.lastFpsUpdate));
                _perfStats.frames = 0;
                _perfStats.lastFpsUpdate = now;
                const el = document.getElementById('perf-stats');
                if (el) el.textContent = `${_perfStats.fps} fps · ${elapsed.toFixed(1)}ms`;
            }
        });
    }

    /**
     * Calculates and updates solar panel statistics in the UI
     * @param {Panel3D[]} panels - Array of panels
     * @param {Object} canopy - Canopy information
     */
    function updateSolarPanelStats(panels, canopy) {
        const countEl = document.getElementById('stat-panel-count');
        const areaEl = document.getElementById('stat-panel-area');
        const weightEl = document.getElementById('stat-panel-weight');
        const canopyEl = document.getElementById('stat-canopy-area');
        const coverageEl = document.getElementById('stat-coverage');
        
        if (!countEl) return;
        
        const panelCount = panels.length;
        let panelAreaSqIn = 0;
        panels.forEach(p => {
            if (p && p.width && p.length) panelAreaSqIn += p.width * p.length;
        });
        const panelAreaSqFt = panelAreaSqIn / 144;
        const arrayWeight = calculateSolarPanelArrayWeight(panels);
        
        const canopyAreaSqIn = canopy ? canopy.area : 0;
        const canopyAreaSqFt = canopyAreaSqIn / 144;
        const coverage = canopyAreaSqFt > 0 ? (panelAreaSqFt / canopyAreaSqFt * 100) : 0;
        
        countEl.textContent = panelCount;
        areaEl.textContent = panelAreaSqFt.toFixed(1) + ' sq ft';
        if (weightEl) {
            weightEl.textContent = unitConverter.formatWeightWithUnit(arrayWeight, 1);
        }
        canopyEl.textContent = canopyAreaSqFt.toFixed(1) + ' sq ft';
        coverageEl.textContent = Math.min(coverage, 100).toFixed(1) + '%';
    }
    
    /**
     * Main render function - draws all viewports
     */
    function render() {
        try {
            // Get the same assembled geometry component set used by export/snapshots.
            const data = buildLinkageGeometry({ useCache: true });
            
            applyCollisionDetection(data);
            
            if (state.solarPanels.enabled) {
                // Update statistics
                updateSolarPanelStats(data.panels, data.canopy);
            } else {
                data.panels = [];
                data.canopy = null;
            }
            
            updateHUD(data);
    
            const currentCenter = data.structureCenter || calculateBeamBounds(data.beams, { mainStructureOnly: true }).center;
            
            // For the main 3D view: use fixed center during animation to prevent auto-repositioning
            // For ortho views (top/side): always use current center for proper auto-zoom
            let mainViewCenter;
            if (state.animation.playing) {
                // During animation, use fixed center (set when animation starts)
                if (!state.animation.fixedCenter) {
                    state.animation.fixedCenter = {...currentCenter};
                }
                mainViewCenter = state.animation.fixedCenter;
            } else {
                // When not animating, use current center and clear any fixed center
                state.animation.fixedCenter = null;
                mainViewCenter = currentCenter;
            }
    
            // Update 3D measurement lines BEFORE rendering (so they're in the scene when rendered)
            update3DMeasurementLines(data);
            
            // Try Three.js WebGL rendering, with 2D canvas fallback
            const threeJsSuccess = renderThreeJS(data, mainViewCenter);
            
            if (!threeJsSuccess) {
                // Fallback to 2D canvas rendering
                const viewport = document.getElementById('viewport');
                const w = viewport.clientWidth;
                const h = viewport.clientHeight;
                
                // Hide WebGL canvas and show 2D canvas
                const webglCanvas = document.getElementById('canvas-webgl');
                if (webglCanvas) webglCanvas.style.display = 'none';
                
                // Resize main canvas
                if (canvas.width !== w || canvas.height !== h) {
                    canvas.width = w;
                    canvas.height = h;
                }
                canvas.style.display = 'block';
                canvas.style.zIndex = '1';
                
                // Clear and draw
                ctx.fillStyle = '#15202b';
                ctx.fillRect(0, 0, w, h);
                
                // Draw 2D scene
                drawGrid3D(ctx, w / 2, h / 2, mainViewCenter);
                drawScene(ctx, data, '3d', w / 2, h / 2, w, h, null, mainViewCenter);
                
                // Also draw top and side views using 2D fallback
                const topCanvas = document.getElementById('canvas-top');
                const topWebGL = document.getElementById('canvas-top-webgl');
                const sideCanvas = document.getElementById('canvas-side');
                const sideWebGL = document.getElementById('canvas-side-webgl');
                
                // Hide WebGL canvases, show 2D canvases
                if (topWebGL) topWebGL.style.display = 'none';
                if (sideWebGL) sideWebGL.style.display = 'none';
                
                if (topCanvas) {
                    topCanvas.style.display = 'block';
                    topCanvas.style.zIndex = '1';
                    const topCtx = topCanvas.getContext('2d');
                    const tw = topCanvas.parentElement.clientWidth;
                    const th = topCanvas.parentElement.clientHeight;
                    topCanvas.width = tw;
                    topCanvas.height = th;
                    topCtx.fillStyle = '#192734';
                    topCtx.fillRect(0, 0, tw, th);
                    drawScene(topCtx, data, 'top', tw / 2, th / 2, tw, th, null, currentCenter);
                }
                
                if (sideCanvas) {
                    sideCanvas.style.display = 'block';
                    sideCanvas.style.zIndex = '1';
                    const sideCtx = sideCanvas.getContext('2d');
                    const sw = sideCanvas.parentElement.clientWidth;
                    const sh = sideCanvas.parentElement.clientHeight;
                    sideCanvas.width = sw;
                    sideCanvas.height = sh;
                    sideCtx.fillStyle = '#192734';
                    sideCtx.fillRect(0, 0, sw, sh);
                    drawScene(sideCtx, data, 'side', sw / 2, sh / 2, sw, sh, null, currentCenter);
                }
            }
    
            // Remove old 2D measurement overlay if present
            const overlay = document.getElementById('measurement-overlay');
            if (overlay) {
                overlay.remove();
            }
        } catch (error) {
            console.error('Render error:', error);
            showToast('Render error: ' + error.message, 'error');
        }
    }
    
    /**
     * Updates the Heads-Up Display with structure statistics and BOM
     * @param {{beams: Beam3D[], brackets: Bracket3D[], bolts: Array, maxRad: number, maxHeight: number}} data - Geometry data
     */
    let _lastHudGeometryHash = null;
    
    function updateHUD(data) {
        const isAnimating = state.animation && state.animation.playing;
        const currentGeoHash = (typeof getCachedGeometryHash === 'function' ? getCachedGeometryHash() : null) || computeGeometryHash();
        const hudNeedsFullUpdate = !isAnimating || _lastHudGeometryHash !== currentGeoHash;
        _lastHudGeometryHash = currentGeoHash;
    
        // During animation, fast-path: only update dynamic stats (height, diameter, collision)
        if (isAnimating && !hudNeedsFullUpdate) {
            uiStats.h.innerText = unitConverter.formatInchesAsLargeUnit(data.maxHeight, 2);
            uiStats.d.innerText = unitConverter.formatInchesAsLargeUnit(data.maxRad * 2, 2);
            return;
        }
    
        const moduleCount = state.modules;
        const hBeams = moduleCount * 2 * state.hStackCount;
        const vBeams = moduleCount * state.vStackCount;
        const uBrackets = moduleCount * 4;
        
        // Calculate bolt counts by type
        // V-stack bolts: 4 per module (2 inner, 2 outer) + 1 center bolt = 5 per module
        // H-center bolts: 2 per module (top and bottom ring centers)
        // H-pivot bolts: 4 per module (inner/outer × top/bottom)
        const splitBolts = needsSplitVBolts();
        const vBoltsInner = moduleCount * 2;  // 2 inner bolts per module (bot-inner, top-inner)
        const vBoltsOuter = moduleCount * 2;  // 2 outer bolts per module (bot-outer, top-outer)
        const vBoltsCenter = moduleCount * 1; // 1 center bolt per module
        const hCenterBolts = moduleCount * 2; // 2 H-center bolts per module
        const hPivotBolts = moduleCount * 4;  // 4 H-pivot bolts per module (at bracket positions)
        const totalVBolts = vBoltsInner + vBoltsOuter + vBoltsCenter;
        const totalHBolts = hCenterBolts + hPivotBolts;
        const nBolts = totalVBolts + totalHBolts;
        
        // Get bolt costs based on mode
        let costBoltVInner, costBoltVOuter, costBoltH, costBoltHPivot;
        if (splitBolts) {
            costBoltVInner = state.costBoltVInner || 0.75;
            costBoltVOuter = state.costBoltVOuter || 0.50;
            costBoltH = state.costBoltH || 0.75;
            costBoltHPivot = state.costBoltHPivot || 0.75;
        } else {
            // Single mode: use same price for all V-stack bolts
            const vBoltPrice = parseFloat(document.getElementById('nb-cost-bolt-v')?.value) || 0.75;
            costBoltVInner = vBoltPrice;
            costBoltVOuter = vBoltPrice;
            costBoltH = parseFloat(document.getElementById('nb-cost-bolt-h')?.value) || 0.75;
            costBoltHPivot = state.costBoltHPivot || 0.75;
        }
    
        // Calculate individual costs (per-beam pricing)
        const hBeamCost = hBeams * state.costHBeam;
        const vBeamCounts = getVBeamCountsByType();
        let vBeamCost;
        if (!vBeamCounts.linked) {
            const innerUnitCost = state.autoLumberPricing
                ? calculateBeamCostByVolume(state.vBeamInnerW, state.vBeamInnerT, state.vLengthFt)
                : state.costVBeam;
            const outerUnitCost = state.autoLumberPricing
                ? calculateBeamCostByVolume(state.vBeamOuterW, state.vBeamOuterT, state.vLengthFt)
                : state.costVBeam;
            vBeamCost = (vBeamCounts.inner * innerUnitCost) + (vBeamCounts.outer * outerUnitCost);
        } else {
            vBeamCost = vBeams * state.costVBeam;
        }
        const bracketCost = uBrackets * state.costBracket;
        
        // Calculate bolt costs by type
        const vBoltInnerCost = vBoltsInner * costBoltVInner;
        const vBoltOuterCost = vBoltsOuter * costBoltVOuter;
        const vBoltCenterCost = vBoltsCenter * (splitBolts ? costBoltVInner : costBoltVInner); // Center uses full length (inner price)
        const hCenterBoltCost = hCenterBolts * costBoltH;
        const hPivotBoltCost = hPivotBolts * costBoltHPivot;
        const boltCost = vBoltInnerCost + vBoltOuterCost + vBoltCenterCost + hCenterBoltCost + hPivotBoltCost;
        const structureSubtotal = hBeamCost + vBeamCost + bracketCost + boltCost;
        
        // Update cost section beam spec displays
        const costHSpec = document.getElementById('cost-h-spec');
        const costVSpec = document.getElementById('cost-v-spec');
        if (costHSpec) costHSpec.textContent = unitConverter.formatBeamSpecForCost(state.hLengthFt, state.hBeamW, state.hBeamT);
        if (costVSpec) {
            if (!vBeamCounts.linked) {
                costVSpec.textContent = `${unitConverter.formatBeamSpecForCost(state.vLengthFt, state.vBeamInnerW, state.vBeamInnerT)} / ${unitConverter.formatBeamSpecForCost(state.vLengthFt, state.vBeamOuterW, state.vBeamOuterT)}`;
            } else {
                costVSpec.textContent = unitConverter.formatBeamSpecForCost(state.vLengthFt, state.vBeamW, state.vBeamT);
            }
        }
        
        // Update reference price per cubic inch display
        const refPriceDisplay = document.getElementById('ref-price-per-cu-in');
        if (refPriceDisplay && state.autoLumberPricing) {
            const pricePerCuIn = getRefPricePerCubicInch();
            if (unitConverter.getPreferredUnitSystem() === 'metric') {
                const pricePerCuCm = pricePerCuIn / 16.387064;
                refPriceDisplay.textContent = `(≈ $${formatNumber(pricePerCuCm * 1000, 3)}/1000 cu.cm.)`;
            } else {
                refPriceDisplay.textContent = `(≈ $${formatNumber(pricePerCuIn * 1000, 3)}/1000 cu.in.)`;
            }
        }
    
        // Update quantities
        uiStats.bh.innerText = hBeams;
        uiStats.bv.innerText = vBeams;
        uiStats.bu.innerText = uBrackets;
        
        // Update individual costs (unit and total)
        uiStats.bhCostUnit.innerText = '$' + formatNumber(state.costHBeam, 2);
        uiStats.bhCost.innerText = '$' + formatNumber(hBeamCost, 0);
        uiStats.bvCostUnit.innerText = '$' + formatNumber(state.costVBeam, 2);
        uiStats.bvCost.innerText = '$' + formatNumber(vBeamCost, 0);
        uiStats.buCostUnit.innerText = '$' + formatNumber(state.costBracket, 2);
        uiStats.buCost.innerText = '$' + formatNumber(bracketCost, 0);
        
        // Update bolt BOM display based on split mode
        const diameterFraction = formatBoltDiameter(state.boltDiameter);
        
        // V-stack bolts display (single row or split rows)
        const bomBV = document.getElementById('bom-b-v');
        const bomBVLabel = document.getElementById('bom-b-v-label');
        const bomBVSpec = document.getElementById('bom-b-v-spec');
        const bomBVCostUnit = document.getElementById('bom-b-v-cost-unit');
        const bomBVCost = document.getElementById('bom-b-v-cost');
        
        // Split bolt rows
        const bomBVInner = document.getElementById('bom-b-vinner');
        const bomBVInnerLabel = document.getElementById('bom-b-vinner-label');
        const bomBVInnerSpec = document.getElementById('bom-b-vinner-spec');
        const bomBVInnerCostUnit = document.getElementById('bom-b-vinner-cost-unit');
        const bomBVInnerCost = document.getElementById('bom-b-vinner-cost');
        
        const bomBVOuter = document.getElementById('bom-b-vouter');
        const bomBVOuterLabel = document.getElementById('bom-b-vouter-label');
        const bomBVOuterSpec = document.getElementById('bom-b-vouter-spec');
        const bomBVOuterCostUnit = document.getElementById('bom-b-vouter-cost-unit');
        const bomBVOuterCost = document.getElementById('bom-b-vouter-cost');
        
        // V-center bolts display (separate from inner/outer)
        const bomBVCenter = document.getElementById('bom-b-vcenter');
        const bomBVCenterLabel = document.getElementById('bom-b-vcenter-label');
        const bomBVCenterSpec = document.getElementById('bom-b-vcenter-spec');
        const bomBVCenterCostUnit = document.getElementById('bom-b-vcenter-cost-unit');
        const bomBVCenterCost = document.getElementById('bom-b-vcenter-cost');
        
        // H-center bolts display
        const bomBH = document.getElementById('bom-b-h');
        const bomBHSpec = document.getElementById('bom-b-h-spec');
        const bomBHCostUnit = document.getElementById('bom-b-h-cost-unit');
        const bomBHCost = document.getElementById('bom-b-h-cost');
        
        // H-pivot bolts display
        const bomBHPivot = document.getElementById('bom-b-hpivot');
        const bomBHPivotSpec = document.getElementById('bom-b-hpivot-spec');
        const bomBHPivotCostUnit = document.getElementById('bom-b-hpivot-cost-unit');
        const bomBHPivotCost = document.getElementById('bom-b-hpivot-cost');
        
        // Washer counts: (stackCount - 1) washers per bolt
        // V-stack washers: 5 bolts per module × (vStackCount - 1) washers per bolt
        const vWashersPerBolt = state.vStackCount > 1 ? (state.vStackCount - 1) : 0;
        const vWasherCount = state.vWasherEnabled ? (totalVBolts * vWashersPerBolt) : 0;
        // H-stack washers: 6 bolts per module (2 center + 4 pivot) × (hStackCount - 1) washers per bolt
        const hWashersPerBolt = state.hStackCount > 1 ? (state.hStackCount - 1) : 0;
        const hWasherCount = state.hWasherEnabled ? (totalHBolts * hWashersPerBolt) : 0;
        
        // Washer costs
        const costWasherV = state.costWasherV || 0.10;
        const costWasherH = state.costWasherH || 0.10;
        const vWasherCost = vWasherCount * costWasherV;
        const hWasherCost = hWasherCount * costWasherH;
        const totalWasherCost = vWasherCost + hWasherCost;
        
        // Washer BOM display elements
        const bomWV = document.getElementById('bom-w-v');
        const bomWVLabel = document.getElementById('bom-w-v-label');
        const bomWVSpec = document.getElementById('bom-w-v-spec');
        const bomWVCostUnit = document.getElementById('bom-w-v-cost-unit');
        const bomWVCost = document.getElementById('bom-w-v-cost');
        
        const bomWH = document.getElementById('bom-w-h');
        const bomWHLabel = document.getElementById('bom-w-h-label');
        const bomWHSpec = document.getElementById('bom-w-h-spec');
        const bomWHCostUnit = document.getElementById('bom-w-h-cost-unit');
        const bomWHCost = document.getElementById('bom-w-h-cost');
        
        if (splitBolts) {
            // Split mode: show inner, outer, and center bolt rows separately, hide single V-stack row
            if (bomBV) bomBV.style.display = 'none';
            if (bomBVLabel) bomBVLabel.style.display = 'none';
            if (bomBVCostUnit) bomBVCostUnit.style.display = 'none';
            if (bomBVCost) bomBVCost.style.display = 'none';
            
            // Show inner bolts row
            if (bomBVInner) { bomBVInner.style.display = ''; bomBVInner.innerText = vBoltsInner; }
            if (bomBVInnerLabel) bomBVInnerLabel.style.display = '';
            if (bomBVInnerSpec) bomBVInnerSpec.textContent = unitConverter.formatBoltSpec(state.boltDiameter, state.vBoltInnerLength);
            if (bomBVInnerCostUnit) { bomBVInnerCostUnit.style.display = ''; bomBVInnerCostUnit.innerText = '$' + formatNumber(costBoltVInner, 2); }
            if (bomBVInnerCost) { bomBVInnerCost.style.display = ''; bomBVInnerCost.innerText = '$' + formatNumber(vBoltInnerCost, 0); }
            
            // Show outer bolts row
            if (bomBVOuter) { bomBVOuter.style.display = ''; bomBVOuter.innerText = vBoltsOuter; }
            if (bomBVOuterLabel) bomBVOuterLabel.style.display = '';
            if (bomBVOuterSpec) bomBVOuterSpec.textContent = unitConverter.formatBoltSpec(state.boltDiameter, state.vBoltOuterLength);
            if (bomBVOuterCostUnit) { bomBVOuterCostUnit.style.display = ''; bomBVOuterCostUnit.innerText = '$' + formatNumber(costBoltVOuter, 2); }
            if (bomBVOuterCost) { bomBVOuterCost.style.display = ''; bomBVOuterCost.innerText = '$' + formatNumber(vBoltOuterCost, 0); }
            
            // Show center bolts row (uses full stack length)
            if (bomBVCenter) { bomBVCenter.style.display = ''; bomBVCenter.innerText = vBoltsCenter; }
            if (bomBVCenterLabel) bomBVCenterLabel.style.display = '';
            if (bomBVCenterSpec) bomBVCenterSpec.textContent = unitConverter.formatBoltSpec(state.boltDiameter, state.vBoltLength);
            if (bomBVCenterCostUnit) { bomBVCenterCostUnit.style.display = ''; bomBVCenterCostUnit.innerText = '$' + formatNumber(costBoltVInner, 2); }
            if (bomBVCenterCost) { bomBVCenterCost.style.display = ''; bomBVCenterCost.innerText = '$' + formatNumber(vBoltCenterCost, 0); }
        } else {
            // Single mode: show combined V-stack row, hide split rows
            if (bomBV) { bomBV.style.display = ''; bomBV.innerText = totalVBolts; }
            if (bomBVLabel) bomBVLabel.style.display = '';
            if (bomBVSpec) bomBVSpec.textContent = unitConverter.formatBoltSpec(state.boltDiameter, state.vBoltLength);
            if (bomBVCostUnit) { bomBVCostUnit.style.display = ''; bomBVCostUnit.innerText = '$' + formatNumber(costBoltVInner, 2); }
            if (bomBVCost) { bomBVCost.style.display = ''; bomBVCost.innerText = '$' + formatNumber(vBoltInnerCost + vBoltOuterCost + vBoltCenterCost, 0); }
            
            // Hide split rows
            if (bomBVInner) bomBVInner.style.display = 'none';
            if (bomBVInnerLabel) bomBVInnerLabel.style.display = 'none';
            if (bomBVInnerCostUnit) bomBVInnerCostUnit.style.display = 'none';
            if (bomBVInnerCost) bomBVInnerCost.style.display = 'none';
            
            if (bomBVOuter) bomBVOuter.style.display = 'none';
            if (bomBVOuterLabel) bomBVOuterLabel.style.display = 'none';
            if (bomBVOuterCostUnit) bomBVOuterCostUnit.style.display = 'none';
            if (bomBVOuterCost) bomBVOuterCost.style.display = 'none';
            
            if (bomBVCenter) bomBVCenter.style.display = 'none';
            if (bomBVCenterLabel) bomBVCenterLabel.style.display = 'none';
            if (bomBVCenterCostUnit) bomBVCenterCostUnit.style.display = 'none';
            if (bomBVCenterCost) bomBVCenterCost.style.display = 'none';
        }
        
        // H-center bolts (always shown)
        if (bomBH) bomBH.innerText = hCenterBolts;
        if (bomBHSpec) bomBHSpec.textContent = unitConverter.formatBoltSpec(state.boltDiameter, state.hBoltLength);
        if (bomBHCostUnit) bomBHCostUnit.innerText = '$' + formatNumber(costBoltH, 2);
        if (bomBHCost) bomBHCost.innerText = '$' + formatNumber(hCenterBoltCost, 0);
        
        // H-pivot bolts (always shown)
        if (bomBHPivot) bomBHPivot.innerText = hPivotBolts;
        if (bomBHPivotSpec) bomBHPivotSpec.textContent = unitConverter.formatBoltSpec(state.boltDiameter, state.hPivotBoltLength);
        if (bomBHPivotCostUnit) bomBHPivotCostUnit.innerText = '$' + formatNumber(costBoltHPivot, 2);
        if (bomBHPivotCost) bomBHPivotCost.innerText = '$' + formatNumber(hPivotBoltCost, 0);
        
        // V-stack washers (show if enabled)
        if (vWasherCount > 0) {
            if (bomWV) { bomWV.style.display = ''; bomWV.innerText = vWasherCount; }
            if (bomWVLabel) bomWVLabel.style.display = '';
            if (bomWVSpec) {
                const isM = unitConverter.getPreferredUnitSystem() === 'metric';
                const u = isM ? 'mm' : '"';
                const f = isM ? unitConverter.IN_TO_MM : 1;
                bomWVSpec.textContent = `(ID: ${formatNumber(state.vWasherID * f, isM ? 1 : 2)}${u}, OD: ${formatNumber(state.vWasherOD * f, isM ? 1 : 2)}${u}, T: ${formatNumber(state.vWasherThickness * f, isM ? 1 : 2)}${u})`;
            }
            if (bomWVCostUnit) { bomWVCostUnit.style.display = ''; bomWVCostUnit.innerText = '$' + formatNumber(costWasherV, 2); }
            if (bomWVCost) { bomWVCost.style.display = ''; bomWVCost.innerText = '$' + formatNumber(vWasherCost, 0); }
        } else {
            if (bomWV) bomWV.style.display = 'none';
            if (bomWVLabel) bomWVLabel.style.display = 'none';
            if (bomWVCostUnit) bomWVCostUnit.style.display = 'none';
            if (bomWVCost) bomWVCost.style.display = 'none';
        }
        
        // H-stack washers (show if enabled)
        if (hWasherCount > 0) {
            if (bomWH) { bomWH.style.display = ''; bomWH.innerText = hWasherCount; }
            if (bomWHLabel) bomWHLabel.style.display = '';
            if (bomWHSpec) {
                const isM = unitConverter.getPreferredUnitSystem() === 'metric';
                const u = isM ? 'mm' : '"';
                const f = isM ? unitConverter.IN_TO_MM : 1;
                bomWHSpec.textContent = `(ID: ${formatNumber(state.hWasherID * f, isM ? 1 : 2)}${u}, OD: ${formatNumber(state.hWasherOD * f, isM ? 1 : 2)}${u}, T: ${formatNumber(state.hWasherThickness * f, isM ? 1 : 2)}${u})`;
            }
            if (bomWHCostUnit) { bomWHCostUnit.style.display = ''; bomWHCostUnit.innerText = '$' + formatNumber(costWasherH, 2); }
            if (bomWHCost) { bomWHCost.style.display = ''; bomWHCost.innerText = '$' + formatNumber(hWasherCost, 0); }
        } else {
            if (bomWH) bomWH.style.display = 'none';
            if (bomWHLabel) bomWHLabel.style.display = 'none';
            if (bomWHCostUnit) bomWHCostUnit.style.display = 'none';
            if (bomWHCost) bomWHCost.style.display = 'none';
        }
        
        const sbBom = computeSupportBomContribution(moduleCount, costBoltVInner);
        const bomSupportWrap = document.getElementById('bom-support-wrap');
        if (bomSupportWrap) {
            if (sbBom.supportBeamCost > 0) {
                bomSupportWrap.style.display = 'block';
                const radQty = document.getElementById('bom-sb-radial-qty');
                const radU = document.getElementById('bom-sb-radial-cost-unit');
                const radT = document.getElementById('bom-sb-radial-cost');
                if (radQty) radQty.innerText = sbBom.radialQty;
                if (radU) radU.innerText = '$' + formatNumber(state.costHBeam, 2);
                if (radT) radT.innerText = '$' + formatNumber(sbBom.structureItems[0].total, 0);
    
                const rcpQty = document.getElementById('bom-sb-rcp-qty');
                const rcpLab = document.getElementById('bom-sb-rcp-label');
                const rcpU = document.getElementById('bom-sb-rcp-cost-unit');
                const rcpT = document.getElementById('bom-sb-rcp-cost');
                const showRcp = state.supportBeams.parallelEnabled && sbBom.reciprocalQty > 0;
                if (rcpQty) {
                    rcpQty.style.display = showRcp ? '' : 'none';
                    rcpQty.innerText = sbBom.reciprocalQty;
                }
                if (rcpLab) rcpLab.style.display = showRcp ? '' : 'none';
                if (rcpU) {
                    rcpU.style.display = showRcp ? '' : 'none';
                    rcpU.innerText = '$' + formatNumber(state.costVBeam, 2);
                }
                if (rcpT) {
                    rcpT.style.display = showRcp ? '' : 'none';
                    const rcpRow = sbBom.structureItems.find(r => r.item.startsWith('Reciprocal'));
                    rcpT.innerText = '$' + formatNumber(rcpRow ? rcpRow.total : 0, 0);
                }
    
                const boltQty = document.getElementById('bom-sb-bolt-qty');
                const boltU = document.getElementById('bom-sb-bolt-cost-unit');
                const boltT = document.getElementById('bom-sb-bolt-cost');
                if (boltQty) boltQty.innerText = sbBom.sbBolts;
                if (boltU) boltU.innerText = '$' + formatNumber(costBoltVInner, 2);
                if (boltT) boltT.innerText = '$' + formatNumber(sbBom.sbBolts * costBoltVInner, 0);
    
                const thruQty = document.getElementById('bom-sb-thru-qty');
                const thruU = document.getElementById('bom-sb-thru-cost-unit');
                const thruT = document.getElementById('bom-sb-thru-cost');
                if (thruQty) thruQty.innerText = sbBom.sbThrough;
                if (thruU) thruU.innerText = '$' + formatNumber(costBoltVInner, 2);
                if (thruT) thruT.innerText = '$' + formatNumber(sbBom.sbThrough * costBoltVInner, 0);
    
                const washQty = document.getElementById('bom-sb-wash-qty');
                const washU = document.getElementById('bom-sb-wash-cost-unit');
                const washT = document.getElementById('bom-sb-wash-cost');
                const cWV = state.costWasherV || 0.10;
                if (washQty) washQty.innerText = sbBom.sbWashers;
                if (washU) washU.innerText = '$' + formatNumber(cWV, 2);
                if (washT) washT.innerText = '$' + formatNumber(sbBom.sbWashers * cWV, 0);
            } else {
                bomSupportWrap.style.display = 'none';
            }
        }
    
        // Update structure subtotal (washers + radial/reciprocal support BOM)
        const structureSubtotalWithWashers = structureSubtotal + totalWasherCost + sbBom.supportBeamCost;
        uiStats.bStructureSubtotal.innerText = '$' + formatNumber(structureSubtotalWithWashers, 2);
        
        // Calculate solar panel cost if panels are enabled
        let solarPanelCount = 0;
        let solarCost = 0;
        if (state.solarPanels.enabled && data.panels && data.panels.length > 0) {
            solarPanelCount = data.panels.length;
            solarCost = solarPanelCount * state.costSolarPanel;
            
            uiStats.bSolar.innerText = solarPanelCount;
            uiStats.bSolarCostUnit.innerText = '$' + formatNumber(state.costSolarPanel, 2);
            uiStats.bSolarCost.innerText = '$' + formatNumber(solarCost, 0);
            uiStats.bSolarRow.style.display = 'flex';
            uiStats.bSolarSubtotal.innerText = '$' + formatNumber(solarCost, 2);
            uiStats.bSolarSubtotalRow.style.display = 'inline';
        } else {
            uiStats.bSolarRow.style.display = 'none';
            uiStats.bSolarSubtotalRow.style.display = 'none';
        }
        
        // Calculate total cost (structure includes washers and support BOM)
        const totalCost = structureSubtotal + totalWasherCost + sbBom.supportBeamCost + solarCost;
        uiStats.bt.innerText = formatNumber(totalCost, 2);
    
        // Calculate structure weight (lbs) based on volume and density
        // Volume = width × thickness × length (all in inches)
        // Weight = volume × density
        const hBeamWeightPerFoot = (state.hBeamW * state.hBeamT * INCHES_PER_FOOT) * state.woodDensity; // cubic inches × lbs/in³
        const hBeamWeight = hBeams * state.hLengthFt * hBeamWeightPerFoot;
        const vBeamWeight = calculateVBeamTotalWeight();
        const bracketWeight = uBrackets * state.weightBracket;
        const boltWeight = nBolts * state.weightBolt;
        const structureWeight = hBeamWeight + vBeamWeight + bracketWeight + boltWeight + sbBom.supportBeamWeight;
    
        const bomWeightSupportRow = document.getElementById('bom-weight-support-row');
        const bomWeightSupport = document.getElementById('bom-weight-support');
        const bomWeightSupportUnit = document.getElementById('bom-weight-support-unit');
        const bomWeightSupportVal = document.getElementById('bom-weight-support-val');
        if (bomWeightSupportRow && bomWeightSupport && bomWeightSupportUnit && bomWeightSupportVal) {
            if (sbBom.supportBeamWeight > 0) {
                bomWeightSupportRow.style.display = 'block';
                bomWeightSupport.innerText = '\u2013';
                bomWeightSupportUnit.innerText = '';
                bomWeightSupportVal.innerText = unitConverter.formatWeightWithUnit(sbBom.supportBeamWeight);
            } else {
                bomWeightSupportRow.style.display = 'none';
            }
        }
        
        // Update weight section (unit and total)
        uiStats.weightH.innerText = hBeams;
        uiStats.weightV.innerText = vBeams;
        uiStats.weightU.innerText = uBrackets;
        // Calculate unit weights
        const hBeamWeightPerBeam = state.hLengthFt * hBeamWeightPerFoot;
        uiStats.weightHUnit.innerText = unitConverter.formatWeightWithUnit(hBeamWeightPerBeam);
        uiStats.weightHVal.innerText = unitConverter.formatWeightWithUnit(hBeamWeight);
        uiStats.weightVUnit.innerText = unitConverter.formatWeightWithUnit(getVBeamWeightPerBeam());
        uiStats.weightVVal.innerText = unitConverter.formatWeightWithUnit(vBeamWeight);
        uiStats.weightUUnit.innerText = unitConverter.formatWeightWithUnit(state.weightBracket, 2);
        uiStats.weightUVal.innerText = unitConverter.formatWeightWithUnit(bracketWeight);
        uiStats.weightStructureSubtotal.innerText = unitConverter.formatWeightWithUnit(structureWeight);
        
        // Calculate solar panel weight if panels are enabled
        let solarPanelWeight = 0;
        if (state.solarPanels.enabled && data.panels && data.panels.length > 0) {
            const weightSummary = getSolarPanelWeightSummary(data);
            solarPanelWeight = weightSummary.total;
            const panelWeightPerUnit = weightSummary.perUnit;
            
            uiStats.weightSolar.innerText = solarPanelCount;
            uiStats.weightSolarUnit.innerText = unitConverter.formatWeightWithUnit(panelWeightPerUnit);
            uiStats.weightSolarVal.innerText = unitConverter.formatWeightWithUnit(solarPanelWeight);
            uiStats.weightSolarRow.style.display = 'block';
        } else {
            uiStats.weightSolarRow.style.display = 'none';
        }
        
        // Calculate system weight (structure + solar panels + batteries + controllers + loads)
        // Get all items from solar designer if available
        let batteryWeight = 0;
        let controllerWeight = 0;
        let loadWeight = 0;
        
        // Try to get items from solar designer if it exists
        // SolarDesigner is a singleton, so we can access it directly if initialized
        let allItems = [];
        try {
            // Try to get the instance from the solar designer module
            if (typeof SolarDesigner !== 'undefined' && SolarDesigner && typeof SolarDesigner.getItems === 'function') {
                allItems = SolarDesigner.getItems();
            } else if (typeof window.solarDesignerInstance !== 'undefined' && window.solarDesignerInstance) {
                allItems = window.solarDesignerInstance.getItems ? window.solarDesignerInstance.getItems() : [];
            }
        } catch (e) {
            // Silently fail if solar designer not available
            console.debug('Solar designer not available for weight calculation:', e);
        }
        
        if (allItems.length > 0) {
            try {
                
                // Calculate battery weights (estimate ~30 lbs per kWh for typical lithium batteries)
                const batteries = allItems.filter(item => item.type === 'battery' || item.type === 'smartbattery');
                batteries.forEach(battery => {
                    let capacityKwh = 0;
                    if (battery.type === 'smartbattery' && battery.specs && battery.specs.capacityWh) {
                        capacityKwh = battery.specs.capacityWh / 1000;
                    } else if (battery.specs && battery.specs.voltage && battery.specs.ah) {
                        capacityKwh = (battery.specs.voltage * battery.specs.ah) / 1000;
                    }
                    // Estimate: ~30 lbs per kWh for lithium batteries
                    batteryWeight += capacityKwh * 30;
                });
                
                // Calculate controller/inverter weights (estimate: ~5-10 lbs each)
                const controllers = allItems.filter(item => item.type === 'controller' || item.type === 'inverter');
                controllers.forEach(() => {
                    controllerWeight += 7; // Average ~7 lbs per controller/inverter
                });
                
                // Calculate load weights (estimate: ~2-5 lbs per load depending on type)
                const loads = allItems.filter(item => item.type === 'acload' || item.type === 'dcload');
                loads.forEach(load => {
                    // Heavier loads (like appliances) might be 5-10 lbs, lighter ones 1-2 lbs
                    // For simplicity, estimate 3 lbs average per load
                    loadWeight += 3;
                });
            } catch (e) {
                // Silently fail if solar designer not available
                console.debug('Error calculating component weights:', e);
            }
        }
        
        const systemWeight = solarPanelWeight + batteryWeight + controllerWeight + loadWeight;
        const totalWeight = structureWeight + systemWeight;
        
        if (systemWeight > 0) {
            uiStats.weightSystemSubtotal.innerText = unitConverter.formatWeightWithUnit(systemWeight);
            uiStats.weightSystemRow.style.display = 'block';
        } else {
            uiStats.weightSystemRow.style.display = 'none';
        }
        
        const isMetricW = unitConverter.getPreferredUnitSystem() === 'metric';
        uiStats.weightTotalBom.innerText = formatNumber(isMetricW ? totalWeight * unitConverter.LBS_TO_KG : totalWeight, 1);
        
        // Update stats panel (top section)
        uiStats.h.innerText = unitConverter.formatInchesAsLargeUnit(data.maxHeight, 2);
        uiStats.d.innerText = unitConverter.formatInchesAsLargeUnit(data.maxRad * 2, 2);
        
        // Calculate actuator stroke length (for internal use, not displayed in HUD anymore)
        const actuatorInfo = calculateActuatorStroke();
        
        // Calculate center of mass and actuator requirements
        // For actuator analysis, exclude solar panels (they're added after unfolding)
        const com = calculateCenterOfMass(data, state.foldAngle, false);
        const comHeightFt = unitConverter.inchesToFeet(com.y);
        
        // Calculate actuator force requirement at current fold angle
        // Use the pivot span positions for force calculation
        const hActiveIn = state.hLengthFt * INCHES_PER_FOOT - state.offsetTopIn - state.offsetBotIn;
        const jointResult = calculateJointPositions(state.foldAngle, {
            hActiveIn: hActiveIn,
            pivotPct: state.pivotPct,
            hobermanAng: state.hobermanAng,
            pivotAng: state.pivotAng
        });
        const loc = jointResult.joints;
        const sc = data.structureCenter || { x: 0, y: 0, z: 0 };
        
        // Calculate force at pivot positions (inner-outer pivot)
        const pivotPos1 = { x: loc.br.x + sc.x, y: 0, z: loc.br.y + sc.z };
        const pivotPos2 = { x: loc.tr.x + sc.x, y: 0, z: loc.tr.y + sc.z };
        const forceResult = calculateRequiredActuatorForce(pivotPos1, pivotPos2, state.foldAngle, data);
        
        // Note: Actuator stats (stroke, CoM height, force) are now only shown in the actuator analysis section
        // These calculations are kept for internal use but not displayed in the main HUD
        
        // Update weight in stats panel (top section)
        uiStats.weightStructure.innerText = unitConverter.formatWeightWithUnit(structureWeight);
        uiStats.weightSystem.innerText = unitConverter.formatWeightWithUnit(systemWeight);
        uiStats.weightTotal.innerText = unitConverter.formatWeightWithUnit(totalWeight);
        
        // Update collision status
        if (state.enforceCollision) {
            uiCol.style.display = 'block';
            const colCount = document.getElementById('col-count');
            const autoBtn = document.getElementById('btn-auto-resolve');
            const statusText = uiCol.querySelector('span[style*="font-weight:bold"]');
            
            if (state.hasCollision) {
                uiCol.style.borderColor = '#ff6b6b';
                uiCol.style.background = 'rgba(255,107,107,0.1)';
                
                // Check collision types for more descriptive message
                const hasGeometricOverfold = state.collisions.some(c => c.type === 'geometric-overfold');
                const hasOverfold = state.collisions.some(c => c.type === 'over-folding' || c.type === 'geometric-overfold');
                const hasVerticalCollision = state.collisions.some(c => c.type === 'vertical-horizontal');
                
                if (statusText) {
                    if (hasGeometricOverfold) {
                        statusText.innerHTML = '⚠ OVER-FOLDED';
                    } else if (hasOverfold) {
                        statusText.innerHTML = '⚠ OVER-FOLDING';
                    } else {
                        statusText.innerHTML = '⚠ COLLISION';
                    }
                    statusText.style.color = '#ff6b6b';
                }
                if (colCount) {
                    const count = state.collisions ? state.collisions.length : 0;
                    let typeDesc = '';
                    if (hasGeometricOverfold) {
                        typeDesc = 'Ring closed - reduce fold';
                    } else if (hasOverfold && hasVerticalCollision) {
                        typeDesc = `${count} (beams + overfold)`;
                    } else if (hasOverfold) {
                        typeDesc = 'Modules overlapping';
                    } else {
                        typeDesc = `${count} beam overlap${count !== 1 ? 's' : ''}`;
                    }
                    colCount.textContent = typeDesc;
                    colCount.style.display = 'inline';
                }
                if (autoBtn) autoBtn.style.display = 'block';
            } else {
                uiCol.style.borderColor = '#2ecc71';
                uiCol.style.background = 'rgba(46,204,113,0.1)';
                if (statusText) statusText.innerHTML = '✓ NO COLLISIONS';
                if (statusText) statusText.style.color = '#2ecc71';
                if (colCount) {
                    colCount.textContent = 'Physics active';
                    colCount.style.display = 'inline';
                }
                if (autoBtn) autoBtn.style.display = 'none';
            }
        } else {
            uiCol.style.display = 'none';
        }
    }
    
    /**
     * Calculates the center point and optimal scale for auto-centering and auto-zooming orthographic views
     * @param {{beams: Beam3D[], brackets: Bracket3D[], bolts: Array}} data - Geometry data
     * @param {string} view - View type: 'top' or 'side'
     * @param {number} vw - Viewport width
     * @param {number} vh - Viewport height
     * @returns {{x: number, y: number, scale: number}} Center coordinates and optimal scale
     */
    function calculateViewCenterAndZoom(data, view, vw, vh) {
        // Now rendering on separate canvases, so center is simply vw/2, vh/2
        const defaultScale = state.view.orthoScale * (40 / state.modules);
        
        if (!data.beams || data.beams.length === 0) {
            return { 
                x: vw / 2, 
                y: vh / 2,
                scale: defaultScale
            };
        }
        
        // Calculate bounding box in 3D space
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        
        data.beams.forEach(beam => {
            beam.corners.forEach(corner => {
                let x, y;
                if (view === 'top') {
                    x = corner.x;
                    y = corner.z;
                } else { // side
                    x = corner.x;
                    y = corner.y;
                }
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            });
        });
        
        const width = maxX - minX;
        const height = maxY - minY;
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        
        // Calculate optimal scale to fit structure in viewport with padding
        const padding = 30; // pixels of padding around structure
        const scaleX = (vw - padding * 2) / Math.max(width, 1);
        const scaleY = (vh - padding * 2) / Math.max(height, 1);
        const optimalScale = Math.min(scaleX, scaleY, defaultScale);
        
        // Center in the viewport
        // For side view, Y is inverted (structure Y up, canvas Y down)
        if (view === 'side') {
            return { 
                x: vw / 2 - centerX * optimalScale,
                y: vh / 2 + centerY * optimalScale,
                scale: optimalScale
            };
        }
        return { 
            x: vw / 2 - centerX * optimalScale,
            y: vh / 2 - centerY * optimalScale,
            scale: optimalScale
        };
    }
    
    /**
     * [LEGACY - Kept for fallback/debugging]
     * Draws the 3D scene in a specific viewport using 2D canvas
     * Now replaced by Three.js WebGL rendering via renderThreeJS()
     * @param {CanvasRenderingContext2D} c - Canvas context
     * @param {{beams: Beam3D[], brackets: Bracket3D[], bolts: Array}} data - Geometry data
     * @param {string} view - View type: '3d', 'top', or 'side'
     * @param {number} cx - Viewport center X
     * @param {number} cy - Viewport center Y
     * @param {number} vw - Viewport width
     * @param {number} vh - Viewport height
     * @param {number} customScale - Optional custom orthographic scale (for auto-zoom)
     * @param {{x: number, y: number, z: number}} structureCenter - Optional structure center for view centering
     */
    function drawScene(c, data, view, cx, cy, vw, vh, customScale = null, structureCenter = null) {
        const cam = state.cam;
        const yawRad = cam.yaw;
        const pitchRad = cam.pitch;
        
        // Default structure center to origin if not provided
        const sc = structureCenter || { x: 0, y: 0, z: 0 };
    
        /**
         * Projects a 3D point to 2D screen coordinates
         * @param {{x: number, y: number, z: number}} v - 3D point
         * @returns {{x: number, y: number, z: number, s: number}} Projected point with scale
         */
        const project = (v) => {
            // Offset by structure center to center the view on the structure
            let x = v.x - sc.x, y = v.y - sc.y, z = v.z - sc.z;
            
            // Apply structure rotation around Y-axis (for structure elements only, not panels)
            // Note: Panels are handled separately in Three.js scene, so this only affects 2D canvas rendering
            const structureRotRad = (state.structureRotation || 0) * Math.PI / 180;
            if (structureRotRad !== 0) {
                const cosR = Math.cos(structureRotRad);
                const sinR = Math.sin(structureRotRad);
                const xRot = x * cosR - z * sinR;
                const zRot = x * sinR + z * cosR;
                x = xRot;
                z = zRot;
            }
            
            // Rotate around Y axis (yaw)
            let x1 = x * Math.cos(-yawRad) - z * Math.sin(-yawRad);
            let z1 = x * Math.sin(-yawRad) + z * Math.cos(-yawRad);
            if (view === '3d') x1 -= cam.panX;
            
            // Rotate around X axis (pitch)
            let y2 = y * Math.cos(pitchRad) - z1 * Math.sin(pitchRad);
            let z2 = y * Math.sin(pitchRad) + z1 * Math.cos(pitchRad);
            if (view === '3d') y2 += cam.panY;
    
            let scale = 1;
            if (view === '3d') {
                // Perspective projection
                let depth = z2 + cam.dist;
                if (depth < MIN_CAM_DIST) depth = MIN_CAM_DIST;
                scale = PERSPECTIVE_SCALE / depth;
                return { x: cx + x1 * scale, y: cy - y2 * scale, z: z2, s: scale };
            } else {
                // Orthographic projection - use custom scale if provided (for auto-zoom), otherwise default
                const orthoScale = customScale !== null 
                    ? customScale 
                    : (state.view.orthoScale * (40 / state.modules));
                if (view === 'top') {
                    return { x: cx + x * orthoScale, y: cy + z * orthoScale, z: 0, s: orthoScale };
                }
                return { x: cx + x * orthoScale, y: cy - y * orthoScale, z: 0, s: orthoScale };
            }
        };
    
        let faces = [];
        // Check if a beam is involved in any collision (either as the primary or secondary beam)
        const isColliding = (beam) => state.collisions.some(c => c.beam === beam || c.other === beam);
    
        data.beams.forEach(beam => {
            const pts = beam.corners.map(p => project(p));
            if (pts.some(p => p.s <= 0)) return;
            const colliding = isColliding(beam);
            
            beam.faces.forEach((f, faceIdx) => {
                const p0 = pts[f.idx[0]], p1 = pts[f.idx[1]], p2 = pts[f.idx[2]], p3 = pts[f.idx[3]];
                // Back-face culling - check if face is facing camera
                const edge1 = {x: p1.x - p0.x, y: p1.y - p0.y};
                const edge2 = {x: p2.x - p0.x, y: p2.y - p0.y};
                const cross = edge1.x * edge2.y - edge1.y * edge2.x;
                
                if (cross < 0) {
                    // Calculate face center in 3D space (before projection) for accurate depth sorting
                    const faceCenter3D = {
                        x: 0, y: 0, z: 0
                    };
                    f.idx.forEach(idx => {
                        const corner3D = beam.corners[idx];
                        faceCenter3D.x += corner3D.x;
                        faceCenter3D.y += corner3D.y;
                        faceCenter3D.z += corner3D.z;
                    });
                    faceCenter3D.x /= f.idx.length;
                    faceCenter3D.y /= f.idx.length;
                    faceCenter3D.z /= f.idx.length;
                    
                    // Project the 3D center to get accurate depth
                    const centerProj = project(faceCenter3D);
                    
                    // Use minimum z of corners for depth sorting (closest point to camera)
                    // This ensures overlapping faces render correctly
                    const minZ = Math.min(p0.z, p1.z, p2.z, p3.z);
                    const maxZ = Math.max(p0.z, p1.z, p2.z, p3.z);
                    
                    // For perspective, use the minimum depth (closest point)
                    // This prevents far faces from appearing in front of near faces
                    const depthForSort = view === '3d' ? minZ : centerProj.z;
                    
                    let light = 1;
                    if (view === '3d') {
                        const dot = vDot(f.norm, state.light);
                        light = 0.5 + 0.5 * Math.max(0, dot);
                    }
                    // Highlight colliding beams in red
                    const color = colliding ? {r: 255, g: 0, b: 0} : beam.colorBase;
                    
                    // Store 3D corners for improved depth calculation
                    const corners3D = f.idx.map(idx => beam.corners[idx]);
                    
                    faces.push({
                        type: 'beam',
                        pts: [p0, p1, p2, p3],
                        z: depthForSort,
                        zMin: minZ,
                        zMax: maxZ,
                        zCenter: centerProj.z,
                        center3D: faceCenter3D,
                        corners3D: corners3D,
                        normal: f.norm,
                        col: color,
                        l: light,
                        beam: beam,
                        faceIdx: faceIdx
                    });
                }
            });
        });
    
        if(state.showBrackets) {
            data.brackets.forEach(b => {
                const p = project(b.pos);
                if(p.s > 0) {
                    // Create 3D L-bracket geometry
                    // The bracket has a horizontal plate (at the ring level) and a vertical plate
                    const hw = b.width / 2;
                    const hd = b.depth / 2;
                    const bt = b.thickness;
                    const bh = Math.abs(b.height); // Bracket vertical height
                    const isBottom = b.isBottom;
                    
                    // Use beam direction for orientation
                    const beamDir = b.beamDir || {x: 0, y: 1, z: 0};
                    const right = b.right || vNorm(vCross(beamDir, {x:0, y:1, z:0}));
                    const forward = vNorm(vCross({x:0, y:1, z:0}, right));
                    
                    // Base position at the horizontal ring level
                    const basePos = {x: b.pos.x, y: b.baseY, z: b.pos.z};
                    
                    // Create 3D box for bracket (simplified L-bracket as a box for now)
                    // The box extends from baseY vertically by bh
                    const yDir = isBottom ? 1 : -1;
                    
                    // 8 corners of bracket box
                    const corners3D = [
                        // Bottom face (at baseY)
                        vAdd(basePos, vAdd(vScale(right, -hw), vScale(forward, -hd))),
                        vAdd(basePos, vAdd(vScale(right, hw), vScale(forward, -hd))),
                        vAdd(basePos, vAdd(vScale(right, hw), vScale(forward, hd))),
                        vAdd(basePos, vAdd(vScale(right, -hw), vScale(forward, hd))),
                        // Top face (at baseY + height)
                        vAdd(vAdd(basePos, {x:0, y: bh * yDir, z:0}), vAdd(vScale(right, -hw), vScale(forward, -hd))),
                        vAdd(vAdd(basePos, {x:0, y: bh * yDir, z:0}), vAdd(vScale(right, hw), vScale(forward, -hd))),
                        vAdd(vAdd(basePos, {x:0, y: bh * yDir, z:0}), vAdd(vScale(right, hw), vScale(forward, hd))),
                        vAdd(vAdd(basePos, {x:0, y: bh * yDir, z:0}), vAdd(vScale(right, -hw), vScale(forward, hd)))
                    ];
                    
                    // Project all corners
                    const projCorners = corners3D.map(c => project(c));
                    const minZ = Math.min(...projCorners.map(c => c.z));
                    const maxZ = Math.max(...projCorners.map(c => c.z));
                    
                    // 6 faces of the bracket box
                    const faceIndices = [
                        [0, 1, 2, 3], // bottom
                        [4, 7, 6, 5], // top  
                        [0, 4, 5, 1], // front
                        [2, 6, 7, 3], // back
                        [0, 3, 7, 4], // left
                        [1, 5, 6, 2]  // right
                    ];
                    
                    faceIndices.forEach(idx => {
                        const faceCorners = idx.map(i => projCorners[i]);
                        
                        // Back-face culling
                        const edge1 = {x: faceCorners[1].x - faceCorners[0].x, y: faceCorners[1].y - faceCorners[0].y};
                        const edge2 = {x: faceCorners[2].x - faceCorners[0].x, y: faceCorners[2].y - faceCorners[0].y};
                        const cross = edge1.x * edge2.y - edge1.y * edge2.x;
                        
                        if (cross < 0) {
                            faces.push({
                                type: 'bracket',
                                corners: faceCorners,
                                z: Math.min(...faceCorners.map(c => c.z)),
                                zMin: minZ,
                                zMax: maxZ
                            });
                        }
                    });
                }
            });
        }
    
        // Collect bolt data for separate rendering pass
        const boltRenderData = [];
        
        if (state.showBolts) {
            data.bolts.forEach(bolt => {
                const centerProj = project(bolt.center || bolt.start);
                if (centerProj.s <= 0) return;
                
                const startProj = project(bolt.start);
                const endProj = project(bolt.end);
                
                if (startProj.s > 0 && endProj.s > 0) {
                    boltRenderData.push({
                        bolt: bolt,
                        startProj: startProj,
                        endProj: endProj,
                        centerProj: centerProj
                    });
                }
            });
        }
    
        // Collect panel grid line data for separate rendering pass
        const panelGridLines = [];
        
        // Process solar panels if present
        // Panels should NOT rotate with structure, so apply inverse structure rotation to their corners
        const structureRotRad = (state.structureRotation || 0) * Math.PI / 180;
        const cosInvR = Math.cos(-structureRotRad);
        const sinInvR = Math.sin(-structureRotRad);
        
        if (data.panels && data.panels.length > 0) {
            data.panels.forEach(panel => {
                // Apply inverse structure rotation to panel corners so panels don't rotate with structure
                const panelCorners = panel.corners.map(corner => {
                    if (structureRotRad !== 0) {
                        // Rotate corner position relative to structure center by inverse rotation
                        const sc = structureCenter || { x: 0, y: 0, z: 0 };
                        const relX = corner.x - sc.x;
                        const relZ = corner.z - sc.z;
                        const rotX = relX * cosInvR - relZ * sinInvR;
                        const rotZ = relX * sinInvR + relZ * cosInvR;
                        return { x: sc.x + rotX, y: corner.y, z: sc.z + rotZ };
                    }
                    return corner;
                });
                const pts = panelCorners.map(p => project(p));
                if (pts.some(p => p.s <= 0)) return;
                
                panel.faces.forEach((f, faceIdx) => {
                    const p0 = pts[f.idx[0]], p1 = pts[f.idx[1]], p2 = pts[f.idx[2]], p3 = pts[f.idx[3]];
                    // Back-face culling
                    const edge1 = {x: p1.x - p0.x, y: p1.y - p0.y};
                    const edge2 = {x: p2.x - p0.x, y: p2.y - p0.y};
                    const cross = edge1.x * edge2.y - edge1.y * edge2.x;
                    
                    if (cross < 0) {
                        const faceCenter3D = {x: 0, y: 0, z: 0};
                        f.idx.forEach(idx => {
                            const corner3D = panelCorners[idx]; // Use rotated corners
                            faceCenter3D.x += corner3D.x;
                            faceCenter3D.y += corner3D.y;
                            faceCenter3D.z += corner3D.z;
                        });
                        faceCenter3D.x /= f.idx.length;
                        faceCenter3D.y /= f.idx.length;
                        faceCenter3D.z /= f.idx.length;
                        
                        const centerProj = project(faceCenter3D);
                        const minZ = Math.min(p0.z, p1.z, p2.z, p3.z);
                        const maxZ = Math.max(p0.z, p1.z, p2.z, p3.z);
                        const depthForSort = view === '3d' ? minZ : centerProj.z;
                        
                        let light = 1;
                        if (view === '3d') {
                            const dot = vDot(f.norm, state.light);
                            light = 0.5 + 0.5 * Math.max(0, dot);
                        }
                        
                        // Determine if this is the top face (visible solar surface)
                        const isTopFace = faceIdx === 1; // Top face index
                        
                        const corners3D = f.idx.map(idx => panel.corners[idx]);
                        
                        faces.push({
                            type: 'panel',
                            pts: [p0, p1, p2, p3],
                            z: depthForSort,
                            zMin: minZ,
                            zMax: maxZ,
                            zCenter: centerProj.z,
                            center3D: faceCenter3D,
                            corners3D: corners3D,
                            normal: f.norm,
                            col: panel.colorBase,
                            gridCol: panel.gridColor,
                            l: light,
                            panel: panel,
                            faceIdx: faceIdx,
                            isTopFace: isTopFace
                        });
                    }
                });
                
                // Collect grid lines for top face (rendered after faces)
                if (panel.gridLines) {
                    panel.gridLines.forEach(line => {
                        const startProj = project(line.start);
                        const endProj = project(line.end);
                        if (startProj.s > 0 && endProj.s > 0) {
                            panelGridLines.push({
                                start: startProj,
                                end: endProj,
                                z: (startProj.z + endProj.z) / 2,
                                color: panel.gridColor
                            });
                        }
                    });
                }
            });
        }
    
        // Sort faces by depth for proper rendering order
        // Using a simplified but robust painter's algorithm
        if (view === '3d') {
            const cosYaw = Math.cos(-state.cam.yaw);
            const sinYaw = Math.sin(-state.cam.yaw);
            const cosPitch = Math.cos(state.cam.pitch);
            const sinPitch = Math.sin(state.cam.pitch);
            const camDist = state.cam.dist;
            
            /**
             * Transforms a 3D point to camera-space depth
             * @param {{x,y,z}} p - 3D point
             * @returns {number} Depth value (larger = farther from camera)
             */
            const toDepth = (p) => {
                const x1 = p.x * cosYaw - p.z * sinYaw;
                const z1 = p.x * sinYaw + p.z * cosYaw;
                const z2 = p.y * sinPitch + z1 * cosPitch;
                return z2 + camDist;
            };
            
            // Pre-compute depth for all faces with improved metrics
            faces.forEach(f => {
                if ((f.type === 'beam' || f.type === 'panel') && f.center3D) {
                    // Calculate camera-space depth for center
                    f.centerDepth = toDepth(f.center3D);
                    
                    // Calculate depths for all corners in camera space
                    if (f.corners3D && f.corners3D.length === 4) {
                        const cornerDepths = f.corners3D.map(c => toDepth(c));
                        f.minDepth = Math.min(...cornerDepths);
                        f.maxDepth = Math.max(...cornerDepths);
                        f.depthRange = f.maxDepth - f.minDepth;
                    } else if (f.pts && f.pts.length > 0) {
                        f.minDepth = Math.min(...f.pts.map(p => p.z));
                        f.maxDepth = Math.max(...f.pts.map(p => p.z));
                        f.depthRange = f.maxDepth - f.minDepth;
                    } else {
                        f.minDepth = f.centerDepth;
                        f.maxDepth = f.centerDepth;
                        f.depthRange = 0;
                    }
                    
                    // Calculate face normal dot product with view direction for tie-breaking
                    // Faces more perpendicular to view should render on top when depths are similar
                    if (f.normal) {
                        // View direction is approximately (0, 0, 1) in camera space after transforms
                        // But we need to consider yaw and pitch
                        const viewX = sinYaw * cosPitch;
                        const viewY = sinPitch;
                        const viewZ = cosYaw * cosPitch;
                        f.viewDot = Math.abs(f.normal.x * viewX + f.normal.y * viewY + f.normal.z * viewZ);
                    }
                } else if (f.type === 'bracket') {
                    if (f.center3D) {
                        f.centerDepth = toDepth(f.center3D);
                    } else {
                        f.centerDepth = f.z;
                    }
                    f.minDepth = f.centerDepth;
                    f.maxDepth = f.centerDepth;
                    f.depthRange = 0;
                }
            });
            
            // Improved depth sorting with better handling of overlapping geometry
            // Calculate camera pitch factor for Y-based sorting decisions
            const pitchFactor = Math.sin(state.cam.pitch);
            const isLookingDown = pitchFactor > 0.2;  // Looking down from above
            const isLookingUp = pitchFactor < -0.2;   // Looking up from below
            
            faces.sort((a, b) => {
                const depthA = a.centerDepth !== undefined ? a.centerDepth : (a.z || 0);
                const depthB = b.centerDepth !== undefined ? b.centerDepth : (b.z || 0);
                const minA = a.minDepth !== undefined ? a.minDepth : depthA;
                const minB = b.minDepth !== undefined ? b.minDepth : depthB;
                const maxA = a.maxDepth !== undefined ? a.maxDepth : depthA;
                const maxB = b.maxDepth !== undefined ? b.maxDepth : depthB;
                
                // Check if faces overlap in depth range
                const overlap = !(maxA < minB || maxB < minA);
                
                if (!overlap) {
                    // No overlap - simply sort by which is closer (min depth)
                    // Face with larger minDepth is farther, render first
                    return minB - minA;
                }
                
                // Type-aware sorting for better visual results
                const aIsPanel = a.type === 'panel';
                const bIsPanel = b.type === 'panel';
                const aIsBeam = a.type === 'beam';
                const bIsBeam = b.type === 'beam';
                
                // Panel vs beam: panels should render ON TOP of beams they're attached to
                // This is critical for arch mode where panels sit on roof surfaces
                if ((aIsPanel && bIsBeam) || (aIsBeam && bIsPanel)) {
                    // Compare by surface normal direction relative to camera
                    // Panels physically sit above the beams in the outward direction
                    if (a.center3D && b.center3D) {
                        // Check if panel is above/outward from beam
                        const yDiff = a.center3D.y - b.center3D.y;
                        if (Math.abs(yDiff) > 1) {
                            // Significant Y difference - render higher object later
                            if (isLookingDown) return -yDiff;
                            if (isLookingUp) return yDiff;
                        }
                    }
                    // Default: panels render after beams (on top)
                    return aIsPanel ? -1 : 1;
                }
                
                // Panel vs panel: use consistent ordering for adjacent panels
                if (aIsPanel && bIsPanel) {
                    // Sort by center depth, with small bias for consistent ordering
                    const depthDiff = depthB - depthA;
                    if (Math.abs(depthDiff) > 0.1) return depthDiff;
                    // Secondary: sort by position for stability
                    if (a.center3D && b.center3D) {
                        const posDiff = (b.center3D.x + b.center3D.z) - (a.center3D.x + a.center3D.z);
                        if (Math.abs(posDiff) > 0.1) return posDiff;
                    }
                }
                
                // Faces overlap in depth - need more sophisticated sorting
                // Use center depth as primary
                const centerDiff = depthB - depthA;
                if (Math.abs(centerDiff) > 0.5) {
                    return centerDiff;
                }
                
                // For same-type overlapping faces, use Y-coordinate (world height)
                if (a.center3D && b.center3D) {
                    const yDiff = a.center3D.y - b.center3D.y;
                    
                    // If there's any height difference
                    if (Math.abs(yDiff) > 0.1) {
                        if (isLookingDown) {
                            // Render higher Y objects later (on top)
                            return -yDiff;
                        } else if (isLookingUp) {
                            // Render lower Y objects later (on top)
                            return yDiff;
                        }
                    }
                }
                
                // Use closer point (minDepth) for remaining cases
                const minDiff = minB - minA;
                if (Math.abs(minDiff) > 0.05) {
                    return minDiff;
                }
                
                // Nearly identical depths - use face orientation
                // Faces facing camera more directly should render on top
                if (a.viewDot !== undefined && b.viewDot !== undefined) {
                    const dotDiff = b.viewDot - a.viewDot;
                    if (Math.abs(dotDiff) > 0.01) {
                        return dotDiff;
                    }
                }
                
                // Final tie-breaker: stable sort by 3D position
                if (a.center3D && b.center3D) {
                    const posA = a.center3D.x * 1000 + a.center3D.y * 10 + a.center3D.z * 0.1;
                    const posB = b.center3D.x * 1000 + b.center3D.y * 10 + b.center3D.z * 0.1;
                    return posB - posA;
                }
                
                return 0;
            });
        } else {
            // For orthographic views, simple z-sort is sufficient
            faces.sort((a, b) => {
                const zA = a.z !== undefined ? a.z : 0;
                const zB = b.z !== undefined ? b.z : 0;
                return zB - zA;
            });
        }
    
        faces.forEach(f => {
            if(f.type === 'beam') {
                const r = Math.floor(f.col.r * f.l);
                const g = Math.floor(f.col.g * f.l);
                const b = Math.floor(f.col.b * f.l);
                
                c.globalAlpha = 1.0;
                
                // Calculate depth factor for visual effects (0 = far, 1 = close)
                const minZ = f.minDepth !== undefined ? f.minDepth : (f.zMin !== undefined ? f.zMin : f.z);
                const depthFactor = Math.max(0, Math.min(1, (1500 - minZ) / 1500));
                
                c.beginPath();
                c.moveTo(f.pts[0].x, f.pts[0].y);
                for(let i = 1; i < 4; i++) {
                    c.lineTo(f.pts[i].x, f.pts[i].y);
                }
                c.closePath();
                
                // Fill with base color
                c.fillStyle = `rgb(${r},${g},${b})`;
                c.fill();
                
                if (view === '3d') {
                    // Add depth-based edge styling for better visual separation
                    // Closer faces get stronger, darker edges
                    const edgeAlpha = 0.3 + depthFactor * 0.5; // 0.3 to 0.8
                    const edgeWidth = 0.5 + depthFactor * 1.0; // 0.5 to 1.5
                    
                    c.strokeStyle = `rgba(0,0,0,${edgeAlpha})`;
                    c.lineWidth = edgeWidth;
                    c.stroke();
                    
                    // Add subtle inner shadow/highlight for 3D effect on close faces
                    if (depthFactor > 0.3) {
                        // Draw a subtle inner line on the top/left edges (highlight)
                        c.strokeStyle = `rgba(255,255,255,${(depthFactor - 0.3) * 0.15})`;
                        c.lineWidth = 0.5;
                        c.beginPath();
                        c.moveTo(f.pts[0].x, f.pts[0].y);
                        c.lineTo(f.pts[1].x, f.pts[1].y);
                        c.stroke();
                    }
                } else {
                    // Orthographic views: consistent subtle edges
                    c.strokeStyle = `rgba(0,0,0,0.3)`;
                    c.lineWidth = 0.5;
                    c.stroke();
                }
            } else if (f.type === 'bracket') {
                // Draw U-bracket face - make it clearly visible
                c.fillStyle = '#000000'; // Black brackets
                c.globalAlpha = 1.0;
                
                // Draw the U-shape face - always draw (no back-face culling for brackets)
                if (f.corners && f.corners.length >= 4) {
                    c.beginPath();
                    c.moveTo(f.corners[0].x, f.corners[0].y);
                    for (let i = 1; i < f.corners.length; i++) {
                        c.lineTo(f.corners[i].x, f.corners[i].y);
                    }
                    c.closePath();
                    c.fill();
                    
                    // Visible edge for definition
                    c.strokeStyle = 'rgba(150,150,150,0.7)';
                    c.lineWidth = 0.8;
                    c.stroke();
                }
            } else if (f.type === 'panel') {
                // Draw solar panel face with realistic appearance
                c.globalAlpha = 1.0;
                
                // Determine face type: 0=bottom, 1=top, 2-5=edges
                const isTopFace = f.faceIdx === 1;
                const isBottomFace = f.faceIdx === 0;
                const isEdgeFace = f.faceIdx >= 2;
                
                // In arch/vertical mode, render both sides as solar cell surface
                // This avoids the "wrong side facing" issue
                const isVerticalMode = state.orientation === 'vertical';
                
                // Get appropriate color based on face type
                let baseR, baseG, baseB;
                if (isTopFace || (isBottomFace && isVerticalMode)) {
                    // Solar cell surface - dark blue (both sides in arch mode)
                    baseR = f.col.r;
                    baseG = f.col.g;
                    baseB = f.col.b;
                } else if (isBottomFace) {
                    // White backsheet (only in cylinder mode)
                    baseR = f.panel.backColor.r;
                    baseG = f.panel.backColor.g;
                    baseB = f.panel.backColor.b;
                } else if (isEdgeFace) {
                    // Black aluminum frame edges - make them darker for better contrast
                    baseR = 15;
                    baseG = 15;
                    baseB = 20;
                } else {
                    // Fallback
                    baseR = f.panel.frameColor.r;
                    baseG = f.panel.frameColor.g;
                    baseB = f.panel.frameColor.b;
                }
                
                const r = Math.floor(baseR * f.l);
                const g = Math.floor(baseG * f.l);
                const b = Math.floor(baseB * f.l);
                
                c.beginPath();
                c.moveTo(f.pts[0].x, f.pts[0].y);
                for(let i = 1; i < 4; i++) {
                    c.lineTo(f.pts[i].x, f.pts[i].y);
                }
                c.closePath();
                
                // Fill with base color
                c.fillStyle = `rgb(${r},${g},${b})`;
                c.fill();
                
                // Add edge styling - stronger for edge faces to show thickness
                if (view === '3d') {
                    if (isEdgeFace) {
                        // Thicker, brighter edge for frame sides to emphasize thickness
                        c.strokeStyle = 'rgba(40,40,50,1)';
                        c.lineWidth = 2;
                    } else {
                        c.strokeStyle = 'rgba(0,0,0,0.8)';
                        c.lineWidth = 1.5;
                    }
                    c.stroke();
                    
                    // For top face (solar surface), add gloss effect and black border
                    // In arch mode, also apply this to bottom face so both sides look like solar cells
                    const isSolarSurface = isTopFace || (isBottomFace && isVerticalMode);
                    
                    if (isSolarSurface) {
                        // Draw inner black border frame (1" inset)
                        const borderInset = 4; // pixels approximation for 1" at typical zoom
                        
                        // Calculate inset points
                        const cx = (f.pts[0].x + f.pts[1].x + f.pts[2].x + f.pts[3].x) / 4;
                        const cy = (f.pts[0].y + f.pts[1].y + f.pts[2].y + f.pts[3].y) / 4;
                        
                        // Draw border as inset rectangle stroke
                        c.strokeStyle = 'rgba(10,10,15,0.7)';
                        c.lineWidth = borderInset;
                        c.stroke();
                        
                        // Re-fill center with solar cell color
                        c.beginPath();
                        // Inset points toward center
                        const insetFactor = 0.92;
                        for (let i = 0; i < 4; i++) {
                            const ix = cx + (f.pts[i].x - cx) * insetFactor;
                            const iy = cy + (f.pts[i].y - cy) * insetFactor;
                            if (i === 0) c.moveTo(ix, iy);
                            else c.lineTo(ix, iy);
                        }
                        c.closePath();
                        c.fillStyle = `rgb(${r},${g},${b})`;
                        c.fill();
                        
                        // Gradient overlay for solar panel gloss effect
                        const gradient = c.createLinearGradient(
                            f.pts[0].x, f.pts[0].y,
                            f.pts[2].x, f.pts[2].y
                        );
                        gradient.addColorStop(0, 'rgba(100,150,255,0.08)');
                        gradient.addColorStop(0.5, 'rgba(150,200,255,0.12)');
                        gradient.addColorStop(1, 'rgba(100,150,255,0.03)');
                        c.fillStyle = gradient;
                        c.fill();
                    }
                    
                    // For bottom face (backsheet), add black border frame (cylinder mode only)
                    if (isBottomFace && !isVerticalMode) {
                        // Draw inner black border (1" frame)
                        const cx = (f.pts[0].x + f.pts[1].x + f.pts[2].x + f.pts[3].x) / 4;
                        const cy = (f.pts[0].y + f.pts[1].y + f.pts[2].y + f.pts[3].y) / 4;
                        
                        c.strokeStyle = 'rgba(10,10,15,0.9)';
                        c.lineWidth = 5;
                        c.stroke();
                        
                        // Re-fill center with white
                        c.beginPath();
                        const insetFactor = 0.88;
                        for (let i = 0; i < 4; i++) {
                            const ix = cx + (f.pts[i].x - cx) * insetFactor;
                            const iy = cy + (f.pts[i].y - cy) * insetFactor;
                            if (i === 0) c.moveTo(ix, iy);
                            else c.lineTo(ix, iy);
                        }
                        c.closePath();
                        c.fillStyle = `rgb(${r},${g},${b})`;
                        c.fill();
                    }
                } else {
                    c.strokeStyle = 'rgba(0,0,0,0.5)';
                    c.lineWidth = 0.8;
                    c.stroke();
                }
            }
            // Note: bolts are rendered in a separate pass below
        });
        
        // === SEPARATE BOLT RENDERING PASS ===
        // Render bolts after all beams/brackets with proper visual treatment
        // This avoids the "MC Escher" effect from depth sorting interpenetrating geometry
        if (state.showBolts && boltRenderData.length > 0) {
            boltRenderData.forEach(bd => {
                const { bolt, startProj, endProj, centerProj } = bd;
                
                const radius = bolt.radius * centerProj.s;
                const headRadius = bolt.headRadius * centerProj.s;
                
                // Calculate shaft geometry
                const dx = endProj.x - startProj.x;
                const dy = endProj.y - startProj.y;
                const length = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dy, dx);
                const perpX = -Math.sin(angle) * radius;
                const perpY = Math.cos(angle) * radius;
                
                // Shaft corners
                const corners = [
                    {x: startProj.x + perpX, y: startProj.y + perpY},
                    {x: endProj.x + perpX, y: endProj.y + perpY},
                    {x: endProj.x - perpX, y: endProj.y - perpY},
                    {x: startProj.x - perpX, y: startProj.y - perpY}
                ];
                
                // Draw bolt with outline style to show it passes through beams
                // 1. Draw dark outline (visible behind beams conceptually)
                c.strokeStyle = '#1a1a1a';
                c.lineWidth = radius * 2 + 2;
                c.lineCap = 'round';
                c.beginPath();
                c.moveTo(startProj.x, startProj.y);
                c.lineTo(endProj.x, endProj.y);
                c.stroke();
                
                // 2. Draw metallic bolt shaft
                c.fillStyle = '#2a2a2a';
                c.beginPath();
                c.moveTo(corners[0].x, corners[0].y);
                for (let i = 1; i < corners.length; i++) {
                    c.lineTo(corners[i].x, corners[i].y);
                }
                c.closePath();
                c.fill();
                
                // 3. Add highlight line along shaft for 3D effect
                c.strokeStyle = 'rgba(100,100,100,0.6)';
                c.lineWidth = Math.max(0.5, radius * 0.3);
                c.beginPath();
                c.moveTo(startProj.x + perpX * 0.5, startProj.y + perpY * 0.5);
                c.lineTo(endProj.x + perpX * 0.5, endProj.y + perpY * 0.5);
                c.stroke();
                
                // 4. Draw bolt heads at both ends
                // Determine which end is closer to camera
                const startCloser = startProj.z < endProj.z;
                const frontEnd = startCloser ? startProj : endProj;
                const backEnd = startCloser ? endProj : startProj;
                
                // Back head (draw first, slightly smaller)
                c.fillStyle = '#1a1a1a';
                c.beginPath();
                c.arc(backEnd.x, backEnd.y, headRadius * 0.9, 0, Math.PI * 2);
                c.fill();
                
                // Front head (draw on top)
                c.fillStyle = '#333333';
                c.beginPath();
                c.arc(frontEnd.x, frontEnd.y, headRadius, 0, Math.PI * 2);
                c.fill();
                
                // Hex pattern on front head
                c.strokeStyle = '#1a1a1a';
                c.lineWidth = 1;
                c.beginPath();
                for (let i = 0; i < 6; i++) {
                    const a = (i / 6) * Math.PI * 2;
                    const hx = frontEnd.x + Math.cos(a) * headRadius * 0.6;
                    const hy = frontEnd.y + Math.sin(a) * headRadius * 0.6;
                    if (i === 0) c.moveTo(hx, hy);
                    else c.lineTo(hx, hy);
                }
                c.closePath();
                c.stroke();
                
                // Highlight on front head
                c.fillStyle = 'rgba(150,150,150,0.3)';
                c.beginPath();
                c.arc(frontEnd.x - headRadius * 0.2, frontEnd.y - headRadius * 0.2, headRadius * 0.3, 0, Math.PI * 2);
                c.fill();
            });
        }
        
        // Draw solar panel grid lines
        if (panelGridLines.length > 0) {
            // Sort by depth (draw far lines first)
            panelGridLines.sort((a, b) => b.z - a.z);
            
            panelGridLines.forEach(line => {
                const r = Math.floor(line.color.r * 0.8);
                const g = Math.floor(line.color.g * 0.8);
                const b = Math.floor(line.color.b * 0.8);
                
                c.strokeStyle = `rgba(${r},${g},${b},0.6)`;
                c.lineWidth = 0.5;
                c.beginPath();
                c.moveTo(line.start.x, line.start.y);
                c.lineTo(line.end.x, line.end.y);
                c.stroke();
            });
        }
        
        // Draw bracket holes after all faces are rendered
        if (state.showBrackets) {
            // Collect unique bracket hole positions
            const bracketHoles = new Map();
            faces.forEach(f => {
                if (f.type === 'bracket' && f.holeCenter && f.holeRadius) {
                    const key = `${Math.round(f.holeCenter.x)},${Math.round(f.holeCenter.y)}`;
                    if (!bracketHoles.has(key)) {
                        bracketHoles.set(key, {center: f.holeCenter, radius: f.holeRadius});
                    }
                }
            });
            
            // Draw holes using destination-out to cut through the bracket
            bracketHoles.forEach(bracket => {
                c.save();
                c.globalCompositeOperation = 'destination-out';
                c.fillStyle = '#000000';
                c.beginPath();
                c.arc(bracket.center.x, bracket.center.y, bracket.radius, 0, Math.PI * 2);
                c.fill();
                c.restore();
            });
        }
    }
    
    /**
     * [LEGACY - Kept for fallback/debugging]
     * Draws the 3D grid in the perspective viewport using 2D canvas
     * Now replaced by Three.js GridHelper via createGridMesh()
     * @param {CanvasRenderingContext2D} c - Canvas context
     * @param {string} view - View type
     * @param {number} cx - Center X
     * @param {number} cy - Center Y
     * @param {number} vw - Viewport width
     */
    function drawGrid3D(c, view, cx, cy, vw, structureCenter = null) {
        const cam = state.cam;
        const sc = structureCenter || { x: 0, y: 0, z: 0 };
        const project = (x, z) => {
            // Offset grid by structure center to keep it aligned with the view
            let gx = x - sc.x, gz = z - sc.z;
            
            // Apply structure rotation around Y-axis (structure only, not panels)
            const structureRotRad = (state.structureRotation || 0) * Math.PI / 180;
            if (structureRotRad !== 0) {
                const cosR = Math.cos(structureRotRad);
                const sinR = Math.sin(structureRotRad);
                const gxRot = gx * cosR - gz * sinR;
                const gzRot = gx * sinR + gz * cosR;
                gx = gxRot;
                gz = gzRot;
            }
            
            let x1 = gx * Math.cos(-cam.yaw) - gz * Math.sin(-cam.yaw) - cam.panX;
            let z1 = gx * Math.sin(-cam.yaw) + gz * Math.cos(-cam.yaw);
            let y2 = (0 - sc.y) - z1 * Math.sin(cam.pitch) + cam.panY;
            let z2 = (0 - sc.y) * Math.sin(cam.pitch) + z1 * Math.cos(cam.pitch);
            let depth = z2 + cam.dist;
            if (depth < MIN_CAM_DIST) depth = MIN_CAM_DIST;
            let scale = PERSPECTIVE_SCALE / depth;
            return { x: cx + x1 * scale, y: cy - y2 * scale };
        };
        c.strokeStyle = 'rgba(0, 242, 234, 0.15)';
        c.lineWidth = 1;
        c.beginPath();
        for (let i = -GRID_RANGE; i <= GRID_RANGE; i += GRID_SPACING) {
            let p1 = project(i, -GRID_RANGE), p2 = project(i, GRID_RANGE);
            c.moveTo(p1.x, p1.y);
            c.lineTo(p2.x, p2.y);
            p1 = project(-GRID_RANGE, i);
            p2 = project(GRID_RANGE, i);
            c.moveTo(p1.x, p1.y);
            c.lineTo(p2.x, p2.y);
        }
        c.stroke();
    }

    g.LinkageModules = g.LinkageModules || {};
    g.LinkageModules.renderApp = { requestRender, render, updateHUD };

    g.calculateViewCenterAndZoom = calculateViewCenterAndZoom;
    g.drawGrid3D = drawGrid3D;
    g.drawScene = drawScene;
    g.render = render;
    g.requestRender = requestRender;
    g.updateHUD = updateHUD;
    g.updateSolarPanelStats = updateSolarPanelStats;

})(window);

