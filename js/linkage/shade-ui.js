// ============================================================================
// LINKAGE LAB — Shade Tarps sidebar
// Depends on globals: state, scheduleAutoSave (optional)
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { requestRender } from './render-app.js';
import { saveStateToHistory } from './history.js';
import { createDefaultShade, SHADE_PRESETS, SHADE_SWATCHES, shadeBomItems, normalizeHexColor, OFF_MAX, LEN_MIN, LEN_MAX, PRICE_MAX } from './shade-cloth.js';
import { formatInchesFraction } from '../core/unit-converter.js';

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

let lastOpacity = 0.75;

function updateVisibility() {
    const s = shade();
    const arch = state.orientation === 'vertical';
    const hint = $('shade-mode-hint');
    if (hint) { hint.textContent = arch ? 'Shade tarps are available in Cylinder mode only.' : ''; hint.style.display = s.enabled && arch ? '' : 'none'; }
    const controls = $('shade-controls');
    if (controls) controls.style.display = s.enabled && !arch ? '' : 'none';
    const w = $('nb-shade-w'); if (w) w.disabled = s.widthMode !== 'custom';
    const l = $('nb-shade-l'); if (l) l.disabled = s.lengthMode !== 'custom';
    const cr = $('shade-center-row'); if (cr) cr.style.display = s.lengthMode === 'custom' ? 'none' : '';
    const sw = $('shade-swatches');
    if (sw) sw.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.color === s.color));
}

function syncShadeUIFromState() {
    const s = shade();
    const chk = $('chk-shade'); if (chk) chk.checked = !!s.enabled;
    const show = $('chk-shade-show'); if (show) show.checked = s.visible !== false;
    const opq = $('chk-shade-opaque'); if (opq) opq.checked = s.opacity >= 0.999;
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    set('sel-shade-width-mode', s.widthMode === 'custom' ? 'custom' : 'auto');
    set('sel-shade-length-mode', s.lengthMode === 'custom' ? 'custom' : 'auto');
    set('nb-shade-w', s.widthIn);
    set('nb-shade-l', s.lengthIn);
    set('nb-shade-color', s.color);
    set('nb-cost-shade', state.costShadeCloth ?? 60);
    set('sel-shade-preset', '');
    setPair('sl-shade-wtrim', 'nb-shade-wtrim', s.widthTrimIn || 0);
    setPair('sl-shade-center', 'nb-shade-center', s.centerOverlapIn ?? 12);
    setPair('sl-shade-overhang', 'nb-shade-overhang', s.overhangIn ?? 6);
    setPair('sl-shade-rot', 'nb-shade-rot', s.rotationDeg);
    setPair('sl-shade-stagger', 'nb-shade-stagger', s.staggerIn || 0);
    setPair('sl-shade-lift', 'nb-shade-lift', s.liftIn);
    setPair('sl-shade-opacity', 'nb-shade-opacity', s.opacity);
    if (s.opacity < 0.999) lastOpacity = s.opacity;
    updateVisibility();
}

/** Called from scene-render on every frame. */
function updateShadeReadout(data) {
    updateVisibility();
    const sd = data && data.shade;
    const warn = $('shade-warnings');
    if (!sd || !sd.supported) {
        setText('shade-stat-count', '0');
        ['shade-stat-grid', 'shade-stat-coverage', 'shade-stat-overhang', 'shade-stat-cost'].forEach(id => setText(id, '--'));
        if (warn) warn.style.display = 'none';
        return;
    }
    setText('shade-stat-count', sd.copyCount > 1 ? `${sd.count} per structure × ${sd.copyCount}` : String(sd.count));
    const sizes = (sd.sizes || []).map(sz => `${sz.qty} × ${formatInchesFraction(sz.widthIn, 4)} × ${formatInchesFraction(sz.lengthIn, 4)}`).join(', ');
    setText('shade-stat-grid', sizes || '--');
    setText('shade-stat-coverage', `${sd.coveragePct}% of ${(sd.canopyAreaIn2 / 144).toFixed(0)} ft²`);
    setText('shade-stat-overhang', `${(sd.overhangIn2 / 144).toFixed(0)} ft² past the edge / overlapped`);
    const rows = shadeBomItems(sd, state);
    const total = rows.reduce((a, r) => a + r.total, 0);
    setText('shade-stat-cost', rows.length ? `$${total.toFixed(2)}` : '--');
    if (warn) {
        const msgs = (sd.warnings || []).map(w => w.message);
        warn.textContent = msgs.join(' ');
        warn.style.display = msgs.length ? '' : 'none';
    }
}

function setColor(hex) {
    const c = normalizeHexColor(hex, shade().color);
    shade().color = c;
    const inp = $('nb-shade-color'); if (inp) inp.value = c;
    updateVisibility();
    commit();
}

function initShadeUI() {
    if (!$('chk-shade')) return;
    const chk = $('chk-shade');
    chk.onchange = (e) => { shade().enabled = !!e.target.checked; updateVisibility(); commit(); };
    const show = $('chk-shade-show');
    if (show) show.onchange = (e) => { shade().visible = !!e.target.checked; commit(); };
    const wm = $('sel-shade-width-mode');
    if (wm) wm.onchange = (e) => { shade().widthMode = e.target.value === 'custom' ? 'custom' : 'auto'; updateVisibility(); commit(); };
    const lm = $('sel-shade-length-mode');
    if (lm) lm.onchange = (e) => { shade().lengthMode = e.target.value === 'custom' ? 'custom' : 'auto'; updateVisibility(); commit(); };
    const sel = $('sel-shade-preset');
    if (sel) sel.onchange = (e) => {
        const p = SHADE_PRESETS[e.target.value];
        if (!p) return;
        const s = shade();
        s.widthIn = p.widthIn; s.lengthIn = p.lengthIn; s.widthMode = 'custom'; s.lengthMode = 'custom';
        syncShadeUIFromState();
        commit();
    };
    const OFF = { min: -OFF_MAX, max: OFF_MAX };
    bindNumber('nb-shade-w', () => shade().widthIn, (v) => { shade().widthIn = v; }, { min: LEN_MIN, max: LEN_MAX });
    bindNumber('nb-shade-l', () => shade().lengthIn, (v) => { shade().lengthIn = v; }, { min: LEN_MIN, max: LEN_MAX });
    bindPair('sl-shade-wtrim', 'nb-shade-wtrim', () => shade().widthTrimIn || 0, (v) => { shade().widthTrimIn = v; }, OFF);
    bindPair('sl-shade-center', 'nb-shade-center', () => shade().centerOverlapIn ?? 12, (v) => { shade().centerOverlapIn = v; }, OFF);
    bindPair('sl-shade-overhang', 'nb-shade-overhang', () => shade().overhangIn ?? 6, (v) => { shade().overhangIn = v; }, OFF);
    bindPair('sl-shade-rot', 'nb-shade-rot', () => shade().rotationDeg, (v) => { shade().rotationDeg = v; }, { min: -360, max: 360 });
    bindPair('sl-shade-stagger', 'nb-shade-stagger', () => shade().staggerIn || 0, (v) => { shade().staggerIn = v; }, OFF);
    bindPair('sl-shade-lift', 'nb-shade-lift', () => shade().liftIn, (v) => { shade().liftIn = v; }, OFF);
    bindPair('sl-shade-opacity', 'nb-shade-opacity', () => shade().opacity, (v) => {
        shade().opacity = v;
        if (v < 0.999) lastOpacity = v;
        const opq = $('chk-shade-opaque'); if (opq) opq.checked = v >= 0.999;
    }, { min: 0.05, max: 1 });
    bindNumber('nb-cost-shade', () => state.costShadeCloth, (v) => { state.costShadeCloth = v; }, { min: 0, max: PRICE_MAX });
    const color = $('nb-shade-color');
    if (color) {
        color.oninput = (e) => { shade().color = normalizeHexColor(e.target.value, shade().color); updateVisibility(); requestRender(); };
        color.onchange = (e) => setColor(e.target.value);
    }
    const sw = $('shade-swatches');
    if (sw) {
        sw.innerHTML = SHADE_SWATCHES.map(c => `<button type="button" class="shade-swatch" data-color="${c.color}" title="${c.name}" style="background:${c.color}"></button>`).join('');
        sw.querySelectorAll('button').forEach(b => { b.onclick = () => setColor(b.dataset.color); });
    }
    const opq = $('chk-shade-opaque');
    if (opq) opq.onchange = (e) => {
        const s = shade();
        if (e.target.checked) { if (s.opacity < 0.999) lastOpacity = s.opacity; s.opacity = 1; }
        else s.opacity = lastOpacity < 0.999 ? lastOpacity : 0.75;
        setPair('sl-shade-opacity', 'nb-shade-opacity', s.opacity);
        commit();
    };
    syncShadeUIFromState();
}

const _moduleExports = { initShadeUI, syncShadeUIFromState, updateShadeReadout };
bridgeGlobals(_moduleExports, 'shadeUI');
export { initShadeUI, syncShadeUIFromState, updateShadeReadout };
