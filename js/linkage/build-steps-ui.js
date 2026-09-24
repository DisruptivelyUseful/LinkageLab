// ============================================================================ (ES module)
//
// Build Steps — editor UI.
//
// Sidebar group: the ordered step list (drag to reorder), and the editor for
// the selected step (title, kind, targets, notes, saved view, timing, op
// parameters). Viewport: the transport bar and the caption overlay shown in
// build mode. Playback itself lives in build-steps-anim.js.

import { bridgeGlobals } from './global-bridge.js';
import { state } from './app-state.js';
import { debounce, radToDeg } from './math.js';
import { showToast } from '../core/feedback.js';
import { getConfigSnapshot } from './config-persistence.js';
import { patchProjectDocumentLinkageSlice, extractLinkageSliceFromConfig } from '../core/project-store.js';
import { saveStateToHistory } from './history.js';
import { requestRender } from './render-app.js';
import { invalidateGeometryCache } from './cache.js';
import { buildLinkageGeometry } from './linkage-geometry.js';
import { collectParts, groupSelectorForPart, partKind, resolveTargets, selectorForPart, selectorLabel } from './part-keys.js';
import { threeRenderer } from './renderer-3d.js';
import { getStructureFoldedAngle, getStructureDeployedAngle } from './geometry-classes.js';
import { getBeamBoltIntersections } from './renderer-3d.js';
import {
    STEP_KINDS,
    STEP_KIND_META,
    addStep,
    createDefaultBuildSteps,
    createStep,
    duplicateStep,
    generateDefaultBuildSteps,
    getStepById,
    moveStep,
    removeStep,
    stepIndexById,
    stepSummary,
    updateStep,
} from './build-steps.js';
import {
    autoFrameStep,
    captureCurrentView,
    enterPlayback,
    exitPlayback,
    goToStep,
    next as playbackNext,
    onPlaybackChange,
    pause as playbackPause,
    play as playbackPlay,
    prev as playbackPrev,
    scrubOp,
    setLoop,
    setSpeed,
    showStepView,
    togglePlay,
} from './build-steps-anim.js';

const ui = {
    selectedId: null,
    drag: { id: null, overId: null, after: false },
    pick: { active: false, stepId: null, downX: 0, downY: 0, raycaster: null, pointer: null },
    els: {},
};

function buildSteps() {
    if (!state.buildSteps || !Array.isArray(state.buildSteps.steps)) state.buildSteps = createDefaultBuildSteps();
    return state.buildSteps;
}

function playback() {
    return state.buildPlayback || (state.buildPlayback = { active: false, playing: false, stepIndex: 0, phase: 'idle', t: 0, speed: 1, loop: false });
}

function el(id) {
    return document.getElementById(id);
}

function esc(s) {
    return String(s === undefined || s === null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const persistNow = () => {
    try {
        const snapshot = getConfigSnapshot();
        localStorage.setItem('linkageLab_config', JSON.stringify(snapshot));
        patchProjectDocumentLinkageSlice(extractLinkageSliceFromConfig(snapshot));
    } catch (e) {
        console.warn('[BuildSteps] Failed to persist steps:', e);
    }
};
const persistBuildSteps = debounce(persistNow, 800);

function changed({ rerenderList = true, rerenderEditor = false } = {}) {
    persistBuildSteps();
    saveStateToHistory();
    if (rerenderList) renderStepList();
    if (rerenderEditor) renderEditor();
    renderChips();
    if (playback().active) { invalidateGeometryCache(); requestRender(); }
}

// ---------------------------------------------------------------------------
// Geometry helpers for the editor
// ---------------------------------------------------------------------------

let _partsCache = { data: null, parts: null };
function currentParts() {
    const data = buildLinkageGeometry({ useCache: true });
    if (_partsCache.data !== data) _partsCache = { data, parts: collectParts(data) };
    return _partsCache;
}

function targetCount(step) {
    if (!step.targets || !step.targets.length) return null;
    const { data, parts } = currentParts();
    return resolveTargets(data, step.targets, parts).items.length;
}

// ---------------------------------------------------------------------------
// Step list
// ---------------------------------------------------------------------------

function renderStepList() {
    const list = el('bs-step-list');
    const empty = el('bs-empty');
    if (!list) return;
    const steps = buildSteps().steps;
    list.innerHTML = '';
    if (empty) empty.style.display = steps.length ? 'none' : 'block';
    if (ui.selectedId && !getStepById(buildSteps(), ui.selectedId)) ui.selectedId = null;

    steps.forEach((step, i) => {
        const meta = STEP_KIND_META[step.kind] || STEP_KIND_META.view;
        const row = document.createElement('div');
        row.className = 'bs-step' + (step.id === ui.selectedId ? ' selected' : '') + (playback().active && playback().stepIndex === i ? ' playing' : '');
        row.dataset.id = step.id;
        const count = targetCount(step);
        const warn = count === 0 ? '<span class="bs-warn" title="No parts in the current design match this step\'s targets">⚠</span>' : '';
        row.innerHTML = `
            <span class="bs-grip" draggable="true" title="Drag to reorder">⠿</span>
            <span class="bs-idx">${i + 1}</span>
            <span class="bs-kind" title="${esc(meta.label)}">${meta.icon}</span>
            <span class="bs-main">
                <span class="bs-title">${esc(step.title)}</span>
                <span class="bs-sub">${esc(stepSummary(step))}${count ? ` · ${count} part${count === 1 ? '' : 's'}` : ''}</span>
            </span>
            ${warn}
            <button class="bs-mini" data-act="dup" title="Duplicate">⧉</button>
            <button class="bs-mini bs-mini-danger" data-act="del" title="Delete">✕</button>`;

        row.addEventListener('click', (e) => {
            const act = e.target && e.target.dataset ? e.target.dataset.act : null;
            if (act === 'dup') {
                const copy = duplicateStep(buildSteps(), step.id);
                ui.selectedId = copy.id;
                changed({ rerenderEditor: true });
                return;
            }
            if (act === 'del') {
                removeStep(buildSteps(), step.id);
                if (ui.selectedId === step.id) ui.selectedId = null;
                const pb = playback();
                if (pb.active) goToStep(Math.min(pb.stepIndex, buildSteps().steps.length - 1), { immediate: true });
                changed({ rerenderEditor: true });
                return;
            }
            selectStep(step.id, { jump: true });
        });

        // Drag and drop reorder (same pattern as the hardware part cards)
        const grip = row.querySelector('.bs-grip');
        grip.addEventListener('dragstart', (e) => {
            ui.drag.id = step.id;
            row.classList.add('bs-dragging');
            try { e.dataTransfer.setData('text/plain', step.id); e.dataTransfer.effectAllowed = 'move'; } catch (err) { /* ignore */ }
        });
        grip.addEventListener('dragend', () => {
            ui.drag.id = null;
            list.querySelectorAll('.bs-step').forEach(r => r.classList.remove('bs-dragging', 'bs-drop-before', 'bs-drop-after'));
        });
        row.addEventListener('dragover', (e) => {
            if (!ui.drag.id || ui.drag.id === step.id) return;
            e.preventDefault();
            const rect = row.getBoundingClientRect();
            const after = (e.clientY - rect.top) > rect.height / 2;
            ui.drag.overId = step.id;
            ui.drag.after = after;
            list.querySelectorAll('.bs-step').forEach(r => r.classList.remove('bs-drop-before', 'bs-drop-after'));
            row.classList.add(after ? 'bs-drop-after' : 'bs-drop-before');
        });
        row.addEventListener('dragleave', () => row.classList.remove('bs-drop-before', 'bs-drop-after'));
        row.addEventListener('drop', (e) => {
            e.preventDefault();
            if (!ui.drag.id || ui.drag.id === step.id) return;
            const bs = buildSteps();
            const from = stepIndexById(bs, ui.drag.id);
            let to = stepIndexById(bs, step.id);
            if (from < 0 || to < 0) return;
            if (ui.drag.after && from > to) to += 1;
            if (!ui.drag.after && from < to) to -= 1;
            if (moveStep(bs, from, to)) {
                const pb = playback();
                if (pb.active) pb.stepIndex = Math.max(0, Math.min(bs.steps.length - 1, pb.stepIndex));
                changed();
            }
            ui.drag.id = null;
        });

        list.appendChild(row);
    });
}

function selectStep(id, { jump = false } = {}) {
    ui.selectedId = id;
    renderStepList();
    renderEditor();
    const idx = stepIndexById(buildSteps(), id);
    if (jump && playback().active && idx >= 0) goToStep(idx, { immediate: true });
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const STACK_TYPE_OPTIONS = [
    ['', 'All beams'],
    ['horizontal-bottom', 'Bottom H-beams'],
    ['horizontal-top', 'Top H-beams'],
    ['vertical', 'V-beams'],
    ['vertical-cap', 'Cap V-beams'],
    ['fixed-beam', 'Fixed beams'],
    ['fixed-beam-cap', 'Cap fixed beams'],
    ['support-beam', 'Radial support beams'],
    ['support-beam-reciprocal', 'Reciprocal beams'],
];
const BOLT_TYPE_OPTIONS = [['', 'All bolts'], ['vstack', 'V-stack bolts'], ['hstack', 'H-center bolts'], ['hpivot', 'H-pivot bolts'], ['rcp-ring', 'Reciprocal ring bolts'], ['rcp-cross', 'Reciprocal cross bolts']];
const RING_OPTIONS = [['', 'Any ring'], ['bottom', 'Bottom ring'], ['top', 'Top ring'], ['center', 'Center']];
const ROLE_OPTIONS = [['', 'Any role'], ['inner', 'Inner'], ['outer', 'Outer'], ['center', 'Center']];

function optionsHtml(options, selected = '') {
    return options.map(([v, label]) => `<option value="${esc(v)}"${String(v) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`).join('');
}

function moduleOptions() {
    const n = Math.max(1, state.modules || 1);
    const opts = [['', 'All modules']];
    for (let i = 0; i < n; i++) opts.push([String(i), `Module ${i + 1}`]);
    return opts;
}

function layerOptions() {
    const n = Math.max(state.hStackCount || 1, state.vStackCount || 1);
    const opts = [['', 'All layers']];
    for (let i = 0; i < n; i++) opts.push([String(i), `Layer ${i + 1}`]);
    return opts;
}

function assemblyOptions() {
    const asms = (state.hardwareAssemblies && state.hardwareAssemblies.assemblies) || {};
    const opts = [['', 'Any assembly']];
    Object.keys(asms).forEach(id => opts.push([id, asms[id].label || id]));
    return opts;
}

function pickerHtml() {
    return `
    <div class="bs-picker">
        <div class="bs-picker-row">
            <select id="bs-pick-kind" class="bs-select">
                <option value="beam">Beams</option>
                <option value="joint">Joint (bolt + bracket + washers)</option>
                <option value="bolt">Bolts</option>
                <option value="bracket">Brackets</option>
                <option value="placement">Hardware assembly</option>
                <option value="panel">Solar panels</option>
                <option value="*">Everything</option>
            </select>
            <button id="bs-pick-add" class="bs-btn" title="Add this target to the step">Add</button>
            <button id="bs-pick-3d" class="bs-btn" title="Click parts in the 3D view to add them (Shift+click adds the whole stack / joint). Escape or click again to stop.">🎯 Pick in 3D</button>
        </div>
        <div class="bs-picker-row" id="bs-pick-fields"></div>
    </div>`;
}

function renderPickerFields() {
    const box = el('bs-pick-fields');
    const kind = el('bs-pick-kind') ? el('bs-pick-kind').value : 'beam';
    if (!box) return;
    let html = '';
    const mod = `<select id="bs-pick-module" class="bs-select">${optionsHtml(moduleOptions())}</select>`;
    if (kind === 'beam') {
        html = `<select id="bs-pick-stack" class="bs-select">${optionsHtml(STACK_TYPE_OPTIONS)}</select>${mod}
                <select id="bs-pick-layer" class="bs-select">${optionsHtml(layerOptions())}</select>
                <select id="bs-pick-pattern" class="bs-select">${optionsHtml([['', 'Both patterns'], ['A', 'Pattern A'], ['B', 'Pattern B']])}</select>`;
    } else if (kind === 'joint') {
        html = `${mod}<select id="bs-pick-ring" class="bs-select">${optionsHtml(RING_OPTIONS)}</select>
                <select id="bs-pick-role" class="bs-select">${optionsHtml(ROLE_OPTIONS)}</select>`;
    } else if (kind === 'bolt') {
        html = `<select id="bs-pick-bolttype" class="bs-select">${optionsHtml(BOLT_TYPE_OPTIONS)}</select>${mod}
                <select id="bs-pick-ring" class="bs-select">${optionsHtml(RING_OPTIONS)}</select>
                <select id="bs-pick-role" class="bs-select">${optionsHtml(ROLE_OPTIONS)}</select>`;
    } else if (kind === 'bracket') {
        html = `${mod}<select id="bs-pick-ring" class="bs-select">${optionsHtml(RING_OPTIONS.filter(o => o[0] !== 'center'))}</select>
                <select id="bs-pick-role" class="bs-select">${optionsHtml(ROLE_OPTIONS.filter(o => o[0] !== 'center'))}</select>`;
    } else if (kind === 'placement') {
        html = `<select id="bs-pick-assembly" class="bs-select">${optionsHtml(assemblyOptions())}</select>${mod}
                <select id="bs-pick-ring" class="bs-select">${optionsHtml(RING_OPTIONS)}</select>`;
    } else if (kind === 'panel') {
        html = `<span class="bs-hint">All solar panels</span>`;
    } else {
        html = `<span class="bs-hint">Every part of the structure</span>`;
    }
    box.innerHTML = html;
}

function selectorFromPicker() {
    const kind = el('bs-pick-kind').value;
    const val = (id) => { const e = el(id); return e && e.value !== '' ? e.value : undefined; };
    const num = (id) => { const v = val(id); return v === undefined ? undefined : parseInt(v, 10); };
    const sel = { kind };
    if (kind === 'beam') {
        if (val('bs-pick-stack')) sel.stackType = val('bs-pick-stack');
        if (num('bs-pick-module') !== undefined) sel.moduleIndex = num('bs-pick-module');
        if (num('bs-pick-layer') !== undefined) sel.layerIndex = num('bs-pick-layer');
        if (val('bs-pick-pattern')) sel.patternId = val('bs-pick-pattern');
    } else if (kind === 'joint' || kind === 'bolt' || kind === 'bracket' || kind === 'placement') {
        if (kind === 'bolt' && val('bs-pick-bolttype')) sel.boltType = val('bs-pick-bolttype');
        if (kind === 'placement' && val('bs-pick-assembly')) sel.assemblyId = val('bs-pick-assembly');
        if (num('bs-pick-module') !== undefined) sel.moduleIndex = num('bs-pick-module');
        if (val('bs-pick-ring')) sel.ring = val('bs-pick-ring');
        if (val('bs-pick-role')) sel[kind === 'bracket' ? 'pivotRole' : 'role'] = val('bs-pick-role');
    }
    return sel;
}

function viewStatusText(step) {
    if (!step.view) return step.targets && step.targets.length ? 'Auto-frame targets' : 'Keep current camera';
    const v = step.view;
    const fold = v.foldAngleDeg === null || v.foldAngleDeg === undefined ? '' : ` · fold ${v.foldAngleDeg.toFixed(0)}°`;
    return `Saved · yaw ${radToDeg(v.yaw).toFixed(0)}° · pitch ${radToDeg(v.pitch).toFixed(0)}° · dist ${v.dist.toFixed(0)}${fold}`;
}

function opFieldsHtml(step) {
    const op = step.op || {};
    switch (step.kind) {
        case 'cut':
            return `<div class="bs-field-row">
                <label>Stock length (in) <input type="number" id="bs-op-stock" min="1" step="1" value="${op.stockLengthIn == null ? '' : esc(op.stockLengthIn)}" placeholder="auto"></label>
                <label>Kerf (in) <input type="number" id="bs-op-kerf" min="0" step="0.0625" value="${esc(op.kerfIn == null ? 0.125 : op.kerfIn)}"></label>
            </div>`;
        case 'drill':
            return `<div class="bs-field-row">
                <label>Bit Ø (in) <input type="number" id="bs-op-bit" min="0.0625" step="0.0625" value="${op.bitDiameterIn == null ? '' : esc(op.bitDiameterIn)}" placeholder="bolt Ø"></label>
                <span class="bs-hint">Holes come from the bolts that pass through the beam.</span>
            </div>`;
        case 'place':
            return `<div class="bs-field-row">
                <label>Approach <select id="bs-op-approach" class="bs-select">${optionsHtml([['above', 'From above'], ['radial', 'From outside (radial)'], ['axis', 'Along its axis']], op.approach || 'above')}</select></label>
                <label>Travel (in) <input type="number" id="bs-op-travel" min="1" step="1" value="${esc(op.travelIn == null ? 24 : op.travelIn)}"></label>
            </div>`;
        case 'fasten':
            return `<div class="bs-field-row">
                <label>Turns <input type="number" id="bs-op-turns" min="0.5" step="0.5" value="${esc(op.turns == null ? 3 : op.turns)}"></label>
                <label class="bs-check"><input type="checkbox" id="bs-op-allmodules"${op.allModules ? ' checked' : ''}> All modules</label>
                <span class="bs-hint">Targets should be joints or bolts. A nut on the same joint turns with the bolt when present.</span>
            </div>`;
        default:
            return '';
    }
}

function renderEditor() {
    const box = el('bs-editor');
    if (!box) return;
    const step = ui.selectedId ? getStepById(buildSteps(), ui.selectedId) : null;
    if (!step) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = 'block';
    const idx = stepIndexById(buildSteps(), step.id);
    const meta = STEP_KIND_META[step.kind];
    const chips = (step.targets || []).map((sel, i) => `<span class="bs-chip" title="${esc(JSON.stringify(sel))}">${esc(selectorLabel(sel))}<button class="bs-chip-x" data-i="${i}" title="Remove">✕</button></span>`).join('');

    box.innerHTML = `
        <div class="bs-editor-head">Step ${idx + 1} <span class="bs-editor-kind">${meta.icon} ${esc(meta.label)}</span></div>
        <label class="bs-field">Title <input type="text" id="bs-ed-title" value="${esc(step.title)}"></label>
        <div class="bs-field-row">
            <label>Kind <select id="bs-ed-kind" class="bs-select">${optionsHtml(STEP_KINDS.map(k => [k, `${STEP_KIND_META[k].icon} ${STEP_KIND_META[k].label}`]), step.kind)}</select></label>
            <label>Stage <select id="bs-ed-stage" class="bs-select">${optionsHtml([['assembly', 'In assembly'], ['bench', 'Workbench']], step.stage)}</select></label>
        </div>
        <div class="bs-hint">${esc(meta.hint)}</div>
        <div class="bs-field-label">Parts in this step</div>
        <div class="bs-chips-wrap" id="bs-ed-chips">${chips || '<span class="bs-hint">No parts selected (view steps do not need any).</span>'}</div>
        ${pickerHtml()}
        <div class="bs-field-label">Camera view <span class="bs-view-status" id="bs-ed-viewstatus">${esc(viewStatusText(step))}</span></div>
        <div class="bs-btn-row">
            <button id="bs-ed-capture" class="bs-btn" title="Save the current camera and fold angle on this step">📷 Capture</button>
            <button id="bs-ed-autoframe" class="bs-btn" title="Frame this step's parts">⛶ Auto-frame</button>
            <button id="bs-ed-goto" class="bs-btn" title="Move the camera to this step's view">👁 Go to</button>
            <button id="bs-ed-clearview" class="bs-btn" title="Forget the saved view">Clear</button>
        </div>
        <div class="bs-field-row">
            <label>Transition (ms) <input type="number" id="bs-ed-transition" min="0" step="100" value="${esc(step.transitionMs)}"></label>
            <label>Duration (ms) <input type="number" id="bs-ed-duration" min="0" step="100" value="${esc(step.durationMs)}"></label>
        </div>
        ${opFieldsHtml(step)}
        <label class="bs-field">Notes / tips <textarea id="bs-ed-notes" rows="3" placeholder="Tips shown with this step in the guide">${esc(step.notes)}</textarea></label>`;

    const bs = buildSteps();
    const upd = (patch, opts = {}) => { updateStep(bs, step.id, patch); changed(opts); };

    el('bs-ed-title').addEventListener('input', (e) => { step.title = e.target.value; persistBuildSteps(); renderStepList(); renderChips(); updateCaption(); });
    el('bs-ed-title').addEventListener('change', () => saveStateToHistory());
    el('bs-ed-notes').addEventListener('input', (e) => { step.notes = e.target.value; persistBuildSteps(); updateCaption(); });
    el('bs-ed-notes').addEventListener('change', () => saveStateToHistory());
    el('bs-ed-kind').addEventListener('change', (e) => upd({ kind: e.target.value }, { rerenderEditor: true }));
    el('bs-ed-stage').addEventListener('change', (e) => upd({ stage: e.target.value }));
    el('bs-ed-transition').addEventListener('change', (e) => upd({ transitionMs: e.target.value }, { rerenderList: false }));
    el('bs-ed-duration').addEventListener('change', (e) => upd({ durationMs: e.target.value }, { rerenderList: false }));

    el('bs-ed-chips').addEventListener('click', (e) => {
        const i = e.target && e.target.dataset ? e.target.dataset.i : undefined;
        if (i === undefined) return;
        step.targets.splice(parseInt(i, 10), 1);
        changed({ rerenderEditor: true });
    });
    el('bs-pick-kind').addEventListener('change', renderPickerFields);
    renderPickerFields();
    el('bs-pick-3d').addEventListener('click', () => togglePick(step.id));
    el('bs-pick-3d').classList.toggle('active', ui.pick.active && ui.pick.stepId === step.id);
    el('bs-pick-add').addEventListener('click', () => {
        const sel = selectorFromPicker();
        step.targets.push(sel);
        if (step.title === `${meta.label} step` && step.targets.length === 1) step.title = `${meta.label}: ${selectorLabel(sel)}`;
        changed({ rerenderEditor: true });
    });

    el('bs-ed-capture').addEventListener('click', () => {
        step.view = captureCurrentView(null);
        changed({ rerenderList: false });
        el('bs-ed-viewstatus').textContent = viewStatusText(step);
        showToast('View saved on step', 'success', 1200);
    });
    el('bs-ed-autoframe').addEventListener('click', () => {
        const v = autoFrameStep(step);
        if (!v) { showToast('Add parts to this step first', 'warning'); return; }
        step.view = v;
        showStepView(step);
        changed({ rerenderList: false });
        el('bs-ed-viewstatus').textContent = viewStatusText(step);
    });
    el('bs-ed-goto').addEventListener('click', () => {
        if (playback().active) goToStep(idx, { immediate: true });
        else showStepView(step);
    });
    el('bs-ed-clearview').addEventListener('click', () => {
        step.view = null;
        changed({ rerenderList: false });
        el('bs-ed-viewstatus').textContent = viewStatusText(step);
    });

    // Kind-specific op fields
    const bindOp = (id, key, parse = (v) => v) => {
        const e = el(id);
        if (!e) return;
        e.addEventListener('change', () => {
            const raw = e.type === 'checkbox' ? e.checked : e.value;
            const value = e.type === 'checkbox' ? raw : (raw === '' ? null : parse(raw));
            upd({ op: { [key]: value } }, { rerenderList: false });
        });
    };
    bindOp('bs-op-stock', 'stockLengthIn', parseFloat);
    bindOp('bs-op-kerf', 'kerfIn', parseFloat);
    bindOp('bs-op-bit', 'bitDiameterIn', parseFloat);
    bindOp('bs-op-approach', 'approach');
    bindOp('bs-op-travel', 'travelIn', parseFloat);
    bindOp('bs-op-turns', 'turns', parseFloat);
    bindOp('bs-op-allmodules', 'allModules');
}

// ---------------------------------------------------------------------------
// Transport bar, chips, caption
// ---------------------------------------------------------------------------

function renderChips() {
    const box = el('bs-chips');
    if (!box) return;
    const steps = buildSteps().steps;
    const pb = playback();
    box.innerHTML = steps.map((s, i) => {
        const meta = STEP_KIND_META[s.kind] || STEP_KIND_META.view;
        const cls = 'bs-scene-tab' + (i === pb.stepIndex ? ' active' : '') + (i < pb.stepIndex ? ' done' : '');
        return `<button class="${cls}" data-i="${i}" title="${esc(s.title)}"><span class="bs-scene-icon">${meta.icon}</span>${i + 1}</button>`;
    }).join('');
}

function updateTransport() {
    const pb = playback();
    const steps = buildSteps().steps;
    const bar = el('build-steps-bar');
    if (!bar) return;
    bar.style.display = pb.active ? 'block' : 'none';
    const caption = el('bs-caption');
    if (caption) caption.style.display = pb.active && steps.length ? 'block' : 'none';
    const modeBtn = el('bs-btn-mode');
    if (modeBtn) {
        modeBtn.textContent = pb.active ? '■ Exit Build Mode' : '▶ Build Mode';
        modeBtn.classList.toggle('active', pb.active);
    }
    const play = el('bs-tr-play');
    if (play) play.textContent = pb.playing ? '⏸' : '▶';
    const pos = el('bs-tr-pos');
    if (pos) pos.textContent = steps.length ? `${pb.stepIndex + 1} / ${steps.length}` : '0 / 0';
    const scrub = el('bs-tr-scrub');
    if (scrub && document.activeElement !== scrub) scrub.value = String(Math.round((pb.phase === 'op' || pb.phase === 'hold' ? (pb.phase === 'hold' ? 1 : pb.t) : 0) * 1000));
    const loop = el('bs-tr-loop');
    if (loop) loop.checked = !!pb.loop;
    updateCaption();
}

function updateCaption() {
    const pb = playback();
    const step = buildSteps().steps[pb.stepIndex];
    const t = el('bs-caption-title'), n = el('bs-caption-notes'), i = el('bs-caption-index');
    if (!t || !n || !i) return;
    if (!step) { t.textContent = ''; n.textContent = ''; i.textContent = ''; return; }
    i.textContent = `Step ${pb.stepIndex + 1}`;
    t.textContent = step.title;
    const bench = pb.benchSummary ? `${pb.benchSummary}` : '';
    const text = [bench, step.notes || ''].filter(Boolean).join('\n');
    n.textContent = text;
    n.style.display = text ? 'block' : 'none';
}

function bindTransport() {
    const on = (id, ev, fn) => { const e = el(id); if (e) e.addEventListener(ev, fn); };
    on('bs-tr-first', 'click', () => goToStep(0, { immediate: !playback().playing }));
    on('bs-tr-prev', 'click', () => playbackPrev());
    on('bs-tr-play', 'click', () => togglePlay());
    on('bs-tr-next', 'click', () => playbackNext());
    on('bs-tr-last', 'click', () => goToStep(buildSteps().steps.length - 1, { immediate: !playback().playing }));
    on('bs-tr-exit', 'click', () => exitPlayback());
    on('bs-tr-loop', 'change', (e) => setLoop(e.target.checked));
    on('bs-tr-speed', 'change', (e) => setSpeed(parseFloat(e.target.value)));
    on('bs-tr-scrub', 'input', (e) => { if (playback().playing) playbackPause(); scrubOp(parseInt(e.target.value, 10) / 1000); });
    const chips = el('bs-chips');
    if (chips) {
        chips.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-i]');
            if (!btn) return;
            const i = parseInt(btn.dataset.i, 10);
            goToStep(i, { immediate: !playback().playing });
            const s = buildSteps().steps[i];
            if (s) { ui.selectedId = s.id; renderStepList(); renderEditor(); }
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !playback().active) return;
        if (document.getElementById('hardware-detail-modal')?.classList.contains('visible')) return;
        if (document.getElementById('build-guide-modal')?.classList.contains('visible')) return;
        exitPlayback();
    });
}

function bindToolbar() {
    const on = (id, ev, fn) => { const e = el(id); if (e) e.addEventListener(ev, fn); };
    on('bs-btn-mode', 'click', () => {
        if (playback().active) { exitPlayback(); return; }
        if (!buildSteps().steps.length) { showToast('Add a step first', 'warning'); return; }
        const idx = ui.selectedId ? Math.max(0, stepIndexById(buildSteps(), ui.selectedId)) : 0;
        enterPlayback(idx);
        el('build-steps-group')?.classList.remove('collapsed');
    });
    on('bs-btn-add', 'click', () => {
        const bs = buildSteps();
        const after = ui.selectedId ? stepIndexById(bs, ui.selectedId) : bs.steps.length - 1;
        const step = addStep(bs, createStep('view', { title: `Step ${bs.steps.length + 1}` }), after + 1);
        ui.selectedId = step.id;
        changed({ rerenderEditor: true });
    });
    on('bs-btn-record', 'click', () => {
        if (!buildSteps().steps.length) { showToast('Add a step first', 'warning'); return; }
        if (typeof globalThis.recordBuildStepsVideo === 'function') {
            showToast('Recording… the sequence plays once and the video downloads when it ends.', 'info', 3000);
            globalThis.recordBuildStepsVideo();
        }
    });
    on('bs-btn-auto', 'click', () => {
        const bs = buildSteps();
        if (bs.steps.length && !window.confirm(`Replace the ${bs.steps.length} existing step${bs.steps.length === 1 ? '' : 's'} with a generated sequence?`)) return;
        const steps = autoGenerateSteps();
        if (!steps.length) { showToast('Nothing to generate for this design', 'warning'); return; }
        if (playback().active) exitPlayback();
        bs.steps = steps;
        ui.selectedId = steps[0].id;
        changed({ rerenderEditor: true });
        showToast(`Generated ${steps.length} build steps`, 'success');
    });
}

/**
 * Solves the design deployed with bolts on (so holes and support beams exist)
 * and derives the default sequence from it.
 */
function autoGenerateSteps() {
    // Solve with legacy bolts (Full Detail replaces pivot bolts with placements)
    // to find every hole; then solve again as configured for the real part list.
    const prev = { bolts: state.showBolts, full: state.showHardwareFullDetail, mode: state.hwDetailMode };
    let data;
    let drillBolts;
    try {
        const deployedRad = getStructureDeployedAngle();
        state.showBolts = true;
        state.showHardwareFullDetail = false;
        state.hwDetailMode = false;
        drillBolts = buildLinkageGeometry({ useCache: false, foldAngle: deployedRad, includePanels: false }).bolts || [];
        state.showHardwareFullDetail = prev.full;
        state.hwDetailMode = prev.mode;
        data = buildLinkageGeometry({ useCache: false, foldAngle: deployedRad });
    } finally {
        state.showBolts = prev.bolts;
        state.showHardwareFullDetail = prev.full;
        state.hwDetailMode = prev.mode;
    }
    const intersectionsFor = (beam) => getBeamBoltIntersections(beam, drillBolts);
    const folded = radToDeg(getStructureFoldedAngle());
    const deployed = radToDeg(getStructureDeployedAngle());
    // Module assembly is shown partly opened: fully folded stacks read as a flat bundle
    const assemblyPose = (Number.isFinite(folded) && Number.isFinite(deployed)) ? folded + (deployed - folded) * 0.45 : folded;
    return generateDefaultBuildSteps(data, {
        modules: state.modules,
        useFixedBeams: !!state.useFixedBeams,
        archCapUprights: !!state.archCapUprights,
        foldedAngleDeg: Number.isFinite(assemblyPose) ? assemblyPose : null,
        deployedAngleDeg: Number.isFinite(deployed) ? deployed : null,
        intersectionsFor,
    });
}

// ---------------------------------------------------------------------------
// Pick in 3D
// ---------------------------------------------------------------------------

function setPickActive(active, stepId = null) {
    ui.pick.active = active;
    ui.pick.stepId = active ? stepId : null;
    const vp = el('viewport');
    if (vp) vp.classList.toggle('bs-picking', active);
    const btn = el('bs-pick-3d');
    if (btn) btn.classList.toggle('active', active);
    if (active) showToast('Click a part in the 3D view to add it (Shift = whole group). Esc to stop.', 'info', 2500);
}

function togglePick(stepId) {
    if (ui.pick.active && ui.pick.stepId === stepId) setPickActive(false);
    else setPickActive(true, stepId);
}

/** Walks up from a raycast hit to the object that carries part identity. */
function partObjectFromHit(object) {
    let o = object;
    while (o) {
        const ud = o.userData || {};
        if (ud.beam) return { kind: 'beam', obj: ud.beam };
        if (ud.bolt) return { kind: 'bolt', obj: ud.bolt };
        if (ud.washer) return { kind: 'washer', obj: ud.washer };
        if (ud.bracket) return { kind: 'bracket', obj: ud.bracket };
        if (ud.placement) return { kind: 'placement', obj: ud.placement };
        if (ud.panel) return { kind: 'panel', obj: ud.panel };
        o = o.parent;
    }
    return null;
}

function isHierarchyVisible(object) {
    let o = object;
    while (o) { if (o.visible === false) return false; o = o.parent; }
    return true;
}

function pickAt(clientX, clientY, shift) {
    if (typeof THREE === 'undefined' || !threeRenderer || !threeRenderer.mainCamera) return null;
    const canvas = el('canvas-webgl');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    if (!ui.pick.raycaster) { ui.pick.raycaster = new THREE.Raycaster(); ui.pick.pointer = new THREE.Vector2(); }
    ui.pick.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ui.pick.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    ui.pick.raycaster.setFromCamera(ui.pick.pointer, threeRenderer.mainCamera);
    const roots = [threeRenderer.structureGroup, threeRenderer.panelGroup].filter(Boolean);
    const hits = ui.pick.raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
        if (!isHierarchyVisible(hit.object)) continue;
        const part = partObjectFromHit(hit.object);
        if (!part) continue;
        const sel = shift ? groupSelectorForPart(part.obj, part.kind) : selectorForPart(part.obj, part.kind);
        return sel;
    }
    return null;
}

function bindPick() {
    const canvas = el('canvas-webgl');
    if (!canvas) return;
    canvas.addEventListener('mousedown', (e) => { ui.pick.downX = e.clientX; ui.pick.downY = e.clientY; });
    canvas.addEventListener('mouseup', (e) => {
        if (!ui.pick.active || e.button !== 0) return;
        if (Math.hypot(e.clientX - ui.pick.downX, e.clientY - ui.pick.downY) > 4) return; // it was an orbit drag
        const step = getStepById(buildSteps(), ui.pick.stepId);
        if (!step) { setPickActive(false); return; }
        const sel = pickAt(e.clientX, e.clientY, e.shiftKey);
        if (!sel) { showToast('No part under the cursor', 'warning', 1200); return; }
        const dup = step.targets.some(t => JSON.stringify(t) === JSON.stringify(sel));
        if (dup) { showToast('Already in this step', 'info', 1200); return; }
        step.targets.push(sel);
        showToast(`Added ${selectorLabel(sel)}`, 'success', 1500);
        changed({ rerenderEditor: true });
        // keep picking; the editor re-render resets the button state
        const btn = el('bs-pick-3d');
        if (btn) btn.classList.add('active');
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && ui.pick.active) { setPickActive(false); e.stopPropagation(); }
    }, true);
}

function refreshAll() {
    renderStepList();
    renderEditor();
    renderChips();
    updateTransport();
    const auto = el('bs-btn-auto');
    if (auto) auto.disabled = false;
}

function initBuildStepsUI() {
    if (initBuildStepsUI.done) return;
    initBuildStepsUI.done = true;
    bindToolbar();
    bindTransport();
    bindPick();
    onPlaybackChange((reason) => {
        if (reason === 'frame') { updateTransport(); return; }
        renderChips();
        updateTransport();
        if (reason === 'step' || reason === 'enter' || reason === 'exit') renderStepList();
    });
    // Re-render when a config load replaces the step list
    document.addEventListener('linkage:config-applied', refreshAll);
    refreshAll();
}
initBuildStepsUI.done = false;

const _moduleExports = {
    initBuildStepsUI,
    refreshBuildStepsUI: refreshAll,
    selectBuildStep: selectStep,
    pickBuildTargetAt: pickAt,
    autoGenerateBuildSteps: autoGenerateSteps,
};

bridgeGlobals(_moduleExports, 'buildStepsUi');

export { initBuildStepsUI, refreshAll as refreshBuildStepsUI, selectStep as selectBuildStep };
