// ============================================================================
// LINKAGE LAB — Radial (polar) array of the whole structure (ES module)
//
// Replicates solver output around a central anchor point:
//   • horizontal (cylinder) structures tile in the ground plane, e.g. six
//     hexagons around an optional seventh centre hexagon = honeycomb;
//   • vertical (arch) structures are placed on radial planes around the
//     anchor, so N arches sweep out a toroid (a bent tunnel).
//
// Pure geometry: no DOM, no THREE. Applied as the LAST assembly step in
// buildLinkageGeometry(), after the arch transform, the linear (tunnel)
// array, support / reciprocal beams and solar panels, so a copy is a rigid
// transform of the complete single structure. The solver itself stays
// single-structure (collision checks, golden metrics, reciprocal seeding).
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';

/** Default values for the radial array state keys (mirrored in app-state.js). */
const RADIAL_ARRAY_DEFAULTS = Object.freeze({
    radialArrayEnabled: false,
    radialCount: 6,            // copies around the ring (1..12)
    radialCenter: true,        // keep a structure at the anchor point
    radialRotateCopies: true,  // rotate each copy with its position on the ring
    radialRadiusAuto: true,    // ring radius follows the structure footprint
    radialRadius: 0,           // manual ring radius (inches), used when auto is off
    radialSpacing: 0,          // extra radial offset added to the radius (inches)
    radialStartAngle: 0,       // rotates the whole pattern (degrees)
    radialSpin: 0,             // extra spin of each copy about its own axis (degrees)
    radialHeightOffset: 0,     // vertical offset of ring copies vs. the centre (inches)
    radialHiddenSlots: [],     // slot indices (0 = first copy) hidden from the view/export
});

const RADIAL_COUNT_MIN = 1;
const RADIAL_COUNT_MAX = 12;

/** True when the array should be applied for this state. */
function isRadialArrayActive(s = globalThis.state) {
    return !!(s && s.radialArrayEnabled && (s.radialCount | 0) >= RADIAL_COUNT_MIN);
}

/** Normalised set of hidden slot indices from state (ignores junk values). */
function hiddenSlotSet(s) {
    const list = s && Array.isArray(s.radialHiddenSlots) ? s.radialHiddenSlots : [];
    return new Set(list.filter(v => Number.isInteger(v) && v >= 0));
}

/** Slot index of a part from its arrayIndex (see applyRadialArray). */
function slotOfArrayIndex(arrayIndex, linearCount) {
    const lc = Math.max(1, linearCount | 0);
    return Math.floor((arrayIndex || 0) / lc);
}

// ---------------------------------------------------------------------------
// Small vector helpers (XZ rotation about the world Y axis)
// ---------------------------------------------------------------------------

function rotateXZ(v, cos, sin) {
    return { x: v.x * cos - v.z * sin, y: v.y, z: v.x * sin + v.z * cos };
}

function isVec(v) {
    return !!v && typeof v.x === 'number' && typeof v.z === 'number';
}

// ---------------------------------------------------------------------------
// Anchor and footprint analysis
// ---------------------------------------------------------------------------

/** Axis-aligned XZ/Y bounds over every beam corner (or endpoints). */
function beamBounds(beams) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    beams.forEach(b => {
        if (!b) return;
        const pts = (b.corners && b.corners.length) ? b.corners : [b.p1, b.p2];
        pts.forEach(p => {
            if (!isVec(p)) return;
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
            if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
        });
    });
    if (!Number.isFinite(minX)) return null;
    return { minX, maxX, minY, maxY, minZ, maxZ,
             cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2,
             width: maxX - minX, depth: maxZ - minZ };
}

/** Mean XZ of the horizontal-ring beam centres, grouped by module index. */
function moduleCentersXZ(beams) {
    const sums = new Map();
    beams.forEach(b => {
        if (!b || !b.stackType || !b.stackType.startsWith('horizontal') || !isVec(b.center)) return;
        const mi = b.moduleIndex !== undefined ? b.moduleIndex : 0;
        const acc = sums.get(mi) || { x: 0, z: 0, n: 0 };
        acc.x += b.center.x; acc.z += b.center.z; acc.n++;
        sums.set(mi, acc);
    });
    return [...sums.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([mi, acc]) => ({ moduleIndex: mi, x: acc.x / acc.n, z: acc.z / acc.n }));
}

/**
 * Circumcentre of three XZ points, or null when they are (nearly) collinear.
 * Every module of a scissor ring is the same 2D module rotated by the same
 * relative angle, so the module centres all lie on one circle whose centre is
 * the ring centre — valid at any fold angle, not only when the ring closes.
 */
function circumcenterXZ(a, b, c) {
    const d = 2 * (a.x * (b.z - c.z) + b.x * (c.z - a.z) + c.x * (a.z - b.z));
    const scale = Math.max(1, Math.hypot(b.x - a.x, b.z - a.z), Math.hypot(c.x - a.x, c.z - a.z));
    if (Math.abs(d) < 1e-6 * scale * scale) return null;
    const a2 = a.x * a.x + a.z * a.z, b2 = b.x * b.x + b.z * b.z, c2 = c.x * c.x + c.z * c.z;
    return {
        x: (a2 * (b.z - c.z) + b2 * (c.z - a.z) + c2 * (a.z - b.z)) / d,
        z: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
    };
}

/**
 * Works out where the anchor is and how far out the ring copies should sit so
 * that they just touch the centre structure.
 *
 * Horizontal: anchor = ring circumcentre; copy 0 is placed against module 0's
 * flat face at twice that face's distance from the centre (honeycomb pitch).
 * Vertical: anchor = arch footprint centre; each arch is placed on a radial
 * plane, far enough out that adjacent inner feet just meet (toroid).
 *
 * @returns {{anchor:{x:number,z:number}, autoRadius:number, autoStartRad:number, footprint:object}|null}
 */
function analyzeRadialFootprint(beams, orientation, count) {
    const bounds = beamBounds(beams);
    if (!bounds) return null;
    const n = Math.max(1, count | 0);

    if (orientation === 'vertical') {
        const halfWidth = bounds.width / 2;
        const depth = bounds.depth;
        // Adjacent arches' inner feet meet when the inner chord equals the depth.
        const innerR = n >= 2 ? depth / (2 * Math.sin(Math.PI / n)) : depth;
        return {
            anchor: { x: bounds.cx, z: bounds.cz },
            autoRadius: halfWidth + innerR,
            autoStartRad: 0,
            footprint: { halfWidth, depth },
        };
    }

    const centers = moduleCentersXZ(beams);
    let anchor = null;
    if (centers.length >= 3) anchor = circumcenterXZ(centers[0], centers[1], centers[2]);
    if (!anchor) anchor = { x: bounds.cx, z: bounds.cz };

    // Direction of module 0's flat face, and how far that face reaches out.
    let autoStartRad = 0;
    let faceReach = Math.max(bounds.width, bounds.depth) / 2;
    if (centers.length) {
        const m0 = centers[0];
        const dx = m0.x - anchor.x, dz = m0.z - anchor.z;
        const len = Math.hypot(dx, dz);
        if (len > 1e-9) {
            autoStartRad = Math.atan2(dz, dx);
            const ux = dx / len, uz = dz / len;
            let reach = 0;
            beams.forEach(b => {
                if (!b || b.moduleIndex !== m0.moduleIndex) return;
                if (!b.stackType || !b.stackType.startsWith('horizontal')) return;
                const pts = (b.corners && b.corners.length) ? b.corners : [b.p1, b.p2];
                pts.forEach(p => {
                    if (!isVec(p)) return;
                    const d = (p.x - anchor.x) * ux + (p.z - anchor.z) * uz;
                    if (d > reach) reach = d;
                });
            });
            if (reach > 0) faceReach = reach;
        }
    }
    return {
        anchor,
        autoRadius: 2 * faceReach,
        autoStartRad,
        footprint: { faceReach },
    };
}

// ---------------------------------------------------------------------------
// Slot planning
// ---------------------------------------------------------------------------

/**
 * Builds the list of copies ("slots") to emit.
 * @returns {{anchor, radius, autoRadius, startRad, slots:Array}}
 */
function planRadialArray(s, beams) {
    const orientation = s.orientation === 'vertical' ? 'vertical' : 'horizontal';
    const count = Math.max(RADIAL_COUNT_MIN, Math.min(RADIAL_COUNT_MAX, s.radialCount | 0));
    const analysis = analyzeRadialFootprint(beams, orientation, count);
    if (!analysis) return null;

    const spacing = Number(s.radialSpacing) || 0;
    const baseRadius = s.radialRadiusAuto === false ? (Number(s.radialRadius) || 0) : analysis.autoRadius;
    const radius = Math.max(0, baseRadius + spacing);
    const userStartRad = (Number(s.radialStartAngle) || 0) * Math.PI / 180;
    const spinRad = (Number(s.radialSpin) || 0) * Math.PI / 180;
    const heightOffset = Number(s.radialHeightOffset) || 0;
    const rotateCopies = s.radialRotateCopies !== false;
    const step = (2 * Math.PI) / count;

    const slots = [];
    let slotIndex = 0;
    if (s.radialCenter !== false) {
        slots.push({ slot: slotIndex++, isCenter: true, thetaRad: 0, phiRad: 0, offset: { x: 0, y: 0, z: 0 } });
    }
    for (let k = 0; k < count; k++) {
        const theta = analysis.autoStartRad + userStartRad + k * step;
        const phi = (rotateCopies ? userStartRad + k * step : 0) + spinRad;
        slots.push({
            slot: slotIndex++,
            isCenter: false,
            ringIndex: k,
            thetaRad: theta,
            phiRad: phi,
            offset: { x: radius * Math.cos(theta), y: heightOffset, z: radius * Math.sin(theta) },
        });
    }
    // Per-copy visibility: hidden slots are planned (stable numbering) but not emitted.
    // If the user somehow hid every copy, show them all rather than an empty scene.
    const hidden = hiddenSlotSet(s);
    const anyVisible = slots.some(sl => !hidden.has(sl.slot));
    slots.forEach(sl => { sl.hidden = anyVisible && hidden.has(sl.slot); });
    const hiddenSlots = slots.filter(sl => sl.hidden).map(sl => sl.slot);
    return {
        hiddenSlots,
        visibleCount: slots.length - hiddenSlots.length,
        orientation,
        count,
        anchor: { x: analysis.anchor.x, y: 0, z: analysis.anchor.z },
        radius,
        autoRadius: analysis.autoRadius,
        autoStartRad: analysis.autoStartRad,
        startRad: analysis.autoStartRad + userStartRad,
        footprint: analysis.footprint,
        slots,
    };
}

// ---------------------------------------------------------------------------
// Geometry duplication
// ---------------------------------------------------------------------------

function makeSlotTransforms(plan, slot) {
    const cos = Math.cos(slot.phiRad), sin = Math.sin(slot.phiRad);
    const ax = plan.anchor.x, az = plan.anchor.z;
    const ox = slot.offset.x, oy = slot.offset.y, oz = slot.offset.z;
    const point = (p) => {
        if (!isVec(p)) return p;
        const r = rotateXZ({ x: p.x - ax, y: p.y, z: p.z - az }, cos, sin);
        return { ...p, x: r.x + ax + ox, y: r.y + oy, z: r.z + az + oz };
    };
    const dir = (v) => (isVec(v) ? { ...v, ...rotateXZ(v, cos, sin) } : v);
    const height = (y) => (typeof y === 'number' ? y + oy : y);
    return { point, dir, height };
}

function cloneBeam(beam, xf, arrayIndex) {
    const out = { ...beam, arrayIndex };
    if (beam.corners) out.corners = beam.corners.map(xf.point);
    if (beam.p1) out.p1 = xf.point(beam.p1);
    if (beam.p2) out.p2 = xf.point(beam.p2);
    if (beam.center) out.center = xf.point(beam.center);
    if (beam.axisX) out.axisX = xf.dir(beam.axisX);
    if (beam.axisY) out.axisY = xf.dir(beam.axisY);
    if (beam.axisZ) out.axisZ = xf.dir(beam.axisZ);
    if (beam.faces) out.faces = beam.faces.map(f => ({ ...f, idx: f.idx ? [...f.idx] : f.idx, norm: xf.dir(f.norm) }));
    return out;
}

/** Rotate an orientation frame ({x,y,z} unit vectors) rigidly with the copy. */
function cloneFrame(frame, xf) {
    if (!frame || typeof frame !== 'object') return frame;
    return {
        ...frame,
        x: frame.x ? xf.dir(frame.x) : frame.x,
        y: frame.y ? xf.dir(frame.y) : frame.y,
        z: frame.z ? xf.dir(frame.z) : frame.z,
    };
}

function cloneBracket(br, xf, arrayIndex) {
    const out = { ...br, arrayIndex };
    if (br.pos) out.pos = xf.point(br.pos);
    if (br.bottomPos) out.bottomPos = xf.point(br.bottomPos);
    if (br.beamDir) out.beamDir = xf.dir(br.beamDir);
    if (br.right) out.right = xf.dir(br.right);
    if (br.boltDir) out.boltDir = xf.dir(br.boltDir);
    if (br.basis) out.basis = cloneFrame(br.basis, xf);
    out.bottomY = xf.height(br.bottomY);
    out.baseY = xf.height(br.baseY);
    out.sideHoleY = xf.height(br.sideHoleY);
    out.originalPosY = xf.height(br.originalPosY);
    return out;
}

function cloneBolt(bolt, xf, arrayIndex) {
    const out = { ...bolt, arrayIndex };
    if (bolt.start) out.start = xf.point(bolt.start);
    if (bolt.end) out.end = xf.point(bolt.end);
    if (bolt.center) out.center = xf.point(bolt.center);
    if (bolt.dir) out.dir = xf.dir(bolt.dir);
    out.z = xf.height(bolt.z);
    return out;
}

function cloneWasher(w, xf, arrayIndex) {
    const out = { ...w, arrayIndex };
    if (w.center) out.center = xf.point(w.center);
    if (w.dir) out.dir = xf.dir(w.dir);
    out.z = xf.height(w.z);
    return out;
}

function clonePlacement(pl, xf, arrayIndex) {
    const out = { ...pl, arrayIndex };
    if (pl.pos) out.pos = xf.point(pl.pos);
    if (pl.bottomPos) out.bottomPos = xf.point(pl.bottomPos);
    if (pl.vBoltPivot) out.vBoltPivot = xf.point(pl.vBoltPivot);
    if (pl.beamDir) out.beamDir = xf.dir(pl.beamDir);
    if (pl.right) out.right = xf.dir(pl.right);
    if (pl.vBoltDir) out.vBoltDir = xf.dir(pl.vBoltDir);
    if (pl.frame) out.frame = cloneFrame(pl.frame, xf);
    out.bottomY = xf.height(pl.bottomY);
    out.sideHoleY = xf.height(pl.sideHoleY);
    return out;
}

function clonePanel(panel, xf, arrayIndex) {
    const out = { ...panel, arrayIndex };
    if (panel.center) out.center = xf.point(panel.center);
    if (panel.corners) out.corners = panel.corners.map(xf.point);
    if (panel.axisX) out.axisX = xf.dir(panel.axisX);
    if (panel.axisY) out.axisY = xf.dir(panel.axisY);
    if (panel.axisZ) out.axisZ = xf.dir(panel.axisZ);
    if (panel.normal) out.normal = xf.dir(panel.normal);
    if (typeof panel.rotation === 'number') out.rotation = panel.rotation + xf.phiRad;
    if (panel.faces) out.faces = panel.faces.map(f => ({ ...f, idx: f.idx ? [...f.idx] : f.idx, norm: xf.dir(f.norm) }));
    if (panel.gridLines) out.gridLines = panel.gridLines.map(l => ({ ...l, start: xf.point(l.start), end: xf.point(l.end) }));
    return out;
}

/** Rigid copy of a covering-style shape (wall / table / fabric / floor deck / shade tarp). */
function cloneCoveringShape(shape, xf, arrayIndex, slotIndex, isBaseCopy) {
    if (!shape || typeof shape !== 'object') return shape;
    const out = { ...shape, arrayIndex, slotIndex, isBaseCopy };
    if (shape.corners3D) out.corners3D = shape.corners3D.map(xf.point);
    if (shape.slabCorners3D) out.slabCorners3D = shape.slabCorners3D.map(xf.point);
    if (shape.center) out.center = xf.point(shape.center);
    if (shape.normal) out.normal = xf.dir(shape.normal);
    if (shape.plane) {
        out.plane = {
            ...shape.plane,
            origin: shape.plane.origin ? xf.point(shape.plane.origin) : shape.plane.origin,
            n: shape.plane.n ? xf.dir(shape.plane.n) : shape.plane.n,
            u: shape.plane.u ? xf.dir(shape.plane.u) : shape.plane.u,
            v: shape.plane.v ? xf.dir(shape.plane.v) : shape.plane.v,
        };
    }
    if (shape.plan2D) out.plan2D = shape.plan2D.map(q => { const r = xf.point({ x: q.x, y: 0, z: q.z }); return { ...q, x: r.x, z: r.z }; });
    if (shape.frame) {
        const f = shape.frame;
        out.frame = {
            ...f,
            origin: f.origin ? (() => { const r = xf.point({ x: f.origin.x, y: 0, z: f.origin.z }); return { ...f.origin, x: r.x, z: r.z }; })() : f.origin,
            u: f.u ? (() => { const r = xf.dir({ x: f.u.x, y: 0, z: f.u.z }); return { ...f.u, x: r.x, z: r.z }; })() : f.u,
            inward: f.inward ? (() => { const r = xf.dir({ x: f.inward.x, y: 0, z: f.inward.z }); return { ...f.inward, x: r.x, z: r.z }; })() : f.inward,
        };
    }
    return out;
}

/**
 * Replicates covering-style shapes (or pick quads) into every slot of a plan,
 * tagging each copy with `arrayIndex`, `slotIndex` and `isBaseCopy` (first slot).
 * Returns the input array untouched (with `isBaseCopy: true`) when there is no plan.
 */
function replicateShapes(plan, shapes) {
    const list = Array.isArray(shapes) ? shapes.filter(Boolean) : [];
    if (!plan || !plan.slots || !plan.slots.length) return list.map(sh => ({ ...sh, isBaseCopy: true }));
    const linearCount = Math.max(1, plan.linearCount | 0);
    const out = [];
    let first = true;
    plan.slots.forEach((slot) => {
        if (slot.hidden) return;
        const xf = makeSlotTransforms(plan, slot);
        const arrayIndex = slot.slot * linearCount;
        list.forEach(sh => out.push(cloneCoveringShape(sh, xf, arrayIndex, slot.slot, first)));
        first = false;
    });
    return out;
}

/**
 * Applies the radial array to an assembled geometry set.
 * Each input copy (linear array index a, 0 when none) becomes
 * `arrayIndex = slot * linearCount + a`, so part keys stay unique.
 *
 * @param {object} s     - app state
 * @param {object} geo   - { beams, brackets, bolts, washers, hardwareAssemblyPlacements,
 *                           panels?, supportBeams? } (only the arrays present are cloned)
 * @returns {{ geometry: object, plan: object } | null}  null when the array is inactive
 */
function applyRadialArray(s, geo) {
    if (!isRadialArrayActive(s)) return null;
    const beams = geo.beams || [];
    const plan = planRadialArray(s, beams);
    if (!plan) return null;

    const brackets = geo.brackets || [];
    const bolts = geo.bolts || [];
    const washers = geo.washers || [];
    const placements = geo.hardwareAssemblyPlacements || [];
    const panels = geo.panels || [];
    const supportBeams = geo.supportBeams || [];
    const linearCount = Math.max(1, ...[...beams, ...brackets, ...bolts, ...washers, ...placements]
        .map(o => (o && o.arrayIndex !== undefined ? o.arrayIndex + 1 : 1)));

    const out = { beams: [], brackets: [], bolts: [], washers: [], hardwareAssemblyPlacements: [] };
    if (geo.panels) out.panels = [];
    if (geo.supportBeams) out.supportBeams = [];
    plan.slots.forEach(slot => {
        if (slot.hidden) return;
        const xf = makeSlotTransforms(plan, slot);
        xf.phiRad = slot.phiRad;
        const idx = (o) => slot.slot * linearCount + (o.arrayIndex !== undefined ? o.arrayIndex : 0);
        beams.forEach(b => out.beams.push(cloneBeam(b, xf, idx(b))));
        brackets.forEach(b => out.brackets.push(cloneBracket(b, xf, idx(b))));
        bolts.forEach(b => out.bolts.push(cloneBolt(b, xf, idx(b))));
        washers.forEach(w => out.washers.push(cloneWasher(w, xf, idx(w))));
        placements.forEach(p => out.hardwareAssemblyPlacements.push(clonePlacement(p, xf, idx(p))));
        if (out.panels) panels.forEach(p => out.panels.push(clonePanel(p, xf, idx(p))));
        if (out.supportBeams) supportBeams.forEach(b => out.supportBeams.push(cloneBeam(b, xf, idx(b))));
    });
    plan.linearCount = linearCount;
    plan.copyCount = plan.slots.length;

    // Footprint of the base structure and of the whole pattern, measured from the
    // anchor (HUD diameter, camera fit).
    const radiusFromAnchor = (list) => {
        let maxRad = 0;
        list.forEach(b => {
            const pts = (b.corners && b.corners.length) ? b.corners : [b.p1, b.p2];
            pts.forEach(p => {
                if (!isVec(p)) return;
                const r = Math.hypot(p.x - plan.anchor.x, p.z - plan.anchor.z);
                if (r > maxRad) maxRad = r;
            });
        });
        return maxRad;
    };
    plan.baseMaxRad = radiusFromAnchor(beams);
    plan.maxRad = radiusFromAnchor(out.beams);
    return { geometry: out, plan };
}

const _moduleExports = {
    RADIAL_ARRAY_DEFAULTS,
    RADIAL_COUNT_MIN,
    RADIAL_COUNT_MAX,
    isRadialArrayActive,
    hiddenSlotSet,
    slotOfArrayIndex,
    analyzeRadialFootprint,
    planRadialArray,
    applyRadialArray,
    makeSlotTransforms,
    cloneCoveringShape,
    replicateShapes,
};

bridgeGlobals(_moduleExports, 'radialArray');

export {
    RADIAL_ARRAY_DEFAULTS,
    RADIAL_COUNT_MIN,
    RADIAL_COUNT_MAX,
    isRadialArrayActive,
    hiddenSlotSet,
    slotOfArrayIndex,
    analyzeRadialFootprint,
    planRadialArray,
    applyRadialArray,
    makeSlotTransforms,
    cloneCoveringShape,
    replicateShapes,
};
