// ============================================================================
// LINKAGE LAB — Radial array sidebar UI (ES module)
//
// Owns the checkboxes of the "Radial Array" group, the live readout, and the
// performance guard that switches heavy render options (Full Detail, Shadows,
// Physics Check) off while the array is active and restores them afterwards.
// The numeric inputs (count, radius, spacing, angles, height) are bound through
// the regular idMap/updateState path (see dom-setup.js + state-sync.js).
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { invalidateGeometryCache } from './cache.js';
import { requestRender } from './render-app.js';
import { syncUI } from './state-sync.js';
import { saveStateToHistory } from './history.js';
import { formatNumber } from './math.js';
import { setNumericInputValue } from './numeric-input.js';
import { isRadialArrayActive } from './radial-array.js';

/**
 * Render options that are too heavy to keep on for N copies of the structure.
 * (Physics Check stays available: collisions are evaluated on the single
 * solver structure, which the array only copies.)
 */
const RADIAL_HEAVY_TOGGLES = [
    { key: 'showHardwareFullDetail', id: 'chk-hw-full-detail', label: 'Full Detail' },
    { key: 'shadowsEnabled',         id: 'chk-shadows',        label: 'Shadows' },
];
const GUARD_TITLE = 'Switched off while the radial array is active (too heavy for many copies)';

function $(id) { return document.getElementById(id); }

/** Flip a checkbox and run its normal change handler so all side effects apply. */
function setCheckboxAndFire(el, checked) {
    if (!el) return;
    el.checked = checked;
    el.dispatchEvent(new Event('change'));
}

/**
 * Forces the heavy toggles off while the array is active, remembering which
 * ones the user had on so they come back when the array is disabled.
 * Safe to call repeatedly (idempotent for a given active/inactive state).
 */
function applyRadialArrayPerformanceGuards() {
    const active = isRadialArrayActive(state);
    if (active) {
        if (!state._radialHeavyRestore) state._radialHeavyRestore = {};
        RADIAL_HEAVY_TOGGLES.forEach(t => {
            const el = $(t.id);
            if (state[t.key]) {
                state._radialHeavyRestore[t.key] = true;
                if (el) setCheckboxAndFire(el, false);
                else state[t.key] = false;
            }
            if (el) {
                el.disabled = true;
                const label = el.closest('label');
                if (label) {
                    if (label.dataset.origTitle === undefined) label.dataset.origTitle = label.title || '';
                    label.title = GUARD_TITLE;
                    label.style.opacity = '0.55';
                }
            }
        });
    } else {
        const restore = state._radialHeavyRestore || {};
        RADIAL_HEAVY_TOGGLES.forEach(t => {
            const el = $(t.id);
            if (el) {
                el.disabled = false;
                const label = el.closest('label');
                if (label) {
                    if (label.dataset.origTitle !== undefined) label.title = label.dataset.origTitle;
                    label.style.opacity = '';
                }
            }
            if (restore[t.key]) {
                if (el) setCheckboxAndFire(el, true);
                else state[t.key] = true;
            }
        });
        state._radialHeavyRestore = null;
    }
}

/**
 * Headless variant used when a config is applied without a DOM (or before the
 * sidebar exists): just make the state consistent with the array being active.
 */
function normalizeRadialArrayState() {
    if (!isRadialArrayActive(state)) return;
    RADIAL_HEAVY_TOGGLES.forEach(t => { state[t.key] = false; });
    state._radialHeavyRestore = null;
}

/** Push state into the radial-array controls (checkboxes, visibility, hints, readout). */
function syncRadialArrayUI() {
    const enabled = !!state.radialArrayEnabled;
    const chkEnabled = $('chk-radial-arr-enabled');
    if (chkEnabled) chkEnabled.checked = enabled;
    const chkCenter = $('chk-radial-arr-center');
    if (chkCenter) chkCenter.checked = state.radialCenter !== false;
    const chkRotate = $('chk-radial-arr-rotate');
    if (chkRotate) chkRotate.checked = state.radialRotateCopies !== false;
    const chkAuto = $('chk-radial-arr-auto-radius');
    if (chkAuto) chkAuto.checked = state.radialRadiusAuto !== false;

    const controls = $('radial-array-controls');
    if (controls) controls.style.display = enabled ? 'block' : 'none';

    const radiusInput = $('nb-radial-arr-radius');
    if (radiusInput) {
        const auto = state.radialRadiusAuto !== false;
        radiusInput.readOnly = auto;
        radiusInput.style.opacity = auto ? '0.55' : '';
        radiusInput.title = auto ? 'Computed from the structure footprint (untick Auto Ring Radius to edit)' : '';
    }

    const hint = $('radial-array-mode-hint');
    if (hint) {
        hint.textContent = state.orientation === 'vertical'
            ? 'Vertical arches are placed on radial planes around the anchor, sweeping a toroid. Combine with Array Count for a segmented toroid.'
            : 'Horizontal structures tile around the anchor (e.g. 6 hexagons around a 7th = honeycomb).';
    }

    ['radialCount', 'radialRadius', 'radialSpacing', 'radialStartAngle', 'radialSpin', 'radialHeightOffset']
        .forEach(k => syncUI(k, { force: true }));

    applyRadialArrayPerformanceGuards();
}

/**
 * Called after each render with the assembled geometry: shows the resolved
 * ring radius / copy count and mirrors the auto radius into the radius box.
 */
function updateRadialArrayReadout(data) {
    const readout = $('radial-array-readout');
    const plan = data && data.radialArray;
    if (!plan) {
        if (readout) readout.textContent = '';
        state._radialLastAutoRadius = null;
        return;
    }
    state._radialLastAutoRadius = plan.autoRadius;
    const uc = globalThis.unitConverter;
    const toDisplay = (inches) => (uc ? uc.imperialToDisplay(inches, 'in') : inches);
    const unit = uc ? uc.getDisplayUnit('in') : 'in';
    if (state.radialRadiusAuto !== false) {
        const el = $('nb-radial-arr-radius');
        if (el) setNumericInputValue(el, formatNumber(toDisplay(plan.radius), 2), { force: true });
    }
    if (readout) {
        const copies = plan.copyCount;
        const shape = plan.orientation === 'vertical' ? 'toroid' : 'ring';
        readout.textContent =
            `${copies} ${copies === 1 ? 'copy' : 'copies'} (${plan.count} on the ${shape}` +
            `${state.radialCenter !== false ? ' + center' : ''}) · ring radius ` +
            `${formatNumber(toDisplay(plan.radius), 1)} ${unit}` +
            `${state.radialRadiusAuto !== false ? ' (auto)' : ''} · ` +
            `${data.beams ? data.beams.length : 0} beams`;
    }
}

function commitAndRender() {
    invalidateGeometryCache();
    saveStateToHistory();
    requestRender();
}

/** Wire the checkboxes. Numeric inputs are bound by initSliderBindings via idMap. */
function initRadialArrayUI() {
    const chkEnabled = $('chk-radial-arr-enabled');
    if (chkEnabled) chkEnabled.onchange = e => {
        state.radialArrayEnabled = e.target.checked;
        syncRadialArrayUI();
        commitAndRender();
    };
    const chkCenter = $('chk-radial-arr-center');
    if (chkCenter) chkCenter.onchange = e => {
        state.radialCenter = e.target.checked;
        commitAndRender();
    };
    const chkRotate = $('chk-radial-arr-rotate');
    if (chkRotate) chkRotate.onchange = e => {
        state.radialRotateCopies = e.target.checked;
        commitAndRender();
    };
    const chkAuto = $('chk-radial-arr-auto-radius');
    if (chkAuto) chkAuto.onchange = e => {
        state.radialRadiusAuto = e.target.checked;
        // Start manual editing from the last auto value so the pattern doesn't jump.
        if (!state.radialRadiusAuto && typeof state._radialLastAutoRadius === 'number') {
            state.radialRadius = state._radialLastAutoRadius;
        }
        syncRadialArrayUI();
        commitAndRender();
    };
    syncRadialArrayUI();
}

const _moduleExports = {
    RADIAL_HEAVY_TOGGLES,
    initRadialArrayUI,
    syncRadialArrayUI,
    applyRadialArrayPerformanceGuards,
    normalizeRadialArrayState,
    updateRadialArrayReadout,
};

bridgeGlobals(_moduleExports, 'radialArrayUi');

export {
    RADIAL_HEAVY_TOGGLES,
    initRadialArrayUI,
    syncRadialArrayUI,
    applyRadialArrayPerformanceGuards,
    normalizeRadialArrayState,
    updateRadialArrayReadout,
};
