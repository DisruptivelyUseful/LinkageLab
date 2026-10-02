// ============================================================================
// LINKAGE LAB — Raised floor: reciprocal floor beams on the bottom ring + deck
//
// The floor beams copy the top-ring reciprocal layout, mirrored onto the
// bottom H-ring: every module gets two beams, each anchored on one of its
// bottom scissor legs at `anchorDist` from the leg crossing and pointing
// toward the ring centre (rotated by the swing angle). The deck is the inner
// polygon of the bottom ring (the shared inner pivots), inset a little, laid
// on top of the beams and nested from plywood sheets like a wall.
//
// Pure math (no DOM / THREE) apart from Beam3D records for the beams.
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { WOOD_COLOR } from './constants.js';
import { Beam3D } from './geometry-classes.js';
import { degToRad, radToDeg } from './math.js';
import { calculateJointPositions, getOptimalClosedAngleForAnimation } from './joint-kinematics.js';
import { getEffectiveMinFoldAngle } from './solver.js';

export const FLOOR_STACK_ID_BASE = 2000;

export const DEFAULT_FLOOR = Object.freeze({
    enabled: false,
    beams: {
        radialEnabled: false,
        radialMode: 'offset',   // 'offset': fixed beam from the upright's foot; 'track': slotted foot pinned under the outer pivot
        trackTailIn: 18,        // track beam behind the outer pivot pin (winch / actuator body)
        trackHeadIn: 6,         // track beam past the far end of the slot
        trackClearanceIn: 0.25, // gap between the bottom H stack and the track's top face
        slotClearanceIn: 0.125, // slot runs this much past the pivot's packed and deployed positions, and this much wider than the bolt
        length: 120,
        width: 1.5,
        thickness: 3.5,
        offsetH: -46.5,         // along the inward radial from the upright's foot (signed)
        offsetV: 0,             // signed vertical shift of the radial beams (negative drops them)
        offsetT: 0,             // signed side-to-side shift along the ring tangent
        parallelEnabled: true,
        parallelLength: 96,
        parallelWidth: 2.5,
        parallelThickness: 1.5,
        parallelSwingAngle: 0,
        seat: 'leg',            // 'leg': each beam sits on its own scissor leg's top face; 'ringTop': on the ring's highest face
        parallelOffsetV: 0,     // signed vertical shift of both reciprocal beams (legacy `liftIn`)
        parallelVOffset: 0,     // signed A/B split: A rises by half, B drops by half (negative = the reverse)
        anchorDist: 20,         // along the leg from the crossing toward its inner end (signed)
        anchorSideIn: 0,        // perpendicular to the leg in plan, mirrored for the two sides (signed)
        rcpEndOffset: 0,        // how far the beam extends back past its anchor (signed)
    },
    deck: {
        enabled: true,
        thicknessIn: 0.75,
        insetIn: 0.5,
    },
    visibility: { beams: true, deck: true },
});

const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (v, def) => (typeof v === 'number' && Number.isFinite(v)) ? v : def;
const clampNum = (v, def, min, max) => Math.max(min, Math.min(max, num(v, def)));
const round = (v, p = 3) => +(+v).toFixed(p);

// Wide input ranges: offsets and shifts are signed, lengths and sections just have to be positive.
export const OFF_MAX = 1200;
export const LEN_MIN = 0.05, LEN_MAX = 2400;
export const SECTION_MIN = 0.05, SECTION_MAX = 48;

export function createDefaultFloor() {
    return clone(DEFAULT_FLOOR);
}

export function normalizeFloor(raw) {
    const d = DEFAULT_FLOOR;
    const r = raw && typeof raw === 'object' ? raw : {};
    const b = r.beams || {};
    const k = r.deck || {};
    const v = r.visibility || {};
    // Phase-4 configs had `liftIn` and seated every beam on the ring's top face with a
    // one-sided A lift (`parallelVOffset` raised A only). Keep those loading as they looked.
    const legacy = b.liftIn !== undefined && b.seat === undefined;
    const legacyLift = legacy ? (num(b.liftIn, 0) + (num(b.parallelVOffset, 0) / 2)) : undefined;
    return {
        enabled: !!r.enabled,
        beams: {
            radialEnabled: !!b.radialEnabled,
            radialMode: b.radialMode === 'track' ? 'track' : 'offset',
            trackTailIn: clampNum(b.trackTailIn, d.beams.trackTailIn, 0, OFF_MAX),
            trackHeadIn: clampNum(b.trackHeadIn, d.beams.trackHeadIn, 0, OFF_MAX),
            trackClearanceIn: clampNum(b.trackClearanceIn, d.beams.trackClearanceIn, 0, 48),
            slotClearanceIn: clampNum(b.slotClearanceIn, d.beams.slotClearanceIn, 0, 12),
            length: clampNum(b.length, d.beams.length, LEN_MIN, LEN_MAX),
            width: clampNum(b.width, d.beams.width, SECTION_MIN, SECTION_MAX),
            thickness: clampNum(b.thickness, d.beams.thickness, SECTION_MIN, SECTION_MAX),
            offsetH: clampNum(b.offsetH, d.beams.offsetH, -OFF_MAX, OFF_MAX),
            offsetV: clampNum(b.offsetV !== undefined ? b.offsetV : (legacy ? num(b.liftIn, 0) : undefined), d.beams.offsetV, -OFF_MAX, OFF_MAX),
            offsetT: clampNum(b.offsetT, d.beams.offsetT, -OFF_MAX, OFF_MAX),
            parallelEnabled: b.parallelEnabled !== false,
            parallelLength: clampNum(b.parallelLength, d.beams.parallelLength, LEN_MIN, LEN_MAX),
            parallelWidth: clampNum(b.parallelWidth, d.beams.parallelWidth, SECTION_MIN, SECTION_MAX),
            parallelThickness: clampNum(b.parallelThickness, d.beams.parallelThickness, SECTION_MIN, SECTION_MAX),
            parallelSwingAngle: clampNum(b.parallelSwingAngle, d.beams.parallelSwingAngle, -360, 360),
            seat: b.seat === 'ringTop' ? 'ringTop' : (legacy ? 'ringTop' : 'leg'),
            parallelOffsetV: clampNum(b.parallelOffsetV !== undefined ? b.parallelOffsetV : legacyLift, d.beams.parallelOffsetV, -OFF_MAX, OFF_MAX),
            parallelVOffset: clampNum(b.parallelVOffset !== undefined ? b.parallelVOffset : undefined, d.beams.parallelVOffset, -OFF_MAX, OFF_MAX),
            anchorDist: clampNum(b.anchorDist, d.beams.anchorDist, -OFF_MAX, OFF_MAX),
            anchorSideIn: clampNum(b.anchorSideIn, d.beams.anchorSideIn, -OFF_MAX, OFF_MAX),
            rcpEndOffset: clampNum(b.rcpEndOffset, d.beams.rcpEndOffset, -OFF_MAX, OFF_MAX),
        },
        deck: {
            enabled: k.enabled !== false,
            thicknessIn: clampNum(k.thicknessIn, d.deck.thicknessIn, SECTION_MIN, SECTION_MAX),
            insetIn: clampNum(k.insetIn, d.deck.insetIn, -OFF_MAX, OFF_MAX),
        },
        visibility: { beams: v.beams !== false, deck: v.deck !== false },
    };
}

export function serializeFloor(f) {
    return f ? clone(f) : null;
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

function segSegIntersectParamsXZ(a0, a1, b0, b1) {
    const dax = a1.x - a0.x, daz = a1.z - a0.z;
    const dbx = b1.x - b0.x, dbz = b1.z - b0.z;
    const cross = dax * dbz - daz * dbx;
    if (Math.abs(cross) < 1e-12) return null;
    const wx = b0.x - a0.x, wz = b0.z - a0.z;
    return { t: (wx * dbz - wz * dbx) / cross, s: (wx * daz - wz * dax) / cross };
}

function rotateXZ(dx, dz, rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    return { x: dx * c - dz * s, z: dx * s + dz * c };
}

function beamTopY(b) {
    if (b.corners && b.corners.length) return Math.max(...b.corners.map(p => p.y));
    return Math.max(b.p1.y, b.p2.y);
}
function beamBottomY(b) {
    if (b.corners && b.corners.length) return Math.min(...b.corners.map(p => p.y));
    return Math.min(b.p1.y, b.p2.y);
}

/**
 * Per-module frames on the BOTTOM ring: the highest layer of each module's
 * bottom scissor, the A/B legs, their crossing, inner ends, and the outer
 * foot of the module's vertical stack (for optional radial beams).
 */
export function extractFloorFrames(data, numModules) {
    const beams = (data && data.beams) || [];
    const botBeams = beams.filter(b => b.stackType === 'horizontal-bottom' && b.p1 && b.p2);
    if (!botBeams.length) return { frames: [], cx: 0, cz: 0, ringTopY: 0 };
    let cx = 0, cz = 0;
    botBeams.forEach(b => { cx += (b.p1.x + b.p2.x) / 2; cz += (b.p1.z + b.p2.z) / 2; });
    cx /= botBeams.length; cz /= botBeams.length;
    const ringTopY = Math.max(...botBeams.map(beamTopY));

    const frames = [];
    for (let i = 0; i < numModules; i++) {
        const mod = botBeams.filter(b => b.moduleIndex === i);
        if (!mod.length) continue;
        const pick = (pat) => {
            let best = null;
            for (const b of mod) {
                if (b.patternId !== pat) continue;
                if (!best || b.center.y > best.center.y) best = b;
            }
            return best;
        };
        const beamA = pick('A') || mod[0];
        const beamB = pick('B') || mod[0];
        const innerEndOf = (b) => (Math.hypot(b.p1.x - cx, b.p1.z - cz) <= Math.hypot(b.p2.x - cx, b.p2.z - cz) ? b.p1 : b.p2);
        const outerEndOf = (b) => (innerEndOf(b) === b.p1 ? b.p2 : b.p1);
        const innerA = innerEndOf(beamA), innerB = innerEndOf(beamB);
        let hCenter;
        const isect = segSegIntersectParamsXZ(beamA.p1, beamA.p2, beamB.p1, beamB.p2);
        if (isect && isect.t > -0.2 && isect.t < 1.2 && isect.s > -0.2 && isect.s < 1.2) {
            hCenter = { x: beamA.p1.x + isect.t * (beamA.p2.x - beamA.p1.x), z: beamA.p1.z + isect.t * (beamA.p2.z - beamA.p1.z) };
        } else {
            hCenter = { x: (innerA.x + innerB.x) / 2, z: (innerA.z + innerB.z) / 2 };
        }
        const scissor = (innerEnd) => {
            const dx = innerEnd.x - hCenter.x, dz = innerEnd.z - hCenter.z;
            const len = Math.hypot(dx, dz) || 1;
            return { innerEnd, dirX: dx / len, dirZ: dz / len, maxDist: len };
        };
        // Outer foot of the module's vertical stack (lowest endpoint farthest from the centre)
        const verts = beams.filter(b => (b.stackType === 'vertical' || b.stackType === 'fixed-beam') && b.moduleIndex === i && b.p1 && b.p2);
        let foot = null, footR = -Infinity, footBeam = null;
        verts.forEach(vb => {
            const lo = vb.p1.y <= vb.p2.y ? vb.p1 : vb.p2;
            const r = Math.hypot(lo.x - cx, lo.z - cz);
            if (r > footR) { footR = r; foot = lo; footBeam = vb; }
        });
        if (!foot) { const o = outerEndOf(beamA); foot = { x: o.x, y: o.y, z: o.z }; }
        let inX = 0, inZ = 0;
        if (footBeam) {
            const lo = footBeam.p1.y <= footBeam.p2.y ? footBeam.p1 : footBeam.p2;
            const hi = lo === footBeam.p1 ? footBeam.p2 : footBeam.p1;
            inX = hi.x - lo.x; inZ = hi.z - lo.z; // the outer leg climbs inward
        }
        if (Math.hypot(inX, inZ) < 1e-3) { inX = cx - foot.x; inZ = cz - foot.z; }
        const inLen = Math.hypot(inX, inZ) || 1;
        frames.push({
            moduleIndex: i,
            beamA, beamB, innerA, innerB, hCenter,
            scissorA: scissor(innerA), scissorB: scissor(innerB),
            foot: { x: foot.x, z: foot.z },
            inDir: { x: inX / inLen, z: inZ / inLen },
        });
    }
    return { frames, cx, cz, ringTopY };
}

/**
 * Floor beams (Beam3D records). Returned array is empty when disabled,
 * in arch mode, or below the reciprocal visibility fold angle.
 * @param {Object} data - solver output (pre-shift is fine)
 * @param {Object} floor - state.floor
 * @param {Object} st - app state
 */
export function generateFloorBeams(data, floor, st) {
    const out = [];
    if (!floor || !floor.enabled || !st || st.orientation === 'vertical') return out;
    const cfg = floor.beams || DEFAULT_FLOOR.beams;
    const foldDeg = radToDeg(data && data._structureFoldAngleRad !== undefined ? data._structureFoldAngleRad : st.foldAngle);
    const minDeg = (st.animation && st.animation.rcpVisibleAngle) ?? 90;
    if (foldDeg < minDeg) return out;
    const { frames, ringTopY } = extractFloorFrames(data, st.modules);
    if (!frames.length) return out;

    const tangentOf = (f) => ({ x: -f.inDir.z, z: f.inDir.x }); // +90° from the inward radial in plan
    if (cfg.radialEnabled && cfg.radialMode !== 'track') {
        const L = num(cfg.length, 120), w = num(cfg.width, 1.5), t = num(cfg.thickness, 3.5);
        const y = ringTopY + num(cfg.offsetV, 0) + t / 2;
        const oh = num(cfg.offsetH, 0), ot = num(cfg.offsetT, 0);
        frames.forEach(f => {
            const tg = tangentOf(f);
            const start = { x: f.foot.x + f.inDir.x * oh + tg.x * ot, y, z: f.foot.z + f.inDir.z * oh + tg.z * ot };
            const end = { x: start.x + f.inDir.x * L, y, z: start.z + f.inDir.z * L };
            out.push(new Beam3D(start, end, w, t, WOOD_COLOR, { moduleIndex: f.moduleIndex, stackType: 'floor-beam', stackId: FLOOR_STACK_ID_BASE + f.moduleIndex }));
        });
    }
    if (cfg.parallelEnabled !== false) {
        const L = num(cfg.parallelLength, 96), w = num(cfg.parallelWidth, 2.5), t = num(cfg.parallelThickness, 1.5);
        const swing = degToRad(num(cfg.parallelSwingAngle, 0));
        const split = num(cfg.parallelVOffset, 0);
        const offV = num(cfg.parallelOffsetV, 0);
        const endOff = num(cfg.rcpEndOffset, 0);
        const sideIn = num(cfg.anchorSideIn, 0);
        const seatOnLeg = cfg.seat !== 'ringTop';
        frames.forEach(f => {
            for (let side = 0; side < 2; side++) {
                const sc = side === 0 ? f.scissorA : f.scissorB;
                const leg = side === 0 ? f.beamA : f.beamB;
                const sign = side === 0 ? 1 : -1;
                const dist = num(cfg.anchorDist, 0);
                // perpendicular to the leg in plan, mirrored so both sides move the same way relative to their leg
                const px = -sc.dirZ * sign, pz = sc.dirX * sign;
                const ax = f.hCenter.x + sc.dirX * dist + px * sideIn;
                const az = f.hCenter.z + sc.dirZ * dist + pz * sideIn;
                // Seat: the top face of the leg this beam rides (A and B layers sit at different
                // heights in the bottom ring), or the ring's highest face; then the shared shift
                // and the A/B split (A up by half, B down by half).
                const seatY = seatOnLeg ? beamTopY(leg) : ringTopY;
                const y = seatY + t / 2 + offV + sign * split / 2;
                const d = rotateXZ(sc.dirX, sc.dirZ, swing * sign);
                const p1 = { x: ax - d.x * endOff, y, z: az - d.z * endOff };
                const p2 = { x: ax + d.x * L, y, z: az + d.z * L };
                out.push(new Beam3D(p1, p2, w, t, WOOD_COLOR, {
                    moduleIndex: f.moduleIndex,
                    stackType: 'floor-beam-reciprocal',
                    stackId: FLOOR_STACK_ID_BASE + 100 + f.moduleIndex * 2 + side,
                    patternId: side === 0 ? 'A' : 'B',
                }));
            }
        });
    }
    return out;
}

/**
 * Inner polygon of the bottom ring (the shared inner pivots of the bottom
 * scissors), sorted by angle around the ring centre and inset.
 */
export function calculateFloorPolygon(data, insetIn = 0, numModules) {
    const { frames, cx, cz } = extractFloorFrames(data, numModules);
    // The two inner beam ends at a shared pivot are extended past it in different
    // directions, so cluster the ends by angle (half a module apart at most) and
    // average each cluster into one vertex.
    const raw = [];
    frames.forEach(f => [f.innerA, f.innerB].forEach(p => raw.push({ x: p.x, z: p.z })));
    if (raw.length < 3) return null;
    const c0 = { x: raw.reduce((a, p) => a + p.x, 0) / raw.length, z: raw.reduce((a, p) => a + p.z, 0) / raw.length };
    const ang = (p) => Math.atan2(p.z - c0.z, p.x - c0.x);
    raw.sort((a, b) => ang(a) - ang(b));
    const tol = Math.PI / Math.max(3, frames.length); // half a module
    const clusters = [];
    raw.forEach(p => {
        const last = clusters[clusters.length - 1];
        if (last && Math.abs(ang(p) - last.ang) < tol) { last.pts.push(p); last.ang = last.pts.reduce((a, q) => a + ang(q), 0) / last.pts.length; }
        else clusters.push({ pts: [p], ang: ang(p) });
    });
    if (clusters.length > 1) {
        const first = clusters[0], last = clusters[clusters.length - 1];
        if (Math.abs((last.ang - 2 * Math.PI) - first.ang) < tol) { first.pts.push(...last.pts); clusters.pop(); }
    }
    const pts = clusters.map(cl => ({ x: cl.pts.reduce((a, p) => a + p.x, 0) / cl.pts.length, z: cl.pts.reduce((a, p) => a + p.z, 0) / cl.pts.length }));
    if (pts.length < 3) return null;
    const c = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, z: pts.reduce((a, p) => a + p.z, 0) / pts.length };
    pts.sort((a, b) => Math.atan2(a.z - c.z, a.x - c.x) - Math.atan2(b.z - c.z, b.x - c.x));
    const inset = pts.map(p => {
        const dx = p.x - c.x, dz = p.z - c.z;
        const r = Math.hypot(dx, dz) || 1;
        const k = Math.max(0, (r - insetIn / Math.cos(Math.PI / pts.length))) / r; // inset the edges, not the vertices
        return { x: c.x + dx * k, z: c.z + dz * k };
    });
    return { vertices: inset, center: c, ringCenter: { x: cx, z: cz } };
}

function polygonAreaXZ(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        a += p.x * q.z - q.x * p.z;
    }
    return Math.abs(a) / 2;
}

/**
 * Deck shape (covering-style record, kind 'wall', band 'floor') resting on the
 * floor beams. Returns null when the deck is disabled or no beams exist.
 * @param {Object} data - geometry AFTER recentering (data.beams includes the floor beams)
 */
export function computeFloorDeck(data, floor, st) {
    if (!floor || !floor.enabled || !floor.deck || floor.deck.enabled === false) return null;
    if (!st || st.orientation === 'vertical') return null;
    const beams = (data && data.beams) || [];
    const floorBeams = beams.filter(b => b.stackType === 'floor-beam' || b.stackType === 'floor-beam-reciprocal');
    if (!floorBeams.length) return null;
    const poly = calculateFloorPolygon(data, num(floor.deck.insetIn, 0), st.modules);
    if (!poly) return null;
    const t = num(floor.deck.thicknessIn, 0.75);
    const beamsTop = Math.max(...floorBeams.map(beamTopY));
    const yTop = beamsTop + t;
    const yBot = beamsTop;
    const top = poly.vertices.map(p => ({ x: p.x, y: yTop, z: p.z }));
    const bot = poly.vertices.map(p => ({ x: p.x, y: yBot, z: p.z }));
    const minX = Math.min(...top.map(p => p.x)), minZ = Math.min(...top.map(p => p.z));
    const maxX = Math.max(...top.map(p => p.x)), maxZ = Math.max(...top.map(p => p.z));
    // Plan coordinates for nesting: s along +x, t along +z (both from the bbox corner)
    const corners2D = top.map(p => ({ s: round(p.x - minX, 4), t: round(p.z - minZ, 4) }));
    const n = top.length;
    const cornerAnglesDeg = top.map((p, i) => {
        const a = top[(i + n - 1) % n], b = top[(i + 1) % n];
        const v1 = { x: a.x - p.x, z: a.z - p.z }, v2 = { x: b.x - p.x, z: b.z - p.z };
        const dot = v1.x * v2.x + v1.z * v2.z, m = Math.hypot(v1.x, v1.z) * Math.hypot(v2.x, v2.z) || 1;
        return round(radToDeg(Math.acos(Math.max(-1, Math.min(1, dot / m)))), 2);
    });
    const area = polygonAreaXZ(top);
    const edgeIn = Math.hypot(top[1].x - top[0].x, top[1].z - top[0].z);
    return {
        type: 'covering',
        kind: 'wall',
        band: 'floor',
        coverType: 'plywood',
        spanIndex: 0,
        moduleIndex: 0,
        label: 'Floor deck',
        plane: { origin: { x: minX, y: yTop, z: minZ }, n: { x: 0, y: 1, z: 0 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: 1 } },
        normal: { x: 0, y: 1, z: 0 },
        corners3D: top,
        slabCorners3D: bot.concat(top),
        center: { x: (minX + maxX) / 2, y: (yTop + yBot) / 2, z: (minZ + maxZ) / 2 },
        corners2D,
        sides: n,
        edgeIn: round(edgeIn),
        acrossIn: round(maxX - minX),
        widthBottomIn: round(maxX - minX),
        widthTopIn: round(maxZ - minZ),
        slantHeightIn: round(maxZ - minZ),
        verticalHeightIn: 0,
        yBottom: round(yBot),
        yTop: round(yTop),
        tiltFromVerticalDeg: 90,
        sideTaperDeg: { left: 0, right: 0 },
        cornerAnglesDeg,
        edgeBevelDeg: null,
        dihedralToNextDeg: null,
        areaIn2: round(area, 1),
        thicknessIn: t,
        mountOffsetIn: 0,
        beamsTopIn: round(beamsTop),
        warnings: [],
    };
}

/**
 * Seat summary for the readout: per pattern, the height of the beam's bottom face
 * and of the leg it should rest on (from a list of floor beams + the solved data).
 */
export function describeFloorSeating(data, floorBeams, numModules) {
    const { frames, ringTopY } = extractFloorFrames(data, numModules);
    const out = { ringTopY: round(ringTopY), A: null, B: null, radial: null };
    if (!frames.length) return out;
    const legTop = (pat) => round(Math.max(...frames.map(f => beamTopY(pat === 'A' ? f.beamA : f.beamB))));
    ['A', 'B'].forEach(pat => {
        const bs = (floorBeams || []).filter(b => b.stackType === 'floor-beam-reciprocal' && b.patternId === pat);
        if (!bs.length) return;
        const bottom = round(Math.min(...bs.map(beamBottomY)));
        out[pat] = { legTopY: legTop(pat), bottomY: bottom, gapIn: round(bottom - legTop(pat)) };
    });
    const rad = (floorBeams || []).filter(b => b.stackType === 'floor-beam');
    if (rad.length) {
        const bottom = round(Math.min(...rad.map(beamBottomY)));
        out.radial = { bottomY: bottom, gapIn: round(bottom - ringTopY) };
    }
    return out;
}


// ----------------------------------------------------------------------------
// Radial floor beams as a slotted track (the feet)
//
// In track mode each radial floor beam is pinned under its module's OUTER bottom
// pivot and runs inward under the INNER bottom pivot. The inner pivot bolt is
// extended down through a slot in the beam and retained with a plate washer, so
// as the ring deploys the inner pivot slides along the slot (the span between the
// two pivots shrinks from the packed to the deployed value) while the beam swings
// about its pin to stay under it. The beam sits below the bottom H stack, so it
// is what touches the ground.
// ----------------------------------------------------------------------------

/** Span (outer pivot → inner pivot, inches) at the packed and deployed angles. */
export function trackSpanRange(st) {
    const hActiveIn = st.hLengthFt * 12 - st.offsetTopIn - st.offsetBotIn;
    const params = { hActiveIn, pivotPct: st.pivotPct, hobermanAng: st.hobermanAng, pivotAng: st.pivotAng };
    const span = (theta) => { const j = calculateJointPositions(theta, params).joints; return Math.hypot(j.tr.x - j.br.x, j.tr.y - j.br.y); };
    let packedAngle, deployedAngle;
    try { packedAngle = getEffectiveMinFoldAngle(); } catch (e) { packedAngle = degToRad(5); }
    try { deployedAngle = getOptimalClosedAngleForAnimation(); } catch (e) { deployedAngle = degToRad(135); }
    const a = span(packedAngle), b = span(deployedAngle);
    return { packed: Math.max(a, b), deployed: Math.min(a, b), travel: Math.abs(a - b), packedAngle, deployedAngle };
}

/**
 * Track beams, slot records and retaining bolts for the current solve.
 * Needs `data.modulePivots` and `data.frame` from solveLinkage. Present at every
 * fold angle (the feet are structural, unlike the reciprocal floor beams).
 * @returns {{beams:Array, tracks:Array, bolts:Array}}
 */
export function generateFloorTracks(data, floor, st) {
    const out = { beams: [], tracks: [], bolts: [] };
    if (!floor || !floor.enabled || !st || st.orientation === 'vertical') return out;
    const cfg = floor.beams || DEFAULT_FLOOR.beams;
    if (!cfg.radialEnabled || cfg.radialMode !== 'track') return out;
    const mps = data && data.modulePivots;
    if (!Array.isArray(mps) || !mps.length) return out;
    const frame = data.frame || {};
    const w = num(cfg.width, 1.5), t = num(cfg.thickness, 3.5);
    const tail = num(cfg.trackTailIn, 18), head = num(cfg.trackHeadIn, 6);
    const gap = num(cfg.trackClearanceIn, 0.25), slotClr = num(cfg.slotClearanceIn, 0.125);
    const spans = trackSpanRange(st);
    const hStackThick = num(frame.hStackThick, (st.hStackCount || 1) * (st.hBeamT || 1.5));
    const topY = -hStackThick / 2 - gap;      // bottom ring stack is centred at y = 0
    const yC = topY - t / 2;
    const boltDia = num(st.hPivotBoltDiameter, num(st.boltDiameter, 0.375));
    const slotWidth = boltDia + 2 * slotClr;
    const lengthIn = tail + spans.packed + head;
    mps.forEach((mp, i) => {
        const pin = { x: mp.botOuter.x, z: mp.botOuter.z };
        const d = mp.inDir;
        const at = (dist, y) => ({ x: pin.x + d.x * dist, y, z: pin.z + d.z * dist });
        const spanNow = Math.hypot(mp.botInner.x - pin.x, mp.botInner.z - pin.z);
        const p1 = at(-tail, yC), p2 = at(spans.packed + head, yC);
        out.beams.push(new Beam3D(p1, p2, w, t, WOOD_COLOR, {
            moduleIndex: mp.moduleIndex, stackType: 'floor-beam-track', stackId: FLOOR_STACK_ID_BASE + 200 + mp.moduleIndex,
        }));
        const slotFrom = at(spans.deployed - slotClr, topY), slotTo = at(spans.packed + slotClr, topY);
        // Retaining bolt: the inner pivot bolt carried down through the stack and the slot, nut under the beam
        const boltTop = hStackThick / 2 + 0.5, boltBottom = topY - t - 0.75;
        const boltLen = boltTop - boltBottom;
        const bc = { x: mp.botInner.x, y: (boltTop + boltBottom) / 2, z: mp.botInner.z };
        out.bolts.push({
            start: { x: bc.x, y: boltTop, z: bc.z }, end: { x: bc.x, y: boltBottom, z: bc.z },
            center: bc, dir: { x: 0, y: -1, z: 0 }, length: boltLen, radius: boltDia / 2,
            headRadius: boltDia * 0.9, headHeight: boltDia * 0.6,
            boltType: 'track-bolt', stackThickness: boltLen * 0.6, headSide: 1, headExtraThickness: 0,
            z: bc.y, moduleIndex: mp.moduleIndex, ring: 'bottom', role: 'inner',
        });
        out.tracks.push({
            moduleIndex: mp.moduleIndex,
            pin: { x: pin.x, y: topY, z: pin.z }, dir: { x: d.x, z: d.z },
            slotFrom, slotTo, slotWidth, slotLengthIn: spans.travel + 2 * slotClr,
            boltAt: { x: mp.botInner.x, y: topY, z: mp.botInner.z },
            spanNow, spanPacked: spans.packed, spanDeployed: spans.deployed,
            topY, centreY: yC, bottomY: topY - t, lengthIn, widthIn: w, thicknessIn: t,
            tailIn: tail, headIn: head,
        });
    });
    return out;
}

/**
 * Readout summary for the track: slot, beam length, how far the beam swings about
 * its pin over the sweep and how far the feet drag relative to the structure centre.
 * @param {Function} pivotsAt - (foldAngleRad) => { modules:[{botOuter, botInner, curRot}] }
 */
export function describeFloorTrack(st, tracks, pivotsAt) {
    const spans = trackSpanRange(st);
    const t0 = tracks && tracks[0];
    const out = { slotLengthIn: round(spans.travel), slotFromIn: round(spans.deployed), slotToIn: round(spans.packed),
        lengthIn: t0 ? round(t0.lengthIn) : null, swingDeg: null, footDragIn: null, groundDropIn: t0 ? round(-t0.bottomY) : null };
    if (typeof pivotsAt !== 'function') return out;
    try {
        const a = pivotsAt(spans.packedAngle), b = pivotsAt(spans.deployedAngle);
        const ang = (m) => Math.atan2(m.botInner.z - m.botOuter.z, m.botInner.x - m.botOuter.x) - m.curRot;
        const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
        out.swingDeg = round(Math.abs(radToDeg(wrap(ang(a.modules[0]) - ang(b.modules[0])))), 1);
        const centroid = (ms) => ({ x: ms.reduce((s, m) => s + m.botOuter.x, 0) / ms.length, z: ms.reduce((s, m) => s + m.botOuter.z, 0) / ms.length });
        const ca = centroid(a.modules), cb = centroid(b.modules);
        let drag = 0;
        a.modules.forEach((m, i) => {
            const n = b.modules[i];
            drag += Math.hypot((n.botOuter.x - cb.x) - (m.botOuter.x - ca.x), (n.botOuter.z - cb.z) - (m.botOuter.z - ca.z));
        });
        out.footDragIn = round(drag / a.modules.length, 1);
    } catch (e) { /* readout only */ }
    return out;
}

/** Structure BOM rows for the floor beams (mirrors computeSupportBomContribution). */
export function computeFloorBomContribution(floor, moduleCount, st) {
    const items = [];
    const res = { structureItems: items, floorBeamCost: 0, floorBeamWeight: 0, radialQty: 0, reciprocalQty: 0, trackQty: 0, trackLengthIn: 0 };
    if (!floor || !floor.enabled || !st || st.orientation === 'vertical') return res;
    const cfg = floor.beams;
    const n = moduleCount;
    const density = num(st.woodDensity, 0.02);
    const fmt = (ft, w, t) => (globalThis.unitConverter && typeof globalThis.unitConverter.formatBeamSpecForCost === 'function')
        ? globalThis.unitConverter.formatBeamSpecForCost(ft, w, t)
        : `${ft.toFixed(1)}' ${w}x${t}`;
    if (cfg.radialEnabled && cfg.radialMode === 'track') {
        const spans = trackSpanRange(st);
        const lengthIn = num(cfg.trackTailIn, 0) + spans.packed + num(cfg.trackHeadIn, 0);
        const qty = n, ft = lengthIn / 12;
        const unit = num(st.costHBeam, 0);
        items.push({ qty, item: `Floor track beams, slotted feet (${fmt(ft, cfg.width, cfg.thickness)})`, unit, total: qty * unit });
        const boltUnit = num(st.costBoltHPivot, num(st.costBoltH, 0));
        items.push({ qty, item: 'Track retaining bolts with plate washers (through the inner pivot)', unit: boltUnit, total: qty * boltUnit });
        res.radialQty = qty;
        res.trackQty = qty;
        res.trackLengthIn = lengthIn;
        res.floorBeamWeight += qty * ft * cfg.width * cfg.thickness * 12 * density;
    } else if (cfg.radialEnabled) {
        const qty = n, ft = num(cfg.length, 120) / 12;
        const unit = num(st.costHBeam, 0);
        items.push({ qty, item: `Floor radial beams (${fmt(ft, cfg.width, cfg.thickness)})`, unit, total: qty * unit });
        res.radialQty = qty;
        res.floorBeamWeight += qty * ft * cfg.width * cfg.thickness * 12 * density;
    }
    if (cfg.parallelEnabled !== false) {
        const qty = 2 * n, ft = num(cfg.parallelLength, 96) / 12;
        const unit = num(st.costVBeam, 0);
        items.push({ qty, item: `Floor beams, reciprocal (${fmt(ft, cfg.parallelWidth, cfg.parallelThickness)})`, unit, total: qty * unit });
        res.reciprocalQty = qty;
        res.floorBeamWeight += qty * ft * cfg.parallelWidth * cfg.parallelThickness * 12 * density;
    }
    res.floorBeamCost = items.reduce((a, it) => a + it.total, 0);
    return res;
}

const _moduleExports = {
    FLOOR_STACK_ID_BASE,
    DEFAULT_FLOOR,
    createDefaultFloor,
    normalizeFloor,
    serializeFloor,
    extractFloorFrames,
    generateFloorBeams,
    calculateFloorPolygon,
    computeFloorDeck,
    describeFloorSeating,
    computeFloorBomContribution,
    generateFloorTracks,
    trackSpanRange,
    describeFloorTrack,
    OFF_MAX, LEN_MIN, LEN_MAX, SECTION_MIN, SECTION_MAX,
};

bridgeGlobals(_moduleExports, 'floorGeometry');
