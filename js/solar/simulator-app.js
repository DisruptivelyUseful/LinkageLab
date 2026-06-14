// ============================================================================
// Unified solar canvas app — single simulator runtime for design + simulate
// ============================================================================

import { APP_MODES, markModesLoaded } from '../core/app-router.js';
import { publishCircuitExport, resolveCircuitExport } from './circuit-export.js';
import * as CircuitStore from '../circuit/circuit-store.js';
import { bootstrapSimulator } from '../simulator/bootstrap.js';
import { installSolarDesignerShim } from './solar-designer-shim.js';
import {
    bindAppNavButtons,
    bindSolarTopbar,
    updateSolarTopbarSummary,
} from '../app/topbar.js';

let solarMount = null;
let solarCanvasBooted = false;
let solarBootPromise = null;

function ensureStylesheet(href, id) {
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
}

function ensureCircuitModuleScripts() {
    if (globalThis.CircuitModules) {
        return Promise.resolve();
    }
    if (ensureCircuitModuleScripts._promise) {
        return ensureCircuitModuleScripts._promise;
    }
    ensureCircuitModuleScripts._promise = new Promise((resolve, reject) => {
        if (globalThis.CircuitModules) {
            resolve();
            return;
        }
        window.addEventListener('circuitModulesLoaded', () => resolve(), { once: true });
        const script = document.createElement('script');
        script.type = 'module';
        script.dataset.circuitModules = 'true';
        script.textContent = `
            import * as WireStyles from './js/circuit/wire-styles.js';
            import * as WireRenderer from './js/circuit/wire-renderer.js';
            import * as NodeFactory from './js/circuit/node-factory.js';
            import * as PowerFlow from './js/circuit/power-flow.js';
            import { Scene3D, CoordinateMapper } from './js/circuit/scene3d.js';
            import * as Node3D from './js/circuit/node3d.js';
            import * as Connection3DModule from './js/circuit/connection3d.js';
            import { Interaction3D } from './js/circuit/interaction3d.js';
            import * as PowerStation3DModule from './js/circuit/powerstation3d.js';
            import * as Animation3D from './js/circuit/animation3d.js';
            window.CircuitModules = {
                WireStyles, WireRenderer, NodeFactory, PowerFlow,
                Scene3D, CoordinateMapper, Node3D,
                Connection3D: Connection3DModule,
                Interaction3D,
                PowerStation3D: PowerStation3DModule,
                Animation3D,
            };
            window.dispatchEvent(new CustomEvent('circuitModulesLoaded'));
        `;
        script.onerror = () => reject(new Error('Failed to load CircuitModules'));
        document.head.appendChild(script);
        setTimeout(() => {
            if (globalThis.CircuitModules) resolve();
        }, 15000);
    });
    return ensureCircuitModuleScripts._promise;
}

function resolveCanvasMode(appMode) {
    return appMode === APP_MODES.SOLAR_SIMULATE ? 'simulate' : 'build';
}

function bindSolarChrome(container, circuitData) {
    bindAppNavButtons(container);
    bindSolarTopbar(container, {
        onReload: (data) => refreshSolarCanvasFromCircuit(data),
    });
    updateSolarTopbarSummary(container, circuitData);
}

/**
 * Switch build/simulate behavior on the shared canvas (no DOM remount).
 * @param {'build' | 'simulate'} canvasMode
 */
export function setSolarCanvasAppMode(canvasMode) {
    if (typeof globalThis.setSolarCanvasMode === 'function') {
        globalThis.setSolarCanvasMode(canvasMode);
    } else {
        globalThis.__pendingSolarCanvasMode = canvasMode;
    }
}

/**
 * Boot the shared solar canvas once.
 * @param {HTMLElement} container
 * @param {{ appMode?: string, circuitExport?: object | null, topbarHtml?: string }} [options]
 */
export async function initUnifiedSolarCanvas(container, options = {}) {
    const appMode = options.appMode || APP_MODES.SOLAR_DESIGN;
    const canvasMode = resolveCanvasMode(appMode);

    globalThis.CircuitStore = CircuitStore;
    ensureStylesheet('css/designer.css', 'solar-designer-css');
    ensureStylesheet('css/circuit.css', 'circuit-shared-css');
    ensureStylesheet('css/simulator.css', 'solar-simulator-css');
    await ensureCircuitModuleScripts();

    const circuitData = options.circuitExport ?? resolveCircuitExport();
    if (circuitData) {
        publishCircuitExport(circuitData);
    }

    if (!container.querySelector('#topbar')) {
        container.innerHTML = options.topbarHtml || '';
    }

    container.querySelector('.app-view-placeholder')?.remove();

    if (!solarCanvasBooted) {
        let stageHost = container.querySelector('.simulator-native-host');
        if (!stageHost) {
            stageHost = document.createElement('div');
            stageHost.className = 'simulator-native-host';
            container.appendChild(stageHost);
        }

        globalThis.__pendingSolarCanvasMode = canvasMode;
        await bootstrapSimulator(stageHost, { circuitExport: circuitData, embedded: true });
        installSolarDesignerShim();
        solarCanvasBooted = true;
        markModesLoaded(APP_MODES.SOLAR_DESIGN, APP_MODES.SOLAR_SIMULATE);
    } else if (circuitData && typeof globalThis.applySimulatorCircuitImport === 'function') {
        globalThis.applySimulatorCircuitImport(circuitData, { fitView: false });
    }

    solarMount = container;
    setSolarCanvasAppMode(canvasMode);
    bindSolarChrome(container, circuitData || resolveCircuitExport());

    return {
        componentCount: circuitData?.schematic?.components?.length
            ?? globalThis.getSimulatorCircuitItems?.()?.length
            ?? 0,
    };
}

/** @deprecated use initUnifiedSolarCanvas */
export async function initSolarSimulatorApp(container, options = {}) {
    return initUnifiedSolarCanvas(container, {
        ...options,
        appMode: APP_MODES.SOLAR_SIMULATE,
    });
}

/** @deprecated designer canvas removed — same as initUnifiedSolarCanvas */
export async function initSolarDesignerApp(container, options = {}) {
    return initUnifiedSolarCanvas(container, {
        ...options,
        appMode: APP_MODES.SOLAR_DESIGN,
    });
}

export function ensureSolarCanvasBoot(container, appMode) {
    if (!solarBootPromise) {
        solarBootPromise = initUnifiedSolarCanvas(container, { appMode }).catch((err) => {
            solarBootPromise = null;
            throw err;
        });
    }
    return solarBootPromise.then(() => {
        setSolarCanvasAppMode(resolveCanvasMode(appMode));
    });
}

export function isSolarCanvasReady() {
    return solarCanvasBooted;
}

/**
 * Reload circuit on the shared canvas (in-place).
 * @param {object | null} circuitExport
 * @param {{ fitView?: boolean }} [options]
 */
export async function refreshSolarCanvasFromCircuit(circuitExport, options = {}) {
    if (!circuitExport) return { reloaded: false, componentCount: 0 };
    publishCircuitExport(circuitExport);

    const mount = solarMount || document.getElementById('view-solar');
    if (!mount) return { reloaded: false, componentCount: 0 };

    if (solarCanvasBooted && typeof globalThis.applySimulatorCircuitImport === 'function') {
        globalThis.applySimulatorCircuitImport(circuitExport, { fitView: options.fitView ?? false });
        bindSolarChrome(mount, circuitExport);
        return {
            reloaded: true,
            componentCount: circuitExport.schematic?.components?.length ?? 0,
        };
    }

    await initUnifiedSolarCanvas(mount, {
        topbarHtml: mount.querySelector('#topbar')?.outerHTML || '',
        circuitExport,
        appMode: globalThis.AppRouter?.getCurrentMode?.() || APP_MODES.SOLAR_DESIGN,
    });

    return {
        reloaded: true,
        componentCount: circuitExport.schematic?.components?.length ?? 0,
    };
}

/** @deprecated use refreshSolarCanvasFromCircuit */
export const refreshSolarSimulatorFromCircuit = refreshSolarCanvasFromCircuit;

/** @deprecated no-op — single canvas, no layout refresh needed */
export function scheduleSolarDesignerLayoutRefresh() {
    requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'));
    });
}

/** @deprecated use refreshSolarCanvasFromCircuit */
export async function refreshSolarDesignerFromCircuit(circuitDocOrExport) {
    if (!circuitDocOrExport) return { reloaded: false };
    const exportData = circuitDocOrExport.items
        ? circuitDocOrExport
        : circuitDocOrExport.schematic
            ? circuitDocOrExport
            : null;
    if (!exportData) return { reloaded: false };
    return refreshSolarCanvasFromCircuit(
        exportData.schematic ? exportData : { schematic: { components: exportData.items, connections: exportData.connections } },
    );
}

/** @deprecated no-op — design and simulate share one in-memory circuit */
export async function syncDesignerFromSimulatorSnapshot() {
    return { synced: true };
}

/** @deprecated iframe activation — no-op in native mount mode */
export function activateSimulatorFrame(root = solarMount) {
    void root;
}
