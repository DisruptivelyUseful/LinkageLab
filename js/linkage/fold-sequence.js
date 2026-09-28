// ============================================================================
// LINKAGE LAB — Fold sequence (ES module, pure)
//
// With a radial array and/or an arch module array, the structures can fold
// and unfold one at a time instead of all at once. The fold slider / Play /
// Fold / Unfold then act as a MASTER progress p in [0, 1]:
//   copy j (in deploy order) has local progress clamp(p·K − j, 0, 1)
// so unfolding runs copy 0, then copy 1, … and folding (p falling) packs the
// last copy first. Deploy order: the centre structure first when it is present
// and visible, then the ring copies in slot order; the linear (tunnel) copies
// of an arch array run 0..L−1 inside each slot.
//
// No DOM, no THREE. buildLinkageGeometry() turns the schedule into one solve
// per distinct angle (at most three: folded, deployed and the moving copy).
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { degToRad } from './math.js';
import { getEffectiveMinFoldAngle } from './solver.js';
import { getOptimalClosedAngleForAnimation } from './joint-kinematics.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * The sweep range every fold animation uses: from the effective minimum fold
 * angle (V-beam contact or the user's limit) to the stop angle or the closed
 * (deployed) angle, whichever is smaller.
 */
function getFoldSweepRange(s = globalThis.state) {
    const min = getEffectiveMinFoldAngle();
    const closed = getOptimalClosedAngleForAnimation();
    const stopDeg = s && s.animation ? s.animation.stopAngle : null;
    const stop = (stopDeg !== null && stopDeg !== undefined) ? degToRad(stopDeg) : closed;
    let max = Math.min(stop, closed);
    if (!(max > min)) max = Math.max(min + degToRad(1), (s && s.foldAngle) || min);
    return { min, max };
}

/**
 * Deploy order of the copies in a design.
 * @param {object|null} radialPlan  radial slot plan (deployed frame) or null
 * @param {number} linearCount      arch tunnel segments (arrayCount), 1 when none
 * @returns {Array<{order:number, slot:number, isCenter:boolean, ringIndex:number|null, linearIdx:number, arrayIndex:number, label:string}>}
 */
function deployOrder(radialPlan, linearCount = 1) {
    const L = Math.max(1, linearCount | 0);
    const slots = radialPlan && Array.isArray(radialPlan.slots)
        ? radialPlan.slots.filter(sl => !sl.hidden)
        : [{ slot: 0, isCenter: true, ringIndex: null }];
    // Centre first (when present and visible), then ring copies by slot index
    const ordered = [...slots.filter(sl => sl.isCenter), ...slots.filter(sl => !sl.isCenter).sort((a, b) => a.slot - b.slot)];
    const out = [];
    const multi = slots.length > 1;
    ordered.forEach(sl => {
        for (let i = 0; i < L; i++) {
            const base = !multi ? '' : (sl.isCenter ? 'Center' : `Copy ${(sl.ringIndex !== undefined && sl.ringIndex !== null ? sl.ringIndex : sl.slot) + 1}`);
            const seg = L > 1 ? `Segment ${i + 1}` : '';
            const label = [base, seg].filter(Boolean).join(' · ') || 'Structure';
            out.push({
                order: out.length,
                slot: sl.slot,
                isCenter: !!sl.isCenter,
                ringIndex: sl.isCenter ? null : (sl.ringIndex !== undefined ? sl.ringIndex : sl.slot),
                linearIdx: i,
                arrayIndex: sl.slot * L + i,
                label,
            });
        }
    });
    return out;
}

/** Master progress of a fold angle inside the sweep range. */
function masterProgress(angle, min, max) {
    if (!(max > min)) return 1;
    return clamp01((angle - min) / (max - min));
}

/** Local progress of copy j of K at master progress p. */
function copyProgress(p, j, K) {
    return clamp01(p * K - j);
}

/**
 * Per-copy fold angles for a master angle.
 * @returns {{ sequential:boolean, K:number, p:number, min:number, max:number,
 *             copies:Array, distinctAngles:number[], activeIndex:number|null, angleOf:Function }}
 */
function computeFoldSchedule({ masterAngle, min, max, order, sequential }) {
    const list = Array.isArray(order) && order.length ? order : deployOrder(null, 1);
    const K = list.length;
    const seq = !!sequential && K > 1;
    const p = masterProgress(masterAngle, min, max);
    const copies = list.map((entry, j) => {
        const progress = seq ? copyProgress(p, j, K) : p;
        const angle = seq ? min + progress * (max - min) : masterAngle;
        return { ...entry, progress, angle };
    });
    const distinct = [];
    copies.forEach(c => { if (!distinct.some(a => Math.abs(a - c.angle) < 1e-9)) distinct.push(c.angle); });
    let activeIndex = null;
    if (seq) {
        const moving = copies.findIndex(c => c.progress > 0 && c.progress < 1);
        if (moving >= 0) activeIndex = moving;
        else if (p <= 0) activeIndex = 0;
        else if (p >= 1) activeIndex = K - 1;
        else activeIndex = Math.min(K - 1, Math.floor(p * K));
    }
    const byKey = new Map(copies.map(c => [`${c.slot}:${c.linearIdx}`, c.angle]));
    return {
        sequential: seq,
        K,
        p,
        min,
        max,
        copies,
        distinctAngles: distinct,
        activeIndex,
        angleOf: (slot, linearIdx = 0) => (byKey.has(`${slot}:${linearIdx}`) ? byKey.get(`${slot}:${linearIdx}`) : masterAngle),
    };
}

/** Number of structures that fold one after another (1 when the option is off). */
function sequentialCopyCount(s = globalThis.state) {
    if (!s || !s.animation || !s.animation.sequentialFold) return 1;
    const linear = (s.orientation === 'vertical' && (s.arrayCount | 0) > 1) ? (s.arrayCount | 0) : 1;
    const frame = s._deployedFrame;
    if (frame && frame.radialPlan) return deployOrder(frame.radialPlan, linear).length;
    let radial = 1;
    if (s.radialArrayEnabled && (s.radialCount | 0) >= 1) {
        const hidden = Array.isArray(s.radialHiddenSlots) ? s.radialHiddenSlots.length : 0;
        radial = Math.max(1, (s.radialCenter !== false ? 1 : 0) + (s.radialCount | 0) - hidden);
    }
    return radial * linear;
}

const _moduleExports = { getFoldSweepRange, deployOrder, masterProgress, copyProgress, computeFoldSchedule, sequentialCopyCount };
bridgeGlobals(_moduleExports, 'foldSequence');
export { getFoldSweepRange, deployOrder, masterProgress, copyProgress, computeFoldSchedule, sequentialCopyCount };
