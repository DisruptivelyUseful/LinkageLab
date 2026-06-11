// ============================================================================ (ES module)

import { bridgeGlobals } from './global-bridge.js';

    function initSolarPanelHandlers() {
        // === SOLAR PANEL EVENT HANDLERS ===
        document.getElementById('chk-solar-panels').onchange = e => {
            state.solarPanels.enabled = e.target.checked;
            // Solar panel controls are always visible now
            
            // When enabling solar panels in cylinder/horizontal mode, snap to closed angle for proper alignment
            // In arch/vertical mode, panels can work at any fold angle since they're on wall faces
            if (state.solarPanels.enabled && state.orientation !== 'vertical') {
                const closedAngle = getOptimalClosedAngleForAnimation();
                state.foldAngle = closedAngle;
                // Sync the fold angle UI
                const foldAngleDeg = radToDeg(closedAngle);
                const slFoldAngle = document.getElementById('sl-fold');
                const nbFoldAngle = document.getElementById('nb-fold');
                if (slFoldAngle) slFoldAngle.value = foldAngleDeg;
                if (nbFoldAngle) nbFoldAngle.value = foldAngleDeg.toFixed(1);
                showToast('Structure snapped to closed position for solar panel alignment', 'info');
            }
            
            // Update visibility of arch-mode-specific controls
            updateArchWallFacesUI();
            
            invalidateGeometryCache();
            requestRender();
            
            // Sync panels to solar designer (force sync to add/remove panels)
            debouncedPanelSync();
        };
        
        // ========== TOP PANEL DIMENSION CONTROLS ==========
        document.getElementById('sl-panel-length-top').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.topPanels.panelLength = val;
            document.getElementById('nb-panel-length-top').value = val;
            requestRender();
        };
        document.getElementById('nb-panel-length-top').onchange = e => {
            let val = parseFloat(e.target.value) || 65;
            val = Math.max(12, Math.min(120, val));
            state.solarPanels.topPanels.panelLength = val;
            document.getElementById('sl-panel-length-top').value = val;
            e.target.value = val;
            requestRender();
            debouncedPanelSync();
        };
        document.getElementById('sl-panel-width-top').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.topPanels.panelWidth = val;
            document.getElementById('nb-panel-width-top').value = val;
            requestRender();
        };
        document.getElementById('nb-panel-width-top').onchange = e => {
            let val = parseFloat(e.target.value) || 39;
            val = Math.max(12, Math.min(80, val));
            state.solarPanels.topPanels.panelWidth = val;
            document.getElementById('sl-panel-width-top').value = val;
            e.target.value = val;
            requestRender();
            debouncedPanelSync();
        };
        document.getElementById('sl-panel-thick-top').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.topPanels.panelThickness = val;
            document.getElementById('nb-panel-thick-top').value = val;
            requestRender();
        };
        document.getElementById('nb-panel-thick-top').onchange = e => {
            let val = parseFloat(e.target.value) || 1.5;
            val = Math.max(0.5, Math.min(4, val));
            state.solarPanels.topPanels.panelThickness = val;
            document.getElementById('sl-panel-thick-top').value = val;
            e.target.value = val;
            requestRender();
        };
        
        // ========== SIDE PANEL DIMENSION CONTROLS ==========
        document.getElementById('sl-panel-length-side').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.sidePanels.panelLength = val;
            document.getElementById('nb-panel-length-side').value = val;
            requestRender();
        };
        document.getElementById('nb-panel-length-side').onchange = e => {
            let val = parseFloat(e.target.value) || 65;
            val = Math.max(12, Math.min(120, val));
            state.solarPanels.sidePanels.panelLength = val;
            document.getElementById('sl-panel-length-side').value = val;
            e.target.value = val;
            requestRender();
            debouncedPanelSync();
        };
        document.getElementById('sl-panel-width-side').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.sidePanels.panelWidth = val;
            document.getElementById('nb-panel-width-side').value = val;
            requestRender();
        };
        document.getElementById('nb-panel-width-side').onchange = e => {
            let val = parseFloat(e.target.value) || 39;
            val = Math.max(12, Math.min(80, val));
            state.solarPanels.sidePanels.panelWidth = val;
            document.getElementById('sl-panel-width-side').value = val;
            e.target.value = val;
            requestRender();
            debouncedPanelSync();
        };
        document.getElementById('sl-panel-thick-side').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.sidePanels.panelThickness = val;
            document.getElementById('nb-panel-thick-side').value = val;
            requestRender();
        };
        document.getElementById('nb-panel-thick-side').onchange = e => {
            let val = parseFloat(e.target.value) || 1.5;
            val = Math.max(0.5, Math.min(4, val));
            state.solarPanels.sidePanels.panelThickness = val;
            document.getElementById('sl-panel-thick-side').value = val;
            e.target.value = val;
            requestRender();
        };
        
        // ========== TOP PANEL ELECTRICAL CONTROLS ==========
        document.getElementById('sl-panel-watts-top').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.topPanels.ratedWatts = val;
            document.getElementById('nb-panel-watts-top').value = val;
        };
        document.getElementById('nb-panel-watts-top').onchange = e => {
            let val = parseFloat(e.target.value) || 400;
            val = Math.max(50, Math.min(1000, val));
            state.solarPanels.topPanels.ratedWatts = val;
            document.getElementById('sl-panel-watts-top').value = Math.min(800, val);
            e.target.value = val;
            debouncedPanelSync();
        };
        document.getElementById('nb-panel-voc-top').onchange = e => {
            let val = parseFloat(e.target.value) || 49.5;
            val = Math.max(0, Math.min(100, val));
            state.solarPanels.topPanels.voc = val;
            e.target.value = val;
            debouncedPanelSync();
        };
        document.getElementById('nb-panel-vmp-top').onchange = e => {
            let val = parseFloat(e.target.value) || 41.5;
            val = Math.max(0, Math.min(100, val));
            state.solarPanels.topPanels.vmp = val;
            e.target.value = val;
            debouncedPanelSync();
        };
        document.getElementById('nb-panel-isc-top').onchange = e => {
            let val = parseFloat(e.target.value) || 10.2;
            val = Math.max(0, Math.min(30, val));
            state.solarPanels.topPanels.isc = val;
            e.target.value = val;
            debouncedPanelSync();
        };
        document.getElementById('nb-panel-imp-top').onchange = e => {
            let val = parseFloat(e.target.value) || 9.65;
            val = Math.max(0, Math.min(30, val));
            state.solarPanels.topPanels.imp = val;
            e.target.value = val;
            debouncedPanelSync();
        };
        document.getElementById('sl-panel-weight-top').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.topPanels.weight = val;
            document.getElementById('nb-panel-weight-top').value = val;
            requestRender();
        };
        document.getElementById('nb-panel-weight-top').onchange = e => {
            let val = parseFloat(e.target.value) || 45;
            val = Math.max(1, Math.min(500, val));
            state.solarPanels.topPanels.weight = val;
            document.getElementById('sl-panel-weight-top').value = Math.min(150, val);
            e.target.value = val;
            requestRender();
        };
        
        // ========== SIDE PANEL ELECTRICAL CONTROLS ==========
        document.getElementById('sl-panel-watts-side').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.sidePanels.ratedWatts = val;
            document.getElementById('nb-panel-watts-side').value = val;
        };
        document.getElementById('nb-panel-watts-side').onchange = e => {
            let val = parseFloat(e.target.value) || 400;
            val = Math.max(50, Math.min(1000, val));
            state.solarPanels.sidePanels.ratedWatts = val;
            document.getElementById('sl-panel-watts-side').value = Math.min(800, val);
            e.target.value = val;
            debouncedPanelSync();
        };
        document.getElementById('nb-panel-voc-side').onchange = e => {
            let val = parseFloat(e.target.value) || 49.5;
            val = Math.max(0, Math.min(100, val));
            state.solarPanels.sidePanels.voc = val;
            e.target.value = val;
            debouncedPanelSync();
        };
        document.getElementById('nb-panel-vmp-side').onchange = e => {
            let val = parseFloat(e.target.value) || 41.5;
            val = Math.max(0, Math.min(100, val));
            state.solarPanels.sidePanels.vmp = val;
            e.target.value = val;
            debouncedPanelSync();
        };
        document.getElementById('nb-panel-isc-side').onchange = e => {
            let val = parseFloat(e.target.value) || 10.2;
            val = Math.max(0, Math.min(30, val));
            state.solarPanels.sidePanels.isc = val;
            e.target.value = val;
            debouncedPanelSync();
        };
        document.getElementById('nb-panel-imp-side').onchange = e => {
            let val = parseFloat(e.target.value) || 9.65;
            val = Math.max(0, Math.min(30, val));
            state.solarPanels.sidePanels.imp = val;
            e.target.value = val;
            debouncedPanelSync();
        };
        document.getElementById('sl-panel-weight-side').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.sidePanels.weight = val;
            document.getElementById('nb-panel-weight-side').value = val;
            requestRender();
        };
        document.getElementById('nb-panel-weight-side').onchange = e => {
            let val = parseFloat(e.target.value) || 45;
            val = Math.max(1, Math.min(500, val));
            state.solarPanels.sidePanels.weight = val;
            document.getElementById('sl-panel-weight-side').value = Math.min(150, val);
            e.target.value = val;
            requestRender();
        };
        
        // Layout mode dropdown
        const layoutDropdown = document.getElementById('sel-panel-layout');
        // Prevent event bubbling that might interfere with dropdown selection
        ['mousedown', 'mouseup', 'click', 'focus', 'pointerdown', 'wheel'].forEach(eventType => {
            layoutDropdown.addEventListener(eventType, e => e.stopPropagation());
        });
        // Also prevent scroll events on the parent container while dropdown is focused
        layoutDropdown.addEventListener('focus', () => {
            const controlsDiv = document.getElementById('controls');
            if (controlsDiv) {
                controlsDiv.style.overflowY = 'hidden';
            }
        });
        layoutDropdown.addEventListener('blur', () => {
            const controlsDiv = document.getElementById('controls');
            if (controlsDiv) {
                controlsDiv.style.overflowY = 'auto';
            }
        });
        layoutDropdown.onchange = e => {
            state.solarPanels.layoutMode = e.target.value;
            // Show/hide mode-specific controls
            document.getElementById('rect-mode-controls').style.display = e.target.value === 'rectangular' ? 'block' : 'none';
            document.getElementById('radial-mode-controls').style.display = e.target.value === 'radial' ? 'block' : 'none';
            document.getElementById('spiral-mode-controls').style.display = e.target.value === 'spiral' ? 'block' : 'none';
            requestRender();
        };
        
        // Side wall panels checkbox (cylinder mode)
        document.getElementById('chk-side-wall-panels').onchange = e => {
            state.solarPanels.sidePanels.enabled = e.target.checked;
            updateArchWallFacesUI();
            requestRender();
        };
        
        // Top surface panels checkbox (cylinder mode)
        document.getElementById('chk-top-panels').onchange = e => {
            state.solarPanels.topPanels.enabled = e.target.checked;
            updateArchWallFacesUI();
            requestRender();
        };
        
        // Side panel grid controls (arch mode or cylinder side walls)
        document.getElementById('nb-grid-rows').onchange = e => {
            let val = parseInt(e.target.value) || 2;
            val = Math.max(1, Math.min(10, val));
            state.solarPanels.sidePanels.gridRows = val;
            e.target.value = val;
            requestRender();
            debouncedPanelSync();
        };
        document.getElementById('nb-grid-cols').onchange = e => {
            let val = parseInt(e.target.value) || 2;
            val = Math.max(1, Math.min(10, val));
            state.solarPanels.sidePanels.gridCols = val;
            e.target.value = val;
            requestRender();
            debouncedPanelSync();
        };
        
        // Top panel grid controls (cylinder mode)
        document.getElementById('nb-top-panel-rows').onchange = e => {
            let val = parseInt(e.target.value) || 2;
            val = Math.max(1, Math.min(10, val));
            state.solarPanels.topPanels.gridRows = val;
            e.target.value = val;
            requestRender();
            debouncedPanelSync();
        };
        document.getElementById('nb-top-panel-cols').onchange = e => {
            let val = parseInt(e.target.value) || 2;
            val = Math.max(1, Math.min(10, val));
            state.solarPanels.topPanels.gridCols = val;
            e.target.value = val;
            requestRender();
            debouncedPanelSync();
        };
        
        document.getElementById('sl-grid-rotation').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.gridRotation = val;
            document.getElementById('nb-grid-rotation').value = val;
            requestRender();
        };
        document.getElementById('nb-grid-rotation').onchange = e => {
            let val = parseFloat(e.target.value) || 0;
            val = Math.max(-180, Math.min(180, val));
            state.solarPanels.gridRotation = val;
            document.getElementById('sl-grid-rotation').value = val;
            e.target.value = val;
            requestRender();
        };
        
        // Radial/Pinwheel mode controls
        document.getElementById('sl-radial-count').oninput = e => {
            const val = parseInt(e.target.value);
            state.solarPanels.radialCount = val;
            document.getElementById('nb-radial-count').value = val;
            requestRender();
        };
        document.getElementById('nb-radial-count').onchange = e => {
            let val = parseInt(e.target.value) || 8;
            val = Math.max(3, Math.min(24, val));
            state.solarPanels.radialCount = val;
            document.getElementById('sl-radial-count').value = val;
            e.target.value = val;
            requestRender();
        };
        document.getElementById('sl-radial-offset').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.radialOffset = val;
            document.getElementById('nb-radial-offset').value = val;
            requestRender();
        };
        document.getElementById('nb-radial-offset').onchange = e => {
            let val = parseFloat(e.target.value) || 0;
            val = Math.max(0, Math.min(200, val));
            state.solarPanels.radialOffset = val;
            document.getElementById('sl-radial-offset').value = val;
            e.target.value = val;
            requestRender();
        };
        document.getElementById('sl-radial-rotation').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.radialRotation = val;
            document.getElementById('nb-radial-rotation').value = val;
            requestRender();
        };
        document.getElementById('nb-radial-rotation').onchange = e => {
            let val = parseFloat(e.target.value) || 0;
            val = Math.max(-180, Math.min(180, val));
            state.solarPanels.radialRotation = val;
            document.getElementById('sl-radial-rotation').value = val;
            e.target.value = val;
            requestRender();
        };
        document.getElementById('sl-radial-lateral').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.radialLateralOffset = val;
            document.getElementById('nb-radial-lateral').value = val;
            requestRender();
        };
        document.getElementById('nb-radial-lateral').onchange = e => {
            let val = parseFloat(e.target.value) || 0;
            val = Math.max(-100, Math.min(100, val));
            state.solarPanels.radialLateralOffset = val;
            document.getElementById('sl-radial-lateral').value = val;
            e.target.value = val;
            requestRender();
        };
        document.getElementById('sl-pinwheel-angle').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.pinwheelAngle = val;
            document.getElementById('nb-pinwheel-angle').value = val;
            requestRender();
        };
        document.getElementById('nb-pinwheel-angle').onchange = e => {
            let val = parseFloat(e.target.value) || 0;
            val = Math.max(-45, Math.min(45, val));
            state.solarPanels.pinwheelAngle = val;
            document.getElementById('sl-pinwheel-angle').value = val;
            e.target.value = val;
            requestRender();
        };
        
        // Spiral (multi-panel arms) controls
        document.getElementById('sl-spiral-arm-count').oninput = e => {
            const val = parseInt(e.target.value);
            state.solarPanels.spiralArmCount = val;
            document.getElementById('nb-spiral-arm-count').value = val;
            requestRender();
        };
        document.getElementById('nb-spiral-arm-count').onchange = e => {
            let val = parseInt(e.target.value);
            if (isNaN(val)) val = 2;
            state.solarPanels.spiralArmCount = val;
            e.target.value = val;
            requestRender();
        };
        document.getElementById('chk-spiral-secondary').onchange = e => {
            state.solarPanels.spiralSecondaryEnabled = e.target.checked;
            requestRender();
        };
        document.getElementById('sl-spiral-secondary-radial').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.spiralSecondaryRadialOffset = val;
            document.getElementById('nb-spiral-secondary-radial').value = val;
            requestRender();
        };
        document.getElementById('nb-spiral-secondary-radial').onchange = e => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = 24;
            state.solarPanels.spiralSecondaryRadialOffset = val;
            e.target.value = val;
            requestRender();
        };
        document.getElementById('sl-spiral-secondary-lateral').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.spiralSecondaryLateralOffset = val;
            document.getElementById('nb-spiral-secondary-lateral').value = val;
            requestRender();
        };
        document.getElementById('nb-spiral-secondary-lateral').onchange = e => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = 0;
            state.solarPanels.spiralSecondaryLateralOffset = val;
            e.target.value = val;
            requestRender();
        };
        document.getElementById('sl-spiral-secondary-pinwheel').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.spiralSecondaryPinwheel = val;
            document.getElementById('nb-spiral-secondary-pinwheel').value = val;
            requestRender();
        };
        document.getElementById('nb-spiral-secondary-pinwheel').onchange = e => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = 0;
            state.solarPanels.spiralSecondaryPinwheel = val;
            e.target.value = val;
            requestRender();
        };
        document.getElementById('sl-spiral-secondary-rotation').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.spiralSecondaryRotation = val;
            document.getElementById('nb-spiral-secondary-rotation').value = val;
            requestRender();
        };
        document.getElementById('nb-spiral-secondary-rotation').onchange = e => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = 0;
            state.solarPanels.spiralSecondaryRotation = val;
            e.target.value = val;
            requestRender();
        };
        document.getElementById('sl-spiral-arm-radial-step').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.spiralArmRadialStep = val;
            document.getElementById('nb-spiral-arm-radial-step').value = val;
            requestRender();
        };
        document.getElementById('nb-spiral-arm-radial-step').onchange = e => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = 0;
            state.solarPanels.spiralArmRadialStep = val;
            e.target.value = val;
            requestRender();
        };
        document.getElementById('sl-spiral-arm-lateral-step').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.spiralArmLateralStep = val;
            document.getElementById('nb-spiral-arm-lateral-step').value = val;
            requestRender();
        };
        document.getElementById('nb-spiral-arm-lateral-step').onchange = e => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = 0;
            state.solarPanels.spiralArmLateralStep = val;
            e.target.value = val;
            requestRender();
        };
        document.getElementById('sl-spiral-arm-pinwheel-step').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.spiralArmPinwheelStep = val;
            document.getElementById('nb-spiral-arm-pinwheel-step').value = val;
            requestRender();
        };
        document.getElementById('nb-spiral-arm-pinwheel-step').onchange = e => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = 0;
            state.solarPanels.spiralArmPinwheelStep = val;
            e.target.value = val;
            requestRender();
        };
        document.getElementById('sl-spiral-arm-rotation-step').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.spiralArmRotationStep = val;
            document.getElementById('nb-spiral-arm-rotation-step').value = val;
            requestRender();
        };
        document.getElementById('nb-spiral-arm-rotation-step').onchange = e => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = 0;
            state.solarPanels.spiralArmRotationStep = val;
            e.target.value = val;
            requestRender();
        };
        
        // ========== TOP PANEL PADDING CONTROLS ==========
        document.getElementById('nb-padding-x-top').onchange = e => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = 2;
            state.solarPanels.topPanels.paddingX = val;
            e.target.value = val;
            requestRender();
        };
        document.getElementById('nb-padding-y-top').onchange = e => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = 2;
            state.solarPanels.topPanels.paddingY = val;
            e.target.value = val;
            requestRender();
        };
        
        // ========== SIDE PANEL PADDING CONTROLS ==========
        document.getElementById('nb-padding-x-side').onchange = e => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = 2;
            state.solarPanels.sidePanels.paddingX = val;
            e.target.value = val;
            requestRender();
        };
        document.getElementById('nb-padding-y-side').onchange = e => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = 2;
            state.solarPanels.sidePanels.paddingY = val;
            e.target.value = val;
            requestRender();
        };
        
        // Panel lift controls (top panels only)
        document.getElementById('sl-panel-lift').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.topPanels.panelLift = val;
            document.getElementById('nb-panel-lift').value = val;
            requestRender();
        };
        document.getElementById('nb-panel-lift').onchange = e => {
            let val = parseFloat(e.target.value) || 0;
            val = Math.max(0, Math.min(96, val));
            state.solarPanels.topPanels.panelLift = val;
            document.getElementById('sl-panel-lift').value = Math.min(48, val);
            e.target.value = val;
            requestRender();
        };
        
        // Arch mode roof face selection buttons
        document.getElementById('btn-wall-all').onclick = () => {
            const numFaces = state.modules * 2;  // 2 faces per module
            state.solarPanels.archWallFaces = new Array(numFaces).fill(true);
            generateWallFaceButtons();
            requestRender();
        };
        
        document.getElementById('btn-wall-none').onclick = () => {
            const numFaces = state.modules * 2;  // 2 faces per module
            state.solarPanels.archWallFaces = new Array(numFaces).fill(false);
            generateWallFaceButtons();
            requestRender();
        };
        
        document.getElementById('btn-wall-outer').onclick = () => {
            // Select odd-numbered faces (1a, 2a, 3a, etc. - the "a" faces)
            const numFaces = state.modules * 2;
            state.solarPanels.archWallFaces = new Array(numFaces).fill(false);
            for (let i = 0; i < numFaces; i += 2) {
                state.solarPanels.archWallFaces[i] = true;
            }
            generateWallFaceButtons();
            requestRender();
        };
        
        document.getElementById('btn-wall-inner').onclick = () => {
            // Select even-numbered faces (1b, 2b, 3b, etc. - the "b" faces)
            const numFaces = state.modules * 2;
            state.solarPanels.archWallFaces = new Array(numFaces).fill(false);
            for (let i = 1; i < numFaces; i += 2) {
                state.solarPanels.archWallFaces[i] = true;
            }
            generateWallFaceButtons();
            requestRender();
        };
        
        // Arch panel Lift controls (distance above roof surface)
        document.getElementById('sl-arch-panel-offset').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.archPanelOffset = val;
            document.getElementById('nb-arch-panel-offset').value = val;
            requestRender();
        };
        document.getElementById('nb-arch-panel-offset').onchange = e => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = 2;
            state.solarPanels.archPanelOffset = val;
            document.getElementById('sl-arch-panel-offset').value = val;
            e.target.value = val;
            requestRender();
        };
        
        // Arch panel Slide controls (offset along slope direction)
        document.getElementById('sl-arch-panel-offset-y').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.archPanelSlide = val;
            document.getElementById('nb-arch-panel-offset-y').value = val;
            requestRender();
        };
        document.getElementById('nb-arch-panel-offset-y').onchange = e => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = 0;
            state.solarPanels.archPanelSlide = val;
            document.getElementById('sl-arch-panel-offset-y').value = val;
            e.target.value = val;
            requestRender();
        };
        
        // Arch panel A/B Separation controls
        document.getElementById('sl-arch-panel-sep').oninput = e => {
            const val = parseFloat(e.target.value);
            state.solarPanels.archPanelSeparation = val;
            document.getElementById('nb-arch-panel-sep').value = val;
            requestRender();
        };
        document.getElementById('nb-arch-panel-sep').onchange = e => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = 0;
            state.solarPanels.archPanelSeparation = val;
            document.getElementById('sl-arch-panel-sep').value = val;
            e.target.value = val;
            requestRender();
        };
        
    }


const _moduleExports = {
    initSolarPanelHandlers,
};

bridgeGlobals(_moduleExports, 'solarPanelInput');

export { initSolarPanelHandlers };
