// ============================================================================
// LINKAGE LAB - JSON export/import and Solar Simulator bridge
// Depends on global: state, buildLinkageGeometry, getUnifiedConfig, applyConfig, showToast, attachGlbToLinkageExport, SolarDesigner
// ============================================================================
(function (g) {
    'use strict';

    function generateDefaultFilename() {
        const modules = state.modules;
        const mode = state.orientation === 'vertical' ? 'Arch' : 'Cylinder';
        
        // Count panels
        let panelCount = 0;
        if (state.solarPanels.enabled) {
            const data = buildLinkageGeometry({ includeSupportBeams: true, includePanels: true, useCache: false });
            panelCount = data.panels ? data.panels.length : 0;
        }
        
        // Build filename parts
        const parts = [`StarShade ${modules}m ${mode}`];
        if (panelCount > 0) {
            parts.push(`${panelCount}p`);
        }
        
        // Add solar designer component count if initialized
        if (typeof SolarDesigner !== 'undefined' && SolarDesigner.isInitialized()) {
            const items = SolarDesigner.getItems();
            const batteries = items.filter(i => i.type === 'battery' || i.type === 'smartbattery').length;
            const controllers = items.filter(i => i.type === 'controller').length;
            if (batteries > 0 || controllers > 0) {
                const extras = [];
                if (controllers > 0) extras.push(`${controllers}c`);
                if (batteries > 0) extras.push(`${batteries}b`);
                parts.push(extras.join(' '));
            }
        }
        
        return parts.join(' ');
    }
    
    /**
     * Collects unified configuration from all modes
     * @returns {Object} Unified configuration object
     */
    function getUnifiedConfig() {
        // Start with linkage mode config
        const config = getConfigSnapshot(true);
        
        // Add unified metadata
        config.appVersion = 'StarShade Linkage Lab v2.0';
        config.exportType = 'unified';
        
        // Calculate summary stats from the same observed geometry used by export/render.
        const data = buildLinkageGeometry({ includeSupportBeams: true, includePanels: true, useCache: false });
        let panelCount = 0;
        let totalWatts = 0;
        
        if (state.solarPanels.enabled) {
            panelCount = data.panels ? data.panels.length : 0;
            const panelConfig = getActivePanelConfig();
            totalWatts = panelCount * (panelConfig.ratedWatts || 0);
        }
        
        config.summary = {
            modules: state.modules,
            mode: state.orientation === 'vertical' ? 'arch' : 'cylinder',
            foldAngle: +radToDeg(state.foldAngle).toFixed(1),
            panelCount: panelCount,
            totalWatts: totalWatts,
            structureDimensions: {
                maxRadius: +(data.structureBounds?.maxRadius ?? data.maxRad).toFixed(1),
                maxHeight: +(data.structureBounds?.maxHeight ?? data.maxHeight).toFixed(1)
            }
        };
        
        // Add solar designer data if initialized
        if (typeof SolarDesigner !== 'undefined' && SolarDesigner.isInitialized()) {
            const items = SolarDesigner.getItems();
            const connections = SolarDesigner.getConnections();
            
            // Compact item representation - only essential data
            config.solarDesigner = {
                itemCount: items.length,
                connectionCount: connections.length,
                items: items.map(item => {
                    const compact = {
                        id: item.id,
                        type: item.type,
                        x: Math.round(item.x),
                        y: Math.round(item.y)
                    };
                    
                    // Add essential specs based on type
                    if (item.specs) {
                        if (item.type === 'panel') {
                            compact.specs = {
                                wmp: item.specs.wmp,
                                vmp: item.specs.vmp,
                                voc: item.specs.voc
                            };
                        } else if (item.type === 'battery' || item.type === 'smartbattery') {
                            compact.specs = {
                                name: item.specs.name,
                                voltage: item.specs.voltage,
                                ah: item.specs.ah,
                                kWh: item.specs.kWh
                            };
                        } else if (item.type === 'controller') {
                            compact.specs = {
                                name: item.specs.name,
                                maxPV: item.specs.maxPV,
                                maxBattery: item.specs.maxBattery
                            };
                        } else if (item.type === 'acload') {
                            compact.specs = {
                                name: item.specs.name,
                                watts: item.specs.watts
                            };
                        } else {
                            // For other types, include name only
                            compact.specs = { name: item.specs.name };
                        }
                    }
                    
                    return compact;
                }),
                // Compact connection representation
                connections: connections.map(conn => ({
                    id: conn.id,
                    src: conn.sourceItemId,
                    srcH: conn.sourceHandleKey,
                    tgt: conn.targetItemId,
                    tgtH: conn.targetHandleKey
                })),
                // Summary stats
                stats: {
                    panels: items.filter(i => i.type === 'panel').length,
                    batteries: items.filter(i => i.type === 'battery' || i.type === 'smartbattery').length,
                    controllers: items.filter(i => i.type === 'controller').length,
                    loads: items.filter(i => i.type === 'acload').length,
                    breakers: items.filter(i => i.type === 'acbreaker' || i.type === 'dcbreaker').length
                }
            };
        }
        
        return config;
    }
    
    /**
     * Shows export dialog with filename prompt
     */
    function exportToJSON() {
        const defaultName = generateDefaultFilename();
        
        // Create modal dialog
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
        
        const dialog = document.createElement('div');
        dialog.style.cssText = 'background:#1e2732;border-radius:8px;padding:24px;min-width:400px;max-width:500px;color:#e1e8ed;font-family:system-ui,sans-serif;';
        dialog.innerHTML = `
            <h3 style="margin:0 0 16px 0;font-size:1.2rem;">Export Configuration</h3>
            <p style="margin:0 0 12px 0;color:#8899a6;font-size:0.9rem;">Enter a filename for your configuration:</p>
            <input type="text" id="export-filename" value="${defaultName}" 
                   style="width:100%;padding:10px;border:1px solid #38444d;border-radius:4px;background:#15202b;color:#e1e8ed;font-size:1rem;box-sizing:border-box;">
            <p style="margin:8px 0 16px 0;color:#657786;font-size:0.8rem;">.json extension will be added automatically</p>
            <div style="display:flex;gap:12px;justify-content:flex-end;">
                <button id="export-cancel" style="padding:8px 16px;border:1px solid #38444d;border-radius:4px;background:transparent;color:#e1e8ed;cursor:pointer;">Cancel</button>
                <button id="export-confirm" style="padding:8px 16px;border:none;border-radius:4px;background:#1da1f2;color:white;cursor:pointer;font-weight:500;">Export</button>
            </div>
        `;
        
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        
        const filenameInput = document.getElementById('export-filename');
        filenameInput.focus();
        filenameInput.select();
        
        const doExport = () => {
            let filename = filenameInput.value.trim() || defaultName;
            // Sanitize filename
            filename = filename.replace(/[<>:"/\\|?*]/g, '-');
            if (!filename.endsWith('.json')) {
                filename += '.json';
            }
            
            const config = getUnifiedConfig();
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
            a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
            
            document.body.removeChild(overlay);
            showToast(`Exported: ${filename}`, 'info');
        };
        
        const doCancel = () => {
            document.body.removeChild(overlay);
        };
        
        document.getElementById('export-confirm').onclick = doExport;
        document.getElementById('export-cancel').onclick = doCancel;
        
        // Handle Enter key to confirm, Escape to cancel
        filenameInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                doExport();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                doCancel();
            }
        };
        
        // Close on overlay click
        overlay.onclick = (e) => {
            if (e.target === overlay) doCancel();
        };
    }
    
    /**
     * Imports configuration from a JSON file
     * Opens a file picker dialog and loads the selected JSON file
     */
    function importFromJSON() {
        // Create a hidden file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = event => {
                try {
                    const config = JSON.parse(event.target.result);
                    
                    // Validate it's a linkage config
                    if (!config || typeof config !== 'object') {
                        throw new Error('Invalid configuration format');
                    }
                    
                    // Apply the configuration
                    applyConfig(config);
                    saveStateToHistory();
    
                    // Save merged config (includes hardware assemblies + migrations)
                    localStorage.setItem('linkageLab_config', JSON.stringify(getConfigSnapshot()));
                    
                    showToast(`Configuration loaded from ${file.name}`, 'info');
                } catch (err) {
                    console.error('Error loading JSON config:', err);
                    showToast('Error loading configuration: ' + err.message, 'error');
                }
            };
            
            reader.onerror = () => {
                showToast('Error reading file', 'error');
            };
            
            reader.readAsText(file);
        };
        
        // Trigger file picker
        input.click();
    }
    
    /**
     * Serializes 3D geometry data for export to Solar Circuit Designer
     * @param {Object} data - Linkage data containing beams and panels
     * @returns {Object} Serialized geometry object
     */
    function serializeGeometry(data) {
        const isArchMode = state.orientation === 'vertical';
        const panelConfig = getActivePanelConfig();
        
        console.log('[serializeGeometry] Starting export:', {
            mode: isArchMode ? 'arch' : 'cylinder',
            beamCount: data.beams?.length || 0,
            panelCount: data.panels?.length || 0,
            structureRotation: state.structureRotation || 0
        });
        
        const geometry = {
            beams: [],
            panels: [],
            panelLayout: {
                mode: isArchMode ? 'arch' : state.solarPanels.layoutMode,
                gridRows: panelConfig.gridRows,
                gridCols: panelConfig.gridCols,
                paddingX: panelConfig.paddingX,
                paddingY: panelConfig.paddingY,
                panelWidth: panelConfig.panelWidth,
                panelLength: panelConfig.panelLength,
                isArchMode: isArchMode
            },
            bounds: { min: {x:0, y:0, z:0}, max: {x:0, y:0, z:0} }
        };
        
        // Serialize beams with orientation data for correct 3D rendering
        if (data.beams) {
            console.log('[serializeGeometry] Processing', data.beams.length, 'beams');
            geometry.beams = data.beams.map((beam, index) => {
                const beamData = {
                    p1: beam.p1,
                    p2: beam.p2,
                    w: beam.w,
                    t: beam.t,
                    isH: beam.isH,
                    color: beam.color || {r:139, g:90, b:43}, // Wood brown
                    stackType: beam.stackType || 'unknown',
                    moduleIndex: beam.moduleIndex !== undefined ? beam.moduleIndex : -1
                };
                
                // Include orientation vectors for correct cross-section orientation
                if (beam.axisX && beam.axisY && beam.axisZ) {
                    beamData.axisX = beam.axisX;
                    beamData.axisY = beam.axisY;
                    beamData.axisZ = beam.axisZ;
                }
                
                // Log first 3 beams for debugging
                if (index < 3) {
                    console.log(`[serializeGeometry] Beam ${index} (${beamData.stackType}):`, {
                        p1: beamData.p1,
                        p2: beamData.p2,
                        hasAxes: !!(beamData.axisX && beamData.axisY && beamData.axisZ),
                        axisX: beamData.axisX,
                        axisY: beamData.axisY,
                        axisZ: beamData.axisZ
                    });
                }
                
                return beamData;
            });
            console.log('[serializeGeometry] Exported', geometry.beams.length, 'beams');
        }
        
        // Serialize panels with row/col positions
        if (data.panels) {
            const gridCols = panelConfig.gridCols;
            const gridRows = panelConfig.gridRows;
            
            geometry.panels = data.panels.map((panel, idx) => {
                // Calculate row/col based on panel index and grid size
                let row, col, side;
                
                if (isArchMode) {
                    // Arch mode: panels are arranged in A/B side pairs
                    // Each side has gridRows x gridCols panels
                    const panelsPerSide = gridRows * gridCols;
                    const sideIndex = Math.floor(idx / panelsPerSide);
                    const withinSide = idx % panelsPerSide;
                    side = sideIndex % 2 === 0 ? 'A' : 'B';
                    row = Math.floor(withinSide / gridCols);
                    col = withinSide % gridCols;
                } else {
                    // Top panel mode: simple row/col grid
                    row = Math.floor(idx / gridCols);
                    col = idx % gridCols;
                    side = 'top';
                }
                
                return {
                    center: panel.center,
                    width: panel.width,
                    length: panel.length,
                    thickness: panel.thickness,
                    rotation: panel.rotation,
                    normal: panel.normal,
                    // Include axis triad for proper orientation in simulator
                    axisX: panel.axisX ? {
                        x: panel.axisX.x,
                        y: panel.axisX.y,
                        z: panel.axisX.z
                    } : null,
                    axisY: panel.axisY ? {
                        x: panel.axisY.x,
                        y: panel.axisY.y,
                        z: panel.axisY.z
                    } : null,
                    axisZ: panel.axisZ ? {
                        x: panel.axisZ.x,
                        y: panel.axisZ.y,
                        z: panel.axisZ.z
                    } : null,
                    // Grid position info
                    row: row,
                    col: col,
                    side: side,
                    index: idx
                };
            });
        }
        
        // Calculate bounding box for camera positioning
        const allPoints = [
            ...geometry.beams.flatMap(b => [b.p1, b.p2]),
            ...geometry.panels.map(p => p.center)
        ];
        if (allPoints.length > 0) {
            geometry.bounds = {
                min: {
                    x: Math.min(...allPoints.map(p => p.x)),
                    y: Math.min(...allPoints.map(p => p.y)),
                    z: Math.min(...allPoints.map(p => p.z))
                },
                max: {
                    x: Math.max(...allPoints.map(p => p.x)),
                    y: Math.max(...allPoints.map(p => p.y)),
                    z: Math.max(...allPoints.map(p => p.z))
                }
            };
        }
        
        return geometry;
    }
    
    /**
     * Attach GLB model to linkage export in the background (optional, non-blocking).
     */
    async function attachGlbToLinkageExport(exportData) {
        try {
            if (typeof THREE === 'undefined' || typeof THREE.GLTFExporter === 'undefined') return;
            const glbResult = await exportToGLTF('glb', 'meters', 'yup', { download: false, silent: true });
            if (!glbResult || !glbResult.blob) return;
    
            const glbBase64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(glbResult.blob);
            });
            exportData.structureGLB = {
                data: glbBase64,
                units: 'meters',
                coordSys: 'yup'
            };
            localStorage.setItem('linkageLabExport', JSON.stringify(exportData));
            try {
                localStorage.setItem('linkageLabGLB', glbBase64);
            } catch (e) {
                console.warn('[GLTF Export] Failed to store GLB in localStorage:', e);
            }
        } catch (e) {
            console.warn('[GLTF Export] Failed to generate GLB for simulator:', e);
        }
    }
    
    /**
     * Exports current design to Solar Designer for circuit design and simulation
     * Passes panel configuration, BOM costs, and 3D geometry
     */
    function exportToSolarSimulator() {
        const designerUrl = ExportFormat.buildImportURL('solar_designer.html', 'linkageLab');
    
        try {
        // Get current linkage data with the same generated components shown in the viewport.
        const data = buildLinkageGeometry({ includeSupportBeams: true, includePanels: true, useCache: false });
        
        // Get active panel configuration
        const panelConfig = getActivePanelConfig();
        const panelCount = data.panels ? data.panels.length : 0;
        
        // Calculate BOM costs
        const moduleCount = state.modules;
        const hBeams = moduleCount * 2 * state.hStackCount;
        const vBeams = moduleCount * state.vStackCount;
        const uBrackets = moduleCount * 4;
        
        // Calculate bolt counts by type
        const splitBolts = needsSplitVBolts();
        const vBoltsInner = moduleCount * 2;
        const vBoltsOuter = moduleCount * 2;
        const vBoltsCenter = moduleCount * 1;
        const hCenterBolts = moduleCount * 2;
        const hPivotBolts = moduleCount * 4;
        const totalVBolts = vBoltsInner + vBoltsOuter + vBoltsCenter;
        const totalHBolts = hCenterBolts + hPivotBolts;
        
        // Get bolt costs
        const costVInner = splitBolts ? (state.costBoltVInner || 0.75) : (state.costBoltVInner || 0.75);
        const costVOuter = splitBolts ? (state.costBoltVOuter || 0.50) : costVInner;
        const costH = state.costBoltH || 0.75;
        const costHPivot = state.costBoltHPivot || 0.75;
        
        const hBeamsCost = hBeams * state.costHBeam;
        const vBeamsCost = calculateVBeamsCost();
        const bracketCost = uBrackets * state.costBracket;
        const boltCost = vBoltsInner * costVInner + vBoltsOuter * costVOuter + vBoltsCenter * costVInner + hCenterBolts * costH + hPivotBolts * costHPivot;
        
        // Calculate washer costs
        const vWashersPerBolt = state.vStackCount > 1 ? (state.vStackCount - 1) : 0;
        const vWasherCount = state.vWasherEnabled ? (totalVBolts * vWashersPerBolt) : 0;
        const hWashersPerBolt = state.hStackCount > 1 ? (state.hStackCount - 1) : 0;
        const hWasherCount = state.hWasherEnabled ? (totalHBolts * hWashersPerBolt) : 0;
        const costWasherV = state.costWasherV || 0.10;
        const costWasherH = state.costWasherH || 0.10;
        const vWasherCost = vWasherCount * costWasherV;
        const hWasherCost = hWasherCount * costWasherH;
        const washerCost = vWasherCost + hWasherCost;
        
        const structureSubtotal = hBeamsCost + vBeamsCost + bracketCost + boltCost + washerCost;
        const solarCost = panelCount * state.costSolarPanel;
        const totalCost = structureSubtotal + solarCost;
        
        // Build export data
        const isArchMode = state.orientation === 'vertical';
        const exportData = {
            version: 2,
            source: 'linkageLab',
            timestamp: Date.now(),
            solarPanels: {
                count: panelCount,
                specs: {
                    name: `LinkageLab ${panelConfig.ratedWatts}W Panel`,
                    wmp: panelConfig.ratedWatts,
                    vmp: panelConfig.vmp,
                    voc: panelConfig.voc,
                    isc: panelConfig.isc,
                    imp: panelConfig.imp,
                    cost: state.costSolarPanel,
                    width: Math.round(panelConfig.panelWidth * 25.4), // inches to mm
                    height: Math.round(panelConfig.panelLength * 25.4) // inches to mm
                },
                configuration: {
                    layoutMode: isArchMode ? 'arch' : state.solarPanels.layoutMode,
                    isArchMode: isArchMode,
                    gridRows: panelConfig.gridRows,
                    gridCols: panelConfig.gridCols,
                    paddingX: panelConfig.paddingX,
                    paddingY: panelConfig.paddingY,
                    panelsPerSide: panelConfig.gridRows * panelConfig.gridCols,
                    numSides: isArchMode ? Math.ceil(panelCount / (panelConfig.gridRows * panelConfig.gridCols)) : 1
                }
            },
            structureCost: {
                beams: hBeamsCost + vBeamsCost,
                brackets: bracketCost,
                bolts: boltCost,
                subtotal: structureSubtotal
            },
            totalBomCost: totalCost,
            structureGeometry: serializeGeometry(data),
            cameraState: {
                yaw: state.cam.yaw,
                pitch: state.cam.pitch,
                dist: state.cam.dist,
                structureRotation: state.structureRotation || 0
            }
        };
        
        // Store in localStorage for the designer to read (must happen before window.open)
        localStorage.setItem('linkageLabExport', JSON.stringify(exportData));
        
        // Open Solar Designer synchronously while the click gesture is still active
        const opened = window.open(designerUrl, '_blank');
        if (!opened) {
            showToast('Popup blocked — allow popups for this site to open Solar Designer', 'warning');
            return;
        }
        
        showToast(`Exported ${panelCount} panels to Solar Designer`, 'info');
        
        // GLB export is optional and can finish after the designer tab opens
        attachGlbToLinkageExport(exportData);
        } catch (e) {
            console.error('exportToSolarSimulator failed:', e);
            showToast('Failed to open Solar Designer', 'error');
        }
    }
    
    
    /**
     * Computes drill-template data for the reciprocal support layer:
     *   • the rcp-ring anchor positions on a representative top H-beam
     *     (so the build guide can show "drill an extra hole at X inches" on the
     *     top ring for each reciprocal beam)
     *   • the rcp-cross hole positions along a representative reciprocal beam,
     *     plus the anchor (rcp-ring) end-hole position on that beam.
     *
     * All distances are reported from one consistent end (p1) of the beam, to
     * match the convention of the existing H-beam / V-beam drill templates.
     *
     * @param {Object} data - Output of buildLinkageGeometry
     * @returns {Object} drill data — see fields below
     */

    g.LinkageModules = g.LinkageModules || {};
    g.LinkageModules.exportBridge = { generateDefaultFilename, getUnifiedConfig, exportToJSON, importFromJSON, serializeGeometry, exportToSolarSimulator };
    g.generateDefaultFilename = generateDefaultFilename;
    g.getUnifiedConfig = getUnifiedConfig;
    g.exportToJSON = exportToJSON;
    g.importFromJSON = importFromJSON;
    g.serializeGeometry = serializeGeometry;
    g.exportToSolarSimulator = exportToSolarSimulator;

})(window);

