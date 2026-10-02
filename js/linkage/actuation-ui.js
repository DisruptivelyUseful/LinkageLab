// ============================================================================
// LINKAGE LAB — Actuation sidebar (deployment drive planner)
// Depends on globals: state, scheduleAutoSave (optional), calculateSolarPanelArrayWeight (optional)
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { requestRender } from './render-app.js';
import { saveStateToHistory } from './history.js';
import { computeGeometryHashWithoutFold } from './cache.js';
import { radToDeg } from './math.js';
import { animateActuatorFold } from './animation.js';
import { getStructureFoldedAngle, getStructureDeployedAngle } from './geometry-classes.js';
import { formatInchesFraction } from '../core/unit-converter.js';
import {
    PLACEMENTS, PLACEMENT_IDS, createDefaultActuation, normalizeActuation, analyzeActuation,
} from './actuation.js';

const $ = (id) => document.getElementById(id);

function act() {
    if (!state.actuation) state.actuation = createDefaultActuation();
    return state.actuation;
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
function bindCheck(id, set) { const el = $(id); if (el) el.onchange = (e) => { set(!!e.target.checked); commit(); }; }
function setPair(slId, nbId, val) {
    const sl = $(slId), nb = $(nbId);
    if (sl) sl.value = Math.max(parseFloat(sl.min), Math.min(parseFloat(sl.max), val));
    if (nb) nb.value = val;
}
const setText = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
const fmtLb = (v) => `${Math.round(v)} lb`;
const fmtIn = (v) => formatInchesFraction(v, 8);

// ---------------------------------------------------------------------------
// Analysis cache: recomputed only when the geometry (without fold) or the
// settings that change the numbers move, never per frame.
// ---------------------------------------------------------------------------
let _last = { key: null, result: null };

function analysisKey(data) {
    const a = act();
    const panelW = panelWeight(data);
    const { enabled, show3D, ...rest } = a;
    return JSON.stringify([computeGeometryHashWithoutFold(), rest, panelW, trackY(data)]);
}

function panelWeight(data) {
    if (!data || !data.panels || !data.panels.length) return 0;
    if (typeof globalThis.calculateSolarPanelArrayWeight === 'function') return globalThis.calculateSolarPanelArrayWeight(data.panels);
    return 0;
}

function trackY(data) {
    const t = data && data.floorTracks && data.floorTracks[0];
    return t ? t.centreY : undefined;
}

/** Current analysis (selected placement + all placements) for the current state, or null. */
function getActuationAnalysis(data) {
    const a = act();
    if (!a.enabled) return null;
    if (state.orientation === 'vertical') return null;
    const key = analysisKey(data);
    if (_last.key === key && _last.result) return _last.result;
    try {
        _last = { key, result: analyzeActuation(state, { key, panelWeightLb: panelWeight(data), trackY: trackY(data), groundY: 0 }) };
    } catch (e) {
        console.warn('[Actuation] analysis failed:', e);
        _last = { key, result: null };
    }
    return _last.result;
}

/** Interpolated force / length at the live fold angle from the sampled curve. */
function curveAt(result, foldAngleRad) {
    const curve = result && result.curve;
    if (!curve || !curve.length) return null;
    const deg = radToDeg(foldAngleRad);
    if (deg <= curve[0].thetaDeg) return curve[0];
    if (deg >= curve[curve.length - 1].thetaDeg) return curve[curve.length - 1];
    for (let i = 1; i < curve.length; i++) {
        if (deg <= curve[i].thetaDeg) {
            const a = curve[i - 1], b = curve[i];
            const t = (deg - a.thetaDeg) / ((b.thetaDeg - a.thetaDeg) || 1);
            return { thetaDeg: deg, length: a.length + (b.length - a.length) * t, force: a.force + (b.force - a.force) * t, sense: t < 0.5 ? a.sense : b.sense, progress: a.progress + (b.progress - a.progress) * t };
        }
    }
    return curve[curve.length - 1];
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
function updateVisibility() {
    const a = act();
    const arch = state.orientation === 'vertical';
    const hint = $('act-mode-hint');
    if (hint) { hint.textContent = arch ? 'The drive planner works on the cylinder (ring) structure only.' : ''; hint.style.display = a.enabled && arch ? '' : 'none'; }
    const controls = $('act-controls');
    if (controls) controls.style.display = a.enabled && !arch ? '' : 'none';
    const show = (id, on) => { const el = $(id); if (el) el.style.display = on ? '' : 'none'; };
    show('act-params-hScissor', a.placement === 'hScissor');
    show('act-params-xDiagonal', a.placement === 'xDiagonal');
    show('act-params-mastCable', a.placement === 'mastCable');
    show('act-params-track', a.placement === 'trackCable' || a.placement === 'trackScrew');
    const cnt = $('nb-act-count');
    if (cnt) cnt.style.display = (a.drives.pattern === 'all' && a.drives.count > 0) ? '' : 'none';
    const sum = $('act-placement-summary');
    if (sum && PLACEMENTS[a.placement]) sum.textContent = PLACEMENTS[a.placement].summary;
}

function syncActuationUIFromState() {
    const a = act();
    const chk = $('chk-act-enable'); if (chk) chk.checked = !!a.enabled;
    const c = (id, v) => { const el = $(id); if (el) el.checked = !!v; };
    c('chk-act-panels', a.load.includePanels);
    c('chk-act-show3d', a.show3D !== false);
    const sel = $('sel-act-placement'); if (sel) sel.value = a.placement;
    const pat = $('sel-act-pattern'); if (pat) pat.value = a.drives.pattern === 'alternate' ? 'alternate' : (a.drives.count > 0 ? 'count' : 'all');
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    set('nb-act-count', a.drives.count > 0 ? a.drives.count : Math.max(1, Math.ceil((state.modules || 8) / 2)));
    setPair('sl-act-r', 'nb-act-r', a.params.hScissorR);
    setPair('sl-act-e', 'nb-act-e', a.params.hScissorE);
    setPair('sl-act-xlow', 'nb-act-xlow', a.params.xDiagLow);
    setPair('sl-act-xhigh', 'nb-act-xhigh', a.params.xDiagHigh);
    setPair('sl-act-mast', 'nb-act-mast', a.params.mastHeightIn);
    setPair('sl-act-tail', 'nb-act-tail', a.params.trackTailIn);
    set('nb-act-roofload', a.load.extraRoofLoadLb);
    set('nb-act-eff', a.load.efficiencyPct);
    set('nb-act-mu', a.load.groundMu);
    set('nb-act-sf', a.load.safetyFactor);
    set('nb-act-time', a.motor.deployTimeSec);
    set('nb-act-volts', a.motor.systemVolts);
    set('nb-act-elec', a.motor.electricalEfficiencyPct);
    set('nb-act-rated', a.motor.ratedForceLb);
    set('nb-act-cost', a.motor.costEach);
    updateVisibility();
}

function drawSparkline(result, now) {
    const svg = $('act-spark');
    if (!svg) return;
    const curve = result && result.curve;
    if (!curve || curve.length < 2) { svg.innerHTML = ''; return; }
    const W = 240, H = 72, padL = 4, padR = 4, padT = 6, padB = 10;
    const maxF = Math.max(1e-6, ...curve.map(c => c.force));
    const x = (p) => padL + p * (W - padL - padR);
    const y = (f) => padT + (1 - f / maxF) * (H - padT - padB);
    const pts = curve.map(c => `${x(c.progress).toFixed(1)},${y(c.force).toFixed(1)}`).join(' ');
    const gpts = curve.map(c => `${x(c.progress).toFixed(1)},${y(c.gravityForce).toFixed(1)}`).join(' ');
    const area = `${x(0).toFixed(1)},${y(0).toFixed(1)} ${pts} ${x(1).toFixed(1)},${y(0).toFixed(1)}`;
    const garea = `${x(0).toFixed(1)},${y(0).toFixed(1)} ${gpts} ${x(1).toFixed(1)},${y(0).toFixed(1)}`;
    const rated = result.ratedForceLb;
    const ratedLine = rated > 0 && rated < maxF
        ? `<line x1="${padL}" x2="${W - padR}" y1="${y(rated).toFixed(1)}" y2="${y(rated).toFixed(1)}" class="act-spark-rated" />`
        : '';
    const dot = now ? `<circle cx="${x(now.progress).toFixed(1)}" cy="${y(now.force).toFixed(1)}" r="3" class="act-spark-dot" />` : '';
    svg.innerHTML = `<polygon points="${area}" class="act-spark-area act-spark-area-friction" /><polygon points="${garea}" class="act-spark-area" /><polyline points="${pts}" class="act-spark-line" />${ratedLine}${dot}`
        + `<text x="${padL}" y="${H - 1}" class="act-spark-txt">packed</text><text x="${W - padR}" y="${H - 1}" class="act-spark-txt" text-anchor="end">deployed</text>`
        + `<text x="${padL}" y="${padT + 7}" class="act-spark-txt">${Math.round(maxF)} lb</text>`;
}

function renderCompare(result) {
    const box = $('act-compare');
    if (!box || !result || !result.all) return;
    const a = act();
    const rows = result.all.map(r => {
        const sel = r.id === a.placement ? ' class="is-selected"' : '';
        const sense = r.senses.length === 1 ? r.senses[0] : 'push+pull';
        const flag = (r.family === 'cable' && !r.cableOk) ? ' ⚠' : '';
        return `<tr${sel} data-placement="${r.id}"><td>${r.short}</td><td>${fmtIn(r.stroke)}</td><td>${Math.round(r.peakForce)}</td><td>${Math.round(r.kickoffForce)}</td><td>${Math.round(r.deployedForce)}</td><td>${sense}${flag}</td></tr>`;
    }).join('');
    box.innerHTML = `<table class="act-table"><thead><tr><th>Placement</th><th>Stroke</th><th>Peak lb</th><th>Packed lb</th><th>Deployed lb</th><th>Sense</th></tr></thead><tbody>${rows}</tbody></table>`
        + '<div class="hint">Per drive, with the same drives, load and losses. Click a row to select it. A flat packed→deployed force means a smooth deploy; a packed force many times the deployed force needs a kick-off helper.</div>';
    box.style.display = '';
    box.querySelectorAll('tr[data-placement]').forEach(tr => {
        tr.onclick = () => { act().placement = tr.getAttribute('data-placement'); syncActuationUIFromState(); commit(); };
    });
}

/** Called from scene-render on every frame. */
function updateActuationReadout(data) {
    const a = act();
    updateVisibility();
    if (!a.enabled || state.orientation === 'vertical') return;
    const result = getActuationAnalysis(data);
    const r = result && result.selected;
    if (!r) {
        ['stroke', 'lengths', 'mount-a', 'mount-b', 'drives', 'now', 'peak', 'ends', 'rating', 'kickoff', 'lifted', 'energy', 'power', 'current', 'fit']
            .forEach(k => setText(`act-stat-${k}`, '--'));
        drawSparkline(null);
        return;
    }
    const now = curveAt(r, state.foldAngle);
    setText('act-stat-stroke', fmtIn(r.stroke));
    setText('act-stat-lengths', `${fmtIn(r.lenMin)} → ${fmtIn(r.lenMax)}`);
    setText('act-stat-mount-a', r.mountText[0]);
    setText('act-stat-mount-b', r.mountText[1]);
    setText('act-stat-drives', `${r.nDrives} of ${r.modules} modules (${r.driveModules.map(i => i + 1).join(', ')})`);
    setText('act-stat-now', now ? `${fmtLb(now.force)} ${now.sense} at ${now.thetaDeg.toFixed(1)}°, length ${fmtIn(now.length)}` : '--');
    setText('act-stat-peak', `${fmtLb(r.peakForce)} at ${r.peakAngleDeg.toFixed(1)}° (${Math.round(r.peakProgress * 100)}% deployed)`);
    setText('act-stat-ends', `${fmtLb(r.kickoffForce)} / ${fmtLb(r.deployedForce)} · gravity curve flatness ${Math.round(r.gravityFlatness * 100)}% · feet drag up to ${fmtLb(r.peakFrictionForce)}`);
    setText('act-stat-rating', `${fmtLb(r.suggestedRatingLb)} per drive (×${a.load.safetyFactor} safety)`);
    if (r.kickoff) {
        const k = r.kickoff;
        setText('act-stat-kickoff', `Needed: the drive exceeds ${fmtLb(r.ratedForceLb)} until ${k.handoverAngleDeg.toFixed(1)}° (${Math.round(k.handoverProgress * 100)}%). A helper must lift the roof ${fmtIn(k.liftIn)} with about ${fmtLb(k.perModuleLiftLb)} per module (gas springs across the X, or pack no flatter than ${k.handoverAngleDeg.toFixed(0)}°).`);
    } else {
        setText('act-stat-kickoff', `Not needed: the force stays under ${fmtLb(r.ratedForceLb)} from packed to deployed.`);
    }
    setText('act-stat-lifted', `${fmtLb(r.liftedWeightLb)} of ${fmtLb(r.totalWeightLb)} rises with the roof`);
    setText('act-stat-energy', `${r.energyWh.toFixed(2)} Wh electrical (${(r.mechJ / 1000).toFixed(2)} kJ mechanical)`);
    setText('act-stat-power', `${Math.round(r.avgElectricalW)} W average, ${Math.round(r.peakElectricalW)} W peak over ${a.motor.deployTimeSec} s (${(r.speedMps * 39.37).toFixed(2)} in/s)`);
    setText('act-stat-current', `${r.currentA.toFixed(1)} A peak at ${a.motor.systemVolts} V, all drives together`);
    let fit = '';
    if (r.family === 'linear') fit = r.fitsStandardActuator ? `A rod actuator fits: shortest length ${fmtIn(r.lenMin)} ≥ stroke + 8 in.` : `Too short when packed (${fmtIn(r.lenMin)} < stroke + 8 in = ${fmtIn(r.retractedNeeded)}): lengthen the lever arm or tab offset, or use a cable/screw rail.`;
    else if (r.family === 'cable') fit = r.cableOk ? 'Always a pull, so a cable works; lowering runs on gravity under the brake.' : 'The sense flips to push somewhere in the sweep, so a cable alone cannot drive it.';
    else if (r.id === 'hScissor') fit = `Lead screw: packed clearance between the motor pivot and the nut is ${fmtIn(r.lenMin)} (two tabs of ${fmtIn(Math.abs(a.params.hScissorE))}); the screw protrudes past the nut by the stroke when packed.`;
    else fit = 'A fixed-length screw rail spans the whole travel; stroke = slot length.';
    setText('act-stat-fit', fit);
    const hw = $('act-hardware'); if (hw) hw.textContent = `Hardware: ${r.hardware}`;
    drawSparkline(r, now);
    if ($('act-compare') && $('act-compare').style.display !== 'none') renderCompare(result);
}

function initActuationUI() {
    if (!$('chk-act-enable')) return;
    const sel = $('sel-act-placement');
    if (sel && !sel.options.length) {
        PLACEMENT_IDS.forEach(id => { const o = document.createElement('option'); o.value = id; o.textContent = PLACEMENTS[id].label; sel.appendChild(o); });
    }
    bindCheck('chk-act-enable', (v) => { act().enabled = v; updateVisibility(); });
    bindCheck('chk-act-panels', (v) => { act().load.includePanels = v; });
    bindCheck('chk-act-show3d', (v) => { act().show3D = v; });
    if (sel) sel.onchange = (e) => { act().placement = PLACEMENTS[e.target.value] ? e.target.value : 'hScissor'; updateVisibility(); commit(); };
    const pat = $('sel-act-pattern');
    if (pat) pat.onchange = (e) => {
        const d = act().drives;
        if (e.target.value === 'alternate') { d.pattern = 'alternate'; d.count = 0; }
        else if (e.target.value === 'count') { d.pattern = 'all'; d.count = Math.max(1, parseInt($('nb-act-count').value, 10) || 1); }
        else { d.pattern = 'all'; d.count = 0; }
        updateVisibility(); commit();
    };
    bindNumber('nb-act-count', () => act().drives.count || 1, (v) => { act().drives.count = Math.max(1, Math.round(v)); }, { min: 1, max: 64 });
    const p = () => act().params, l = () => act().load, m = () => act().motor;
    bindPair('sl-act-r', 'nb-act-r', () => p().hScissorR, (v) => { p().hScissorR = v; }, { min: -600, max: 600 });
    bindPair('sl-act-e', 'nb-act-e', () => p().hScissorE, (v) => { p().hScissorE = v; }, { min: -120, max: 120 });
    bindPair('sl-act-xlow', 'nb-act-xlow', () => p().xDiagLow, (v) => { p().xDiagLow = v; }, { min: 0, max: 600 });
    bindPair('sl-act-xhigh', 'nb-act-xhigh', () => p().xDiagHigh, (v) => { p().xDiagHigh = v; }, { min: 0, max: 600 });
    bindPair('sl-act-mast', 'nb-act-mast', () => p().mastHeightIn, (v) => { p().mastHeightIn = v; }, { min: 1, max: 2400 });
    bindPair('sl-act-tail', 'nb-act-tail', () => p().trackTailIn, (v) => { p().trackTailIn = v; }, { min: 0, max: 600 });
    bindNumber('nb-act-roofload', () => l().extraRoofLoadLb, (v) => { l().extraRoofLoadLb = v; }, { min: 0, max: 100000 });
    bindNumber('nb-act-eff', () => l().efficiencyPct, (v) => { l().efficiencyPct = v; }, { min: 5, max: 100 });
    bindNumber('nb-act-mu', () => l().groundMu, (v) => { l().groundMu = v; }, { min: 0, max: 2 });
    bindNumber('nb-act-sf', () => l().safetyFactor, (v) => { l().safetyFactor = v; }, { min: 1, max: 10 });
    bindNumber('nb-act-time', () => m().deployTimeSec, (v) => { m().deployTimeSec = v; }, { min: 1, max: 36000 });
    bindNumber('nb-act-volts', () => m().systemVolts, (v) => { m().systemVolts = v; }, { min: 1, max: 1000 });
    bindNumber('nb-act-elec', () => m().electricalEfficiencyPct, (v) => { m().electricalEfficiencyPct = v; }, { min: 5, max: 100 });
    bindNumber('nb-act-rated', () => m().ratedForceLb, (v) => { m().ratedForceLb = v; }, { min: 0, max: 100000 });
    bindNumber('nb-act-cost', () => m().costEach, (v) => { m().costEach = v; }, { min: 0, max: 100000 });
    const run = $('btn-act-run');
    if (run) run.onclick = () => animateActuatorFold(getStructureDeployedAngle(), Math.max(500, act().motor.deployTimeSec * 1000));
    const fold = $('btn-act-fold');
    if (fold) fold.onclick = () => animateActuatorFold(getStructureFoldedAngle(), Math.max(500, act().motor.deployTimeSec * 1000));
    const cmp = $('btn-act-compare');
    if (cmp) cmp.onclick = () => {
        const box = $('act-compare');
        if (box && box.style.display !== 'none') { box.style.display = 'none'; return; }
        const data = (typeof globalThis.buildLinkageGeometry === 'function') ? globalThis.buildLinkageGeometry({ useCache: true }) : null;
        const result = getActuationAnalysis(data);
        if (result) renderCompare(result);
    };
    syncActuationUIFromState();
}

const _moduleExports = { initActuationUI, syncActuationUIFromState, updateActuationReadout, getActuationAnalysis, curveAt };
bridgeGlobals(_moduleExports, 'actuationUI');
export { initActuationUI, syncActuationUIFromState, updateActuationReadout, getActuationAnalysis, curveAt };
