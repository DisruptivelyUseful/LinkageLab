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
import { collectParts, matchSelector, partKey, partsBounds, resolveTargets, selectorForPart, selectorLabel } from './part-keys.js';

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
        case 'place':  return { approach: 'above', travelIn: 24, parkOffset: null, from: null, sequential: false };
        case 'fasten': return { bolt: null, nut: null, turns: 3, allModules: false, axes: null };
        default:       return {};
    }
}

let _idCounter = 0;
export function makeStepId() {
    _idCounter += 1;
    return `step-${Date.now().toString(36)}-${_idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

export const REPEAT_MODES = ['skip', 'fast'];

/** Playback settings saved with the design. */
export function defaultSettings() {
    return { repeatMode: 'skip', fastFactor: 4 };
}

export function normalizeSettings(raw) {
    const d = defaultSettings();
    if (!raw || typeof raw !== 'object') return d;
    if (REPEAT_MODES.includes(raw.repeatMode)) d.repeatMode = raw.repeatMode;
    const f = Number(raw.fastFactor);
    if (Number.isFinite(f) && f >= 1 && f <= 20) d.fastFactor = f;
    return d;
}

/** An empty build guide. */
export function createDefaultBuildSteps() {
    return { version: BUILD_STEPS_VERSION, steps: [], settings: defaultSettings() };
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
        // Contiguous steps sharing a groupId are one repeated operation (e.g. "×8 modules")
        groupId: partial.groupId ? String(partial.groupId) : null,
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
    out.settings = normalizeSettings(raw.settings);
    normalizeGroups(out.steps);
    return out;
}

/** Deep-clone for config export; returns undefined when there is nothing to save. */
export function serializeBuildStepsForConfig(buildSteps) {
    if (!buildSteps || !Array.isArray(buildSteps.steps) || buildSteps.steps.length === 0) return undefined;
    return cloneJson({ version: BUILD_STEPS_VERSION, steps: buildSteps.steps, settings: normalizeSettings(buildSteps.settings) });
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
    const removed = buildSteps.steps.splice(i, 1)[0];
    normalizeGroups(buildSteps.steps);
    return removed;
}

/** Moves the step at fromIndex to toIndex (final position). Returns true if changed. */
export function moveStep(buildSteps, fromIndex, toIndex) {
    const steps = buildSteps.steps;
    if (fromIndex < 0 || fromIndex >= steps.length) return false;
    const to = Math.max(0, Math.min(steps.length - 1, toIndex));
    if (to === fromIndex) return false;
    const [s] = steps.splice(fromIndex, 1);
    steps.splice(to, 0, s);
    normalizeGroups(steps);
    return true;
}

// ---------------------------------------------------------------------------
// Groups: a run of contiguous steps with the same groupId is one repeated
// operation. The first member is the representative shown in "skip" mode.
// ---------------------------------------------------------------------------

let _groupCounter = 0;
export function makeGroupId() {
    _groupCounter += 1;
    return `grp-${Date.now().toString(36)}-${_groupCounter}-${Math.random().toString(36).slice(2, 5)}`;
}

/**
 * Clears groupId on any member that is not contiguous with its group's first
 * run, and on singleton groups. Mutates and returns the array.
 */
export function normalizeGroups(steps) {
    if (!Array.isArray(steps)) return steps;
    // Collect contiguous runs per groupId; keep the first run with 2+ members, clear the rest
    const runs = [];
    let i = 0;
    while (i < steps.length) {
        const gid = steps[i].groupId || null;
        let j = i;
        while (j < steps.length && (steps[j].groupId || null) === gid) j += 1;
        if (gid) runs.push({ gid, start: i, end: j });
        i = j;
    }
    const kept = new Map();
    for (const run of runs) {
        if (run.end - run.start >= 2 && !kept.has(run.gid)) kept.set(run.gid, run);
    }
    for (const run of runs) {
        if (kept.get(run.gid) !== run) for (let k = run.start; k < run.end; k++) steps[k].groupId = null;
    }
    return steps;
}

/**
 * Group membership of the step at `index`.
 * @returns {{groupId:string|null, members:number[], position:number, count:number, isFirst:boolean, isLast:boolean, first:number, last:number}}
 */
export function groupOf(steps, index) {
    const list = Array.isArray(steps) ? steps : [];
    const step = list[index];
    if (!step || !step.groupId) return { groupId: null, members: [index], position: 0, count: 1, isFirst: true, isLast: true, first: index, last: index };
    let first = index, last = index;
    while (first > 0 && list[first - 1].groupId === step.groupId) first -= 1;
    while (last < list.length - 1 && list[last + 1].groupId === step.groupId) last += 1;
    const members = [];
    for (let k = first; k <= last; k++) members.push(k);
    return { groupId: step.groupId, members, position: index - first, count: members.length, isFirst: index === first, isLast: index === last, first, last };
}

/**
 * Groups the given step ids. They must form a contiguous run (in any order of
 * selection). Returns the new groupId or null when the selection is not
 * contiguous or has fewer than two steps.
 */
export function groupSteps(buildSteps, ids) {
    const idx = [...new Set(ids || [])].map(id => stepIndexById(buildSteps, id)).filter(i => i >= 0).sort((a, b) => a - b);
    if (idx.length < 2) return null;
    for (let k = 1; k < idx.length; k++) if (idx[k] !== idx[k - 1] + 1) return null;
    // Merge with an existing group only when the selection covers it entirely
    const gid = makeGroupId();
    idx.forEach(i => { buildSteps.steps[i].groupId = gid; });
    normalizeGroups(buildSteps.steps);
    return gid;
}

/** Removes the given steps (and their whole groups) from any group. */
export function ungroupSteps(buildSteps, ids) {
    const gids = new Set();
    (ids || []).forEach(id => { const s = getStepById(buildSteps, id); if (s && s.groupId) gids.add(s.groupId); });
    buildSteps.steps.forEach(s => { if (gids.has(s.groupId)) s.groupId = null; });
    return gids.size;
}

/**
 * Index to play after `index` finishes. In 'skip' mode a group's first member
 * jumps past the whole group; other members (reached manually) advance normally.
 * Returns -1 at the end of the sequence.
 */
export function nextIndexAfter(steps, index, repeatMode = 'skip') {
    const list = Array.isArray(steps) ? steps : [];
    if (index >= list.length - 1) return -1;
    const g = groupOf(list, index);
    if (repeatMode === 'skip' && g.count > 1 && g.isFirst) {
        return g.last >= list.length - 1 ? -1 : g.last + 1;
    }
    return index + 1;
}

/** Steps shown in collapsed listings (guide, PDF, chips in skip mode): group representatives + ungrouped steps. */
export function representativeSteps(steps) {
    const list = Array.isArray(steps) ? steps : [];
    const out = [];
    list.forEach((s, i) => {
        const g = groupOf(list, i);
        if (g.isFirst) out.push({ step: s, index: i, count: g.count, members: g.members });
    });
    return out;
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

    // Parking: a place step with op.parkOffset leaves its parts displaced (e.g. the
    // top ring built on the ground beside the bottom ring) until a later place
    // step targets them again (op.from === 'parked' lifts them into place).
    const displacementBefore = computeDisplacement(list, idx - 1, parts);
    const displacement = computeDisplacement(list, idx, parts);
    return { status, introducedAny, activeKeys, displacement, displacementBefore };
}

/** Map key -> parkOffset in effect after step `upto` (inclusive). */
export function computeDisplacement(steps, upto, parts) {
    const out = new Map();
    const list = Array.isArray(steps) ? steps : [];
    for (let si = 0; si <= Math.min(upto, list.length - 1); si++) {
        const step = list[si];
        if (!step || step.kind !== 'place' || !step.targets || !step.targets.length) continue;
        const park = step.op && step.op.parkOffset ? step.op.parkOffset : null;
        for (const rec of parts) {
            if (!step.targets.some(sel => matchSelector(rec.obj, sel, rec.kind))) continue;
            if (park) out.set(rec.key, park); else out.delete(rec.key);
        }
    }
    return out;
}

/**
 * Turns a parkOffset spec into a structure-local vector.
 * Specs: `{x,y,z}` literal, or `{ mode:'beside', gapIn }` = beyond the structure's
 * +X extent, lowered so the parts rest at the structure's ground level.
 * @param {Object} spec
 * @param {{min:{x,y,z}, max:{x,y,z}}} structureBounds - bounds of the whole structure
 * @param {{min:{x,y,z}, max:{x,y,z}}} partsBounds - seated bounds of the parked parts
 */
export function resolveParkOffset(spec, structureBounds, partsBounds) {
    if (!spec) return { x: 0, y: 0, z: 0 };
    if (spec.mode === 'beside') {
        const gap = Number.isFinite(Number(spec.gapIn)) ? Number(spec.gapIn) : 24;
        const sb = structureBounds, pb = partsBounds;
        if (!sb || !pb) return { x: 0, y: 0, z: 0 };
        const width = pb.max.x - pb.min.x;
        return {
            x: (sb.max.x - pb.min.x) + gap,                 // parts' left edge lands past the structure's right edge
            y: sb.min.y - pb.min.y,                          // rest on the ground
            z: ((sb.min.z + sb.max.z) / 2) - ((pb.min.z + pb.max.z) / 2),
            _width: width,
        };
    }
    return { x: Number(spec.x) || 0, y: Number(spec.y) || 0, z: Number(spec.z) || 0 };
}

/** Convenience: bounds of a step's targets in the given geometry. */
export function stepTargetBounds(step, data, parts = null) {
    if (!step || !step.targets || !step.targets.length) return null;
    const all = parts || collectParts(data);
    const items = all.filter(rec => step.targets.some(sel => matchSelector(rec.obj, sel, rec.kind)));
    return partsBounds(items);
}

// ---------------------------------------------------------------------------
// Workbench planning (cut / drill steps)
// ---------------------------------------------------------------------------

/** Common lumber stock lengths in inches (8, 10, 12, 16 ft). */
export const STOCK_LENGTHS_IN = [96, 120, 144, 192];

export function roundTo(v, step = 1 / 16) {
    return Math.round(v / step) * step;
}

export function beamLengthIn(beam) {
    if (!beam || !beam.p1 || !beam.p2) return 0;
    const dx = beam.p2.x - beam.p1.x, dy = beam.p2.y - beam.p1.y, dz = beam.p2.z - beam.p1.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** True when a beam must be cut from its stock (stock longer than the beam by more than 1/16 in). */
export function needsCut(beamLengthIn, stockLengthIn) {
    return stockLengthIn > beamLengthIn + 1 / 16;
}

/** Smallest standard stock length that fits, or the next foot up for long beams. */
export function stockLengthFor(lengthIn, explicit = null) {
    if (explicit && Number.isFinite(Number(explicit)) && Number(explicit) > 0) return Number(explicit);
    const fit = STOCK_LENGTHS_IN.find(s => s >= lengthIn - 1e-6);
    if (fit) return fit;
    return Math.ceil(lengthIn / 12) * 12;
}

/**
 * Groups beams that are physically identical (rounded length x width x thickness).
 * @returns {Array<{key:string, length:number, w:number, t:number, count:number, beams:Array, rep:Object, stackTypes:string[]}>}
 */
export function groupBeamsForBench(beams) {
    const groups = new Map();
    for (const beam of beams || []) {
        if (!beam) continue;
        const length = roundTo(beamLengthIn(beam));
        const w = roundTo(beam.w || 0), t = roundTo(beam.t || 0);
        const key = `${length.toFixed(4)}x${w.toFixed(4)}x${t.toFixed(4)}`;
        let g = groups.get(key);
        if (!g) { g = { key, length, w, t, count: 0, beams: [], rep: beam, stackTypes: [] }; groups.set(key, g); }
        g.count += 1;
        g.beams.push(beam);
        if (beam.stackType && !g.stackTypes.includes(beam.stackType)) g.stackTypes.push(beam.stackType);
    }
    return [...groups.values()].sort((a, b) => b.length - a.length || b.w - a.w || b.t - a.t);
}

/**
 * Lays bench groups out side by side along +X (one row per group, rows spaced in Z).
 * Beams rest on the plane y = 0.
 * @param {Array} groups - from groupBeamsForBench
 * @param {{stock?: boolean, stockLengthIn?: number|null, gapIn?: number}} opts - stock: show raw stock length (cut steps)
 * @returns {{items:Array, bounds:Object|null, plane:{x:number,z:number,length:number,width:number}|null}}
 */
export function planBench(groups, opts = {}) {
    const items = [];
    const gap = opts.gapIn !== undefined ? opts.gapIn : 6;
    let z = 0;
    let maxLen = 0;
    for (const g of groups || []) {
        const beamLen = g.length;
        const stockLen = opts.stock ? stockLengthFor(beamLen, opts.stockLengthIn) : beamLen;
        const w = g.w || 1.5, t = g.t || 1.5;
        // Beams lie flat: width across Z, thickness up Y
        const item = {
            group: g,
            x0: 0,
            y: t / 2,
            z: z + w / 2,
            w, t,
            beamLength: beamLen,
            stockLength: Math.max(stockLen, beamLen),
            cutAt: beamLen,
            offcut: Math.max(0, stockLen - beamLen),
        };
        items.push(item);
        z += w + gap;
        maxLen = Math.max(maxLen, item.stockLength);
    }
    if (!items.length) return { items, bounds: null, plane: null };
    const depth = z - gap;
    const margin = 8;
    const bounds = {
        min: { x: -margin, y: 0, z: -margin },
        max: { x: maxLen + margin, y: Math.max(...items.map(i => i.t)) + margin, z: depth + margin },
    };
    bounds.center = { x: (bounds.min.x + bounds.max.x) / 2, y: 0, z: (bounds.min.z + bounds.max.z) / 2 };
    const dx = bounds.max.x - bounds.min.x, dz = bounds.max.z - bounds.min.z;
    bounds.radius = Math.max(4, Math.sqrt(dx * dx + dz * dz) / 2);
    return { items, bounds, plane: { x: maxLen / 2, z: depth / 2, length: maxLen + 2 * margin, width: depth + 2 * margin } };
}

/** Human readable bench summary, e.g. "3 × Top H-beam · 96.0 in". */
export function benchSummary(groups, opts = {}) {
    return (groups || []).map(g => {
        const stock = opts.stock ? ` from ${stockLengthFor(g.length, opts.stockLengthIn).toFixed(0)} in stock` : '';
        return `${g.count} × ${g.stackTypes.map(stackTypeLabel).join('/') || 'beam'} · ${g.length.toFixed(1)} in${stock}`;
    }).join('\n');
}

const STACK_TYPE_SHORT = {
    'horizontal-bottom': 'bottom H-beam', 'horizontal-top': 'top H-beam', 'vertical': 'V-beam', 'vertical-cap': 'cap V-beam',
    'fixed-beam': 'fixed beam', 'fixed-beam-cap': 'cap fixed beam', 'support-beam': 'radial support beam', 'support-beam-reciprocal': 'reciprocal beam',
};
export function stackTypeLabel(stackType) {
    return STACK_TYPE_SHORT[stackType] || stackType || 'beam';
}

// ---------------------------------------------------------------------------
// Auto-generation of a default build sequence
// ---------------------------------------------------------------------------

function fmtIn(v) {
    return `${(Math.round(v * 16) / 16).toFixed(2).replace(/\.?0+$/, '')} in`;
}

/**
 * Finds the coarsest selectors that match exactly the given beams (by key),
 * falling back to exact per-beam selectors.
 */
function selectorsForBeamSet(beams, data, parts) {
    const wanted = new Set(beams.map(b => partKey(b, 'beam')));
    const covered = new Set();
    const out = [];
    const tryAdd = (sel) => {
        const res = resolveTargets(data, [sel], parts);
        if (!res.items.length) return false;
        if (!res.items.every(r => wanted.has(r.key))) return false;
        if (res.items.every(r => covered.has(r.key))) return false;
        res.items.forEach(r => covered.add(r.key));
        out.push(sel);
        return true;
    };
    const stackTypes = [...new Set(beams.map(b => b.stackType))];
    for (const st of stackTypes) {
        if (tryAdd({ kind: 'beam', stackType: st })) continue;
        const layers = [...new Set(beams.filter(b => b.stackType === st).map(b => b.layerIndex || 0))].sort((a, b) => a - b);
        for (const L of layers) {
            if (tryAdd({ kind: 'beam', stackType: st, layerIndex: L })) continue;
            const pats = [...new Set(beams.filter(b => b.stackType === st && (b.layerIndex || 0) === L).map(b => b.patternId || null))];
            for (const pat of pats) {
                if (pat && tryAdd({ kind: 'beam', stackType: st, layerIndex: L, patternId: pat })) continue;
                beams.filter(b => b.stackType === st && (b.layerIndex || 0) === L && (b.patternId || null) === pat)
                    .forEach(b => { if (!covered.has(partKey(b, 'beam'))) { covered.add(partKey(b, 'beam')); out.push(selectorForPart(b, 'beam')); } });
            }
        }
    }
    return out;
}

/**
 * Merges hole entries that land on the same spot (two bolts sharing one pivot,
 * e.g. the outer bolt of one module and the inner bolt of the next), keeping
 * the largest radius. Tolerance 1/16 in.
 */
export function dedupeHoles(holes, tol = 1 / 16) {
    const out = [];
    for (const h of holes || []) {
        if (!h) continue;
        const cross = h.through === 'W' ? h.posT : h.posW;
        const same = out.find(o => o.through === h.through && Math.abs(o.posL - h.posL) <= tol && Math.abs((o.through === 'W' ? o.posT : o.posW) - cross) <= tol);
        if (same) { if (h.radius > same.radius) same.radius = h.radius; continue; }
        out.push({ ...h });
    }
    return out;
}

function holeSignature(holes) {
    return holes
        .map(h => `${h.through}:${roundTo(h.posL).toFixed(4)}:${roundTo(h.through === 'W' ? h.posT : h.posW).toFixed(4)}:${roundTo(h.radius, 1 / 64).toFixed(4)}`)
        .sort()
        .join('|');
}

/**
 * Generates a complete default fabrication + assembly sequence.
 *
 * @param {Object} data - geometry solved with bolts on, at the deployed angle
 * @param {Object} opts
 * @param {number} opts.modules
 * @param {boolean} [opts.useFixedBeams]
 * @param {boolean} [opts.archCapUprights]
 * @param {number|null} [opts.foldedAngleDeg] - pose for module assembly steps
 * @param {number|null} [opts.deployedAngleDeg] - pose for the deploy step
 * @param {(beam:Object, bolts:Array) => Array} [opts.intersectionsFor] - hole finder (getBeamBoltIntersections)
 * @param {number} [opts.stockLengthIn] - forced stock length
 * @returns {Array} steps
 */
export function generateDefaultBuildSteps(data, opts = {}) {
    const steps = [];
    const parts = collectParts(data);
    const beams = (data && data.beams) || [];
    const bolts = (data && data.bolts) || [];
    const modules = Math.max(1, opts.modules || 1);
    const folded = opts.foldedAngleDeg === undefined ? null : opts.foldedAngleDeg;
    const deployed = opts.deployedAngleDeg === undefined ? null : opts.deployedAngleDeg;
    const has = (sel) => resolveTargets(data, [sel], parts).items.length > 0;
    const mk = (kind, partial) => steps.push(createStep(kind, partial));

    // 1. Cut: one step per identical beam group
    const groups = groupBeamsForBench(beams);
    for (const g of groups) {
        const stock = stockLengthFor(g.length, opts.stockLengthIn);
        if (!needsCut(g.length, stock)) continue; // e.g. 96 in beams from 96 in stock
        const labels = g.stackTypes.map(stackTypeLabel).join(' / ');
        mk('cut', {
            title: `Cut ${g.count} × ${labels} to ${fmtIn(g.length)}`,
            notes: `${g.count} pieces of ${fmtIn(g.w)} × ${fmtIn(g.t)} stock, ${fmtIn(g.length)} long${stock > g.length + 1e-6 ? ` (from ${fmtIn(stock)} stock, ${fmtIn(stock - g.length)} offcut)` : ''}.`,
            targets: selectorsForBeamSet(g.beams, data, parts),
            op: { stockLengthIn: opts.stockLengthIn || null, kerfIn: 0.125 },
        });
    }

    // 2. Drill: one step per distinct hole pattern
    if (typeof opts.intersectionsFor === 'function' && bolts.length) {
        const patterns = new Map();
        for (const beam of beams) {
            const holes = dedupeHoles(opts.intersectionsFor(beam, bolts) || []);
            if (!holes.length) continue;
            const len = roundTo(beamLengthIn(beam));
            const sig = `${len.toFixed(4)}x${roundTo(beam.w || 0).toFixed(4)}x${roundTo(beam.t || 0).toFixed(4)}#${holeSignature(holes)}`;
            let p = patterns.get(sig);
            if (!p) { p = { beams: [], holes, len, rep: beam }; patterns.set(sig, p); }
            p.beams.push(beam);
        }
        const list = [...patterns.values()].sort((a, b) => b.beams.length - a.beams.length || b.len - a.len);
        for (const p of list) {
            const stackTypes = [...new Set(p.beams.map(b => b.stackType))].map(stackTypeLabel).join(' / ');
            const positions = p.holes.map(h => h.posL + p.len / 2).sort((a, b) => a - b);
            const dia = p.holes.length ? Math.max(...p.holes.map(h => h.radius * 2)) : 0;
            const through = [...new Set(p.holes.map(h => (h.through === 'W' ? 'width' : 'thickness')))].join(' and ');
            mk('drill', {
                title: `Drill ${p.beams.length} × ${stackTypes} (${p.holes.length} hole${p.holes.length === 1 ? '' : 's'})`,
                notes: `Holes from the left end: ${positions.map(fmtIn).join(', ')}. Ø ${fmtIn(dia)} through the ${through}.`,
                targets: selectorsForBeamSet(p.beams, data, parts),
                op: { bitDiameterIn: dia || null, holes: 'auto' },
            });
        }
    }

    // 3. Assembly in shop order, operation-major so repeated module steps form groups:
    //    bottom ring (+ brackets) -> top ring built beside it as a mirror -> V modules
    //    -> attach V modules to the bottom ring -> lift the top ring on -> secure top brackets.
    const view = (fold) => (fold === null || fold === undefined ? null : { yaw: 0.6, pitch: 0.35, dist: 600, anchor: null, foldAngleDeg: fold });
    const hasPlacements = has({ kind: 'placement' });
    const eachModule = (groupKey, fn) => {
        const gid = `auto-${groupKey}`;
        let emitted = 0;
        for (let i = 0; i < modules; i++) {
            const spec = fn(i, `Module ${i + 1}`);
            if (!spec) continue;
            const targets = spec.targets.filter(has);
            if (!targets.length) continue;
            const { kind, title, notes, ...extra } = spec;
            mk(kind, { title, notes, targets, view: null, groupId: gid, ...extra });
            emitted += 1;
        }
        return emitted;
    };
    const parked = { mode: 'beside', gapIn: 24 };

    // Bottom assembly
    eachModule('bottom-hbeams', (i, m) => ({ kind: 'place', title: `${m}: set bottom H-beams`, notes: 'Stack the bottom horizontal beams with their washers between layers.',
        targets: [{ kind: 'beam', stackType: 'horizontal-bottom', moduleIndex: i }], op: { approach: 'above', travelIn: 24 } }));
    eachModule('bottom-brackets', (i, m) => ({ kind: 'place', title: `${m}: fit the bottom brackets`, notes: 'Seat the U-brackets on the bottom stack with the hole aligned to the pivot.',
        targets: [{ kind: 'bracket', moduleIndex: i, ring: 'bottom' }, { kind: 'placement', moduleIndex: i, ring: 'bottom' }], op: { approach: 'above', travelIn: 12 } }));
    eachModule('bottom-bracket-bolts', (i, m) => ({ kind: 'fasten', title: `${m}: bolt the bottom ring pivots and brackets`, notes: 'Bolt the H-beam centre pivot, then bolt each bracket down through the bottom H-beam stack.',
        targets: [{ kind: 'bolt', boltType: 'hstack', moduleIndex: i, ring: 'bottom' }, { kind: 'bolt', boltType: 'hpivot', moduleIndex: i, ring: 'bottom' }, { kind: 'placement', moduleIndex: i, ring: 'bottom' }], op: hasPlacements ? { axes: ['down', 'up'] } : {} }));

    // Top assembly, built on the ground beside the bottom ring as a mirror of it
    eachModule('top-hbeams', (i, m) => ({ kind: 'place', title: `${m}: set top H-beams (mirror of the bottom ring)`, notes: 'Build the top ring beside the bottom ring, mirrored, with brackets facing down.',
        targets: [{ kind: 'beam', stackType: 'horizontal-top', moduleIndex: i }], op: { approach: 'above', travelIn: 24, parkOffset: parked } }));
    eachModule('top-brackets', (i, m) => ({ kind: 'place', title: `${m}: fit the top brackets`, notes: 'Seat the top U-brackets on the top stack, opening downward.',
        targets: [{ kind: 'bracket', moduleIndex: i, ring: 'top' }, { kind: 'placement', moduleIndex: i, ring: 'top' }], op: { approach: 'above', travelIn: 12, parkOffset: parked } }));
    eachModule('top-bracket-bolts', (i, m) => ({ kind: 'fasten', title: `${m}: bolt the top ring pivots and brackets`, notes: 'Bolt the top H-beam centre pivot, then bolt each top bracket through the top H-beam stack.',
        targets: [{ kind: 'bolt', boltType: 'hstack', moduleIndex: i, ring: 'top' }, { kind: 'bolt', boltType: 'hpivot', moduleIndex: i, ring: 'top' }, { kind: 'placement', moduleIndex: i, ring: 'top' }], op: hasPlacements ? { axes: ['down', 'up'] } : {} }));

    // V modules
    const uprightSel = (i) => (opts.useFixedBeams
        ? [{ kind: 'beam', stackType: 'fixed-beam', moduleIndex: i }, { kind: 'beam', stackType: 'fixed-beam-cap', moduleIndex: i }]
        : [{ kind: 'beam', stackType: 'vertical', moduleIndex: i }, { kind: 'beam', stackType: 'vertical-cap', moduleIndex: i }]);
    eachModule('v-modules', (i, m) => ({ kind: 'place', title: `${m}: assemble the V module`, notes: opts.useFixedBeams ? 'Stand the fixed uprights.' : 'Cross the V-beams in their A/B pattern and align the pivot holes.',
        targets: uprightSel(i), op: { approach: 'radial', travelIn: 30 } }));
    eachModule('v-center-bolts', (i, m) => ({ kind: 'fasten', title: `${m}: bolt the V module centre pivot`, notes: 'Insert the centre pivot bolt through the crossing; snug, not torqued.',
        targets: [{ kind: 'joint', moduleIndex: i, ring: 'center' }] }));

    // Attach V modules to the bottom ring
    eachModule('attach-bottom', (i, m) => ({ kind: 'fasten', title: `${m}: attach the V module to the bottom ring`, notes: 'Slide the V-beam ends into the bottom brackets and insert the pivot bolts.',
        targets: [{ kind: 'bolt', boltType: 'vstack', moduleIndex: i, ring: 'bottom' }, { kind: 'placement', moduleIndex: i, ring: 'bottom' }], op: hasPlacements ? { axes: ['right', 'left'] } : {} }));

    // Lift the top assembly onto the V modules
    const liftTargets = [{ kind: 'beam', stackType: 'horizontal-top' }, { kind: 'bracket', ring: 'top' }, { kind: 'placement', ring: 'top' }].filter(has);
    if (liftTargets.length) {
        mk('place', { title: 'Lift the top assembly onto the V modules', notes: 'With helpers on each side, lift the assembled top ring and lower the brackets onto the V-beam ends.',
            targets: liftTargets, view: null, op: { approach: 'above', travelIn: 24, from: 'parked' }, durationMs: 3500 });
    }

    // Secure the top brackets to the V modules
    eachModule('secure-top', (i, m) => ({ kind: 'fasten', title: `${m}: secure the top bracket to the V module`, notes: 'Insert the top pivot bolts and torque every pivot on this module.',
        targets: [{ kind: 'bolt', boltType: 'vstack', moduleIndex: i, ring: 'top' }, { kind: 'placement', moduleIndex: i, ring: 'top' }], op: hasPlacements ? { axes: ['right', 'left'] } : {} }));

    // Module steps share the assembly pose
    steps.forEach(s => { if (s.stage === 'assembly' && !s.view) s.view = view(folded); });

    // 4. Deploy, then support beams, reciprocal bolts, panels (deployed pose)
    const support = has({ kind: 'beam', stackType: 'support-beam' });
    const rcp = has({ kind: 'beam', stackType: 'support-beam-reciprocal' });
    const rcpBolts = has({ kind: 'bolt', boltType: ['rcp-ring', 'rcp-cross'] });
    const panels = has({ kind: 'panel' });
    if (deployed !== null || support || rcp || panels) {
        mk('view', { title: 'Deploy the structure', notes: 'Open the scissor ring to its deployed angle before adding the roof.', targets: [], view: view(deployed), transitionMs: 2500, durationMs: 800 });
    }
    if (support) mk('place', { title: 'Install radial support beams', notes: 'Lay the radial support beams across the top ring.', targets: [{ kind: 'beam', stackType: 'support-beam' }], view: view(deployed), op: { approach: 'above', travelIn: 24 } });
    if (rcp) mk('place', { title: 'Install reciprocal beams', notes: 'Weave the reciprocal beams over/under each other and onto the ring anchors.', targets: [{ kind: 'beam', stackType: 'support-beam-reciprocal' }], view: view(deployed), op: { approach: 'above', travelIn: 24 } });
    if (rcpBolts) mk('fasten', { title: 'Bolt the reciprocal beams', notes: 'Through-bolt each crossing and anchor.', targets: [{ kind: 'bolt', boltType: ['rcp-ring', 'rcp-cross'] }], view: view(deployed) });
    if (panels) {
        const count = resolveTargets(data, [{ kind: 'panel' }], parts).items.length;
        mk('place', { title: 'Mount the solar panels', notes: 'Lift each panel onto the support beams in order and clamp it down.', targets: [{ kind: 'panel' }], view: view(deployed),
            op: { approach: 'above', travelIn: 30, sequential: true }, durationMs: Math.min(12000, Math.max(2000, 600 * count + 800)) });
    }

    return steps;
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
    STOCK_LENGTHS_IN,
    roundTo,
    beamLengthIn,
    stockLengthFor,
    needsCut,
    dedupeHoles,
    groupBeamsForBench,
    planBench,
    benchSummary,
    stackTypeLabel,
    generateDefaultBuildSteps,
    REPEAT_MODES,
    defaultSettings,
    normalizeSettings,
    makeGroupId,
    normalizeGroups,
    groupOf,
    groupSteps,
    ungroupSteps,
    nextIndexAfter,
    representativeSteps,
    computeDisplacement,
    resolveParkOffset,
};

bridgeGlobals(_moduleExports, 'buildSteps');
