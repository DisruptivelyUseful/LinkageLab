// ============================================================================
// LINKAGE LAB — Deploy preview (ES module)
//
// Plays the same pack → deploy sequence the GLB exporter bakes (bundle rises out
// of the IBC column, is carried and laid flat, the scissor linkage unfolds, the
// roof beams fly in, the panels mount one by one) live in the viewport.
//
// Entering the preview bakes the "Deploy" clip with prepareExportScene()
// (inches, Y-up, viewport materials), hides the live structure and adds the
// baked scene in its place; an AnimationMixer scrubs the clip. Play drives the
// clip through the frame loop, optionally with a day clock (sunrise → sunset →
// night) and the IBC battery charging by day / powering the glow by night.
// Any geometry edit exits the preview (see the invalidateGeometryCache hook).
//
// Lazy: no THREE at module top level.
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { showToast } from '../core/feedback.js';
import { addFrameDriver, removeFrameDriver, hasFrameDriver } from './render-loop.js';
import { setIbcPowerBottles, collectIbcBottles, getIbcSoc, setIbcSoc } from './ibc-power.js';

const liveState = () => globalThis.state;

const SAMPLES = 32;
const DURATION = 12;            // seconds for the whole sequence at speed ×1
const SUNRISE_T = 26;           // state.sunTime at ~06:15
const DAY_UNITS_PER_SEQUENCE = 100;   // one full day over the deploy sequence

const preview = {
    active: false,
    baking: false,
    wrapper: null,
    scene: null,
    mixer: null,
    action: null,
    duration: DURATION,
    meta: null,
    t: 1,
    playing: false,
    direction: 1,
    dayClock: true,
    hidden: [],
    cycling: false,
};

// --- phase labels (pure; unit-tested) --------------------------------------------

/**
 * Human-readable phase for a normalised time t (0 packed … 1 deployed), from the
 * bake's meta { timeline: { fold, support, panels }, minFoldDeg, maxFoldDeg }.
 */
function deployPhaseLabel(t, meta) {
    const tl = meta && meta.timeline;
    const hasAngles = !!meta && isFinite(meta.minFoldDeg) && isFinite(meta.maxFoldDeg);
    const angleAt = (u) => `${(meta.minFoldDeg + (meta.maxFoldDeg - meta.minFoldDeg) * u).toFixed(0)}°`;
    if (tl && tl.fold) {
        if (t <= 0.001) return 'Packed';
        if (t >= 0.999) return 'Deployed';
        if (t < tl.fold[0]) return 'Unpacking';
        if (t <= tl.fold[1]) {
            const u = (t - tl.fold[0]) / (tl.fold[1] - tl.fold[0]);
            return hasAngles ? `Unfolding ${angleAt(u)}` : `Unfolding ${Math.round(u * 100)}%`;
        }
        if (tl.support && t <= tl.support[1]) return 'Roof beams';
        return 'Panels';
    }
    if (hasAngles) return angleAt(t);
    return `${Math.round(t * 100)}%`;
}

// --- DOM helpers -------------------------------------------------------------------------

function el(id) { return document.getElementById(id); }

function syncUI() {
    const controls = el('deploy-preview-controls');
    if (controls) controls.hidden = !preview.active;
    const enter = el('btn-deploy-enter');
    if (enter) {
        enter.hidden = preview.active;
        enter.disabled = preview.baking;
        enter.textContent = preview.baking ? 'Baking…' : 'Preview deploy sequence';
    }
    const btn = el('btn-deploy-preview');
    if (btn) {
        btn.setAttribute('aria-pressed', preview.active ? 'true' : 'false');
        btn.classList.toggle('is-active', preview.active);
        btn.title = preview.active ? 'Leave the deploy preview' : 'Preview the pack → deploy sequence';
        btn.innerHTML = preview.active ? '<span aria-hidden="true">■</span> Exit' : '<span aria-hidden="true">⤴</span> Deploy';
    }
    document.body.classList.toggle('deploy-preview', preview.active);
    const sl = el('sl-deploy-t');
    if (sl && Math.abs(parseFloat(sl.value) - preview.t * 1000) > 0.5) sl.value = String(Math.round(preview.t * 1000));
    const phase = el('deploy-phase');
    if (phase) {
        const label = deployPhaseLabel(preview.t, preview.meta);
        const model = globalThis.threeRenderer && globalThis.threeRenderer.studio && globalThis.threeRenderer.studio.model;
        const clock = model && model.clock ? model.clock : '';
        const status = preview.playing
            ? (preview.cycling ? ((model && model.daylight > 0.5) ? '☀ Charging' : '● Powering') : '▶')
            : '⏸';
        const pct = `${Math.round(getIbcSoc() * 100)}%`;
        const ibcOn = !!(liveState() && liveState().ibc && liveState().ibc.enabled);
        phase.textContent = [status, label, preview.dayClock && preview.playing ? clock : null, ibcOn && preview.dayClock ? pct : null]
            .filter(Boolean).join(' · ');
    }
    const chk = el('chk-deploy-dayclock');
    if (chk) chk.checked = preview.dayClock;
    const animStatus = el('anim-status');
    if (animStatus && preview.active) animStatus.textContent = preview.playing ? 'Deploy preview' : 'Deploy preview (paused)';
}

function renderNow() {
    if (typeof globalThis.renderFrameOnly === 'function') globalThis.renderFrameOnly();
}

// --- enter / exit --------------------------------------------------------------------------

function isDeployPreviewActive() { return preview.active; }

/** Re-applies the hidden state of the live groups (a full render un-hides them). */
function applyDeployPreviewVisibility() {
    if (!preview.active) return;
    preview.hidden.forEach(([group]) => { if (group) group.visible = false; });
    if (preview.wrapper) preview.wrapper.visible = true;
}

function liveGroundY() {
    try {
        const data = globalThis.buildLinkageGeometry({ useCache: true });
        const y = data && data.structureBounds && data.structureBounds.min ? data.structureBounds.min.y : 0;
        return isFinite(y) ? Math.min(0, y) : 0;
    } catch (e) {
        return 0;
    }
}

function enterDeployPreview() {
    if (preview.active || preview.baking) return;
    const state = liveState();
    const tr = globalThis.threeRenderer;
    if (!state || !tr || !tr.initialized || typeof THREE === 'undefined') return;
    if (typeof globalThis.prepareExportScene !== 'function') {
        showToast('Deploy preview is unavailable (exporter not loaded).', 'error');
        return;
    }
    if (state.hwDetailMode) {
        showToast('Close the part view to preview the deploy sequence.', 'info');
        return;
    }
    // The bundle rises out of the IBC column: wait for the tote model when it is enabled
    const ibcState = globalThis.ibcGlbState;
    if (state.ibc && state.ibc.enabled && ibcState && !ibcState.gltf) {
        showToast('Loading the IBC model first — try again in a moment.', 'info');
        if (typeof globalThis.preloadIbcGlb === 'function') globalThis.preloadIbcGlb();
        return;
    }
    // Stop the fold sweep if it is running
    if (state.animation && state.animation.playing) {
        state.animation.playing = false;
        if (state.animation.frameId) cancelAnimationFrame(state.animation.frameId);
        if (typeof globalThis.updateAnimationStatus === 'function') globalThis.updateAnimationStatus();
    }
    preview.baking = true;
    showToast('Baking the deploy sequence…', 'info');
    const btn = el('btn-deploy-preview');
    if (btn) btn.disabled = true;
    syncUI();
    // Deferred so the toast paints before the (synchronous) bake
    setTimeout(() => {
        try {
            bakeAndShow();
        } catch (e) {
            console.error('[DeployPreview] bake failed:', e);
            showToast('Deploy preview failed: ' + (e && e.message ? e.message : e), 'error');
            cleanup();
        } finally {
            preview.baking = false;
            if (btn) btn.disabled = false;
            syncUI();
        }
    }, 40);
}

function bakeAndShow() {
    const state = liveState();
    const tr = globalThis.threeRenderer;
    const prepared = globalThis.prepareExportScene('inches', 'yup', {
        animate: true, silent: true, viewportMaterials: true,
        animationSamples: SAMPLES, animationDuration: DURATION,
    });
    if (!prepared || !prepared.exportScene) {
        showToast('Nothing to preview — build a structure first.', 'error');
        return;
    }
    if (!prepared.foldAnimation || !prepared.foldAnimation.clip) {
        globalThis.disposeExportSceneResources && globalThis.disposeExportSceneResources(prepared.exportScene);
        showToast('The deploy sequence could not be baked for this configuration.', 'error');
        return;
    }
    const wrapper = prepared.exportScene.getObjectByName('CoordSystem') || prepared.exportScene;
    // The bake lifts the structure so its lowest beam sits at y = 0; the live ground is
    // drawn at the live structure's lowest point, so nothing jumps on entry.
    wrapper.position.y = liveGroundY();
    wrapper.name = 'DeployPreview';
    const shadows = !!state.shadowsEnabled;
    wrapper.traverse((o) => {
        if (o.isMesh) { o.castShadow = shadows; o.receiveShadow = shadows; }
    });
    if (wrapper.parent) wrapper.parent.remove(wrapper);
    tr.mainScene.add(wrapper);

    preview.scene = prepared.exportScene;
    preview.wrapper = wrapper;
    preview.meta = prepared.animationMeta;
    preview.duration = prepared.foldAnimation.clip.duration || DURATION;
    preview.mixer = new THREE.AnimationMixer(wrapper);
    preview.action = preview.mixer.clipAction(prepared.foldAnimation.clip);
    preview.action.loop = THREE.LoopOnce;
    preview.action.clampWhenFinished = true;
    preview.action.play();

    // Hide the live structure (beams, hardware, IBC, coverings), panels and references
    preview.hidden = ['structureGroup', 'panelGroupRoot', 'humanScaleGroup', 'measurementGroup', 'actuatorLineGroup']
        .map((k) => [tr[k], tr[k] ? tr[k].visible : true]);
    preview.hidden.forEach(([g]) => { if (g) g.visible = false; });

    // Battery gauge / night glow follow the baked totes
    setIbcPowerBottles(collectIbcBottles(wrapper));

    preview.active = true;
    preview.playing = false;
    preview.cycling = false;
    preview.direction = 1;
    setDeployT(1);
    if (typeof globalThis.updateSunPosition === 'function') globalThis.updateSunPosition();
    syncUI();
    renderNow();
    showToast('Deploy preview: scrub the slider or press Play', 'success');
}

function cleanup() {
    removeFrameDriver('deploy-play');
    const tr = globalThis.threeRenderer;
    if (preview.mixer) {
        try { preview.mixer.stopAllAction(); } catch (e) { /* ignore */ }
    }
    if (preview.wrapper && preview.wrapper.parent) preview.wrapper.parent.remove(preview.wrapper);
    if (preview.scene && typeof globalThis.disposeExportSceneResources === 'function') {
        try { globalThis.disposeExportSceneResources(preview.scene); } catch (e) { /* ignore */ }
    }
    if (preview.wrapper && typeof globalThis.disposeExportSceneResources === 'function') {
        try { globalThis.disposeExportSceneResources(preview.wrapper); } catch (e) { /* ignore */ }
    }
    preview.hidden.forEach(([g, wasVisible]) => { if (g) g.visible = wasVisible; });
    preview.hidden = [];
    preview.wrapper = null;
    preview.scene = null;
    preview.mixer = null;
    preview.action = null;
    preview.meta = null;
    preview.active = false;
    preview.playing = false;
    preview.cycling = false;
    if (tr && tr.ibcPivot) setIbcPowerBottles(collectIbcBottles(tr.ibcPivot));
    else setIbcPowerBottles([]);
}

function exitDeployPreview(reason) {
    if (!preview.active) return;
    cleanup();
    syncUI();
    if (typeof globalThis.updateAnimationStatus === 'function') globalThis.updateAnimationStatus();
    if (typeof globalThis.requestRender === 'function') globalThis.requestRender();
    if (reason === 'edited') showToast('Deploy preview closed (structure changed)', 'info');
}

// --- scrub / play ----------------------------------------------------------------------------

function setDeployT(t, opts = {}) {
    if (!preview.active || !preview.action) return;
    preview.t = Math.max(0, Math.min(1, Number(t) || 0));
    preview.action.time = preview.t * preview.duration;
    preview.mixer.update(0);
    if (!opts.silent) syncUI();
    if (!opts.noRender && !hasFrameDriver('deploy-play')) renderNow();
}

function getDeployT() { return preview.t; }

function setDayClock(on) {
    preview.dayClock = !!on;
    syncUI();
}

/** Advances the sun and the tote battery for `dt` seconds of playback. */
function tickDayClock(dt) {
    const state = liveState();
    if (!state || !preview.dayClock) return;
    const speed = (state.animation && state.animation.speed) || 1;
    const perSec = DAY_UNITS_PER_SEQUENCE / preview.duration;
    state.sunTime = ((Number(state.sunTime) || 0) + dt * speed * perSec) % 100;
    const sl = el('sl-sun-time');
    if (sl) sl.value = String(state.sunTime);
    if (typeof globalThis.updateSunPosition === 'function') globalThis.updateSunPosition();
    const model = globalThis.threeRenderer && globalThis.threeRenderer.studio && globalThis.threeRenderer.studio.model;
    const daylight = model ? (model.daylight || 0) : 1;
    // Charges with the sun, discharges under the night load (net positive over a sunny day)
    setIbcSoc(getIbcSoc() + (dt * speed / preview.duration) * (daylight * 1.1 - 0.35));
}

function playDeploy() {
    if (!preview.active) return;
    const state = liveState();
    if (preview.direction > 0 && preview.t >= 0.999) {
        setDeployT(0, { silent: true, noRender: true });
        if (preview.dayClock && state) {
            state.sunTime = SUNRISE_T;          // the build starts at sunrise
            setIbcSoc(0.4);                     // arrives part-charged
        }
    } else if (preview.direction < 0 && preview.t <= 0.001) {
        setDeployT(1, { silent: true, noRender: true });
    }
    preview.playing = true;
    preview.cycling = false;
    addFrameDriver('deploy-play', (dt) => {
        if (!preview.active || !preview.playing) return false;
        const speed = (state && state.animation && state.animation.speed) || 1;
        if (!preview.cycling) {
            let t = preview.t + preview.direction * (dt * speed) / preview.duration;
            if (preview.direction > 0 && t >= 1) {
                t = 1;
                // Deployed: keep the day clock cycling (charge by day, glow by night) until Pause
                if (preview.dayClock) preview.cycling = true;
                else preview.playing = false;
            } else if (preview.direction < 0 && t <= 0) {
                t = 0;
                preview.playing = false;
            }
            setDeployT(t, { silent: true, noRender: true });
        }
        tickDayClock(dt);
        syncUI();
        return preview.playing;
    });
    syncUI();
}

function pauseDeploy() {
    if (!preview.active) return;
    preview.playing = false;
    removeFrameDriver('deploy-play');
    syncUI();
    renderNow();
}

function toggleDeployPlay() {
    if (preview.playing) pauseDeploy();
    else playDeploy();
}

function reverseDeploy() {
    if (!preview.active) return;
    preview.direction *= -1;
    preview.cycling = false;
    showToast(`Deploy preview: ${preview.direction > 0 ? 'deploying' : 'packing'}`, 'info');
    syncUI();
}

/** Called by invalidateGeometryCache(): a structure edit invalidates the bake. */
function onGeometryInvalidated() {
    if (preview.active && !preview.baking) exitDeployPreview('edited');
}

function initDeployPreviewUI() {
    const btn = el('btn-deploy-preview');
    if (btn) btn.onclick = () => (preview.active ? exitDeployPreview() : enterDeployPreview());
    const sl = el('sl-deploy-t');
    if (sl) sl.oninput = (e) => { if (preview.playing) pauseDeploy(); setDeployT(parseFloat(e.target.value) / 1000); };
    const chk = el('chk-deploy-dayclock');
    if (chk) chk.onchange = (e) => setDayClock(e.target.checked);
    const exit = el('btn-deploy-exit');
    if (exit) exit.onclick = () => exitDeployPreview();
    const enter = el('btn-deploy-enter');
    if (enter) enter.onclick = () => enterDeployPreview();
    globalThis.onGeometryInvalidated = onGeometryInvalidated;
    syncUI();
}

const _moduleExports = {
    deployPreview: preview,
    deployPhaseLabel, isDeployPreviewActive, enterDeployPreview, exitDeployPreview, applyDeployPreviewVisibility,
    setDeployT, getDeployT, setDayClock, playDeploy, pauseDeploy, toggleDeployPlay, reverseDeploy, initDeployPreviewUI,
};
bridgeGlobals(_moduleExports, 'deployPreview');
export {
    deployPhaseLabel, isDeployPreviewActive, enterDeployPreview, exitDeployPreview, applyDeployPreviewVisibility,
    setDeployT, getDeployT, setDayClock, playDeploy, pauseDeploy, toggleDeployPlay, reverseDeploy, initDeployPreviewUI,
};
