// ============================================================================
// Solar simulator lazy module (Phase 5d) — iframe host until full extraction
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

    return `
        <div class="solar-simulator-stage" role="region" aria-label="Solar simulator">
            <p class="solar-simulator-summary" role="status">${summary}</p>
            <iframe
                class="solar-simulator-frame"
                title="Solar 3D Simulator"
                src="${buildSimulatorFrameSrc()}"
                loading="lazy"
            ></iframe>
        </div>
    `;
}

/**
 * @param {HTMLElement} container - #view-solar-simulate
 * @param {{ circuitExport?: object | null, chromeHtml?: string }} [options]
 */
export async function initSolarSimulatorApp(container, options = {}) {
    ensureStylesheet('css/simulator.css', 'solar-simulator-css');

    const circuitData = options.circuitExport ?? resolveCircuitExport();
    if (circuitData) {
        publishCircuitExport(circuitData);
    }

    container.innerHTML = `
        ${options.chromeHtml || ''}
        ${circuitData ? renderSimulatorStage(circuitData) : `
            <div class="app-view-placeholder" role="status">
                <h1>Solar Simulate</h1>
                <p>No circuit staged yet. Open Solar Design and click ▶ Simulate.</p>
            </div>
        `}
    `;

    simulatorMount = container;
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
        return {
            reloaded: true,
            componentCount: circuitExport.schematic?.components?.length ?? 0,
        };
    }

    const chrome = mount.querySelector('.app-view-chrome');
    mount.innerHTML = `${chrome ? chrome.outerHTML : ''}${renderSimulatorStage(circuitExport)}`;
    simulatorMount = mount;
    return {
        reloaded: true,
        componentCount: circuitExport.schematic?.components?.length ?? 0,
    };
}
