// ============================================================================ (ES module)

import { bridgeGlobals } from './global-bridge.js';
import { DEBOUNCE_DELAY } from './constants.js';
import { degToRad, radToDeg, formatNumber, debounce } from './math.js';
import { getOptimalClosedAngleForAnimation } from './joint-kinematics.js';
import {
    isVBeamDimensionsLinked,
    syncLinkedVBeamDimensions,
    updateVBeamDimensionUIVisibility,
    updateAutoBoltLengths,
} from './beam-bolt-helpers.js';
import { solveLinkage, getEffectiveMinFoldAngle, updateAutoBeamPricing } from './solver.js';
import { detectCollisions, findSafeFoldAngle } from './collision.js';
import { invalidateGeometryCache, invalidateRcpCrossings } from './cache.js';
import { validateInput } from './validation.js';
import { saveStateToHistory } from './history.js';

    function updateState(key, val) {
        try {
            // Convert display value back to imperial before validation/storage
            let rawVal = parseFloat(val);
            const impUnit = unitConverter.getUnitForStateKey(key);
            if (impUnit && !isNaN(rawVal)) {
                rawVal = unitConverter.displayToImperial(rawVal, impUnit);
                val = rawVal;
            }
    
            const validation = validateInput(key, val);
            const k = Object.keys(idMap).find(k => idMap[k] === key);
            if (!validation.valid) {
                showToast(validation.error, 'error');
                if (k && inputs[k]) {
                    inputs[k].nb?.classList.add('error');
                    setTimeout(() => inputs[k].nb?.classList.remove('error'), 2000);
                }
            } else if (k && inputs[k]?.nb) {
                inputs[k].nb.classList.remove('error');
            }
            
            const value = validation.value;
            const previousFoldAngle = state.foldAngle; // Store for collision limiting
            if (key === 'foldAngle') {
                state.foldAngle = Math.max(getEffectiveMinFoldAngle(), degToRad(value));
            } else {
                state[key] = value;
            }
    
            if (isVBeamDimensionsLinked() && (key === 'vBeamW' || key === 'vBeamT')) {
                syncLinkedVBeamDimensions();
                ['vBeamInnerW', 'vBeamInnerT', 'vBeamOuterW', 'vBeamOuterT'].forEach(k => syncUI(k));
            }
    
            if (key === 'vStackCount' && value !== 3) {
                state.vBeamDimensionsLinked = true;
                updateVBeamDimensionUIVisibility();
            }
            
            // Sync washer thickness with gaps when auto is enabled
            // For V-washers in auto mode, gap is calculated from bracket inner width (handled by updateAutoBoltLengths)
            // For H-washers in auto mode, thickness simply matches the stack gap
            if (key === 'hStackGap' && state.hWasherAuto && state.hWasherEnabled) {
                state.hWasherThickness = value;
                const hWasherThicknessInput = document.getElementById('nb-hwasher-thickness');
                if (hWasherThicknessInput) hWasherThicknessInput.value = value.toFixed(3);
            }
            // Note: vStackGap sync is handled by updateAutoBoltLengths() which calculates from bracket inner width
            
            syncUI(key);
            
            // Invalidate cache when geometry-changing parameters are updated
            const geometryKeys = ['modules', 'hLengthFt', 'vLengthFt', 'pivotPct', 'hobermanAng', 'pivotAng',
                                  'hStackCount', 'vStackCount', 'vStackReverse', 'offsetTopIn', 'offsetBotIn', 'vertEndOffset',
                                  'bracketHeight', 'hStackGap', 'vStackGap', 'hBeamW', 'hBeamT', 'vBeamW', 'vBeamT',
                                  'vBeamInnerW', 'vBeamInnerT', 'vBeamOuterW', 'vBeamOuterT', 'vBeamDimensionsLinked', 'foldAngle', 'orientation', 
                                  'archCapUprights', 'useFixedBeams', 'archFlipVertical', 'archRotation', 'arrayCount',
                                  'bracketWidth', 'bracketDepth', 'bracketHeight', 'bracketWallThickness', 'bracketInnerWidth', 
                                  'bracketHoleDiameter', 'bracketHoleDistance'];
            // Any structural parameter change (module count, beam lengths, etc.) moves
            // the top ring â€” the reciprocal crossing references must be re-seeded.
            // foldAngle is explicitly excluded: crossing refs are fold-angle-independent.
            const rcpInvalidKeys = ['modules', 'hLengthFt', 'vLengthFt', 'pivotPct', 'hobermanAng', 'pivotAng',
                                    'hStackCount', 'vStackCount', 'orientation', 'archFlipVertical', 'archRotation',
                                    'useFixedBeams', 'offsetTopIn', 'offsetBotIn'];
            if (rcpInvalidKeys.includes(key)) {
                invalidateRcpCrossings();
            }
            if (geometryKeys.includes(key)) {
                invalidateGeometryCache();
                
                // Update auto bolt lengths and washer thicknesses when relevant parameters change
                if (['hStackCount', 'vStackCount', 'hBeamT', 'vBeamW', 'vBeamT', 'hStackGap', 'vStackGap',
                     'bracketInnerWidth', 'vBeamInnerW', 'vBeamInnerT', 'vBeamOuterW', 'vBeamOuterT'].includes(key)) {
                    updateAutoBoltLengths();
                }
    
                if (key === 'vStackCount') {
                    updateVBeamDimensionUIVisibility();
                }
                
                // Regenerate roof face buttons when module count changes
                if (key === 'modules' && state.orientation === 'vertical' && state.solarPanels.enabled) {
                    // Reset roof faces array to match new module count (2 faces per module)
                    state.solarPanels.archWallFaces = new Array(state.modules * 2).fill(true);
                    generateWallFaceButtons();
                }
                
                // Also invalidate animation closed angle cache when relevant params change
                if (['modules', 'hLengthFt', 'pivotPct', 'hobermanAng', 'pivotAng', 'offsetTopIn', 'offsetBotIn'].includes(key)) {
                    state.animation.cachedClosedAngle = undefined;
                    // Update stop angle to closed angle when geometry changes
                    const closedAngle = getOptimalClosedAngleForAnimation();
                    state.animation.stopAngle = radToDeg(closedAngle);
                    // Update UI
                    const stopSlider = document.getElementById('sl-anim-stop');
                    const stopNumber = document.getElementById('nb-anim-stop');
                    if (stopSlider) stopSlider.value = state.animation.stopAngle;
                    if (stopNumber) stopNumber.value = state.animation.stopAngle;
                }
            }
            
            // Check collisions if enabled and limit fold angle if needed
            if (state.enforceCollision) {
                const data = solveLinkage(state.foldAngle);
                state.collisions = detectCollisions(data);
                state.hasCollision = state.collisions.length > 0;
                
                // If there are collisions and we're changing foldAngle, find safe angle
                if (key === 'foldAngle' && state.hasCollision) {
                    const safeAngle = findSafeFoldAngle(state.foldAngle, previousFoldAngle);
                    if (safeAngle !== null && Math.abs(safeAngle - state.foldAngle) > 0.01) {
                        state.foldAngle = safeAngle;
                        invalidateGeometryCache();
                        syncUI('foldAngle');
                    }
                }
            }
            
            // Update auto beam pricing when relevant dimensions change
            const beamPricingKeys = ['hBeamW', 'hBeamT', 'vBeamW', 'vBeamT', 'vBeamInnerW', 'vBeamInnerT', 'vBeamOuterW', 'vBeamOuterT', 'hLengthFt', 'vLengthFt'];
            if (beamPricingKeys.includes(key) && state.autoLumberPricing) {
                updateAutoBeamPricing();
            }
            
            saveStateToHistory();
            requestRender();
        } catch (error) {
            console.error('Update state error:', error);
            showToast('Error updating state', 'error');
        }
    }
    
    /**
     * Synchronizes UI elements with state
     * @param {string} key - State key to sync
     */
    function syncUI(key) {
        const k = Object.keys(idMap).find(k => idMap[k] === key);
        if (k && inputs[k]) {
            let v = state[key];
            if (key === 'foldAngle') v = radToDeg(v);
    
            // Convert to display units if this key has a physical unit
            const impUnit = unitConverter.getUnitForStateKey(key);
            if (impUnit) {
                v = unitConverter.imperialToDisplay(v, impUnit);
            }
    
            if (inputs[k].sl) inputs[k].sl.value = v;
            if (inputs[k].nb) {
                let decimals = 1;
                if (key.startsWith('cost')) {
                    decimals = 2;
                } else if (key.startsWith('bracket') || key === 'vStackGap' || key === 'hStackGap') {
                    decimals = 2;
                } else if (key === 'offsetTopIn' || key === 'offsetBotIn' || key === 'vertEndOffset') {
                    decimals = 2;
                } else if (['hBeamW', 'hBeamT', 'vBeamW', 'vBeamT', 'vBeamInnerW', 'vBeamInnerT', 'vBeamOuterW', 'vBeamOuterT'].includes(key)) {
                    decimals = 2;
                } else if (key === 'hLengthFt' || key === 'vLengthFt') {
                    decimals = 2;
                }
                // More decimals for metric meter values to preserve precision
                if (impUnit === 'ft' && unitConverter.getPreferredUnitSystem() === 'metric') {
                    decimals = 2;
                }
                inputs[k].nb.value = formatNumber(v, decimals);
            }
        }
    }
    
    /** Binds idMap slider/number inputs to updateState (call after inputs{} is populated). */
    function initSliderBindings() {
        Object.keys(idMap).forEach(k => {
            const key = idMap[k];
            if (inputs[k].sl) {
                inputs[k].sl.addEventListener('input', debounce(e => updateState(key, e.target.value), DEBOUNCE_DELAY));
            }
            if (inputs[k].nb) {
                if (inputs[k].sl) {
                    inputs[k].nb.addEventListener('input', debounce(e => updateState(key, e.target.value), DEBOUNCE_DELAY));
                } else {
                    inputs[k].nb.addEventListener('input', e => updateState(key, e.target.value));
                }
                inputs[k].nb.addEventListener('change', e => updateState(key, e.target.value));
            }
        });
    }


const _moduleExports = {
    updateState,
    syncUI,
    initSliderBindings,
};

bridgeGlobals(_moduleExports, 'stateSync');

export { updateState, syncUI, initSliderBindings };
