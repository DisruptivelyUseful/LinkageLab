// ============================================================================
// Solar simulator lazy module (Phase 5d+) — iframe host until full extraction
// ============================================================================

import {
    buildSimulatorFrameSrc,
    publishCircuitExport,
    resolveCircuitExport,
} from './circuit-export.js';

let simulatorMount = null;

function ensureStylesheet(href, id) {
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
}

function renderSimulatorStage(circuitData) {
    const componentCount = circuitData?.schematic?.components?.length
        ?? circuitData?.summary?.componentCount
        ?? 0;
    const summary = componentCount > 0
        ? `${componentCount} components staged for 3D simulation.`
        : 'Design a circuit in Solar Design first, then click ▶ Simulate.';
    const frameSrc = buildSimulatorFrameSrc();

    return `
        <div class="solar-simulator-stage" role="region" aria-label="Solar simulator">
            <p class="solar-simulator-summary" role="status">${summary}</p>
            <iframe
                class="solar-simulator-frame"
                title="Solar 3D Simulator"
                data-src="${frameSrc}"
                loading="lazy"
            ></iframe>
        </div>
    `;
}

/** Load the simulator iframe once the simulate view has layout. */
export function activateSimulatorFrame(root = simulatorMount) {
    const mount = root || document.getElementById('view-solar-simulate');
    if (!mount) return;

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const iframe = mount.querySelector('.solar-simulator-frame');
            if (!iframe || iframe.src) return;
            const src = iframe.dataset.src || buildSimulatorFrameSrc();
            iframe.src = src;
        });
    });
}

/**
 * @param {HTMLElement} container - #view-solar-simulate
 * @param {{ circuitExport?: object | null, topbarHtml?: string }} [options]
 */
export async function initSolarSimulatorApp(container, options = {}) {
    ensureStylesheet('css/simulator.css', 'solar-simulator-css');

    const circuitData = options.circuitExport ?? resolveCircuitExport();
    if (circuitData) {
        publishCircuitExport(circuitData);
    }

    container.innerHTML = `
        ${options.topbarHtml || ''}
        ${circuitData ? renderSimulatorStage(circuitData) : `
            <div class="app-view-placeholder" role="status">
                <h1>Solar Simulate</h1>
                <p>No circuit staged yet. Open Solar Design and click ▶ Simulate.</p>
            </div>
        `}
    `;

    simulatorMount = container;
    if (circuitData) {
        activateSimulatorFrame(container);
    }
    return { componentCount: circuitData?.schematic?.components?.length ?? 0 };
}

/**
 * Reload simulator iframe when circuit export changes.
 * @param {object | null} circuitExport
 */
export async function refreshSolarSimulatorFromCircuit(circuitExport) {
    if (!circuitExport) return { reloaded: false, componentCount: 0 };
    publishCircuitExport(circuitExport);

    const mount = simulatorMount || document.getElementById('view-solar-simulate');
    if (!mount) return { reloaded: false, componentCount: 0 };

    const stage = mount.querySelector('.solar-simulator-stage');
    if (stage) {
        stage.outerHTML = renderSimulatorStage(circuitExport);
        activateSimulatorFrame(mount);
        return {
            reloaded: true,
            componentCount: circuitExport.schematic?.components?.length ?? 0,
        };
    }

    const topbar = mount.querySelector('#topbar');
    mount.innerHTML = `${topbar ? topbar.outerHTML : ''}${renderSimulatorStage(circuitExport)}`;
    simulatorMount = mount;
    activateSimulatorFrame(mount);
    return {
        reloaded: true,
        componentCount: circuitExport.schematic?.components?.length ?? 0,
    };
}
