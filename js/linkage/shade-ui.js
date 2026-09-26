// ============================================================================
// LINKAGE LAB — Shade Cloths sidebar
// Depends on globals: state, scheduleAutoSave (optional)
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { requestRender } from './render-app.js';
import { saveStateToHistory } from './history.js';
import { createDefaultShade, SHADE_PRESETS, shadeBomItem } from './shade-cloth.js';

const $ = (id) => document.getElementById(id);

function shade() {
    if (!state.shadeCloth) state.shadeCloth = createDefaultShade();
    return state.shadeCloth;
}

function commit({ history = true } = {}) {
    if (history) saveStateToHistory();
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

function setPair(slId, nbId, val) {
    const sl = $(slId), nb = $(nbId);
    if (sl) sl.value = Math.max(parseFloat(sl.min), Math.min(parseFloat(sl.max), val));
    if (nb) nb.value = val;
}
const setText = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };

function syncPreset() {
    const s = shade();
    const sel = $('sel-shade-preset');
    if (!sel) return;
    const match = Object.keys(SHADE_PRESETS).find(k => SHADE_PRESETS[k].widthIn === s.widthIn && SHADE_PRESETS[k].lengthIn === s.lengthIn);
    sel.value = match || 'custom';
}

function updateVisibility() {
    const s = shade();
    const arch = state.orientation === 'vertical';
    const hint = $('shade-mode-hint');
    if (hint) { hint.textContent = arch ? 'Shade cloths are available in Cylinder mode only.' : ''; hint.style.display = s.enabled && arch ? '' : 'none'; }
    const controls = $('shade-controls');
    if (controls) controls.style.display = s.enabled && !arch ? '' : 'none';
}

function syncShadeUIFromState() {
    const s = shade();
    const chk = $('chk-shade'); if (chk) chk.checked = !!s.enabled;
    const show = $('chk-shade-show'); if (show) show.checked = s.visible !== false;
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    set('nb-shade-w', s.widthIn);
    set('nb-shade-l', s.lengthIn);
    set('nb-shade-ox', s.offsetXIn);
    set('nb-shade-oz', s.offsetZIn);
    set('nb-cost-shade', state.costShadeCloth ?? 60);
    setPair('sl-shade-rot', 'nb-shade-rot', s.rotationDeg);
    setPair('sl-shade-overlap', 'nb-shade-overlap', s.overlapIn);
    setPair('sl-shade-lift', 'nb-shade-lift', s.liftIn);
    setPair('sl-shade-opacity', 'nb-shade-opacity', s.opacity);
    syncPreset();
    updateVisibility();
}

/** Called from scene-render on every frame. */
function updateShadeReadout(data) {
    updateVisibility();
    const sd = data && data.shade;
    if (!sd || !sd.supported) {
        setText('shade-stat-count', '0');
        ['shade-stat-grid', 'shade-stat-coverage', 'shade-stat-overhang', 'shade-stat-cost'].forEach(id => setText(id, '--'));
        return;
    }
    setText('shade-stat-count', String(sd.count));
    setText('shade-stat-grid', `${sd.cols} × ${sd.rows} at ${sd.rotationDeg}°`);
    setText('shade-stat-coverage', `${sd.coveragePct}% of ${(sd.canopyAreaIn2 / 144).toFixed(0)} ft²`);
    setText('shade-stat-overhang', `${(sd.overhangIn2 / 144).toFixed(0)} ft² past the edge`);
    const item = shadeBomItem(sd, state);
    setText('shade-stat-cost', item ? `$${item.total.toFixed(2)}` : '--');
}

function initShadeUI() {
    if (!$('chk-shade')) return;
    const chk = $('chk-shade');
    chk.onchange = (e) => { shade().enabled = !!e.target.checked; updateVisibility(); commit(); };
    const show = $('chk-shade-show');
    if (show) show.onchange = (e) => { shade().visible = !!e.target.checked; commit(); };
    const sel = $('sel-shade-preset');
    if (sel) sel.onchange = (e) => {
        const p = SHADE_PRESETS[e.target.value];
        if (!p) return;
        shade().widthIn = p.widthIn; shade().lengthIn = p.lengthIn;
        const w = $('nb-shade-w'), l = $('nb-shade-l');
        if (w) w.value = p.widthIn;
        if (l) l.value = p.lengthIn;
        commit();
    };
    bindNumber('nb-shade-w', () => shade().widthIn, (v) => { shade().widthIn = v; syncPreset(); }, { min: 12, max: 960 });
    bindNumber('nb-shade-l', () => shade().lengthIn, (v) => { shade().lengthIn = v; syncPreset(); }, { min: 12, max: 960 });
    bindPair('sl-shade-rot', 'nb-shade-rot', () => shade().rotationDeg, (v) => { shade().rotationDeg = v; }, { min: -180, max: 180 });
    bindPair('sl-shade-overlap', 'nb-shade-overlap', () => shade().overlapIn, (v) => { shade().overlapIn = v; }, { min: 0, max: 120 });
    bindPair('sl-shade-lift', 'nb-shade-lift', () => shade().liftIn, (v) => { shade().liftIn = v; }, { min: 0, max: 120 });
    bindPair('sl-shade-opacity', 'nb-shade-opacity', () => shade().opacity, (v) => { shade().opacity = v; }, { min: 0.05, max: 1 });
    bindNumber('nb-shade-ox', () => shade().offsetXIn, (v) => { shade().offsetXIn = v; }, { min: -480, max: 480 });
    bindNumber('nb-shade-oz', () => shade().offsetZIn, (v) => { shade().offsetZIn = v; }, { min: -480, max: 480 });
    bindNumber('nb-cost-shade', () => state.costShadeCloth, (v) => { state.costShadeCloth = v; }, { min: 0, max: 2000 });
    syncShadeUIFromState();
}

const _moduleExports = { initShadeUI, syncShadeUIFromState, updateShadeReadout };
bridgeGlobals(_moduleExports, 'shadeUI');
export { initShadeUI, syncShadeUIFromState, updateShadeReadout };
