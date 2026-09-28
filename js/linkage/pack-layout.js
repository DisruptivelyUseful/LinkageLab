// ============================================================================
// LINKAGE LAB — Pack layout (ES module, pure)
//
// Where the folded structures go when everything is packed for transport.
// Each folded structure is a bundle of beams L long (along the beams), H high
// and W wide when lying flat. Standing upright it occupies an H × W footprint
// and is L tall. If K bundles fit inside the IBC tote footprint (nominally
// 40 × 48 in, up to 12 ft tall) they stand inside the tote column, otherwise
// they lie flat beside the IBC in layers, lumber style. Roof beams and panels
// keep their own pile and stack beside the IBC (gltf-export.js).
//
// All dimensions are inches in the scene's Y-up frame. No THREE.
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';

const IBC_FOOTPRINT_IN = Object.freeze({ x: 40, z: 48 });
const IBC_MAX_COLUMN_IN = 144;   // 12 ft

function vec(x, y, z) { return { x, y, z }; }
function add(a, b) { return vec(a.x + b.x, a.y + b.y, a.z + b.z); }
function scale(a, k) { return vec(a.x * k, a.y * k, a.z * k); }

/**
 * Best grid of K upright bundles inside a footprint, trying both bundle orientations.
 * @returns {{cols:number, rows:number, a:number, b:number, swapped:boolean}|null}
 */
function fitUpright(K, footprintX, footprintZ, H, W, margin) {
    const candidates = [{ a: H, b: W, swapped: false }, { a: W, b: H, swapped: true }];
    let best = null;
    candidates.forEach(c => {
        const cols = Math.floor((footprintX - margin) / (c.a + margin));
        const rows = Math.floor((footprintZ - margin) / (c.b + margin));
        if (cols < 1 || rows < 1 || cols * rows < K) return;
        // Prefer the tighter grid (fewest cells), then the one closest to square
        const cells = cols * rows;
        if (!best || cells < best.cells || (cells === best.cells && Math.abs(cols - rows) < Math.abs(best.cols - best.rows))) {
            best = { cols, rows, a: c.a, b: c.b, swapped: c.swapped, cells };
        }
    });
    return best;
}

/**
 * Plans the pack.
 * @param {object} p
 *   K        number of bundles
 *   bundle   { L, H, W } folded bundle dimensions (in)
 *   ibc      null, or { present:true, cx, cz, x, z, height, minY }: tote column footprint centre/size (in)
 *   groundY  ground level (in)
 *   margin   clearance between bundles (in), default 2
 *   side     unit XZ vector pointing to the free side of the IBC (bundles lie here when they do not fit)
 *   away     unit XZ vector from the bundle rest position toward the IBC (long axis when flat)
 *   ibcHalf  half of the tote footprint's larger side (in)
 * @returns {{ mode:'ibc'|'flat', grid, ibcGap, packBox:{x,y,z}, volumeIn3, slots:Array }}
 */
function planPackLayout(p) {
    const K = Math.max(1, p.K | 0);
    const L = Math.max(1, Number(p.bundle && p.bundle.L) || 1);
    const H = Math.max(0.5, Number(p.bundle && p.bundle.H) || 1);
    const W = Math.max(0.5, Number(p.bundle && p.bundle.W) || 1);
    const margin = p.margin !== undefined ? p.margin : 2;
    const groundY = Number(p.groundY) || 0;
    const ibc = p.ibc && p.ibc.present ? p.ibc : null;
    const fx = ibc && ibc.x > 0 ? ibc.x : IBC_FOOTPRINT_IN.x;
    const fz = ibc && ibc.z > 0 ? ibc.z : IBC_FOOTPRINT_IN.z;
    const cx = ibc ? ibc.cx : 0;
    const cz = ibc ? ibc.cz : 0;
    const side = p.side || vec(0, 0, 1);
    const away = p.away || vec(1, 0, 0);
    const ibcHalf = p.ibcHalf !== undefined ? p.ibcHalf : Math.max(fx, fz) / 2;

    const grid = fitUpright(K, fx, fz, H, W, margin);
    const tallOk = L + 2 * margin <= IBC_MAX_COLUMN_IN;
    if (grid && tallOk) {
        // Upright inside the tote footprint: grid centred on the column, bottoms just above the ground
        // Only the cells in use are centred on the column (one bundle sits dead centre)
        const colsUsed = Math.min(grid.cols, K);
        const rowsUsed = Math.ceil(K / colsUsed);
        const slots = [];
        for (let i = 0; i < K; i++) {
            const c = i % colsUsed, r = Math.floor(i / colsUsed);
            slots.push({
                index: i,
                standing: true,
                center: vec(
                    cx + (c - (colsUsed - 1) / 2) * (grid.a + margin),
                    groundY + margin + L / 2,
                    cz + (r - (rowsUsed - 1) / 2) * (grid.b + margin)),
                // bundle H axis runs along the footprint x when not swapped
                yawRad: grid.swapped ? Math.PI / 2 : 0,
            });
        }
        const ibcHeight = ibc ? ibc.height : 0;
        const ibcGap = Math.max(0, L + 2 * margin - ibcHeight);
        const height = Math.max(ibcHeight + ibcGap, L + 2 * margin);
        return {
            mode: 'ibc', grid: { cols: colsUsed, rows: rowsUsed, a: grid.a, b: grid.b },
            ibcGap, packBox: vec(fx, height, fz), volumeIn3: fx * fz * height, slots,
        };
    }

    // Flat beside the IBC (opposite the roof-beam pile): rows of bundles side by side, in layers
    const perLayer = Math.min(K, Math.max(1, Math.round(Math.sqrt(K))));
    const layers = Math.ceil(K / perLayer);
    const rowWidth = perLayer * W + (perLayer - 1) * margin;
    const flatCenter = add(vec(cx, 0, cz), scale(side, -(ibcHalf + rowWidth / 2 + 8)));
    const slots = [];
    for (let i = 0; i < K; i++) {
        const layer = Math.floor(i / perLayer), col = i % perLayer;
        const c = add(flatCenter, scale(side, -((col - (perLayer - 1) / 2) * (W + margin))));
        slots.push({
            index: i,
            standing: false,
            center: vec(c.x, groundY + layer * (H + 0.25) + H / 2, c.z),
            yawRad: Math.atan2(away.z, away.x),   // long axis along `away`
        });
    }
    const height = layers * H + (layers - 1) * 0.25;
    return {
        mode: 'flat', grid: { cols: perLayer, rows: layers, a: W, b: L },
        ibcGap: 0, packBox: vec(rowWidth, height, L), volumeIn3: rowWidth * height * L, slots,
    };
}

/** Human-readable summary of a pack plan (inches → the preferred unit through `fmt`). */
function describePack(plan, K, opts = {}) {
    if (!plan) return '';
    const fmt = opts.formatLength || ((v) => `${Math.round(v)} in`);
    const where = plan.mode === 'ibc'
        ? `inside the IBC column (${plan.grid.cols} × ${plan.grid.rows})`
        : `flat beside the IBC in ${plan.grid.rows} layer${plan.grid.rows === 1 ? '' : 's'}`;
    const parts = [
        `${K} bundle${K === 1 ? '' : 's'} · ${where}`,
        `pack ${fmt(plan.packBox.x)} × ${fmt(plan.packBox.z)} × ${fmt(plan.packBox.y)} high`,
    ];
    if (opts.volume) parts.push(opts.volume);
    if (opts.weight) parts.push(opts.weight);
    return parts.join(' · ');
}

const _moduleExports = { IBC_FOOTPRINT_IN, IBC_MAX_COLUMN_IN, planPackLayout, describePack };
bridgeGlobals(_moduleExports, 'packLayout');
export { IBC_FOOTPRINT_IN, IBC_MAX_COLUMN_IN, planPackLayout, describePack };
