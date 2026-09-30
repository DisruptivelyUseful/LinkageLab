// ============================================================================
// LINKAGE LAB - Part view interaction (ES module)
//
// Picking, hover, drag-to-place (with push-stacking and snap), keyboard nudge
// and the on-canvas overlays (snap ring, drag-axis arrows, readout chip) for
// the embedded hardware part view. The placement maths lives in the pure
// modules hw-stack-layout.js and hw-snap.js; this file only turns pointer and
// key events into those calls and commits the result to the assembly.
//
// A drag never mutates state until pointer-up: positions go to a preview
// (hwDetail.preview) that the layout adapter reads, and only the focused
// instance is rebuilt per move. The commit on release is one history step.
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { HW_KIND } from './hw-stack-layout.js';
import { axisBodiesFromStack, computePush, seatPush, collectSnapTargets, snapStart } from './hw-snap.js';
import { showToast } from '../core/feedback.js';
import {
    hwDetail,
    HW_AXIS_DIRS,
    HW_AXIS_CROSS,
    HW_HORIZONTAL_AXES,
    hwComputeAxisLayout,
    hwAxisSnapContext,
    hwCommitAxisPositions,
    hwGetAssemblyById,
    getActiveHardwareAssembly,
    hwGetBracketHoleY,
    hwExplodeFactor,
    buildHardwareAssemblyGroup,
    hwPersistHardwareConfig,
    hwRemovePart,
    hwTightenAssembly,
    hwRecenterDetailView,
} from './hardware-detail.js';
import { renderHardwareEditPanel } from './hw-detail-panel.js';

/** Snap reach on screen (pixels), converted to inches along the drag axis. */
const HW_SNAP_PX = 10;
/** Seat detent (pushed parts resting on a beam face) holds this many times the snap reach. */
const HW_SEAT_REACH_MUL = 3;
/** Pointer travel (pixels) before a press on a part becomes a drag. */
const HW_DRAG_THRESHOLD_PX = 3;
/** Keyboard nudge steps (inches). */
const HW_NUDGE = { base: 1 / 16, coarse: 1 / 4, fine: 1 / 64 };
const HW_EXPLODE_COLLAPSE_MS = 160;

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** The assembly drawn in part view (build playback can focus a non-active one). */
function hwFocusAssembly() {
    return (hwDetail.focusAssemblyId && hwGetAssemblyById(hwDetail.focusAssemblyId)) || getActiveHardwareAssembly();
}

function hwFindPart(assembly, partId) {
    return (assembly && assembly.parts && assembly.parts.find(p => p.id === partId)) || null;
}

function hwIsDraggablePart(part) {
    return !!part && part.type !== 'bracket' && part.type !== 'beam';
}

function hwSnapEnabled(e) {
    const on = !state.hardwareAssemblies || state.hardwareAssemblies.snap !== false;
    return (e && e.altKey) ? !on : on;
}

function hwCanvas() {
    return document.getElementById('canvas-webgl');
}

function hwCamera() {
    return (typeof threeRenderer !== 'undefined' && threeRenderer.mainCamera) ? threeRenderer.mainCamera : null;
}

function hwGetFocusAssemblyGroup() {
    if (!hwDetail.focusGroupUuid || typeof THREE === 'undefined') return null;
    if (typeof threeRenderer === 'undefined' || !threeRenderer.hardwareAssemblyGroup) return null;
    return threeRenderer.hardwareAssemblyGroup.children.find(obj => obj.uuid === hwDetail.focusGroupUuid) || null;
}

function hwEnsureRaycaster() {
    if (!hwDetail.raycaster && typeof THREE !== 'undefined') {
        hwDetail.raycaster = new THREE.Raycaster();
        hwDetail.pointer = new THREE.Vector2();
    }
    return !!hwDetail.raycaster;
}

function hwSetRayFromEvent(e) {
    const canvas = hwCanvas();
    const camera = hwCamera();
    if (!hwEnsureRaycaster() || !canvas || !camera) return false;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    hwDetail.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    hwDetail.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    hwDetail.raycaster.setFromCamera(hwDetail.pointer, camera);
    return true;
}

/**
 * Part under the pointer in the focused instance: { partId, renderAxisKey }.
 * renderAxisKey is the axis the mesh was drawn on, which differs from the
 * part's own axis on a virtual mirror (left drawn from right parts).
 */
function hwPickPart(e) {
    const group = hwGetFocusAssemblyGroup();
    if (!group || !hwSetRayFromEvent(e)) return null;
    const hits = hwDetail.raycaster.intersectObjects(group.children, true);
    for (let i = 0; i < hits.length; i++) {
        let node = hits[i].object;
        if (node.userData && node.userData.hwOverlay) continue;
        let partId = null;
        let renderAxisKey = null;
        while (node && node !== group) {
            if (!partId && node.userData && node.userData.partId) partId = node.userData.partId;
            if (node.userData && node.userData.build) { renderAxisKey = node.userData.build.renderAxisKey; break; }
            node = node.parent;
        }
        if (partId) return { partId, renderAxisKey };
    }
    return null;
}

// ---------------------------------------------------------------------------
// Drag context: 1-D axis frame in the focus group's local space
// ---------------------------------------------------------------------------

function hwAxisFrame(assembly, part, renderAxisKey) {
    const renderAxis = renderAxisKey || part.axis || 'right';
    const d = HW_AXIS_DIRS[renderAxis] || HW_AXIS_DIRS.right;
    const c = HW_AXIS_CROSS[renderAxis] || HW_AXIS_CROSS.right;
    const dirVec = new THREE.Vector3(d.x, d.y, d.z).normalize();
    const crossVec = new THREE.Vector3(c.x, c.y, c.z).normalize();
    let crossPos = part.crossOffset || 0;
    const bracketPart = assembly.parts.find(p => p.type === 'bracket');
    // Same rule as the mesh layout: horizontal render axes sit at the bracket hole height
    if (bracketPart && HW_HORIZONTAL_AXES.includes(renderAxis)) crossPos += hwGetBracketHoleY(bracketPart);
    return { renderAxis, dirVec, crossVec, crossPos };
}

/** Build the per-drag snapshot: bodies, mover, snap targets, frame. */
function hwBeginPlacement(assembly, part, renderAxisKey) {
    const axisKey = part.axis || 'right';
    const layout = hwComputeAxisLayout(assembly, axisKey);
    const bodies = axisBodiesFromStack(layout.stack);
    const mover = bodies.find(b => b.id === part.id);
    if (!mover) return null;
    const tight = hwComputeAxisLayout(assembly, axisKey, { tight: true });
    const homeItem = tight.items.find(it => it.part.id === part.id && (it.copyIndex || 0) === 0);
    const snapCtx = hwAxisSnapContext(assembly, axisKey, layout);
    const targets = collectSnapTargets(bodies, part.id, { ...snapCtx, home: homeItem ? homeItem.baseStart : null });
    return {
        assemblyId: assembly.id,
        partId: part.id,
        axisKey,
        datum: layout.datum,
        bodies,
        mover,
        targets,
        frame: hwAxisFrame(assembly, part, renderAxisKey),
        grabOffset: null,
        pxPerInch: null,
        result: null,
    };
}

/** Axis coordinate (inches, group-local) under the pointer, on a camera-facing plane through the part. */
function hwProjectToAxis(e, ctx) {
    const group = hwGetFocusAssemblyGroup();
    const camera = hwCamera();
    if (!group || !camera || !hwSetRayFromEvent(e)) return null;
    group.updateWorldMatrix(true, false);
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const ray = hwDetail.raycaster.ray.clone().applyMatrix4(inv);
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    camDir.transformDirection(inv).normalize();
    const { dirVec, crossVec, crossPos } = ctx.frame;
    let normal = new THREE.Vector3().crossVectors(dirVec, camDir).cross(dirVec);
    if (normal.lengthSq() < 1e-8) normal = crossVec.clone();
    normal.normalize();
    const center = ctx.mover.start + ctx.mover.len / 2;
    const anchor = dirVec.clone().multiplyScalar(center).addScaledVector(crossVec, crossPos);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, anchor);
    const hit = new THREE.Vector3();
    if (!ray.intersectPlane(plane, hit)) return null;
    return hit.dot(dirVec);
}

/** Screen pixels per inch along the drag axis at the part (for a pixel-sized snap reach). */
function hwPixelsPerInch(ctx) {
    const group = hwGetFocusAssemblyGroup();
    const camera = hwCamera();
    const canvas = hwCanvas();
    if (!group || !camera || !canvas) return 40;
    const rect = canvas.getBoundingClientRect();
    const { dirVec, crossVec, crossPos } = ctx.frame;
    const center = ctx.mover.start + ctx.mover.len / 2;
    const a = dirVec.clone().multiplyScalar(center).addScaledVector(crossVec, crossPos).applyMatrix4(group.matrixWorld).project(camera);
    const b = dirVec.clone().multiplyScalar(center + 1).addScaledVector(crossVec, crossPos).applyMatrix4(group.matrixWorld).project(camera);
    const dx = (b.x - a.x) * rect.width / 2;
    const dy = (b.y - a.y) * rect.height / 2;
    return Math.max(1, Math.hypot(dx, dy));
}

/**
 * Resolve a desired mover start into final positions (snap → push) and put
 * them in the preview. Returns { start, snap, moved:Map }.
 */
function hwApplyPlacement(ctx, desiredStart, { snap = true, push = true } = {}) {
    let start = desiredStart;
    let snapRes = null;
    let seat = null;
    if (snap) {
        if (ctx.pxPerInch == null) ctx.pxPerInch = hwPixelsPerInch(ctx);
        const reach = Math.min(0.75, Math.max(0.01, HW_SNAP_PX / ctx.pxPerInch));
        snapRes = snapStart(ctx.mover, desiredStart, ctx.targets, reach);
        start = snapRes.start;
        if (push) {
            const seated = seatPush(ctx.bodies, ctx.mover.id, start, ctx.targets, reach * HW_SEAT_REACH_MUL);
            if (seated.seat) { start = seated.start; seat = seated.seat; }
        }
    }
    const moved = computePush(ctx.bodies, ctx.mover.id, start, { push });
    const pos = new Map();
    ctx.bodies.forEach(b => pos.set(b.id, (moved.has(b.id) ? moved.get(b.id) : b.start) - ctx.datum));
    hwDetail.preview = { assemblyId: ctx.assemblyId, axisKey: ctx.axisKey, pos };
    const snapHit = seat ? { target: seat } : (snapRes && snapRes.target ? snapRes : null);
    ctx.result = { start, snap: snapHit, seated: !!seat, pushed: Math.max(0, moved.size - 1) };
    return ctx.result;
}

function hwCommitPlacement(ctx) {
    const pv = hwDetail.preview;
    hwDetail.preview = null;
    const assembly = hwGetAssemblyById(ctx.assemblyId);
    if (!assembly || !pv) return;
    hwCommitAxisPositions(assembly, ctx.axisKey, pv.pos);
    hwAfterPlacementCommit();
}

function hwAfterPlacementCommit() {
    renderHardwareEditPanel();
    hwPersistHardwareConfig();
    if (typeof hwUpdateStructureSpacingUI === 'function') hwUpdateStructureSpacingUI();
    if (typeof updateHUD === 'function') { try { updateHUD(); } catch (err) {} }
    if (typeof saveStateToHistory === 'function') saveStateToHistory();
    if (typeof requestRender === 'function') requestRender();
}

// ---------------------------------------------------------------------------
// Rendering: rebuild only the focused instance, then decorate it
// ---------------------------------------------------------------------------

function hwOverlayMaterial(key, make) {
    return typeof getCachedMaterial === 'function' ? getCachedMaterial(key, make) : make();
}

/** Rebuild the focused instance in place (no solver, no full scene rebuild). */
function hwRefreshFocusInstance() {
    const group = hwGetFocusAssemblyGroup();
    const assembly = hwFocusAssembly();
    if (!group || !assembly || typeof buildHardwareAssemblyGroup !== 'function') {
        if (typeof requestRender === 'function') requestRender();
        return;
    }
    const fresh = buildHardwareAssemblyGroup(assembly, {
        explode: hwExplodeFactor(),
        syncFromState: true,
        excludeBeams: true,
        selectedPartId: hwDetail.selectedPartId,
    });
    if (typeof clearGroup === 'function') clearGroup(group);
    else while (group.children.length) group.remove(group.children[0]);
    const shadows = !!state.shadowsEnabled;
    while (fresh.children.length) {
        const ch = fresh.children[0];
        ch.traverse(m => { if (m.isMesh) { m.castShadow = shadows; m.receiveShadow = shadows; } });
        group.add(ch);
    }
    hwDecorateFocusInstance(group);
    if (typeof renderFrameOnly !== 'function' || !renderFrameOnly()) {
        if (typeof requestRender === 'function') requestRender();
    }
}

function hwPartMeshes(group, partId) {
    const out = [];
    group.traverse(ch => { if (ch.isMesh && ch.userData.partId === partId && !ch.userData.hwOverlay) out.push(ch); });
    return out;
}

/** Hover tint (skips the selected part, which already carries the selection material). */
function hwApplyHover(group) {
    const hoverMat = () => hwOverlayMaterial('hw_hover', () => new THREE.MeshStandardMaterial({ color: 0x9fd8ff, metalness: 0.45, roughness: 0.35, emissive: 0x0e3350 }));
    group.traverse(ch => {
        if (!ch.isMesh || !ch.userData._hwHoverOrig) return;
        ch.material = ch.userData._hwHoverOrig;
        delete ch.userData._hwHoverOrig;
    });
    const id = hwDetail.hoverPartId;
    if (!id || id === hwDetail.selectedPartId || hwDetail.drag) return;
    hwPartMeshes(group, id).forEach(m => {
        m.userData._hwHoverOrig = m.material;
        m.material = hoverMat();
    });
}

function hwMakeRing(radius, color, opacity) {
    const geo = new THREE.RingGeometry(radius * 0.82, radius, 48);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
    const ring = new THREE.Mesh(geo, mat);
    ring.renderOrder = 999;
    ring.userData.hwOverlay = true;
    return ring;
}

function hwOrientToAxis(obj, dirVec) {
    obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dirVec);
}

/** Snap ring during a drag; axis arrows on the selected part. */
function hwAddOverlays(group) {
    const drag = hwDetail.drag;
    if (drag && drag.ctx && drag.ctx.result && drag.ctx.result.snap) {
        const { frame } = drag.ctx;
        const t = drag.ctx.result.snap.target;
        const ring = hwMakeRing(1.35, t.kind === 'gap' ? 0x6ee7a8 : 0x4fc3ff, 0.75);
        ring.position.copy(frame.dirVec.clone().multiplyScalar(t.pos).addScaledVector(frame.crossVec, frame.crossPos));
        hwOrientToAxis(ring, frame.dirVec);
        group.add(ring);
    }
    const selId = hwDetail.selectedPartId;
    const assembly = hwFocusAssembly();
    const part = hwFindPart(assembly, selId);
    if (!hwIsDraggablePart(part) || (state.buildPlayback && state.buildPlayback.active)) return;
    const meshes = [];
    group.children.forEach(ch => { if (ch.userData && ch.userData.partId === selId && ch.userData.build) meshes.push(ch); });
    meshes.slice(0, 2).forEach(root => {
        const b = root.userData.build;
        const dir = new THREE.Vector3(b.axis.x, b.axis.y, b.axis.z).normalize();
        const len = Math.max(1.25, (b.len || 0.5) / 2 + 1.1);
        const color = 0xffb347;
        [1, -1].forEach(sign => {
            const d = dir.clone().multiplyScalar(sign);
            const arrow = new THREE.ArrowHelper(d, root.position.clone(), len, color, 0.35, 0.22);
            arrow.traverse(o => {
                o.userData.hwOverlay = true;
                if (o.material) { o.material.depthTest = false; o.material.transparent = true; o.material.opacity = 0.85; }
                o.renderOrder = 998;
            });
            arrow.userData.hwOverlay = true;
            group.add(arrow);
        });
    });
}

/** Called by scene-render after the focused instance is built, and after in-place refreshes. */
function hwDecorateFocusInstance(group) {
    if (!group || typeof THREE === 'undefined') return;
    try {
        hwApplyHover(group);
        hwAddOverlays(group);
    } catch (err) {
        console.warn('Part view overlay failed:', err);
    }
}

// ---------------------------------------------------------------------------
// Readout chip (DOM, follows the pointer during a drag)
// ---------------------------------------------------------------------------

function hwReadoutEl() {
    let el = document.getElementById('hw-drag-readout');
    const host = document.querySelector('#hardware-detail-modal .hw-viewport');
    if (!host) return null;
    if (!el) {
        el = document.createElement('div');
        el.id = 'hw-drag-readout';
        el.className = 'hw-drag-readout';
        el.setAttribute('role', 'status');
        host.appendChild(el);
    } else if (el.parentElement !== host) {
        host.appendChild(el);
    }
    return el;
}

function hwShowReadout(e, ctx) {
    const el = hwReadoutEl();
    if (!el || !ctx || !ctx.result) return;
    const part = hwFindPart(hwGetAssemblyById(ctx.assemblyId), ctx.partId);
    const bits = [`<b>${hwEscape((part && part.label) || 'Part')}</b>`];
    if (ctx.mover.kind === HW_KIND.BOLT) {
        // A bolt is placed by its head: report where the head underside sits
        const under = ctx.mover.headOutside ? ctx.mover.contact[0] : ctx.mover.contact[1];
        bits.push(`head at ${(ctx.result.start + under - ctx.datum).toFixed(3)} in`);
    } else {
        bits.push(`${(ctx.result.start - ctx.datum).toFixed(3)} in from datum`);
    }
    if (ctx.result.snap) bits.push(`${ctx.result.seated ? 'seated on' : '⇥'} ${hwEscape(ctx.result.snap.target.label)}`);
    if (ctx.result.pushed) bits.push(`pushing ${ctx.result.pushed}`);
    el.innerHTML = bits.join(' · ');
    const host = el.parentElement.getBoundingClientRect();
    el.style.left = `${Math.min(host.width - 12, e.clientX - host.left + 16)}px`;
    el.style.top = `${Math.max(4, e.clientY - host.top + 16)}px`;
    el.classList.add('visible');
}

function hwEscape(str) {
    return String(str).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function hwHideReadout() {
    const el = document.getElementById('hw-drag-readout');
    if (el) el.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Explode collapse (dragging needs the seated view)
// ---------------------------------------------------------------------------

function hwSyncExplodeUI() {
    const v = Math.round((state.hardwareAssemblies.explode || 0) * 100);
    const sl = document.getElementById('hw-explode-slider');
    if (sl) sl.value = String(v);
    const lbl = document.getElementById('hw-explode-value');
    if (lbl) lbl.textContent = v + '%';
}

function hwCollapseExplode() {
    if (hwDetail.collapsing) return;
    const from = state.hardwareAssemblies.explode || 0;
    if (from <= 0) return;
    hwDetail.collapsing = true;
    const t0 = performance.now();
    const step = (now) => {
        const k = Math.min(1, (now - t0) / HW_EXPLODE_COLLAPSE_MS);
        state.hardwareAssemblies.explode = from * (1 - k * k * (3 - 2 * k));
        if (k >= 1) state.hardwareAssemblies.explode = 0;
        hwSyncExplodeUI();
        hwRefreshFocusInstance();
        if (k < 1) requestAnimationFrame(step);
        else {
            hwDetail.collapsing = false;
            hwDetail.needsRefit = true;
            hwPersistHardwareConfig();
            if (typeof requestRender === 'function') requestRender();
        }
    };
    requestAnimationFrame(step);
}

// ---------------------------------------------------------------------------
// Pointer handlers
// ---------------------------------------------------------------------------

function hwSetCursor(kind) {
    const canvas = hwCanvas();
    if (canvas) canvas.style.cursor = kind || '';
}

function hwSelectPart(partId, { scroll = true } = {}) {
    if (hwDetail.selectedPartId === partId) return;
    hwDetail.selectedPartId = partId;
    renderHardwareEditPanel();
    hwRefreshFocusInstance();
    if (scroll && partId) {
        const card = document.querySelector('.hw-part-card.selected');
        if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function hwDetailPointerDown(e) {
    if (e.button !== 0 || !state.hwDetailMode) return;
    const canvas = hwCanvas();
    if (!canvas || e.target !== canvas) return;
    const hit = hwPickPart(e);
    hwDetail.pointerDown = { x: e.clientX, y: e.clientY, partId: hit ? hit.partId : null, moved: false };
    if (!hit) return;
    const assembly = hwFocusAssembly();
    const part = hwFindPart(assembly, hit.partId);
    if (!hwIsDraggablePart(part)) return;
    // Parts are selectable but not movable while build playback drives the view
    if (state.buildPlayback && state.buildPlayback.active) return;
    e.stopPropagation();
    hwDetail.dragPartId = part.id;
    hwDetail.drag = { renderAxisKey: hit.renderAxisKey, ctx: null };
    canvas.setPointerCapture(e.pointerId);
    if (hwExplodeFactor() > 0) hwCollapseExplode();
}

function hwDetailPointerMove(e) {
    const pd = hwDetail.pointerDown;
    if (pd && !pd.moved && (Math.abs(e.clientX - pd.x) > HW_DRAG_THRESHOLD_PX || Math.abs(e.clientY - pd.y) > HW_DRAG_THRESHOLD_PX)) pd.moved = true;
    if (!hwDetail.dragPartId || !hwDetail.drag) {
        if (!e.buttons) hwQueueHover(e);
        return;
    }
    if (!pd || !pd.moved || hwDetail.collapsing) return;
    e.stopPropagation();
    const assembly = hwFocusAssembly();
    const part = hwFindPart(assembly, hwDetail.dragPartId);
    if (!part) return;
    const drag = hwDetail.drag;
    if (!drag.ctx) {
        drag.ctx = hwBeginPlacement(assembly, part, drag.renderAxisKey);
        if (!drag.ctx) return;
        hwSetCursor('grabbing');
    }
    const ctx = drag.ctx;
    const p = hwProjectToAxis(e, ctx);
    if (p == null) return;
    if (ctx.grabOffset == null) ctx.grabOffset = p - ctx.mover.start;
    hwApplyPlacement(ctx, p - ctx.grabOffset, { snap: hwSnapEnabled(e), push: !(e.ctrlKey || e.metaKey) });
    hwRefreshFocusInstance();
    hwShowReadout(e, ctx);
}

function hwDetailPointerUp(e) {
    const pd = hwDetail.pointerDown;
    const canvas = hwCanvas();
    const drag = hwDetail.drag;
    if (drag && drag.ctx && hwDetail.preview) {
        hwCommitPlacement(drag.ctx);
    } else if (pd && !pd.moved) {
        // Click: select the part, or clear the selection on empty space
        hwSelectPart(pd.partId || null);
    }
    hwDetail.dragPartId = null;
    hwDetail.drag = null;
    hwDetail.preview = null;
    hwDetail.pointerDown = null;
    hwHideReadout();
    hwSetCursor(hwDetail.hoverPartId ? 'grab' : '');
    if (canvas && e && e.pointerId != null && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
}

let hwHoverFrame = 0;
let hwHoverEvent = null;
function hwQueueHover(e) {
    hwHoverEvent = e;
    if (hwHoverFrame) return;
    hwHoverFrame = requestAnimationFrame(() => {
        hwHoverFrame = 0;
        const ev = hwHoverEvent;
        hwHoverEvent = null;
        if (!ev || !state.hwDetailMode) return;
        const hit = hwPickPart(ev);
        const part = hit ? hwFindPart(hwFocusAssembly(), hit.partId) : null;
        const id = part ? part.id : null;
        hwSetCursor(hwIsDraggablePart(part) && !(state.buildPlayback && state.buildPlayback.active) ? 'grab' : (part ? 'pointer' : ''));
        if (id === hwDetail.hoverPartId) return;
        hwDetail.hoverPartId = id;
        const group = hwGetFocusAssemblyGroup();
        if (group) {
            hwApplyHover(group);
            if (typeof renderFrameOnly !== 'function' || !renderFrameOnly()) requestRender();
        }
    });
}

function hwDetailPointerLeave() {
    if (hwDetail.drag) return;
    if (hwDetail.hoverPartId) {
        hwDetail.hoverPartId = null;
        const group = hwGetFocusAssemblyGroup();
        if (group) { hwApplyHover(group); if (typeof renderFrameOnly === 'function') renderFrameOnly(); }
    }
    hwSetCursor('');
}

// ---------------------------------------------------------------------------
// Keyboard: nudge, deselect, delete, snap, recenter, tighten
// ---------------------------------------------------------------------------

/** Move the selected part by `delta` inches along its axis (push rules apply). */
function hwNudgeSelected(delta, { push = true } = {}) {
    const assembly = hwFocusAssembly();
    const part = hwFindPart(assembly, hwDetail.selectedPartId);
    if (!hwIsDraggablePart(part)) return false;
    const ctx = hwBeginPlacement(assembly, part, null);
    if (!ctx) return false;
    hwApplyPlacement(ctx, ctx.mover.start + delta, { snap: false, push });
    hwCommitPlacement(ctx);
    return true;
}

function hwToggleSnap(force) {
    const ha = state.hardwareAssemblies;
    if (!ha) return;
    ha.snap = typeof force === 'boolean' ? force : ha.snap === false;
    hwSyncSnapButton();
    hwPersistHardwareConfig();
}

function hwSyncSnapButton() {
    const btn = document.getElementById('hw-btn-snap');
    if (!btn) return;
    const on = !state.hardwareAssemblies || state.hardwareAssemblies.snap !== false;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('active', on);
    btn.textContent = on ? 'Snap: On' : 'Snap: Off';
}

function hwIsTypingTarget(t) {
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

function hwHandleDetailKey(e) {
    if (!state.hwDetailMode || hwIsTypingTarget(e.target)) return;
    if (e.ctrlKey || e.metaKey) {
        // Ctrl+arrow = nudge without pushing
        if (!e.key.startsWith('Arrow')) return;
    }
    const k = e.key;
    if (k.startsWith('Arrow')) {
        if (!hwDetail.selectedPartId) return;
        const step = e.shiftKey ? HW_NUDGE.coarse : (e.altKey ? HW_NUDGE.fine : HW_NUDGE.base);
        const sign = (k === 'ArrowRight' || k === 'ArrowUp') ? 1 : -1;
        if (hwNudgeSelected(sign * step, { push: !(e.ctrlKey || e.metaKey) })) e.preventDefault();
        return;
    }
    if (e.altKey) return;
    const lower = k.toLowerCase();
    if (k === 'Escape') {
        if (hwDetail.selectedPartId) { e.preventDefault(); e.stopPropagation(); hwSelectPart(null, { scroll: false }); }
    } else if (k === 'Delete' || k === 'Backspace') {
        const part = hwFindPart(hwFocusAssembly(), hwDetail.selectedPartId);
        if (part && part.type !== 'bracket' && hwFocusAssembly() === getActiveHardwareAssembly()) {
            e.preventDefault();
            hwRemovePart(part.id);
            if (typeof showToast === 'function') showToast(`Removed ${part.label || part.type} (Ctrl+Z to undo)`, 'info');
        }
    } else if (lower === 's') {
        e.preventDefault();
        hwToggleSnap();
        if (typeof showToast === 'function') showToast(state.hardwareAssemblies.snap !== false ? 'Snap on (hold Alt to bypass)' : 'Snap off (hold Alt to snap)', 'info');
    } else if (lower === 'r') {
        e.preventDefault();
        hwRecenterDetailView();
    } else if (lower === 't') {
        e.preventDefault();
        document.getElementById('hw-btn-tighten')?.click();
    }
}

function hwWireEmbeddedDetailInteraction() {
    if (hwDetail.embeddedInteractionWired) return;
    const canvas = hwCanvas();
    if (!canvas) return;
    hwEnsureRaycaster();
    canvas.addEventListener('pointerdown', hwDetailPointerDown);
    canvas.addEventListener('pointermove', hwDetailPointerMove);
    canvas.addEventListener('pointerup', hwDetailPointerUp);
    canvas.addEventListener('pointercancel', hwDetailPointerUp);
    canvas.addEventListener('pointerleave', hwDetailPointerLeave);
    document.addEventListener('keydown', hwHandleDetailKey);
    hwDetail.embeddedInteractionWired = true;
}

/** Tighten one axis (from the axis header in the panel). */
function hwTightenAxis(axisKey) {
    const assembly = getActiveHardwareAssembly();
    if (!assembly) return 0;
    const n = hwTightenAssembly(assembly, axisKey);
    hwAfterPlacementCommit();
    return n;
}

const _moduleExports = {
    hwPickPart,
    hwBeginPlacement,
    hwApplyPlacement,
    hwCommitPlacement,
    hwNudgeSelected,
    hwToggleSnap,
    hwSyncSnapButton,
    hwTightenAxis,
    hwRefreshFocusInstance,
    hwDecorateFocusInstance,
    hwWireEmbeddedDetailInteraction,
    hwHandleDetailKey,
    hwFocusAssembly,
};

bridgeGlobals(_moduleExports, 'hwDetailInteraction');

export {
    hwPickPart,
    hwBeginPlacement,
    hwApplyPlacement,
    hwCommitPlacement,
    hwNudgeSelected,
    hwToggleSnap,
    hwSyncSnapButton,
    hwTightenAxis,
    hwRefreshFocusInstance,
    hwDecorateFocusInstance,
    hwWireEmbeddedDetailInteraction,
    hwHandleDetailKey,
    hwFocusAssembly,
};
