// ============================================================================
// LINKAGE LAB - Hardware sidebar UI initialization (lumber pricing, bracket, bolt, washer)
// Depends on global: state, unitConverter, formatNumber, updateAutoBoltLengths, calculateTotalVBeamWidth
// ============================================================================
(function (g) {
    'use strict';

    function initAutoLumberPricing() {
        const autoCheckbox = document.getElementById('chk-auto-lumber-pricing');
        const refPricingDiv = document.getElementById('ref-beam-pricing');
        const pricingLabel = document.getElementById('pricing-mode-label');
        const hCostInput = document.getElementById('nb-cost-hbeam');
        const vCostInput = document.getElementById('nb-cost-vbeam');
        const refWidthInput = document.getElementById('nb-ref-beam-w');
        const refThickInput = document.getElementById('nb-ref-beam-t');
        const refLengthInput = document.getElementById('nb-ref-beam-len');
        const refPriceInput = document.getElementById('nb-ref-beam-price');
        
        // Toggle auto-pricing mode
        function updatePricingMode() {
            const isAuto = state.autoLumberPricing;
            if (refPricingDiv) refPricingDiv.style.display = isAuto ? 'block' : 'none';
            if (pricingLabel) pricingLabel.textContent = isAuto ? '(auto-calculated)' : '(manual)';
            if (hCostInput) hCostInput.readOnly = isAuto;
            if (vCostInput) vCostInput.readOnly = isAuto;
            // Style read-only inputs
            if (hCostInput) hCostInput.style.opacity = isAuto ? '0.7' : '1';
            if (vCostInput) vCostInput.style.opacity = isAuto ? '0.7' : '1';
            if (isAuto) updateAutoBeamPricing();
        }
        
        // Handle auto checkbox change
        if (autoCheckbox) {
            autoCheckbox.checked = state.autoLumberPricing;
            autoCheckbox.addEventListener('change', e => {
                state.autoLumberPricing = e.target.checked;
                updatePricingMode();
                requestRender();
            });
        }
        
        // Handle reference beam changes
        function handleRefChange() {
            if (refWidthInput) state.refBeamWidth = unitConverter.inputDisplayToImperial('nb-ref-beam-w', parseFloat(refWidthInput.value) || 3.5);
            if (refThickInput) state.refBeamThick = unitConverter.inputDisplayToImperial('nb-ref-beam-t', parseFloat(refThickInput.value) || 1.5);
            if (refLengthInput) state.refBeamLength = unitConverter.inputDisplayToImperial('nb-ref-beam-len', parseFloat(refLengthInput.value) || 8);
            if (refPriceInput) state.refBeamPrice = parseFloat(refPriceInput.value) || 5.48;
            if (state.autoLumberPricing) {
                updateAutoBeamPricing();
                requestRender();
            }
        }
        
        if (refWidthInput) refWidthInput.addEventListener('change', handleRefChange);
        if (refThickInput) refThickInput.addEventListener('change', handleRefChange);
        if (refLengthInput) refLengthInput.addEventListener('change', handleRefChange);
        if (refPriceInput) refPriceInput.addEventListener('change', handleRefChange);
        
        // Initialize reference inputs from state
        if (refWidthInput) refWidthInput.value = state.refBeamWidth;
        if (refThickInput) refThickInput.value = state.refBeamThick;
        if (refLengthInput) refLengthInput.value = state.refBeamLength;
        if (refPriceInput) refPriceInput.value = state.refBeamPrice;
        
        // Handle manual cost input - disable auto mode when user manually edits
        if (hCostInput) {
            hCostInput.addEventListener('change', e => {
                if (!state.autoLumberPricing) {
                    state.costHBeam = parseFloat(e.target.value) || 0;
                    requestRender();
                }
            });
        }
        if (vCostInput) {
            vCostInput.addEventListener('change', e => {
                if (!state.autoLumberPricing) {
                    state.costVBeam = parseFloat(e.target.value) || 0;
                    requestRender();
                }
            });
        }
        
        // Initial setup
        updatePricingMode();
    }
    
    // Update bracket hole position display
    function updateBracketHoleDistance() {
        const holeDistanceEl = document.getElementById('nb-bracket-hole-distance');
        if (holeDistanceEl) {
            holeDistanceEl.value = formatNumber(state.bracketHoleDistance !== undefined ? state.bracketHoleDistance : 1.5, 2);
        }
    }
    
    // Initialize bracket configuration UI
    function initBracketConfig() {
        // Set initial values from state
        const widthInput = document.getElementById('nb-bracket-width');
        const depthInput = document.getElementById('nb-bracket-depth');
        const heightInput = document.getElementById('nb-bracket-height');
        const wallInput = document.getElementById('nb-bracket-wall');
        const innerInput = document.getElementById('nb-bracket-inner');
        const holeDiameterSelect = document.getElementById('sel-bracket-hole-diameter');
        const zRotSlider = document.getElementById('sl-bracket-z-rotation');
        const zRotNumber = document.getElementById('nb-bracket-z-rotation');
        
        if (widthInput) widthInput.value = state.bracketWidth || 2.0;
        if (depthInput) depthInput.value = state.bracketDepth || 3.0;
        if (heightInput) heightInput.value = state.bracketHeight || 3.0;
        if (wallInput) wallInput.value = state.bracketWallThickness || 0.25;
        if (innerInput) innerInput.value = state.bracketInnerWidth || 1.5;
        if (holeDiameterSelect) holeDiameterSelect.value = state.bracketHoleDiameter || 0.375;
        if (zRotSlider) zRotSlider.value = state.bracketZRotation || 0;
        if (zRotNumber) zRotNumber.value = state.bracketZRotation || 0;
        
        // Update hole distance display
        updateBracketHoleDistance();
    }
    
    // Initialize bolt configuration UI
    function initBoltConfig() {
        // Set initial values from state
        const diameterSelect = document.getElementById('sel-bolt-diameter');
        if (diameterSelect) diameterSelect.value = state.boltDiameter;
        
        const vBoltLengthInput = document.getElementById('nb-vbolt-length');
        const hBoltLengthInput = document.getElementById('nb-hbolt-length');
        const hPivotBoltLengthInput = document.getElementById('nb-hpivot-bolt-length');
        const vBoltAutoChk = document.getElementById('chk-vbolt-auto');
        const hBoltAutoChk = document.getElementById('chk-hbolt-auto');
        const hPivotBoltAutoChk = document.getElementById('chk-hpivot-bolt-auto');
        
        // Inner/outer bolt controls
        const vBoltInnerInput = document.getElementById('nb-vbolt-inner-length');
        const vBoltOuterInput = document.getElementById('nb-vbolt-outer-length');
        const vBoltInnerAutoChk = document.getElementById('chk-vbolt-inner-auto');
        const vBoltOuterAutoChk = document.getElementById('chk-vbolt-outer-auto');
        
        // Bolt cost inputs
        const costBoltV = document.getElementById('nb-cost-bolt-v');
        const costBoltH = document.getElementById('nb-cost-bolt-h');
        const costBoltVInner = document.getElementById('nb-cost-bolt-vinner');
        const costBoltVOuter = document.getElementById('nb-cost-bolt-vouter');
        const costBoltH2 = document.getElementById('nb-cost-bolt-h2');
        
        if (vBoltAutoChk) vBoltAutoChk.checked = state.vBoltAuto;
        if (hBoltAutoChk) hBoltAutoChk.checked = state.hBoltAuto;
        if (hPivotBoltAutoChk) hPivotBoltAutoChk.checked = state.hPivotBoltAuto;
        if (vBoltLengthInput) vBoltLengthInput.disabled = state.vBoltAuto;
        if (hBoltLengthInput) hBoltLengthInput.disabled = state.hBoltAuto;
        if (hPivotBoltLengthInput) hPivotBoltLengthInput.disabled = state.hPivotBoltAuto;
        
        // Initialize inner/outer auto checkboxes (default to true)
        if (vBoltInnerAutoChk) vBoltInnerAutoChk.checked = true;
        if (vBoltOuterAutoChk) vBoltOuterAutoChk.checked = true;
        if (vBoltInnerInput) vBoltInnerInput.disabled = true;
        if (vBoltOuterInput) vBoltOuterInput.disabled = true;
        
        // Initialize bolt cost inputs
        if (costBoltV) costBoltV.value = state.costBoltVInner || 0.75;
        if (costBoltH) costBoltH.value = state.costBoltH || 0.75;
        if (costBoltVInner) costBoltVInner.value = state.costBoltVInner || 0.75;
        if (costBoltVOuter) costBoltVOuter.value = state.costBoltVOuter || 0.50;
        if (costBoltH2) costBoltH2.value = state.costBoltH || 0.75;
        
        // Initialize H-pivot bolt cost inputs
        const costBoltHPivot = document.getElementById('nb-cost-bolt-hpivot');
        const costBoltHPivot2 = document.getElementById('nb-cost-bolt-hpivot2');
        if (costBoltHPivot) costBoltHPivot.value = state.costBoltHPivot || 0.75;
        if (costBoltHPivot2) costBoltHPivot2.value = state.costBoltHPivot || 0.75;
        
        // Calculate initial auto bolt lengths and update UI visibility
        updateAutoBoltLengths();
    }
    
    // Initialize washer configuration
    function initWasherConfig() {
        // V-washer controls
        const vWasherEnabledChk = document.getElementById('chk-vwasher-enabled');
        const vWasherIDInput = document.getElementById('nb-vwasher-id');
        const vWasherODInput = document.getElementById('nb-vwasher-od');
        const vWasherThicknessInput = document.getElementById('nb-vwasher-thickness');
        const vWasherAutoChk = document.getElementById('chk-vwasher-auto');
        const vWasherConfigDiv = document.getElementById('vwasher-config');
        
        // H-washer controls
        const hWasherEnabledChk = document.getElementById('chk-hwasher-enabled');
        const hWasherIDInput = document.getElementById('nb-hwasher-id');
        const hWasherODInput = document.getElementById('nb-hwasher-od');
        const hWasherThicknessInput = document.getElementById('nb-hwasher-thickness');
        const hWasherAutoChk = document.getElementById('chk-hwasher-auto');
        const hWasherConfigDiv = document.getElementById('hwasher-config');
        
        // Washer cost inputs
        const costWasherVInput = document.getElementById('nb-cost-washer-v');
        const costWasherHInput = document.getElementById('nb-cost-washer-h');
        
        // Initialize V-washer
        if (vWasherEnabledChk) vWasherEnabledChk.checked = state.vWasherEnabled || false;
        if (vWasherConfigDiv) vWasherConfigDiv.style.display = (state.vWasherEnabled || false) ? 'block' : 'none';
        if (vWasherIDInput) vWasherIDInput.value = (state.vWasherID || 0.4375).toFixed(3);
        if (vWasherODInput) vWasherODInput.value = (state.vWasherOD || 1.0).toFixed(2);
        if (vWasherAutoChk) vWasherAutoChk.checked = state.vWasherAuto !== false;
        if (vWasherThicknessInput) {
            // Thickness will be calculated by updateAutoBoltLengths() if auto is enabled
            // Just set the UI value here
            vWasherThicknessInput.value = (state.vWasherThickness || 0).toFixed(3);
            vWasherThicknessInput.disabled = state.vWasherAuto;
        }
        
        // Initialize H-washer
        if (hWasherEnabledChk) hWasherEnabledChk.checked = state.hWasherEnabled || false;
        if (hWasherConfigDiv) hWasherConfigDiv.style.display = (state.hWasherEnabled || false) ? 'block' : 'none';
        if (hWasherIDInput) hWasherIDInput.value = (state.hWasherID || 0.4375).toFixed(3);
        if (hWasherODInput) hWasherODInput.value = (state.hWasherOD || 1.0).toFixed(2);
        if (hWasherAutoChk) hWasherAutoChk.checked = state.hWasherAuto !== false;
        if (hWasherThicknessInput) {
            // Thickness will be calculated by updateAutoBoltLengths() if auto is enabled
            // Just set the UI value here
            hWasherThicknessInput.value = (state.hWasherThickness || 0).toFixed(3);
            hWasherThicknessInput.disabled = state.hWasherAuto;
        }
        
        // Initialize washer costs
        if (costWasherVInput) costWasherVInput.value = (state.costWasherV || 0.10).toFixed(2);
        if (costWasherHInput) costWasherHInput.value = (state.costWasherH || 0.10).toFixed(2);
        
        // Update auto washer thicknesses after initialization
        // This ensures proper calculation based on bracket inner width for vertical washers
        if (state.vWasherAuto && state.vWasherEnabled) {
            const bracketInnerWidth = state.bracketInnerWidth || 1.5;
            const vStackCount = state.vStackCount || 3;
            
            if (vStackCount > 1) {
                const totalBeamWidth = calculateTotalVBeamWidth();
                const availableSpace = bracketInnerWidth;
                const extraSpace = availableSpace - totalBeamWidth;
                const washerThickness = Math.max(0, extraSpace / (vStackCount - 1));
                state.vWasherThickness = washerThickness;
                state.vStackGap = washerThickness;
                
                if (vWasherThicknessInput) vWasherThicknessInput.value = washerThickness.toFixed(3);
                const vStackGapInput = document.getElementById('nb-vgap');
                if (vStackGapInput) vStackGapInput.value = washerThickness.toFixed(2);
            }
        }
    }
    

    function initHardwareUI() {
        initAutoLumberPricing();
        initBracketConfig();
        initBoltConfig();
        initWasherConfig();
    }

    g.LinkageModules = g.LinkageModules || {};
    g.LinkageModules.hardwareUiInit = { initHardwareUI, updateBracketHoleDistance };
    g.initHardwareUI = initHardwareUI;
    g.updateBracketHoleDistance = updateBracketHoleDistance;

})(window);

