// ============================================================================
// LINKAGE LAB — Sheet nesting for covering polygons (pure, unit-tested)
//
// Tiles a convex 2D polygon (a wall trapezoid, in inches, bottom edge on the
// x axis) with rectangular stock sheets, clips the polygon to each sheet and
// reports every piece as a cut list: which edges are factory (stock) edges,
// which are seams to a neighbouring sheet, and for every real cut its length,
// its angle from the sheet's bottom edge, and where it meets the stock edges
// measured from the nearest sheet corner.
//
// Coordinates: polygon and sheet-cell coordinates share one frame (x right,
// y up, inches). Each piece's `polygon2D` is re-based to its own sheet's
// bottom-left corner so it can be marked out directly on the stock.
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';

const EPS = 1e-6;
const SNAP = 1 / 64;
const MIN_PIECE_AREA_IN2 = 0.5;
const SLIVER_IN = 4;

const snap = (v) => Math.round(v / SNAP) * SNAP;
const round = (v, p = 3) => +(+v).toFixed(p);

/** Accepts {x,y} or {s,t} points. */
export function toXY(pts) {
    return (pts || []).map(p => ({ x: p.x !== undefined ? p.x : p.s, y: p.y !== undefined ? p.y : p.t }));
}

/** Signed area (positive = counter-clockwise). */
export function signedArea(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
}

export function polygonArea(poly) {
    return Math.abs(signedArea(poly));
}

export function bbox(poly) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    poly.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    });
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Ensure counter-clockwise winding (returns a copy). */
export function ensureCCW(poly) {
    return signedArea(poly) < 0 ? poly.slice().reverse() : poly.slice();
}

/** Sutherland–Hodgman clip of a polygon against an axis-aligned rectangle. */
export function clipPolygonToRect(poly, x0, y0, x1, y1) {
    const clipEdge = (pts, inside, intersect) => {
        const out = [];
        for (let i = 0; i < pts.length; i++) {
            const cur = pts[i], prev = pts[(i + pts.length - 1) % pts.length];
            const curIn = inside(cur), prevIn = inside(prev);
            if (curIn) {
                if (!prevIn) out.push(intersect(prev, cur));
                out.push(cur);
            } else if (prevIn) {
                out.push(intersect(prev, cur));
            }
        }
        return out;
    };
    const ix = (a, b, x) => ({ x, y: a.y + (b.y - a.y) * ((x - a.x) / (b.x - a.x)) });
    const iy = (a, b, y) => ({ x: a.x + (b.x - a.x) * ((y - a.y) / (b.y - a.y)), y });
    let pts = poly.slice();
    if (!pts.length) return pts;
    pts = clipEdge(pts, p => p.x >= x0 - EPS, (a, b) => ix(a, b, x0));
    if (!pts.length) return pts;
    pts = clipEdge(pts, p => p.x <= x1 + EPS, (a, b) => ix(a, b, x1));
    if (!pts.length) return pts;
    pts = clipEdge(pts, p => p.y >= y0 - EPS, (a, b) => iy(a, b, y0));
    if (!pts.length) return pts;
    pts = clipEdge(pts, p => p.y <= y1 + EPS, (a, b) => iy(a, b, y1));
    return dedupe(pts);
}

function dedupe(pts) {
    const out = [];
    pts.forEach(p => {
        const last = out[out.length - 1];
        if (!last || Math.abs(last.x - p.x) > 1e-4 || Math.abs(last.y - p.y) > 1e-4) out.push(p);
    });
    if (out.length > 1) {
        const a = out[0], b = out[out.length - 1];
        if (Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4) out.pop();
    }
    return out;
}

/** Which sheet side (if any) a sheet-local point lies on. */
function sideOf(p, cw, ch, tol = 1e-3) {
    const sides = [];
    if (Math.abs(p.x) < tol) sides.push('left');
    if (Math.abs(p.x - cw) < tol) sides.push('right');
    if (Math.abs(p.y) < tol) sides.push('bottom');
    if (Math.abs(p.y - ch) < tol) sides.push('top');
    return sides;
}

function edgeSide(a, b, cw, ch) {
    const sa = sideOf(a, cw, ch), sb = sideOf(b, cw, ch);
    return sa.find(s => sb.includes(s)) || null;
}

/** Cut angle folded into [0, 180): angle of the edge from the sheet's bottom edge. */
export function cutAngleDeg(a, b) {
    let deg = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    deg = ((deg % 180) + 180) % 180;
    return round(deg, 2);
}

function markFor(p, cw, ch) {
    const sides = sideOf(p, cw, ch);
    if (sides.length !== 1) return null; // corners are not marks
    const side = sides[0];
    if (side === 'bottom' || side === 'top') {
        const fromLeft = p.x, fromRight = cw - p.x;
        const useLeft = fromLeft <= fromRight;
        return { side, fromCorner: (side === 'bottom' ? 'B' : 'T') + (useLeft ? 'L' : 'R'), distIn: round(useLeft ? fromLeft : fromRight), x: round(p.x), y: round(p.y) };
    }
    const fromBottom = p.y, fromTop = ch - p.y;
    const useBottom = fromBottom <= fromTop;
    return { side, fromCorner: (useBottom ? 'B' : 'T') + (side === 'left' ? 'L' : 'R'), distIn: round(useBottom ? fromBottom : fromTop), x: round(p.x), y: round(p.y) };
}

/** Human-readable location of a mark, e.g. "top edge, 22 3/16 in from the top-left corner". */
export function describeMark(mark, fmt = (v) => `${round(v, 2)} in`) {
    const corner = { BL: 'bottom-left', BR: 'bottom-right', TL: 'top-left', TR: 'top-right' }[mark.fromCorner] || mark.fromCorner;
    return `${mark.side} edge, ${fmt(mark.distIn)} from the ${corner} corner`;
}

function layoutFor(poly, box, cw, ch, align) {
    const cols = Math.max(1, Math.ceil(box.w / cw - EPS));
    const rows = Math.max(1, Math.ceil(box.h / ch - EPS));
    const originX = box.minX + (align === 'center' ? (box.w - cols * cw) / 2 : 0);
    const originY = box.minY;
    const cells = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x0 = originX + c * cw, y0 = originY + r * ch;
            const clipped = clipPolygonToRect(poly, x0, y0, x0 + cw, y0 + ch);
            if (clipped.length < 3) continue;
            const area = polygonArea(clipped);
            if (area < MIN_PIECE_AREA_IN2) continue;
            cells.push({ row: r, col: c, x0, y0, clipped, area });
        }
    }
    return { cols, rows, originX, originY, cells };
}

/**
 * Nest one polygon on rectangular stock.
 * @param {Array<{x,y}|{s,t}>} corners2D - convex polygon, inches
 * @param {Object} stock - { widthIn, lengthIn, thicknessIn, orientation:'auto'|'landscape'|'portrait', align:'center'|'left', kerfIn }
 */
export function nestPolygonOnSheets(corners2D, stock = {}) {
    const widthIn = +stock.widthIn || 48;
    const lengthIn = +stock.lengthIn || 96;
    const kerfIn = +stock.kerfIn || 0;
    const poly = ensureCCW(toXY(corners2D));
    if (poly.length < 3) return emptyNest(stock);
    const box = bbox(poly);
    const polyArea = polygonArea(poly);

    const orientations = stock.orientation === 'landscape' ? ['landscape']
        : stock.orientation === 'portrait' ? ['portrait']
        : ['landscape', 'portrait'];
    const aligns = stock.align === 'left' ? ['left'] : stock.align === 'center' ? ['center'] : ['center', 'left'];

    let best = null;
    orientations.forEach(orientation => {
        const cw = orientation === 'landscape' ? Math.max(widthIn, lengthIn) : Math.min(widthIn, lengthIn);
        const ch = orientation === 'landscape' ? Math.min(widthIn, lengthIn) : Math.max(widthIn, lengthIn);
        aligns.forEach(align => {
            const lay = layoutFor(poly, box, cw, ch, align);
            const sheetCount = lay.cells.length;
            const utilization = sheetCount ? polyArea / (sheetCount * cw * ch) : 0;
            const cutPieces = lay.cells.filter(c => Math.abs(c.area - cw * ch) > 1).length;
            // Smallest dimension of the smallest piece: a 4" strip is a worse layout than two half sheets
            const minPieceDim = lay.cells.reduce((m, c) => {
                const b = bbox(c.clipped);
                return Math.min(m, b.w, b.h);
            }, Infinity);
            const cand = { orientation, align, cw, ch, lay, sheetCount, utilization, cutPieces, minPieceDim };
            const better = () => {
                if (!best) return true;
                if (cand.sheetCount !== best.sheetCount) return cand.sheetCount < best.sheetCount;
                const closeUtil = Math.abs(cand.utilization - best.utilization) <= 0.02;
                if (closeUtil && Math.min(cand.minPieceDim, 12) !== Math.min(best.minPieceDim, 12)) return cand.minPieceDim > best.minPieceDim;
                if (!closeUtil) return cand.utilization > best.utilization;
                return cand.cutPieces < best.cutPieces;
            };
            if (better()) best = cand;
        });
    });

    const { cw, ch, lay } = best;
    const occupied = new Set(lay.cells.map(c => `${c.row}:${c.col}`));
    const neighbourSide = { left: (r, c) => `${r}:${c - 1}`, right: (r, c) => `${r}:${c + 1}`, bottom: (r, c) => `${r - 1}:${c}`, top: (r, c) => `${r + 1}:${c}` };

    const warnings = [];
    let seamCount = 0;
    let seamLinearIn = 0;
    const pieces = lay.cells.map(cell => {
        const local = cell.clipped.map(p => ({ x: snap(p.x - cell.x0), y: snap(p.y - cell.y0) }));
        const area = polygonArea(local);
        const isFullSheet = Math.abs(area - cw * ch) < 1;
        const edges = [];
        const marks = [];
        let hasCut = false;
        let taperOnSeam = false;
        for (let i = 0; i < local.length; i++) {
            const a = local[i], b = local[(i + 1) % local.length];
            const lengthIn = Math.hypot(b.x - a.x, b.y - a.y);
            if (lengthIn < 1e-4) continue;
            const side = edgeSide(a, b, cw, ch);
            const isStock = !!side;
            const isSeam = isStock && occupied.has(neighbourSide[side](cell.row, cell.col));
            if (isSeam) { seamCount++; seamLinearIn += lengthIn; }
            edges.push({
                from: { x: round(a.x), y: round(a.y) },
                to: { x: round(b.x), y: round(b.y) },
                lengthIn: round(lengthIn),
                angleDeg: cutAngleDeg(a, b),
                isStock,
                isSeam,
                side,
            });
            if (!isStock) {
                hasCut = true;
                [a, b].forEach(p => {
                    const m = markFor(p, cw, ch);
                    if (m) {
                        if (!marks.some(x => x.side === m.side && Math.abs(x.distIn - m.distIn) < 1e-3 && x.fromCorner === m.fromCorner)) marks.push(m);
                        if (occupied.has(neighbourSide[m.side](cell.row, cell.col))) taperOnSeam = true;
                    }
                });
            }
        }
        const pb = bbox(local);
        const pieceId = `R${cell.row + 1}C${cell.col + 1}`;
        if (!isFullSheet && Math.min(pb.w, pb.h) < SLIVER_IN) {
            warnings.push({ code: 'sliver', pieceIds: [pieceId], message: `Piece ${pieceId} is only ${round(Math.min(pb.w, pb.h), 2)} in across; consider shifting the sheet layout (align) or the split height.` });
        }
        if (taperOnSeam) {
            warnings.push({ code: 'seam-on-taper', pieceIds: [pieceId], message: `A tapered cut on ${pieceId} runs into a seam; cut both neighbouring pieces before fitting so the taper lines up.` });
        }
        return {
            pieceId,
            row: cell.row,
            col: cell.col,
            cellX: round(cell.x0),
            cellY: round(cell.y0),
            polygon2D: local.map(p => ({ x: round(p.x), y: round(p.y) })),
            isFullSheet,
            hasCut,
            bboxW: round(pb.w),
            bboxH: round(pb.h),
            areaIn2: round(area, 1),
            wasteIn2: round(cw * ch - area, 1),
            edges,
            marks,
            offcut: isFullSheet ? null : { areaIn2: round(Math.max(0, cw * ch - area - kerfIn * (pb.w + pb.h)), 1) },
        };
    });

    const seams = seamCount / 2; // every seam is counted from both sides
    if (seams > 0) {
        warnings.push({ code: 'batten', pieceIds: pieces.map(p => p.pieceId), message: `${seams} seam${seams === 1 ? '' : 's'} between sheets (${round(seamLinearIn / 2 / 12, 1)} ft): there is no framing between the uprights, so back each seam with a batten or cleat.` });
    }

    return {
        orientation: best.orientation,
        align: best.align,
        cellW: cw,
        cellH: ch,
        cols: lay.cols,
        rows: lay.rows,
        originX: round(lay.originX),
        originY: round(lay.originY),
        polygonBBox: { w: round(box.w), h: round(box.h) },
        pieces,
        sheetCount: pieces.length,
        polygonAreaIn2: round(polyArea, 1),
        usedAreaIn2: round(polyArea, 1),
        stockAreaIn2: round(pieces.length * cw * ch, 1),
        utilization: round(best.utilization, 4),
        seamCount: seams,
        seamLinearIn: round(seamLinearIn / 2),
        warnings,
        stock: { widthIn, lengthIn, thicknessIn: +stock.thicknessIn || 0.5, kerfIn },
    };
}

function emptyNest(stock) {
    return {
        orientation: 'landscape', align: 'center', cellW: +stock.lengthIn || 96, cellH: +stock.widthIn || 48,
        cols: 0, rows: 0, originX: 0, originY: 0, polygonBBox: { w: 0, h: 0 }, pieces: [], sheetCount: 0,
        polygonAreaIn2: 0, usedAreaIn2: 0, stockAreaIn2: 0, utilization: 0, seamCount: 0, seamLinearIn: 0, warnings: [],
        stock: { widthIn: +stock.widthIn || 48, lengthIn: +stock.lengthIn || 96, thicknessIn: +stock.thicknessIn || 0.5, kerfIn: +stock.kerfIn || 0 },
    };
}

const _moduleExports = {
    toXY,
    signedArea,
    polygonArea,
    bbox,
    ensureCCW,
    clipPolygonToRect,
    cutAngleDeg,
    describeMark,
    nestPolygonOnSheets,
};

bridgeGlobals(_moduleExports, 'sheetNesting');
