// ============================================================================ (ES module)

import { bridgeGlobals } from './global-bridge.js';
import { MIN_FOLD_ANGLE, MAX_FOLD_ANGLE, INCHES_PER_FOOT } from './constants.js';
import { degToRad, radToDeg, formatNumber } from './math.js';
import { showToast } from '../core/feedback.js';
import { calculateJointPositions } from './solver.js';
import { invalidateGeometryCache, invalidateRcpCrossings } from './cache.js';
import { syncUI } from './state-sync.js';
import { requestRender } from './render-app.js';
import { applyConfig } from './config-persistence.js';

    let solarDesignerLoadPromise = null;
    let currentAppMode = 'linkage';
    let panelSyncTimeout = null;

    // Properties that change reciprocal beam layout — changing these re-seeds crossing constraints.
    const RCP_LAYOUT_PROPS = new Set([
        'parallelLength', 'anchorDist', 'parallelVOffset',
        'parallelOffsetV', 'offsetV', 'offsetH', 'rotation',
        'parallelThickness', 'parallelSwingAngle'
    ]);

    function findOptimalClosedAngle() {
        const targetRotation = Math.PI * 2; // 360 degrees
        const totalModules = state.modules;
        const currentAngle = state.foldAngle;
        
        // Helper to calculate total rotation for a given fold angle
        const getTotalRotation = (foldAngle) => {
            const jointResult = calculateJointPositions(foldAngle, {
                hActiveIn: state.hLengthFt * INCHES_PER_FOOT - state.offsetTopIn - state.offsetBotIn,
                pivotPct: state.pivotPct,
                hobermanAng: state.hobermanAng,
                pivotAng: state.pivotAng
            });
            return Math.abs(jointResult.relativeRotation * totalModules);
        };
        
        // Linear search across the full range to find all crossing points
        // where total rotation = 360°
        const stepSize = degToRad(0.5); // Search in 0.5° steps
        const crossings = [];
        
        let prevRotation = getTotalRotation(MIN_FOLD_ANGLE);
        let prevAngle = MIN_FOLD_ANGLE;
        
        for (let angle = MIN_FOLD_ANGLE + stepSize; angle <= MAX_FOLD_ANGLE; angle += stepSize) {
            const rotation = getTotalRotation(angle);
            
            // Check if we crossed the 360° threshold
            const prevDiff = prevRotation - targetRotation;
            const currDiff = rotation - targetRotation;
            
            if ((prevDiff > 0 && currDiff <= 0) || (prevDiff <= 0 && currDiff > 0)) {
                // Found a crossing - interpolate to find precise angle
                const ratio = Math.abs(prevDiff) / (Math.abs(prevDiff) + Math.abs(currDiff));
                const crossingAngle = prevAngle + ratio * stepSize;
                crossings.push(crossingAngle);
            }
            
            // Also track if we're very close to 360°
            if (Math.abs(currDiff) < degToRad(2)) {
                // Check if this is better than nearby crossings
                let dominated = false;
                for (const existing of crossings) {
                    if (Math.abs(existing - angle) < degToRad(5)) {
                        dominated = true;
                        break;
                    }
                }
                if (!dominated) {
                    crossings.push(angle);
                }
            }
            
            prevRotation = rotation;
            prevAngle = angle;
        }
        
        // Find the crossing closest to the current angle
        // Prefer crossings that would reduce the fold (go toward 360° from over-folded)
        let bestAngle = null;
        let bestDistance = Infinity;
        
        const currentRotation = getTotalRotation(currentAngle);
        const isOverfolded = currentRotation > targetRotation;
        
        for (const crossing of crossings) {
            const distance = Math.abs(crossing - currentAngle);
            
            // If we're over-folded, prefer angles that are in the direction of less folding
            if (isOverfolded) {
                const crossingRotation = getTotalRotation(crossing);
                // The crossing should have rotation close to 360°
                if (Math.abs(crossingRotation - targetRotation) < degToRad(5)) {
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        bestAngle = crossing;
                    }
                }
            } else {
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestAngle = crossing;
                }
            }
        }
        
        // If no good crossing found, refine with binary search from current position
        if (bestAngle === null) {
            // Find which direction reduces rotation toward 360°
            const rotAtCurrent = getTotalRotation(currentAngle);
            const rotAtHigher = getTotalRotation(Math.min(currentAngle + degToRad(5), MAX_FOLD_ANGLE));
            const rotAtLower = getTotalRotation(Math.max(currentAngle - degToRad(5), MIN_FOLD_ANGLE));
            
            // Search in the direction that moves rotation toward 360°
            let searchDir = 0;
            if (rotAtCurrent > targetRotation) {
                // Over-folded, need to reduce rotation
                searchDir = (rotAtHigher < rotAtCurrent) ? 1 : -1;
            } else {
                // Under-folded, need to increase rotation
                searchDir = (rotAtHigher > rotAtCurrent) ? 1 : -1;
            }
            
            // Search in that direction
            let searchAngle = currentAngle;
            for (let i = 0; i < 200; i++) {
                searchAngle += searchDir * stepSize;
                if (searchAngle < MIN_FOLD_ANGLE || searchAngle > MAX_FOLD_ANGLE) break;
                
                const rot = getTotalRotation(searchAngle);
                if (Math.abs(rot - targetRotation) < degToRad(1)) {
                    bestAngle = searchAngle;
                    break;
                }
            }
        }
        
        // Final refinement with small steps
        if (bestAngle !== null) {
            const fineStep = degToRad(0.1);
            let refined = bestAngle;
            let refinedDiff = Math.abs(getTotalRotation(refined) - targetRotation);
            
            for (let offset = -degToRad(2); offset <= degToRad(2); offset += fineStep) {
                const testAngle = bestAngle + offset;
                if (testAngle < MIN_FOLD_ANGLE || testAngle > MAX_FOLD_ANGLE) continue;
                const diff = Math.abs(getTotalRotation(testAngle) - targetRotation);
                if (diff < refinedDiff) {
                    refinedDiff = diff;
                    refined = testAngle;
                }
            }
            bestAngle = refined;
        }
        
        console.log('findOptimalClosedAngle:', {
            crossings: crossings.map(a => formatNumber(radToDeg(a), 1)),
            bestAngle: bestAngle ? formatNumber(radToDeg(bestAngle), 1) : null,
            currentRotation: formatNumber(radToDeg(getTotalRotation(currentAngle)), 1),
            bestRotation: bestAngle ? formatNumber(radToDeg(getTotalRotation(bestAngle)), 1) : null
        });
        
        return bestAngle;
    }
    function selectActuator(index) {
        if (!state.actuatorRecommendations || index >= state.actuatorRecommendations.length) {
            state.selectedActuator = null;
            if (threeRenderer.actuatorLineGroup) {
                clearGroup(threeRenderer.actuatorLineGroup);
            }
            requestRender();
            return;
        }
        
        state.selectedActuator = state.actuatorRecommendations[index];
        
        // Update UI to show selection
        const items = document.querySelectorAll('.actuator-recommendation-item');
        items.forEach((item, idx) => {
            if (idx === index) {
                item.style.background = 'rgba(0,255,0,0.1)';
                item.style.borderLeft = '3px solid #00ff00';
            } else {
                item.style.background = 'rgba(255,255,255,0.05)';
                const rec = state.actuatorRecommendations[idx];
                item.style.borderLeft = `3px solid ${idx === 0 ? '#f39c12' : rec.recommended ? '#2ecc71' : '#e74c3c'}`;
            }
        });
        
        // Trigger render to show actuator line
        const data = buildLinkageGeometry({ includeSupportBeams: true, includePanels: true, useCache: false });
        data.structureCenter = data.structureCenter || { x: 0, y: 0, z: 0 };
        
        updateThreeJSScenes(data, data.structureCenter);
        requestRender();
        
        showToast(`Selected: ${state.selectedActuator.name}`, 'info');
    }
    function bindSupportBeamControl(sliderId, numberId, prop, defaults) {
        const sl = document.getElementById(sliderId);
        const nb = document.getElementById(numberId);
        const maybeInvalidateCrossings = () => {
            if (RCP_LAYOUT_PROPS.has(prop)) invalidateRcpCrossings();
        };
        if (sl) sl.oninput = e => {
            const val = parseFloat(e.target.value);
            state.supportBeams[prop] = val;
            if (nb) nb.value = val;
            maybeInvalidateCrossings();
            invalidateGeometryCache();
            requestRender();
        };
        if (nb) nb.onchange = e => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = defaults.def;
            val = Math.max(defaults.min, Math.min(defaults.max, val));
            state.supportBeams[prop] = val;
            if (sl) sl.value = Math.max(parseFloat(sl.min), Math.min(parseFloat(sl.max), val));
            e.target.value = val;
            maybeInvalidateCrossings();
            invalidateGeometryCache();
            requestRender();
        };
    }
    function syncSupportBeamsUIFromState() {
        const sb = state.supportBeams;
        if (!sb) return;
        const setPair = (slId, nbId, val) => {
            const sl = document.getElementById(slId);
            const nb = document.getElementById(nbId);
            if (sl) sl.value = Math.max(parseFloat(sl.min), Math.min(parseFloat(sl.max), val));
            if (nb) nb.value = val;
        };
        const chkB = document.getElementById('chk-support-beams');
        if (chkB) chkB.checked = !!sb.enabled;
        const divB = document.getElementById('support-beam-controls');
        if (divB) divB.style.display = sb.enabled ? 'block' : 'none';
        const chkR = document.getElementById('chk-support-radial');
        if (chkR) chkR.checked = sb.showRadial !== false;
        const divR = document.getElementById('support-radial-controls');
        if (divR) divR.style.display = (sb.showRadial !== false) ? 'block' : 'none';
        setPair('sl-support-length', 'nb-support-length', sb.length ?? 120);
        setPair('sl-support-width', 'nb-support-width', sb.width ?? 1.5);
        setPair('sl-support-thickness', 'nb-support-thickness', sb.thickness ?? 3.5);
        setPair('sl-support-rotation', 'nb-support-rotation', sb.rotation ?? 0);
        setPair('sl-support-offset-h', 'nb-support-offset-h', sb.offsetH ?? 0);
        setPair('sl-support-offset-v', 'nb-support-offset-v', sb.offsetV ?? 0);
        const chkP = document.getElementById('chk-support-parallel');
        if (chkP) chkP.checked = !!sb.parallelEnabled;
        const divP = document.getElementById('support-parallel-controls');
        if (divP) divP.style.display = sb.parallelEnabled ? 'block' : 'none';
        setPair('sl-rcp-length', 'nb-rcp-length', sb.parallelLength ?? 96);
        setPair('sl-rcp-width', 'nb-rcp-width', sb.parallelWidth ?? 2.5);
        setPair('sl-rcp-thickness', 'nb-rcp-thickness', sb.parallelThickness ?? 1.5);
        setPair('sl-rcp-swing', 'nb-rcp-swing', sb.parallelSwingAngle ?? 0);
        setPair('sl-rcp-voffset', 'nb-rcp-voffset', sb.parallelOffsetV ?? 4.5);
        setPair('sl-rcp-anchor-dist', 'nb-rcp-anchor-dist', sb.anchorDist ?? 20);
        setPair('sl-support-ab-offset', 'nb-support-ab-offset', sb.parallelVOffset ?? 0);
        setPair('sl-rcp-end-offset', 'nb-rcp-end-offset', sb.rcpEndOffset ?? 0);
        const chkK = document.getElementById('chk-rcp-kinematic');
        if (chkK) chkK.checked = sb.rcpKinematicMode !== false;
        if (typeof refreshRcpPivotHoleOptions === 'function') refreshRcpPivotHoleOptions();
        // Re-apply enable/disable for the folding-pivot selector so loading a config with
        // kinematics OFF/ON updates the control state.
        if (typeof applyRcpKinematicUI === 'function') applyRcpKinematicUI(sb.rcpKinematicMode !== false);
    }
    function applyRcpKinematicUI(enabled) {
        // Swing angle sets the deployed layout in both modes; kinematic mode adds the bolted-pivot solve.
        const pivotRow = document.getElementById('rcp-pivot-row');
        const sel = document.getElementById('sel-rcp-pivot-hole');
        if (pivotRow) pivotRow.style.opacity = enabled ? '1' : '0.4';
        if (sel) sel.disabled = !enabled;
    }
    function refreshRcpPivotHoleOptions() {
        const sel = document.getElementById('sel-rcp-pivot-hole');
        const cfg = state.supportBeams;
        if (!sel || !cfg) return;
        const count = Math.max(1, cfg.rcpMaxHoleCount || 1);
        const active = Math.max(1, Math.min(cfg.rcpActiveHole || 1, count));
        if (sel._renderedCount !== count) {
            const labels = ['', 'Hole 1 (nearest anchor)', 'Hole 2 (middle)', 'Hole 3 (nearest free end)'];
            sel.innerHTML = '';
            for (let k = 1; k <= count; k++) {
                const opt = document.createElement('option');
                opt.value = String(k);
                opt.textContent = labels[k] || ('Hole ' + k);
                sel.appendChild(opt);
            }
            sel._renderedCount = count;
        }
        sel.value = String(active);
    }
    function saveUnifiedConfig() {
        const config = getUnifiedConfig();
        localStorage.setItem('unifiedSolarConfig', JSON.stringify(config));
        showToast('Unified config saved', 'info');
    }
    function loadUnifiedConfig() {
        const saved = localStorage.getItem('unifiedSolarConfig');
        if (!saved) {
            showToast('No saved unified config found', 'error');
            return;
        }
        
        try {
            const config = JSON.parse(saved);
            applyUnifiedConfigToModes(config);
            showToast('Unified config loaded', 'info');
        } catch (e) {
            console.error('Failed to load unified config:', e);
            showToast('Failed to load config', 'error');
        }
    }
    function exportUnifiedConfig() {
        const config = getUnifiedConfig();
        
        // Generate filename
        let filename = `StarShade-${state.modules}m-${state.orientation}`;
        const panelCount = config.summary?.panelCount || 0;
        if (panelCount > 0) filename += `-${panelCount}p`;
        filename += `-${new Date().toISOString().slice(0, 10)}.json`;
        
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        
        showToast(`Exported unified config: ${filename}`, 'info');
    }
    function importUnifiedConfig() {
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
                    applyUnifiedConfigToModes(config);
                    showToast(`Imported: ${file.name}`, 'info');
                } catch (err) {
                    console.error('Failed to import config:', err);
                    showToast('Failed to import config', 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }
    function applyUnifiedConfigToModes(config) {
        // Apply to linkage mode if structure data present
        const linkageTrigger = config.structure || config.mode || config.foldAngle !== undefined
            || ('supportBeams' in config)
            || (config.panels && config.panels.support);
        if (linkageTrigger) {
            try {
                applyConfig(config);
            } catch (e) {
                console.warn('Failed to apply linkage config:', e);
            }
        }
        
        // Apply to solar designer if circuit data present
        if (typeof SolarDesigner !== 'undefined' && SolarDesigner.isInitialized()) {
            try {
                // Handle different config formats
                let items = [], connections = [];
                
                if (config.circuit) {
                    // New unified-v2 format
                    items = config.circuit.items || [];
                    connections = config.circuit.connections || [];
                } else if (config.solarDesigner) {
                    // Old format from getUnifiedConfig
                    items = (config.solarDesigner.items || []).map(item => ({
                        id: item.id,
                        type: item.type,
                        x: item.x,
                        y: item.y,
                        specs: item.specs || {},
                        handles: {}
                    }));
                    connections = (config.solarDesigner.connections || []).map(conn => ({
                        id: conn.id,
                        sourceItemId: conn.src,
                        sourceHandleKey: conn.srcH,
                        targetItemId: conn.tgt,
                        targetHandleKey: conn.tgtH
                    }));
                }
                
                if (items.length > 0) {
                    SolarDesigner.loadSolarConfig({ items, connections });
                }
            } catch (e) {
                console.warn('Failed to apply solar designer config:', e);
            }
        }
        
        // Store structure geometry for simulator
        if (config.structureGeometry || config.geometrySnapshot) {
            const geometry = config.structureGeometry || config.geometrySnapshot;
            localStorage.setItem('linkageLabGeometry', JSON.stringify(geometry));
            window.linkageLabGeometry = geometry;
        }
    }
    function loadScriptOnce(src) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing) {
                if (existing.dataset.loaded === 'true') {
                    resolve();
                    return;
                }
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error(`Failed to load script: ${src}`)), { once: true });
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.onload = () => {
                script.dataset.loaded = 'true';
                resolve();
            };
            script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.head.appendChild(script);
        });
    }
    function ensureSolarDesignerLoaded() {
        if (typeof SolarDesigner !== 'undefined') {
            return Promise.resolve(SolarDesigner);
        }
        if (!solarDesignerLoadPromise) {
            solarDesignerLoadPromise = (async () => {
                await loadScriptOnce('https://d3js.org/d3.v7.min.js');
                await loadScriptOnce('js/core/automation.js');
                await loadScriptOnce('js/solar/wires.js');
                await loadScriptOnce('js/solar/bom.js');
                await loadScriptOnce('js/solar/review.js');
                await loadScriptOnce('js/solar/resources.js');
                await loadScriptOnce('solar-designer.js');
                return SolarDesigner;
            })().catch((err) => {
                solarDesignerLoadPromise = null;
                throw err;
            });
        }
        return solarDesignerLoadPromise;
    }
    function switchToLinkageMode() {
        if (currentAppMode === 'linkage') return;
        
        // CRITICAL: Stop simulation and clean up animation frames
        if (typeof SolarDesigner !== 'undefined') {
            SolarDesigner.stopLiveMode();
            if (SolarDesigner.Simulation) {
                SolarDesigner.Simulation.pause();
            }
        }
        
        currentAppMode = 'linkage';
        document.body.classList.remove('solar-mode');
        
        document.getElementById('btn-mode-linkage').classList.add('active');
        document.getElementById('btn-mode-solar').classList.remove('active');
        
        document.getElementById('viewport').style.display = '';
        document.getElementById('solar-canvas-container').classList.remove('active');
        
        document.getElementById('controls').style.display = '';
        document.getElementById('solar-sidebar').classList.remove('active');
        
        // Restore right panel for linkage mode
        document.getElementById('right-panel').style.display = '';
        
        requestRender();
    }
    function switchToSolarMode() {
        if (currentAppMode === 'solar') return;
    
        ensureSolarDesignerLoaded().then(() => {
            currentAppMode = 'solar';
            document.body.classList.add('solar-mode');
    
            document.getElementById('btn-mode-linkage').classList.remove('active');
            document.getElementById('btn-mode-solar').classList.add('active');
    
            document.getElementById('viewport').style.display = 'none';
            document.getElementById('solar-canvas-container').classList.add('active');
    
            document.getElementById('controls').style.display = 'none';
            document.getElementById('solar-sidebar').classList.add('active');
    
            document.getElementById('right-panel').style.display = 'none';
    
            if (!SolarDesigner.isInitialized()) {
                SolarDesigner.init();
            }
    
            syncPanelsFromLinkageMode();
            SolarDesigner.render();
            setTimeout(SolarDesigner.showWelcome, 500);
        }).catch((e) => {
            console.error('Failed to load Solar Designer:', e);
            showToast('Failed to load Solar Designer', 'error');
        });
    }
    function syncPanelsFromLinkageMode(force = false) {
        if (!state.solarPanels.enabled) {
            // If solar panels are disabled, optionally remove panels from designer
            if (force && SolarDesigner.isInitialized()) {
                const removed = SolarDesigner.removeAllPanels();
                if (removed > 0) {
                    SolarDesigner.render();
                    showToast(`Removed ${removed} panels (solar disabled in linkage)`, 'info');
                }
            }
            return;
        }
        
        try {
            // Get current linkage data with solar panels
            const data = buildLinkageGeometry({ includeSupportBeams: true, includePanels: true, useCache: false });
            const linkagePanels = data.panels || [];
            
            if (linkagePanels.length === 0) return;
            
            // Get panel specs and grid layout from linkage mode
            const panelConfig = getActivePanelConfig();
            const isArchMode = state.orientation === 'vertical';
            const panelPreset = panelConfig.presetId && typeof spFindPresetById === 'function'
                ? spFindPresetById(panelConfig.presetId) : null;
            
            const panelSpecs = {
                name: panelPreset ? panelPreset.name : ('LinkageLab ' + panelConfig.ratedWatts + 'W'),
                wmp: panelConfig.ratedWatts,
                vmp: panelConfig.vmp || 41.5,
                voc: panelConfig.voc || 49.5,
                isc: panelConfig.isc || 10.2,
                imp: panelConfig.imp || 9.65,
                width: (panelConfig.panelWidth || 39) * 25.4,  // Convert inches to mm
                height: (panelConfig.panelLength || 65) * 25.4,
                cost: state.costSolarPanel || 150
            };
            
            const layoutConfig = {
                isArchMode: isArchMode,
                gridRows: panelConfig.gridRows,
                gridCols: panelConfig.gridCols,
                paddingX: panelConfig.paddingX,
                paddingY: panelConfig.paddingY
            };
            
            // Check if we need to sync
            const currentPanels = SolarDesigner.getItems().filter(i => i.type === 'panel');
            const needsSync = force || 
                              currentPanels.length === 0 || 
                              currentPanels.length !== linkagePanels.length ||
                              panelConfigChanged(currentPanels, panelSpecs);
            
            if (needsSync) {
                // Use the new syncPanelsFromLinkage function that preserves other components
                const result = SolarDesigner.syncPanelsFromLinkage({
                    panels: linkagePanels,
                    specs: panelSpecs,
                    layout: layoutConfig
                });
                
                if (result.synced) {
                    SolarDesigner.updateStats();
                    showToast(result.message, 'info');
                }
            }
        } catch (e) {
            console.warn('Could not sync panels from linkage mode:', e);
        }
    }
    function panelConfigChanged(currentPanels, newSpecs) {
        if (currentPanels.length === 0) return false;
        const firstPanel = currentPanels[0];
        return firstPanel.specs.wmp !== newSpecs.wmp ||
               firstPanel.specs.width !== newSpecs.width ||
               firstPanel.specs.height !== newSpecs.height;
    }
    function debouncedPanelSync() {
        // Only sync if solar designer is initialized
        if (!SolarDesigner.isInitialized()) return;
        
        if (panelSyncTimeout) {
            clearTimeout(panelSyncTimeout);
        }
        
        // Wait 500ms after last change before syncing
        panelSyncTimeout = setTimeout(() => {
            syncPanelsFromLinkageMode(true); // Force sync
        }, 500);
    }

    function initUIBindings() {

        // Keyboard shortcuts
        document.addEventListener('keydown', e => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            switch (e.key.toLowerCase()) {
                case 'r':
                    if (e.ctrlKey || e.metaKey) return;
                    document.getElementById('btn-fit').click();
                    break;
                case 'f':
                    if (e.ctrlKey || e.metaKey) return;
                    document.getElementById('btn-fit').click();
                    break;
                case ' ':
                    e.preventDefault();
                    if (state.animation.playing) {
                        document.getElementById('btn-anim-pause').click();
                    } else {
                        document.getElementById('btn-anim-play').click();
                    }
                    break;
                case '+':
                case '=':
                    state.cam.dist *= 0.9;
                    if (state.cam.dist < MIN_CAM_DIST) state.cam.dist = MIN_CAM_DIST;
                    requestRender();
                    break;
                case '-':
                case '_':
                    state.cam.dist *= 1.1;
                    requestRender();
                    break;
                case 'arrowleft':
                    e.preventDefault();
                    state.cam.panX += 50;
                    requestRender();
                    break;
                case 'arrowright':
                    e.preventDefault();
                    state.cam.panX -= 50;
                    requestRender();
                    break;
                case 'arrowup':
                    e.preventDefault();
                    state.cam.panY += 50;
                    requestRender();
                    break;
                case 'arrowdown':
                    e.preventDefault();
                    state.cam.panY -= 50;
                    requestRender();
                    break;
                case 's':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        saveConfig();
                    }
                    break;
                case 'o':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        loadConfig();
                    }
                    break;
                case 'e':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        exportToJSON();
                    }
                    break;
                case 'i':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        importFromJSON();
                    }
                    break;
                case 'z':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        if (e.shiftKey) {
                            redo();
                        } else {
                            undo();
                        }
                    }
                    break;
                case 'y':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        redo();
                    }
                    break;
                case 'b':
                    if (e.ctrlKey || e.metaKey) return;
                    { const chk = document.getElementById('chk-bolts');
                      if (chk) { chk.checked = !chk.checked; chk.dispatchEvent(new Event('change')); }
                    }
                    break;
                case 'k':
                    if (e.ctrlKey || e.metaKey) return;
                    { const chk = document.getElementById('chk-brack');
                      if (chk) { chk.checked = !chk.checked; chk.dispatchEvent(new Event('change')); }
                    }
                    break;
                case 'm':
                    if (e.ctrlKey || e.metaKey) return;
                    { const chk = document.getElementById('chk-measure');
                      if (chk) { chk.checked = !chk.checked; chk.dispatchEvent(new Event('change')); }
                    }
                    break;
                case 'h':
                    if (e.ctrlKey || e.metaKey) return;
                    { const chk = document.getElementById('chk-human-scale');
                      if (chk) { chk.checked = !chk.checked; chk.dispatchEvent(new Event('change')); }
                    }
                    break;
                case 'p':
                    if (e.ctrlKey || e.metaKey) return;
                    { const chk = document.getElementById('chk-collide');
                      if (chk) { chk.checked = !chk.checked; chk.dispatchEvent(new Event('change')); }
                    }
                    break;
            }
        });
        
        // Checkbox event listeners
        document.getElementById('chk-collide').onchange = e => {
            state.enforceCollision = e.target.checked;
            // Invalidate cache when toggling collision enforcement
            invalidateGeometryCache();
            if (state.enforceCollision) {
                const data = solveLinkage(state.foldAngle);
                state.collisions = detectCollisions(data);
                state.hasCollision = state.collisions.length > 0;
            } else {
                state.collisions = [];
                state.hasCollision = false;
            }
            requestRender();
        };
        
        // Auto-resolve collision button
        /**
         * Finds the optimal fold angle where the ring just closes (total rotation = 360°)
         * Uses binary search to find the precise angle
         * @returns {number|null} The optimal fold angle in radians, or null if not found
         */
        
        document.getElementById('btn-auto-resolve').onclick = () => {
            if (!state.hasCollision) {
                showToast('No collisions to resolve', 'info');
                return;
            }
            
            // Check if this is a geometric overfold situation
            const hasGeometricOverfold = state.collisions.some(c => c.type === 'geometric-overfold');
            
            if (hasGeometricOverfold) {
                // Find the optimal angle where the ring just closes
                const optimalAngle = findOptimalClosedAngle();
                if (optimalAngle !== null) {
                    state.foldAngle = optimalAngle;
                    invalidateGeometryCache();
                    syncUI('foldAngle');
                    const data = solveLinkage(state.foldAngle);
                    state.collisions = detectCollisions(data);
                    state.hasCollision = state.collisions.length > 0;
                    requestRender();
                    showToast(`Set to optimal closed angle: ${formatNumber(radToDeg(optimalAngle), 1)}°`, 'info');
                    return;
                }
            }
            
            // For other collision types, search for nearest safe angle
            const currentAngle = state.foldAngle;
            let bestAngle = null;
            let bestDistance = Infinity;
            
            // Search upward (more extended)
            const safeUp = findSafeFoldAngle(currentAngle, currentAngle - 0.01);
            if (safeUp !== null) {
                const distUp = Math.abs(safeUp - currentAngle);
                if (distUp < bestDistance) {
                    bestAngle = safeUp;
                    bestDistance = distUp;
                }
            }
            
            // Search downward (more folded)
            const safeDown = findSafeFoldAngle(currentAngle, currentAngle + 0.01);
            if (safeDown !== null) {
                const distDown = Math.abs(safeDown - currentAngle);
                if (distDown < bestDistance) {
                    bestAngle = safeDown;
                    bestDistance = distDown;
                }
            }
            
            if (bestAngle !== null) {
                state.foldAngle = bestAngle;
                invalidateGeometryCache();
                syncUI('foldAngle');
                const data = solveLinkage(state.foldAngle);
                state.collisions = detectCollisions(data);
                state.hasCollision = state.collisions.length > 0;
                requestRender();
                showToast(`Resolved to ${formatNumber(radToDeg(bestAngle), 1)}°`, 'info');
            } else {
                showToast('Could not find a safe angle nearby', 'error');
            }
        };
        
        document.getElementById('chk-brack').onchange = e => {
            state.showBrackets = e.target.checked;
            requestRender();
        };
        document.getElementById('chk-bolts').onchange = e => {
            state.showBolts = e.target.checked;
            requestRender();
        };
        document.getElementById('chk-hw-full-detail').onchange = e => {
            state.showHardwareFullDetail = e.target.checked;
            invalidateGeometryCache();
            requestRender();
        };
        
        // Sun position controls (topbar)
        // Time of day slider
        document.getElementById('sl-sun-time').oninput = e => {
            const val = parseFloat(e.target.value);
            state.sunTime = val;
            updateSunPosition(); // This will also call updateSkyColor
            requestRender();
        };
        
        // Shadows toggle
        document.getElementById('chk-shadows').onchange = e => {
            state.shadowsEnabled = e.target.checked;
            updateSunPosition();
            updateGroundPlane();
            updateGridVisibility();
            
            // Enable/disable shadows on all meshes
            if (threeRenderer.beamGroup) {
                threeRenderer.beamGroup.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = state.shadowsEnabled;
                        child.receiveShadow = state.shadowsEnabled;
                    }
                });
            }
            if (threeRenderer.panelGroup) {
                threeRenderer.panelGroup.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = state.shadowsEnabled;
                        child.receiveShadow = state.shadowsEnabled;
                    }
                });
            }
            if (threeRenderer.bracketGroup) {
                threeRenderer.bracketGroup.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = state.shadowsEnabled;
                        child.receiveShadow = state.shadowsEnabled;
                    }
                });
            }
            if (threeRenderer.boltGroup) {
                threeRenderer.boltGroup.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = state.shadowsEnabled;
                        child.receiveShadow = state.shadowsEnabled;
                    }
                });
            }
            if (threeRenderer.hardwareAssemblyGroup) {
                threeRenderer.hardwareAssemblyGroup.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = state.shadowsEnabled;
                        child.receiveShadow = state.shadowsEnabled;
                    }
                });
            }
            if (threeRenderer.ibcReferenceGroup) {
                threeRenderer.ibcReferenceGroup.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = state.shadowsEnabled;
                        child.receiveShadow = state.shadowsEnabled;
                    }
                });
            }
            
            requestRender();
        };
        
        // Bracket configuration event handlers
        document.getElementById('sel-bracket-hole-diameter').onchange = e => {
            state.bracketHoleDiameter = parseFloat(e.target.value) || 0.375;
            invalidateHardwareCache();
            requestRender();
        };
        
        // Bracket Z-axis rotation handlers
        const slBracketZRot = document.getElementById('sl-bracket-z-rotation');
        const nbBracketZRot = document.getElementById('nb-bracket-z-rotation');
        if (slBracketZRot && nbBracketZRot) {
            slBracketZRot.oninput = e => {
                const value = parseFloat(e.target.value) || 0;
                state.bracketZRotation = value;
                nbBracketZRot.value = value;
                invalidateGeometryCache();
                requestRender();
            };
            nbBracketZRot.onchange = e => {
                const value = parseFloat(e.target.value) || 0;
                state.bracketZRotation = Math.max(-180, Math.min(180, value));
                slBracketZRot.value = state.bracketZRotation;
                invalidateGeometryCache();
                requestRender();
            };
        }
        
        // Update hole distance display when bracket gap changes (wrapped around existing handler)
        (function() {
            const slBrack = document.getElementById('sl-brack');
            const nbBrack = document.getElementById('nb-brack');
            if (slBrack && slBrack.oninput) {
                const originalHandler = slBrack.oninput;
                slBrack.oninput = function(e) {
                    originalHandler.call(this, e);
                    updateBracketHoleDistance();
                };
            }
            if (nbBrack && nbBrack.onchange) {
                const originalHandler = nbBrack.onchange;
                nbBrack.onchange = function(e) {
                    originalHandler.call(this, e);
                    updateBracketHoleDistance();
                };
            }
        })();
        
        // Bolt configuration event handlers
        document.getElementById('sel-bolt-diameter').onchange = e => {
            state.boltDiameter = parseFloat(e.target.value) || 0.375;
            invalidateHardwareCache();
            requestRender();
        };
        
        // V-bolt length - support both input (arrows) and change (typing)
        const handleVBoltLength = e => {
            if (!state.vBoltAuto) {
                state.vBoltLength = unitConverter.inputDisplayToImperial('nb-vbolt-length', parseFloat(e.target.value) || 3);
                invalidateGeometryCache();
                requestRender();
            }
        };
        const vBoltLengthEl = document.getElementById('nb-vbolt-length');
        if (vBoltLengthEl) {
            vBoltLengthEl.oninput = handleVBoltLength;
            vBoltLengthEl.onchange = handleVBoltLength;
        }
        
        // H-bolt length - support both input (arrows) and change (typing)
        const handleHBoltLength = e => {
            if (!state.hBoltAuto) {
                state.hBoltLength = unitConverter.inputDisplayToImperial('nb-hbolt-length', parseFloat(e.target.value) || 3);
                invalidateGeometryCache();
                requestRender();
            }
        };
        const hBoltLengthEl = document.getElementById('nb-hbolt-length');
        if (hBoltLengthEl) {
            hBoltLengthEl.oninput = handleHBoltLength;
            hBoltLengthEl.onchange = handleHBoltLength;
        }
        
        document.getElementById('chk-vbolt-auto').onchange = e => {
            state.vBoltAuto = e.target.checked;
            const input = document.getElementById('nb-vbolt-length');
            if (input) input.disabled = state.vBoltAuto;
            if (state.vBoltAuto) {
                updateAutoBoltLengths();
                invalidateGeometryCache();
                requestRender();
            }
        };
        
        document.getElementById('chk-hbolt-auto').onchange = e => {
            state.hBoltAuto = e.target.checked;
            const input = document.getElementById('nb-hbolt-length');
            if (input) input.disabled = state.hBoltAuto;
            if (state.hBoltAuto) {
                updateAutoBoltLengths();
                invalidateGeometryCache();
                requestRender();
            }
        };
        
        // H-pivot bolt length - support both input (arrows) and change (typing)
        const handleHPivotBoltLength = e => {
            if (!state.hPivotBoltAuto) {
                state.hPivotBoltLength = unitConverter.inputDisplayToImperial('nb-hpivot-bolt-length', parseFloat(e.target.value) || 4);
                invalidateGeometryCache();
                requestRender();
            }
        };
        const hPivotBoltLengthEl = document.getElementById('nb-hpivot-bolt-length');
        if (hPivotBoltLengthEl) {
            hPivotBoltLengthEl.oninput = handleHPivotBoltLength;
            hPivotBoltLengthEl.onchange = handleHPivotBoltLength;
        }
        
        document.getElementById('chk-hpivot-bolt-auto')?.addEventListener('change', e => {
            state.hPivotBoltAuto = e.target.checked;
            const input = document.getElementById('nb-hpivot-bolt-length');
            if (input) input.disabled = state.hPivotBoltAuto;
            if (state.hPivotBoltAuto) {
                updateAutoBoltLengths();
                invalidateGeometryCache();
                requestRender();
            }
        });
        
        // Inner/outer bolt length event handlers (for split mode)
        // Using 'input' event for real-time updates when using arrow buttons
        const handleVBoltInnerChange = e => {
            const autoChk = document.getElementById('chk-vbolt-inner-auto');
            if (autoChk && !autoChk.checked) {
                state.vBoltInnerLength = unitConverter.inputDisplayToImperial('nb-vbolt-inner-length', parseFloat(e.target.value) || 3);
                invalidateGeometryCache();
                requestRender();
            }
        };
        const vBoltInnerEl = document.getElementById('nb-vbolt-inner-length');
        if (vBoltInnerEl) {
            vBoltInnerEl.oninput = handleVBoltInnerChange;
            vBoltInnerEl.onchange = handleVBoltInnerChange;
        }
        
        const handleVBoltOuterChange = e => {
            const autoChk = document.getElementById('chk-vbolt-outer-auto');
            if (autoChk && !autoChk.checked) {
                state.vBoltOuterLength = unitConverter.inputDisplayToImperial('nb-vbolt-outer-length', parseFloat(e.target.value) || 2);
                invalidateGeometryCache();
                requestRender();
            }
        };
        const vBoltOuterEl = document.getElementById('nb-vbolt-outer-length');
        if (vBoltOuterEl) {
            vBoltOuterEl.oninput = handleVBoltOuterChange;
            vBoltOuterEl.onchange = handleVBoltOuterChange;
        }
        
        const chkVBoltInnerAuto = document.getElementById('chk-vbolt-inner-auto');
        if (chkVBoltInnerAuto) {
            chkVBoltInnerAuto.onchange = e => {
                const input = document.getElementById('nb-vbolt-inner-length');
                if (input) input.disabled = e.target.checked;
                if (e.target.checked) {
                    updateAutoBoltLengths();
                    invalidateGeometryCache();
                    requestRender();
                }
            };
        }
        
        const chkVBoltOuterAuto = document.getElementById('chk-vbolt-outer-auto');
        if (chkVBoltOuterAuto) {
            chkVBoltOuterAuto.onchange = e => {
                const input = document.getElementById('nb-vbolt-outer-length');
                if (input) input.disabled = e.target.checked;
                if (e.target.checked) {
                    updateAutoBoltLengths();
                    invalidateGeometryCache();
                    requestRender();
                }
            };
        }
        
        // Bolt cost event handlers - using both 'input' and 'change' for arrow button support
        const handleCostBoltV = e => {
            const val = parseFloat(e.target.value) || 0.75;
            state.costBoltVInner = val;
            state.costBoltVOuter = val;
            requestRender();
        };
        document.getElementById('nb-cost-bolt-v')?.addEventListener('input', handleCostBoltV);
        document.getElementById('nb-cost-bolt-v')?.addEventListener('change', handleCostBoltV);
        
        const handleCostBoltH = e => {
            state.costBoltH = parseFloat(e.target.value) || 0.75;
            requestRender();
        };
        document.getElementById('nb-cost-bolt-h')?.addEventListener('input', handleCostBoltH);
        document.getElementById('nb-cost-bolt-h')?.addEventListener('change', handleCostBoltH);
        
        const handleCostBoltVInner = e => {
            state.costBoltVInner = parseFloat(e.target.value) || 0.75;
            requestRender();
        };
        document.getElementById('nb-cost-bolt-vinner')?.addEventListener('input', handleCostBoltVInner);
        document.getElementById('nb-cost-bolt-vinner')?.addEventListener('change', handleCostBoltVInner);
        
        const handleCostBoltVOuter = e => {
            state.costBoltVOuter = parseFloat(e.target.value) || 0.50;
            requestRender();
        };
        document.getElementById('nb-cost-bolt-vouter')?.addEventListener('input', handleCostBoltVOuter);
        document.getElementById('nb-cost-bolt-vouter')?.addEventListener('change', handleCostBoltVOuter);
        
        const handleCostBoltH2 = e => {
            state.costBoltH = parseFloat(e.target.value) || 0.75;
            requestRender();
        };
        document.getElementById('nb-cost-bolt-h2')?.addEventListener('input', handleCostBoltH2);
        document.getElementById('nb-cost-bolt-h2')?.addEventListener('change', handleCostBoltH2);
        
        const handleCostBoltHPivot = e => {
            state.costBoltHPivot = parseFloat(e.target.value) || 0.75;
            requestRender();
        };
        document.getElementById('nb-cost-bolt-hpivot')?.addEventListener('input', handleCostBoltHPivot);
        document.getElementById('nb-cost-bolt-hpivot')?.addEventListener('change', handleCostBoltHPivot);
        
        const handleCostBoltHPivot2 = e => {
            state.costBoltHPivot = parseFloat(e.target.value) || 0.75;
            requestRender();
        };
        document.getElementById('nb-cost-bolt-hpivot2')?.addEventListener('input', handleCostBoltHPivot2);
        document.getElementById('nb-cost-bolt-hpivot2')?.addEventListener('change', handleCostBoltHPivot2);
        
        // Washer event handlers
        document.getElementById('chk-vwasher-enabled')?.addEventListener('change', e => {
            state.vWasherEnabled = e.target.checked;
            const configDiv = document.getElementById('vwasher-config');
            if (configDiv) configDiv.style.display = e.target.checked ? 'block' : 'none';
            invalidateGeometryCache();
            requestRender();
        });
        
        document.getElementById('chk-hwasher-enabled')?.addEventListener('change', e => {
            state.hWasherEnabled = e.target.checked;
            const configDiv = document.getElementById('hwasher-config');
            if (configDiv) configDiv.style.display = e.target.checked ? 'block' : 'none';
            invalidateGeometryCache();
            requestRender();
        });
        
        // V-washer inputs
        document.getElementById('nb-vwasher-id')?.addEventListener('input', e => {
            state.vWasherID = unitConverter.inputDisplayToImperial('nb-vwasher-id', parseFloat(e.target.value) || 0.4375);
            invalidateGeometryCache();
            requestRender();
        });
        document.getElementById('nb-vwasher-id')?.addEventListener('change', e => {
            state.vWasherID = unitConverter.inputDisplayToImperial('nb-vwasher-id', parseFloat(e.target.value) || 0.4375);
            invalidateGeometryCache();
            requestRender();
        });
        
        document.getElementById('nb-vwasher-od')?.addEventListener('input', e => {
            state.vWasherOD = unitConverter.inputDisplayToImperial('nb-vwasher-od', parseFloat(e.target.value) || 1.0);
            invalidateGeometryCache();
            requestRender();
        });
        document.getElementById('nb-vwasher-od')?.addEventListener('change', e => {
            state.vWasherOD = unitConverter.inputDisplayToImperial('nb-vwasher-od', parseFloat(e.target.value) || 1.0);
            invalidateGeometryCache();
            requestRender();
        });
        
        const handleVWasherThickness = e => {
            const rawVal = parseFloat(e.target.value) || 0;
            const val = unitConverter.inputDisplayToImperial('nb-vwasher-thickness', rawVal);
            state.vWasherThickness = Math.max(0, val);
            
            // Update stack gap to match washer thickness (washer should fill the gap)
            state.vStackGap = state.vWasherThickness;
            const vStackGapInput = document.getElementById('nb-vgap');
            if (vStackGapInput) vStackGapInput.value = state.vStackGap.toFixed(3);
            syncUI('vStackGap');
            
            invalidateGeometryCache();
            requestRender();
        };
        document.getElementById('nb-vwasher-thickness')?.addEventListener('input', handleVWasherThickness);
        document.getElementById('nb-vwasher-thickness')?.addEventListener('change', handleVWasherThickness);
        
        document.getElementById('chk-vwasher-auto')?.addEventListener('change', e => {
            state.vWasherAuto = e.target.checked;
            const input = document.getElementById('nb-vwasher-thickness');
            if (input) input.disabled = state.vWasherAuto;
            if (state.vWasherAuto) {
                // Auto mode: recalculate thickness based on bracket inner width
                // This also updates stack gap to achieve perfect fit
                updateAutoBoltLengths();
            } else {
                // Switching to manual mode: keep current values
                // If thickness was 0, set a reasonable default based on current gap
                if (state.vWasherThickness <= 0 && state.vStackGap > 0) {
                    state.vWasherThickness = state.vStackGap;
                    if (input) input.value = state.vWasherThickness.toFixed(3);
                }
            }
            invalidateGeometryCache();
            requestRender();
        });
        
        // H-washer inputs
        document.getElementById('nb-hwasher-id')?.addEventListener('input', e => {
            state.hWasherID = unitConverter.inputDisplayToImperial('nb-hwasher-id', parseFloat(e.target.value) || 0.4375);
            invalidateGeometryCache();
            requestRender();
        });
        document.getElementById('nb-hwasher-id')?.addEventListener('change', e => {
            state.hWasherID = unitConverter.inputDisplayToImperial('nb-hwasher-id', parseFloat(e.target.value) || 0.4375);
            invalidateGeometryCache();
            requestRender();
        });
        
        document.getElementById('nb-hwasher-od')?.addEventListener('input', e => {
            state.hWasherOD = unitConverter.inputDisplayToImperial('nb-hwasher-od', parseFloat(e.target.value) || 1.0);
            invalidateGeometryCache();
            requestRender();
        });
        document.getElementById('nb-hwasher-od')?.addEventListener('change', e => {
            state.hWasherOD = unitConverter.inputDisplayToImperial('nb-hwasher-od', parseFloat(e.target.value) || 1.0);
            invalidateGeometryCache();
            requestRender();
        });
        
        const handleHWasherThickness = e => {
            const rawVal = parseFloat(e.target.value) || 0;
            const val = unitConverter.inputDisplayToImperial('nb-hwasher-thickness', rawVal);
            state.hWasherThickness = Math.max(0, val);
            
            // Update stack gap to match washer thickness
            state.hStackGap = state.hWasherThickness;
            const hStackGapInput = document.getElementById('nb-hgap');
            if (hStackGapInput) hStackGapInput.value = state.hStackGap.toFixed(3);
            syncUI('hStackGap');
            
            invalidateGeometryCache();
            requestRender();
        };
        document.getElementById('nb-hwasher-thickness')?.addEventListener('input', handleHWasherThickness);
        document.getElementById('nb-hwasher-thickness')?.addEventListener('change', handleHWasherThickness);
        
        document.getElementById('chk-hwasher-auto')?.addEventListener('change', e => {
            state.hWasherAuto = e.target.checked;
            const input = document.getElementById('nb-hwasher-thickness');
            if (input) input.disabled = state.hWasherAuto;
            if (state.hWasherAuto) {
                // Auto mode: sync thickness to current stack gap
                state.hWasherThickness = state.hStackGap || 0;
                if (input) input.value = state.hWasherThickness.toFixed(3);
            } else {
                // Switching to manual mode: keep current values
                // If thickness was 0, set a reasonable default based on current gap
                if (state.hWasherThickness <= 0 && state.hStackGap > 0) {
                    state.hWasherThickness = state.hStackGap;
                    if (input) input.value = state.hWasherThickness.toFixed(3);
                }
            }
            invalidateGeometryCache();
            requestRender();
        });
        
        // Washer cost handlers
        const handleCostWasherV = e => {
            state.costWasherV = parseFloat(e.target.value) || 0.10;
            requestRender();
        };
        document.getElementById('nb-cost-washer-v')?.addEventListener('input', handleCostWasherV);
        document.getElementById('nb-cost-washer-v')?.addEventListener('change', handleCostWasherV);
        
        const handleCostWasherH = e => {
            state.costWasherH = parseFloat(e.target.value) || 0.10;
            requestRender();
        };
        document.getElementById('nb-cost-washer-h')?.addEventListener('input', handleCostWasherH);
        document.getElementById('nb-cost-washer-h')?.addEventListener('change', handleCostWasherH);
        
        document.getElementById('sel-orientation').onchange = e => {
            state.orientation = e.target.value;
            const isVertical = e.target.value === 'vertical';
            // Show/hide arch-specific options based on orientation
            document.getElementById('cap-upright-row').style.display = isVertical ? 'flex' : 'none';
            document.getElementById('arch-orientation-group').style.display = isVertical ? 'block' : 'none';
            // Update solar panel UI for arch vs cylinder mode
            updateArchWallFacesUI();
            invalidateGeometryCache();
            requestRender();
        };
        document.getElementById('chk-cap-uprights').onchange = e => {
            state.archCapUprights = e.target.checked;
            invalidateGeometryCache();
            requestRender();
        };
        
        document.getElementById('chk-fixed-beams').onchange = e => {
            state.useFixedBeams = e.target.checked;
            // Reset fixed beam length and height when toggling to recalculate at current angle
            if (state.useFixedBeams) {
                state.fixedBeamLength = null; // Will be calculated on next render
                state.fixedBeamHeight = null; // Will be calculated on next render
            }
            invalidateGeometryCache();
            requestRender();
        };
        document.getElementById('chk-arch-flip').onchange = e => {
            state.archFlipVertical = e.target.checked;
            invalidateGeometryCache();
            requestRender();
        };
        document.getElementById('sl-arch-rotation').oninput = e => {
            const val = parseFloat(e.target.value) || 0;
            state.archRotation = val;
            document.getElementById('nb-arch-rotation').value = val;
            invalidateGeometryCache();
            requestRender();
        };
        document.getElementById('nb-arch-rotation').onchange = e => {
            let val = parseFloat(e.target.value) || 0;
            val = Math.max(-180, Math.min(180, val));
            state.archRotation = val;
            document.getElementById('sl-arch-rotation').value = val;
            e.target.value = val;
            invalidateGeometryCache();
            requestRender();
        };
        
        // Structure rotation event handlers
        document.getElementById('sl-structure-rotation').oninput = e => {
            const val = parseFloat(e.target.value) || 0;
            state.structureRotation = val;
            document.getElementById('nb-structure-rotation').value = val;
            requestRender(); // No geometry invalidation needed - rotation applied at render time
        };
        document.getElementById('nb-structure-rotation').onchange = e => {
            let val = parseFloat(e.target.value) || 0;
            val = Math.max(-180, Math.min(180, val));
            state.structureRotation = val;
            document.getElementById('sl-structure-rotation').value = val;
            e.target.value = val;
            requestRender();
        };
        
        // Actuator analysis button
        document.getElementById('btn-analyze-actuators').onclick = () => {
            const data = buildLinkageGeometry({ includeSupportBeams: true, includePanels: true, useCache: false });
            
            // Get structure center
            data.structureCenter = data.structureCenter || { x: 0, y: 0, z: 0 };
            
            // Find optimal actuator placements
            const recommendations = findOptimalActuatorPlacements(data, {
                maxActuators: 5,
                maxForce: 2000,
                preferredLocations: 'all'
            });
            
            // Display recommendations
            const contentEl = document.getElementById('actuator-recommendations-content');
            if (recommendations.length === 0) {
                contentEl.innerHTML = '<div style="color: var(--text-muted); padding: 8px; text-align: center;">No suitable actuator placements found</div>';
                return;
            }
            
            // Store recommendations in state for visualization
            state.actuatorRecommendations = recommendations;
            
            let html = '';
            recommendations.forEach((rec, idx) => {
                const statusClass = rec.recommended ? 'style="color: #2ecc71;"' : 'style="color: #e74c3c;"';
                const statusText = rec.recommended ? '✓ Recommended' : '⚠ High Force';
                const badge = idx === 0 ? '<span style="background: #f39c12; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.7rem; margin-left: 6px;">BEST</span>' : '';
                const isSelected = state.selectedActuator && state.selectedActuator.name === rec.name;
                const selectedStyle = isSelected ? 'background: rgba(0,255,0,0.1); border-left: 3px solid #00ff00;' : '';
                
                html += `
                    <div class="actuator-recommendation-item" data-actuator-index="${idx}" style="margin-bottom: 12px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 4px; border-left: 3px solid ${idx === 0 ? '#f39c12' : rec.recommended ? '#2ecc71' : '#e74c3c'}; cursor: pointer; ${selectedStyle}" onclick="selectActuator(${idx})">
                        <div style="font-weight: 600; margin-bottom: 6px; font-size: 0.85rem;">
                            ${rec.name}${badge} ${isSelected ? '<span style="color: #00ff00;">●</span>' : ''}
                        </div>
                        <div style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 8px; font-style: italic;">
                            ${rec.description || ''}
                        </div>
                        <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 6px;">
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                                <div>Force Rating:</div>
                                <div style="color: white; font-weight: 600;">${unitConverter.formatForceWithUnit(rec.forceRating || rec.maxForce, 0)}</div>
                                <div>Max Force:</div>
                                <div style="color: white;">${unitConverter.formatForceWithUnit(rec.maxForce, 0)}</div>
                                <div>Min Force:</div>
                                <div style="color: white;">${unitConverter.formatForceWithUnit(rec.minForce, 0)}</div>
                                <div>Avg Force:</div>
                                <div style="color: white;">${unitConverter.formatForceWithUnit(rec.avgForce, 0)}</div>
                                <div>Stroke Length:</div>
                                <div style="color: white;">${unitConverter.formatDimensionWithUnit(rec.stroke || rec.maxStroke, 1)}</div>
                                <div>Min Length:</div>
                                <div style="color: white;">${unitConverter.formatDimensionWithUnit(rec.minStroke, 1)}</div>
                                <div>Max Length:</div>
                                <div style="color: white;">${unitConverter.formatDimensionWithUnit(rec.maxStroke, 1)}</div>
                                <div>Mech. Advantage:</div>
                                <div style="color: white;">${formatNumber(rec.mechanicalAdvantage, 2)}x</div>
                            </div>
                        </div>
                        <div style="font-size: 0.7rem; margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.1);" ${statusClass}>
                            ${statusText} • Efficiency: ${formatNumber(rec.efficiency, 1)}%
                        </div>
                    </div>
                `;
            });
            
            contentEl.innerHTML = html;
            
            showToast(`Found ${recommendations.length} actuator placement option${recommendations.length !== 1 ? 's' : ''}`, 'info');
        };
        
        /**
         * Selects an actuator recommendation and highlights it in the 3D view
         * @param {number} index - Index of the actuator recommendation to select
         */
        
        /**
         * Animates the structure folding/unfolding with actuator simulation
         * Uses basic physics to smoothly transition between fold angles
         * @param {number} targetAngle - Target fold angle in radians
         * @param {number} duration - Animation duration in milliseconds
         */
        document.getElementById('btn-actuator-open').onclick = () => {
            const openAngle = MIN_FOLD_ANGLE;
            animateActuatorFold(openAngle, 3000);
            document.getElementById('btn-actuator-stop').style.display = 'block';
        };
        
        document.getElementById('btn-actuator-close').onclick = () => {
            const closedAngle = getOptimalClosedAngleForAnimation();
            animateActuatorFold(closedAngle, 3000);
            document.getElementById('btn-actuator-stop').style.display = 'block';
        };
        
        document.getElementById('btn-actuator-stop').onclick = () => {
            stopActuatorAnimation();
            document.getElementById('btn-actuator-stop').style.display = 'none';
        };
        
        document.getElementById('btn-arch-reset').onclick = () => {
            state.archFlipVertical = false;
            state.archRotation = 0;
            document.getElementById('chk-arch-flip').checked = false;
            document.getElementById('sl-arch-rotation').value = 0;
            document.getElementById('nb-arch-rotation').value = 0;
            invalidateGeometryCache();
            requestRender();
        };
        document.getElementById('sl-array-count').oninput = e => {
            const val = parseInt(e.target.value) || 1;
            state.arrayCount = val;
            document.getElementById('nb-array-count').value = val;
            invalidateGeometryCache();
            requestRender();
        };
        document.getElementById('nb-array-count').onchange = e => {
            let val = parseInt(e.target.value) || 1;
            val = Math.max(1, Math.min(10, val));
            state.arrayCount = val;
            document.getElementById('sl-array-count').value = val;
            e.target.value = val;
            invalidateGeometryCache();
            requestRender();
        };
        document.getElementById('chk-vstack-reverse').onchange = e => {
            state.vStackReverse = e.target.checked;
            invalidateGeometryCache();
            requestRender();
        };
        document.getElementById('btn-vbeam-dim-link')?.addEventListener('click', () => {
            if (!needsSplitVBeamDimensions()) return;
            state.vBeamDimensionsLinked = !isVBeamDimensionsLinked();
            syncLinkedVBeamDimensions();
            ['vBeamW', 'vBeamT', 'vBeamInnerW', 'vBeamInnerT', 'vBeamOuterW', 'vBeamOuterT'].forEach(k => syncUI(k));
            updateVBeamDimensionUIVisibility();
            updateAutoBoltLengths();
            if (state.autoLumberPricing) updateAutoBeamPricing();
            invalidateGeometryCache();
            saveStateToHistory();
            requestRender();
        });
        // Measurement / IBC reference handlers - js/linkage/reference-input.js
        
        
        // Solar panel event handlers - js/linkage/solar-panel-input.js
        
        
        // Support beams master toggle (all support + reciprocal beams)
        document.getElementById('chk-support-beams').onchange = e => {
            state.supportBeams.enabled = e.target.checked;
            document.getElementById('support-beam-controls').style.display = e.target.checked ? 'block' : 'none';
            invalidateGeometryCache();
            requestRender();
        };
        
        // Radial support beams sub-toggle (independent of reciprocal beams)
        document.getElementById('chk-support-radial').onchange = e => {
            state.supportBeams.showRadial = e.target.checked;
            const div = document.getElementById('support-radial-controls');
            if (div) div.style.display = e.target.checked ? 'block' : 'none';
            invalidateGeometryCache();
            requestRender();
        };
        
        bindSupportBeamControl('sl-support-length', 'nb-support-length', 'length', {def: 120, min: 12, max: 360});
        bindSupportBeamControl('sl-support-width', 'nb-support-width', 'width', {def: 1.5, min: 0.5, max: 12});
        bindSupportBeamControl('sl-support-thickness', 'nb-support-thickness', 'thickness', {def: 3.5, min: 0.5, max: 12});
        bindSupportBeamControl('sl-support-rotation', 'nb-support-rotation', 'rotation', {def: 0, min: -180, max: 180});
        bindSupportBeamControl('sl-support-offset-h', 'nb-support-offset-h', 'offsetH', {def: -46.5, min: -240, max: 240});
        bindSupportBeamControl('sl-support-offset-v', 'nb-support-offset-v', 'offsetV', {def: -6.8, min: -240, max: 240});
        bindSupportBeamControl('sl-rcp-length', 'nb-rcp-length', 'parallelLength', {def: 96, min: 12, max: 360});
        bindSupportBeamControl('sl-rcp-width', 'nb-rcp-width', 'parallelWidth', {def: 2.5, min: 0.5, max: 12});
        bindSupportBeamControl('sl-rcp-thickness', 'nb-rcp-thickness', 'parallelThickness', {def: 1.5, min: 0.5, max: 12});
        bindSupportBeamControl('sl-rcp-swing', 'nb-rcp-swing', 'parallelSwingAngle', {def: 0, min: -180, max: 180});
        bindSupportBeamControl('sl-rcp-voffset', 'nb-rcp-voffset', 'parallelOffsetV', {def: 4.5, min: -120, max: 120});
        bindSupportBeamControl('sl-rcp-anchor-dist', 'nb-rcp-anchor-dist', 'anchorDist', {def: 20, min: 0, max: 240});
        bindSupportBeamControl('sl-support-ab-offset', 'nb-support-ab-offset', 'parallelVOffset', {def: -1.66, min: -24, max: 24});
        bindSupportBeamControl('sl-rcp-end-offset', 'nb-rcp-end-offset', 'rcpEndOffset', {def: 0, min: -12, max: 24});
        
        syncSupportBeamsUIFromState();
        
        // Reciprocal parallel beams toggle
        document.getElementById('chk-support-parallel').onchange = e => {
            state.supportBeams.parallelEnabled = e.target.checked;
            document.getElementById('support-parallel-controls').style.display = e.target.checked ? 'block' : 'none';
            invalidateGeometryCache();
            requestRender();
        };
        
        // Reciprocal kinematic solver toggle
        
        /** Rebuild the folding-pivot hole dropdown to match the number of baked crossing holes. */
        
        document.getElementById('chk-rcp-kinematic').onchange = e => {
            state.supportBeams.rcpKinematicMode = e.target.checked;
            if (e.target.checked) invalidateRcpCrossings();
            applyRcpKinematicUI(e.target.checked);
            invalidateGeometryCache();
            requestRender();
        };
        applyRcpKinematicUI(!!state.supportBeams.rcpKinematicMode);
        
        // Folding-pivot hole selector: which baked crossing bolt is the engaged folding pivot.
        (function bindRcpPivotHole() {
            const sel = document.getElementById('sel-rcp-pivot-hole');
            if (!sel) return;
            sel.onchange = e => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) {
                    state.supportBeams.rcpActiveHole = v;
                    state.supportBeams._lastPhi = null; // restart continuation from the new pivot
                    invalidateGeometryCache();
                    requestRender();
                }
            };
        })();
        
        document.getElementById('chk-anim-loop').onchange = e => {
            state.animation.loop = e.target.checked;
            // If enabling loop, disable ping-pong
            if (e.target.checked) {
                document.getElementById('chk-anim-pingpong').checked = false;
                state.animation.pingPong = false;
            }
        };
        document.getElementById('chk-high-contrast').onchange = e => {
            document.body.classList.toggle('high-contrast', e.target.checked);
        };
        
        // Button event listeners
        document.getElementById('btn-reset').onclick = () => location.reload();
        document.getElementById('btn-fit').onclick = () => {
            state.cam = { yaw: 0.4, pitch: 0.14, dist: DEFAULT_CAM_DIST, panX: 0, panY: 0 };
            requestRender();
        };
        
        // Topbar animation controls
        document.getElementById('chk-anim-pingpong-top').onchange = e => {
            state.animation.pingPong = e.target.checked;
            // Sync with sidebar checkbox if it exists
            const sidebarChk = document.getElementById('chk-anim-pingpong');
            if (sidebarChk) sidebarChk.checked = e.target.checked;
        };
        document.getElementById('nb-anim-stop-top').onchange = e => {
            let val = parseFloat(e.target.value) || 135;
            val = Math.max(0, Math.min(180, val));
            state.animation.stopAngle = val;
            e.target.value = val;
            // Sync with sidebar inputs if they exist
            const sidebarSlider = document.getElementById('sl-anim-stop');
            const sidebarNumber = document.getElementById('nb-anim-stop');
            if (sidebarSlider) sidebarSlider.value = val;
            if (sidebarNumber) sidebarNumber.value = val;
        };
        
        // Topbar Save/Export buttons - mode-aware
        document.getElementById('btn-save-top').onclick = () => {
            if (currentAppMode === 'solar' && typeof SolarDesigner !== 'undefined') {
                // Save unified config in solar mode
                saveUnifiedConfig();
            } else {
                // Save linkage config
                saveConfig();
            }
        };
        document.getElementById('btn-load-top').onclick = () => {
            if (currentAppMode === 'solar' && typeof SolarDesigner !== 'undefined') {
                // Load unified config in solar mode
                loadUnifiedConfig();
            } else {
                // Load linkage config
                loadConfig();
            }
        };
        document.getElementById('btn-export-json-top').onclick = () => {
            if (currentAppMode === 'solar' && typeof SolarDesigner !== 'undefined') {
                // Export unified config in solar mode
                exportUnifiedConfig();
            } else {
                // Export linkage config
                exportToJSON();
            }
        };
        // Unit system toggle button
        document.getElementById('btn-unit-system').onclick = () => {
            const current = unitConverter.getPreferredUnitSystem();
            const newSystem = current === 'metric' ? 'imperial' : 'metric';
            unitConverter.setPreferredUnitSystem(newSystem);
        
            // Update button visual indicator
            const btn = document.getElementById('btn-unit-system');
            if (btn) btn.title = `Toggle Unit System (${newSystem === 'metric' ? 'Metric' : 'Imperial'} active)`;
        
            // Apply unit system to all UI elements
            unitConverter.applyUnitSystemToUI();
        
            // Re-sync all idMap-connected inputs with converted values
            Object.keys(idMap).forEach(k => syncUI(idMap[k]));
        
            // Show toast notification
            showToast(`Switched to ${newSystem === 'metric' ? 'Metric (m / mm / kg)' : 'Imperial (ft / in / lbs)'}`, 'info');
        
            // Force immediate render for instant feedback
            if (typeof render === 'function') {
                renderPending = false;
                render();
            }
        };
        
        // Initialize unit system on page load
        (function() {
            // Store original imperial input properties before any conversion
            unitConverter.storeOriginalInputProps();
        
            // Apply the current unit system (respects saved preference)
            const system = unitConverter.getPreferredUnitSystem();
            if (system === 'metric') {
                unitConverter.applyUnitSystemToUI();
                Object.keys(idMap).forEach(k => syncUI(idMap[k]));
            }
        
            const label = document.getElementById('unit-system-label');
            if (label) {
                label.textContent = system === 'metric' ? 'Metric' : 'Imperial';
            }
        })();
        
        document.getElementById('btn-import-json-top').onclick = () => {
            if (currentAppMode === 'solar' && typeof SolarDesigner !== 'undefined') {
                // Import unified config in solar mode
                importUnifiedConfig();
            } else {
                // Import linkage config
                importFromJSON();
            }
        };
        
        // GLTF/GLB 3D model export button
        document.getElementById('btn-export-gltf').onclick = () => {
            showGLTFExportDialog();
        };
        
        document.getElementById('btn-build-guide-top').onclick = showBuildGuide;
        
        // Hardware Assembly Detail wiring
        (function wireHardwareDetail() {
            const btn = document.getElementById('btn-hardware-detail-top');
            if (btn) btn.onclick = openHardwareDetail;
            window.addEventListener('resize', () => { if (document.getElementById('hardware-detail-modal')?.classList.contains('visible')) resizeHardwareDetail(); });
            document.addEventListener('click', (e) => { if (e.target.id === 'hardware-detail-modal') closeHardwareDetail(); });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && document.getElementById('hardware-detail-modal')?.classList.contains('visible')) closeHardwareDetail();
            });
        })();
        
        // Unified config functions for Solar mode
        
        
        
        
        
        // Preset buttons
        document.getElementById('btn-save-preset').onclick = savePreset;
        document.getElementById('btn-delete-preset').onclick = deletePreset;
        document.getElementById('preset-select').onchange = e => {
            if (e.target.value) loadPreset(e.target.value);
        };
        
        // Animation controls
        document.getElementById('btn-anim-play').onclick = () => {
            if (hasFoldingSolarPanels()) {
                state.animation.foldingPanelPhase = 'idle';
                state.animation.foldingPanelDeploy = 0;
                state.animation.foldingPanelDeployStart = 0;
                state.animation.foldingPanelsUnfoldPhase = false;
                if (state.foldAngle <= getStructureFoldedAngle() + degToRad(1.5)) {
                    state.animation.foldingPanelPhase = 'stowed';
                    state.animation.foldingPanelsUnfoldPhase = true;
                }
            }
            state.animation.playing = true;
            state.animation.lastTime = 0; // Reset delta time tracking
            updateAnimationStatus();
            requestAnimationFrame(animateFold);
        };
        document.getElementById('btn-anim-pause').onclick = () => {
            state.animation.playing = false;
            if (state.animation.frameId) {
                cancelAnimationFrame(state.animation.frameId);
            }
            updateAnimationStatus();
            requestRender();
        };
        document.getElementById('btn-anim-reverse').onclick = () => {
            state.animation.direction *= -1;
            updateAnimationStatus();
            showToast(`Animation direction: ${state.animation.direction > 0 ? 'Expanding' : 'Collapsing'}`, 'info');
        };
        
        // Fold/Unfold buttons (similar to Actuator Open/Close)
        document.getElementById('btn-anim-fold').onclick = () => {
            if (hasFoldingSolarPanels()) {
                runFoldingPanelFoldSequence(3000);
            } else {
                animateActuatorFold(getStructureFoldedAngle(), 3000);
            }
            showToast('Folding to closed position...', 'info');
        };
        document.getElementById('btn-anim-unfold').onclick = () => {
            if (hasFoldingSolarPanels()) {
                runFoldingPanelUnfoldSequence(3000);
            } else {
                animateActuatorFold(getStructureDeployedAngle(), 3000);
            }
            showToast('Unfolding to open position...', 'info');
        };
        document.getElementById('sl-anim-speed').addEventListener('input', e => {
            state.animation.speed = parseFloat(e.target.value);
        });
        document.getElementById('chk-anim-pingpong').onchange = e => {
            state.animation.pingPong = e.target.checked;
            // If enabling ping-pong, disable regular loop
            if (e.target.checked) {
                document.getElementById('chk-anim-loop').checked = false;
                state.animation.loop = false;
            }
        };
        document.getElementById('sl-anim-stop').oninput = e => {
            const val = parseFloat(e.target.value) || null;
            state.animation.stopAngle = val;
            document.getElementById('nb-anim-stop').value = val;
        };
        document.getElementById('nb-anim-stop').onchange = e => {
            let val = parseFloat(e.target.value);
            if (isNaN(val) || val < 5 || val > 175) {
                // Reset to closed angle if invalid
                const closedAngle = radToDeg(getOptimalClosedAngleForAnimation());
                val = closedAngle;
                e.target.value = val;
                document.getElementById('sl-anim-stop').value = val;
            }
            state.animation.stopAngle = val;
            document.getElementById('sl-anim-stop').value = val;
        };
        
        // Component appearance angle bindings
        (function bindAnimAngle(slId, nbId, stateKey, def) {
            const sl = document.getElementById(slId);
            const nb = document.getElementById(nbId);
            const update = val => {
                state.animation[stateKey] = val;
                invalidateGeometryCache();
                requestRender();
            };
            if (sl) sl.oninput = e => { const v = parseFloat(e.target.value); if (nb) nb.value = v; update(v); };
            if (nb) nb.onchange = e => {
                let v = parseFloat(e.target.value);
                if (isNaN(v)) v = def;
                v = Math.max(5, Math.min(175, v));
                e.target.value = v;
                if (sl) sl.value = v;
                update(v);
            };
        })('sl-anim-radial-angle', 'nb-anim-radial-angle', 'radialVisibleAngle', 90);
        
        (function bindAnimAngle(slId, nbId, stateKey, def) {
            const sl = document.getElementById(slId);
            const nb = document.getElementById(nbId);
            const update = val => {
                state.animation[stateKey] = val;
                invalidateGeometryCache();
                requestRender();
            };
            if (sl) sl.oninput = e => { const v = parseFloat(e.target.value); if (nb) nb.value = v; update(v); };
            if (nb) nb.onchange = e => {
                let v = parseFloat(e.target.value);
                if (isNaN(v)) v = def;
                v = Math.max(5, Math.min(175, v));
                e.target.value = v;
                if (sl) sl.value = v;
                update(v);
            };
        })('sl-anim-panels-angle', 'nb-anim-panels-angle', 'panelsVisibleAngle', 170);
        
        (function bindAnimAngle(slId, nbId, stateKey, def) {
            const sl = document.getElementById(slId);
            const nb = document.getElementById(nbId);
            const update = val => {
                state.animation[stateKey] = val;
                invalidateGeometryCache();
                requestRender();
            };
            if (sl) sl.oninput = e => { const v = parseFloat(e.target.value); if (nb) nb.value = v; update(v); };
            if (nb) nb.onchange = e => {
                let v = parseFloat(e.target.value);
                if (isNaN(v)) v = def;
                v = Math.max(5, Math.min(175, v));
                e.target.value = v;
                if (sl) sl.value = v;
                update(v);
            };
        })('sl-anim-rcp-angle', 'nb-anim-rcp-angle', 'rcpVisibleAngle', 90);
        
        // Min fold angle binding
        (function() {
            const sl = document.getElementById('sl-anim-min-fold');
            const nb = document.getElementById('nb-anim-min-fold');
            const autoLabel = document.getElementById('anim-min-fold-auto');
        
            // Populate auto label once the page is ready
            const refreshAutoLabel = () => {
                if (!autoLabel) return;
                try {
                    const autoDeg = radToDeg(computeMinFoldAngleVBeamOverlap());
                    autoLabel.textContent = `Auto (outer V-beam contact): ${autoDeg.toFixed(1)}°`;
                } catch (e) { /* geometry not ready yet */ }
            };
            // Defer until after first render so state is fully initialized
            setTimeout(refreshAutoLabel, 500);
        
            const update = val => {
                state.animation.minFoldAngle = val;
                invalidateGeometryCache();
                requestRender();
            };
            if (sl) sl.oninput = e => { const v = parseFloat(e.target.value); if (nb) nb.value = v; update(v); };
            if (nb) nb.onchange = e => {
                let v = parseFloat(e.target.value);
                if (isNaN(v)) v = 5;
                v = Math.max(5, Math.min(90, v));
                e.target.value = v;
                if (sl) sl.value = v;
                update(v);
            };
            // Expose so syncUI can call it after loading a config
            window._refreshMinFoldAutoLabel = refreshAutoLabel;
        })();
        
        // Undo/Redo buttons
        document.getElementById('btn-undo').onclick = undo;
        document.getElementById('btn-redo').onclick = redo;
        
        // Sidebar toggle
        document.getElementById('sidebar-toggle').onclick = () => {
            const sidebar = document.getElementById('sidebar');
            const toggle = document.getElementById('sidebar-toggle');
            sidebar.classList.toggle('collapsed');
            toggle.textContent = sidebar.classList.contains('collapsed') ? '▶' : '◀';
        };
        
        // Canvas click handler (reserved for future use)
        canvas.onclick = e => {
            // Currently no click functionality needed
        };
        
        
        
        // Lazy-load Solar Designer stack (D3 + solar modules) — not needed for linkage-only use.
        
        
        
        // ============================================
        // MODE SWITCHING
        // ============================================
        
        
        
        
        // Sync solar panels from linkage mode to solar designer
        // This preserves all non-panel components (batteries, controllers, loads, wires)
        
        // Helper to check if panel specs have changed
        
        // Debounced panel sync - called when panel config changes in linkage mode
        
        // Register this function so it can be called from panel config event handlers
        
        // Mode toggle button handlers
        document.getElementById('btn-mode-linkage').onclick = switchToLinkageMode;
        document.getElementById('btn-mode-solar').onclick = exportToSolarSimulator;
        
    }


const _moduleExports = {
    findOptimalClosedAngle,
    selectActuator,
    bindSupportBeamControl,
    syncSupportBeamsUIFromState,
    applyRcpKinematicUI,
    refreshRcpPivotHoleOptions,
    saveUnifiedConfig,
    loadUnifiedConfig,
    exportUnifiedConfig,
    importUnifiedConfig,
    applyUnifiedConfigToModes,
    loadScriptOnce,
    ensureSolarDesignerLoaded,
    switchToLinkageMode,
    switchToSolarMode,
    syncPanelsFromLinkageMode,
    panelConfigChanged,
    debouncedPanelSync,
    initUIBindings,
    currentAppMode,
};

    Object.defineProperty(globalThis, 'currentAppMode', {
        get() { return currentAppMode; },
        set(v) { currentAppMode = v; }
    });

bridgeGlobals(_moduleExports, 'uiBindings');

export { findOptimalClosedAngle, selectActuator, bindSupportBeamControl, syncSupportBeamsUIFromState, applyRcpKinematicUI, refreshRcpPivotHoleOptions, saveUnifiedConfig, loadUnifiedConfig, exportUnifiedConfig, importUnifiedConfig, applyUnifiedConfigToModes, loadScriptOnce, ensureSolarDesignerLoaded, switchToLinkageMode, switchToSolarMode, syncPanelsFromLinkageMode, panelConfigChanged, debouncedPanelSync, initUIBindings, currentAppMode };
