// ============================================================================
// LINKAGE LAB — Frame loop (ES module)
//
// LinkageLab renders on demand (requestRender → full geometry rebuild). A few
// things need a steady frame rate without rebuilding anything: the deploy
// preview while it plays, the day clock, the IBC glow pulse and camera
// fly-to moves. Those register a *frame driver* here; the loop runs only while
// at least one driver is active and re-renders with renderFrameOnly().
//
// Double-render guard: a driver may trigger a full render itself (e.g. the fold
// sweep in animation.js calls requestRender). renderThreeJS() stamps
// threeRenderer._lastRenderTs, so a tick that already produced a full render
// after its drivers ran skips its own frame render.
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';

// app-state.js is reached through the global bridge: importing it here would run it
// before hardware-detail.js (which app-state's defaults depend on) in the load graph.
const liveState = () => globalThis.state;

const drivers = new Map();
let rafId = 0;
let lastTick = 0;

function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function tick(ts) {
    rafId = 0;
    const t = now();
    const dt = lastTick ? Math.min(0.1, (t - lastTick) / 1000) : 0;   // seconds, capped after tab switches
    lastTick = t;
    const tickStart = t;
    for (const [name, fn] of Array.from(drivers.entries())) {
        let keep = true;
        try {
            keep = fn(dt, t, ts) !== false;
        } catch (e) {
            console.warn(`[FrameLoop] driver "${name}" failed and was removed:`, e);
            keep = false;
        }
        if (!keep) drivers.delete(name);
    }
    const tr = globalThis.threeRenderer;
    const fullRenderHappened = tr && tr._lastRenderTs && tr._lastRenderTs >= tickStart;
    if (!fullRenderHappened && typeof globalThis.renderFrameOnly === 'function') {
        globalThis.renderFrameOnly();
    }
    if (drivers.size > 0) schedule();
    else lastTick = 0;
}

function schedule() {
    if (rafId || typeof requestAnimationFrame !== 'function') return;
    rafId = requestAnimationFrame(tick);
}

/**
 * Registers a per-frame callback. `fn(dtSeconds, nowMs)` returns false to
 * unregister itself. Re-registering a name replaces the previous driver.
 */
function addFrameDriver(name, fn) {
    if (typeof fn !== 'function') return;
    drivers.set(name, fn);
    schedule();
}

function removeFrameDriver(name) {
    drivers.delete(name);
}

function hasFrameDriver(name) {
    return drivers.has(name);
}

function isFrameLoopRunning() {
    return drivers.size > 0;
}

/** Ease-in-out cubic. */
function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function instantMoves() {
    try {
        if (typeof location !== 'undefined' && /[?&]lowfx=1/.test(location.search)) return true;
        if (typeof navigator !== 'undefined' && navigator.webdriver) return true;
        if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    } catch (e) { /* ignore */ }
    return false;
}

/**
 * Eases state.cam (yaw/pitch/dist/panX/panY) to a target over `durationMs`.
 * The final frame writes the target values exactly. Instant under automation
 * and when the user prefers reduced motion.
 */
function flyCameraTo(target, durationMs = 550) {
    const state = liveState();
    const cam = state && state.cam;
    if (!cam || !target) return;
    const keys = ['yaw', 'pitch', 'dist', 'panX', 'panY'];
    const from = {}, to = {};
    keys.forEach(k => {
        from[k] = Number(cam[k]) || 0;
        to[k] = target[k] !== undefined ? Number(target[k]) : from[k];
    });
    // Take the short way round in yaw
    let dYaw = to.yaw - from.yaw;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    to.yaw = from.yaw + dYaw;
    const finish = () => {
        keys.forEach(k => { cam[k] = to[k]; });
        if (target.target === null) delete cam.target;
        removeFrameDriver('camera-fly');
        if (typeof globalThis.requestRender === 'function') globalThis.requestRender();
    };
    if (durationMs <= 0 || instantMoves()) { finish(); return; }
    const t0 = now();
    addFrameDriver('camera-fly', () => {
        const u = Math.min(1, (now() - t0) / durationMs);
        const e = easeInOut(u);
        keys.forEach(k => { cam[k] = from[k] + (to[k] - from[k]) * e; });
        if (u >= 1) { finish(); return false; }
        return true;
    });
}

const _moduleExports = { addFrameDriver, removeFrameDriver, hasFrameDriver, isFrameLoopRunning, flyCameraTo, easeInOut };
bridgeGlobals(_moduleExports, 'renderLoop');
export { addFrameDriver, removeFrameDriver, hasFrameDriver, isFrameLoopRunning, flyCameraTo, easeInOut };
