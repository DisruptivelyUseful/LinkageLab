// ============================================================================
// Simulator runtime loader — shared constants + circuit core, then runtime script
// ============================================================================

async function loadClassicScript(src) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-runtime-src="${src}"]`);
        if (existing?.dataset.loaded === 'true') {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.dataset.runtimeSrc = src;
        script.onload = () => {
            script.dataset.loaded = 'true';
            resolve();
        };
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
}

async function loadOptionalScript(src) {
    try {
        await loadClassicScript(src);
    } catch (err) {
        console.warn(`[simulator] Optional script skipped: ${src}`, err.message);
    }
}

function waitForCircuitModules(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        if (globalThis.CircuitModules) {
            resolve();
            return;
        }
        const timer = setTimeout(() => {
            reject(new Error('CircuitModules load timeout'));
        }, timeoutMs);
        window.addEventListener('circuitModulesLoaded', () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
    });
}

/**
 * Load simulator dependencies and main runtime.
 * @param {{ embedded?: boolean }} [options]
 */
export async function loadSimulatorRuntime(options = {}) {
    if (options.embedded) {
        document.body.classList.add('simulator-embedded');
    }

    await import('../core/constants.js');
    await import('../circuit/component-library.js');
    await import('../circuit/circuit-core.js');
    await import('../core/automation.js');

    if (typeof globalThis.d3 === 'undefined') {
        await loadClassicScript('https://d3js.org/d3.v7.min.js');
    }

    if (typeof globalThis.THREE === 'undefined') {
        await loadOptionalScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js');
        await loadOptionalScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js');
    }

    // unit-converter.js loads convert-units via esm.sh with local fallbacks — never block boot on CDN
    try {
        await import('../core/unit-converter.js');
    } catch (err) {
        console.warn('[simulator] unit-converter unavailable:', err.message);
    }

    await waitForCircuitModules();

    await import('./simulation-host.js');
    await loadClassicScript('js/solar/celestial-overlay.js');
    await loadClassicScript('js/simulator/solar-simulator.runtime.js');

    return { loaded: true };
}

export default loadSimulatorRuntime;
