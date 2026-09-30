// ============================================================================
// LINKAGE LAB - Hardware hand placement: push-stacking + snap (ES module, no THREE)
//
// Works on one axis in 1-D axis coordinates (the same coordinates as
// hw-stack-layout.js). A "body" is one part on the axis:
//
//   { id, kind, start, len, contact: [lo, hi], planes: [{ off, role }],
//     hostId, pushable }
//
//   start     seated axis start of the part (all qty copies together)
//   contact   offsets (from start) of the solid that touches neighbours. For a
//             bolt that is only its head: the shank passes through everything.
//   planes    faces the part can snap with. role: 'lo' (faces −axis), 'hi'
//             (faces +axis), 'center', 'tip' (bolt shank end)
//   hostId    inserts (bushings, rivet nuts) ride with their host member when
//             the host moves; they can also be pushed or dragged on their own
//   pushable  beams are fixed structure: never pushed, never obstacles
//
// Push (computePush): a dragged part carries everything it runs into in the
// direction it moves (bolt head → washers → …). Only parts fully ahead of the
// mover when the drag started are pushed; parts it already overlapped are left
// alone (overlaps are allowed). Positions are always recomputed from the
// drag-start snapshot, so dragging back is reversible within one drag, but
// pushed parts are never pulled back (they stay where the push left them).
//
// Seat (seatPush): a pushed chain that reaches a beam or datum face within the
// seat reach stops there (a detent), so washers pushed by a bolt head settle
// against the beam; pushing further goes through.
//
// Snap (collectSnapTargets / snapStart): candidate spots are neighbour faces,
// beam faces, the middle of a gap between two beams, extra planes from the
// adapter (datum wall, the facing sandwich beams on a centre axis) and the
// part's own tight "home". The best spot within the threshold wins.
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { HW_KIND } from './hw-stack-layout.js';

const EPS = 1e-6;

/** Snap priorities: higher wins when two spots are about equally close. */
const SNAP_PRIORITY = Object.freeze({ center: 4, contact: 3, home: 2, tip: 2, coplanar: 1 });

/**
 * One body per part from a computeAxisStack() result.
 * @param {object} stack  computeAxisStack() output
 * @returns {object[]}
 */
function axisBodiesFromStack(stack) {
    if (!stack || !stack.items) return [];
    const byPart = new Map();
    stack.items.forEach(it => {
        const id = it.part && it.part.id;
        if (id == null) return;
        const cur = byPart.get(id);
        if (!cur) byPart.set(id, { it, start: it.start, end: it.end });
        else { cur.start = Math.min(cur.start, it.start); cur.end = Math.max(cur.end, it.end); }
    });
    const bodies = [];
    byPart.forEach(({ it, start, end }, id) => {
        const len = Math.max(0, end - start);
        const kind = it.kind;
        const isBeam = it.part.type === 'beam';
        const body = {
            id,
            kind,
            type: it.part.type,
            label: it.part.label || it.part.type,
            start,
            len,
            contact: [0, len],
            planes: [
                { off: 0, role: 'lo' },
                { off: len, role: 'hi' },
                { off: len / 2, role: 'center' },
            ],
            hostId: kind === HW_KIND.INSERT && it.insertHost ? it.insertHost.part.id : null,
            pushable: !isBeam,
            isBeam,
        };
        if (kind === HW_KIND.BOLT && stack.bolt && stack.bolt.part === it.part) {
            const b = stack.bolt;
            const hs = b.headStart - start;
            const he = b.headEnd - start;
            body.contact = [hs, he];
            body.headOutside = !!b.headOutside;
            // Head outside (+end): underside faces −, tip at the − end.
            // Head inside (−end): underside faces +, tip at the + end.
            body.planes = b.headOutside
                ? [{ off: hs, role: 'lo' }, { off: he, role: 'hi' }, { off: b.shankStart - start, role: 'tip' }]
                : [{ off: hs, role: 'lo' }, { off: he, role: 'hi' }, { off: b.shankEnd - start, role: 'tip' }];
        }
        bodies.push(body);
    });
    return bodies;
}

/**
 * Where every body goes when `moverId` moves to `newStart`.
 * @param {object[]} bodies   drag-start snapshot (axisBodiesFromStack)
 * @param {string} moverId
 * @param {number} newStart
 * @param {{push?:boolean}} [opts]  push=false slides through without pushing
 * @returns {Map<string, number>}  id → new start, only for bodies that moved
 */
function computePush(bodies, moverId, newStart, opts = {}) {
    const out = new Map();
    const mover = (bodies || []).find(b => b.id === moverId);
    if (!mover || !Number.isFinite(newStart)) return out;
    const delta = newStart - mover.start;
    out.set(mover.id, newStart);
    const push = opts.push !== false;
    if (push && Math.abs(delta) > EPS) {
        const dir = delta > 0 ? 1 : -1;
        const lead0 = dir > 0 ? mover.start + mover.contact[1] : mover.start + mover.contact[0];
        const candidates = bodies
            .filter(b => b.id !== mover.id && b.pushable && b.hostId !== mover.id && b.len > 0)
            .map(b => ({ b, lo: b.start + b.contact[0], hi: b.start + b.contact[1] }))
            .filter(c => (dir > 0 ? c.lo >= lead0 - EPS : c.hi <= lead0 + EPS))
            .sort((a, c) => (dir > 0 ? a.lo - c.lo : c.hi - a.hi));
        let face = dir > 0 ? newStart + mover.contact[1] : newStart + mover.contact[0];
        candidates.forEach(c => {
            const near = dir > 0 ? c.lo : c.hi;
            const overrun = dir > 0 ? face - near : near - face;
            if (overrun > EPS) {
                const shift = dir * overrun;
                out.set(c.b.id, c.b.start + shift);
                face = dir > 0 ? c.hi + shift : c.lo + shift;
            }
        });
    }
    // Inserts ride with their host
    (bodies || []).forEach(b => {
        if (!b.hostId || !out.has(b.hostId) || out.has(b.id)) return;
        const host = bodies.find(h => h.id === b.hostId);
        if (host) out.set(b.id, b.start + (out.get(b.hostId) - host.start));
    });
    return out;
}

/**
 * Seating detent for a push: when the chain a mover pushes would run a pushed
 * part past a beam or datum face by no more than `reach`, back the whole move
 * off so that part rests on the face instead. Pulling further than `reach`
 * pushes through (placement stays permissive).
 * @param {object[]} bodies
 * @param {string} moverId
 * @param {number} newStart   desired mover start (after snapping)
 * @param {{pos:number, role:string, kind:string, label?:string}[]} targets  snap targets; beam/datum faces act as seats
 * @param {number} reach      inches
 * @returns {{start:number, seat:object|null}}
 */
function seatPush(bodies, moverId, newStart, targets, reach) {
    const res = { start: newStart, seat: null };
    const mover = (bodies || []).find(b => b.id === moverId);
    if (!mover || !(reach > 0) || !Number.isFinite(newStart)) return res;
    const delta = newStart - mover.start;
    if (Math.abs(delta) < EPS) return res;
    const dir = delta > 0 ? 1 : -1;
    const seats = (targets || []).filter(t => (t.kind === 'beam' || t.kind === 'datum') && t.role === (dir > 0 ? 'lo' : 'hi'));
    if (!seats.length) return res;
    const moved = computePush(bodies, moverId, newStart);
    let worst = 0;
    let seat = null;
    let through = false;
    moved.forEach((start, id) => {
        if (id === moverId) return;
        const b = bodies.find(x => x.id === id);
        if (!b || b.hostId) return;
        const oldFace = dir > 0 ? b.start + b.contact[1] : b.start + b.contact[0];
        const newFace = dir > 0 ? start + b.contact[1] : start + b.contact[0];
        seats.forEach(t => {
            const ahead = dir > 0 ? t.pos >= oldFace - EPS : t.pos <= oldFace + EPS;
            const overrun = dir > 0 ? newFace - t.pos : t.pos - newFace;
            if (!ahead || overrun <= EPS) return;
            if (overrun > reach) { through = true; return; }
            if (overrun > worst) { worst = overrun; seat = { ...t, partId: id }; }
        });
    });
    if (through || !seat) return res;
    res.start = newStart - dir * worst;
    res.seat = seat;
    return res;
}

/**
 * Snap spots for a mover.
 * @param {object[]} bodies
 * @param {string} moverId
 * @param {{extraPlanes?:{pos:number,role:string,label?:string}[], gaps?:{a:number,b:number,label?:string}[], home?:number|null}} [ctx]
 * @returns {{pos:number, role:string, label:string, kind:string}[]}
 */
function collectSnapTargets(bodies, moverId, ctx = {}) {
    const targets = [];
    const skip = new Set([moverId]);
    (bodies || []).forEach(b => { if (b.hostId === moverId) skip.add(b.id); });
    (bodies || []).forEach(b => {
        if (skip.has(b.id)) return;
        const lo = b.start + b.contact[0];
        const hi = b.start + b.contact[1];
        const what = b.isBeam ? 'beam face' : (b.label || b.type);
        targets.push({ pos: lo, role: 'lo', label: what, kind: b.isBeam ? 'beam' : 'part' });
        targets.push({ pos: hi, role: 'hi', label: what, kind: b.isBeam ? 'beam' : 'part' });
    });
    // Gaps between consecutive beams on this axis
    const beams = (bodies || []).filter(b => b.isBeam && !skip.has(b.id)).sort((a, c) => a.start - c.start);
    for (let i = 1; i < beams.length; i++) {
        const a = beams[i - 1].start + beams[i - 1].len;
        const b = beams[i].start;
        if (b - a > 0.01) targets.push({ pos: (a + b) / 2, role: 'center', label: 'between beams', kind: 'gap' });
    }
    (ctx.gaps || []).forEach(g => {
        if (!Number.isFinite(g.a) || !Number.isFinite(g.b)) return;
        const lo = Math.min(g.a, g.b);
        const hi = Math.max(g.a, g.b);
        targets.push({ pos: (lo + hi) / 2, role: 'center', label: g.label || 'between beams', kind: 'gap' });
        targets.push({ pos: lo, role: 'hi', label: g.faceLabel || 'beam face', kind: 'beam' });
        targets.push({ pos: hi, role: 'lo', label: g.faceLabel || 'beam face', kind: 'beam' });
    });
    (ctx.extraPlanes || []).forEach(p => {
        if (Number.isFinite(p.pos)) targets.push({ pos: p.pos, role: p.role || 'hi', label: p.label || 'face', kind: p.kind || 'plane' });
    });
    if (Number.isFinite(ctx.home)) targets.push({ pos: ctx.home, role: 'home', label: 'tight position', kind: 'home' });
    return targets;
}

function matchPriority(planeRole, targetRole) {
    if (targetRole === 'home') return null;
    if (planeRole === 'center') return targetRole === 'center' ? SNAP_PRIORITY.center : null;
    if (targetRole === 'center') return null;
    if (planeRole === 'tip') return SNAP_PRIORITY.tip;
    if ((planeRole === 'lo' && targetRole === 'hi') || (planeRole === 'hi' && targetRole === 'lo')) return SNAP_PRIORITY.contact;
    return SNAP_PRIORITY.coplanar;
}

/**
 * Snap a mover's desired start to the best spot within `threshold` (inches).
 * @returns {{start:number, target:object|null, plane:object|null}}
 */
function snapStart(mover, desiredStart, targets, threshold) {
    const res = { start: desiredStart, target: null, plane: null };
    if (!mover || !Number.isFinite(desiredStart) || !(threshold > 0)) return res;
    let best = null;
    (targets || []).forEach(t => {
        if (t.role === 'home') {
            const d = Math.abs(t.pos - desiredStart);
            if (d <= threshold) {
                const score = d - SNAP_PRIORITY.home * threshold * 0.15;
                if (!best || score < best.score) best = { score, start: t.pos, target: t, plane: null };
            }
            return;
        }
        (mover.planes || []).forEach(pl => {
            const pri = matchPriority(pl.role, t.role);
            if (pri == null) return;
            const start = t.pos - pl.off;
            const d = Math.abs(start - desiredStart);
            if (d > threshold) return;
            const score = d - pri * threshold * 0.15;
            if (!best || score < best.score) best = { score, start, target: t, plane: pl };
        });
    });
    if (best) {
        res.start = best.start;
        res.target = best.target;
        res.plane = best.plane;
    }
    return res;
}

const RIDE_TOLERANCE_IN = 0.02;

/**
 * Washers that sit under a bolt head and travel with it when the bolt is
 * driven in (fasten animation): along the shank from the head underside,
 * contiguous washers / lock washers up to the first gap or other part.
 * Works on laid-out part records; `buildOf(rec)` returns the layout facts
 * written by hwLayoutAxisParts: { partType, axisPos (centre), len, flip,
 * headH, renderAxisKey }.
 * @returns {object[]} the rider records, nearest first
 */
function washersUnderHead(boltRec, recs, buildOf = r => r) {
    const b = buildOf(boltRec);
    if (!b || b.partType !== 'bolt') return [];
    const shaftSign = b.flip ? -1 : 1;
    // Origin is the bolt's axial centre; the head sits at the end opposite the shaft
    const headUnder = b.axisPos - shaftSign * (b.len / 2 - (b.headH || 0));
    const along = (recs || [])
        .filter(r => r !== boltRec && buildOf(r) && buildOf(r).renderAxisKey === b.renderAxisKey)
        .map(r => {
            const rb = buildOf(r);
            const near = (rb.axisPos - headUnder) * shaftSign - (rb.len || 0) / 2;
            return { r, near, far: near + (rb.len || 0), type: rb.partType };
        })
        .filter(x => x.far > RIDE_TOLERANCE_IN)
        .sort((a, c) => a.near - c.near);
    const riders = [];
    let cursor = 0;
    for (const x of along) {
        if (x.near > cursor + RIDE_TOLERANCE_IN) break;
        if (x.type !== 'washer' && x.type !== 'lockWasher') break;
        riders.push(x.r);
        cursor = Math.max(cursor, x.far);
    }
    return riders;
}

const _moduleExports = {
    SNAP_PRIORITY,
    axisBodiesFromStack,
    computePush,
    seatPush,
    collectSnapTargets,
    snapStart,
    washersUnderHead,
};

bridgeGlobals(_moduleExports, 'hwSnap');

export { SNAP_PRIORITY, axisBodiesFromStack, computePush, seatPush, collectSnapTargets, snapStart, washersUnderHead };
