// ============================================================================
// LINKAGE LAB - Beam, bolt, and V-stack dimension helpers (ES module)
// Depends on global: state, unitConverter, formatNumber, setInputDisplay, requestRender, invalidateGeometryCache
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';

function getBoltRadius() {
        return (state.boltDiameter || 0.375) / 2;
    }
    
    /** Format bolt diameter as fraction string */
    function formatBoltDiameter(diameter) {
        const fractions = {
            0.25: '1/4',
            0.3125: '5/16',
            0.375: '3/8',
            0.5: '1/2',
            0.625: '5/8',
            0.75: '3/4'
        };
        return fractions[diameter] || diameter.toFixed(3);
    }
    
    /** Check if V-stack needs split bolt lengths (odd stack > 2) */
    function needsSplitVBolts() {
        const stackCount = state.vStackCount || 3;
        return stackCount > 2 && stackCount % 2 === 1;
    }
    
    /** Check if V-stack supports independent inner/outer beam dimensions (stack = 3) */
    function needsSplitVBeamDimensions() {
        return (state.vStackCount || 3) === 3;
    }
    
    /** Whether inner/outer V-beam dimensions are linked (same size for all beams) */
    function isVBeamDimensionsLinked() {
        if (!needsSplitVBeamDimensions()) return true;
        return state.vBeamDimensionsLinked !== false;
    }
    
    /** True when stack index is the center (inner) beam for a 3-beam V-stack */
    function isVStackInnerBeamIndex(stackIndex) {
        const count = state.vStackCount || 3;
        return count === 3 && stackIndex === Math.floor(count / 2);
    }
    
    /** Get beam width/thickness for a stack index (center = inner, sides = outer) */
    function getVBeamDimsForStackIndex(stackIndex) {
        if (!needsSplitVBeamDimensions() || isVBeamDimensionsLinked()) {
            return { w: state.vBeamW, t: state.vBeamT };
        }
        if (isVStackInnerBeamIndex(stackIndex)) {
            return { w: state.vBeamInnerW, t: state.vBeamInnerT };
        }
        return { w: state.vBeamOuterW, t: state.vBeamOuterT };
    }
    
    /** Get beam width/thickness for fixed straight beams (inner/outer pivot positions) */
    function getVBeamDimsForPivot(isInnerPivot) {
        if (!needsSplitVBeamDimensions() || isVBeamDimensionsLinked()) {
            return { w: state.vBeamW, t: state.vBeamT };
        }
        if (isInnerPivot) {
            return { w: state.vBeamInnerW, t: state.vBeamInnerT };
        }
        return { w: state.vBeamOuterW, t: state.vBeamOuterT };
    }
    
    /** Width of each beam in the vertical stack */
    function getVStackBeamWidths() {
        const count = state.vStackCount || 3;
        const widths = [];
        for (let i = 0; i < count; i++) {
            widths.push(getVBeamDimsForStackIndex(i).w);
        }
        return widths;
    }
    
    /** Total stack thickness including gaps */
    function calculateVStackTotalThickness(widths = null, gap = null) {
        const count = state.vStackCount || 3;
        const stackGap = gap !== null ? gap : (state.vStackGap || 0);
        if (!widths) {
            if (!needsSplitVBeamDimensions() || isVBeamDimensionsLinked()) {
                const vW = state.vBeamW;
                return count * vW + Math.max(0, count - 1) * stackGap;
            }
            widths = getVStackBeamWidths();
        }
        let total = widths.reduce((sum, w) => sum + w, 0);
        if (count > 1) total += (count - 1) * stackGap;
        return total;
    }
    
    /** Center offset of a beam within the vertical stack */
    function getVStackBeamCenterOffset(stackIndex, widths = null) {
        const count = state.vStackCount || 3;
        const gap = state.vStackGap || 0;
        if (!widths) {
            if (!needsSplitVBeamDimensions() || isVBeamDimensionsLinked()) {
                const vW = state.vBeamW;
                const totalThick = count * vW + (count - 1) * gap;
                const startOffset = -totalThick / 2 + vW / 2;
                return startOffset + stackIndex * (vW + gap);
            }
            widths = getVStackBeamWidths();
        }
        const totalThick = calculateVStackTotalThickness(widths, gap);
        let offset = -totalThick / 2;
        for (let i = 0; i < stackIndex; i++) {
            offset += widths[i] + gap;
        }
        offset += widths[stackIndex] / 2;
        return offset;
    }
    
    /** Sum of all beam widths in the vertical stack */
    function calculateTotalVBeamWidth() {
        if (!needsSplitVBeamDimensions() || isVBeamDimensionsLinked()) {
            return (state.vStackCount || 3) * (state.vBeamW || 1.5);
        }
        return getVStackBeamWidths().reduce((sum, w) => sum + w, 0);
    }
    
    /** Count inner/outer V-beams across all modules */
    function getVBeamCountsByType() {
        const moduleCount = state.modules;
        const stackCount = state.vStackCount || 3;
        if (!needsSplitVBeamDimensions() || isVBeamDimensionsLinked()) {
            return { inner: 0, outer: 0, total: moduleCount * stackCount, linked: true };
        }
        let innerPerModule = 0;
        let outerPerModule = 0;
        for (let i = 0; i < stackCount; i++) {
            if (isVStackInnerBeamIndex(i)) innerPerModule++;
            else outerPerModule++;
        }
        return {
            inner: moduleCount * innerPerModule,
            outer: moduleCount * outerPerModule,
            total: moduleCount * stackCount,
            linked: false
        };
    }
    
    /** Sum beam widths for a bolt sub-type (inner/outer/full) */
    function calculateVBoltStackBeamWidth(subType) {
        const stackCount = state.vStackCount || 3;
        if (!needsSplitVBeamDimensions() || isVBeamDimensionsLinked()) {
            let beamCount;
            if (subType === 'inner') beamCount = Math.ceil(stackCount / 2);
            else if (subType === 'outer') beamCount = Math.floor(stackCount / 2);
            else beamCount = stackCount;
            return beamCount * (state.vBeamW || 1.5);
        }
        let total = 0;
        for (let i = 0; i < stackCount; i++) {
            const dims = getVBeamDimsForStackIndex(i);
            if (subType === 'inner' && !isVStackInnerBeamIndex(i)) total += dims.w;
            else if (subType === 'outer' && isVStackInnerBeamIndex(i)) total += dims.w;
            else if (subType !== 'inner' && subType !== 'outer') total += dims.w;
        }
        return total;
    }
    
    /** Total weight of all vertical beams */
    function calculateVBeamTotalWeight() {
        const counts = getVBeamCountsByType();
        const vLength = state.vLengthFt;
        if (!counts.linked) {
            const innerPerFoot = (state.vBeamInnerW * state.vBeamInnerT * INCHES_PER_FOOT) * state.woodDensity;
            const outerPerFoot = (state.vBeamOuterW * state.vBeamOuterT * INCHES_PER_FOOT) * state.woodDensity;
            return (counts.inner * vLength * innerPerFoot) + (counts.outer * vLength * outerPerFoot);
        }
        const perFoot = (state.vBeamW * state.vBeamT * INCHES_PER_FOOT) * state.woodDensity;
        return counts.total * vLength * perFoot;
    }
    
    /** Average weight per vertical beam (for unit display) */
    function getVBeamWeightPerBeam() {
        const counts = getVBeamCountsByType();
        return counts.total > 0 ? calculateVBeamTotalWeight() / counts.total : 0;
    }
    
    /** Total cost of all vertical beams */
    function calculateVBeamsCost() {
        const counts = getVBeamCountsByType();
        if (!counts.linked) {
            const innerUnit = state.autoLumberPricing
                ? calculateBeamCostByVolume(state.vBeamInnerW, state.vBeamInnerT, state.vLengthFt)
                : state.costVBeam;
            const outerUnit = state.autoLumberPricing
                ? calculateBeamCostByVolume(state.vBeamOuterW, state.vBeamOuterT, state.vLengthFt)
                : state.costVBeam;
            return (counts.inner * innerUnit) + (counts.outer * outerUnit);
        }
        return counts.total * state.costVBeam;
    }
    
    /** Sync linked V-beam dimensions from the primary inputs */
    function syncLinkedVBeamDimensions() {
        state.vBeamInnerW = state.vBeamW;
        state.vBeamInnerT = state.vBeamT;
        state.vBeamOuterW = state.vBeamW;
        state.vBeamOuterT = state.vBeamT;
    }
    
    /** Update visibility of V-beam dimension link/split controls */
    function updateVBeamDimensionUIVisibility() {
        const showLink = needsSplitVBeamDimensions();
        const splitMode = showLink && !isVBeamDimensionsLinked();
        const linkBtn = document.getElementById('btn-vbeam-dim-link');
        const splitSection = document.getElementById('vbeam-split-section');
        if (linkBtn) linkBtn.style.display = showLink ? 'inline-flex' : 'none';
        if (splitSection) splitSection.style.display = splitMode ? 'block' : 'none';
        if (linkBtn) {
            linkBtn.classList.toggle('linked', isVBeamDimensionsLinked());
            linkBtn.classList.toggle('unlinked', !isVBeamDimensionsLinked());
            linkBtn.title = isVBeamDimensionsLinked()
                ? 'Beam dimensions linked — click to set inner/outer sizes independently'
                : 'Beam dimensions unlinked — click to link inner/outer sizes';
        }
    }
    
    /** Calculate auto bolt length for vertical stack (full stack - used for even stacks or center bolt) */
    function calculateVStackBoltLength() {
        const stackCount = state.vStackCount || 3;
        const stackGap = state.vStackGap || 0;
        const totalBeamWidth = (needsSplitVBeamDimensions() && !isVBeamDimensionsLinked())
            ? calculateTotalVBeamWidth()
            : stackCount * (state.vBeamW || 1.5);
        // Total thickness + 2x gap (for head/nut clearance)
        return totalBeamWidth + (Math.max(0, stackGap) * 2) + 1;
    }
    
    /** Calculate inner bolt length for V-stack (holds more beams at inner brackets) */
    function calculateVStackInnerBoltLength() {
        const stackCount = state.vStackCount || 3;
        const stackGap = state.vStackGap || 0;
        const innerBeamCount = Math.ceil(stackCount / 2);
        const totalBeamWidth = calculateVBoltStackBeamWidth('inner');
        return totalBeamWidth + (Math.max(0, stackGap)) + 1;
    }
    
    /** Calculate outer bolt length for V-stack (holds fewer beams at outer brackets) */
    function calculateVStackOuterBoltLength() {
        const stackCount = state.vStackCount || 3;
        const stackGap = state.vStackGap || 0;
        const totalBeamWidth = calculateVBoltStackBeamWidth('outer');
        return totalBeamWidth + (Math.max(0, stackGap)) + 1;
    }
    
    /** Calculate auto bolt length for horizontal stack center bolts */
    function calculateHStackBoltLength() {
        const stackCount = state.hStackCount || 2;
        const beamThickness = state.hBeamT || 1.5;
        const stackGap = state.hStackGap || 0;
        // Total thickness + extra for head/nut
        return (stackCount * beamThickness) + (Math.max(0, stackGap) * 2) + 1;
    }
    
    /** Calculate auto bolt length for horizontal pivot bolts (through H-beams into brackets) */
    function calculateHPivotBoltLength() {
        const stackCount = state.hStackCount || 2;
        const beamThickness = state.hBeamT || 1.5;
        const stackGap = state.hStackGap || 0;
        const bracketWallThickness = state.bracketWallThickness || 0.25;
        // Through H-beam stack + bracket wall + extra for head/nut
        const hStackTotal = (stackCount * beamThickness) + (Math.max(0, stackGap) * (stackCount - 1));
        return hStackTotal + bracketWallThickness + 1;
    }
    
    /** Update UI visibility for split/single bolt controls */
    function updateBoltUIVisibility() {
        const splitMode = needsSplitVBolts();
        
        // Toggle bolt length controls
        const singleRow = document.getElementById('vbolt-single-row');
        const splitSection = document.getElementById('vbolt-split-section');
        if (singleRow) singleRow.style.display = splitMode ? 'none' : 'flex';
        if (splitSection) splitSection.style.display = splitMode ? 'block' : 'none';
        
        // Toggle bolt cost controls
        const costSingle = document.getElementById('bolt-cost-single');
        const costSplit = document.getElementById('bolt-cost-split');
        if (costSingle) costSingle.style.display = splitMode ? 'none' : 'grid';
        if (costSplit) costSplit.style.display = splitMode ? 'block' : 'none';
        
        // Update bolt cost info text
        const costInfoEl = document.getElementById('bolt-cost-info');
        if (costInfoEl) {
            if (splitMode) {
                costInfoEl.textContent = `V-Stack ${state.vStackCount}: inner bolts hold ${Math.ceil(state.vStackCount/2)} beams, outer hold ${Math.floor(state.vStackCount/2)}`;
            } else {
                costInfoEl.textContent = '';
            }
        }
    }
    
    /** Update auto bolt lengths based on stack configuration */
    function updateAutoBoltLengths() {
        const infoEl = document.getElementById('bolt-auto-info');
        let infoText = '';
        const splitMode = needsSplitVBolts();
        const isM = unitConverter.getPreferredUnitSystem() === 'metric';
        const dFactor = isM ? unitConverter.IN_TO_MM : 1;
        const dUnit = isM ? 'mm' : '"';
    
        // Write an imperial state value to an input, converting to display units
        function setInputDisplay(inputId, imperialVal, decimals) {
            const el = document.getElementById(inputId);
            if (!el) return;
            el.value = (imperialVal * dFactor).toFixed(decimals);
        }
    
        updateBoltUIVisibility();
        
        if (splitMode) {
            const innerAutoChk = document.getElementById('chk-vbolt-inner-auto');
            const outerAutoChk = document.getElementById('chk-vbolt-outer-auto');
            
            if (innerAutoChk && innerAutoChk.checked) {
                state.vBoltInnerLength = calculateVStackInnerBoltLength();
                setInputDisplay('nb-vbolt-inner-length', state.vBoltInnerLength, 2);
            }
            
            if (outerAutoChk && outerAutoChk.checked) {
                state.vBoltOuterLength = calculateVStackOuterBoltLength();
                setInputDisplay('nb-vbolt-outer-length', state.vBoltOuterLength, 2);
            }
            
            state.vBoltLength = calculateVStackBoltLength();
            
            infoText += `V-Inner: ${Math.ceil(state.vStackCount/2)} beams = ${(state.vBoltInnerLength * dFactor).toFixed(2)}${dUnit} | `;
            infoText += `V-Outer: ${Math.floor(state.vStackCount/2)} beams = ${(state.vBoltOuterLength * dFactor).toFixed(2)}${dUnit}`;
        } else {
            if (state.vBoltAuto) {
                state.vBoltLength = calculateVStackBoltLength();
                setInputDisplay('nb-vbolt-length', state.vBoltLength, 2);
                infoText += `V-Stack: ${state.vStackCount} × ${(state.vBeamW * dFactor).toFixed(1)}${dUnit} = ${(state.vBoltLength * dFactor).toFixed(2)}${dUnit} bolt`;
            }
        }
        
        if (state.hBoltAuto) {
            state.hBoltLength = calculateHStackBoltLength();
            setInputDisplay('nb-hbolt-length', state.hBoltLength, 2);
            if (infoText) infoText += ' | ';
            infoText += `H-Center: ${state.hStackCount} × ${(state.hBeamT * dFactor).toFixed(1)}${dUnit} = ${(state.hBoltLength * dFactor).toFixed(2)}${dUnit}`;
        }
        
        if (state.hPivotBoltAuto) {
            state.hPivotBoltLength = calculateHPivotBoltLength();
            setInputDisplay('nb-hpivot-bolt-length', state.hPivotBoltLength, 2);
            if (infoText) infoText += ' | ';
            infoText += `H-Pivot: ${(state.hPivotBoltLength * dFactor).toFixed(2)}${dUnit}`;
        }
        
        updateVBeamDimensionUIVisibility();
    
        if (state.vWasherAuto && state.vWasherEnabled) {
            const bracketInnerWidth = state.bracketInnerWidth || 1.5;
            const vStackCount = state.vStackCount || 3;
            const totalBeamWidth = calculateTotalVBeamWidth();
            const extraSpace = bracketInnerWidth - totalBeamWidth;
            
            if (vStackCount > 1) {
                let washerThickness = extraSpace / (vStackCount - 1);
                if (washerThickness < 0) washerThickness = 0.125;
                
                state.vWasherThickness = washerThickness;
                state.vStackGap = washerThickness;
                
                setInputDisplay('nb-vwasher-thickness', state.vWasherThickness, 3);
                const vStackGapInput = document.getElementById('nb-vgap');
                if (vStackGapInput) vStackGapInput.value = (state.vStackGap * dFactor).toFixed(3);
            } else {
                state.vWasherThickness = 0;
                state.vStackGap = 0;
                setInputDisplay('nb-vwasher-thickness', 0, 3);
                const vStackGapInput = document.getElementById('nb-vgap');
                if (vStackGapInput) vStackGapInput.value = '0.00';
            }
        }
        
        if (state.hWasherAuto && state.hWasherEnabled) {
            state.hWasherThickness = state.hStackGap || 0;
            setInputDisplay('nb-hwasher-thickness', state.hWasherThickness, 3);
        }
        
        if (infoEl) infoEl.textContent = infoText;
    }
    

const beamBoltExports = {
    getBoltRadius,
    formatBoltDiameter,
    needsSplitVBolts,
    needsSplitVBeamDimensions,
    isVBeamDimensionsLinked,
    isVStackInnerBeamIndex,
    getVBeamDimsForStackIndex,
    getVBeamDimsForPivot,
    getVStackBeamWidths,
    calculateVStackTotalThickness,
    getVStackBeamCenterOffset,
    calculateTotalVBeamWidth,
    getVBeamCountsByType,
    calculateVBoltStackBeamWidth,
    calculateVBeamTotalWeight,
    getVBeamWeightPerBeam,
    calculateVBeamsCost,
    syncLinkedVBeamDimensions,
    updateVBeamDimensionUIVisibility,
    calculateVStackBoltLength,
    calculateVStackInnerBoltLength,
    calculateVStackOuterBoltLength,
    calculateHStackBoltLength,
    calculateHPivotBoltLength,
    updateBoltUIVisibility,
    updateAutoBoltLengths
};

bridgeGlobals(beamBoltExports, 'beamBoltHelpers');

export {
    getBoltRadius,
    formatBoltDiameter,
    needsSplitVBolts,
    needsSplitVBeamDimensions,
    isVBeamDimensionsLinked,
    isVStackInnerBeamIndex,
    getVBeamDimsForStackIndex,
    getVBeamDimsForPivot,
    getVStackBeamWidths,
    calculateVStackTotalThickness,
    getVStackBeamCenterOffset,
    calculateTotalVBeamWidth,
    getVBeamCountsByType,
    calculateVBoltStackBeamWidth,
    calculateVBeamTotalWeight,
    getVBeamWeightPerBeam,
    calculateVBeamsCost,
    syncLinkedVBeamDimensions,
    updateVBeamDimensionUIVisibility,
    calculateVStackBoltLength,
    calculateVStackInnerBoltLength,
    calculateVStackOuterBoltLength,
    calculateHStackBoltLength,
    calculateHPivotBoltLength,
    updateBoltUIVisibility,
    updateAutoBoltLengths
};

