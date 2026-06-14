// ============================================================================
// Simulator native bootstrap — mount workspace DOM + load runtime
// ============================================================================

import { loadSimulatorRuntime } from './runtime-loader.js';
import { stageCircuitExport } from './config-io.js';

const WORKSPACE_URL = 'partials/simulator-workspace.html';

const OVERLAY_IDS = [
    '#bomOverlay',
    '#achievementOverlay',
    '#tutorialOverlay',
    '#incidentReportOverlay',
    '#hintPopup',
    '#shortcutsOverlay',
];

/**
 * Extract simulator workspace markup from standalone HTML shell.
 * @param {Document} doc
 */
function extractWorkspaceFragment(doc, { embedded = false } = {}) {
    const fragment = document.createDocumentFragment();

    // Standalone simulator page keeps its own controls row; embedded shell uses #topbar partial.
    if (!embedded) {
        const controls = doc.querySelector('.sim-topbar-row-controls');
        if (controls) {
            const bar = document.createElement('div');
            bar.className = 'sim-topbar sim-topbar-native';
            bar.appendChild(controls.cloneNode(true));
            fragment.appendChild(bar);
        }
    }

    const main = doc.getElementById('main-content');
    if (main) {
        fragment.appendChild(main.cloneNode(true));
    }

    const dock = doc.getElementById('sim-bottom-dock');
    if (dock) {
        fragment.appendChild(dock.cloneNode(true));
    }

    return fragment;
}

/** Mount modal overlays on document.body (fixed positioning, hidden by default). */
function mountGlobalOverlays(doc) {
    OVERLAY_IDS.forEach((selector) => {
        const source = doc.querySelector(selector);
        if (!source) return;
        const id = source.id;
        document.getElementById(id)?.remove();
        document.body.appendChild(source.cloneNode(true));
    });
}

/**
 * Mount simulator into unified app view container (once per session).
 * @param {HTMLElement} container
 * @param {{ circuitExport?: object | null }} [options]
 */
export async function bootstrapSimulator(container, options = {}) {
    if (container.querySelector('.simulator-native-stage')) {
        return { mounted: true, itemCount: options.circuitExport?.schematic?.components?.length ?? 0 };
    }

    if (options.circuitExport) {
        stageCircuitExport(options.circuitExport);
    }

    const res = await fetch(WORKSPACE_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${WORKSPACE_URL}`);
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');

    const stage = document.createElement('div');
    stage.className = 'simulator-native-stage simulator-page simulator-embedded';
    stage.appendChild(extractWorkspaceFragment(doc, { embedded: true }));
    container.appendChild(stage);

    mountGlobalOverlays(doc);

    await loadSimulatorRuntime({ embedded: true });

    requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'));
        if (typeof globalThis.bootSimulatorApplication === 'function' && !globalThis.__simulatorBootComplete) {
            globalThis.bootSimulatorApplication();
        }
    });

    return { mounted: true, itemCount: options.circuitExport?.schematic?.components?.length ?? 0 };
}

export default bootstrapSimulator;
