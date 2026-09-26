// ============================================================================
// LINKAGE LAB — Tensioned-fabric flat patterns for covering polygons (pure)
//
// A covering band is planar, so its fabric pattern is the same polygon:
//   finished outline = geometry shrunk by the tension allowance (stretchPct)
//   split into panels no wider than the roll (vertical seams, symmetric)
//   cut outline = finished outline grown by the hem on outer edges and by the
//                 seam allowance on seam edges
//   grommets evenly spaced along the hem edges of the finished outline
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { toXY, ensureCCW, clipPolygonToRect, polygonArea, bbox } from './sheet-nesting.js';

const EPS = 1e-6;
const round = (v, p = 3) => +(+v).toFixed(p);

/**
 * Offsets a convex CCW polygon outward, edge by edge.
 * @param {Array<{x,y}>} poly
 * @param {number[]|number} allowance - per-edge distance (edge i runs p[i] → p[i+1]) or one number
 */
export function offsetConvexPolygon(poly, allowance) {
    const n = poly.length;
    if (n < 3) return poly.slice();
    const dist = (i) => Array.isArray(allowance) ? (allowance[i] || 0) : (allowance || 0);
    // Offset line for each edge: point + outward normal * d, direction along the edge
    const lines = [];
    for (let i = 0; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = dy / len, ny = -dx / len; // outward for CCW
        const d = dist(i);
        lines.push({ p: { x: a.x + nx * d, y: a.y + ny * d }, d: { x: dx / len, y: dy / len } });
    }
    const out = [];
    for (let i = 0; i < n; i++) {
        const l1 = lines[(i + n - 1) % n], l2 = lines[i];
        const den = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
        if (Math.abs(den) < 1e-9) {
            out.push({ x: l2.p.x, y: l2.p.y });
            continue;
        }
        const t = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / den;
        out.push({ x: l1.p.x + l1.d.x * t, y: l1.p.y + l1.d.y * t });
    }
    return out;
}

function scaleAboutCentroid(poly, k) {
    const cx = poly.reduce((a, p) => a + p.x, 0) / poly.length;
    const cy = poly.reduce((a, p) => a + p.y, 0) / poly.length;
    return poly.map(p => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));
}

function grommetsAlongEdge(a, b, spacing) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const count = Math.max(2, Math.floor(len / spacing + EPS) + 1);
    const pts = [];
    for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0 : i / (count - 1);
        pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    return pts;
}

/**
 * Builds the flat pattern for one fabric band.
 * @param {Array<{x,y}|{s,t}>} corners2D - band polygon (inches)
 * @param {Object} cfg - { rollWidthIn, hemIn, seamIn, stretchPct, grommetSpacingIn }
 */
export function buildFabricPattern(corners2D, cfg = {}) {
    const rollWidthIn = +cfg.rollWidthIn || 60;
    const hemIn = +cfg.hemIn || 0;
    const seamIn = +cfg.seamIn || 0;
    const stretchPct = +cfg.stretchPct || 0;
    const grommetSpacingIn = +cfg.grommetSpacingIn || 12;

    const geom = ensureCCW(toXY(corners2D));
    if (geom.length < 3) return { finished2D: [], panels: [], panelCount: 0, grommetCount: 0, seamCount: 0, seamLinearIn: 0, fabricLinearIn: 0, fabricYards: 0, areaIn2: 0, finishedAreaIn2: 0, rollWidthIn };
    const k = Math.max(0.5, 1 - stretchPct / 100);
    const finished = scaleAboutCentroid(geom, k);
    const fb = bbox(finished);
    const usable = Math.max(1, rollWidthIn - 2 * seamIn);
    const panelCount = Math.max(1, Math.ceil(fb.w / usable - EPS));
    const stripW = fb.w / panelCount;

    const panels = [];
    let grommetCount = 0;
    let seamLinearIn = 0;
    let fabricLinearIn = 0;
    let areaIn2 = 0;
    for (let i = 0; i < panelCount; i++) {
        const x0 = fb.minX + i * stripW, x1 = i === panelCount - 1 ? fb.maxX : fb.minX + (i + 1) * stripW;
        const piece = ensureCCW(clipPolygonToRect(finished, x0, fb.minY - 1, x1, fb.maxY + 1));
        if (piece.length < 3) continue;
        const seamEdges = [], hemEdges = [], allowance = [];
        for (let e = 0; e < piece.length; e++) {
            const a = piece[e], b = piece[(e + 1) % piece.length];
            const onLeftSeam = i > 0 && Math.abs(a.x - x0) < 1e-3 && Math.abs(b.x - x0) < 1e-3;
            const onRightSeam = i < panelCount - 1 && Math.abs(a.x - x1) < 1e-3 && Math.abs(b.x - x1) < 1e-3;
            if (onLeftSeam || onRightSeam) {
                seamEdges.push(e);
                allowance.push(seamIn);
                seamLinearIn += Math.hypot(b.x - a.x, b.y - a.y);
            } else {
                hemEdges.push(e);
                allowance.push(hemIn);
            }
        }
        const cut = offsetConvexPolygon(piece, allowance);
        // Grommets on hem edges of the finished outline, de-duplicated at shared corners
        const grommets = [];
        hemEdges.forEach(e => {
            const a = piece[e], b = piece[(e + 1) % piece.length];
            grommetsAlongEdge(a, b, grommetSpacingIn).forEach(g => {
                if (!grommets.some(q => Math.abs(q.x - g.x) < 0.05 && Math.abs(q.y - g.y) < 0.05)) grommets.push(g);
            });
        });
        grommetCount += grommets.length;
        const cb = bbox(cut);
        const pieceArea = polygonArea(cut);
        areaIn2 += pieceArea;
        fabricLinearIn += cb.h;
        // Re-base each panel so its cut outline starts at (0,0)
        const rb = (p) => ({ x: round(p.x - cb.minX), y: round(p.y - cb.minY) });
        panels.push({
            index: i,
            label: panelCount > 1 ? `Panel ${i + 1} of ${panelCount}` : 'Panel',
            cut2D: cut.map(rb),
            finished2D: piece.map(rb),
            grommets: grommets.map(rb),
            seamEdges,
            hemEdges,
            bboxW: round(cb.w),
            bboxH: round(cb.h),
            areaIn2: round(pieceArea, 1),
            fitsRoll: cb.w <= rollWidthIn + 1e-3,
        });
    }
    const gb = bbox(geom);
    const rbF = (p) => ({ x: round(p.x - fb.minX), y: round(p.y - fb.minY) });
    return {
        finished2D: finished.map(rbF),
        finishedBBox: { w: round(fb.w), h: round(fb.h) },
        geometryBBox: { w: round(gb.w), h: round(gb.h) },
        shrinkFactor: round(k, 4),
        panels,
        panelCount: panels.length,
        grommetCount,
        seamCount: Math.max(0, panels.length - 1),
        seamLinearIn: round(seamLinearIn / 2),
        fabricLinearIn: round(fabricLinearIn),
        fabricYards: round(fabricLinearIn / 36, 2),
        areaIn2: round(areaIn2, 1),
        finishedAreaIn2: round(polygonArea(finished), 1),
        rollWidthIn,
        hemIn,
        seamIn,
        stretchPct,
        grommetSpacingIn,
    };
}

const _moduleExports = { offsetConvexPolygon, buildFabricPattern };

bridgeGlobals(_moduleExports, 'fabricPatterns');
