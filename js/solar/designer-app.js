// ============================================================================
// Solar designer lazy module (Phase 5c)
// ============================================================================

import { linkageExportToSyncConfig } from './linkage-import.js';

const MANIFEST_PATH = 'config/solar-designer-manifest.json';
let designerBootPromise = null;
let solarConstantsPromise = null;
let layoutObserver = null;

/** Re-measure and recenter the designer canvas after the view becomes visible. */
export function scheduleSolarDesignerLayoutRefresh() {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const designer = globalThis.SolarDesigner;
            if (!designer?.refreshCanvasViewport) return;
            if (designer.refreshCanvasViewport()) {
                designer.render?.();
            }
        });
    });
}

function bindSolarDesignerChrome() {
    const leftToggle = document.getElementById('left-sidebar-toggle');
    const leftSidebar = document.getElementById('left-sidebar');
    if (leftToggle && leftSidebar && !leftToggle.dataset.bound) {
        leftToggle.dataset.bound = 'true';
        leftToggle.addEventListener('click', () => {
            leftSidebar.classList.toggle('collapsed');
            scheduleSolarDesignerLayoutRefresh();
        });
    }

    const designer = globalThis.SolarDesigner;
    if (designer?.populateRightSidebarLibraries) {
        designer.populateRightSidebarLibraries();
    }
    if (designer?.setupRightSidebarListeners) {
        designer.setupRightSidebarListeners();
    }
}

function bindSolarDesignerLayout() {
    const container = document.getElementById('solar-canvas-container');
    if (!container || layoutObserver) return;

    layoutObserver = new ResizeObserver(() => {
        if (globalThis.SolarDesigner?.refreshCanvasViewport?.()) {
            globalThis.SolarDesigner.render?.();
        }
    });
    layoutObserver.observe(container);
    scheduleSolarDesignerLayoutRefresh();
}

async function ensureSolarConstants() {
    if (globalThis.PANEL_PRESETS) return;
    if (!solarConstantsPromise) {
        solarConstantsPromise = import('../core/constants.js');
    }
    await solarConstantsPromise;
}

function ensureStylesheet(href, id) {
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
}

async function fetchText(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${path} (HTTP ${res.status})`);
    return res.text();
}

async function injectPartials(partials) {
    for (const spec of partials) {
        const mount = document.querySelector(spec.mount);
        if (!mount) throw new Error(`Solar designer mount not found: ${spec.mount}`);
        mount.insertAdjacentHTML('beforeend', await fetchText(spec.path));
    }
}

function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) {
            if (existing.dataset.loaded === 'true') {
                resolve();
                return;
            }
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error(`Failed to load script: ${src}`)), { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => {
            script.dataset.loaded = 'true';
            resolve();
        };
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
    });
}

async function ensureSolarDesignerRuntime() {
    if (typeof globalThis.SolarDesigner !== 'undefined') {
        return globalThis.SolarDesigner;
    }

    await loadScriptOnce('https://d3js.org/d3.v7.min.js');
    await ensureSolarConstants();
    await import('../core/export-format.js');
    await import('../core/feedback.js');
    await loadScriptOnce('js/core/automation.js');
    await loadScriptOnce('js/solar/wires.js');
    await loadScriptOnce('js/solar/bom.js');
    await loadScriptOnce('js/solar/review.js');
    await loadScriptOnce('js/solar/resources.js');
    await loadScriptOnce('solar-designer.js');

    if (typeof globalThis.SolarDesigner === 'undefined') {
        throw new Error('SolarDesigner failed to load');
    }
    return globalThis.SolarDesigner;
}

function applyLinkageExport(SolarDesigner, exportData) {
    if (!exportData) return { synced: false, panelCount: 0 };

    SolarDesigner.setLinkageConfig(exportData);

    const syncConfig = linkageExportToSyncConfig(exportData);
    if (!syncConfig) return { synced: false, panelCount: 0 };

    const result = SolarDesigner.syncPanelsFromLinkage(syncConfig);
    if (result?.synced) {
        SolarDesigner.render();
    }
    return {
        synced: !!result?.synced,
        panelCount: exportData.solarPanels?.count ?? 0,
        message: result?.message,
    };
}

/**
 * @param {HTMLElement} container - #view-solar-design
 * @param {{ linkageExport?: object | null, topbarHtml?: string }} [options]
 */
export async function initSolarDesignerApp(container, options = {}) {
    if (!designerBootPromise) {
        designerBootPromise = (async () => {
            ensureStylesheet('css/designer.css', 'solar-designer-css');

            const manifest = JSON.parse(await fetchText(MANIFEST_PATH));
            container.innerHTML = `
                ${options.topbarHtml || ''}
                <div class="solar-designer-layout">
                    <aside class="solar-designer-left-rail" aria-label="Simulation controls">
                        <div id="left-sidebar">
                            <button id="left-sidebar-toggle" type="button" title="Toggle System Stats panel">◀</button>
                            <div class="solar-designer-left-mount">
                                <div id="solar-sidebar"></div>
                            </div>
                        </div>
                    </aside>
                    <div class="solar-designer-stage"></div>
                </div>
                <div id="toast" class="toast"></div>
            `;

            await injectPartials(manifest.partials || []);

            const canvas = document.getElementById('solar-canvas-container');
            if (canvas) canvas.classList.add('active');

            const SolarDesigner = await ensureSolarDesignerRuntime();

            if (!SolarDesigner.isInitialized()) {
                SolarDesigner.init(options.linkageExport || null);
            }

            bindSolarDesignerLayout();
            bindSolarDesignerChrome();
            return SolarDesigner;
        })().catch((err) => {
            designerBootPromise = null;
            throw err;
        });
    }

    const SolarDesigner = await designerBootPromise;
    const result = applyLinkageExport(SolarDesigner, options.linkageExport ?? null);
    scheduleSolarDesignerLayoutRefresh();
    return result;
}

/**
 * Re-apply linkage export when navigating to solar-design again.
 * @param {object | null} linkageExport
 */
export async function refreshSolarDesignerFromExport(linkageExport) {
    if (!linkageExport || typeof globalThis.SolarDesigner === 'undefined') {
        return { synced: false, panelCount: 0 };
    }
    if (!globalThis.SolarDesigner.isInitialized()) {
        return { synced: false, panelCount: 0 };
    }
    const result = applyLinkageExport(globalThis.SolarDesigner, linkageExport);
    scheduleSolarDesignerLayoutRefresh();
    return result;
}
