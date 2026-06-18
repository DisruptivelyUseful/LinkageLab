// ============================================================================
// StarShade game bundle — single JSON for Godot simulator import
// ============================================================================

import { showToast } from './feedback.js';
import { buildProjectExport } from './project-export.js';
import { generateDefaultFilename } from '../linkage/export-bridge.js';
import { exportToGLTF } from '../linkage/gltf-export.js';
import { state } from '../linkage/app-state.js';

export const GAME_BUNDLE_VERSION = 1;
export const GAME_BUNDLE_TYPE = 'linkageLab.gameBundle';

/**
 * Derive IBC metadata for Godot IBCGlow attachment.
 * @param {object} project
 * @returns {{ present: boolean, count: number, wattage: number, meshNames: string[] }}
 */
export function deriveIbcBundleInfo(project) {
    const ibc = project?.ibc || {};
    const vis = project?.visibility?.ibc ?? state?.ibc?.enabled ?? false;
    const enabled = !!(ibc.enabled && vis && (ibc.count | 0) > 0);
    if (!enabled) {
        return { present: false, count: 0, wattage: 20, meshNames: [] };
    }
    const count = Math.min(2, Math.max(1, ibc.count | 0));
    const meshNames = [];
    for (let i = 0; i < count; i += 1) {
        meshNames.push(`IBC_Tank_${i}`);
    }
    return { present: true, count, wattage: 20, meshNames };
}

/**
 * Aggregate solar specs from circuit items + linkage panel config.
 * @param {object} project
 * @returns {object}
 */
export function deriveSolarBundleInfo(project) {
    const circuit = project?.circuit || {};
    const items = circuit.items || [];
    const panels = items.filter((i) => i.type === 'panel');
    let panelCount = panels.length;
    let totalWatts = panels.reduce((sum, p) => sum + (p.specs?.wmp || 0), 0);

    if (panelCount === 0 && project?.summary) {
        panelCount = project.summary.panelCount || 0;
        totalWatts = project.summary.totalWatts || 0;
    }

    const panelWatts = panelCount > 0 ? Math.round(totalWatts / panelCount) : 0;
    const batteries = items.filter((i) => i.type === 'battery' || i.type === 'smartbattery');
    const batteryKwh = batteries.reduce((sum, b) => {
        const s = b.specs || {};
        const kwh = s.kWh ?? s.kwh ?? (((s.voltage || 0) * (s.ah || 0)) / 1000);
        return sum + (kwh || 0);
    }, 0);

    const gridRot = project?.panels?.gridRotation ?? 0;
    const tiltDeg = Math.abs(gridRot) > 90 ? 90 - Math.abs(gridRot % 90) : 0;
    const azimuthDeg = 180;

    return {
        panelCount,
        panelWatts,
        totalWatts,
        tiltDeg: +tiltDeg.toFixed(1),
        azimuthDeg,
        batteryKwh: +batteryKwh.toFixed(3),
    };
}

/**
 * @param {object} project
 * @returns {{ latitude: number|null, longitude: number|null, label: string, ghiKwhPerM2Day: number|null }}
 */
export function deriveLocationBundleInfo(project) {
    const sim = project?.simulation || {};
    return {
        latitude: sim.latitude ?? null,
        longitude: sim.longitude ?? null,
        label: sim.energyZoneLabel || sim.label || project?.summary?.name || '',
        ghiKwhPerM2Day: sim.ghiKwhPerM2Day ?? null,
    };
}

/**
 * Build a Godot-ready game bundle from current app state.
 * @returns {Promise<object>}
 */
export async function buildGameBundle() {
    const project = buildProjectExport();
    const name = generateDefaultFilename();

    let model = {
        format: 'glb',
        units: 'meters',
        coordSys: 'yup',
        base64: '',
        bounds: null,
        heightM: 0,
    };

    try {
        const glbResult = await exportToGLTF('glb', 'meters', 'yup', { download: false, silent: true });
        if (glbResult?.blob) {
            const glbBase64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
                reader.onerror = reject;
                reader.readAsDataURL(glbResult.blob);
            });
            model.base64 = glbBase64;
            const geom = project.geometrySnapshot || project.handoff?.linkage?.structureGeometry;
            if (geom?.bounds) {
                const b = geom.bounds;
                const minY = b.min?.y ?? 0;
                const maxY = b.max?.y ?? 0;
                model.bounds = b;
                model.heightM = +((maxY - minY) * 0.0254).toFixed(3);
            } else if (project.summary?.structureDimensions?.maxHeight) {
                model.heightM = +(project.summary.structureDimensions.maxHeight * 0.0254).toFixed(3);
            }
        }
    } catch (err) {
        console.warn('[export-game-bundle] GLB embed failed:', err);
    }

    const circuit = project.circuit || {
        items: [],
        connections: [],
        itemIdCounter: 1,
        connectionIdCounter: 1,
    };

    return {
        exportType: GAME_BUNDLE_TYPE,
        bundleVersion: GAME_BUNDLE_VERSION,
        name,
        createdAt: Date.now(),
        model,
        circuit: {
            items: circuit.items || [],
            connections: circuit.connections || [],
            itemIdCounter: circuit.itemIdCounter ?? 1,
            connectionIdCounter: circuit.connectionIdCounter ?? 1,
        },
        solar: deriveSolarBundleInfo(project),
        ibc: deriveIbcBundleInfo(project),
        location: deriveLocationBundleInfo(project),
        project,
    };
}

/** Download the game bundle as a single JSON file. */
export async function exportGameBundleFile() {
    const defaultName = generateDefaultFilename();
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#1e2732;border-radius:8px;padding:24px;min-width:400px;max-width:500px;color:#e1e8ed;font-family:system-ui,sans-serif;';
    dialog.innerHTML = `
        <h3 style="margin:0 0 16px 0;font-size:1.2rem;">Export for Godot Simulator</h3>
        <p style="margin:0 0 12px 0;color:#8899a6;font-size:0.9rem;">One file bundles the 3D model, electrical circuit, solar specs, and location for import into the Godot simulator.</p>
        <input type="text" id="game-bundle-filename" value="${defaultName}"
               style="width:100%;padding:10px;border:1px solid #38444d;border-radius:4px;background:#15202b;color:#e1e8ed;font-size:1rem;box-sizing:border-box;">
        <p style="margin:8px 0 16px 0;color:#657786;font-size:0.8rem;">.gamebundle.json extension will be added automatically</p>
        <div style="display:flex;gap:12px;justify-content:flex-end;">
            <button id="game-bundle-cancel" style="padding:8px 16px;border:1px solid #38444d;border-radius:4px;background:transparent;color:#e1e8ed;cursor:pointer;">Cancel</button>
            <button id="game-bundle-confirm" style="padding:8px 16px;border:none;border-radius:4px;background:#1da1f2;color:white;cursor:pointer;font-weight:500;">Export</button>
        </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const filenameInput = document.getElementById('game-bundle-filename');
    filenameInput.focus();
    filenameInput.select();

    const doCancel = () => document.body.removeChild(overlay);

    const doExport = async () => {
        let filename = filenameInput.value.trim() || defaultName;
        filename = filename.replace(/[<>:"/\\|?*]/g, '-');
        if (!filename.endsWith('.gamebundle.json')) filename += '.gamebundle.json';

        try {
            showToast('Building game bundle (embedding 3D model)…', 'info');
            const bundle = await buildGameBundle();
            const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            anchor.click();
            URL.revokeObjectURL(url);
            showToast(`Exported game bundle: ${filename}`, 'info');
        } catch (err) {
            console.error('[export-game-bundle] export failed:', err);
            showToast(`Export failed: ${err.message}`, 'error');
        } finally {
            doCancel();
        }
    };

    document.getElementById('game-bundle-confirm').onclick = () => { doExport(); };
    document.getElementById('game-bundle-cancel').onclick = doCancel;
    filenameInput.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); doExport(); }
        else if (e.key === 'Escape') { e.preventDefault(); doCancel(); }
    };
    overlay.onclick = (e) => { if (e.target === overlay) doCancel(); };
}

globalThis.buildGameBundle = buildGameBundle;
globalThis.exportGameBundleFile = exportGameBundleFile;
