// ============================================================================ (ES module)
//
// Build Steps — data model.
//
// A build guide is an ordered list of steps. Each step has a kind (view, place,
// fasten, cut, drill), the parts it acts on (selectors from part-keys.js), an
// optional saved camera view, free-text notes, and timing. The list is stored
// on `state.buildSteps` and travels with the design in the config / project
// file. Playback state lives separately in `state.buildPlayback` and is never
// persisted.
//
// This module is free of THREE and DOM so the model, the visibility map and
// the tween math can be unit tested. Rendering lives in build-steps-anim.js,
// the editor in build-steps-ui.js.

import { bridgeGlobals } from './global-bridge.js';
import { collectParts, matchSelector, partsBounds, selectorLabel } from './part-keys.js';

export const BUILD_STEPS_VERSION = 1;

export const STEP_KINDS = ['view', 'place', 'fasten', 'cut', 'drill'];

/** Per-kind defaults and labels. */
export const STEP_KIND_META = {
    view:   { label: 'View',    icon: '👁',  stage: 'assembly', durationMs: 1500, hint: 'Show the assembly from a saved camera view.' },
    place:  { label: 'Place',   icon: '📦', stage: 'assembly', durationMs: 2000, hint: 'Parts move into their assembled position.' },
    fasten: { label: 'Fasten',  icon: '🔩', stage: 'assembly', durationMs: 2500, hint: 'Bolts (and optional nuts) turn in and seat.' },
    cut:    { label: 'Cut',     icon: '🪚', stage: 'bench',    durationMs: 3000, hint: 'Saw cuts stock to length on the workbench.' },
    drill:  { label: 'Drill',   icon: '🛠', stage: 'bench',    durationMs: 3000, hint: 'Drill bit plunges through each hole position.' },
};

export const DEFAULT_TRANSITION_MS = 800;

/** Default kind-specific operation parameters. */
export function defaultOpForKind(kind) {
    switch (kind) {
        case 'cut':    return { stockLengthIn: null, kerfIn: 0.125 };
        case 'drill':  return { bitDiameterIn: null, holes: 'auto' };
        case 'place':  return { approach: 'above', travelIn: 24 };
        case 'fasten': return { bolt: null, nut: null, turns: 3, allModules: false };
        default:       return {};
    }
}

let _idCounter = 0;
export function makeStepId() {
    _idCounter += 1;
    return `step-${Date.now().toString(36)}-${_idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

/** An empty build guide. */
export function createDefaultBuildSteps() {
    return { version: BUILD_STEPS_VERSION, steps: [] };
}

/** Non-persisted playback state. */
export function createDefaultPlayback() {
    return {
        active: false,      // playback mode engaged (scene shows step staging)
        playing: false,     // animator running
        stepIndex: 0,
        phase: 'idle',      // 'transition' | 'op' | 'hold' | 'idle'
        t: 0,               // 0..1 progress within the current phase
        speed: 1,
        loop: false,
        recording: false,
    };
}

/**
 * Creates a step with defaults for its kind.
 * @param {string} kind
 * @param {Object} [partial]
 */
export function createStep(kind = 'view', partial = {}) {
    const k = STEP_KINDS.includes(kind) ? kind : 'view';
    const meta = STEP_KIND_META[k];
    const step = {
        id: partial.id || makeStepId(),
        kind: k,
        title: partial.title !== undefined ? String(partial.title) : `${meta.label} step`,
        notes: partial.notes !== undefined ? String(partial.notes) : '',
        stage: partial.stage === 'bench' || partial.stage === 'assembly' ? partial.stage : meta.stage,
        targets: Array.isArray(partial.targets) ? partial.targets.map(cloneSelector).filter(Boolean) : [],
        view: partial.view ? normalizeView(partial.view) : null,
        transitionMs: clampMs(partial.transitionMs, DEFAULT_TRANSITION_MS),
        durationMs: clampMs(partial.durationMs, meta.durationMs),
        op: Object.assign(defaultOpForKind(k), partial.op && typeof partial.op === 'object' ? cloneJson(partial.op) : {}),
    };
    return step;
}

function clampMs(v, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.min(60000, Math.round(n));
}

function cloneJson(v) {
    return JSON.parse(JSON.stringify(v));
}

function cloneSelector(sel) {
    if (!sel || typeof sel !== 'object') return null;
    return cloneJson(sel);
}

/**
 * A saved camera view.
 * `anchor` is a part selector whose bounds center becomes the look-at point
 * (null = structure center). `foldAngleDeg` is the pose to show (null = keep).
 */
export function normalizeView(v) {
    if (!v || typeof v !== 'object') return null;
    const n = (x, d) => (Number.isFinite(Number(x)) ? Number(x) : d);
    return {
        yaw: n(v.yaw, 0.4),
        pitch: n(v.pitch, 0.14),
        dist: Math.max(1, n(v.dist, 600)),
        panX: n(v.panX, 0),
        panY: n(v.panY, 0),
        anchor: v.anchor && typeof v.anchor === 'object' ? cloneSelector(v.anchor) : null,
        foldAngleDeg: v.foldAngleDeg === null || v.foldAngleDeg === undefined ? null : n(v.foldAngleDeg, null),
    };
}

/** Validates and fills a step loaded from JSON. Returns null for garbage. */
export function normalizeStep(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return createStep(raw.kind, raw);
}

/**
 * Validates a `buildSteps` object loaded from config / project JSON.
 * Always returns a fresh object; never throws.
 */
export function normalizeBuildSteps(raw) {
    const out = createDefaultBuildSteps();
    if (!raw || typeof raw !== 'object') return out;
    const list = Array.isArray(raw.steps) ? raw.steps : (Array.isArray(raw) ? raw : []);
    const seen = new Set();
    for (const item of list) {
        const step = normalizeStep(item);
        if (!step) continue;
        if (seen.has(step.id)) step.id = makeStepId();
        seen.add(step.id);
        out.steps.push(step);
    }
    return out;
}

/** Deep-clone for config export; returns undefined when there is nothing to save. */
export function serializeBuildStepsForConfig(buildSteps) {
    if (!buildSteps || !Array.isArray(buildSteps.steps) || buildSteps.steps.length === 0) return undefined;
    return cloneJson({ version: BUILD_STEPS_VERSION, steps: buildSteps.steps });
}

// ---------------------------------------------------------------------------
// List operations (mutate the given buildSteps object, return the affected step)
// ---------------------------------------------------------------------------

export function stepIndexById(buildSteps, id) {
    if (!buildSteps || !Array.isArray(buildSteps.steps)) return -1;
    return buildSteps.steps.findIndex(s => s.id === id);
}

export function getStepById(buildSteps, id) {
    const i = stepIndexById(buildSteps, id);
    return i >= 0 ? buildSteps.steps[i] : null;
}

export function addStep(buildSteps, step, index = -1) {
    const s = step && step.id ? step : createStep(step && step.kind, step || {});
    if (index < 0 || index > buildSteps.steps.length) buildSteps.steps.push(s);
    else buildSteps.steps.splice(index, 0, s);
    return s;
}

export function removeStep(buildSteps, id) {
    const i = stepIndexById(buildSteps, id);
    if (i < 0) return null;
    return buildSteps.steps.splice(i, 1)[0];
}

/** Moves the step at fromIndex to toIndex (final position). Returns true if changed. */
export function moveStep(buildSteps, fromIndex, toIndex) {
    const steps = buildSteps.steps;
    if (fromIndex < 0 || fromIndex >= steps.length) return false;
    const to = Math.max(0, Math.min(steps.length - 1, toIndex));
    if (to === fromIndex) return false;
    const [s] = steps.splice(fromIndex, 1);
    steps.splice(to, 0, s);
    return true;
}

export function duplicateStep(buildSteps, id) {
    const i = stepIndexById(buildSteps, id);
    if (i < 0) return null;
    const src = buildSteps.steps[i];
    const copy = createStep(src.kind, Object.assign(cloneJson(src), { id: undefined, title: `${src.title} (copy)` }));
    buildSteps.steps.splice(i + 1, 0, copy);
    return copy;
}

export function updateStep(buildSteps, id, patch) {
    const s = getStepById(buildSteps, id);
    if (!s || !patch) return null;
    const kindChanged = !!patch.kind && patch.kind !== s.kind;
    const base = cloneJson(s);
    if (kindChanged) {
        // Let the new kind supply its own stage, timing and op defaults unless the patch sets them
        if (patch.stage === undefined) delete base.stage;
        if (patch.durationMs === undefined) delete base.durationMs;
        delete base.op;
    }
    const merged = createStep(patch.kind || s.kind, Object.assign(base, cloneJson(patch), { id: s.id }));
    if (patch.op && typeof patch.op === 'object') merged.op = Object.assign(defaultOpForKind(merged.kind), kindChanged ? {} : cloneJson(s.op), cloneJson(patch.op));
    Object.assign(s, merged);
    return s;
}

// ---------------------------------------------------------------------------
// Camera views
// ---------------------------------------------------------------------------

export function easeInOutCubic(t) {
    const x = Math.max(0, Math.min(1, t));
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Shortest signed angular difference b - a in radians. */
export function shortestAngleDelta(a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
}

/**
 * Builds a view from the live camera.
 * @param {{yaw,pitch,dist,panX,panY}} cam
 * @param {number|null} foldAngleRad
 * @param {Object|null} anchor - part selector or null
 */
export function captureView(cam, foldAngleRad = null, anchor = null) {
    return normalizeView({
        yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, panX: cam.panX, panY: cam.panY,
        anchor,
        foldAngleDeg: foldAngleRad === null || foldAngleRad === undefined ? null : (foldAngleRad * 180) / Math.PI,
    });
}

/**
 * Interpolates the numeric fields of two views. Yaw takes the shortest arc.
 * Anchors are not interpolated here; the animator lerps resolved points.
 */
export function tweenView(a, b, t) {
    const e = easeInOutCubic(t);
    const va = a || b;
    const vb = b || a;
    if (!va) return null;
    const lerp = (x, y) => x + (y - x) * e;
    const foldA = va.foldAngleDeg, foldB = vb.foldAngleDeg;
    return {
        yaw: va.yaw + shortestAngleDelta(va.yaw, vb.yaw) * e,
        pitch: lerp(va.pitch, vb.pitch),
        dist: lerp(va.dist, vb.dist),
        panX: lerp(va.panX, vb.panX),
        panY: lerp(va.panY, vb.panY),
        anchor: vb.anchor || null,
        foldAngleDeg: foldA === null || foldA === undefined ? foldB : (foldB === null || foldB === undefined ? foldA : lerp(foldA, foldB)),
    };
}

/**
 * Derives a view that frames the given bounds.
 * @param {{center:{x,y,z}, radius:number}} bounds - from partsBounds
 * @param {Object} opts - { fovDeg, aspect, yaw, pitch, padding, anchor, foldAngleDeg }
 */
export function autoFrameView(bounds, opts = {}) {
    const fov = ((opts.fovDeg || 45) * Math.PI) / 180;
    const aspect = opts.aspect || 1.5;
    const padding = opts.padding || 1.35;
    const radius = bounds && bounds.radius ? bounds.radius : 100;
    // Fit the bounding sphere in the smaller of the vertical/horizontal FOV.
    const vFit = radius / Math.sin(fov / 2);
    const hFov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
    const hFit = radius / Math.sin(hFov / 2);
    const dist = Math.max(vFit, hFit) * padding;
    return normalizeView({
        yaw: opts.yaw !== undefined ? opts.yaw : 0.6,
        pitch: opts.pitch !== undefined ? opts.pitch : 0.35,
        dist: Math.max(12, dist),
        panX: 0,
        panY: 0,
        anchor: opts.anchor || null,
        foldAngleDeg: opts.foldAngleDeg === undefined ? null : opts.foldAngleDeg,
    });
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/** Step kinds that introduce their targets into the assembly. */
const INTRODUCING_KINDS = new Set(['place', 'fasten']);

/**
 * Computes which parts are visible at a given step in assembly staging.
 *
 * Parts introduced by a `place`/`fasten` step at or before `index` are 'done'
 * (or 'active' for the current step). Parts introduced later are 'future'.
 * Parts no step ever introduces are 'unreferenced' and are shown normally, so
 * a guide with only view steps still shows the whole structure.
 *
 * @param {Array} steps
 * @param {number} index - current step index
 * @param {Array} parts - collectParts(data)
 * @returns {{status: Map<string,string>, introducedAny: boolean}}
 */
export function computeStepVisibility(steps, index, parts) {
    const status = new Map();
    const introduced = new Set();
    let introducedAny = false;
    const list = Array.isArray(steps) ? steps : [];
    const idx = Math.max(0, Math.min(list.length - 1, index));

    // First pass: which parts does each step introduce (first introduction wins)
    const firstIntro = new Map(); // key -> step index
    list.forEach((step, si) => {
        if (!INTRODUCING_KINDS.has(step.kind) || !step.targets || !step.targets.length) return;
        for (const rec of parts) {
            if (firstIntro.has(rec.key)) continue;
            if (step.targets.some(sel => matchSelector(rec.obj, sel, rec.kind))) {
                firstIntro.set(rec.key, si);
                introducedAny = true;
            }
        }
    });

    // Current step targets (any kind) are highlighted
    const current = list[idx];
    const activeKeys = new Set();
    if (current && current.targets && current.targets.length) {
        for (const rec of parts) {
            if (current.targets.some(sel => matchSelector(rec.obj, sel, rec.kind))) activeKeys.add(rec.key);
        }
    }

    for (const rec of parts) {
        const intro = firstIntro.get(rec.key);
        let s;
        if (intro === undefined) s = 'unreferenced';
        else if (intro > idx) s = 'future';
        else s = 'done';
        if (activeKeys.has(rec.key) && s !== 'future') s = 'active';
        if (activeKeys.has(rec.key) && s === 'future') s = 'active';
        status.set(rec.key, s);
        if (intro !== undefined) introduced.add(rec.key);
    }
    return { status, introducedAny, activeKeys };
}

/** Convenience: bounds of a step's targets in the given geometry. */
export function stepTargetBounds(step, data, parts = null) {
    if (!step || !step.targets || !step.targets.length) return null;
    const all = parts || collectParts(data);
    const items = all.filter(rec => step.targets.some(sel => matchSelector(rec.obj, sel, rec.kind)));
    return partsBounds(items);
}

/** One-line summary for the step list. */
export function stepSummary(step) {
    if (!step) return '';
    const meta = STEP_KIND_META[step.kind] || STEP_KIND_META.view;
    const targets = (step.targets || []).map(selectorLabel).filter(Boolean);
    const t = targets.length ? targets.slice(0, 2).join('; ') + (targets.length > 2 ? ` +${targets.length - 2}` : '') : '';
    return t ? `${meta.label}: ${t}` : meta.label;
}

/** Total play time of a sequence in ms. */
export function totalDurationMs(buildSteps) {
    return (buildSteps && buildSteps.steps ? buildSteps.steps : []).reduce((n, s) => n + (s.transitionMs || 0) + (s.durationMs || 0), 0);
}

const _moduleExports = {
    BUILD_STEPS_VERSION,
    STEP_KINDS,
    STEP_KIND_META,
    DEFAULT_TRANSITION_MS,
    defaultOpForKind,
    makeStepId,
    createDefaultBuildSteps,
    createDefaultPlayback,
    createStep,
    normalizeView,
    normalizeStep,
    normalizeBuildSteps,
    serializeBuildStepsForConfig,
    stepIndexById,
    getStepById,
    addStep,
    removeStep,
    moveStep,
    duplicateStep,
    updateStep,
    easeInOutCubic,
    shortestAngleDelta,
    captureView,
    tweenView,
    autoFrameView,
    computeStepVisibility,
    stepTargetBounds,
    stepSummary,
    totalDurationMs,
};

bridgeGlobals(_moduleExports, 'buildSteps');
