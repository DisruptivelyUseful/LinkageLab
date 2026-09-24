// ============================================================================ (ES module)
//
// Build Steps — operation drivers.
//
// Registers the per-kind animations with the playback engine:
//   place  — parts travel in along an approach vector and fade to solid
//   cut    — workbench staging with raw stock (blade animation: Phase 3)
//   drill  — workbench staging with the finished hole pattern (bit animation: Phase 3)
//   fasten — no-op until Phase 4 (parts are still highlighted by the scene hook)
//
// Also owns the workbench scene (threeRenderer.benchGroup): synthetic beams
// laid flat on a bench plane at the origin, built from the real beams' size
// and, for drill steps, their real bolt intersections.

import { bridgeGlobals } from './global-bridge.js';
import { state } from './app-state.js';
import { threeRenderer, getCachedMaterial, createBeamMesh, getBeamBoltIntersections, buildBeamMeshWithHoles, clearGroup } from './renderer-3d.js';
import { Beam3D } from './geometry-classes.js';
import { WOOD_COLOR } from './constants.js';
import { buildLinkageGeometry } from './linkage-geometry.js';
import { easeInOutCubic, groupBeamsForBench, planBench, benchSummary } from './build-steps.js';
import { registerOpDriver, forEachPartMesh } from './build-steps-anim.js';

// ---------------------------------------------------------------------------
// Workbench
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

function benchPlaneMaterial() {
    return getCachedMaterial('bench_plane', () => new THREE.MeshLambertMaterial({ color: 0x3b3f46 }));
}

/** A synthetic beam lying along +X on the bench, width across Z, thickness up Y. */
function makeBenchBeam(item, length, x0, rep) {
    const start = { x: x0, y: item.y, z: item.z };
    const end = { x: x0 + length, y: item.y, z: item.z };
    const beam = new Beam3D(start, end, item.w, item.t, (rep && rep.colorBase) || WOOD_COLOR, {
        moduleIndex: rep ? rep.moduleIndex : -1,
        stackType: rep ? rep.stackType : 'unknown',
        stackId: rep ? rep.stackId : -1,
        patternId: rep ? rep.patternId : null,
        layerIndex: rep ? rep.layerIndex : 0,
    });
    // Beam3D picks axisX/axisY from the length axis; force width across Z and
    // thickness up Y so drilled hole frames match the real beam's convention
    // (posW across the width face, posT through the thickness).
    return beam;
}

/**
 * Builds a beam mesh, optionally with the representative real beam's holes.
 * Intersections are expressed in the beam-local frame (posL/posW/posT), so
 * they transfer to the synthetic beam unchanged.
 */
function makeBenchBeamMesh(beam, holes) {
    const plain = createBeamMesh(beam, false, null);
    if (holes && holes.length) {
        // Re-center the hole positions when the bench beam is longer than the real one
        const drilled = buildBeamMeshWithHoles(beam, holes, plain.material);
        if (drilled) {
            drilled.userData.beam = beam;
            drilled.userData.type = 'beam';
            drilled.userData.bench = true;
            return drilled;
        }
    }
    plain.userData.bench = true;
    return plain;
}

/**
 * Rebuilds the workbench for a bench-stage step.
 * @param {Object} ctx - op context
 * @param {{stock:boolean, drilled:boolean}} opts
 * @returns {{plan:Object, groups:Array}|null}
 */
function buildBench(ctx, opts) {
    const group = getBenchGroup();
    if (!group) return null;
    clearGroup(group);
    const beams = ctx.targets.filter(r => r.kind === 'beam').map(r => r.obj);
    const groups = groupBeamsForBench(beams);
    const stockLengthIn = ctx.step.op && ctx.step.op.stockLengthIn;
    const plan = planBench(groups, { stock: !!opts.stock, stockLengthIn });
    if (!plan.items.length) {
        group.visible = false;
        return { plan, groups };
    }

    // Bench plane
    const pl = plan.plane;
    const planeGeo = new THREE.BoxGeometry(pl.length, 1.5, pl.width);
    const plane = new THREE.Mesh(planeGeo, benchPlaneMaterial());
    plane.position.set(pl.x, -0.75, pl.z);
    plane.receiveShadow = state.shadowsEnabled || false;
    plane.userData.benchPlane = true;
    group.add(plane);

    // One representative beam per group (stock length for cut steps)
    for (const item of plan.items) {
        const rep = item.group.rep;
        const length = opts.stock ? item.stockLength : item.beamLength;
        const beam = makeBenchBeam(item, length, item.x0, rep);
        let holes = null;
        if (opts.drilled) {
            const real = getBeamBoltIntersections(rep, boltsForDrilling(ctx));
            // Hole positions are relative to the beam center along its length; the
            // bench beam has the same length so they map 1:1.
            holes = real.map(h => ({ ...h }));
        }
        const mesh = makeBenchBeamMesh(beam, holes);
        mesh.userData.benchItem = item;
        mesh.castShadow = state.shadowsEnabled || false;
        group.add(mesh);
    }
    group.visible = true;
    ctx.scratch.bench = { plan, groups, stock: !!opts.stock };
    if (state.buildPlayback) state.buildPlayback.benchSummary = benchSummary(groups, { stock: !!opts.stock, stockLengthIn });
    return { plan, groups };
}

/**
 * Bolts only exist in the solved geometry when "Bolts" is shown. Drill steps
 * need them regardless, so solve once with bolts forced on (uncached solve,
 * state restored afterwards). Cached per geometry data object.
 */
function boltsForDrilling(ctx) {
    if (ctx.scratch.drillBolts && ctx.scratch.drillBoltsFor === ctx.data) return ctx.scratch.drillBolts;
    // Full Detail hardware replaces the pivot bolts with assembly placements, so
    // solve with the legacy bolts to recover every hole position.
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

function benchBounds(ctx) {
    const b = ctx.scratch.bench;
    if (b && b.plan && b.plan.bounds) return b.plan.bounds;
    const beams = ctx.targets.filter(r => r.kind === 'beam').map(r => r.obj);
    const plan = planBench(groupBeamsForBench(beams), { stock: ctx.step.kind === 'cut', stockLengthIn: ctx.step.op && ctx.step.op.stockLengthIn });
    return plan.bounds;
}

function hideBench() {
    if (threeRenderer.benchGroup) threeRenderer.benchGroup.visible = false;
    if (state.buildPlayback) state.buildPlayback.benchSummary = '';
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
        const entries = [];
        forEachPartMesh((mesh, key) => {
            if (!ctx.targetKeys.has(key)) return;
            entries.push({
                mesh,
                seated: mesh.position.clone(),
                dir: approachVector(mesh, approach),
                mats: makeTransparent(mesh),
            });
        });
        ctx.scratch.place = { entries, travel };
    },
    update(ctx, t) {
        const p = ctx.scratch.place;
        if (!p) return false;
        const e = easeInOutCubic(t);
        const offset = p.travel * (1 - e);
        const opacity = 0.25 + 0.75 * e;
        for (const en of p.entries) {
            en.mesh.position.copy(en.seated).addScaledVector(en.dir, offset);
            for (const m of en.mats) m.opacity = opacity;
        }
        return false;
    },
    end(ctx) {
        const p = ctx.scratch.place;
        if (!p) return;
        for (const en of p.entries) {
            en.mesh.position.copy(en.seated);
            for (const m of en.mats) { m.opacity = 1; m.transparent = false; }
        }
        ctx.scratch.place = null;
    },
};

// ---------------------------------------------------------------------------
// Bench drivers (static in Phase 2; tool animation arrives in Phase 3)
// ---------------------------------------------------------------------------

const cutDriver = {
    stage(ctx) { buildBench(ctx, { stock: true, drilled: false }); },
    bounds(ctx) { return benchBounds(ctx); },
    end() { hideBench(); },
};

const drillDriver = {
    stage(ctx) { buildBench(ctx, { stock: false, drilled: true }); },
    bounds(ctx) { return benchBounds(ctx); },
    end() { hideBench(); },
};

registerOpDriver('place', placeDriver);
registerOpDriver('cut', cutDriver);
registerOpDriver('drill', drillDriver);
registerOpDriver('fasten', {});

const _moduleExports = { getBenchGroup, buildBench, hideBench };
bridgeGlobals(_moduleExports, 'buildStepsOps');
export { getBenchGroup, buildBench, hideBench };
