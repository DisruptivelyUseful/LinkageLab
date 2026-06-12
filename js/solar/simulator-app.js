// ============================================================================
// Solar simulator app — native mount in unified shell (Phase 7)
// ============================================================================

import { publishCircuitExport, resolveCircuitExport } from './circuit-export.js';
import * as CircuitStore from '../circuit/circuit-store.js';
import { bootstrapSimulator } from '../simulator/bootstrap.js';
import {
    bindAppNavButtons,
    bindSimulatorTopbar,
    updateSimulatorTopbarSummary,
} from '../app/topbar.js';

let simulatorMount = null;
let simulatorBooted = false;

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

function bindSimulatorChrome(container, circuitData) {
    bindAppNavButtons(container);
    bindSimulatorTopbar(container, {
        onReload: (data) => refreshSolarSimulatorFromCircuit(data),
    });
    updateSimulatorTopbarSummary(container, circuitData);
}

/**
 * @param {HTMLElement} container
 * @param {{ circuitExport?: object | null, topbarHtml?: string }} [options]
 */
export async function initSolarSimulatorApp(container, options = {}) {
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

    if (!circuitData) {
        if (!container.querySelector('.app-view-placeholder')) {
            container.insertAdjacentHTML('beforeend', `
                <div class="app-view-placeholder" role="status">
                    <h1>Solar Simulate</h1>
                    <p>No circuit staged yet. Open Solar Design and click ▶ Simulate.</p>
                </div>
            `);
        }
        simulatorMount = container;
        return { componentCount: 0 };
    }

    container.querySelector('.app-view-placeholder')?.remove();

    if (!simulatorBooted) {
        let stageHost = container.querySelector('.simulator-native-host');
        if (!stageHost) {
            stageHost = document.createElement('div');
            stageHost.className = 'simulator-native-host';
            container.appendChild(stageHost);
        }

        await bootstrapSimulator(stageHost, { circuitExport: circuitData, embedded: true });
        simulatorBooted = true;
    } else if (typeof globalThis.applySimulatorCircuitImport === 'function') {
        globalThis.applySimulatorCircuitImport(circuitData);
    }

    simulatorMount = container;
    bindSimulatorChrome(container, circuitData);

    return {
        componentCount: circuitData.schematic?.components?.length ?? 0,
    };
}

/** @deprecated iframe activation — no-op in native mount mode */
export function activateSimulatorFrame(root = simulatorMount) {
    void root;
}

/**
 * Reload simulator when circuit export changes (in-place — no DOM remount).
 * @param {object | null} circuitExport
 */
export async function refreshSolarSimulatorFromCircuit(circuitExport) {
    if (!circuitExport) return { reloaded: false, componentCount: 0 };
    publishCircuitExport(circuitExport);

    const mount = simulatorMount || document.getElementById('view-solar-simulate');
    if (!mount) return { reloaded: false, componentCount: 0 };

    if (simulatorBooted && typeof globalThis.applySimulatorCircuitImport === 'function') {
        globalThis.applySimulatorCircuitImport(circuitExport);
        bindSimulatorChrome(mount, circuitExport);
        return {
            reloaded: true,
            componentCount: circuitExport.schematic?.components?.length ?? 0,
        };
    }

    await initSolarSimulatorApp(mount, {
        topbarHtml: mount.querySelector('#topbar')?.outerHTML || '',
        circuitExport,
    });

    return {
        reloaded: true,
        componentCount: circuitExport.schematic?.components?.length ?? 0,
    };
}
