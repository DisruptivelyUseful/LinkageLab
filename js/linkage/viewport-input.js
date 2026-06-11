// ============================================================================ (ES module)

import { bridgeGlobals } from './global-bridge.js';
import { invalidateGeometryCache } from './cache.js';

const drag = { active: false, x: 0, y: 0, mode: 'orbit' };
const pinch = { active: false, startDist: 0, startCamDist: 0, lastCenterX: 0, lastCenterY: 0 };

    let autoSavePending = false;

    const spaceMouse = {
        connected: false,
        gamepadIndex: null,
        sensitivity: {
            pan: 8.0,
            zoom: 0.08,
            orbit: 0.08,
            tilt: 0.08
        },
        deadZone: 0.04,
        invert: {
            panX: -1,
            panY: 1,
            zoom: -1,
            orbit: 1,
            tilt: -1
        },
        axes: {
            panX: 0,
            panY: 1,
            zoom: 2,
            tilt: 3,
            orbit: 5,
            roll: 4
        }
    };

    let spaceMouseAnimationId = null;
    let spaceMouseInitialized = false;

    function isFormElement(el) {
        if (!el) return false;
        const tagName = el.tagName;
        if (tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA' || tagName === 'BUTTON') {
            return true;
        }
        if (el.closest('.input-wrap') || el.closest('#sidebar') || el.closest('#right-panel')) {
            return true;
        }
        return false;
    }

    function setViewportDragging(active) {
        document.getElementById('viewport')?.classList.toggle('viewport-dragging', active);
    }

    function finishViewportDrag() {
        const wasActive = drag.active || pinch.active;
        if (drag.active) {
            drag.active = false;
            if (autoSavePending) {
                autoSavePending = false;
                autoSave();
            }
        }
        pinch.active = false;
        if (wasActive) {
            setViewportDragging(false);
        }
    }

    function applyCameraDragDelta(dx, dy) {
        if (drag.mode === 'orbit') {
            state.cam.yaw -= dx * 0.01;
            state.cam.pitch += dy * 0.01;
        } else if (drag.mode === 'pan') {
            state.cam.panX += dx;
            state.cam.panY += dy;
        } else if (drag.mode === 'fold') {
            let newAngle = state.foldAngle + dx * 0.005;
            newAngle = clamp(newAngle, getEffectiveMinFoldAngle(), MAX_FOLD_ANGLE);

            if (state.enforceCollision) {
                invalidateGeometryCache();
                const data = solveLinkage(newAngle);
                const collisions = detectCollisions(data);
                if (collisions.length > 0) {
                    const previousAngle = state.foldAngle;
                    const safeAngle = findSafeFoldAngle(newAngle, previousAngle);
                    if (safeAngle !== null) {
                        newAngle = safeAngle;
                    } else {
                        newAngle = state.foldAngle;
                    }
                }
            }

            state.foldAngle = newAngle;
            syncUI('foldAngle');
            autoSavePending = true;
        }

        requestRender();
    }

    function getTouchPairDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.hypot(dx, dy);
    }

    function getTouchPairCenter(touches) {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        };
    }

    function clampCameraDistance() {
        if (state.cam.dist < MIN_CAM_DIST) state.cam.dist = MIN_CAM_DIST;
    }

    function isSpaceMouse(gamepad) {
        if (!gamepad || !gamepad.id) return false;
        const id = gamepad.id.toLowerCase();
        return id.includes('3dconnexion') ||
            id.includes('spacemouse') ||
            id.includes('spacenavigator') ||
            id.includes('spacepilot') ||
            (gamepad.axes && gamepad.axes.length >= 6);
    }

    function applyDeadZone(value, deadZone) {
        if (Math.abs(value) < deadZone) return 0;
        const sign = value > 0 ? 1 : -1;
        return sign * (Math.abs(value) - deadZone) / (1 - deadZone);
    }

    function pollSpaceMouse() {
        if (!spaceMouse.connected || spaceMouse.gamepadIndex === null) return;

        const gamepads = navigator.getGamepads();
        const gamepad = gamepads[spaceMouse.gamepadIndex];

        if (!gamepad) {
            spaceMouse.connected = false;
            spaceMouse.gamepadIndex = null;
            console.log('[SpaceMouse] Disconnected');
            return;
        }

        const axes = gamepad.axes;
        if (!axes || axes.length < 6) return;

        const panX = applyDeadZone(axes[spaceMouse.axes.panX], spaceMouse.deadZone);
        const panY = applyDeadZone(axes[spaceMouse.axes.panY], spaceMouse.deadZone);
        const zoom = applyDeadZone(axes[spaceMouse.axes.zoom], spaceMouse.deadZone);
        const tilt = applyDeadZone(axes[spaceMouse.axes.tilt], spaceMouse.deadZone);
        const orbit = applyDeadZone(axes[spaceMouse.axes.orbit], spaceMouse.deadZone);

        const hasInput = panX !== 0 || panY !== 0 || zoom !== 0 || tilt !== 0 || orbit !== 0;

        if (hasInput) {
            const inv = spaceMouse.invert;

            state.cam.panX -= panX * inv.panX * spaceMouse.sensitivity.pan * (state.cam.dist / 100);
            state.cam.panY += panY * inv.panY * spaceMouse.sensitivity.pan * (state.cam.dist / 100);
            state.cam.dist += zoom * inv.zoom * spaceMouse.sensitivity.zoom * state.cam.dist;

            if (state.cam.dist < MIN_CAM_DIST) state.cam.dist = MIN_CAM_DIST;
            if (state.cam.dist > 10000) state.cam.dist = 10000;

            state.cam.yaw += orbit * inv.orbit * spaceMouse.sensitivity.orbit;
            state.cam.pitch -= tilt * inv.tilt * spaceMouse.sensitivity.tilt;
            state.cam.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, state.cam.pitch));

            requestRender();
        }
    }

    function spaceMouseLoop() {
        pollSpaceMouse();
        spaceMouseAnimationId = requestAnimationFrame(spaceMouseLoop);
    }

    function initSpaceMouse() {
        if (spaceMouseInitialized) return;
        spaceMouseInitialized = true;

        window.addEventListener('gamepadconnected', (e) => {
            if (isSpaceMouse(e.gamepad)) {
                spaceMouse.connected = true;
                spaceMouse.gamepadIndex = e.gamepad.index;
                console.log('[SpaceMouse] Connected:', e.gamepad.id);
                console.log('[SpaceMouse] Axes:', e.gamepad.axes.length, 'Buttons:', e.gamepad.buttons.length);

                if (!spaceMouseAnimationId) {
                    spaceMouseLoop();
                }
            }
        });

        window.addEventListener('gamepaddisconnected', (e) => {
            if (e.gamepad.index === spaceMouse.gamepadIndex) {
                spaceMouse.connected = false;
                spaceMouse.gamepadIndex = null;
                console.log('[SpaceMouse] Disconnected');
            }
        });

        const gamepads = navigator.getGamepads();
        for (let i = 0; i < gamepads.length; i++) {
            if (gamepads[i] && isSpaceMouse(gamepads[i])) {
                spaceMouse.connected = true;
                spaceMouse.gamepadIndex = i;
                console.log('[SpaceMouse] Found on init:', gamepads[i].id);
                spaceMouseLoop();
                break;
            }
        }
    }

    function initViewportInput() {
        const sidebar = document.getElementById('sidebar');
        const rightPanel = document.getElementById('right-panel');
        ['mousedown', 'mousemove', 'mouseup', 'wheel', 'touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(eventType => {
            sidebar?.addEventListener(eventType, e => e.stopPropagation(), true);
            rightPanel?.addEventListener(eventType, e => e.stopPropagation(), true);
        });

        const viewportElement = document.getElementById('viewport');
        if (!viewportElement) return;

        viewportElement.addEventListener('mousedown', e => {
            if (isFormElement(e.target)) return;
            if (!viewportElement.contains(e.target)) return;

            e.preventDefault();

            drag.active = true;
            drag.x = e.clientX;
            drag.y = e.clientY;
            drag.mode = (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
            setViewportDragging(true);
        });

        viewportElement.addEventListener('touchstart', e => {
            if (isFormElement(e.target)) return;
            if (!viewportElement.contains(e.target)) return;

            if (e.touches.length === 1) {
                e.preventDefault();
                pinch.active = false;
                drag.active = true;
                drag.x = e.touches[0].clientX;
                drag.y = e.touches[0].clientY;
                drag.mode = 'orbit';
                setViewportDragging(true);
            } else if (e.touches.length === 2) {
                e.preventDefault();
                drag.active = false;
                pinch.active = true;
                pinch.startDist = getTouchPairDistance(e.touches);
                pinch.startCamDist = state.cam.dist;
                const center = getTouchPairCenter(e.touches);
                pinch.lastCenterX = center.x;
                pinch.lastCenterY = center.y;
                setViewportDragging(true);
            }
        }, { passive: false });

        document.addEventListener('mouseup', finishViewportDrag);

        document.addEventListener('mousemove', e => {
            if (!drag.active) return;
            if (isFormElement(e.target)) return;

            applyCameraDragDelta(e.clientX - drag.x, e.clientY - drag.y);
            drag.x = e.clientX;
            drag.y = e.clientY;
        });

        viewportElement.addEventListener('touchmove', e => {
            if (pinch.active && e.touches.length >= 2) {
                e.preventDefault();
                const center = getTouchPairCenter(e.touches);
                const dx = center.x - pinch.lastCenterX;
                const dy = center.y - pinch.lastCenterY;
                state.cam.panX += dx;
                state.cam.panY += dy;
                pinch.lastCenterX = center.x;
                pinch.lastCenterY = center.y;

                const dist = getTouchPairDistance(e.touches);
                if (pinch.startDist > 0) {
                    state.cam.dist = pinch.startCamDist * (pinch.startDist / dist);
                    clampCameraDistance();
                }
                requestRender();
                return;
            }

            if (!drag.active || e.touches.length !== 1) return;

            e.preventDefault();
            const touch = e.touches[0];
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            if (isFormElement(target)) return;

            applyCameraDragDelta(touch.clientX - drag.x, touch.clientY - drag.y);
            drag.x = touch.clientX;
            drag.y = touch.clientY;
        }, { passive: false });

        viewportElement.addEventListener('touchend', e => {
            if (e.touches.length === 0) {
                finishViewportDrag();
                return;
            }

            if (e.touches.length === 1 && pinch.active) {
                pinch.active = false;
                drag.active = true;
                drag.x = e.touches[0].clientX;
                drag.y = e.touches[0].clientY;
                drag.mode = 'orbit';
            }
        }, { passive: true });

        viewportElement.addEventListener('touchcancel', finishViewportDrag, { passive: true });

        viewportElement.onwheel = e => {
            e.preventDefault();
            state.cam.dist += e.deltaY * (state.cam.dist / 1000);
            clampCameraDistance();
            requestRender();
        };

        initSpaceMouse();

        viewportElement.oncontextmenu = e => {
            e.preventDefault();
            return false;
        };
    }


const _moduleExports = {
    drag,
    pinch,
    initViewportInput,
};

bridgeGlobals(_moduleExports, 'viewportInput');

export { drag, pinch, initViewportInput };
