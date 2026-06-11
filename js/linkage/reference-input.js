// ============================================================================
// LINKAGE LAB - Measurement / human scale / IBC sidebar handlers
// Depends on global: state, render, renderPending, requestRender, syncIbcStackControlsVisibility, INCHES_PER_METER
// ============================================================================
(function (g) {
    'use strict';

    function initReferenceInputHandlers() {
        document.getElementById('chk-measure').onchange = e => {
            state.measureMode = e.target.checked;
            document.getElementById('measure-display').style.display = state.measureMode ? 'block' : 'none';
            // Force immediate render for instant feedback
            renderPending = false;
            render();
        };
        document.getElementById('chk-human-scale').onchange = e => {
            state.showHumanScale = e.target.checked;
            // Force immediate render for instant feedback
            renderPending = false;
            render();
        };
        const chkIbcGlb = document.getElementById('chk-ibc-glb');
        if (chkIbcGlb) chkIbcGlb.onchange = e => {
            state.ibc.enabled = e.target.checked;
            ibcStackLayoutCacheKey = '';
            renderPending = false;
            render();
        };
        const selIbcCountEl = document.getElementById('sel-ibc-count');
        if (selIbcCountEl) selIbcCountEl.onchange = e => {
            state.ibc.count = Math.min(2, Math.max(0, parseInt(e.target.value, 10) || 0));
            ibcStackLayoutCacheKey = '';
            syncIbcStackControlsVisibility();
            renderPending = false;
            render();
        };
        const slIbcGap = document.getElementById('sl-ibc-stack-gap');
        const nbIbcGap = document.getElementById('nb-ibc-stack-gap');
        if (slIbcGap && nbIbcGap) {
            slIbcGap.oninput = e => {
                const v = parseFloat(e.target.value) || 0;
                state.ibc.stackGapIn = v;
                nbIbcGap.value = v;
                requestRender();
            };
            nbIbcGap.onchange = e => {
                let v = parseFloat(e.target.value) || 0;
                v = Math.max(0, Math.min(48, v));
                state.ibc.stackGapIn = v;
                slIbcGap.value = v;
                e.target.value = v;
                requestRender();
            };
        }
        const slIbcA = document.getElementById('sl-ibc-offset-a');
        const nbIbcA = document.getElementById('nb-ibc-offset-a');
        if (slIbcA && nbIbcA) {
            slIbcA.oninput = e => {
                const v = parseFloat(e.target.value) || 0;
                state.ibc.verticalOffsetAIn = v;
                nbIbcA.value = v;
                requestRender();
            };
            nbIbcA.onchange = e => {
                let v = parseFloat(e.target.value) || 0;
                v = Math.max(-48, Math.min(48, v));
                state.ibc.verticalOffsetAIn = v;
                slIbcA.value = v;
                e.target.value = v;
                requestRender();
            };
        }
        const slIbcB = document.getElementById('sl-ibc-offset-b');
        const nbIbcB = document.getElementById('nb-ibc-offset-b');
        if (slIbcB && nbIbcB) {
            slIbcB.oninput = e => {
                const v = parseFloat(e.target.value) || 0;
                state.ibc.verticalOffsetBIn = v;
                nbIbcB.value = v;
                requestRender();
            };
            nbIbcB.onchange = e => {
                let v = parseFloat(e.target.value) || 0;
                v = Math.max(-48, Math.min(48, v));
                state.ibc.verticalOffsetBIn = v;
                slIbcB.value = v;
                e.target.value = v;
                requestRender();
            };
        }
        const slIbcRot = document.getElementById('sl-ibc-rotation');
        const nbIbcRot = document.getElementById('nb-ibc-rotation');
        if (slIbcRot && nbIbcRot) {
            slIbcRot.oninput = e => {
                const v = parseFloat(e.target.value) || 0;
                state.ibc.rotationYDeg = v;
                nbIbcRot.value = v;
                requestRender();
            };
            nbIbcRot.onchange = e => {
                let v = parseFloat(e.target.value) || 0;
                v = Math.max(-180, Math.min(180, v));
                state.ibc.rotationYDeg = v;
                slIbcRot.value = v;
                e.target.value = v;
                requestRender();
            };
        }
        const nbIbcScale = document.getElementById('nb-ibc-scale');
        if (nbIbcScale) nbIbcScale.onchange = e => {
            let v = parseFloat(e.target.value);
            if (!(v > 0)) v = INCHES_PER_METER;
            v = Math.max(0.01, Math.min(200, v));
            state.ibc.scale = v;
            e.target.value = v;
            requestRender();
        };
        syncIbcStackControlsVisibility();
    }

    g.LinkageModules = g.LinkageModules || {};
    g.LinkageModules.referenceInput = { initReferenceInputHandlers };
    g.initReferenceInputHandlers = initReferenceInputHandlers;

})(window);

