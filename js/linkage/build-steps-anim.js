// ============================================================================ (ES module)
//
// Build Steps — playback engine.
//
// Drives the main viewport through the step sequence: camera + fold-angle
// transitions between steps, per-step operation animations (registered per
// kind by op drivers), and the scene staging hook that hides parts not yet
// installed and highlights the current step's parts.
//
// Frames that only move the camera or tool meshes call renderFrameOnly()
// (no mesh rebuild). Frames that change the fold angle re-solve through
// requestRender(), exactly like the existing fold animation.
//
// Depends on THREE (global) and the renderer; keep pure logic in build-steps.js.

import { bridgeGlobals } from './global-bridge.js';
import { state } from './app-state.js';
import { clamp, degToRad, radToDeg } from './math.js';
import { threeRenderer } from './renderer-3d.js';
import { requestRender } from './render-app.js';
import { renderFrameOnly } from './scene-render.js';
import { invalidateGeometryCache } from './cache.js';
import { buildLinkageGeometry } from './linkage-geometry.js';
import { syncUI } from './state-sync.js';
import { collectParts, matchSelector, partKey, partsBounds } from './part-keys.js';
import {
    autoFrameView,
    captureView,
    computeStepVisibility,
    createDefaultPlayback,
    groupOf,
    nextIndexAfter,
    normalizeSettings,
    normalizeView,
    resolveParkOffset,
    tweenView,
} from './build-steps.js';

const HOLD_MS = 350;
const MIN_FOLD_DEG = 5;
const MAX_FOLD_DEG = 175;

// ---------------------------------------------------------------------------
// Op drivers: per-kind animation hooks
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} OpDriver
 * @property {(ctx: OpContext) => void} [begin]   - called once when the op phase starts (after transition)
 * @property {(ctx: OpContext, t: number) => boolean|void} [update] - called every frame with eased 0..1; return true to request a full rebuild
 * @property {(ctx: OpContext) => void} [end]     - called when the op finishes or the step is left
 * @property {(ctx: OpContext) => void} [stage]   - called from the scene hook after meshes are rebuilt (bench setup, mesh lookups)
 */

const opDrivers = new Map();

/** Registers (or replaces) the animation driver for a step kind. */
function registerOpDriver(kind, driver) {
    opDrivers.set(kind, driver || {});
}

function driverFor(step) {
    return (step && opDrivers.get(step.kind)) || {};
}

// ---------------------------------------------------------------------------
// Engine state (module-private, not persisted)
// ---------------------------------------------------------------------------

const engine = {
    frameId: null,
    lastTs: 0,
    fromView: null,      // view at transition start
    toView: null,        // resolved target view for the current step
    fromTarget: null,    // world look-at point at transition start
    toTarget: null,      // world look-at point for the current step
    ctx: null,           // OpContext for the current step
    savedCam: null,
    savedFoldAngle: null,
    savedAnimation: null,
    listeners: new Set(),
    partsCache: { data: null, parts: null },
    visibility: null,    // last computed visibility map
};

function playback() {
    if (!state.buildPlayback) state.buildPlayback = createDefaultPlayback();
    return state.buildPlayback;
}

function steps() {
    return (state.buildSteps && Array.isArray(state.buildSteps.steps)) ? state.buildSteps.steps : [];
}

function settings() {
    return normalizeSettings(state.buildSteps && state.buildSteps.settings);
}

/** Group/repeat info for the current step, kept on the playback state for the UI. */
function updateRepeatInfo() {
    const pb = playback();
    const g = groupOf(steps(), pb.stepIndex);
    const mode = settings().repeatMode;
    pb.repeat = { groupId: g.groupId, count: g.count, position: g.position, isFirst: g.isFirst, mode, fastFactor: settings().fastFactor };
    return pb.repeat;
}

/** Time multiplier for the current step: later members of a group run fast in 'fast' mode. */
function repeatFactor() {
    const r = playback().repeat;
    if (!r || r.count < 2 || r.isFirst) return 1;
    return r.mode === 'fast' ? Math.max(1, r.fastFactor || 4) : 1;
}

function currentStep() {
    const list = steps();
    const pb = playback();
    if (!list.length) return null;
    pb.stepIndex = clamp(pb.stepIndex, 0, list.length - 1);
    return list[pb.stepIndex];
}

/** Subscribe to playback changes (UI refresh). Returns an unsubscribe function. */
function onPlaybackChange(fn) {
    engine.listeners.add(fn);
    return () => engine.listeners.delete(fn);
}

function emit(reason) {
    for (const fn of engine.listeners) {
        try { fn(reason, playback()); } catch (e) { console.warn('[BuildSteps] listener failed:', e); }
    }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function currentData() {
    return buildLinkageGeometry({ useCache: true });
}

/** collectParts() with a one-entry cache keyed on the data object. */
function partsFor(data) {
    if (engine.partsCache.data === data && engine.partsCache.parts) return engine.partsCache.parts;
    const parts = collectParts(data);
    engine.partsCache = { data, parts };
    return parts;
}

function rotateAboutY(p, center, rad) {
    if (!rad) return { x: p.x, y: p.y, z: p.z };
    const dx = p.x - center.x, dz = p.z - center.z;
    const c = Math.cos(rad), s = Math.sin(rad);
    return { x: center.x + dx * c + dz * s, y: p.y, z: center.z - dx * s + dz * c };
}

function structureCenterOf(data) {
    return data.structureCenter || (data.structureBounds && data.structureBounds.center) || { x: 0, y: 0, z: 0 };
}

/** World-space bounds of the parts matched by selectors (accounts for structure rotation). */
function targetsBounds(selectors, data, displacementOf = null) {
    if (!selectors || !selectors.length) return null;
    const parts = partsFor(data);
    const items = parts.filter(rec => selectors.some(sel => matchSelector(rec.obj, sel, rec.kind)));
    let b = partsBounds(items);
    if (!b) return null;
    // Parked parts sit displaced from their seated position; frame where they actually are
    if (displacementOf) {
        const off = displacementOf(items);
        if (off) b = { ...b, center: { x: b.center.x + off.x, y: b.center.y + off.y, z: b.center.z + off.z } };
    }
    const sc = structureCenterOf(data);
    const rot = degToRad(state.structureRotation || 0);
    // Panels are not rotated with the structure; everything else is.
    const onlyPanels = items.length && items.every(i => i.kind === 'panel');
    const center = onlyPanels ? b.center : rotateAboutY(b.center, sc, rot);
    return { ...b, center };
}

/** Structure-wide bounds (beams only) used to resolve 'beside' park offsets. */
function structureBeamBounds(data) {
    if (engine.partsCache.data === data && engine.partsCache.structBounds) return engine.partsCache.structBounds;
    const parts = partsFor(data);
    const b = partsBounds(parts.filter(p => p.kind === 'beam' && p.obj.stackType !== 'support-beam' && p.obj.stackType !== 'support-beam-reciprocal'));
    engine.partsCache.structBounds = b;
    return b;
}

/**
 * Resolves the park offset (structure-local vector) for a set of part records
 * that share one parkOffset spec. Cached per spec+data.
 */
function resolveDisplacement(spec, items, data) {
    if (!spec) return null;
    if (spec.mode !== 'beside') return resolveParkOffset(spec);
    const key = JSON.stringify(spec) + '|' + items.map(i => i.key).sort().join(',');
    engine.parkCache = engine.parkCache || new Map();
    const cached = engine.parkCache.get(key);
    if (cached && cached.data === data) return cached.off;
    const off = resolveParkOffset(spec, structureBeamBounds(data), partsBounds(items));
    engine.parkCache.set(key, { data, off });
    return off;
}

/**
 * Bounds to frame for a step: its targets, shifted where they are parked, and
 * for a lift (from parked) the span between parked and seated positions.
 */
function stepFrameBounds(step, index, data) {
    if (!step || !step.targets || !step.targets.length) return null;
    const parts = partsFor(data);
    const vis = computeStepVisibility(steps(), index, parts);
    const groupItems = (items, map) => {
        // all items of a step share one spec in practice; use the first
        const first = items.find(i => map.has(i.key));
        return first ? resolveDisplacement(map.get(first.key), items.filter(i => map.get(i.key) === map.get(first.key)), data) : null;
    };
    const op = step.op || {};
    if (op.from === 'parked') {
        const seated = targetsBounds(step.targets, data, null);
        const parkedB = targetsBounds(step.targets, data, (items) => groupItems(items, vis.displacementBefore));
        if (!seated || !parkedB) return seated || parkedB;
        const center = { x: (seated.center.x + parkedB.center.x) / 2, y: (seated.center.y + parkedB.center.y) / 2, z: (seated.center.z + parkedB.center.z) / 2 };
        const dx = seated.center.x - parkedB.center.x, dy = seated.center.y - parkedB.center.y, dz = seated.center.z - parkedB.center.z;
        return { ...seated, center, radius: seated.radius + Math.sqrt(dx * dx + dy * dy + dz * dz) / 2 };
    }
    return targetsBounds(step.targets, data, (items) => groupItems(items, vis.displacement));
}

/** Resolves a view's look-at point (anchor bounds center or structure center). */
function resolveViewTarget(view, data) {
    if (view && view.anchor) {
        const b = targetsBounds([view.anchor], data);
        if (b) return b.center;
    }
    return { ...structureCenterOf(data) };
}

function viewportAspect() {
    const canvas = document.getElementById('canvas-webgl');
    const el = (canvas && canvas.parentElement) || document.getElementById('viewport');
    if (el && el.clientWidth > 0 && el.clientHeight > 0) return el.clientWidth / el.clientHeight;
    return 1.5;
}

/**
 * The view a step should end up in: its saved view, or an auto-framed view of
 * its targets, or the current camera when it has neither.
 */
function resolveStepView(step, data, ctx = null) {
    if (step && step.view) return normalizeView(step.view);
    const live = captureView(state.cam, null, null);
    // Bench-stage steps frame the workbench, not the assembly
    if (ctx) {
        const d = driverFor(step);
        const bb = d.bounds ? d.bounds(ctx) : null;
        if (bb) {
            const v = autoFrameView(bb, { fovDeg: 45, aspect: viewportAspect(), yaw: 0.55, pitch: 0.6, anchor: null, foldAngleDeg: null, padding: 1.15 });
            v.__targetPoint = bb.center;
            return v;
        }
    }
    if (step && step.targets && step.targets.length) {
        const b = stepFrameBounds(step, ctx ? steps().indexOf(step) : steps().indexOf(step), data) || targetsBounds(step.targets, data);
        if (b) {
            const anchor = step.targets.length === 1 ? step.targets[0] : { kind: '*', __bounds: true };
            const v = autoFrameView(b, { fovDeg: 45, aspect: viewportAspect(), yaw: live.yaw, pitch: Math.max(0.2, live.pitch), anchor: null, foldAngleDeg: null });
            v.__targetPoint = b.center; // explicit look-at (not a selector)
            void anchor;
            return v;
        }
    }
    return live;
}

function liveView() {
    return captureView(state.cam, state.foldAngle, null);
}

function currentTargetPoint(data) {
    return (state.cam && state.cam.target) ? { ...state.cam.target } : { ...structureCenterOf(data) };
}

// ---------------------------------------------------------------------------
// Applying camera / fold
// ---------------------------------------------------------------------------

function applyCameraView(view, targetPoint) {
    const cam = state.cam;
    cam.yaw = view.yaw;
    cam.pitch = view.pitch;
    cam.dist = view.dist;
    cam.panX = view.panX;
    cam.panY = view.panY;
    cam.target = targetPoint ? { x: targetPoint.x, y: targetPoint.y, z: targetPoint.z } : null;
}

/** Sets the fold angle (degrees) if it differs. Returns true when a re-solve is needed. */
function applyFoldDeg(deg) {
    if (deg === null || deg === undefined || !Number.isFinite(deg)) return false;
    const rad = degToRad(clamp(deg, MIN_FOLD_DEG, MAX_FOLD_DEG));
    if (Math.abs(rad - state.foldAngle) < 1e-6) return false;
    state.foldAngle = rad;
    invalidateGeometryCache();
    try { syncUI('foldAngle'); } catch (e) { /* UI may not be bound in tests */ }
    return true;
}

function lerpPoint(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

// ---------------------------------------------------------------------------
// Playback control
// ---------------------------------------------------------------------------

function stopOtherAnimations() {
    if (state.animation && state.animation.playing) {
        state.animation.playing = false;
        if (state.animation.frameId) cancelAnimationFrame(state.animation.frameId);
        if (typeof globalThis.updateAnimationStatus === 'function') globalThis.updateAnimationStatus();
    }
    if (state.actuatorAnimation && state.actuatorAnimation.isPlaying && typeof globalThis.stopActuatorAnimation === 'function') {
        globalThis.stopActuatorAnimation();
    }
}

/** Enters playback mode (scene staging on, camera pinned). Does not start playing. */
function enterPlayback(index = null) {
    const pb = playback();
    if (!pb.active) {
        if (state.hwDetailMode && typeof globalThis.closeHardwareDetail === 'function') globalThis.closeHardwareDetail();
        stopOtherAnimations();
        engine.savedCam = { ...state.cam, target: null };
        engine.savedFoldAngle = state.foldAngle;
        pb.active = true;
        pb.phase = 'idle';
        pb.t = 0;
    }
    if (index !== null) pb.stepIndex = index;
    goToStep(pb.stepIndex, { immediate: true });
    emit('enter');
}

/** Leaves playback mode; restores the fold angle and unpins the camera. */
function exitPlayback() {
    const pb = playback();
    if (!pb.active) return;
    pause();
    endCurrentOp();
    pb.active = false;
    pb.phase = 'idle';
    pb.t = 0;
    if (state.cam) state.cam.target = null;
    if (engine.savedFoldAngle !== null && engine.savedFoldAngle !== undefined) applyFoldDeg(radToDeg(engine.savedFoldAngle));
    engine.savedFoldAngle = null;
    engine.fromView = engine.toView = null;
    engine.ctx = null;
    engine.visibility = null;
    restoreSceneAfterPlayback();
    invalidateGeometryCache();
    requestRender();
    emit('exit');
}

function endCurrentOp() {
    if (engine.ctx) {
        const d = driverFor(engine.ctx.step);
        if (d.end) { try { d.end(engine.ctx); } catch (e) { console.warn('[BuildSteps] op end failed:', e); } }
    }
    engine.ctx = null;
}

function buildContext(step, data) {
    const parts = partsFor(data);
    const targets = parts.filter(rec => (step.targets || []).some(sel => matchSelector(rec.obj, sel, rec.kind)));
    return {
        step,
        data,
        parts,
        targets,
        targetKeys: new Set(targets.map(t => t.key)),
        structureCenter: structureCenterOf(data),
        threeRenderer,
        requestRender,
        renderFrameOnly,
        scratch: {},
    };
}

/**
 * Jumps to a step. With `immediate`, the camera and fold snap to the step's
 * view and the op phase starts at once; otherwise a transition tween begins.
 */
function goToStep(index, { immediate = false, autoplay = null } = {}) {
    const pb = playback();
    const list = steps();
    endCurrentOp();
    if (!list.length) {
        pb.stepIndex = 0;
        pb.phase = 'idle';
        pb.t = 0;
        if (pb.active) { invalidateGeometryCache(); requestRender(); }
        emit('step');
        return null;
    }
    pb.stepIndex = clamp(index, 0, list.length - 1);
    const step = list[pb.stepIndex];
    if (!pb.active) enterPlayback(pb.stepIndex);
    updateRepeatInfo();
    const data = currentData();

    engine.fromView = liveView();
    engine.fromTarget = currentTargetPoint(data);
    engine.ctx = buildContext(step, data);
    engine.toView = resolveStepView(step, data, engine.ctx);
    engine.toTarget = engine.toView.__targetPoint || resolveViewTarget(engine.toView, data);
    engine.visibility = null;

    if (immediate || !step.transitionMs) {
        const changedFold = applyFoldDeg(engine.toView.foldAngleDeg);
        applyCameraView(engine.toView, engine.toTarget);
        pb.phase = 'op';
        pb.t = 0;
        beginOp(changedFold);
    } else {
        pb.phase = 'transition';
        pb.t = 0;
        invalidateGeometryCache();
        requestRender(); // restage visibility for the new step immediately
    }
    if (autoplay !== null) pb.playing = !!autoplay;
    if (pb.playing) ensureLoop();
    emit('step');
    return step;
}

function beginOp(needsRebuild) {
    const ctx = engine.ctx;
    if (!ctx) return;
    // The context's geometry may be stale after a fold change during the transition
    if (needsRebuild) {
        const data = currentData();
        engine.ctx = buildContext(ctx.step, data);
    }
    const d = driverFor(engine.ctx.step);
    if (d.begin) { try { d.begin(engine.ctx); } catch (e) { console.warn('[BuildSteps] op begin failed:', e); } }
    invalidateGeometryCache();
    requestRender();
}

function play() {
    const pb = playback();
    if (!steps().length) return;
    if (!pb.active) enterPlayback(pb.stepIndex);
    stopOtherAnimations();
    // Restarting a finished sequence
    if (pb.phase === 'done') goToStep(0, { immediate: false });
    if (pb.phase === 'idle') goToStep(pb.stepIndex, { immediate: false });
    pb.playing = true;
    ensureLoop();
    emit('play');
}

function pause() {
    const pb = playback();
    pb.playing = false;
    if (engine.frameId) { cancelAnimationFrame(engine.frameId); engine.frameId = null; }
    engine.lastTs = 0;
    emit('pause');
}

function togglePlay() {
    if (playback().playing) pause(); else play();
}

function next() {
    const pb = playback();
    if (pb.stepIndex < steps().length - 1) goToStep(pb.stepIndex + 1, { immediate: !pb.playing });
    else { pb.phase = 'done'; pause(); }
}

function prev() {
    const pb = playback();
    goToStep(Math.max(0, pb.stepIndex - 1), { immediate: !pb.playing });
}

function setSpeed(v) {
    playback().speed = clamp(Number(v) || 1, 0.1, 8);
    emit('speed');
}

function setLoop(v) {
    playback().loop = !!v;
    emit('loop');
}

/** Scrubs the current step's op phase to t (0..1) without playing. */
function scrubOp(t) {
    const pb = playback();
    if (!pb.active || !engine.ctx) return;
    if (pb.phase === 'transition') {
        // Finish the transition first
        applyFoldDeg(engine.toView.foldAngleDeg);
        applyCameraView(engine.toView, engine.toTarget);
        pb.phase = 'op';
        beginOp(true);
    }
    pb.t = clamp(Number(t) || 0, 0, 1);
    runOpFrame(pb.t, { snap: true });
    emit('scrub');
}

function ensureLoop() {
    if (engine.frameId) return;
    engine.lastTs = 0;
    engine.frameId = requestAnimationFrame(tick);
}

function tick(ts) {
    engine.frameId = null;
    const pb = playback();
    if (!pb.active || !pb.playing) return;
    // Cap the per-frame delta so a stalled tab does not jump, but allow slow
    // software-rendered frames (fold re-solves) to keep sequence time honest.
    const dt = engine.lastTs ? Math.min(250, ts - engine.lastTs) : 16;
    engine.lastTs = ts;
    stepFrame(dt * (pb.speed || 1) * repeatFactor());
    if (pb.playing) engine.frameId = requestAnimationFrame(tick);
}

/**
 * Advances playback by dtMs of *sequence* time and renders one frame.
 * Exposed so a recorder can drive playback with a fixed time step.
 */
function stepFrame(dtMs) {
    const pb = playback();
    const step = currentStep();
    if (!step) { pause(); return; }

    if (pb.phase === 'transition') {
        const dur = Math.max(1, step.transitionMs || 1);
        pb.t = Math.min(1, pb.t + dtMs / dur);
        runTransitionFrame(pb.t);
        if (pb.t >= 1) {
            pb.phase = 'op';
            pb.t = 0;
            beginOp(true);
        }
        emit('frame');
        return;
    }

    if (pb.phase === 'op') {
        const dur = Math.max(1, step.durationMs || 1);
        pb.t = Math.min(1, pb.t + dtMs / dur);
        runOpFrame(pb.t);
        if (pb.t >= 1) {
            pb.phase = 'hold';
            pb.t = 0;
        }
        emit('frame');
        return;
    }

    if (pb.phase === 'hold') {
        pb.t = Math.min(1, pb.t + dtMs / HOLD_MS);
        if (pb.t >= 1) advanceAfterHold();
        return;
    }

    if (pb.phase === 'idle' || pb.phase === 'done') {
        goToStep(pb.phase === 'done' ? 0 : pb.stepIndex, { immediate: false });
    }
}

function advanceAfterHold() {
    const pb = playback();
    const list = steps();
    const nextIdx = nextIndexAfter(list, pb.stepIndex, settings().repeatMode);
    if (nextIdx >= 0) {
        goToStep(nextIdx, { immediate: false });
    } else if (pb.loop) {
        goToStep(0, { immediate: false });
    } else {
        pb.phase = 'done';
        pb.t = 1;
        pause();
        emit('done');
    }
}

function runTransitionFrame(t) {
    const view = tweenView(engine.fromView, engine.toView, t);
    const target = lerpPoint(engine.fromTarget, engine.toTarget, view ? easeT(t) : t);
    const changedFold = applyFoldDeg(view.foldAngleDeg);
    applyCameraView(view, target);
    if (changedFold) requestRender();
    else renderFrameOnly();
}

function easeT(t) {
    const x = clamp(t, 0, 1);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function runOpFrame(t, { snap = false } = {}) {
    const ctx = engine.ctx;
    if (!ctx) { renderFrameOnly(); return; }
    const d = driverFor(ctx.step);
    let rebuild = false;
    if (d.update) {
        try { rebuild = !!d.update(ctx, t); } catch (e) { console.warn('[BuildSteps] op update failed:', e); }
    }
    // Let the op steer the look-at point (e.g. follow the drill bit)
    if (d.focus && state.cam) {
        let p = null;
        try { p = d.focus(ctx, t); } catch (e) { /* ignore */ }
        if (p) {
            const cur = state.cam.target || p;
            const k = snap ? 1 : 0.12;
            state.cam.target = { x: cur.x + (p.x - cur.x) * k, y: cur.y + (p.y - cur.y) * k, z: cur.z + (p.z - cur.z) * k };
            engine.toTarget = state.cam.target;
        }
    }
    if (rebuild) { invalidateGeometryCache(); requestRender(); }
    else renderFrameOnly();
}

// ---------------------------------------------------------------------------
// Scene staging hook (called from updateThreeJSScenes during playback)
// ---------------------------------------------------------------------------

const HIGHLIGHT_EMISSIVE = 0x5a3a00;

function meshPartKey(obj) {
    const ud = obj.userData || {};
    if (ud.beam) return partKey(ud.beam, 'beam');
    if (ud.bolt) return partKey(ud.bolt, 'bolt');
    if (ud.washer) return partKey(ud.washer, 'washer');
    if (ud.bracket) return partKey(ud.bracket, 'bracket');
    if (ud.placement) return partKey(ud.placement, 'placement');
    if (ud.panel) return partKey(ud.panel, 'panel');
    return null;
}

function highlightMesh(root) {
    root.traverse(ch => {
        if (!ch.isMesh || !ch.material) return;
        // Shared (cached) materials must be cloned before we tint them
        const mat = ch.material.clone();
        if (mat.emissive) mat.emissive.setHex(HIGHLIGHT_EMISSIVE);
        ch.material = mat;
        ch.userData.buildHighlighted = true;
    });
}

/** Iterates the top-level part groups/meshes of the rebuilt scene. */
function forEachPartMesh(fn) {
    const groups = [
        threeRenderer.beamGroup, threeRenderer.bracketGroup, threeRenderer.boltGroup,
        threeRenderer.washerGroup, threeRenderer.hardwareAssemblyGroup, threeRenderer.panelGroup,
    ];
    for (const g of groups) {
        if (!g) continue;
        for (const child of g.children) {
            const key = meshPartKey(child);
            if (key) fn(child, key);
        }
    }
}

/**
 * Applies build-step staging to the freshly rebuilt scene.
 * @param {Object} data - geometry
 * @param {{x,y,z}} sc - structure center
 */
function applyBuildStepScene(data, sc) {
    const pb = playback();
    if (!pb.active) return;
    const step = currentStep();
    if (!step) return;
    const parts = partsFor(data);

    const vis = computeStepVisibility(steps(), pb.stepIndex, parts);
    engine.visibility = vis;

    // Parked parts (e.g. the top ring built beside the bottom ring) are displaced
    // before op drivers stage, so drivers see the parked position as "seated".
    const byKey = new Map(parts.map(p => [p.key, p]));
    const specGroups = new Map(); // spec json -> items
    vis.displacement.forEach((spec, key) => {
        const rec = byKey.get(key);
        if (!rec) return;
        const k = JSON.stringify(spec);
        if (!specGroups.has(k)) specGroups.set(k, { spec, items: [] });
        specGroups.get(k).items.push(rec);
    });
    const offsetByKey = new Map();
    specGroups.forEach(({ spec, items }) => {
        const off = resolveDisplacement(spec, items, data);
        if (off) items.forEach(i => offsetByKey.set(i.key, off));
    });
    engine.displacementOffsets = offsetByKey;

    forEachPartMesh((mesh, key) => {
        const s = vis.status.get(key);
        if (s === 'future') { mesh.visible = false; return; }
        mesh.visible = true;
        const off = offsetByKey.get(key);
        if (off) { mesh.position.x += off.x; mesh.position.y += off.y; mesh.position.z += off.z; }
        if (s === 'active') highlightMesh(mesh);
    });

    // Bench-stage steps hide the structure entirely; the op driver owns the bench
    const bench = step.stage === 'bench';
    if (threeRenderer.structureGroup) threeRenderer.structureGroup.visible = !bench;
    if (threeRenderer.panelGroupRoot) threeRenderer.panelGroupRoot.visible = !bench;
    if (threeRenderer.gridHelper && bench) threeRenderer.gridHelper.visible = false;
    if (threeRenderer.humanScaleGroup) threeRenderer.humanScaleGroup.visible = !bench;
    if (threeRenderer.ibcReferenceGroup) threeRenderer.ibcReferenceGroup.visible = false; // reference tank distracts from the build
    if (threeRenderer.benchGroup && !bench) threeRenderer.benchGroup.visible = false;
    if (!bench) pb.benchSummary = '';

    // Keep the op context in sync with the rebuilt meshes, then re-apply the
    // current op progress so a mid-op rebuild does not snap parts back.
    if (engine.ctx && engine.ctx.step === step) {
        engine.ctx.data = data;
        engine.ctx.parts = parts;
        engine.ctx.structureCenter = sc || structureCenterOf(data);
        engine.ctx.visibility = vis;
        // Offsets the step's targets were parked at before this step (for from:'parked' lifts)
        engine.ctx.parkedOffsetFor = (key) => {
            const spec = vis.displacementBefore.get(key);
            if (!spec) return null;
            const items = parts.filter(p => vis.displacementBefore.get(p.key) === spec);
            return resolveDisplacement(spec, items, data);
        };
        const d = driverFor(step);
        if (d.stage) { try { d.stage(engine.ctx); } catch (e) { console.warn('[BuildSteps] op stage failed:', e); } }
        if (d.update && (pb.phase === 'op' || pb.phase === 'hold' || pb.phase === 'done')) {
            const t = pb.phase === 'op' ? pb.t : 1;
            try { d.update(engine.ctx, t); } catch (e) { console.warn('[BuildSteps] op update failed:', e); }
        } else if (d.update && pb.phase === 'transition') {
            try { d.update(engine.ctx, 0); } catch (e) { console.warn('[BuildSteps] op update failed:', e); }
        }
    }
    emit('staged');
}

/** Restores structure visibility when playback is off (called on normal renders). */
function restoreSceneAfterPlayback() {
    if (threeRenderer.structureGroup) threeRenderer.structureGroup.visible = true;
    if (threeRenderer.panelGroupRoot) threeRenderer.panelGroupRoot.visible = true;
    if (threeRenderer.humanScaleGroup) threeRenderer.humanScaleGroup.visible = true;
    if (threeRenderer.ibcReferenceGroup) threeRenderer.ibcReferenceGroup.visible = true;
    if (threeRenderer.benchGroup) threeRenderer.benchGroup.visible = false;
    if (state.buildPlayback) state.buildPlayback.benchSummary = '';
}

// ---------------------------------------------------------------------------
// View helpers for the editor
// ---------------------------------------------------------------------------

/** Captures the live camera + fold for saving on a step. */
function captureCurrentView(anchorSelector = null) {
    return captureView(state.cam, state.foldAngle, anchorSelector);
}

/** Auto-frames a step's targets; returns a view or null when it has no targets. */
function autoFrameStep(step) {
    const data = currentData();
    const b = targetsBounds(step && step.targets, data);
    if (!b) return null;
    const live = captureView(state.cam, null, null);
    const anchor = step.targets.length === 1 ? step.targets[0] : null;
    return autoFrameView(b, { fovDeg: 45, aspect: viewportAspect(), yaw: live.yaw, pitch: Math.max(0.2, live.pitch), anchor, foldAngleDeg: radToDeg(state.foldAngle) });
}

/** Moves the live camera to a step's view (used by "Go to view" and thumbnails). */
function showStepView(step) {
    const data = currentData();
    const ctx = (engine.ctx && engine.ctx.step === step) ? engine.ctx : buildContext(step, data);
    const view = resolveStepView(step, data, ctx);
    const target = view.__targetPoint || resolveViewTarget(view, data);
    applyFoldDeg(view.foldAngleDeg);
    applyCameraView(view, target);
    invalidateGeometryCache();
    requestRender();
}

// Default (no-op) driver for plain view steps
registerOpDriver('view', {});

const _moduleExports = {
    registerOpDriver,
    onPlaybackChange,
    enterPlayback,
    exitPlayback,
    goToStep,
    play,
    pause,
    togglePlay,
    next,
    prev,
    setSpeed,
    setLoop,
    scrubOp,
    stepFrame,
    applyBuildStepScene,
    restoreSceneAfterPlayback,
    captureCurrentView,
    autoFrameStep,
    showStepView,
    resolveStepView,
    targetsBounds,
    forEachPartMesh,
    meshPartKey,
    updateRepeatInfo,
    settings,
};

bridgeGlobals(_moduleExports, 'buildStepsAnim');

export {
    registerOpDriver,
    onPlaybackChange,
    enterPlayback,
    exitPlayback,
    goToStep,
    play,
    pause,
    togglePlay,
    next,
    prev,
    setSpeed,
    setLoop,
    scrubOp,
    stepFrame,
    applyBuildStepScene,
    restoreSceneAfterPlayback,
    captureCurrentView,
    autoFrameStep,
    showStepView,
    resolveStepView,
    targetsBounds,
    forEachPartMesh,
    meshPartKey,
    updateRepeatInfo,
    settings,
};
