// ============================================================================
// IMPORT/EXPORT FUNCTIONS
// ============================================================================

function exportToJSON() {
    const config = getConfigSnapshot(true); // Include metadata (version, timestamp)
    
    // Add solar designer data if available
    if (typeof SolarDesigner !== 'undefined' && SolarDesigner.isInitialized()) {
        try {
            const solarConfig = SolarDesigner.getSolarConfig();
            config.solarDesigner = solarConfig;
        } catch (e) {
            console.warn('Could not include solar designer config:', e);
        }
    }
    
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentAppMode === 'solar' ? 'starshade-solar-config.json' : 'linkage-config.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Configuration exported', 'info');
}

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
                
                // Save to localStorage so it persists
                localStorage.setItem('linkageLab_config', JSON.stringify(config));
                
                // Load solar designer data if available
                if (config.solarDesigner && typeof SolarDesigner !== 'undefined') {
                    try {
                        SolarDesigner.loadSolarConfig(config.solarDesigner);
                        console.log('Solar designer configuration loaded');
                    } catch (e) {
                        console.warn('Could not load solar designer data:', e);
                    }
                }
                
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

function serializeGeometry(data) {
    const geometry = {
        beams: [],
        panels: [],
        bounds: { min: {x:0, y:0, z:0}, max: {x:0, y:0, z:0} }
    };
    
    // Serialize beams (simplified - just endpoints and dimensions)
    if (data.beams) {
        geometry.beams = data.beams.map(beam => ({
            p1: beam.p1,
            p2: beam.p2,
            w: beam.w,
            t: beam.t,
            isH: beam.isH,
            color: beam.color || {r:139, g:90, b:43} // Wood brown
        }));
    }
    
    // Serialize panels (center, dimensions, and orientation)
    if (data.panels) {
        geometry.panels = data.panels.map(panel => ({
            center: panel.center,
            width: panel.width,
            length: panel.length,
            thickness: panel.thickness,
            rotation: panel.rotation,
            normal: panel.normal
        }));
    }
    
    // Calculate bounding box for camera positioning
    const allPoints = [];
    if (data.beams) {
        data.beams.forEach(beam => {
            if (beam.p1) allPoints.push(beam.p1);
            if (beam.p2) allPoints.push(beam.p2);
        });
    }
    if (data.panels) {
        data.panels.forEach(panel => {
            if (panel.center) allPoints.push(panel.center);
        });
    }
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

function exportToSolarSimulator() {
    const data = solveLinkage(state.foldAngle);
    
    // Calculate solar panels if enabled
    if (state.solarPanels.enabled) {
        const solarData = calculateSolarPanels(data);
        data.panels = solarData.panels;
        data.supportBeams = solarData.supportBeams;
        data.canopy = solarData.canopy;
    } else {
        data.panels = [];
    }
    
    const config = {
        version: 'v30',
        timestamp: new Date().toISOString(),
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
        geometry: serializeGeometry(data),
        panels: state.solarPanels.enabled ? {
            enabled: true,
            topPanels: {
                enabled: state.solarPanels.topPanels.enabled,
                size: {
                    width: state.solarPanels.topPanels.panelWidth,
                    length: state.solarPanels.topPanels.panelLength,
                    thickness: state.solarPanels.topPanels.panelThickness
                },
                electrical: {
                    ratedWatts: state.solarPanels.topPanels.ratedWatts,
                    voc: state.solarPanels.topPanels.voc,
                    vmp: state.solarPanels.topPanels.vmp,
                    isc: state.solarPanels.topPanels.isc,
                    imp: state.solarPanels.topPanels.imp
                },
                padding: {
                    x: state.solarPanels.topPanels.paddingX,
                    y: state.solarPanels.topPanels.paddingY
                },
                grid: {
                    rows: state.solarPanels.topPanels.gridRows,
                    cols: state.solarPanels.topPanels.gridCols
                },
                lift: state.solarPanels.topPanels.panelLift
            },
            sidePanels: {
                enabled: state.solarPanels.sidePanels.enabled,
                size: {
                    width: state.solarPanels.sidePanels.panelWidth,
                    length: state.solarPanels.sidePanels.panelLength,
                    thickness: state.solarPanels.sidePanels.panelThickness
                },
                electrical: {
                    ratedWatts: state.solarPanels.sidePanels.ratedWatts,
                    voc: state.solarPanels.sidePanels.voc,
                    vmp: state.solarPanels.sidePanels.vmp,
                    isc: state.solarPanels.sidePanels.isc,
                    imp: state.solarPanels.sidePanels.imp
                },
                padding: {
                    x: state.solarPanels.sidePanels.paddingX,
                    y: state.solarPanels.sidePanels.paddingY
                },
                grid: {
                    rows: state.solarPanels.sidePanels.gridRows,
                    cols: state.solarPanels.sidePanels.gridCols
                }
            },
            layoutMode: state.solarPanels.layoutMode,
            gridRotation: state.solarPanels.gridRotation,
            positioning: {
                lift: state.solarPanels.archPanelOffset,
                slide: state.solarPanels.archPanelSlide,
                separation: state.solarPanels.archPanelSeparation
            },
            radial: {
                count: state.solarPanels.radialCount,
                offset: state.solarPanels.radialOffset,
                rotation: state.solarPanels.radialRotation,
                lateralOffset: state.solarPanels.radialLateralOffset,
                pinwheelAngle: state.solarPanels.pinwheelAngle
            },
            spiral: {
                armCount: state.solarPanels.spiralArmCount,
                secondaryEnabled: state.solarPanels.spiralSecondaryEnabled,
                secondaryRadialOffset: state.solarPanels.spiralSecondaryRadialOffset,
                secondaryLateralOffset: state.solarPanels.spiralSecondaryLateralOffset,
                secondaryPinwheel: state.solarPanels.spiralSecondaryPinwheel,
                secondaryRotation: state.solarPanels.spiralSecondaryRotation,
                armRadialStep: state.solarPanels.spiralArmRadialStep,
                armLateralStep: state.solarPanels.spiralArmLateralStep,
                armPinwheelStep: state.solarPanels.spiralArmPinwheelStep,
                armRotationStep: state.solarPanels.spiralArmRotationStep
            },
            support: {
                show: state.solarPanels.showSupportBeams,
                rotation: state.solarPanels.supportBeamRotation,
                length: state.solarPanels.supportBeamLength,
                foldAngle: state.solarPanels.supportBeamFoldAngle,
                offsetH: state.solarPanels.supportBeamOffsetH,
                offsetV: state.solarPanels.supportBeamOffsetV
            },
            enabledFaces: state.solarPanels.archWallFaces
        } : { enabled: false }
    };
    
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'starshade-solar-config.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Configuration exported for Solar Simulator', 'info');
}
