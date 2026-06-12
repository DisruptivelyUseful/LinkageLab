// ============================================================================
// Application router — mode switching, hash URLs, in-memory state bus (Phase 5)
// ============================================================================

/** @typedef {'linkage' | 'solar-design' | 'solar-simulate'} AppMode */

export const APP_MODES = Object.freeze({
    LINKAGE: 'linkage',
    SOLAR_DESIGN: 'solar-design',
    SOLAR_SIMULATE: 'solar-simulate',
});

const VIEW_BY_MODE = Object.freeze({
    linkage: 'view-linkage',
    'solar-design': 'view-solar-design',
    'solar-simulate': 'view-solar-simulate',
});

const HASH_BY_MODE = Object.freeze({
    linkage: '#/linkage',
    'solar-design': '#/solar/design',
    'solar-simulate': '#/solar/simulate',
});

/** @type {AppMode} */
let currentMode = APP_MODES.LINKAGE;

/** @type {Map<AppMode, (container: HTMLElement) => Promise<void>>} */
const modeLoaders = new Map();

/** @type {Set<AppMode>} */
const loadedModes = new Set();

/** @type {Map<AppMode, Promise<void>>} */
const modeLoadPromises = new Map();

/**
 * In-memory session state passed between modes (replaces localStorage hops).
 * @type {{ linkageExport: object | null, circuitData: object | null, lastMode: AppMode | null }}
 */
const appStateBus = {
    linkageExport: null,
    circuitData: null,
    lastMode: null,
};

/**
 * @param {AppMode} mode
 * @param {(container: HTMLElement) => Promise<void>} loader
 */
export function registerModeLoader(mode, loader) {
    if (!VIEW_BY_MODE[mode]) {
        throw new Error(`Unknown app mode: ${mode}`);
    }
    modeLoaders.set(mode, loader);
}

export function getAppStateBus() {
    return appStateBus;
}

/** @returns {AppMode} */
export function getCurrentMode() {
    return currentMode;
}

/**
 * @param {string} hash
 * @returns {AppMode | null}
 */
export function resolveModeFromHash(hash) {
    const normalized = (hash || '').replace(/^#/, '').replace(/^\//, '');
    if (!normalized || normalized === 'linkage') return APP_MODES.LINKAGE;
    if (normalized === 'solar/design') return APP_MODES.SOLAR_DESIGN;
    if (normalized === 'solar/simulate') return APP_MODES.SOLAR_SIMULATE;
    return null;
}

/**
 * @param {AppMode} mode
 */
function setActiveView(mode) {
    Object.entries(VIEW_BY_MODE).forEach(([modeName, viewId]) => {
        const el = document.getElementById(viewId);
        if (!el) return;
        const active = modeName === mode;
        el.classList.toggle('active', active);
        el.hidden = !active;
    });
    document.body.dataset.appMode = mode;
    document.body.classList.toggle('solar-mode', mode === APP_MODES.SOLAR_DESIGN || mode === APP_MODES.SOLAR_SIMULATE);
}

/**
 * @param {AppMode} mode
 * @param {{ replace?: boolean }} [options]
 */
function writeHashForMode(mode, options = {}) {
    const hash = HASH_BY_MODE[mode];
    if (!hash || location.hash === hash) return;
    const path = `${location.pathname}${location.search}${hash}`;
    if (options.replace) {
        history.replaceState({ appMode: mode }, '', path);
    } else {
        history.pushState({ appMode: mode }, '', path);
    }
}

/**
 * @param {AppMode} mode
 * @param {{ replaceHash?: boolean, skipHashUpdate?: boolean }} [options]
 */
export async function navigateTo(mode, options = {}) {
    if (!VIEW_BY_MODE[mode]) {
        throw new Error(`Unknown app mode: ${mode}`);
    }

    const container = document.getElementById(VIEW_BY_MODE[mode]);
    if (!container) {
        throw new Error(`View container not found for mode: ${mode}`);
    }

    const wasAlreadyLoaded = loadedModes.has(mode);

    if (!wasAlreadyLoaded) {
        // Show the target view before first boot so layout-dependent canvases get real dimensions.
        setActiveView(mode);

        let loadPromise = modeLoadPromises.get(mode);
        if (!loadPromise) {
            const loader = modeLoaders.get(mode);
            if (!loader) {
                throw new Error(`No loader registered for mode: ${mode}`);
            }
            loadPromise = loader(container).then(() => {
                loadedModes.add(mode);
            });
            modeLoadPromises.set(mode, loadPromise);
        }
        await loadPromise;
    }

    appStateBus.lastMode = currentMode;
    currentMode = mode;
    setActiveView(mode);

    if (!options.skipHashUpdate) {
        writeHashForMode(mode, { replace: !!options.replaceHash });
    }

    window.dispatchEvent(new CustomEvent('app:navigate', {
        detail: { mode, isFirstLoad: !wasAlreadyLoaded },
    }));
}

let routerInitialized = false;

/**
 * @param {{ defaultMode?: AppMode }} [options]
 */
export function initAppRouter(options = {}) {
    if (routerInitialized) return;
    routerInitialized = true;

    const defaultMode = options.defaultMode || APP_MODES.LINKAGE;

    window.addEventListener('popstate', () => {
        const mode = resolveModeFromHash(location.hash) || defaultMode;
        if (mode !== currentMode) {
            navigateTo(mode, { skipHashUpdate: true }).catch((err) => {
                console.error('[app-router] popstate navigation failed:', err);
            });
        }
    });

    window.addEventListener('hashchange', () => {
        const mode = resolveModeFromHash(location.hash);
        if (!mode || mode === currentMode) return;
        navigateTo(mode, { skipHashUpdate: true }).catch((err) => {
            console.error('[app-router] hashchange navigation failed:', err);
        });
    });
}

/**
 * @param {{ defaultMode?: AppMode, replaceHash?: boolean }} [options]
 * @returns {Promise<AppMode>}
 */
export async function bootFromLocation(options = {}) {
    const defaultMode = options.defaultMode || APP_MODES.LINKAGE;
    const initialMode = resolveModeFromHash(location.hash) || defaultMode;
    const replaceHash = options.replaceHash ?? !location.hash;
    await navigateTo(initialMode, { replaceHash, skipHashUpdate: !replaceHash && !!location.hash });
    return initialMode;
}
