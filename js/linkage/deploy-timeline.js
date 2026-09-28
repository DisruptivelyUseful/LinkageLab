// ============================================================================
// LINKAGE LAB — Deploy timeline (ES module, pure)
//
// Timing of the baked "Deploy" clip as fractions of its duration. One structure
// (or several folding together) uses the classic single-structure timeline; a
// sequential array gives every copy its own window, one after another, and
// the same phase fractions inside that window.
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';

/** Single-structure timeline (fractions of the clip). Forward time is deployment. */
const FOLD_TIMELINE = Object.freeze({
    rise:      [0.00, 0.07],   // bundle rises vertically out of the IBC column
    carry:     [0.07, 0.14],   // bundle carried sideways to its folded ground position
    lower:     [0.14, 0.18],   // bundle lowered to stand on the ground
    lay:       [0.18, 0.24],   // bundle tips over to lie flat (folded rest pose)
    fold:      [0.24, 0.52],   // scissor linkage unfolds (kinematic samples)
    support:   [0.52, 0.72],   // radial then reciprocal roof beams fly from their pile
    panels:    [0.72, 1.00],   // panels mount one by one
    ibcGap:    [0.08, 0.13],   // top IBC settles back down once the bundle is clear
});

/** Phase fractions inside one copy's window of a sequential sequence. */
const COPY_PHASES = Object.freeze({
    rise: [0.00, 0.08], carry: [0.08, 0.16], lower: [0.16, 0.20], lay: [0.20, 0.26],
    fold: [0.26, 0.60], support: [0.60, 0.80], panels: [0.80, 1.00],
});

const PHASE_KEYS = ['rise', 'carry', 'lower', 'lay', 'fold', 'support', 'panels'];

function mapSpan(span, w0, w1) {
    return [w0 + (w1 - w0) * span[0], w0 + (w1 - w0) * span[1]];
}

/**
 * @param {object} p
 *   K           number of copies
 *   sequential  copies deploy one after another
 *   perCopySec  seconds per copy when sequential (default 9)
 *   baseSec     clip length when not sequential (default 12)
 *   labels      optional copy labels (deploy order)
 * @returns {{ durationSec, sequential, K, copies:[{index,label,window,rise,carry,lower,lay,fold,support,panels}],
 *             ibcGap:[number,number], unpack, fold, support, panels }}
 */
function buildDeployTimeline(p = {}) {
    const K = Math.max(1, p.K | 0);
    const sequential = !!p.sequential && K > 1;
    const labels = Array.isArray(p.labels) ? p.labels : [];
    const copies = [];
    for (let j = 0; j < K; j++) {
        const w0 = sequential ? j / K : 0;
        const w1 = sequential ? (j + 1) / K : 1;
        const phases = sequential ? COPY_PHASES : FOLD_TIMELINE;
        const c = { index: j, label: labels[j] || (K > 1 ? `Copy ${j + 1}` : 'Structure'), window: [w0, w1] };
        PHASE_KEYS.forEach(k => { c[k] = mapSpan(phases[k], w0, w1); });
        copies.push(c);
    }
    const first = copies[0], last = copies[K - 1];
    // The top tote settles once the LAST bundle has cleared the column
    const ibcGap = sequential ? [last.rise[1], Math.min(1, last.rise[1] + 0.05 / K)] : FOLD_TIMELINE.ibcGap.slice();
    return {
        durationSec: sequential ? (p.perCopySec || 9) * K : (p.baseSec || 12),
        sequential,
        K,
        copies,
        ibcGap,
        unpack: [first.rise[0], first.lay[1]],
        fold: [first.fold[0], last.fold[1]],
        support: [first.support[0], last.support[1]],
        panels: [first.panels[0], last.panels[1]],
    };
}

const _moduleExports = { FOLD_TIMELINE, COPY_PHASES, buildDeployTimeline };
bridgeGlobals(_moduleExports, 'deployTimeline');
export { FOLD_TIMELINE, COPY_PHASES, buildDeployTimeline };
