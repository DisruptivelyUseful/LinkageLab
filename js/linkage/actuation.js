// ============================================================================
// LINKAGE LAB — Actuation planner (pure math, no DOM / THREE)
//
// Where can a motor, linear actuator, cable or winch push or pull on the scissor
// ring so it deploys itself? Every placement is a pair of "anchors": points that
// ride on a named part of a module (a pivot bolt, a beam, an upright, the floor
// track) and can be evaluated at ANY fold angle. The required force comes from
// virtual work on the structure's potential energy:
//
//     tension T(θ) = −(dU/dθ) / (dL/dθ)        U = Σ weight × height
//
// (T > 0: the drive must PULL its ends together, T < 0: it must PUSH them
// apart). Pivot friction is a flat efficiency factor and ground drag of the
// sliding feet is a Coulomb term. This is an estimate for motor selection, not a
// structural analysis: no dynamics, wind, or load sharing between modules.
//
// Units: inches, pounds, degrees in the public API (radians internally).
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { INCHES_PER_FOOT, MIN_SAFE_DIMENSION } from './constants.js';
import { radToDeg } from './math.js';
import { getOptimalClosedAngleForAnimation, computeModulePivots } from './joint-kinematics.js';
import { solveLinkage, calculateCenterOfMass, getEffectiveMinFoldAngle, computeRingVerticalLayout } from './solver.js';

const LB_IN_TO_J = 0.1129848;      // 1 lb·in in joules
const LB_TO_N = 4.4482216;
const IN_TO_M = 0.0254;

export const ACTUATION_SAMPLES = 25;

// ----------------------------------------------------------------------------
// State shape
// ----------------------------------------------------------------------------

export const DEFAULT_ACTUATION = Object.freeze({
    enabled: false,
    show3D: true,
    placement: 'hScissor',
    drives: { count: 0, pattern: 'all' },          // count 0 = every module; pattern 'all' | 'alternate'
    params: {
        hScissorR: 24,       // in, along each bottom H beam from the crossing toward the inner pivots
        hScissorE: 4,        // in, lever tabs off the beam faces, pointing away from each other (packed clearance = 2e)
        xDiagLow: 12,        // in, up upright A from its foot
        xDiagHigh: 60,       // in, up upright B from its foot
        mastHeightIn: 120,   // in, central mast top above the ground
        trackTailIn: 18,     // in, winch / actuator body behind the outer pivot on the track
    },
    load: {
        includePanels: false,    // panels are usually hung after deployment
        extraRoofLoadLb: 0,      // extra weight carried on the top ring (snow, rigging)
        efficiencyPct: 85,       // pivot / drive train efficiency
        groundMu: 0.3,           // friction coefficient of the feet sliding on the ground
        safetyFactor: 1.5,
    },
    motor: {
        deployTimeSec: 60,
        systemVolts: 12,
        electricalEfficiencyPct: 50,   // motor + gearing, electrical in → mechanical out
        ratedForceLb: 0,               // 0 = auto (peak × safety factor); used for the hand-over readout
        costEach: 120,
    },
});

const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (v, def) => (typeof v === 'number' && Number.isFinite(v)) ? v : def;
const clampNum = (v, def, min, max) => Math.max(min, Math.min(max, num(v, def)));

export function createDefaultActuation() { return clone(DEFAULT_ACTUATION); }

export function normalizeActuation(raw) {
    const d = DEFAULT_ACTUATION;
    const r = raw && typeof raw === 'object' ? raw : {};
    const dr = r.drives || {}, pr = r.params || {}, lo = r.load || {}, mo = r.motor || {};
    return {
        enabled: !!r.enabled,
        show3D: r.show3D !== false,
        placement: PLACEMENTS[r.placement] ? r.placement : d.placement,
        drives: {
            count: Math.max(0, Math.min(64, Math.round(num(dr.count, d.drives.count)))),
            pattern: dr.pattern === 'alternate' ? 'alternate' : 'all',
        },
        params: {
            hScissorR: clampNum(pr.hScissorR, d.params.hScissorR, -600, 600),
            hScissorE: clampNum(pr.hScissorE, d.params.hScissorE, -120, 120),
            xDiagLow: clampNum(pr.xDiagLow, d.params.xDiagLow, 0, 600),
            xDiagHigh: clampNum(pr.xDiagHigh, d.params.xDiagHigh, 0, 600),
            mastHeightIn: clampNum(pr.mastHeightIn, d.params.mastHeightIn, 1, 2400),
            trackTailIn: clampNum(pr.trackTailIn, d.params.trackTailIn, 0, 600),
        },
        load: {
            includePanels: !!lo.includePanels,
            extraRoofLoadLb: clampNum(lo.extraRoofLoadLb, d.load.extraRoofLoadLb, 0, 100000),
            efficiencyPct: clampNum(lo.efficiencyPct, d.load.efficiencyPct, 5, 100),
            groundMu: clampNum(lo.groundMu, d.load.groundMu, 0, 2),
            safetyFactor: clampNum(lo.safetyFactor, d.load.safetyFactor, 1, 10),
        },
        motor: {
            deployTimeSec: clampNum(mo.deployTimeSec, d.motor.deployTimeSec, 1, 36000),
            systemVolts: clampNum(mo.systemVolts, d.motor.systemVolts, 1, 1000),
            electricalEfficiencyPct: clampNum(mo.electricalEfficiencyPct, d.motor.electricalEfficiencyPct, 5, 100),
            ratedForceLb: clampNum(mo.ratedForceLb, d.motor.ratedForceLb, 0, 100000),
            costEach: clampNum(mo.costEach, d.motor.costEach, 0, 100000),
        },
    };
}

export function serializeActuation(a) { return normalizeActuation(a); }

// ----------------------------------------------------------------------------
// Placement catalog
// ----------------------------------------------------------------------------

/**
 * Anchor spec: a point riding on a part of one module.
 *   part   'botInner' | 'botOuter' | 'topInner' | 'topOuter' | 'hBeamA' | 'hBeamB'
 *          | 'uprightA' | 'uprightB' | 'track' | 'mast'
 *   along  inches along the part: H beams from the crossing toward their inner end
 *          (negative = toward the outer end); uprights from their foot; track from the
 *          outer pivot toward the inner pivot (negative = behind the pin).
 *   across inches perpendicular (plan left-normal for H beams and the track, in-plane
 *          normal for uprights).
 *   lift   inches vertical.
 */
export const PLACEMENTS = Object.freeze({
    hScissor: {
        label: 'Lead screw across the bottom H-scissor',
        short: 'H-scissor screw',
        family: 'screw',
        summary: 'Push the two bottom H beams apart near their crossing with a lead screw: gearmotor and screw pivot on beam A, a trunnion nut on beam B, the screw protruding past the nut when packed. The lever arm keeps the stroke short and the gravity force is nearly flat from packed to deployed, so no kick-off helper is needed; the short stroke does magnify feet drag near closure. Ground level, inside the ring, self-locking.',
        anchors: (p) => [
            // tabs point away from each other: packed length = 2e, L = 2(r·sin(θ/2) + e·cos(θ/2))
            { part: 'hBeamA', along: p.hScissorR, across: -p.hScissorE, lift: 0 },
            { part: 'hBeamB', along: p.hScissorR, across: p.hScissorE, lift: 0 },
        ],
        mountText: (p) => [
            `Bottom H-beam A, ${fmtIn(p.hScissorR)} from the crossing toward the inner pivot, tab ${fmtIn(Math.abs(p.hScissorE))} off the beam`,
            `Bottom H-beam B, ${fmtIn(p.hScissorR)} from the crossing toward the inner pivot, tab ${fmtIn(Math.abs(p.hScissorE))} off the beam`,
        ],
        hardware: '12 V worm gearmotor on an Acme or ball screw (screw length ≈ stroke + nut + 6 in), trunnion nut with a clevis tab bolted through the other H stack, limit switches at both ends.',
    },
    trackCable: {
        label: 'Cable + winch along the radial floor track',
        short: 'Track cable',
        family: 'cable',
        summary: 'A winch on the tail of each radial floor beam pulls the inner pivot bolt toward the outer pivot along the slot; gravity lowers the roof under the winch brake. Cheapest drive, but the pull is highest when the structure lies flat, so it wants a kick-off helper or a less-flat packed angle.',
        anchors: (p) => [
            { part: 'track', along: -p.trackTailIn, across: 0, lift: 0 },
            { part: 'botInner', along: 0, across: 0, lift: 0 },
        ],
        mountText: (p) => [
            `Winch on the radial track, ${fmtIn(p.trackTailIn)} behind the outer bottom pivot`,
            'Inner bottom pivot bolt (the slot rider)',
        ],
        hardware: '12 V ATV-class winch (or a capstan drum on a gearmotor), wire rope or Dyneema along the track, limit switches, dynamic brake for lowering.',
    },
    trackScrew: {
        label: 'Lead screw / linear actuator along the radial floor track',
        short: 'Track screw',
        family: 'screw',
        summary: 'A linear actuator or lead-screw rail lying on the radial floor beam between the outer pivot and the inner pivot bolt. Push-pull and self-locking, same force curve as the cable but it also lowers under power. Needs an actuator with the full slot travel as its stroke.',
        anchors: (p) => [
            { part: 'track', along: -p.trackTailIn, across: 0, lift: 0 },
            { part: 'botInner', along: 0, across: 0, lift: 0 },
        ],
        mountText: (p) => [
            `Actuator body on the radial track, ${fmtIn(p.trackTailIn)} behind the outer bottom pivot`,
            'Inner bottom pivot bolt (the slot rider)',
        ],
        hardware: 'Long-stroke 12/24 V linear actuator or ball-screw rail with a stepper / gearmotor, mounted on the track beam.',
    },
    xDiagonal: {
        label: 'Diagonal across the vertical X (scissor-lift style)',
        short: 'X diagonal',
        family: 'linear',
        summary: 'The classic scissor-lift cylinder: between one upright near its foot and the other upright above the crossing. Short stroke, but the force spikes when the X lies flat, exactly like a scissor lift starting from its lowest position.',
        anchors: (p) => [
            { part: 'uprightA', along: p.xDiagLow, across: 0, lift: 0 },
            { part: 'uprightB', along: p.xDiagHigh, across: 0, lift: 0 },
        ],
        mountText: (p) => [
            `Upright A, ${fmtIn(p.xDiagLow)} up from its foot (inner bottom pivot)`,
            `Upright B, ${fmtIn(p.xDiagHigh)} up from its foot (outer bottom pivot)`,
        ],
        hardware: 'Heavy 12 V linear actuator (or hydraulic cylinder) with cross-bolted clevises through the V stack.',
    },
    verticalJack: {
        label: 'Vertical jack between the rings (comparison)',
        short: 'Vertical jack',
        family: 'linear',
        summary: 'A telescoping strut from the bottom inner pivot straight up to the top inner pivot. The force is simply the lifted weight per module and never spikes, but the stroke is the whole deployed height, so it is listed for comparison rather than recommended.',
        anchors: () => [
            { part: 'botInner', along: 0, across: 0, lift: 0 },
            { part: 'topInner', along: 0, across: 0, lift: 0 },
        ],
        mountText: () => ['Inner bottom pivot bolt', 'Inner top pivot bolt'],
        hardware: 'Multi-stage telescoping lead screw or a cable hoist over a tall mast.',
    },
    mastCable: {
        label: 'Central mast, cables to the top ring',
        short: 'Mast cables',
        family: 'cable',
        summary: 'One winch at the base of a central mast; the cable runs over the mast head and splits into one line per top inner pivot. The lift is direct, so the force per cable stays near the lifted weight per module. The mast must stand taller than the deployed roof and the ring centre wanders while the chain unfolds, so the lines go slack-to-taut unevenly.',
        anchors: (p) => [
            { part: 'mast', along: 0, across: 0, lift: p.mastHeightIn },
            { part: 'topInner', along: 0, across: 0, lift: 0 },
        ],
        mountText: (p) => [`Mast head, ${fmtIn(p.mastHeightIn)} above the ground at the deployed ring centre`, 'Inner top pivot bolt'],
        hardware: 'One 12 V winch, a mast (or the IBC tote column with a gin pole), a spider of equal-length lines.',
    },
});

export const PLACEMENT_IDS = Object.keys(PLACEMENTS);

function fmtIn(v) {
    const r = Math.round(v * 100) / 100;
    return `${Number.isInteger(r) ? r : r.toFixed(2)} in`;
}

// ----------------------------------------------------------------------------
// Anchor evaluation
// ----------------------------------------------------------------------------

/**
 * World point of an anchor on one module.
 * @param {Object} spec - anchor spec (see PLACEMENTS)
 * @param {Object} mp - module pivots entry ({ botInner, botOuter, topInner, topOuter, hCross, innerLeft, inDir })
 * @param {Object} ctx - { frame:{yMin,hStackThick}, trackY?: number, mastBase?: {x,z} }
 */
export function evaluateAnchor(spec, mp, ctx) {
    const along = num(spec.along, 0), across = num(spec.across, 0), lift = num(spec.lift, 0);
    const frame = ctx.frame || {};
    const ringY = 0; // bottom H stack is centred at y = 0 in the solver frame
    const addPlan = (p, dir, a, nrm, c, y) => ({ x: p.x + dir.x * a + nrm.x * c, y, z: p.z + dir.z * a + nrm.z * c });
    const unitPlan = (from, to) => {
        const dx = to.x - from.x, dz = to.z - from.z, l = Math.hypot(dx, dz) || 1;
        return { x: dx / l, z: dz / l };
    };
    const leftNormal = (d) => ({ x: -d.z, z: d.x });
    switch (spec.part) {
        case 'botInner': return { x: mp.botInner.x, y: mp.botInner.y + lift, z: mp.botInner.z };
        case 'botOuter': return { x: mp.botOuter.x, y: mp.botOuter.y + lift, z: mp.botOuter.z };
        case 'topInner': return { x: mp.topInner.x, y: mp.topInner.y + lift, z: mp.topInner.z };
        case 'topOuter': return { x: mp.topOuter.x, y: mp.topOuter.y + lift, z: mp.topOuter.z };
        case 'hBeamA': {
            // Pattern A runs innerLeft (bl) → botOuter (tr) through the crossing; +along = toward bl
            const d = unitPlan(mp.hCross, mp.innerLeft);
            return addPlan(mp.hCross, d, along, leftNormal(d), across, ringY + lift);
        }
        case 'hBeamB': {
            // Pattern B runs botInner (br) → outerLeft (tl) through the crossing; +along = toward br
            const d = unitPlan(mp.hCross, mp.botInner);
            return addPlan(mp.hCross, d, along, leftNormal(d), across, ringY + lift);
        }
        case 'uprightA':
        case 'uprightB': {
            const foot = spec.part === 'uprightA' ? mp.botInner : mp.botOuter;
            const head = spec.part === 'uprightA' ? mp.topOuter : mp.topInner;
            const vx = head.x - foot.x, vy = head.y - foot.y, vz = head.z - foot.z;
            const L = Math.hypot(vx, vy, vz) || 1;
            const d = { x: vx / L, y: vy / L, z: vz / L };
            // in-plane normal: rotate the leg direction 90° within the vertical plane of the X
            const hx = Math.hypot(d.x, d.z) || 1;
            const n = { x: -d.y * d.x / hx, y: hx, z: -d.y * d.z / hx };
            return { x: foot.x + d.x * along + n.x * across, y: foot.y + d.y * along + n.y * across + lift, z: foot.z + d.z * along + n.z * across };
        }
        case 'track': {
            // Radial floor track: from the outer pivot toward the inner pivot, under the ring
            const d = mp.inDir || unitPlan(mp.botOuter, mp.botInner);
            const y = ctx.trackY !== undefined ? ctx.trackY : -(num(frame.hStackThick, 0) / 2);
            return addPlan({ x: mp.botOuter.x, z: mp.botOuter.z }, d, along, leftNormal(d), across, y + lift);
        }
        case 'mast': {
            const b = ctx.mastBase || { x: 0, z: 0 };
            return { x: b.x + along, y: num(ctx.groundY, 0) + lift, z: b.z + across };
        }
        default:
            return { x: mp.hCross.x, y: ringY + lift, z: mp.hCross.z };
    }
}

/** Indices of the modules that carry a drive. */
export function driveModuleIndices(modules, drives) {
    const n = Math.max(0, modules | 0);
    const d = drives || DEFAULT_ACTUATION.drives;
    if (d.pattern === 'alternate') {
        const out = [];
        for (let i = 0; i < n; i += 2) out.push(i);
        return out;
    }
    const count = d.count > 0 ? Math.min(n, d.count) : n;
    if (count >= n) return Array.from({ length: n }, (_, i) => i);
    // spread evenly around the ring
    const out = [];
    for (let k = 0; k < count; k++) out.push(Math.round(k * n / count) % n);
    return Array.from(new Set(out)).sort((a, b) => a - b);
}

/**
 * Both ends of the chosen placement on each drive module, from solved data
 * (data.modulePivots / data.frame, pre- or post-shift alike).
 * @returns {Array<{moduleIndex:number, a:{x,y,z}, b:{x,y,z}, length:number}>}
 */
export function evaluatePlacementOnData(placementId, params, data, drives, extra = {}) {
    const pl = PLACEMENTS[placementId];
    if (!pl || !data || !Array.isArray(data.modulePivots) || !data.modulePivots.length) return [];
    const specs = pl.anchors(Object.assign({}, DEFAULT_ACTUATION.params, params || {}));
    const ctx = { frame: data.frame || {}, trackY: extra.trackY, mastBase: extra.mastBase || centroidOfBotInner(data.modulePivots), groundY: extra.groundY };
    return driveModuleIndices(data.modulePivots.length, drives).map(i => {
        const mp = data.modulePivots[i];
        if (!mp) return null;
        const a = evaluateAnchor(specs[0], mp, ctx);
        const b = evaluateAnchor(specs[1], mp, ctx);
        return { moduleIndex: i, a, b, length: dist3(a, b) };
    }).filter(Boolean);
}

function dist3(a, b) { return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); }
function centroidOfBotInner(mps) {
    if (!mps || !mps.length) return { x: 0, z: 0 };
    let x = 0, z = 0;
    mps.forEach(m => { x += m.botInner.x; z += m.botInner.z; });
    return { x: x / mps.length, z: z / mps.length };
}

// ----------------------------------------------------------------------------
// Sampling the structure over the deploy sweep
// ----------------------------------------------------------------------------

let _memo = null; // { key, samples }

function beamWeightLb(beam, st) {
    const t = beam.stackType || '';
    if (t.startsWith('horizontal')) return (st.hBeamW * st.hBeamT * INCHES_PER_FOOT) * st.woodDensity * st.hLengthFt;
    if (t.startsWith('vertical') || t.startsWith('fixed-beam')) {
        const w = beam.w || st.vBeamW, th = beam.t || st.vBeamT;
        return st.vLengthFt * (w * th * INCHES_PER_FOOT) * st.woodDensity;
    }
    return 0;
}

/**
 * Samples the solver across the deploy sweep. Each sample holds the fold angle, the
 * potential energy U (lb·in), the module pivots and the frame. Memoised on `key`
 * (pass computeGeometryHashWithoutFold() + load options from the UI).
 */
export function sampleDeploySweep(st, opts = {}) {
    const n = Math.max(5, opts.samples | 0 || ACTUATION_SAMPLES);
    const minA = opts.minAngle !== undefined ? opts.minAngle : getEffectiveMinFoldAngle();
    const maxA = opts.maxAngle !== undefined ? opts.maxAngle : getOptimalClosedAngleForAnimation();
    const load = Object.assign({}, DEFAULT_ACTUATION.load, opts.load || {});
    const key = JSON.stringify([opts.key || null, n, minA, maxA, load.includePanels, load.extraRoofLoadLb, opts.panelWeightLb || 0]);
    if (_memo && _memo.key === key && opts.key) return _memo.samples;

    const samples = [];
    for (let k = 0; k < n; k++) {
        const theta = minA + (maxA - minA) * k / (n - 1);
        const data = solveLinkage(theta);
        const com = calculateCenterOfMass(data, theta, false);
        let U = com.totalWeight * com.y;
        let W = com.totalWeight;
        const frame = data.frame || {};
        const roofExtra = num(load.extraRoofLoadLb, 0) + (load.includePanels ? num(opts.panelWeightLb, 0) : 0);
        if (roofExtra > 0) { U += roofExtra * num(frame.topH, 0); W += roofExtra; }
        // Weight resting on the ground through the bottom ring: bottom H beams + half the uprights + bottom brackets
        let wBottom = 0;
        (data.beams || []).forEach(b => {
            const t = b.stackType || '';
            if (t === 'horizontal-bottom') wBottom += beamWeightLb(b, st);
            else if (t.startsWith('vertical') || t.startsWith('fixed-beam')) wBottom += beamWeightLb(b, st) / 2;
        });
        samples.push({
            theta, thetaDeg: radToDeg(theta),
            U, totalWeight: W, weightOnGround: wBottom,
            frame, modulePivots: data.modulePivots || [],
            comY: com.y,
        });
    }
    _memo = { key, samples };
    return samples;
}

export function clearActuationMemo() { _memo = null; }

// ----------------------------------------------------------------------------
// Force analysis
// ----------------------------------------------------------------------------

function centralDiff(arr, i, xs) {
    const n = arr.length;
    if (n < 2) return 0;
    if (i === 0) return (arr[1] - arr[0]) / (xs[1] - xs[0]);
    if (i === n - 1) return (arr[n - 1] - arr[n - 2]) / (xs[n - 1] - xs[n - 2]);
    return (arr[i + 1] - arr[i - 1]) / (xs[i + 1] - xs[i - 1]);
}

/** Mean plan travel rate of the outer feet relative to the structure centroid (in per rad), per sample. */
function footTravel(samples) {
    const xs = samples.map(s => s.theta);
    const rel = samples.map(s => {
        const mps = s.modulePivots;
        if (!mps.length) return [];
        let cx = 0, cz = 0;
        mps.forEach(m => { cx += m.botOuter.x; cz += m.botOuter.z; });
        cx /= mps.length; cz /= mps.length;
        return mps.map(m => ({ x: m.botOuter.x - cx, z: m.botOuter.z - cz }));
    });
    return samples.map((s, i) => {
        const m = rel[i].length;
        if (!m) return 0;
        let sum = 0;
        for (let k = 0; k < m; k++) {
            const dx = centralDiff(rel.map(r => r[k] ? r[k].x : 0), i, xs);
            const dz = centralDiff(rel.map(r => r[k] ? r[k].z : 0), i, xs);
            sum += Math.hypot(dx, dz);
        }
        return sum / m;
    });
}

/**
 * Full analysis of one placement.
 * @param {string} placementId
 * @param {Object} a - normalized actuation state (params, drives, load, motor)
 * @param {Array} samples - from sampleDeploySweep
 * @param {Object} extra - { modules, trackY?, mastBase?, groundY? }
 */
export function analyzePlacement(placementId, a, samples, extra = {}) {
    const pl = PLACEMENTS[placementId];
    if (!pl || !samples || samples.length < 3) return null;
    const act = normalizeActuation(Object.assign({}, a, { placement: placementId }));
    const modules = extra.modules || (samples[0].modulePivots.length || 1);
    const driveIdx = driveModuleIndices(modules, act.drives);
    const nDrives = Math.max(1, driveIdx.length);
    const specs = pl.anchors(act.params);
    const xs = samples.map(s => s.theta);
    const mastBase = extra.mastBase || centroidOfBotInner(samples[samples.length - 1].modulePivots);

    // Mean drive length per sample (modules are congruent, so one length describes all drives)
    const lengths = samples.map(s => {
        const ctx = { frame: s.frame, trackY: extra.trackY, mastBase, groundY: extra.groundY };
        let sum = 0, cnt = 0;
        driveIdx.forEach(i => {
            const mp = s.modulePivots[i];
            if (!mp) return;
            sum += dist3(evaluateAnchor(specs[0], mp, ctx), evaluateAnchor(specs[1], mp, ctx));
            cnt++;
        });
        return cnt ? sum / cnt : 0;
    });
    const Us = samples.map(s => s.U);
    const eff = act.load.efficiencyPct / 100;
    const mu = act.load.groundMu;
    const feet = footTravel(samples);

    const curve = samples.map((s, i) => {
        const dU = centralDiff(Us, i, xs);
        const dL = centralDiff(lengths, i, xs);
        const dLsafe = Math.abs(dL) < 1e-6 ? (dL < 0 ? -1e-6 : 1e-6) : dL;
        const tension = -dU / dLsafe;                           // all drives together, frictionless
        const gravityPerDrive = tension / nDrives / eff;
        const frictionAll = mu * s.weightOnGround * feet[i];    // lb·in per rad of drag work
        const frictionPerDrive = Math.abs(frictionAll / dLsafe) / nDrives / eff;
        const sense = gravityPerDrive >= 0 ? 'pull' : 'push';
        const force = Math.abs(gravityPerDrive) + frictionPerDrive;
        return {
            thetaDeg: s.thetaDeg,
            progress: (s.theta - xs[0]) / ((xs[xs.length - 1] - xs[0]) || 1),
            length: lengths[i],
            force, sense, gravityForce: Math.abs(gravityPerDrive), frictionForce: frictionPerDrive,
            height: num(s.frame.zHeight, 0), span: num(s.frame.span, 0),
            dLdTheta: dL,
        };
    });

    const lenMin = Math.min(...lengths), lenMax = Math.max(...lengths);
    const stroke = lenMax - lenMin;
    let peak = curve[0];
    curve.forEach(c => { if (c.force > peak.force) peak = c; });
    const senses = new Set(curve.map(c => c.sense));
    const gMax = Math.max(1e-9, ...curve.map(c => c.gravityForce));
    const gravityFlatness = Math.min(...curve.map(c => c.gravityForce)) / gMax;
    const cableOk = pl.family !== 'cable' || (senses.size === 1 && senses.has('pull'));
    const retractedNeeded = stroke + 8; // a real rod actuator is roughly stroke + 8 in when retracted
    const fitsStandardActuator = pl.family !== 'linear' || lenMin >= retractedNeeded;

    // Energy and power
    const dU = Us[Us.length - 1] - Us[0];
    const frictionWork = curve.reduce((acc, c, i) => i === 0 ? 0 : acc + c.frictionForce * nDrives * eff * Math.abs(lengths[i] - lengths[i - 1]), 0);
    const mechJ = (Math.max(0, dU) / eff + frictionWork) * LB_IN_TO_J;
    const t = act.motor.deployTimeSec;
    const avgPowerW = mechJ / t;
    const elecEff = act.motor.electricalEfficiencyPct / 100;
    const avgElectricalW = avgPowerW / elecEff;
    const speedMps = (stroke * IN_TO_M) / t;                      // constant-speed drive
    const peakPowerW = peak.force * LB_TO_N * speedMps * nDrives;  // all drives at the peak
    const peakElectricalW = peakPowerW / elecEff;
    const energyWh = mechJ / elecEff / 3600;
    const currentA = peakElectricalW / act.motor.systemVolts;
    const suggestedRatingLb = Math.ceil(peak.force * act.load.safetyFactor / 10) * 10;

    // Hand-over: first sample where the force drops under the rated force
    const rated = act.motor.ratedForceLb > 0 ? act.motor.ratedForceLb : suggestedRatingLb;
    let handover = null;
    for (let i = 0; i < curve.length; i++) { if (curve[i].force <= rated) { handover = i; break; } }
    let kickoff = null;
    if (handover !== null && handover > 0) {
        const dh = num(samples[handover].frame.zHeight, 0) - num(samples[0].frame.zHeight, 0);
        const work = Us[handover] - Us[0];
        kickoff = {
            handoverAngleDeg: curve[handover].thetaDeg,
            handoverProgress: curve[handover].progress,
            liftIn: dh,
            workLbIn: work,
            equivalentLiftLb: dh > 1e-6 ? work / dh : 0,           // vertical force at the roof over that lift
            perModuleLiftLb: dh > 1e-6 ? work / dh / Math.max(1, modules) : 0,
        };
    }

    return {
        id: placementId, label: pl.label, short: pl.short, family: pl.family, summary: pl.summary, hardware: pl.hardware,
        mountText: pl.mountText(act.params),
        driveModules: driveIdx, nDrives, modules,
        stroke, lenMin, lenMax, retractedNeeded, fitsStandardActuator, cableOk,
        senses: Array.from(senses),
        peakForce: peak.force, peakAngleDeg: peak.thetaDeg, peakProgress: peak.progress,
        kickoffForce: curve[0].force, deployedForce: curve[curve.length - 1].force,
        flatness: peak.force > 0 ? Math.min(...curve.map(c => c.force)) / peak.force : 0,
        gravityFlatness, peakGravityForce: gMax, peakFrictionForce: Math.max(0, ...curve.map(c => c.frictionForce)),
        suggestedRatingLb, ratedForceLb: rated,
        energyWh, mechJ, avgPowerW, avgElectricalW, peakPowerW, peakElectricalW, currentA, speedMps,
        kickoff,
        liftedWeightLb: dU > 0 ? dU / Math.max(1e-6, (num(samples[samples.length - 1].frame.zHeight, 0) - num(samples[0].frame.zHeight, 0))) : 0,
        totalWeightLb: samples[samples.length - 1].totalWeight,
        curve,
    };
}

/** Analyse every placement with the same drives/load/motor settings (for the compare table). */
export function comparePlacements(a, samples, extra = {}) {
    return PLACEMENT_IDS.map(id => analyzePlacement(id, a, samples, extra)).filter(Boolean);
}

/**
 * Convenience: everything the sidebar needs for the current state.
 * @param {Object} st - app state
 * @param {Object} opts - { key, panelWeightLb, trackY, groundY, samples }
 */
export function analyzeActuation(st, opts = {}) {
    const act = normalizeActuation(st.actuation);
    const samples = sampleDeploySweep(st, { key: opts.key, load: act.load, panelWeightLb: opts.panelWeightLb, samples: opts.samples });
    const extra = { modules: st.modules, trackY: opts.trackY, groundY: opts.groundY };
    return {
        actuation: act,
        samples,
        selected: analyzePlacement(act.placement, act, samples, extra),
        all: comparePlacements(act, samples, extra),
    };
}

/** Pivots at an arbitrary angle straight from state (no solver), e.g. for tests and quick checks. */
export function pivotsFromState(st, foldAngle) {
    const spacing = (typeof globalThis.hwResolveStructureSpacing === 'function')
        ? globalThis.hwResolveStructureSpacing()
        : { hStackGap: st.hStackGap || 0, bracket: null };
    const layout = computeRingVerticalLayout(st, spacing);
    const hActiveIn = st.hLengthFt * INCHES_PER_FOOT - st.offsetTopIn - st.offsetBotIn;
    const vActiveIn = Math.max(MIN_SAFE_DIMENSION, st.vLengthFt * INCHES_PER_FOOT - st.vertEndOffset * 2);
    return computeModulePivots(foldAngle, {
        hActiveIn, pivotPct: st.pivotPct, hobermanAng: st.hobermanAng, pivotAng: st.pivotAng, modules: st.modules,
        vActiveIn, yMin: layout.yMin, useFixedBeams: !!st.useFixedBeams, fixedHeightIn: st.vLengthFt * INCHES_PER_FOOT,
    });
}

const _moduleExports = {
    DEFAULT_ACTUATION, PLACEMENTS, PLACEMENT_IDS, ACTUATION_SAMPLES,
    createDefaultActuation, normalizeActuation, serializeActuation,
    evaluateAnchor, evaluatePlacementOnData, driveModuleIndices,
    sampleDeploySweep, clearActuationMemo, analyzePlacement, comparePlacements, analyzeActuation, pivotsFromState,
};
bridgeGlobals(_moduleExports, 'actuation');
