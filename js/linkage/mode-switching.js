// ============================================================================
// MODE SWITCHING
// ============================================================================

let currentAppMode = 'linkage'; // 'linkage' or 'solar'

function switchToLinkageMode() {
    currentAppMode = 'linkage';
    
    // Update button states
    const linkageBtn = document.getElementById('btn-mode-linkage');
    const solarBtn = document.getElementById('btn-mode-solar');
    if (linkageBtn) linkageBtn.classList.add('active');
    if (solarBtn) solarBtn.classList.remove('active');
    
    // Update body class
    document.body.classList.remove('solar-mode');
    
    // Show/hide containers
    const linkageContainer = document.getElementById('linkage-container');
    const solarContainer = document.getElementById('solar-container');
    if (linkageContainer) linkageContainer.style.display = 'block';
    if (solarContainer) solarContainer.style.display = 'none';
    
    // Request render to update linkage view
    if (typeof requestRender === 'function') {
        requestRender();
    }
}

function switchToSolarMode() {
    currentAppMode = 'solar';
    
    // Update button states
    const linkageBtn = document.getElementById('btn-mode-linkage');
    const solarBtn = document.getElementById('btn-mode-solar');
    if (linkageBtn) linkageBtn.classList.remove('active');
    if (solarBtn) solarBtn.classList.add('active');
    
    // Update body class
    document.body.classList.add('solar-mode');
    
    // Show/hide containers
    const linkageContainer = document.getElementById('linkage-container');
    const solarContainer = document.getElementById('solar-container');
    if (linkageContainer) linkageContainer.style.display = 'none';
    if (solarContainer) solarContainer.style.display = 'block';
    
    // Build linkage config for solar designer
    const linkageConfig = buildLinkageConfigForSolar();
    
    // Initialize solar designer if available
    if (typeof SolarDesigner !== 'undefined') {
        if (!SolarDesigner.isInitialized()) {
            SolarDesigner.init(linkageConfig);
        } else {
            SolarDesigner.setLinkageConfig(linkageConfig);
        }
        
        // Sync panels from linkage mode if enabled
        if (state.solarPanels.enabled) {
            syncPanelsFromLinkageMode();
        }
    }
}

function buildLinkageConfigForSolar() {
    const data = solveLinkage(state.foldAngle);
    
    // Calculate solar panels if enabled
    let panels = [];
    if (state.solarPanels.enabled) {
        const solarData = calculateSolarPanels(data);
        panels = solarData.panels || [];
    }
    
    return {
        structure: {
            modules: state.modules,
            beamLengths: {
                horizontal: state.hLengthFt,
                vertical: state.vLengthFt
            },
            pivotPercent: state.pivotPct,
            stackCounts: {
                horizontal: state.hStackCount,
                vertical: state.vStackCount
            },
            beamDimensions: {
                horizontalWidth: state.hBeamW,
                horizontalThickness: state.hBeamT,
                verticalWidth: state.vBeamW,
                verticalThickness: state.vBeamT
            },
            offsets: {
                top: state.offsetTopIn,
                bottom: state.offsetBotIn,
                vertEnd: state.vertEndOffset,
                bracket: state.bracketOffset,
                stackGap: state.stackGap
            },
            hobermanAngle: state.hobermanAng,
            pivotAngle: state.pivotAng,
            vStackReverse: state.vStackReverse
        },
        mode: {
            type: state.orientation === 'vertical' ? 'arch' : 'cylinder',
            flipVertical: state.archFlipVertical,
            rotation: state.archRotation,
            useFixedBeams: state.useFixedBeams,
            capUprights: state.archCapUprights,
            arrayCount: state.arrayCount
        },
        foldAngle: radToDeg(state.foldAngle),
        geometry: data,
        panels: panels
    };
}

function syncPanelsFromLinkageMode() {
    if (typeof SolarDesigner === 'undefined' || !SolarDesigner.isInitialized()) {
        return;
    }
    
    const linkageConfig = buildLinkageConfigForSolar();
    const panels = linkageConfig.panels || [];
    
    // Clear existing panels in solar designer
    // Note: This depends on SolarDesigner API - may need adjustment
    if (SolarDesigner.clearPanels && typeof SolarDesigner.clearPanels === 'function') {
        SolarDesigner.clearPanels();
    }
    
    // Add panels from linkage mode
    panels.forEach(panel => {
        if (panel && panel.center) {
            // Convert panel center to solar designer coordinates
            // Solar designer uses 2D canvas coordinates (pixels)
            // Linkage uses 3D inches
            // This is a simplified conversion - may need adjustment based on actual coordinate systems
            const x = panel.center.x || 0;
            const y = panel.center.y || 0;
            
            // Create panel in solar designer
            if (SolarDesigner.createPanel && typeof SolarDesigner.createPanel === 'function') {
                const panelSpecs = getActivePanelConfig();
                SolarDesigner.createPanel(x, y, {
                    wmp: panelSpecs.ratedWatts || 400,
                    vmp: panelSpecs.vmp || 41.5,
                    imp: panelSpecs.imp || 9.65,
                    voc: panelSpecs.voc || 49.5,
                    isc: panelSpecs.isc || 10.2,
                    width: panelSpecs.panelWidth || 39,
                    height: panelSpecs.panelLength || 65
                });
            }
        }
    });
    
    // Render solar designer
    if (SolarDesigner.render && typeof SolarDesigner.render === 'function') {
        SolarDesigner.render();
    }
}
