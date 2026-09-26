// ============================================================================
// LINKAGE LAB — Coverings sidebar (span ring picker, band/stock/fabric controls)
// Depends on globals: state, scheduleAutoSave (optional), showBuildGuide (optional)
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { requestRender } from './render-app.js';
import { saveStateToHistory } from './history.js';
import { showToast } from '../core/feedback.js';
import {
    COVER_TYPES,
    SHEET_PRESETS,
    createDefaultCoverings,
    resizeCoveringSpans,
    splitHeightForOneSheet,
    wrapDeg,
} from './coverings-geometry.js';
import { computeCoveringCutPlan, coveringEnclosureCost, coveringEntrySvg, coveringEntryFilename } from './coverings-plan.js';
import { downloadTextSequence } from '../core/download.js';

const $ = (id) => document.getElementById(id);

/** Last computed coverings (set on every render by updateCoveringsReadout). */
let lastCoverings = null;
/** Last computed floor deck shape (for cut-file downloads). */
let lastFloorDeck = null;
/** Key of the last picker render, to skip DOM churn when nothing changed. */
let lastPickerKey = '';

const WEDGE_FILL = { none: '#2a3644', plywood: '#c9a46a', fabric: '#5fb3a1' };
const TABLE_FILL = { on: '#e0c48a', off: '#2a3644' };

function cov() {
    if (!state.coverings) state.coverings = createDefaultCoverings(state.modules);
    if (!Array.isArray(state.coverings.spans) || state.coverings.spans.length !== state.modules) {
        resizeCoveringSpans(state.coverings, state.modules);
    }
    return state.coverings;
}

function commit({ history = true } = {}) {
    if (history) saveStateToHistory();
    requestRender();
    if (typeof globalThis.scheduleAutoSave === 'function') globalThis.scheduleAutoSave();
}

// ----------------------------------------------------------------------------
// Numeric / select binding helpers (mirrors bindSupportBeamControl, but for a
// getter/setter pair so nested props work, and without geometry-cache
// invalidation: coverings are derived from the already-solved beams)
// ----------------------------------------------------------------------------

function bindPair(sliderId, numberId, get, set, opts = {}) {
    const sl = $(sliderId);
    const nb = $(numberId);
    const min = opts.min ?? -Infinity, max = opts.max ?? Infinity;
    const apply = (raw, from) => {
        let val = parseFloat(raw);
        if (isNaN(val)) val = get();
        val = Math.max(min, Math.min(max, val));
        set(val);
        if (nb && from !== nb) nb.value = val;
        if (sl && from !== sl) sl.value = Math.max(parseFloat(sl.min), Math.min(parseFloat(sl.max), val));
    };
    if (sl) {
        sl.oninput = (e) => { apply(e.target.value, sl); requestRender(); };
        sl.onchange = () => commit();
    }
    if (nb) {
        nb.onchange = (e) => { apply(e.target.value, nb); e.target.value = get(); commit(); };
    }
}

function bindNumber(id, get, set, opts = {}) {
    bindPair(null, id, get, set, opts);
}

function bindSelect(id, get, set) {
    const el = $(id);
    if (!el) return;
    el.onchange = (e) => { set(e.target.value); commit(); };
}

function bindCheck(id, get, set) {
    const el = $(id);
    if (!el) return;
    el.onchange = (e) => { set(!!e.target.checked); commit(); };
}

// ----------------------------------------------------------------------------
// Span edits
// ----------------------------------------------------------------------------

function nextType(t) {
    const i = COVER_TYPES.indexOf(t);
    return COVER_TYPES[(i + 1) % COVER_TYPES.length];
}

/** Cycle a band (none → plywood → fabric → none) or toggle the table for a span. */
function cycleSpanBand(spanIndex, band) {
    const c = cov();
    const span = c.spans[spanIndex];
    if (!span) return;
    if (band === 'table') {
        span.table = !span.table;
    } else if (band === 'lower' || band === 'upper') {
        span[band] = nextType(span[band]);
    }
    renderCoveringRingPicker(true);
    commit();
}

function setAllSpans(fn) {
    const c = cov();
    c.spans.forEach((s, i) => fn(s, i));
    renderCoveringRingPicker(true);
    commit();
}

// ----------------------------------------------------------------------------
// Ring picker (inline SVG, plan view: svg x = world x, svg y = world z)
// ----------------------------------------------------------------------------

function arcPath(cx, cy, rIn, rOut, a0, a1) {
    const rad = (d) => d * Math.PI / 180;
    const p = (r, a) => `${(cx + r * Math.cos(rad(a))).toFixed(2)} ${(cy + r * Math.sin(rad(a))).toFixed(2)}`;
    const sweep = wrapDeg(a1 - a0);
    const large = Math.abs(sweep) > 180 ? 1 : 0;
    const dir = sweep >= 0 ? 1 : 0;
    const back = sweep >= 0 ? 0 : 1;
    return `M ${p(rOut, a0)} A ${rOut} ${rOut} 0 ${large} ${dir} ${p(rOut, a1)} L ${p(rIn, a1)} A ${rIn} ${rIn} 0 ${large} ${back} ${p(rIn, a0)} Z`;
}

/** Span wedge angles: from live geometry when available, else equal wedges. */
function wedgeAngles(c) {
    const n = c.spans.length;
    const live = lastCoverings && lastCoverings.supported ? lastCoverings.spans : null;
    const out = [];
    for (let j = 0; j < n; j++) {
        const s = live ? live.find(x => x.index === j) : null;
        if (s) {
            out.push({ a0: s.azimuthLeftDeg, a1: s.azimuthRightDeg, available: !!s.plane });
        } else {
            const step = 360 / n;
            // Match the solver's clockwise progression (negative azimuth step) for a stable look
            const a0 = -22.5 - step * (j - 1) - (n === 8 ? 0 : 0);
            out.push({ a0, a1: a0 - step, available: !!live ? false : true });
        }
    }
    return out;
}

function renderCoveringRingPicker(force = false) {
    const host = $('cov-ring-picker');
    if (!host) return;
    const c = cov();
    const angles = wedgeAngles(c);
    const key = JSON.stringify([c.spans, angles.map(a => [Math.round(a.a0), Math.round(a.a1), a.available])]);
    if (!force && key === lastPickerKey) return;
    lastPickerKey = key;

    const size = 240, cx = size / 2, cy = size / 2;
    const rings = [
        { band: 'lower', rIn: 78, rOut: 104 },
        { band: 'upper', rIn: 52, rOut: 76 },
        { band: 'table', rIn: 30, rOut: 50 },
    ];
    const parts = [];
    parts.push(`<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" aria-label="Span coverings">`);
    angles.forEach((ang, j) => {
        const span = c.spans[j];
        const gap = 1.2; // degrees of visual gap between wedges
        const sweep = wrapDeg(ang.a1 - ang.a0);
        const sgn = sweep >= 0 ? 1 : -1;
        const a0 = ang.a0 + sgn * gap, a1 = ang.a1 - sgn * gap;
        rings.forEach(r => {
            const fill = r.band === 'table' ? TABLE_FILL[span.table ? 'on' : 'off'] : WEDGE_FILL[span[r.band]] || WEDGE_FILL.none;
            const label = r.band === 'table'
                ? `Span ${j + 1} table: ${span.table ? 'on' : 'off'}`
                : `Span ${j + 1} ${r.band} band: ${span[r.band]}`;
            parts.push(`<path class="cov-wedge" data-span="${j}" data-band="${r.band}"${ang.available ? '' : ' data-disabled="1"'} d="${arcPath(cx, cy, r.rIn, r.rOut, a0, a1)}" fill="${fill}"><title>${label}</title></path>`);
        });
        const mid = ang.a0 + sweep / 2;
        const lx = cx + 114 * Math.cos(mid * Math.PI / 180), ly = cy + 114 * Math.sin(mid * Math.PI / 180);
        parts.push(`<text class="cov-wedge-label" x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="middle">${j + 1}</text>`);
    });
    parts.push(`<text class="cov-ring-label" x="${cx}" y="${cy + 2}" text-anchor="middle">table</text>`);
    parts.push('</svg>');
    host.innerHTML = parts.join('');
}

// ----------------------------------------------------------------------------
// Readout
// ----------------------------------------------------------------------------

const fmtIn = (v) => (v == null || !Number.isFinite(v)) ? '--' : `${(+v).toFixed(1)}"`;
const fmtFt2 = (in2) => `${(in2 / 144).toFixed(1)} ft²`;

function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }

function updateModeHint(c, data) {
    const hint = $('cov-mode-hint');
    const controls = $('cov-controls');
    if (!hint || !controls) return;
    let msg = '';
    if (state.orientation === 'vertical') msg = 'Coverings are available in Cylinder mode only.';
    else if (state.useFixedBeams) msg = 'Coverings need scissor uprights. Turn off Fixed Beams to use them.';
    else if (data && !data.supported && data.unsupportedReason === 'no-uprights') msg = 'No vertical uprights found for this configuration.';
    else if (data && data.supported && !data.closed) msg = `Ring is open (${data.closureErrorDeg}° off): span 1 is unavailable until the ring closes.`;
    hint.textContent = msg;
    hint.style.display = c.enabled && msg ? '' : 'none';
    controls.style.display = c.enabled && !(state.orientation === 'vertical' || state.useFixedBeams) ? '' : 'none';
}

/** Called from scene-render on every frame with the freshly built geometry. */
function updateCoveringsReadout(data) {
    const c = cov();
    const covData = data && data.coverings;
    lastCoverings = covData || null;
    lastFloorDeck = data && data.floor && data.floor.deck ? data.floor.deck : null;
    updateModeHint(c, covData);
    renderCoveringRingPicker();
    if (!covData || !covData.supported) {
        ['cov-stat-spans', 'cov-stat-walls', 'cov-stat-fabric', 'cov-stat-tables'].forEach(id => setText(id, '0'));
        ['cov-stat-tilt', 'cov-stat-lower', 'cov-stat-upper', 'cov-stat-ply-area', 'cov-stat-sheets', 'cov-stat-fabric-area'].forEach(id => setText(id, '--'));
        const w = $('cov-warnings'); if (w) w.innerHTML = '';
        return;
    }
    const t = covData.totals;
    setText('cov-stat-spans', `${t.spansCovered} / ${covData.spans.length}`);
    setText('cov-stat-walls', String(t.plywoodWalls));
    setText('cov-stat-fabric', String(t.fabricBands));
    setText('cov-stat-tables', String(t.tables));
    const first = covData.spans.find(s => s.plane);
    setText('cov-stat-tilt', first ? `${first.tiltFromVerticalDeg.toFixed(1)}° / ${(first.upperTiltFromVerticalDeg ?? first.tiltFromVerticalDeg).toFixed(1)}° from vertical` : '--');
    const lower = first && first.lower;
    const upper = first && first.upper;
    const anyLower = lower || covData.spans.map(s => s.lower).find(Boolean);
    const anyUpper = upper || covData.spans.map(s => s.upper).find(Boolean);
    setText('cov-stat-lower', anyLower ? `${fmtIn(anyLower.widthBottomIn)} → ${fmtIn(anyLower.widthTopIn)} × ${fmtIn(anyLower.slantHeightIn)} slant` : `0" → ${covData.splitHeightIn}" (empty)`);
    setText('cov-stat-upper', anyUpper ? `${fmtIn(anyUpper.widthBottomIn)} → ${fmtIn(anyUpper.widthTopIn)} × ${fmtIn(anyUpper.slantHeightIn)} slant` : `${covData.splitHeightIn}" → ${covData.upperTopIn}" (empty)`);
    const plyArea = t.plywoodAreaIn2 + t.tableAreaIn2;
    setText('cov-stat-ply-area', plyArea > 0 ? fmtFt2(plyArea) : '--');
    setText('cov-stat-fabric-area', t.fabricAreaIn2 > 0 ? fmtFt2(t.fabricAreaIn2) : '--');
    let plan = null;
    try { plan = computeCoveringCutPlan(covData, c, data && data.floor ? data.floor.deck : null); } catch (e) { console.warn('[Coverings] cut plan failed:', e); }
    const pt = plan ? plan.totals : null;
    setText('cov-stat-sheets', pt && pt.sheets > 0 ? `${pt.sheets} (${Math.round(pt.utilization * 100)}% used${pt.seams ? `, ${pt.seams} seam${pt.seams === 1 ? '' : 's'}` : ''})` : '--');
    setText('cov-stat-yards', pt && pt.fabricYards > 0 ? `${Math.ceil(pt.fabricYards)} yd (${pt.fabricPanels} panel${pt.fabricPanels === 1 ? '' : 's'})` : '--');
    setText('cov-stat-grommets', pt && pt.grommets > 0 ? String(pt.grommets) : '--');
    const cost = plan ? coveringEnclosureCost(plan, state) : 0;
    setText('cov-stat-cost', cost > 0 ? `$${cost.toFixed(2)}` : '--');
    const cutBtn = $('btn-cov-cutfiles');
    if (cutBtn) cutBtn.disabled = !(plan && (plan.walls.length + plan.tables.length + plan.fabric.length) > 0);
    const w = $('cov-warnings');
    if (w) {
        const seen = new Set();
        const items = (covData.warnings || []).filter(x => {
            const k = `${x.code}:${x.spanIndex}:${x.band}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        }).slice(0, 6);
        w.innerHTML = items.map(x => `<div>⚠ ${escapeHtml(x.message)}</div>`).join('');
    }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ----------------------------------------------------------------------------
// 3D pick mode: click a span in the viewport to cycle its covering
// ----------------------------------------------------------------------------

const pick = { raycaster: null, pointer: null, downX: 0, downY: 0, bound: false };

function setCoveringsPickMode(on) {
    const c = cov();
    const want = !!on && c.enabled;
    if (c.pickMode === want) { syncPickButton(); return; }
    c.pickMode = want;
    const vp = $('viewport');
    if (vp) vp.classList.toggle('cov-picking', want);
    if (want && typeof globalThis.isBuildStepPickActive === 'function' && globalThis.isBuildStepPickActive()) {
        globalThis.setBuildStepPickActive(false); // one picker at a time
    }
    if (want) showToast('Click a span to cycle none → plywood → fabric (Shift-click toggles its table). Esc to stop.', 'info', 3000);
    syncPickButton();
    requestRender();
}

function syncPickButton() {
    const btn = $('btn-cov-pick');
    if (btn) btn.classList.toggle('active', !!cov().pickMode);
}

/**
 * Raycasts the covering meshes / empty-span quads under a canvas point.
 * @returns {{spanIndex:number, band:string}|null}
 */
function pickCoveringAt(clientX, clientY) {
    if (typeof THREE === 'undefined' || !globalThis.threeRenderer || !threeRenderer.mainCamera || !threeRenderer.coveringGroup) return null;
    const canvas = $('canvas-webgl');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    if (!pick.raycaster) { pick.raycaster = new THREE.Raycaster(); pick.pointer = new THREE.Vector2(); }
    pick.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pick.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    pick.raycaster.setFromCamera(pick.pointer, threeRenderer.mainCamera);
    const hits = pick.raycaster.intersectObjects([threeRenderer.coveringGroup], true);
    for (const hit of hits) {
        let o = hit.object;
        while (o) {
            if (o.visible === false) break;
            const ud = o.userData || {};
            if (ud.coveringPick) return { spanIndex: ud.coveringPick.spanIndex, band: ud.coveringPick.band };
            if (ud.covering && (ud.covering.band === 'floor' || ud.covering.band === 'roof')) return null;
            if (ud.covering && ud.covering.band !== 'table') return { spanIndex: ud.covering.spanIndex, band: ud.covering.band };
            if (ud.covering) return { spanIndex: ud.covering.spanIndex, band: 'table' };
            o = o.parent;
        }
    }
    return null;
}

function bindCoveringPick() {
    if (pick.bound) return;
    const canvas = $('canvas-webgl');
    if (!canvas) return;
    pick.bound = true;
    canvas.addEventListener('mousedown', (e) => { pick.downX = e.clientX; pick.downY = e.clientY; });
    canvas.addEventListener('mouseup', (e) => {
        if (!cov().pickMode || e.button !== 0) return;
        if (Math.hypot(e.clientX - pick.downX, e.clientY - pick.downY) > 4) return; // orbit drag, not a click
        const hit = pickCoveringAt(e.clientX, e.clientY);
        if (!hit) { showToast('No span under the cursor', 'warning', 1200); return; }
        cycleSpanBand(hit.spanIndex, e.shiftKey ? 'table' : hit.band);
        const span = cov().spans[hit.spanIndex];
        if (span) showToast(`Span ${hit.spanIndex + 1} ${e.shiftKey ? 'table' : hit.band}: ${e.shiftKey ? (span.table ? 'on' : 'off') : span[hit.band]}`, 'success', 1200);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && cov().pickMode) { setCoveringsPickMode(false); e.stopPropagation(); }
    }, true);
}

// ----------------------------------------------------------------------------
// Cut file downloads
// ----------------------------------------------------------------------------

/** One full-scale SVG per wall / table / fabric band, downloaded in sequence. */
function exportCoveringCutFiles() {
    const deck = lastFloorDeck;
    if ((!lastCoverings || !lastCoverings.supported) && !deck) { showToast('Enable coverings or the floor on a closed cylinder ring first', 'info'); return; }
    const plan = computeCoveringCutPlan(lastCoverings, cov(), deck);
    const entries = plan.walls.concat(plan.tables, plan.fabric, plan.floor ? [plan.floor] : []);
    if (!entries.length) { showToast('No coverings selected: click a wedge in the ring or use Enclose', 'info'); return; }
    const files = entries.map(entry => ({
        text: coveringEntrySvg(entry, state),
        filename: coveringEntryFilename(entry),
        mime: 'image/svg+xml;charset=utf-8',
    }));
    downloadTextSequence(files, 300);
    showToast(`Downloading ${files.length} cut file${files.length === 1 ? '' : 's'} (SVG, 1 unit = 1 inch)`, 'success');
}

// ----------------------------------------------------------------------------
// State → UI
// ----------------------------------------------------------------------------

function setPair(slId, nbId, val) {
    const sl = $(slId), nb = $(nbId);
    if (sl) sl.value = Math.max(parseFloat(sl.min), Math.min(parseFloat(sl.max), val));
    if (nb) nb.value = val;
}

function syncSheetPresetSelect(c) {
    const sel = $('sel-cov-sheet-preset');
    if (!sel) return;
    const match = Object.keys(SHEET_PRESETS).find(k => SHEET_PRESETS[k].widthIn === c.sheet.widthIn && SHEET_PRESETS[k].lengthIn === c.sheet.lengthIn);
    sel.value = match || 'custom';
}

function syncCoveringsUIFromState() {
    const c = cov();
    const chk = $('chk-coverings');
    if (chk) chk.checked = !!c.enabled;
    setPair('sl-cov-split', 'nb-cov-split', c.splitHeightIn);
    setPair('sl-cov-bottom', 'nb-cov-bottom', c.bottomIn);
    setPair('sl-cov-top-clear', 'nb-cov-top-clear', c.topClearanceIn);
    setPair('sl-cov-edge-gap', 'nb-cov-edge-gap', c.edgeGapIn);
    setPair('sl-cov-tilt', 'nb-cov-tilt', c.lowerTiltDeg);
    setPair('sl-cov-tilt-upper', 'nb-cov-tilt-upper', c.upperTiltDeg);
    setPair('sl-cov-table-depth', 'nb-cov-table-depth', c.table.depthIn);
    setPair('sl-cov-table-slide', 'nb-cov-table-slide', c.table.slideIn || 0);
    const lean = $('sel-cov-lean'); if (lean) lean.value = c.lowerLean;
    const tiltRow = $('cov-tilt-row'); if (tiltRow) tiltRow.style.display = c.lowerLean === 'custom' ? '' : 'none';
    const leanU = $('sel-cov-lean-upper'); if (leanU) leanU.value = c.upperLean;
    const tiltRowU = $('cov-tilt-upper-row'); if (tiltRowU) tiltRowU.style.display = c.upperLean === 'custom' ? '' : 'none';
    const mount = $('sel-cov-mount'); if (mount) mount.value = c.mount;
    syncSheetPresetSelect(c);
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    set('nb-cov-sheet-w', c.sheet.widthIn);
    set('nb-cov-sheet-l', c.sheet.lengthIn);
    set('nb-cov-sheet-t', c.sheet.thicknessIn);
    set('sel-cov-sheet-orient', c.sheet.orientation);
    set('nb-cov-kerf', c.sheet.kerfIn);
    set('nb-cost-plywood', state.costPlywoodSheet ?? 45);
    set('nb-cov-roll', c.fabric.rollWidthIn);
    set('nb-cov-hem', c.fabric.hemIn);
    set('nb-cov-seam', c.fabric.seamIn);
    set('nb-cov-stretch', c.fabric.stretchPct);
    set('nb-cov-grommet', c.fabric.grommetSpacingIn);
    set('nb-cost-fabric', state.costFabricYard ?? 8);
    set('nb-cost-grommet', state.costGrommet ?? 0.25);
    set('nb-cov-table-t', c.table.thicknessIn);
    const chkW = $('chk-cov-show-walls'); if (chkW) chkW.checked = c.visibility.walls !== false;
    const chkF = $('chk-cov-show-fabric'); if (chkF) chkF.checked = c.visibility.fabric !== false;
    const chkT = $('chk-cov-show-tables'); if (chkT) chkT.checked = c.visibility.tables !== false;
    const chkD = $('chk-cov-dims'); if (chkD) chkD.checked = !!c.showDimensions;
    syncPickButton();
    const vp = $('viewport'); if (vp) vp.classList.toggle('cov-picking', !!c.pickMode);
    updateModeHint(c, lastCoverings);
    renderCoveringRingPicker(true);
}

// ----------------------------------------------------------------------------
// Init
// ----------------------------------------------------------------------------

function initCoveringsUI() {
    if (!$('chk-coverings')) return; // partial not mounted (e.g. embed)
    const c = cov();

    bindCheck('chk-coverings', () => c.enabled, (v) => {
        cov().enabled = v;
        if (!v) setCoveringsPickMode(false);
        updateModeHint(cov(), lastCoverings);
        if (v && cov().spans.every(s => s.lower === 'none' && s.upper === 'none')) {
            showToast('Coverings on: click a wedge in the ring, or use Enclose', 'info');
        }
    });

    // Ring picker clicks (delegated)
    const picker = $('cov-ring-picker');
    if (picker) {
        picker.addEventListener('click', (e) => {
            const wedge = e.target.closest('.cov-wedge');
            if (!wedge || wedge.dataset.disabled === '1') return;
            cycleSpanBand(parseInt(wedge.dataset.span, 10), wedge.dataset.band);
        });
    }

    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    on('btn-cov-enclose', () => setAllSpans(s => { s.lower = 'plywood'; s.upper = 'fabric'; }));
    on('btn-cov-all-ply', () => setAllSpans(s => { s.lower = 'plywood'; s.upper = 'plywood'; }));
    on('btn-cov-all-fabric', () => setAllSpans(s => { s.lower = 'fabric'; s.upper = 'fabric'; }));
    on('btn-cov-clear', () => setAllSpans(s => { s.lower = 'none'; s.upper = 'none'; s.table = false; }));
    on('btn-cov-tables', () => {
        const spans = cov().spans;
        const candidates = spans.filter(s => s.lower === 'plywood');
        const turnOn = candidates.some(s => !s.table);
        if (!candidates.length) { showToast('Tables need a plywood lower wall to rest on', 'info'); return; }
        setAllSpans(s => { if (s.lower === 'plywood') s.table = turnOn; });
    });
    on('btn-cov-fit-sheet', () => {
        const live = lastCoverings && lastCoverings.supported ? lastCoverings.spans.find(s => s.plane) : null;
        const tilt = live ? live.tiltFromVerticalDeg : 0;
        const h = splitHeightForOneSheet(cov(), tilt);
        cov().splitHeightIn = h;
        setPair('sl-cov-split', 'nb-cov-split', h);
        showToast(`Split height set to ${h}" (one ${Math.min(cov().sheet.widthIn, cov().sheet.lengthIn)}" sheet along a ${tilt.toFixed(1)}° slant)`, 'info');
        commit();
    });
    on('btn-cov-guide', () => { if (typeof globalThis.showBuildGuide === 'function') globalThis.showBuildGuide(); });
    on('btn-cov-cutfiles', () => exportCoveringCutFiles());
    on('btn-cov-pick', () => setCoveringsPickMode(!cov().pickMode));
    bindCoveringPick();

    bindPair('sl-cov-split', 'nb-cov-split', () => cov().splitHeightIn, (v) => { cov().splitHeightIn = v; }, { min: 1, max: 600 });
    bindPair('sl-cov-bottom', 'nb-cov-bottom', () => cov().bottomIn, (v) => { cov().bottomIn = v; }, { min: 0, max: 600 });
    bindPair('sl-cov-top-clear', 'nb-cov-top-clear', () => cov().topClearanceIn, (v) => { cov().topClearanceIn = v; }, { min: 0, max: 60 });
    bindPair('sl-cov-edge-gap', 'nb-cov-edge-gap', () => cov().edgeGapIn, (v) => { cov().edgeGapIn = v; }, { min: 0, max: 6 });
    bindPair('sl-cov-tilt', 'nb-cov-tilt', () => cov().lowerTiltDeg, (v) => { cov().lowerTiltDeg = v; }, { min: -80, max: 80 });
    bindPair('sl-cov-tilt-upper', 'nb-cov-tilt-upper', () => cov().upperTiltDeg, (v) => { cov().upperTiltDeg = v; }, { min: -80, max: 80 });
    bindPair('sl-cov-table-depth', 'nb-cov-table-depth', () => cov().table.depthIn, (v) => { cov().table.depthIn = v; }, { min: 1, max: 240 });
    bindPair('sl-cov-table-slide', 'nb-cov-table-slide', () => cov().table.slideIn || 0, (v) => { cov().table.slideIn = v; }, { min: -120, max: 240 });

    bindSelect('sel-cov-lean', () => cov().lowerLean, (v) => {
        cov().lowerLean = v;
        const row = $('cov-tilt-row'); if (row) row.style.display = v === 'custom' ? '' : 'none';
    });
    bindSelect('sel-cov-lean-upper', () => cov().upperLean, (v) => {
        cov().upperLean = v;
        const row = $('cov-tilt-upper-row'); if (row) row.style.display = v === 'custom' ? '' : 'none';
    });
    bindSelect('sel-cov-mount', () => cov().mount, (v) => { cov().mount = v; });

    bindSelect('sel-cov-sheet-preset', () => 'custom', (v) => {
        const p = SHEET_PRESETS[v];
        if (!p) return;
        cov().sheet.widthIn = p.widthIn;
        cov().sheet.lengthIn = p.lengthIn;
        const w = $('nb-cov-sheet-w'), l = $('nb-cov-sheet-l');
        if (w) w.value = p.widthIn;
        if (l) l.value = p.lengthIn;
    });
    bindNumber('nb-cov-sheet-w', () => cov().sheet.widthIn, (v) => { cov().sheet.widthIn = v; syncSheetPresetSelect(cov()); }, { min: 6, max: 240 });
    bindNumber('nb-cov-sheet-l', () => cov().sheet.lengthIn, (v) => { cov().sheet.lengthIn = v; syncSheetPresetSelect(cov()); }, { min: 6, max: 480 });
    bindNumber('nb-cov-sheet-t', () => cov().sheet.thicknessIn, (v) => { cov().sheet.thicknessIn = v; }, { min: 0.1, max: 3 });
    bindSelect('sel-cov-sheet-orient', () => cov().sheet.orientation, (v) => { cov().sheet.orientation = v; });
    bindNumber('nb-cov-kerf', () => cov().sheet.kerfIn, (v) => { cov().sheet.kerfIn = v; }, { min: 0, max: 1 });
    bindNumber('nb-cost-plywood', () => state.costPlywoodSheet, (v) => { state.costPlywoodSheet = v; }, { min: 0, max: 1000 });

    bindNumber('nb-cov-roll', () => cov().fabric.rollWidthIn, (v) => { cov().fabric.rollWidthIn = v; }, { min: 12, max: 240 });
    bindNumber('nb-cov-hem', () => cov().fabric.hemIn, (v) => { cov().fabric.hemIn = v; }, { min: 0, max: 12 });
    bindNumber('nb-cov-seam', () => cov().fabric.seamIn, (v) => { cov().fabric.seamIn = v; }, { min: 0, max: 6 });
    bindNumber('nb-cov-stretch', () => cov().fabric.stretchPct, (v) => { cov().fabric.stretchPct = v; }, { min: 0, max: 20 });
    bindNumber('nb-cov-grommet', () => cov().fabric.grommetSpacingIn, (v) => { cov().fabric.grommetSpacingIn = v; }, { min: 2, max: 120 });
    bindNumber('nb-cost-fabric', () => state.costFabricYard, (v) => { state.costFabricYard = v; }, { min: 0, max: 500 });
    bindNumber('nb-cost-grommet', () => state.costGrommet, (v) => { state.costGrommet = v; }, { min: 0, max: 50 });
    bindNumber('nb-cov-table-t', () => cov().table.thicknessIn, (v) => { cov().table.thicknessIn = v; }, { min: 0.1, max: 3 });

    bindCheck('chk-cov-show-walls', () => cov().visibility.walls, (v) => { cov().visibility.walls = v; });
    bindCheck('chk-cov-show-fabric', () => cov().visibility.fabric, (v) => { cov().visibility.fabric = v; });
    bindCheck('chk-cov-show-tables', () => cov().visibility.tables, (v) => { cov().visibility.tables = v; });
    bindCheck('chk-cov-dims', () => cov().showDimensions, (v) => { cov().showDimensions = v; });

    syncCoveringsUIFromState();
}

const _moduleExports = {
    initCoveringsUI,
    syncCoveringsUIFromState,
    renderCoveringRingPicker,
    updateCoveringsReadout,
    cycleSpanBand,
    exportCoveringCutFiles,
    setCoveringsPickMode,
    pickCoveringAt,
};

bridgeGlobals(_moduleExports, 'coveringsUI');

export { initCoveringsUI, syncCoveringsUIFromState, renderCoveringRingPicker, updateCoveringsReadout, cycleSpanBand, exportCoveringCutFiles, setCoveringsPickMode, pickCoveringAt };
