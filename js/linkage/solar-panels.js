// ============================================================================
// SOLAR PANEL CALCULATIONS
// ============================================================================

function calculateSolarPanels(data) {
    const panels = [];
    const supportBeams = [];
    const canopy = null; // Canopy data if needed
    
    if (!state.solarPanels.enabled || !data || !data.faces) {
        return { panels, supportBeams, canopy };
    }
    
    const sp = state.solarPanels;
    
    // Determine which panel config to use based on orientation
    if (state.orientation === 'vertical') {
        // Arch mode - use side panels on wall faces
        if (sp.sidePanels && sp.sidePanels.enabled) {
            const placer = new PanelPlacer({
                panelWidth: sp.sidePanels.panelWidth,
                panelLength: sp.sidePanels.panelLength,
                panelThickness: sp.sidePanels.panelThickness,
                paddingX: sp.sidePanels.paddingX,
                paddingY: sp.sidePanels.paddingY,
                gridRows: sp.sidePanels.gridRows,
                gridCols: sp.sidePanels.gridCols,
                archPanelOffset: sp.archPanelOffset,
                archPanelSlide: sp.archPanelSlide,
                archPanelSeparation: sp.archPanelSeparation
            });
            
            // Get enabled faces (null = all enabled)
            const enabledFaces = sp.archWallFaces;
            const archPanels = placer.placeOnFaces(data.faces, enabledFaces);
            panels.push(...archPanels);
        }
    } else {
        // Cylinder mode - use top panels
        if (sp.topPanels && sp.topPanels.enabled) {
            if (sp.layoutMode === 'rectangular') {
                // Rectangular grid layout on top surface
                const topFaces = data.faces.filter(f => f && Math.abs(f.normal.y) > 0.7);
                if (topFaces.length > 0) {
                    const placer = new PanelPlacer({
                        panelWidth: sp.topPanels.panelWidth,
                        panelLength: sp.topPanels.panelLength,
                        panelThickness: sp.topPanels.panelThickness,
                        paddingX: sp.topPanels.paddingX,
                        paddingY: sp.topPanels.paddingY,
                        gridRows: sp.topPanels.gridRows,
                        gridCols: sp.topPanels.gridCols
                    });
                    
                    topFaces.forEach(face => {
                        const facePanels = placer.placeOnFace(face);
                        panels.push(...facePanels);
                    });
                }
            } else if (sp.layoutMode === 'radial') {
                // Radial/pinwheel layout
                // TODO: Implement radial layout
                console.warn('Radial layout not yet implemented');
            } else if (sp.layoutMode === 'spiral') {
                // Spiral layout
                // TODO: Implement spiral layout
                console.warn('Spiral layout not yet implemented');
            }
        }
        
        // Side wall panels in cylinder mode
        if (sp.sidePanels && sp.sidePanels.enabled) {
            const sideFaces = data.faces.filter(f => f && Math.abs(f.normal.y) < 0.7);
            if (sideFaces.length > 0) {
                const placer = new PanelPlacer({
                    panelWidth: sp.sidePanels.panelWidth,
                    panelLength: sp.sidePanels.panelLength,
                    panelThickness: sp.sidePanels.panelThickness,
                    paddingX: sp.sidePanels.paddingX,
                    paddingY: sp.sidePanels.paddingY,
                    gridRows: sp.sidePanels.gridRows,
                    gridCols: sp.sidePanels.gridCols
                });
                
                sideFaces.forEach(face => {
                    const facePanels = placer.placeOnFace(face);
                    panels.push(...facePanels);
                });
            }
        }
    }
    
    // Add support beams if enabled
    if (sp.showSupportBeams) {
        // TODO: Generate support beams based on sp.supportBeam* parameters
        console.warn('Support beams not yet implemented');
    }
    
    return { panels, supportBeams, canopy };
}

function getActivePanelConfig() {
    const sp = state.solarPanels;
    if (state.orientation === 'vertical') {
        return sp.sidePanels;
    } else {
        return sp.topPanels;
    }
}

function updateArchWallFacesUI() {
    if (state.orientation !== 'vertical' || !state.solarPanels.enabled) {
        const container = document.getElementById('arch-wall-faces-container');
        if (container) container.style.display = 'none';
        return;
    }
    
    const container = document.getElementById('arch-wall-faces-container');
    if (container) container.style.display = 'block';
    
    generateWallFaceButtons();
}

function generateWallFaceButtons() {
    const container = document.getElementById('arch-wall-faces-buttons');
    if (!container) return;
    
    const numFaces = state.modules * 2;
    container.innerHTML = '';
    
    // Initialize archWallFaces if null
    if (state.solarPanels.archWallFaces === null) {
        state.solarPanels.archWallFaces = new Array(numFaces).fill(true);
    } else if (state.solarPanels.archWallFaces.length !== numFaces) {
        // Resize array if module count changed
        const oldLength = state.solarPanels.archWallFaces.length;
        const newArray = new Array(numFaces).fill(false);
        for (let i = 0; i < Math.min(oldLength, numFaces); i++) {
            newArray[i] = state.solarPanels.archWallFaces[i];
        }
        state.solarPanels.archWallFaces = newArray;
    }
    
    // Create buttons for each face
    for (let i = 0; i < numFaces; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `arch-face-btn ${state.solarPanels.archWallFaces[i] ? 'active' : ''}`;
        btn.textContent = `Face ${i + 1}`;
        btn.title = `Toggle panel on face ${i + 1}`;
        btn.onclick = () => {
            state.solarPanels.archWallFaces[i] = !state.solarPanels.archWallFaces[i];
            btn.classList.toggle('active');
            requestRender();
        };
        container.appendChild(btn);
    }
}
