// ============================================================================
// LINKAGE LAB - Hardware stack layout engine (ES module, no THREE dependency)
//
// One axis of a hardware assembly is a 1-D stack of parts along the bolt line.
// This module turns an ordered list of parts into seated intervals:
//
//   datum (origin) ─► member ─► member ─► … ─► nut          "members" stack flush
//        ▲ bolt head seats on a face, its shank passes THROUGH the members
//
// Rules
//   • Members (beam, washer, lockWasher) and hex nuts are laid flush in `seq`
//     order. `qty` copies sit flush on each other. The only positional input
//     is `gapBefore` (inches, ≥ 0), and it pushes everything after it.
//   • Inserts (bushing, rivet nut) sit INSIDE the bore of the member laid just
//     before them, flush with that member's outer face; only a flange (if any)
//     adds thickness to the stack.
//   • Exactly one bolt per axis is honoured. It never consumes stack thickness:
//       flipAxis = false  → head inside the datum: head underside seats on the
//                            inner face of the datum wall (bracket wall or 0),
//                            shank points + through the members.
//       flipAxis = true   → head outside: head seats on the outermost face of
//                            the stack (after every member and nut, whatever
//                            the bolt's list position), shank points − back
//                            through the members (and the datum wall).
//   • `centered` stacks (sandwich centre slot) are shifted so the members
//     straddle the origin: [origin − span/2, origin + span/2].
//   • Exploded positions keep the order and add a uniform gap per rank.
//   • Nothing here reads state or the DOM, so it is unit-testable.
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';

const HW_KIND = Object.freeze({ MEMBER: 'member', INSERT: 'insert', BOLT: 'bolt', NUT: 'nut', BRACKET: 'bracket' });

/** Default thread pitch (inches) when a bolt has no metric/thread spec: 1/2"-13. */
const DEFAULT_THREAD_PITCH_IN = 1 / 13;
/** Threads that should show past a nut for full engagement. */
const NUT_PROTRUSION_THREADS = 2;
/** A bolt protruding more than this (inches) past the nut / stack is flagged as long. */
const LONG_PROTRUSION_IN = 0.5;
/** Bores this much smaller than the bolt still count as a clearance fit (5/16" parts on an M8 bolt). */
const BORE_TOLERANCE_IN = 0.005;

function num(v, def = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
}

function qtyOf(part) {
    return Math.max(1, Math.round(num(part && part.qty, 1)));
}

function classifyPart(part) {
    if (!part) return HW_KIND.MEMBER;
    const p = part.params || {};
    switch (part.type) {
        case 'bolt': return HW_KIND.BOLT;
        case 'nut': return p.style === 'rivet' ? HW_KIND.INSERT : HW_KIND.NUT;
        case 'bushing': return HW_KIND.INSERT;
        case 'bracket': return HW_KIND.BRACKET;
        default: return HW_KIND.MEMBER;
    }
}

/** Body length and flange thickness of an insert (bushing / rivet nut). */
function insertDims(part) {
    const p = (part && part.params) || {};
    const total = partAxialLength(part);
    let flange = 0;
    if (part.type === 'bushing') {
        if (p.flangeOd && p.flangeThickness && num(p.flangeOd) > num(p.od)) flange = num(p.flangeThickness);
    } else if (part.type === 'nut' && p.style === 'rivet') {
        if (p.flangeOd && p.flangeThickness) flange = num(p.flangeThickness);
    }
    flange = Math.min(flange, total);
    return { bodyLen: total - flange, flangeLen: flange, len: total };
}

/** Bolt head height along the axis (inches). */
function partHeadHeight(part) {
    const p = (part && part.params) || {};
    return Math.max(0.02, num(p.headHeight, num(p.diameter, 0.25) * 0.6));
}

/** Bolt shank length (inches), head excluded. */
function partShankLength(part) {
    const p = (part && part.params) || {};
    return Math.max(0.1, num(p.length, 1));
}

/**
 * Axial extent of one copy of a part (inches). Matches the mesh builders in
 * hardware-detail.js (their minimums are reconciled here).
 */
function partAxialLength(part) {
    const p = (part && part.params) || {};
    switch (part && part.type) {
        case 'bolt':
            return partShankLength(part) + partHeadHeight(part);
        case 'bushing': {
            let len = Math.max(0.05, num(p.length, 0.5));
            if (p.flangeOd && p.flangeThickness && num(p.flangeOd) > num(p.od)) len += num(p.flangeThickness);
            return len;
        }
        case 'washer':
            return Math.max(0.01, num(p.thickness, 0.0625));
        case 'lockWasher':
            return Math.max(0.02, num(p.thickness, 0.0625));
        case 'nut': {
            if (p.style === 'rivet') {
                let len = Math.max(0.05, num(p.length, num(p.height, 0.5)));
                if (p.flangeOd && p.flangeThickness) len += num(p.flangeThickness);
                return len;
            }
            return Math.max(0.05, num(p.height, num(p.length, 0.4375)));
        }
        case 'beam':
            return Math.max(0.25, num(p.thickness, 1.5));
        case 'bracket':
            return Math.max(0.2, num(p.height, 3.77));
        default:
            return 0.1;
    }
}

/** Hole / bore diameter a bolt must pass through, or null when the part has none. */
function partBoreDiameter(part) {
    const p = (part && part.params) || {};
    switch (part && part.type) {
        case 'beam': return p.holeDiameter != null ? num(p.holeDiameter) : null;
        case 'washer':
        case 'lockWasher':
        case 'bushing':
        case 'nut':
            return p.id != null ? num(p.id) : null;
        default: return null;
    }
}

function threadPitchOf(bolt) {
    const p = (bolt && bolt.params) || {};
    const metric = String(p.metric || '');
    const m = metric.match(/x\s*([\d.]+)/i);
    if (m) return num(m[1]) / 25.4;
    const thread = String(p.thread || '');
    const t = thread.match(/-\s*(\d+)\s*$/);
    if (t && num(t[1]) > 0) return 1 / num(t[1]);
    return DEFAULT_THREAD_PITCH_IN;
}

function gapBeforeOf(part) {
    return Math.max(0, num(part && part.gapBefore, 0));
}

/**
 * Seated layout of one axis.
 * @param {object[]} parts  parts on this axis (brackets are ignored)
 * @param {{origin?:number, centered?:boolean, datumWall?:number}} [opts]
 *   origin    axis position of the datum face (default 0)
 *   centered  sandwich centre slot: members straddle the origin
 *   datumWall thickness of the wall at the datum (bracket wall) that an
 *             inside-head bolt passes through (default 0)
 */
function computeAxisStack(parts, opts = {}) {
    const origin = num(opts.origin, 0);
    const wall = Math.max(0, num(opts.datumWall, 0));
    const centered = !!opts.centered;
    const sorted = (parts || [])
        .filter(p => p && classifyPart(p) !== HW_KIND.BRACKET)
        .slice()
        .sort((a, b) => num(a.seq) - num(b.seq));

    const items = [];
    let cursor = origin;
    let rank = 0;
    let bolt = null;
    const extraBolts = [];
    let nut = null;
    let lastMember = null;

    sorted.forEach(part => {
        const kind = classifyPart(part);
        if (kind === HW_KIND.BOLT) {
            if (!bolt) {
                // Bolt is placed once the rest of the axis is known (see below)
                bolt = { part, seqCursor: cursor, seqRank: rank };
            } else {
                extraBolts.push(part);
            }
            return;
        }
        if (kind === HW_KIND.INSERT && lastMember) {
            // Sits inside the previous member's bore, flush with the face at the cursor.
            // The flange (if any) rests on that face and is the only thickness added.
            const { bodyLen, flangeLen, len } = insertDims(part);
            const face = cursor;
            const start = face - bodyLen;
            items.push({ part, kind, copyIndex: 0, start, end: face + flangeLen, len, rank, gapBefore: 0, partBase: start, baseStart: start, insertHost: lastMember, bodyLen, flangeLen });
            rank += 1;
            cursor = face + flangeLen;
            if (part.type === 'nut' && !nut) nut = items[items.length - 1];
            return;
        }
        const len = partAxialLength(part);
        const qty = qtyOf(part);
        const gap = gapBeforeOf(part);
        const partBase = cursor + gap;
        for (let c = 0; c < qty; c++) {
            const start = partBase + len * c;
            const it = { part, kind: kind === HW_KIND.INSERT ? HW_KIND.MEMBER : kind, copyIndex: c, start, end: start + len, len, rank, gapBefore: c === 0 ? gap : 0, partBase, baseStart: start };
            items.push(it);
            rank += 1;
            if (it.kind === HW_KIND.MEMBER) lastMember = it;
        }
        cursor = partBase + len * qty;
        if (kind === HW_KIND.NUT && !nut) nut = items[items.length - 1];
    });

    const membersEnd = cursor;

    // Extra bolts are laid out like members so they at least stay visible
    extraBolts.forEach(part => {
        const len = partAxialLength(part);
        const gap = gapBeforeOf(part);
        const start = cursor + gap;
        items.push({ part, kind: HW_KIND.MEMBER, copyIndex: 0, start, end: start + len, len, rank, gapBefore: gap, partBase: start, baseStart: start, extraBolt: true });
        rank += 1;
        cursor = start + len;
    });

    let boltInfo = null;
    if (bolt) {
        const part = bolt.part;
        const headH = partHeadHeight(part);
        const shankL = partShankLength(part);
        const len = headH + shankL;
        const headOutside = !!part.flipAxis;
        let headStart, headEnd, shankStart, shankEnd, start, end;
        if (headOutside) {
            // Head seats on the outermost face of the stack; shank runs back toward the datum
            const face = membersEnd + gapBeforeOf(part);
            headStart = face; headEnd = face + headH;
            shankEnd = face; shankStart = face - shankL;
            start = shankStart; end = headEnd;
        } else {
            // Head inside the datum wall; shank runs + through the wall and members
            const face = origin - wall - gapBeforeOf(part);
            headEnd = face; headStart = face - headH;
            shankStart = face; shankEnd = face + shankL;
            start = headStart; end = shankEnd;
        }
        boltInfo = { part, headOutside, headH, shankL, headStart, headEnd, shankStart, shankEnd, start, end, len };
        items.push({ part, kind: HW_KIND.BOLT, copyIndex: 0, start, end, len, rank: headOutside ? rank : bolt.seqRank, gapBefore: gapBeforeOf(part), partBase: start, baseStart: start, headOutside });
    }

    let shift = 0;
    if (centered) {
        const span = membersEnd - origin;
        shift = -span / 2;
        items.forEach(it => { it.start += shift; it.end += shift; it.partBase += shift; it.baseStart += shift; });
        if (boltInfo) ['headStart', 'headEnd', 'shankStart', 'shankEnd', 'start', 'end'].forEach(k => { boltInfo[k] += shift; });
    }

    const stackItems = items.filter(it => it.kind !== HW_KIND.BOLT);
    const start = stackItems.length ? Math.min(...stackItems.map(it => it.start)) : origin + shift;
    const end = stackItems.length ? Math.max(...stackItems.map(it => it.end)) : origin + shift;

    const stack = {
        origin: origin + shift,
        datumWall: wall,
        centered,
        items,
        start,
        end,
        span: Math.max(0, end - start),
        membersEnd: membersEnd + shift,
        bolt: boltInfo,
        nut: nut || null,
        lastRank: rank - 1,
    };
    stack.fit = checkAxisFit(stack);
    return stack;
}

/** Clamped thickness a bolt has to span: datum wall + every member and nut. */
function stackGripLength(stack) {
    if (!stack) return 0;
    return Math.max(0, (stack.membersEnd - stack.origin) + (stack.datumWall || 0));
}

/**
 * Fit check. Returns [{ partId, level:'warn'|'info', code, message, value }].
 */
function checkAxisFit(stack) {
    const out = [];
    if (!stack) return out;
    const bolt = stack.bolt;
    const members = stack.items.filter(it => (it.kind === HW_KIND.MEMBER || it.kind === HW_KIND.INSERT) && !it.extraBolt);
    const nutItems = stack.items.filter(it => it.kind === HW_KIND.NUT || (it.kind === HW_KIND.INSERT && it.part.type === 'nut'));
    stack.items.filter(it => it.extraBolt).forEach(it => {
        out.push({ partId: it.part.id, level: 'warn', code: 'extra-bolt', message: 'Only one bolt per axis is threaded through the stack; this one is laid out as a spacer.' });
    });
    if (!bolt) {
        if (nutItems.length) out.push({ partId: nutItems[0].part.id, level: 'info', code: 'no-bolt', message: 'Nut without a bolt on this axis.' });
        return out;
    }
    const p = bolt.part;
    const dia = num(p.params && p.params.diameter, 0);
    const pitch = threadPitchOf(p);

    // Clamp span the shank must cover, measured from the head underside
    let required;
    let protrusion;
    if (bolt.headOutside) {
        // shank runs from the head face back toward the datum, through members and the wall
        required = bolt.headStart - (stack.origin - (stack.datumWall || 0));
        protrusion = bolt.shankL - required;
    } else {
        const farFace = nutItems.length ? Math.max(...nutItems.map(n => n.end)) : stack.membersEnd;
        required = farFace - bolt.shankStart;
        if (nutItems.length) required += NUT_PROTRUSION_THREADS * pitch;
        protrusion = bolt.shankL - required;
    }
    if (protrusion < -1e-6) {
        out.push({ partId: p.id, level: 'warn', code: 'bolt-short', value: -protrusion,
            message: `Bolt is ${(-protrusion).toFixed(2)} in short: needs ${required.toFixed(2)} in of shank, has ${bolt.shankL.toFixed(2)} in.` });
    } else if (protrusion > LONG_PROTRUSION_IN) {
        out.push({ partId: p.id, level: 'info', code: 'bolt-long', value: protrusion,
            message: `Bolt protrudes ${protrusion.toFixed(2)} in past the stack.` });
    }

    // Threads must reach the nut (only meaningful with a nut and a finite thread length)
    const threadLen = num(p.params && p.params.threadLength, 0);
    if (nutItems.length && threadLen > 0 && !bolt.headOutside) {
        const nutSpan = nutItems.reduce((s, n) => s + n.len, 0);
        const needed = nutSpan + Math.max(0, protrusion);
        if (threadLen + 1e-6 < needed) {
            out.push({ partId: p.id, level: 'warn', code: 'thread-short', value: needed - threadLen,
                message: `Thread length ${threadLen.toFixed(2)} in does not reach through the nut (needs ${needed.toFixed(2)} in).` });
        }
    }

    // Every member and nut on the shank must clear the bolt diameter
    if (dia > 0) {
        [...members, ...nutItems].forEach(it => {
            if (it.copyIndex !== 0) return;
            const bore = partBoreDiameter(it.part);
            if (bore != null && bore + BORE_TOLERANCE_IN < dia) {
                out.push({ partId: it.part.id, level: 'warn', code: 'hole-small', value: dia - bore,
                    message: `Hole ${bore.toFixed(3)} in is smaller than the ${dia.toFixed(3)} in bolt.` });
            }
        });
    }
    if (!nutItems.length && !bolt.headOutside && members.length) {
        out.push({ partId: p.id, level: 'info', code: 'no-nut', message: 'Bolt has no nut on this axis.' });
    }
    return out;
}

/**
 * Exploded positions: members and nuts fan out by a uniform gap per rank;
 * the bolt withdraws away from the stack on its head side.
 * Returns a Map(item → explodedStart).
 */
function explodeAxisStack(stack, gapIn) {
    const gap = Math.max(0, num(gapIn, 1));
    const out = new Map();
    if (!stack) return out;
    const lastRank = Math.max(0, stack.lastRank);
    stack.items.forEach(it => {
        if (it.kind === HW_KIND.BOLT) {
            out.set(it, it.headOutside ? it.start + gap * (lastRank + 1) : it.start - gap);
        } else {
            out.set(it, it.start + gap * it.rank);
        }
    });
    return out;
}

/** Blend between assembled and exploded start for one item. */
function blendedStart(item, explodedStart, explode) {
    const e = Math.min(1, Math.max(0, num(explode, 0)));
    return (1 - e) * item.start + e * explodedStart;
}

const _moduleExports = {
    HW_KIND,
    classifyPart,
    partAxialLength,
    partHeadHeight,
    partShankLength,
    partBoreDiameter,
    insertDims,
    computeAxisStack,
    stackGripLength,
    checkAxisFit,
    explodeAxisStack,
    blendedStart,
};

bridgeGlobals(_moduleExports, 'hwStackLayout');

export { HW_KIND, classifyPart, partAxialLength, partHeadHeight, partShankLength, partBoreDiameter, insertDims, computeAxisStack, stackGripLength, checkAxisFit, explodeAxisStack, blendedStart };
