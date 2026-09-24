// ============================================================================ (ES module)
//
// Build Steps — exports.
//
//   * captureStepThumbnails(): renders every step's end state in the live
//     viewport and returns downscaled PNG data URLs (used by the Build Guide
//     modal and the PDF).
//   * recordBuildStepsVideo(): plays the sequence with a fixed time step
//     while MediaRecorder captures the WebGL canvas, then downloads a WebM.
//
// Both drive the normal playback engine, so what is exported is exactly what
// the viewport shows.

import { bridgeGlobals } from './global-bridge.js';
import { state } from './app-state.js';
import { showToast } from '../core/feedback.js';
import { render } from './render-app.js';
import { renderFrameOnly } from './scene-render.js';
import { totalDurationMs } from './build-steps.js';
import { enterPlayback, exitPlayback, goToStep, scrubOp, stepFrame, pause } from './build-steps-anim.js';

const thumbCache = new Map(); // stepId -> { key, dataUrl }

function steps() {
    return (state.buildSteps && state.buildSteps.steps) || [];
}

function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function stepCacheKey(step, index) {
    return `${index}|${JSON.stringify([step.kind, step.stage, step.targets, step.view, step.op])}|${state.modules}|${state.hLengthFt}|${state.vLengthFt}|${state.orientation}|${state.showHardwareFullDetail}`;
}

function downscale(canvas, maxW) {
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return null;
    const scale = Math.min(1, maxW / w);
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(w * scale));
    off.height = Math.max(1, Math.round(h * scale));
    off.getContext('2d').drawImage(canvas, 0, 0, off.width, off.height);
    return off.toDataURL('image/jpeg', 0.85);
}

/** Snapshot of everything playback changes, to restore afterwards. */
function savePlaybackContext() {
    return {
        active: !!(state.buildPlayback && state.buildPlayback.active),
        stepIndex: state.buildPlayback ? state.buildPlayback.stepIndex : 0,
        cam: { ...state.cam },
        foldAngle: state.foldAngle,
    };
}

function restorePlaybackContext(saved) {
    if (saved.active) {
        goToStep(saved.stepIndex, { immediate: true });
    } else {
        exitPlayback();
        Object.assign(state.cam, saved.cam);
        state.cam.target = null;
        state.foldAngle = saved.foldAngle;
        if (typeof globalThis.invalidateGeometryCache === 'function') globalThis.invalidateGeometryCache();
        render();
    }
}

/**
 * Renders each step's finished state and returns [{ id, index, dataUrl }].
 * @param {{maxWidth?:number, onProgress?:(i:number,n:number)=>void, force?:boolean}} opts
 */
async function captureStepThumbnails(opts = {}) {
    const list = steps();
    const canvas = document.getElementById('canvas-webgl');
    if (!list.length || !canvas) return [];
    const maxW = opts.maxWidth || 640;
    const saved = savePlaybackContext();
    const out = [];
    try {
        enterPlayback(0);
        const wanted = Array.isArray(opts.stepIds) && opts.stepIds.length ? new Set(opts.stepIds) : null;
        for (let i = 0; i < list.length; i++) {
            const step = list[i];
            if (wanted && !wanted.has(step.id)) continue;
            const key = stepCacheKey(step, i);
            const cached = thumbCache.get(step.id);
            if (cached && cached.key === key && !opts.force) {
                out.push({ id: step.id, index: i, dataUrl: cached.dataUrl });
                if (opts.onProgress) opts.onProgress(i + 1, list.length);
                continue;
            }
            goToStep(i, { immediate: true });
            render();          // synchronous rebuild + stage for this step
            scrubOp(1);        // finished state of the operation, camera on target
            renderFrameOnly();
            const dataUrl = downscale(canvas, maxW);
            thumbCache.set(step.id, { key, dataUrl });
            out.push({ id: step.id, index: i, dataUrl });
            if (opts.onProgress) opts.onProgress(i + 1, list.length);
            await nextFrame();
        }
    } finally {
        restorePlaybackContext(saved);
    }
    return out;
}

function getCachedThumbnail(stepId) {
    const c = thumbCache.get(stepId);
    return c ? c.dataUrl : null;
}

function pickMimeType() {
    if (typeof MediaRecorder === 'undefined') return null;
    const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return candidates.find(c => MediaRecorder.isTypeSupported(c)) || null;
}

let recording = false;

/**
 * Records the sequence (or a range) to a WebM file.
 * @param {{from?:number, to?:number, fps?:number, speed?:number, onProgress?:(ms:number,total:number)=>void}} opts
 * @returns {Promise<Blob|null>}
 */
async function recordBuildStepsVideo(opts = {}) {
    const list = steps();
    const canvas = document.getElementById('canvas-webgl');
    if (!list.length || !canvas) { showToast('Add build steps first', 'warning'); return null; }
    const mime = pickMimeType();
    if (!mime || typeof canvas.captureStream !== 'function') { showToast('Video recording is not supported in this browser', 'error'); return null; }
    if (recording) { showToast('Already recording', 'warning'); return null; }
    recording = true;
    const fps = opts.fps || 30;
    const from = Math.max(0, opts.from || 0);
    const to = Math.min(list.length - 1, opts.to === undefined ? list.length - 1 : opts.to);
    const dtMs = 1000 / fps;
    const totalMs = list.slice(from, to + 1).reduce((n, s) => n + s.transitionMs + s.durationMs + 350, 0);
    const saved = savePlaybackContext();
    const pb = state.buildPlayback;
    const prevLoop = pb.loop, prevSpeed = pb.speed;
    const chunks = [];
    let blob = null;
    try {
        enterPlayback(from);
        pb.loop = false;
        pb.speed = 1;
        goToStep(from, { immediate: false });
        render();
        await nextFrame();
        const stream = canvas.captureStream(0);
        const track = stream.getVideoTracks()[0];
        const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        const stopped = new Promise(resolve => { rec.onstop = resolve; });
        rec.start(250);
        let elapsed = 0;
        let guard = 0;
        pb.playing = true;
        while (pb.active && guard < 200000) {
            const before = pb.stepIndex;
            stepFrame(dtMs * (opts.speed || 1));
            elapsed += dtMs;
            guard += 1;
            if (track && typeof track.requestFrame === 'function') track.requestFrame();
            if (opts.onProgress) opts.onProgress(elapsed, totalMs);
            await nextFrame();
            if (pb.phase === 'done') break;
            if (pb.stepIndex > to || (pb.stepIndex < before)) break; // ran past the range or looped
            if (!pb.playing && pb.phase !== 'hold') pb.playing = true; // keep driving even if a listener paused
        }
        pb.playing = false;
        pause();
        rec.stop();
        await stopped;
        blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `LinkageLab_BuildSteps_${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast(`Video exported (${(blob.size / 1024 / 1024).toFixed(1)} MB)`, 'success');
    } catch (e) {
        console.error('[BuildSteps] video export failed:', e);
        showToast(`Video export failed: ${e.message}`, 'error');
    } finally {
        recording = false;
        pb.loop = prevLoop;
        pb.speed = prevSpeed;
        restorePlaybackContext(saved);
    }
    return blob;
}

function isRecording() {
    return recording;
}

const _moduleExports = { captureStepThumbnails, getCachedThumbnail, recordBuildStepsVideo, isRecording, estimateVideoMs: () => totalDurationMs(state.buildSteps) };
bridgeGlobals(_moduleExports, 'buildStepsExport');
export { captureStepThumbnails, getCachedThumbnail, recordBuildStepsVideo, isRecording };
