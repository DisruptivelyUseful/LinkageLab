// ============================================================================
// LINKAGE LAB — Draws the chosen deployment drive in the 3D view
// A linear actuator / lead screw is a body cylinder plus a thinner rod, a cable
// is a line with a winch block at its fixed end; both get mount spheres and the
// first drive carries a "length · force" label. Rendered into
// threeRenderer.actuatorLineGroup (a sibling of structureGroup).
// Depends on globals: THREE, state, createMeasurementLine3D (optional)
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { threeRenderer, clearGroup } from './renderer-3d.js';
import { makeSlotTransforms } from './radial-array.js';
import { PLACEMENTS, evaluatePlacementOnData, normalizeActuation } from './actuation.js';
import { getActuationAnalysis, curveAt } from './actuation-ui.js';
import { formatInchesFraction } from '../core/unit-converter.js';

const COLORS = { body: 0x2f6fb3, rod: 0xd8dde3, cable: 0xf1c40f, winch: 0x444a52, mount: 0xe74c3c };
let _mats = null;
function mats() {
    if (_mats) return _mats;
    _mats = {
        body: new THREE.MeshStandardMaterial({ color: COLORS.body, metalness: 0.4, roughness: 0.5 }),
        rod: new THREE.MeshStandardMaterial({ color: COLORS.rod, metalness: 0.9, roughness: 0.25 }),
        winch: new THREE.MeshStandardMaterial({ color: COLORS.winch, metalness: 0.6, roughness: 0.5 }),
        mount: new THREE.MeshBasicMaterial({ color: COLORS.mount }),
        cable: new THREE.LineBasicMaterial({ color: COLORS.cable, linewidth: 2 }),
    };
    return _mats;
}

function cylinderBetween(a, b, radius, material) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return null;
    const geo = new THREE.CylinderGeometry(radius, radius, len, 12, 1);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
    mesh.castShadow = true;
    mesh.userData = { kind: 'drive' };
    return mesh;
}

function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }; }

function drawDrive(group, a, b, family, lenMin) {
    const m = mats();
    const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (family === 'cable') {
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z)]);
        group.add(new THREE.Line(geo, m.cable));
        const winch = new THREE.Mesh(new THREE.BoxGeometry(5, 3.5, 4), m.winch);
        winch.position.set(a.x, a.y + 1.75, a.z);
        winch.castShadow = true;
        group.add(winch);
    } else if (family === 'screw') {
        const rail = cylinderBetween(a, b, 0.9, m.rod);
        if (rail) group.add(rail);
        const body = cylinderBetween(a, lerp(a, b, Math.min(0.35, 10 / Math.max(L, 1))), 1.8, m.body);
        if (body) group.add(body);
    } else {
        // retracted body ≈ the shortest length the drive ever has, rod = the rest
        const bodyLen = Math.max(4, Math.min(L - 0.5, lenMin > 0 ? lenMin * 0.9 : L * 0.55));
        const split = lerp(a, b, bodyLen / L);
        const body = cylinderBetween(a, split, 1.6, m.body);
        const rod = cylinderBetween(split, b, 0.7, m.rod);
        if (body) group.add(body);
        if (rod) group.add(rod);
    }
    const s = new THREE.SphereGeometry(0.9, 10, 10);
    [a, b].forEach(p => { const sp = new THREE.Mesh(s, m.mount); sp.position.set(p.x, p.y, p.z); group.add(sp); });
}

/**
 * Renders the selected placement on every drive module (and every visible radial copy).
 * @param {Object} data - assembled geometry (post-shift; modulePivots included)
 * @param {{x,y,z}} sc - structure centre the scene is offset by
 */
function renderActuationDrive(data, sc) {
    const group = threeRenderer.actuatorLineGroup;
    if (!group) return;
    clearGroup(group);
    const a = state.actuation ? normalizeActuation(state.actuation) : null;
    if (!a || !a.enabled || a.show3D === false || state.orientation === 'vertical') return;
    if (!data || !data.modulePivots || !data.modulePivots.length) return;
    const pl = PLACEMENTS[a.placement];
    if (!pl) return;
    const track = data.floorTracks && data.floorTracks[0];
    const ends = evaluatePlacementOnData(a.placement, a.params, data, a.drives, { trackY: track ? track.centreY : undefined, groundY: 0 });
    if (!ends.length) return;
    const analysis = getActuationAnalysis(data);
    const sel = analysis && analysis.selected;
    const now = sel ? curveAt(sel, state.foldAngle) : null;
    const lenMin = sel ? sel.lenMin : 0;
    const off = (p) => ({ x: p.x - sc.x, y: p.y - sc.y, z: p.z - sc.z });

    // Every visible radial slot (slot transforms map base-structure points), base first
    const plan = data.radialArray;
    const slots = plan && plan.slots && plan.slots.length ? plan.slots.filter(s => !s.hidden) : [null];
    slots.forEach((slot, si) => {
        const xf = slot ? makeSlotTransforms(plan, slot) : null;
        const map = (p) => off(xf ? xf.point(p) : p);
        ends.forEach((e, ei) => {
            const pa = map(e.a), pb = map(e.b);
            drawDrive(group, pa, pb, pl.family, lenMin);
            if (si === 0 && ei === 0 && typeof globalThis.createMeasurementLine3D === 'function') {
                const label = now ? `${formatInchesFraction(now.length, 8)} · ${Math.round(now.force)} lb ${now.sense}` : formatInchesFraction(e.length, 8);
                globalThis.createMeasurementLine3D(pa, pb, label, COLORS.cable, group, { markerRadius: 0.3, labelScale: 30, labelLift: 6 });
            }
        });
    });
    group.position.set(sc.x, sc.y, sc.z);
    group.rotation.y = (state.structureRotation || 0) * Math.PI / 180;
}

const _moduleExports = { renderActuationDrive };
bridgeGlobals(_moduleExports, 'actuationRender');
export { renderActuationDrive };
