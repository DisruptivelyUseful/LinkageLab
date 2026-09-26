// ============================================================================
// LINKAGE LAB — SVG cut files and cut diagrams (pure, no DOM)
//
// One SVG user unit = one inch. Documents carry width/height in inches so they
// print full scale; `svgForInline()` strips those for embedding in the guide.
// Geometry comes in y-up (shop convention: sheet bottom edge on the x axis);
// every drawing flips it into SVG's y-down frame locally.
// ============================================================================

import { bridgeGlobals } from '../linkage/global-bridge.js';
import { formatInchesFraction } from './unit-converter.js';

const round = (v, p = 3) => +(+v).toFixed(p);

export function escapeXml(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
}

const fmtInDefault = (v) => formatInchesFraction(v, 16);
const fmtDeg = (v) => `${(+v).toFixed(1)}°`;

const STYLE = `
  .stock { fill: none; stroke: #8a8a8a; stroke-width: 0.06; stroke-dasharray: 0.6 0.4; }
  .piece { fill: #e9d8b4; fill-opacity: 0.85; stroke: #4a3a22; stroke-width: 0.08; stroke-linejoin: round; }
  .fabric-cut { fill: #dff2ec; fill-opacity: 0.8; stroke: #1f6f5f; stroke-width: 0.08; stroke-linejoin: round; }
  .fabric-fin { fill: none; stroke: #1f6f5f; stroke-width: 0.05; stroke-dasharray: 0.5 0.35; }
  .seam { stroke: #c0392b; stroke-width: 0.12; stroke-dasharray: 0.8 0.3; }
  .cut { stroke: #c0392b; stroke-width: 0.12; }
  .mark { stroke: #c0392b; stroke-width: 0.06; }
  .grommet { fill: #fff; stroke: #1f6f5f; stroke-width: 0.06; }
  .dim { stroke: #2c3e50; stroke-width: 0.05; }
  .outline { fill: #f3e6c8; stroke: #4a3a22; stroke-width: 0.1; stroke-linejoin: round; }
  .grid { fill: none; stroke: #7f8c8d; stroke-width: 0.06; stroke-dasharray: 0.8 0.5; }
  text { font-family: Helvetica, Arial, sans-serif; fill: #2c3e50; }
  .muted { fill: #7f8c8d; }
  .accent { fill: #c0392b; font-weight: 700; }
  .title { font-weight: 700; }
`;

function text(x, y, str, o = {}) {
    const size = o.size ?? 1;
    const anchor = o.anchor ?? 'start';
    const cls = o.cls ? ` class="${o.cls}"` : '';
    const rot = o.rotate ? ` transform="rotate(${round(o.rotate, 2)} ${round(x)} ${round(y)})"` : '';
    return `<text x="${round(x)}" y="${round(y)}" font-size="${size}" text-anchor="${anchor}"${cls}${rot}>${escapeXml(str)}</text>`;
}

function pathFrom(pts, fy, dx = 0, cls = 'piece') {
    if (!pts || pts.length < 2) return '';
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${round(p.x + dx)} ${round(fy(p.y))}`).join(' ') + ' Z';
    return `<path class="${cls}" d="${d}"/>`;
}

/** Wraps a body in an SVG document sized in inches. */
export function svgDocument({ widthIn, heightIn, body, title, description }) {
    const w = round(Math.max(1, widthIn)), h = round(Math.max(1, heightIn));
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}in" height="${h}in" viewBox="0 0 ${w} ${h}" data-units="inches">
  <title>${escapeXml(title || 'LinkageLab cut file')}</title>
  ${description ? `<desc>${escapeXml(description)}</desc>` : ''}
  <style>${STYLE}</style>
  <rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>
${body}
</svg>`;
}

/** Strip the physical size so the SVG scales to its container when inlined. */
export function svgForInline(svg, opts = {}) {
    const maxW = opts.maxWidth || '100%';
    return svg
        .replace(/^<\?xml[^>]*>\s*/, '')
        .replace(/<svg([^>]*?)\swidth="[^"]*"\sheight="[^"]*"/, `<svg$1 style="width:${maxW};height:auto;display:block"`);
}

function titleBlock(x, y, lines, fontIn) {
    let out = '';
    lines.forEach((ln, i) => {
        out += text(x, y + (i + 1) * fontIn * 1.35, ln, { size: i === 0 ? fontIn * 1.3 : fontIn, cls: i === 0 ? 'title' : 'muted' });
    });
    return out;
}

/**
 * Full-scale cut file for one nested polygon: every stock sheet with its
 * piece, cut lines, angles and edge marks.
 * @param {Object} nest - result of nestPolygonOnSheets
 * @param {Object} opts - { title, lines:[], fmtIn, fontIn }
 */
export function buildSheetCutSvg(nest, opts = {}) {
    const fmtIn = opts.fmtIn || fmtInDefault;
    const fontIn = opts.fontIn || 1.1;
    const margin = Math.max(6, fontIn * 6); // room for edge-mark labels outside the sheet
    const gap = fontIn * 5;
    const cw = nest.cellW, ch = nest.cellH;
    const headerH = fontIn * 1.35 * ((opts.lines || []).length + 1) + fontIn * 2;
    const pieces = nest.pieces || [];
    const totalH = margin + headerH + pieces.length * (ch + gap) + margin;
    const totalW = margin * 2 + Math.max(cw, 40);
    let body = titleBlock(margin, 1, [opts.title || 'Sheet cuts', ...(opts.lines || [])], fontIn);
    let y0 = 1 + headerH + fontIn * 2.5;
    pieces.forEach(piece => {
        const top = y0;
        const fy = (y) => top + ch - y;
        body += `<rect class="stock" x="${margin}" y="${round(top)}" width="${cw}" height="${ch}"/>`;
        body += text(margin, top - fontIn * 2.2, `${piece.pieceId} — ${nest.orientation} ${fmtIn(cw)} × ${fmtIn(ch)} sheet${piece.isFullSheet ? ' (full sheet, no cuts)' : ''}`, { size: fontIn, cls: 'title' });
        body += pathFrom(piece.polygon2D, fy, margin, 'piece');
        // cut edges
        piece.edges.forEach(e => {
            if (e.isStock) return;
            const ax = e.from.x + margin, ay = fy(e.from.y), bx = e.to.x + margin, by = fy(e.to.y);
            body += `<line class="cut" x1="${round(ax)}" y1="${round(ay)}" x2="${round(bx)}" y2="${round(by)}"/>`;
            const mx = (ax + bx) / 2, my = (ay + by) / 2;
            let ang = Math.atan2(by - ay, bx - ax) * 180 / Math.PI;
            if (ang > 90 || ang < -90) ang += 180;
            body += text(mx, my - 0.35, `${fmtIn(e.lengthIn)} @ ${fmtDeg(e.angleDeg)}`, { size: fontIn * 0.95, anchor: 'middle', cls: 'accent', rotate: ang });
        });
        // marks on the stock edges
        piece.marks.forEach(m => {
            const px = m.x + margin, py = fy(m.y);
            const horiz = m.side === 'bottom' || m.side === 'top';
            const tick = 0.8;
            body += horiz
                ? `<line class="mark" x1="${round(px)}" y1="${round(py - tick)}" x2="${round(px)}" y2="${round(py + tick)}"/>`
                : `<line class="mark" x1="${round(px - tick)}" y1="${round(py)}" x2="${round(px + tick)}" y2="${round(py)}"/>`;
            const label = `${fmtIn(m.distIn)} from ${m.fromCorner}`;
            if (m.side === 'bottom') body += text(px, py + tick + fontIn, label, { size: fontIn * 0.9, anchor: 'middle' });
            else if (m.side === 'top') body += text(px, py - tick - 0.3, label, { size: fontIn * 0.9, anchor: 'middle' });
            else if (m.side === 'left') body += text(px - tick - 0.3, py + fontIn * 0.35, label, { size: fontIn * 0.9, anchor: 'end' });
            else body += text(px + tick + 0.3, py + fontIn * 0.35, label, { size: fontIn * 0.9 });
        });
        // interior angles at the vertices of cut edges
        const poly = piece.polygon2D;
        poly.forEach((p, i) => {
            const prev = poly[(i + poly.length - 1) % poly.length], next = poly[(i + 1) % poly.length];
            const eIn = piece.edges.find(e => e.to.x === p.x && e.to.y === p.y);
            const eOut = piece.edges.find(e => e.from.x === p.x && e.from.y === p.y);
            if (!eIn || !eOut || (eIn.isStock && eOut.isStock)) return;
            const a1 = Math.atan2(prev.y - p.y, prev.x - p.x), a2 = Math.atan2(next.y - p.y, next.x - p.x);
            let inner = Math.abs(a1 - a2) * 180 / Math.PI;
            if (inner > 180) inner = 360 - inner;
            const bis = (a1 + a2) / 2 + ((Math.abs(a1 - a2) > Math.PI) ? Math.PI : 0);
            const lx = p.x + Math.cos(bis) * 3 + margin, ly = fy(p.y + Math.sin(bis) * 3);
            body += text(lx, ly + fontIn * 0.35, fmtDeg(inner), { size: fontIn * 0.9, anchor: 'middle', cls: 'muted' });
        });
        y0 += ch + gap;
    });
    return svgDocument({ widthIn: totalW, heightIn: totalH, body, title: opts.title, description: (opts.lines || []).join(' · ') });
}

/**
 * Fabric pattern: each panel's cut outline, finished outline, seams and grommets.
 * @param {Object} pattern - result of buildFabricPattern
 */
export function buildFabricPatternSvg(pattern, opts = {}) {
    const fmtIn = opts.fmtIn || fmtInDefault;
    const fontIn = opts.fontIn || 1.1;
    const margin = 2, gap = 3;
    const panels = pattern.panels || [];
    const headerH = fontIn * 1.35 * ((opts.lines || []).length + 1) + 2;
    const totalW = margin * 2 + Math.max(40, panels.reduce((a, p) => a + p.bboxW, 0) + gap * Math.max(0, panels.length - 1));
    const maxH = panels.reduce((a, p) => Math.max(a, p.bboxH), 0);
    const totalH = margin + headerH + maxH + fontIn * 4 + margin;
    let body = titleBlock(margin, margin, [opts.title || 'Fabric pattern', ...(opts.lines || [])], fontIn);
    let x0 = margin;
    const top = margin + headerH;
    panels.forEach(panel => {
        const fy = (y) => top + panel.bboxH - y;
        body += pathFrom(panel.cut2D, fy, x0, 'fabric-cut');
        body += pathFrom(panel.finished2D, fy, x0, 'fabric-fin');
        // seam edges (on the finished outline)
        panel.seamEdges.forEach(e => {
            const a = panel.finished2D[e], b = panel.finished2D[(e + 1) % panel.finished2D.length];
            body += `<line class="seam" x1="${round(a.x + x0)}" y1="${round(fy(a.y))}" x2="${round(b.x + x0)}" y2="${round(fy(b.y))}"/>`;
        });
        panel.grommets.forEach(g => {
            body += `<circle class="grommet" cx="${round(g.x + x0)}" cy="${round(fy(g.y))}" r="0.3"/>`;
        });
        body += text(x0, top - 0.3, `${panel.label}: cut ${fmtIn(panel.bboxW)} × ${fmtIn(panel.bboxH)}`, { size: fontIn, cls: 'title' });
        // edge lengths on the cut outline
        panel.cut2D.forEach((p, i) => {
            const q = panel.cut2D[(i + 1) % panel.cut2D.length];
            const len = Math.hypot(q.x - p.x, q.y - p.y);
            const mx = (p.x + q.x) / 2 + x0, my = fy((p.y + q.y) / 2);
            let ang = Math.atan2(fy(q.y) - fy(p.y), q.x - p.x) * 180 / Math.PI;
            if (ang > 90 || ang < -90) ang += 180;
            body += text(mx, my - 0.3, fmtIn(len), { size: fontIn * 0.85, anchor: 'middle', cls: 'muted', rotate: ang });
        });
        x0 += panel.bboxW + gap;
    });
    const legendY = top + maxH + fontIn * 1.6;
    body += text(margin, legendY, `Solid = cut line (hem ${fmtIn(pattern.hemIn)}, seam ${fmtIn(pattern.seamIn)}). Dashed = finished edge after ${pattern.stretchPct}% tension shrink. Red dashed = seam. Circles = grommets every ${fmtIn(pattern.grommetSpacingIn)}.`, { size: fontIn * 0.9, cls: 'muted' });
    body += text(margin, legendY + fontIn * 1.35, `${pattern.panelCount} panel${pattern.panelCount === 1 ? '' : 's'} on ${fmtIn(pattern.rollWidthIn)} roll · ${pattern.fabricYards} yd · ${pattern.grommetCount} grommets`, { size: fontIn * 0.9, cls: 'muted' });
    return svgDocument({ widthIn: totalW, heightIn: totalH, body, title: opts.title, description: (opts.lines || []).join(' · ') });
}

/**
 * Overview of one covering: the polygon with overall dimensions, taper
 * angles and (for plywood) the sheet grid overlaid. Meant for inline use.
 * @param {Object} shape - covering shape from coverings-geometry
 * @param {Object|null} nest - nestPolygonOnSheets result (plywood) or null
 */
export function buildWallOverviewSvg(shape, nest, opts = {}) {
    const fmtIn = opts.fmtIn || fmtInDefault;
    const poly = (shape.corners2D || []).map(p => ({ x: p.s !== undefined ? p.s : p.x, y: p.t !== undefined ? p.t : p.y }));
    if (poly.length < 3) return svgDocument({ widthIn: 10, heightIn: 4, body: text(1, 2, 'no geometry', { size: 1 }) });
    const minX = Math.min(...poly.map(p => p.x)), maxX = Math.max(...poly.map(p => p.x));
    const minY = Math.min(...poly.map(p => p.y)), maxY = Math.max(...poly.map(p => p.y));
    const gridMinX = nest ? Math.min(minX, nest.originX) : minX;
    const gridMaxX = nest ? Math.max(maxX, nest.originX + nest.cols * nest.cellW) : maxX;
    const gridMaxY = nest ? Math.max(maxY, nest.originY + nest.rows * nest.cellH) : maxY;
    const W = gridMaxX - gridMinX, H = gridMaxY - minY;
    const fontIn = opts.fontIn || Math.max(1.6, W * 0.028);
    const pad = fontIn * 4;
    const ox = pad - gridMinX, oy = pad;
    const fy = (y) => oy + H - (y - minY);
    let body = '';
    if (nest) {
        for (let r = 0; r < nest.rows; r++) {
            for (let c = 0; c < nest.cols; c++) {
                const x = nest.originX + c * nest.cellW, y = nest.originY + r * nest.cellH;
                const piece = nest.pieces.find(p => p.row === r && p.col === c);
                body += `<rect class="grid" x="${round(x + ox)}" y="${round(fy(y + nest.cellH))}" width="${nest.cellW}" height="${nest.cellH}"${piece ? '' : ' stroke-opacity="0.35"'}/>`;
                if (piece) body += text(x + ox + nest.cellW / 2, fy(y + nest.cellH / 2) + fontIn * 0.35, piece.pieceId, { size: fontIn * 1.1, anchor: 'middle', cls: 'muted' });
            }
        }
    }
    body += pathFrom(poly, fy, ox, 'outline');
    // overall dims
    const bl = poly[0], br = poly[1], tr = poly[2], tl = poly[3] || poly[2];
    const dimY = fy(minY) + fontIn * 1.4;
    body += `<line class="dim" x1="${round(bl.x + ox)}" y1="${round(dimY)}" x2="${round(br.x + ox)}" y2="${round(dimY)}"/>`;
    body += text((bl.x + br.x) / 2 + ox, dimY + fontIn * 1.1, `${fmtIn(shape.widthBottomIn)} (bottom)`, { size: fontIn, anchor: 'middle' });
    const dimTopY = fy(maxY) - fontIn * 0.6;
    body += `<line class="dim" x1="${round(tl.x + ox)}" y1="${round(dimTopY)}" x2="${round(tr.x + ox)}" y2="${round(dimTopY)}"/>`;
    body += text((tl.x + tr.x) / 2 + ox, dimTopY - fontIn * 0.4, `${fmtIn(shape.widthTopIn)} (top)`, { size: fontIn, anchor: 'middle' });
    const dimX = Math.min(bl.x, tl.x) + ox - fontIn * 1.2;
    body += `<line class="dim" x1="${round(dimX)}" y1="${round(fy(minY))}" x2="${round(dimX)}" y2="${round(fy(maxY))}"/>`;
    body += text(dimX - fontIn * 0.4, (fy(minY) + fy(maxY)) / 2, `${fmtIn(shape.slantHeightIn)} ${shape.kind === 'table' ? 'deep' : 'slant'}`, { size: fontIn, anchor: 'middle', rotate: -90 });
    // taper / corner angles
    const angles = shape.cornerAnglesDeg || [];
    if (angles.length === 4) {
        body += text(bl.x + ox + fontIn * 0.6, fy(minY) - fontIn * 0.6, fmtDeg(angles[0]), { size: fontIn * 0.95, cls: 'accent' });
        body += text(br.x + ox - fontIn * 0.6, fy(minY) - fontIn * 0.6, fmtDeg(angles[1]), { size: fontIn * 0.95, cls: 'accent', anchor: 'end' });
        body += text(tr.x + ox - fontIn * 0.6, fy(maxY) + fontIn * 1.3, fmtDeg(angles[2]), { size: fontIn * 0.95, cls: 'accent', anchor: 'end' });
        body += text(tl.x + ox + fontIn * 0.6, fy(maxY) + fontIn * 1.3, fmtDeg(angles[3]), { size: fontIn * 0.95, cls: 'accent' });
    }
    const totalW = W + pad * 2, totalH = H + pad * 2.2;
    return svgDocument({ widthIn: totalW, heightIn: totalH, body, title: shape.label || 'Covering' });
}

const _moduleExports = { escapeXml, svgDocument, svgForInline, buildSheetCutSvg, buildFabricPatternSvg, buildWallOverviewSvg };

bridgeGlobals(_moduleExports, 'svgCutFile');
