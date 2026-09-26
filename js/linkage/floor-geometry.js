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

export const FLOOR_STACK_ID_BASE = 2000;

export const DEFAULT_FLOOR = Object.freeze({
    enabled: false,
    beams: {
        radialEnabled: false,
        length: 120,
        width: 1.5,
        thickness: 3.5,
        offsetH: -46.5,
        parallelEnabled: true,
        parallelLength: 96,
        parallelWidth: 2.5,
        parallelThickness: 1.5,
        parallelSwingAngle: 0,
        parallelVOffset: 1.5,   // vertical split between the A and B beams so they weave (A rides over B)
        anchorDist: 20,
        rcpEndOffset: 0,
        liftIn: 0,              // gap between the bottom ring's top face and the lowest beam
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

export function createDefaultFloor() {
    return clone(DEFAULT_FLOOR);
}

export function normalizeFloor(raw) {
    const d = DEFAULT_FLOOR;
    const r = raw && typeof raw === 'object' ? raw : {};
    const b = r.beams || {};
    const k = r.deck || {};
    const v = r.visibility || {};
    return {
        enabled: !!r.enabled,
        beams: {
            radialEnabled: !!b.radialEnabled,
            length: clampNum(b.length, d.beams.length, 12, 480),
            width: clampNum(b.width, d.beams.width, 0.5, 12),
            thickness: clampNum(b.thickness, d.beams.thickness, 0.5, 12),
            offsetH: clampNum(b.offsetH, d.beams.offsetH, -240, 240),
            parallelEnabled: b.parallelEnabled !== false,
            parallelLength: clampNum(b.parallelLength, d.beams.parallelLength, 12, 480),
            parallelWidth: clampNum(b.parallelWidth, d.beams.parallelWidth, 0.5, 12),
            parallelThickness: clampNum(b.parallelThickness, d.beams.parallelThickness, 0.5, 12),
            parallelSwingAngle: clampNum(b.parallelSwingAngle, d.beams.parallelSwingAngle, -90, 90),
            parallelVOffset: clampNum(b.parallelVOffset, d.beams.parallelVOffset, 0, 12),
            anchorDist: clampNum(b.anchorDist, d.beams.anchorDist, 0, 240),
            rcpEndOffset: clampNum(b.rcpEndOffset, d.beams.rcpEndOffset, 0, 48),
            liftIn: clampNum(b.liftIn, d.beams.liftIn, 0, 48),
        },
        deck: {
            enabled: k.enabled !== false,
            thicknessIn: clampNum(k.thicknessIn, d.deck.thicknessIn, 0.1, 3),
            insetIn: clampNum(k.insetIn, d.deck.insetIn, 0, 24),
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

    const lift = num(cfg.liftIn, 0);
    if (cfg.radialEnabled) {
        const L = num(cfg.length, 120), w = num(cfg.width, 1.5), t = num(cfg.thickness, 3.5);
        const y = ringTopY + lift + t / 2;
        frames.forEach(f => {
            const start = { x: f.foot.x + f.inDir.x * num(cfg.offsetH, 0), y, z: f.foot.z + f.inDir.z * num(cfg.offsetH, 0) };
            const end = { x: start.x + f.inDir.x * L, y, z: start.z + f.inDir.z * L };
            out.push(new Beam3D(start, end, w, t, WOOD_COLOR, { moduleIndex: f.moduleIndex, stackType: 'floor-beam', stackId: FLOOR_STACK_ID_BASE + f.moduleIndex }));
        });
    }
    if (cfg.parallelEnabled !== false) {
        const L = num(cfg.parallelLength, 96), w = num(cfg.parallelWidth, 2.5), t = num(cfg.parallelThickness, 1.5);
        const swing = degToRad(num(cfg.parallelSwingAngle, 0));
        const vOff = num(cfg.parallelVOffset, 0);
        const endOff = num(cfg.rcpEndOffset, 0);
        frames.forEach(f => {
            for (let side = 0; side < 2; side++) {
                const sc = side === 0 ? f.scissorA : f.scissorB;
                const dist = Math.max(0, Math.min(num(cfg.anchorDist, 0), sc.maxDist));
                const ax = f.hCenter.x + sc.dirX * dist, az = f.hCenter.z + sc.dirZ * dist;
                // B sits on the ring, A rides over B (the weave), like the top-ring reciprocal pair
                const y = ringTopY + lift + t / 2 + (side === 0 ? vOff : 0);
                const d = rotateXZ(sc.dirX, sc.dirZ, swing * (side === 0 ? 1 : -1));
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

/** Structure BOM rows for the floor beams (mirrors computeSupportBomContribution). */
export function computeFloorBomContribution(floor, moduleCount, st) {
    const items = [];
    const res = { structureItems: items, floorBeamCost: 0, floorBeamWeight: 0, radialQty: 0, reciprocalQty: 0 };
    if (!floor || !floor.enabled || !st || st.orientation === 'vertical') return res;
    const cfg = floor.beams;
    const n = moduleCount;
    const density = num(st.woodDensity, 0.02);
    const fmt = (ft, w, t) => (globalThis.unitConverter && typeof globalThis.unitConverter.formatBeamSpecForCost === 'function')
        ? globalThis.unitConverter.formatBeamSpecForCost(ft, w, t)
        : `${ft.toFixed(1)}' ${w}x${t}`;
    if (cfg.radialEnabled) {
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
    computeFloorBomContribution,
};

bridgeGlobals(_moduleExports, 'floorGeometry');
