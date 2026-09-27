// ============================================================================
// LINKAGE LAB — Material studio (ES module)
//
// One place for every viewport / preview / export material: wood beams with a
// subtle procedural grain, dark metal hardware, and the solar panel set
// (procedural cell texture on a clearcoat glass, anodised frame, white
// backsheet). Materials and textures are cached and shared, so callers that
// need to mutate one (fade, ghost, highlight) MUST clone it first — see
// cloneMaterialForMutation().
//
// Nothing here touches THREE at module top level: unit tests import the pure
// helpers (panelCellGrid, woodUvScale, woodColorFor) without a WebGL context.
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { hexToLinear } from './sky-model.js';

// --- pure helpers (testable) -------------------------------------------------

/** Wood-grain texture repeats once per this many inches of beam length. */
const WOOD_GRAIN_REPEAT_IN = 24;

/** u scale for a beam so the grain repeats every WOOD_GRAIN_REPEAT_IN inches. */
function woodUvScale(lengthIn) {
    const L = Math.max(1, Number(lengthIn) || 1);
    return L / WOOD_GRAIN_REPEAT_IN;
}

/** Nominal solar cell pitch used to pick the cell grid for a panel. */
const CELL_PITCH_IN = 6.3;   // 39" x 65" → 6 x 10 cells, like a 60-cell module

/**
 * Cell grid for a panel face: columns along U (the first edge) and rows along V.
 * @returns {{ cols: number, rows: number, busbarsAlongU: boolean, key: string }}
 */
function panelCellGrid(extentUIn, extentVIn) {
    const u = Math.max(1, Number(extentUIn) || 1);
    const v = Math.max(1, Number(extentVIn) || 1);
    const cols = Math.max(4, Math.round(u / CELL_PITCH_IN));
    const rows = Math.max(4, Math.round(v / CELL_PITCH_IN));
    const busbarsAlongU = u >= v;
    return { cols, rows, busbarsAlongU, key: `${cols}x${rows}${busbarsAlongU ? 'u' : 'v'}` };
}

/**
 * Beam colour (linear 0..1) and cache key for a beam's state. Same darkening
 * formula the renderer has always used, plus the collision / kinematic tints.
 */
function woodColorFor(beam, isColliding = false) {
    if (isColliding) return { key: 'collide', r: 0.9, g: 0.2, b: 0.1 };
    if (beam && beam.kinematicState === 'error') return { key: 'kin-error', r: 0.82, g: 0.28, b: 0.18 };
    if (beam && beam.kinematicState === 'warning') return { key: 'kin-warning', r: 0.72, g: 0.52, b: 0.18 };
    const base = (beam && beam.colorBase) || { r: 238, g: 191, b: 161 };
    const r = Math.max(0, base.r * 0.7 - 20) / 255;
    const g = Math.max(0, base.g * 0.65 - 15) / 255;
    const b = Math.max(0, base.b * 0.5 - 10) / 255;
    return { key: `wood-${base.r}-${base.g}-${base.b}`, r, g, b };
}

// --- caches --------------------------------------------------------------------

let _caches = null;
function caches() {
    if (!_caches) _caches = { materials: new Map(), textures: new Map(), envTracked: new Map() };
    return _caches;
}

function cached(key, factory) {
    const c = caches();
    if (c.materials.has(key)) return c.materials.get(key);
    const m = factory();
    m._cacheKey = key;            // clearGroup() leaves cached materials alone
    c.materials.set(key, m);
    if (m.envMapIntensity !== undefined) c.envTracked.set(m, m.envMapIntensity);
    return m;
}

function cachedTexture(key, factory) {
    const c = caches();
    if (c.textures.has(key)) return c.textures.get(key);
    const t = factory();
    c.textures.set(key, t);
    return t;
}

/** Scale every cached material's envMapIntensity (day/night); base values are remembered. */
function setEnvMapScale(scale) {
    const c = caches();
    c.envTracked.forEach((base, m) => { m.envMapIntensity = base * scale; });
}

/** Materials created outside this module can opt into the day/night env scaling. */
function trackEnvMaterial(m) {
    if (m && m.envMapIntensity !== undefined) caches().envTracked.set(m, m.envMapIntensity);
}

function linearColor(hex) {
    const c = hexToLinear(hex);
    return new THREE.Color(c.r, c.g, c.b);
}

function maxAnisotropy() {
    const r = globalThis.threeRenderer && globalThis.threeRenderer.main;
    try { return r ? Math.min(8, r.capabilities.getMaxAnisotropy()) : 1; } catch (e) { return 1; }
}

/** Clone a material or material array so it can be mutated without touching the cache. */
function cloneMaterialForMutation(material) {
    if (Array.isArray(material)) return material.map(m => (m && m.clone ? m.clone() : m));
    return material && material.clone ? material.clone() : material;
}

// --- wood ----------------------------------------------------------------------

/** Light, low-contrast grain streaks along U; multiplied by the material colour. */
function makeWoodGrainTexture() {
    const W = 512, H = 128;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#f4efe8';
    g.fillRect(0, 0, W, H);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    // Long soft streaks (early wood / late wood)
    for (let i = 0; i < 46; i++) {
        const y = rnd() * H;
        const thick = 1 + rnd() * 3;
        const alpha = 0.05 + rnd() * 0.11;
        g.strokeStyle = `rgba(120, 78, 40, ${alpha.toFixed(3)})`;
        g.lineWidth = thick;
        g.beginPath();
        let x = -10, yy = y;
        g.moveTo(x, yy);
        while (x < W + 10) {
            x += 24 + rnd() * 40;
            yy += (rnd() - 0.5) * 3;
            g.lineTo(x, yy);
        }
        g.stroke();
    }
    // A couple of faint knots
    for (let k = 0; k < 2; k++) {
        const x = 60 + rnd() * (W - 120), y = 20 + rnd() * (H - 40);
        for (let r = 14; r > 2; r -= 3) {
            g.strokeStyle = `rgba(110, 70, 35, ${(0.04 + (14 - r) * 0.006).toFixed(3)})`;
            g.lineWidth = 1.2;
            g.beginPath();
            g.ellipse(x, y, r * 1.6, r, 0, 0, Math.PI * 2);
            g.stroke();
        }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = maxAnisotropy();
    return tex;
}

/**
 * Wood beam material for a beam's state.
 * @param {object} beam
 * @param {boolean} isColliding
 * @param {{ forExport?: boolean }} [opts] export = plain untextured standard material
 */
function getWoodMaterial(beam, isColliding = false, opts = {}) {
    const col = woodColorFor(beam, isColliding);
    const forExport = !!opts.forExport;
    return cached(`wood:${col.key}:${forExport ? 'export' : 'view'}`, () => {
        const m = new THREE.MeshStandardMaterial({
            color: new THREE.Color(col.r, col.g, col.b),
            roughness: 0.8,
            metalness: 0.0,
            side: forExport ? THREE.FrontSide : THREE.DoubleSide,
        });
        m.envMapIntensity = 0.45;
        if (!forExport) {
            const grain = cachedTexture('wood-grain', makeWoodGrainTexture);
            if (grain) m.map = grain;
        }
        return m;
    });
}

// --- hardware --------------------------------------------------------------------

/**
 * Dark metal for brackets / bolts / washers.
 * @param {string} kind cache namespace
 * @param {number} colorHex raw hex (kept as-is: these were designed as linear values)
 */
function getHardwareMaterial(kind, colorHex, opts = {}) {
    const key = `hw:${kind}:${colorHex}:${opts.polygonOffset || 0}`;
    return cached(key, () => {
        const m = new THREE.MeshStandardMaterial({
            color: colorHex,
            metalness: opts.metalness !== undefined ? opts.metalness : 0.7,
            roughness: opts.roughness !== undefined ? opts.roughness : 0.45,
        });
        m.envMapIntensity = 0.6;
        if (opts.polygonOffset) {
            m.polygonOffset = true;
            m.polygonOffsetFactor = opts.polygonOffset;
            m.polygonOffsetUnits = opts.polygonOffset;
        }
        return m;
    });
}

// --- solar panels ------------------------------------------------------------------

/** Procedural mono-crystalline cell sheet (port of the StarShade viewer texture). */
function makePanelTexture(cols, rows, busbarsAlongU) {
    const W = 512;
    const H = Math.max(64, Math.round(W * rows / cols));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    if (!g) return null;

    // Black anodised frame around a dark backsheet.
    g.fillStyle = '#121519';
    g.fillRect(0, 0, W, H);
    const fw = Math.round(W * 0.02);
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.lineWidth = 1;
    g.strokeRect(fw - 1.5, fw - 1.5, W - 2 * fw + 3, H - 2 * fw + 3);
    g.fillStyle = '#0a1226';
    g.fillRect(fw, fw, W - 2 * fw, H - 2 * fw);

    // Cells: chamfered squares with a soft radial sheen.
    const gap = Math.max(2, Math.round(W * 0.006));
    const cw = (W - 2 * fw - gap * (cols + 1)) / cols;
    const ch = (H - 2 * fw - gap * (rows + 1)) / rows;
    const cham = Math.min(cw, ch) * 0.1;
    for (let r = 0; r < rows; r++) {
        for (let k = 0; k < cols; k++) {
            const x = fw + gap + k * (cw + gap);
            const y = fw + gap + r * (ch + gap);
            const grad = g.createRadialGradient(x + cw * 0.35, y + ch * 0.3, 2, x + cw / 2, y + ch / 2, Math.max(cw, ch) * 0.8);
            grad.addColorStop(0, '#1f4fc4');
            grad.addColorStop(0.55, '#123394');
            grad.addColorStop(1, '#0a2168');
            g.fillStyle = grad;
            g.beginPath();
            g.moveTo(x + cham, y);
            g.lineTo(x + cw - cham, y);
            g.lineTo(x + cw, y + cham);
            g.lineTo(x + cw, y + ch - cham);
            g.lineTo(x + cw - cham, y + ch);
            g.lineTo(x + cham, y + ch);
            g.lineTo(x, y + ch - cham);
            g.lineTo(x, y + cham);
            g.closePath();
            g.fill();
            // Fingers across, busbars along the long dimension.
            const fingers = 14;
            g.strokeStyle = 'rgba(255,255,255,0.08)';
            g.lineWidth = 1;
            for (let f = 1; f < fingers; f++) {
                if (busbarsAlongU) { const fx = x + (cw * f) / fingers; g.beginPath(); g.moveTo(fx, y + 2); g.lineTo(fx, y + ch - 2); g.stroke(); }
                else { const fy = y + (ch * f) / fingers; g.beginPath(); g.moveTo(x + 2, fy); g.lineTo(x + cw - 2, fy); g.stroke(); }
            }
            g.strokeStyle = 'rgba(226,232,240,0.8)';
            g.lineWidth = Math.max(1.2, Math.min(cw, ch) * 0.03);
            for (let b = 1; b <= 3; b++) {
                if (busbarsAlongU) { const by = y + (ch * b) / 4; g.beginPath(); g.moveTo(x + 1, by); g.lineTo(x + cw - 1, by); g.stroke(); }
                else { const bx = x + (cw * b) / 4; g.beginPath(); g.moveTo(bx, y + 1); g.lineTo(bx, y + ch - 1); g.stroke(); }
            }
        }
    }
    // Glass gloss across the cells only.
    const gloss = g.createLinearGradient(0, 0, W, H);
    gloss.addColorStop(0, 'rgba(255,255,255,0.09)');
    gloss.addColorStop(0.45, 'rgba(255,255,255,0.01)');
    gloss.addColorStop(0.7, 'rgba(255,255,255,0.06)');
    gloss.addColorStop(1, 'rgba(255,255,255,0.0)');
    g.save();
    g.beginPath(); g.rect(fw, fw, W - 2 * fw, H - 2 * fw); g.clip();
    g.fillStyle = gloss;
    g.fillRect(0, 0, W, H);
    g.restore();

    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = maxAnisotropy();
    return tex;
}

/**
 * Panel material set for a panel of the given face extents (inches).
 * @returns {{ cell: Material, frame: Material, back: Material, hinge: Material, grid: object }}
 */
function getPanelMaterials(extentUIn, extentVIn, opts = {}) {
    const grid = panelCellGrid(extentUIn, extentVIn);
    const forExport = !!opts.forExport;
    const cell = cached(`panel-cell:${forExport ? 'export' : grid.key}`, () => {
        if (forExport) {
            const m = new THREE.MeshStandardMaterial({ color: 0x1a3a5a, roughness: 0.3, metalness: 0.5 });
            return m;
        }
        const m = new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            metalness: 0.2,
            roughness: 0.3,
            clearcoat: 0.6,
            clearcoatRoughness: 0.12,
            side: THREE.DoubleSide,
        });
        m.envMapIntensity = 0.9;
        const tex = cachedTexture(`panel-tex:${grid.key}`, () => makePanelTexture(grid.cols, grid.rows, grid.busbarsAlongU));
        if (tex) m.map = tex;
        return m;
    });
    const frame = cached(`panel-frame:${forExport ? 'export' : 'view'}`, () => {
        const m = new THREE.MeshStandardMaterial({ color: linearColor('#15181d'), metalness: 0.75, roughness: 0.42, side: THREE.DoubleSide });
        m.envMapIntensity = 0.8;
        return m;
    });
    const back = cached(`panel-back:${forExport ? 'export' : 'view'}`, () => {
        const m = new THREE.MeshStandardMaterial({ color: linearColor('#f1f3f5'), metalness: 0, roughness: 0.9, side: THREE.DoubleSide });
        m.envMapIntensity = 0.3;
        return m;
    });
    const hinge = cached('panel-hinge', () => new THREE.MeshStandardMaterial({ color: 0x252528, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide }));
    return { cell, frame, back, hinge, grid };
}

const _moduleExports = {
    WOOD_GRAIN_REPEAT_IN,
    CELL_PITCH_IN,
    woodUvScale,
    panelCellGrid,
    woodColorFor,
    getWoodMaterial,
    getHardwareMaterial,
    getPanelMaterials,
    makePanelTexture,
    makeWoodGrainTexture,
    setEnvMapScale,
    trackEnvMaterial,
    cloneMaterialForMutation,
    linearColor,
};

bridgeGlobals(_moduleExports, 'materials');

export {
    WOOD_GRAIN_REPEAT_IN,
    CELL_PITCH_IN,
    woodUvScale,
    panelCellGrid,
    woodColorFor,
    getWoodMaterial,
    getHardwareMaterial,
    getPanelMaterials,
    makePanelTexture,
    makeWoodGrainTexture,
    setEnvMapScale,
    trackEnvMaterial,
    cloneMaterialForMutation,
    linearColor,
};
