// ============================================================================ (ES module)
//
// Build Steps — operation drivers.
//
// Registers the per-kind animations with the playback engine:
//   place  — parts travel in along an approach vector and fade to solid
//   cut    — workbench: a spinning circular saw crosses the stock at the cut
//            line leaving a kerf, then the offcut separates
//   drill  — workbench: a drill bit plunges and retracts at each hole; the
//            hole appears as the bit comes out
//   fasten — bolts and nuts (build-steps-fasten.js)
//
// The workbench (threeRenderer.benchGroup) shows one representative beam per
// group of identical beams, laid flat on a bench plane at the origin along +X
// with the width across Z and the thickness up Y. Beams whose real holes run
// through the width are laid on their side so every hole is drilled straight
// down.

import { bridgeGlobals } from './global-bridge.js';
import { state } from './app-state.js';
import { threeRenderer, getCachedMaterial, getCachedGeometry, createBeamMesh, getBeamBoltIntersections, buildBeamMeshWithHoles, clearGroup } from './renderer-3d.js';
import { Beam3D } from './geometry-classes.js';
import { WOOD_COLOR } from './constants.js';
import { clamp } from './math.js';
import { buildLinkageGeometry } from './linkage-geometry.js';
import { easeInOutCubic, groupBeamsForBench, planBench, benchSummary, dedupeHoles } from './build-steps.js';
import { registerOpDriver, forEachPartMesh } from './build-steps-anim.js';

// ---------------------------------------------------------------------------
// Workbench scene
// ---------------------------------------------------------------------------

function getBenchGroup() {
    if (!threeRenderer.benchGroup) {
        if (!threeRenderer.mainScene || typeof THREE === 'undefined') return null;
        threeRenderer.benchGroup = new THREE.Group();
        threeRenderer.benchGroup.name = 'benchGroup';
        threeRenderer.benchGroup.visible = false;
        threeRenderer.mainScene.add(threeRenderer.benchGroup);
    }
    return threeRenderer.benchGroup;
}

const mat = {
    plane: () => getCachedMaterial('bench_plane', () => new THREE.MeshLambertMaterial({ color: 0x3b3f46 })),
    kerf: () => getCachedMaterial('bench_kerf', () => new THREE.MeshLambertMaterial({ color: 0x1a1208 })),
    steel: () => getCachedMaterial('tool_steel', () => new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.85, roughness: 0.35 })),
    dark: () => getCachedMaterial('tool_dark', () => new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.4, roughness: 0.6 })),
    guard: () => getCachedMaterial('tool_guard', () => new THREE.MeshLambertMaterial({ color: 0xe8792b })),
    body: () => getCachedMaterial('tool_body', () => new THREE.MeshLambertMaterial({ color: 0x2f7fc1 })),
};

/** A synthetic beam lying along +X on the bench (width across Z, thickness up Y). */
function makeBenchBeam(x0, length, y, z, w, t, rep) {
    return new Beam3D({ x: x0, y, z }, { x: x0 + length, y, z }, w, t, (rep && rep.colorBase) || WOOD_COLOR, {
        moduleIndex: rep ? rep.moduleIndex : -1,
        stackType: rep ? rep.stackType : 'unknown',
        stackId: rep ? rep.stackId : -1,
        patternId: rep ? rep.patternId : null,
        layerIndex: rep ? rep.layerIndex : 0,
    });
}

function makeBenchBeamMesh(beam, holes) {
    const plain = createBeamMesh(beam, false, null);
    if (holes && holes.length) {
        const drilled = buildBeamMeshWithHoles(beam, holes, plain.material);
        if (drilled) {
            drilled.userData.beam = beam;
            drilled.userData.type = 'beam';
            drilled.userData.bench = true;
            drilled.castShadow = state.shadowsEnabled || false;
            return drilled;
        }
    }
    plain.userData.bench = true;
    return plain;
}

/**
 * Bolts only exist in the solved geometry when "Bolts" is shown, and Full
 * Detail hardware replaces the pivot bolts with placements. Drill steps need
 * every hole, so solve once with the legacy bolts forced on (uncached, state
 * restored afterwards) and cache the result per geometry data object.
 */
function boltsForDrilling(ctx) {
    if (ctx.scratch.drillBolts && ctx.scratch.drillBoltsFor === ctx.data) return ctx.scratch.drillBolts;
    const prev = { bolts: state.showBolts, full: state.showHardwareFullDetail, mode: state.hwDetailMode };
    let bolts = [];
    try {
        state.showBolts = true;
        state.showHardwareFullDetail = false;
        state.hwDetailMode = false;
        const solved = buildLinkageGeometry({ useCache: false, includePanels: false });
        bolts = solved.bolts || [];
    } catch (e) {
        console.warn('[BuildSteps] could not solve bolts for drilling:', e);
    } finally {
        state.showBolts = prev.bolts;
        state.showHardwareFullDetail = prev.full;
        state.hwDetailMode = prev.mode;
    }
    ctx.scratch.drillBolts = bolts;
    ctx.scratch.drillBoltsFor = ctx.data;
    return bolts;
}

/**
 * Real hole pattern of a group's representative beam, mapped onto a bench
 * beam so that every hole is vertical ('T'). Returns the laid-out dimensions
 * and the mapped holes sorted along the length.
 */
function benchHolesFor(rep, bolts) {
    const real = dedupeHoles(getBeamBoltIntersections(rep, bolts || []));
    const wCount = real.filter(h => h.through === 'W').length;
    const tCount = real.filter(h => h.through === 'T').length;
    const onSide = wCount > tCount; // lay the beam on its side so W holes point up
    const holes = real
        .filter(h => (onSide ? h.through === 'W' : h.through === 'T'))
        .map(h => ({ posL: h.posL, posW: onSide ? h.posT : h.posW, posT: onSide ? h.posW : h.posT, radius: h.radius, through: 'T' }))
        .sort((a, b) => a.posL - b.posL);
    return { onSide, holes, laidW: onSide ? rep.t : rep.w, laidT: onSide ? rep.w : rep.t };
}

/**
 * Rebuilds the workbench for a bench-stage step.
 * @param {Object} ctx - op context
 * @param {{stock:boolean, drilled:boolean}} opts
 */
function buildBench(ctx, opts) {
    const group = getBenchGroup();
    if (!group) return null;
    clearGroup(group);
    const beams = ctx.targets.filter(r => r.kind === 'beam').map(r => r.obj);
    const groups = groupBeamsForBench(beams);
    const stockLengthIn = ctx.step.op && ctx.step.op.stockLengthIn;
    const kerf = Math.max(0.03, Number(ctx.step.op && ctx.step.op.kerfIn) || 0.125);

    // Orientation per group (drill steps lay W-drilled beams on their side)
    const bolts = opts.drilled ? boltsForDrilling(ctx) : [];
    const oriented = groups.map(g => {
        const info = opts.drilled ? benchHolesFor(g.rep, bolts) : { onSide: false, holes: [], laidW: g.w, laidT: g.t };
        return { ...g, w: info.laidW, t: info.laidT, holes: info.holes, onSide: info.onSide };
    });
    const plan = planBench(oriented, { stock: !!opts.stock, stockLengthIn });
    const rows = [];
    if (!plan.items.length) {
        group.visible = false;
        ctx.scratch.bench = { plan, groups, rows, stock: !!opts.stock };
        if (state.buildPlayback) state.buildPlayback.benchSummary = '';
        return null;
    }

    const pl = plan.plane;
    const plane = new THREE.Mesh(new THREE.BoxGeometry(pl.length, 1.5, pl.width), mat.plane());
    plane.position.set(pl.x, -0.75, pl.z);
    plane.receiveShadow = state.shadowsEnabled || false;
    plane.userData.benchPlane = true;
    group.add(plane);

    for (const item of plan.items) {
        const g = item.group;
        const rep = g.rep;
        const row = { item, g, meshes: [], stock: null, keep: null, offcut: null, kerfMesh: null, holes: g.holes || [] };
        if (opts.stock) {
            // Cut step: raw stock plus hidden keep/offcut pieces for the separation
            const stockBeam = makeBenchBeam(item.x0, item.stockLength, item.y, item.z, item.w, item.t, rep);
            row.stock = makeBenchBeamMesh(stockBeam, null);
            group.add(row.stock);
            const keepBeam = makeBenchBeam(item.x0, item.cutAt, item.y, item.z, item.w, item.t, rep);
            row.keep = makeBenchBeamMesh(keepBeam, null);
            row.keep.visible = false;
            group.add(row.keep);
            const offLen = item.stockLength - item.cutAt - kerf;
            if (offLen > 0.25) {
                const offBeam = makeBenchBeam(item.x0 + item.cutAt + kerf, offLen, item.y, item.z, item.w, item.t, rep);
                row.offcut = makeBenchBeamMesh(offBeam, null);
                row.offcut.visible = false;
                row.offcutHome = row.offcut.position.clone();
                group.add(row.offcut);
            }
            const kerfMesh = new THREE.Mesh(new THREE.BoxGeometry(kerf, item.t + 0.04, 1), mat.kerf());
            kerfMesh.position.set(item.x0 + item.cutAt + kerf / 2, item.t / 2, item.z - item.w / 2);
            kerfMesh.scale.z = 0.0001;
            kerfMesh.visible = false;
            group.add(kerfMesh);
            row.kerfMesh = kerfMesh;
        } else {
            // Drill step: one mesh per "holes so far" state (0..n), only one visible
            const beam = makeBenchBeam(item.x0, item.beamLength, item.y, item.z, item.w, item.t, rep);
            const n = row.holes.length;
            for (let k = 0; k <= n; k++) {
                const m = makeBenchBeamMesh(beam, row.holes.slice(0, k));
                m.visible = k === (opts.drilledAll ? n : 0);
                group.add(m);
                row.meshes.push(m);
            }
            row.beam = beam;
        }
        rows.push(row);
    }
    group.visible = true;
    ctx.scratch.bench = { plan, groups: oriented, rows, stock: !!opts.stock, kerf };
    if (state.buildPlayback) state.buildPlayback.benchSummary = benchSummary(groups, { stock: !!opts.stock, stockLengthIn });
    return ctx.scratch.bench;
}

function benchBounds(ctx) {
    const b = ctx.scratch.bench;
    if (b && b.plan && b.plan.bounds) return b.plan.bounds;
    const beams = ctx.targets.filter(r => r.kind === 'beam').map(r => r.obj);
    const plan = planBench(groupBeamsForBench(beams), { stock: ctx.step.kind === 'cut', stockLengthIn: ctx.step.op && ctx.step.op.stockLengthIn });
    return plan.bounds;
}

/**
 * Close-up framing of the tool's work area (cut line or first hole) instead of
 * the whole bench. Works before the bench is staged (the view is resolved when
 * the step starts) by planning the layout on the fly.
 */
function workAreaBounds(ctx, kind) {
    const full = benchBounds(ctx);
    let item = null, firstHole = null;
    const b = ctx.scratch.bench;
    if (b && b.rows && b.rows.length) {
        item = b.rows[0].item;
        firstHole = b.rows[0].holes && b.rows[0].holes[0];
    } else {
        const beams = ctx.targets.filter(r => r.kind === 'beam').map(r => r.obj);
        const groups = groupBeamsForBench(beams);
        if (!groups.length) return full;
        let oriented = groups;
        if (kind === 'drill') {
            const info = benchHolesFor(groups[0].rep, boltsForDrilling(ctx));
            oriented = [{ ...groups[0], w: info.laidW, t: info.laidT }, ...groups.slice(1)];
            firstHole = info.holes[0] || null;
        }
        const plan = planBench(oriented, { stock: kind === 'cut', stockLengthIn: ctx.step.op && ctx.step.op.stockLengthIn });
        item = plan.items[0];
        if (!item) return full;
    }
    if (kind === 'cut') {
        const center = { x: item.x0 + item.cutAt, y: item.t, z: item.z };
        return { ...full, center, radius: Math.max(16, item.w * 2 + 8) };
    }
    const cx = item.x0 + item.beamLength / 2;
    const center = firstHole ? { x: cx + firstHole.posL, y: item.t, z: item.z + (firstHole.posW || 0) } : { x: cx, y: item.t, z: item.z };
    return { ...full, center, radius: Math.max(14, item.w * 2 + 6) };
}

function hideBench() {
    if (threeRenderer.benchGroup) threeRenderer.benchGroup.visible = false;
    if (state.buildPlayback) state.buildPlayback.benchSummary = '';
}

// ---------------------------------------------------------------------------
// Tool meshes
// ---------------------------------------------------------------------------

/** Circular saw: toothed blade in the YZ plane (normal +X) with guard, motor and handle. */
function createSawMesh(radius) {
    const g = new THREE.Group();
    const key = `saw_blade_${radius.toFixed(2)}`;
    const bladeGeo = getCachedGeometry(key, () => {
        const shape = new THREE.Shape();
        const teeth = 40;
        for (let i = 0; i < teeth; i++) {
            const a0 = (i / teeth) * Math.PI * 2;
            const a1 = ((i + 0.55) / teeth) * Math.PI * 2;
            const rTip = radius, rRoot = radius - 0.22;
            const p0 = [Math.cos(a0) * rTip, Math.sin(a0) * rTip];
            const p1 = [Math.cos(a1) * rRoot, Math.sin(a1) * rRoot];
            if (i === 0) shape.moveTo(p0[0], p0[1]); else shape.lineTo(p0[0], p0[1]);
            shape.lineTo(p1[0], p1[1]);
        }
        shape.closePath();
        const arbor = new THREE.Path();
        arbor.absarc(0, 0, 0.35, 0, Math.PI * 2, false);
        shape.holes.push(arbor);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.09, bevelEnabled: false });
        geo.rotateY(Math.PI / 2); // extrude axis Z -> X : blade lies in the YZ plane
        geo.translate(-0.045, 0, 0);
        return geo;
    });
    const blade = new THREE.Mesh(bladeGeo, mat.steel());
    blade.name = 'blade';
    g.add(blade);

    const arbor = new THREE.Mesh(getCachedGeometry('saw_arbor', () => new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12).rotateZ(Math.PI / 2)), mat.dark());
    g.add(arbor);

    // Guard: covers the upper half of the blade
    const guard = new THREE.Mesh(getCachedGeometry(`saw_guard_${radius.toFixed(2)}`, () => new THREE.CylinderGeometry(radius + 0.35, radius + 0.35, 0.7, 24, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2)), mat.guard());
    g.add(guard);
    // Motor housing and handle, on the +X side of the blade
    const motor = new THREE.Mesh(getCachedGeometry('saw_motor', () => new THREE.BoxGeometry(2.6, 2.2, 2.4)), mat.body());
    motor.position.set(1.7, radius * 0.25, 0);
    g.add(motor);
    const handle = new THREE.Mesh(getCachedGeometry('saw_handle', () => new THREE.BoxGeometry(1.2, 1.0, 3.2)), mat.dark());
    handle.position.set(1.4, radius * 0.25 + 1.7, -0.4);
    g.add(handle);
    g.traverse(ch => { if (ch.isMesh) ch.castShadow = state.shadowsEnabled || false; });
    return g;
}

/** Drill: body + chuck + fluted bit with the tip at the group origin, bit along -Y. */
function createDrillMesh(bitDiameter, bitLength) {
    const g = new THREE.Group();
    const r = Math.max(0.08, bitDiameter / 2);
    const tipH = Math.max(0.25, r * 1.2);
    const shaftLen = Math.max(1, bitLength - tipH);
    const bit = new THREE.Group();
    bit.name = 'bit';
    const shaft = new THREE.Mesh(getCachedGeometry(`drill_shaft_${r.toFixed(3)}_${shaftLen.toFixed(2)}`, () => new THREE.CylinderGeometry(r, r, shaftLen, 16)), mat.steel());
    shaft.position.y = tipH + shaftLen / 2;
    bit.add(shaft);
    const tip = new THREE.Mesh(getCachedGeometry(`drill_tip_${r.toFixed(3)}_${tipH.toFixed(2)}`, () => new THREE.ConeGeometry(r, tipH, 16).rotateX(Math.PI)), mat.steel());
    tip.position.y = tipH / 2;
    bit.add(tip);
    // Two dark flute ribbons twisted around the shaft
    for (let i = 0; i < 2; i++) {
        const flute = new THREE.Mesh(getCachedGeometry(`drill_flute_${r.toFixed(3)}_${shaftLen.toFixed(2)}`, () => new THREE.BoxGeometry(r * 2.02, shaftLen * 0.9, r * 0.35)), mat.dark());
        flute.position.y = tipH + shaftLen / 2;
        flute.rotation.y = i * Math.PI / 2;
        flute.rotation.x = 0.35;
        bit.add(flute);
    }
    g.add(bit);
    const chuck = new THREE.Mesh(getCachedGeometry('drill_chuck', () => new THREE.CylinderGeometry(0.55, 0.45, 1.2, 16)), mat.dark());
    chuck.position.y = bitLength + 0.6;
    g.add(chuck);
    const body = new THREE.Mesh(getCachedGeometry('drill_body', () => new THREE.BoxGeometry(1.7, 1.8, 4.2)), mat.body());
    body.position.set(0, bitLength + 2.1, 1.1);
    g.add(body);
    const grip = new THREE.Mesh(getCachedGeometry('drill_grip', () => new THREE.BoxGeometry(1.2, 3.4, 1.3)), mat.dark());
    grip.position.set(0, bitLength + 0.9, 2.6);
    g.add(grip);
    g.traverse(ch => { if (ch.isMesh) ch.castShadow = state.shadowsEnabled || false; });
    return g;
}

// ---------------------------------------------------------------------------
// Place driver
// ---------------------------------------------------------------------------

function approachVector(mesh, approach) {
    const v = new THREE.Vector3(0, 1, 0);
    if (approach === 'radial') {
        v.set(mesh.position.x, 0, mesh.position.z);
        if (v.lengthSq() < 1e-6) v.set(1, 0, 0);
        v.normalize();
    } else if (approach === 'axis') {
        const beam = mesh.userData && mesh.userData.beam;
        if (beam && beam.axisZ) v.set(beam.axisZ.x, beam.axisZ.y, beam.axisZ.z).normalize();
    }
    return v;
}

function makeTransparent(root) {
    const mats = [];
    root.traverse(ch => {
        if (!ch.isMesh || !ch.material) return;
        if (!ch.userData.buildHighlighted) ch.material = ch.material.clone();
        ch.material.transparent = true;
        ch.material.depthWrite = true;
        mats.push(ch.material);
    });
    return mats;
}

const placeDriver = {
    stage(ctx) {
        const op = ctx.step.op || {};
        const approach = op.approach || 'above';
        const travel = Number.isFinite(Number(op.travelIn)) ? Number(op.travelIn) : 24;
        const fromParked = op.from === 'parked';
        const entries = [];
        forEachPartMesh((mesh, key) => {
            if (!ctx.targetKeys.has(key)) return;
            let dir = approachVector(mesh, approach);
            let dist = travel;
            let fade = true;
            if (fromParked && typeof ctx.parkedOffsetFor === 'function') {
                // Lift from where the parts were parked: travel along the park vector, no fade
                const off = ctx.parkedOffsetFor(key);
                if (off) {
                    dir = new THREE.Vector3(off.x, off.y, off.z);
                    dist = dir.length();
                    if (dist > 1e-6) dir.divideScalar(dist); else { dir.set(0, 1, 0); dist = 0; }
                    fade = false;
                }
            }
            entries.push({ mesh, key, seated: mesh.position.clone(), dir, dist, mats: fade ? makeTransparent(mesh) : [] });
        });
        // Sequential placement: parts arrive one after another in key order
        // (panel:0, panel:1, ...) with a slight overlap so the sequence flows.
        const sequential = !!op.sequential && entries.length > 1;
        if (sequential) entries.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
        ctx.scratch.place = { entries, travel, sequential };
    },
    update(ctx, t) {
        const p = ctx.scratch.place;
        if (!p) return false;
        const n = p.entries.length;
        p.entries.forEach((en, i) => {
            let u = t;
            if (p.sequential) {
                // Each part gets a window; windows overlap by 35% of their width
                const overlap = 0.35;
                const win = 1 / (n - (n - 1) * overlap);
                const start = i * win * (1 - overlap);
                u = clamp((t - start) / win, 0, 1);
            }
            const e = easeInOutCubic(u);
            en.mesh.position.copy(en.seated).addScaledVector(en.dir, en.dist * (1 - e));
            // Not-yet-started parts stay hidden so the sequence reads left to right
            en.mesh.visible = !(p.sequential && u <= 0 && t < 1);
            const opacity = 0.25 + 0.75 * e;
            for (const m of en.mats) m.opacity = opacity;
        });
        return false;
    },
    end(ctx) {
        const p = ctx.scratch.place;
        if (!p) return;
        for (const en of p.entries) {
            en.mesh.position.copy(en.seated);
            en.mesh.visible = true;
            for (const m of en.mats) { m.opacity = 1; m.transparent = false; }
        }
        ctx.scratch.place = null;
    },
};

// ---------------------------------------------------------------------------
// Cut driver
// ---------------------------------------------------------------------------

/** Splits 0..1 into equal slots; returns the active slot index and local progress. */
function slotOf(t, count) {
    const n = Math.max(1, count);
    const idx = Math.min(n - 1, Math.floor(t * n));
    const u = clamp(t * n - idx, 0, 1);
    return { idx, u };
}

const cutDriver = {
    stage(ctx) {
        const bench = buildBench(ctx, { stock: true, drilled: false });
        if (!bench || !bench.rows.length) return;
        const maxT = Math.max(...bench.rows.map(r => r.item.t));
        const radius = clamp(maxT + 0.75, 2.25, 4.5);
        const saw = createSawMesh(radius);
        saw.visible = false;
        getBenchGroup().add(saw);
        ctx.scratch.saw = { mesh: saw, radius };
    },
    update(ctx, t) {
        const bench = ctx.scratch.bench;
        const saw = ctx.scratch.saw;
        if (!bench || !bench.rows.length || !saw) return false;
        const { idx, u } = slotOf(t, bench.rows.length);
        bench.rows.forEach((row, i) => {
            const done = i < idx || (i === idx && u >= 0.7) || t >= 1;
            const active = i === idx && t < 1;
            const item = row.item;
            if (row.stock) row.stock.visible = !done;
            if (row.keep) row.keep.visible = done;
            if (row.kerfMesh) row.kerfMesh.visible = active && u >= 0.15 && u < 0.7;
            if (row.offcut) {
                row.offcut.visible = done;
                if (done) {
                    const sep = (i < idx || t >= 1) ? 1 : easeInOutCubic((u - 0.7) / 0.3);
                    row.offcut.position.copy(row.offcutHome);
                    row.offcut.position.x += 2.5 + 9 * sep;
                    row.offcut.position.y -= 0.35 * sep;
                    row.offcut.rotation.z = -0.03 * sep;
                }
            }
            if (active) {
                const zStart = item.z - item.w / 2 - saw.radius - 1.5;
                const zEnd = item.z + item.w / 2 + saw.radius + 1.5;
                const x = item.x0 + item.cutAt + (bench.kerf || 0.125) / 2;
                const yCut = item.t + 0.25;               // blade center: bottom edge just below the bench top
                const yUp = item.t + saw.radius + 3;       // lifted clear of the stock
                let z = zStart, y = yUp;
                if (u < 0.15) { y = yUp + (yCut - yUp) * easeInOutCubic(u / 0.15); }
                else if (u < 0.7) { y = yCut; z = zStart + (zEnd - zStart) * ((u - 0.15) / 0.55); }
                else { z = zEnd; y = yCut + (yUp - yCut) * easeInOutCubic((u - 0.7) / 0.3); }
                saw.mesh.position.set(x, y, z);
                const blade = saw.mesh.getObjectByName('blade');
                if (blade) blade.rotation.x = t * 140;
                if (row.kerfMesh && u >= 0.15 && u < 0.7) {
                    const cutZ0 = item.z - item.w / 2;
                    const len = clamp(z - cutZ0, 0.001, item.w);
                    row.kerfMesh.scale.z = len;
                    row.kerfMesh.position.z = cutZ0 + len / 2;
                }
            }
        });
        saw.mesh.visible = t < 1;
        return false;
    },
    bounds(ctx) { return workAreaBounds(ctx, 'cut'); },
    focus(ctx, t) {
        const b = ctx.scratch.bench;
        if (!b || !b.rows.length) return null;
        const { idx } = slotOf(t, b.rows.length);
        const item = b.rows[Math.min(idx, b.rows.length - 1)].item;
        return { x: item.x0 + item.cutAt, y: item.t, z: item.z };
    },
    end() { hideBench(); },
};

// ---------------------------------------------------------------------------
// Drill driver
// ---------------------------------------------------------------------------

const drillDriver = {
    stage(ctx) {
        const bench = buildBench(ctx, { stock: false, drilled: true });
        if (!bench || !bench.rows.length) return;
        const maxT = Math.max(...bench.rows.map(r => r.item.t));
        const holeDias = bench.rows.flatMap(r => r.holes.map(h => h.radius * 2));
        const dia = Number(ctx.step.op && ctx.step.op.bitDiameterIn) || (holeDias.length ? Math.max(...holeDias) : 0.375);
        const bitLen = maxT + 2.5;
        const drill = createDrillMesh(dia, bitLen);
        drill.visible = false;
        getBenchGroup().add(drill);
        ctx.scratch.drill = { mesh: drill, bitLen, dia };
    },
    update(ctx, t) {
        const bench = ctx.scratch.bench;
        const drill = ctx.scratch.drill;
        if (!bench || !bench.rows.length || !drill) return false;
        // Sequence: every hole of every row, in order
        const jobs = [];
        bench.rows.forEach((row, ri) => row.holes.forEach((h, hi) => jobs.push({ row, ri, hi, h })));
        if (!jobs.length) { drill.mesh.visible = false; return false; }
        const { idx, u } = slotOf(t, jobs.length);
        // Reveal holes: each row shows "holes so far"
        bench.rows.forEach((row, ri) => {
            let drilled = 0;
            jobs.forEach((j, ji) => { if (j.ri === ri && (ji < idx || (ji === idx && u >= 0.5) || t >= 1)) drilled += 1; });
            row.meshes.forEach((m, k) => { m.visible = k === drilled; });
        });
        const job = jobs[idx];
        const item = job.row.item;
        const cx = item.x0 + item.beamLength / 2;
        const hx = cx + job.h.posL;
        const hz = item.z + (job.h.posW || 0);
        const yHover = item.t + 1.5;
        const yBottom = -0.4;
        const prev = idx > 0 ? jobs[idx - 1] : null;
        // First hole: the drill is already over it (no slide-in from off the beam)
        const px = prev ? prev.row.item.x0 + prev.row.item.beamLength / 2 + prev.h.posL : hx;
        const pz = prev ? prev.row.item.z + (prev.h.posW || 0) : hz;
        let x = hx, z = hz, y = yHover;
        if (u < 0.15) { const e = easeInOutCubic(u / 0.15); x = px + (hx - px) * e; z = pz + (hz - pz) * e; }
        else if (u < 0.5) { y = yHover + (yBottom - yHover) * easeInOutCubic((u - 0.15) / 0.35); }
        else if (u < 0.8) { y = yBottom + (yHover - yBottom) * easeInOutCubic((u - 0.5) / 0.3); }
        drill.mesh.position.set(x, y, z);
        const bit = drill.mesh.getObjectByName('bit');
        if (bit) bit.rotation.y = t * 220;
        drill.mesh.visible = t < 1;
        ctx.scratch.drillFocus = { x, y: item.t, z };
        return false;
    },
    bounds(ctx) { return workAreaBounds(ctx, 'drill'); },
    focus(ctx) { return ctx.scratch.drillFocus || null; },
    end() { hideBench(); },
};

registerOpDriver('place', placeDriver);
registerOpDriver('cut', cutDriver);
registerOpDriver('drill', drillDriver);

const _moduleExports = { getBenchGroup, buildBench, hideBench, createSawMesh, createDrillMesh };
bridgeGlobals(_moduleExports, 'buildStepsOps');
export { getBenchGroup, buildBench, hideBench, createSawMesh, createDrillMesh };
