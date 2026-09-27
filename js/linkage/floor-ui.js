// ============================================================================
// LINKAGE LAB — Floor sidebar (raised floor beams + deck)
// Depends on globals: state, scheduleAutoSave (optional)
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { requestRender } from './render-app.js';
import { saveStateToHistory } from './history.js';
import { createDefaultFloor, computeFloorBomContribution, describeFloorSeating, OFF_MAX, LEN_MIN, LEN_MAX, SECTION_MIN, SECTION_MAX } from './floor-geometry.js';
import { computeCoveringCutPlan } from './coverings-plan.js';
import { formatInchesFraction } from '../core/unit-converter.js';

const $ = (id) => document.getElementById(id);

function floor() {
    if (!state.floor) state.floor = createDefaultFloor();
    return state.floor;
}

function commit({ history = true } = {}) {
    if (history) saveStateToHistory();
    // floor beams are generated inside buildLinkageGeometry from the cached solve; no solver re-run needed
    requestRender();
    if (typeof globalThis.scheduleAutoSave === 'function') globalThis.scheduleAutoSave();
}

function bindPair(sliderId, numberId, get, set, opts = {}) {
    const sl = $(sliderId), nb = $(numberId);
    const min = opts.min ?? -Infinity, max = opts.max ?? Infinity;
    const apply = (raw, from) => {
        let val = parseFloat(raw);
        if (isNaN(val)) val = get();
        val = Math.max(min, Math.min(max, val));
        set(val);
        if (nb && from !== nb) nb.value = val;
        if (sl && from !== sl) sl.value = Math.max(parseFloat(sl.min), Math.min(parseFloat(sl.max), val));
    };
    if (sl) { sl.oninput = (e) => { apply(e.target.value, sl); requestRender(); }; sl.onchange = () => commit(); }
    if (nb) nb.onchange = (e) => { apply(e.target.value, nb); e.target.value = get(); commit(); };
}
const bindNumber = (id, get, set, opts) => bindPair(null, id, get, set, opts);
function bindCheck(id, set) { const el = $(id); if (el) el.onchange = (e) => { set(!!e.target.checked); commit(); }; }

function setPair(slId, nbId, val) {
    const sl = $(slId), nb = $(nbId);
    if (sl) sl.value = Math.max(parseFloat(sl.min), Math.min(parseFloat(sl.max), val));
    if (nb) nb.value = val;
}
const setText = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };

function updateVisibility() {
    const f = floor();
    const controls = $('floor-controls');
    const hint = $('floor-mode-hint');
    const arch = state.orientation === 'vertical';
    if (hint) { hint.textContent = arch ? 'The raised floor is available in Cylinder mode only.' : ''; hint.style.display = f.enabled && arch ? '' : 'none'; }
    if (controls) controls.style.display = f.enabled && !arch ? '' : 'none';
    const rcp = $('floor-rcp-controls'); if (rcp) rcp.style.display = f.beams.parallelEnabled !== false ? '' : 'none';
    const rad = $('floor-radial-controls'); if (rad) rad.style.display = f.beams.radialEnabled ? '' : 'none';
    const deck = $('floor-deck-controls'); if (deck) deck.style.display = f.deck.enabled !== false ? '' : 'none';
}

function syncFloorUIFromState() {
    const f = floor();
    const chk = $('chk-floor'); if (chk) chk.checked = !!f.enabled;
    const c = (id, v) => { const el = $(id); if (el) el.checked = !!v; };
    c('chk-floor-rcp', f.beams.parallelEnabled !== false);
    c('chk-floor-radial', f.beams.radialEnabled);
    c('chk-floor-deck', f.deck.enabled !== false);
    c('chk-floor-show-beams', f.visibility.beams !== false);
    c('chk-floor-show-deck', f.visibility.deck !== false);
    setPair('sl-floor-rcp-length', 'nb-floor-rcp-length', f.beams.parallelLength);
    setPair('sl-floor-rcp-swing', 'nb-floor-rcp-swing', f.beams.parallelSwingAngle);
    setPair('sl-floor-rcp-anchor', 'nb-floor-rcp-anchor', f.beams.anchorDist);
    setPair('sl-floor-rcp-side', 'nb-floor-rcp-side', f.beams.anchorSideIn || 0);
    setPair('sl-floor-lift', 'nb-floor-lift', f.beams.parallelOffsetV || 0);
    setPair('sl-floor-rad-length', 'nb-floor-rad-length', f.beams.length);
    setPair('sl-floor-rad-offset', 'nb-floor-rad-offset', f.beams.offsetH);
    setPair('sl-floor-rad-voff', 'nb-floor-rad-voff', f.beams.offsetV || 0);
    setPair('sl-floor-rad-toff', 'nb-floor-rad-toff', f.beams.offsetT || 0);
    setPair('sl-floor-deck-inset', 'nb-floor-deck-inset', f.deck.insetIn);
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    set('sel-floor-seat', f.beams.seat === 'ringTop' ? 'ringTop' : 'leg');
    set('nb-floor-rcp-width', f.beams.parallelWidth);
    set('nb-floor-rcp-thickness', f.beams.parallelThickness);
    set('nb-floor-rcp-end', f.beams.rcpEndOffset);
    set('nb-floor-rcp-voff', f.beams.parallelVOffset);
    set('nb-floor-rad-width', f.beams.width);
    set('nb-floor-rad-thickness', f.beams.thickness);
    set('nb-floor-deck-t', f.deck.thicknessIn);
    updateVisibility();
}

/** Called from scene-render on every frame. */
function updateFloorReadout(data) {
    const f = floor();
    updateVisibility();
    const fl = data && data.floor;
    const beams = fl ? (fl.beams || []).length : 0;
    const floorCopies = (fl && fl.copyCount) || 1;
    setText('floor-stat-beams', floorCopies > 1 ? `${beams} per structure × ${floorCopies}` : String(beams));
    let seatTxt = '--';
    if (fl && beams) {
        try {
            const seat = describeFloorSeating({ beams: data.baseBeams || data.beams }, fl.beams, state.modules);
            const parts = [];
            const fmtGap = (g) => (Math.abs(g) < 0.01 ? 'on the leg' : `${g > 0 ? '+' : '−'}${formatInchesFraction(Math.abs(g))} ${g > 0 ? 'above' : 'into'}`);
            if (seat.A) parts.push(`A ${fmtGap(seat.A.gapIn)}`);
            if (seat.B) parts.push(`B ${fmtGap(seat.B.gapIn)}`);
            if (seat.radial) parts.push(`radial ${seat.radial.gapIn >= 0 ? '+' : '−'}${formatInchesFraction(Math.abs(seat.radial.gapIn))} vs ring top`);
            if (parts.length) seatTxt = parts.join(' · ');
        } catch (e) { /* readout only */ }
    }
    setText('floor-stat-seat', seatTxt);
    const deck = fl && fl.deck;
    setText('floor-stat-height', deck ? `${formatInchesFraction(deck.yTop)} above ground` : '--');
    setText('floor-stat-area', deck ? `${(deck.areaIn2 / 144).toFixed(1)} ft²` : '--');
    let sheets = '--';
    if (deck && state.coverings) {
        try {
            const plan = computeCoveringCutPlan(data.coverings && data.coverings.supported && state.coverings.enabled ? data.coverings : null, state.coverings, deck);
            if (plan.floor) sheets = `${plan.floor.nest.sheetCount} (${Math.round(plan.floor.nest.utilization * 100)}% used)`;
        } catch (e) { /* readout only */ }
    }
    setText('floor-stat-sheets', sheets);
    const bom = computeFloorBomContribution(f, state.modules, state);
    setText('floor-stat-cost', bom.floorBeamCost > 0 ? `$${bom.floorBeamCost.toFixed(2)}` : '--');
}

function initFloorUI() {
    if (!$('chk-floor')) return;
    bindCheck('chk-floor', (v) => { floor().enabled = v; updateVisibility(); });
    bindCheck('chk-floor-rcp', (v) => { floor().beams.parallelEnabled = v; updateVisibility(); });
    bindCheck('chk-floor-radial', (v) => { floor().beams.radialEnabled = v; updateVisibility(); });
    bindCheck('chk-floor-deck', (v) => { floor().deck.enabled = v; updateVisibility(); });
    bindCheck('chk-floor-show-beams', (v) => { floor().visibility.beams = v; });
    bindCheck('chk-floor-show-deck', (v) => { floor().visibility.deck = v; });
    const b = () => floor().beams;
    const OFF = { min: -OFF_MAX, max: OFF_MAX }, LEN = { min: LEN_MIN, max: LEN_MAX }, SEC = { min: SECTION_MIN, max: SECTION_MAX };
    const seatSel = $('sel-floor-seat');
    if (seatSel) seatSel.onchange = (e) => { b().seat = e.target.value === 'ringTop' ? 'ringTop' : 'leg'; commit(); };
    bindPair('sl-floor-rcp-length', 'nb-floor-rcp-length', () => b().parallelLength, (v) => { b().parallelLength = v; }, LEN);
    bindPair('sl-floor-rcp-swing', 'nb-floor-rcp-swing', () => b().parallelSwingAngle, (v) => { b().parallelSwingAngle = v; }, { min: -360, max: 360 });
    bindPair('sl-floor-rcp-anchor', 'nb-floor-rcp-anchor', () => b().anchorDist, (v) => { b().anchorDist = v; }, OFF);
    bindPair('sl-floor-rcp-side', 'nb-floor-rcp-side', () => b().anchorSideIn || 0, (v) => { b().anchorSideIn = v; }, OFF);
    bindPair('sl-floor-lift', 'nb-floor-lift', () => b().parallelOffsetV || 0, (v) => { b().parallelOffsetV = v; }, OFF);
    bindPair('sl-floor-rad-length', 'nb-floor-rad-length', () => b().length, (v) => { b().length = v; }, LEN);
    bindPair('sl-floor-rad-offset', 'nb-floor-rad-offset', () => b().offsetH, (v) => { b().offsetH = v; }, OFF);
    bindPair('sl-floor-rad-voff', 'nb-floor-rad-voff', () => b().offsetV || 0, (v) => { b().offsetV = v; }, OFF);
    bindPair('sl-floor-rad-toff', 'nb-floor-rad-toff', () => b().offsetT || 0, (v) => { b().offsetT = v; }, OFF);
    bindPair('sl-floor-deck-inset', 'nb-floor-deck-inset', () => floor().deck.insetIn, (v) => { floor().deck.insetIn = v; }, OFF);
    bindNumber('nb-floor-rcp-width', () => b().parallelWidth, (v) => { b().parallelWidth = v; }, SEC);
    bindNumber('nb-floor-rcp-thickness', () => b().parallelThickness, (v) => { b().parallelThickness = v; }, SEC);
    bindNumber('nb-floor-rcp-end', () => b().rcpEndOffset, (v) => { b().rcpEndOffset = v; }, OFF);
    bindNumber('nb-floor-rcp-voff', () => b().parallelVOffset, (v) => { b().parallelVOffset = v; }, OFF);
    bindNumber('nb-floor-rad-width', () => b().width, (v) => { b().width = v; }, SEC);
    bindNumber('nb-floor-rad-thickness', () => b().thickness, (v) => { b().thickness = v; }, SEC);
    bindNumber('nb-floor-deck-t', () => floor().deck.thicknessIn, (v) => { floor().deck.thicknessIn = v; }, SEC);
    syncFloorUIFromState();
}

const _moduleExports = { initFloorUI, syncFloorUIFromState, updateFloorReadout };
bridgeGlobals(_moduleExports, 'floorUI');
export { initFloorUI, syncFloorUIFromState, updateFloorReadout };
