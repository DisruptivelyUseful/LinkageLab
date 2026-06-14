// ============================================================================
// Application router — mode switching, hash URLs, in-memory state bus (Phase 5)
// ============================================================================

/** @typedef {'linkage' | 'solar-design' | 'solar-simulate'} AppMode */

export const APP_MODES = Object.freeze({
    LINKAGE: 'linkage',
    SOLAR_DESIGN: 'solar-design',
    SOLAR_SIMULATE: 'solar-simulate',
});

/** Both solar modes share one canvas host. */
export const SOLAR_VIEW_ID = 'view-solar';

export const SOLAR_APP_MODES = Object.freeze([
    APP_MODES.SOLAR_DESIGN,
    APP_MODES.SOLAR_SIMULATE,
]);

const VIEW_BY_MODE = Object.freeze({
    linkage: 'view-linkage',
    'solar-design': SOLAR_VIEW_ID,
    'solar-simulate': SOLAR_VIEW_ID,
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
 * @type {{ linkageExport: object | null, circuitData: object | null, circuitDocument: object | null, projectDocument: object | null, lastMode: AppMode | null }}
 */
const appStateBus = {
    linkageExport: null,
    circuitData: null,
    circuitDocument: null,
    projectDocument: null,
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
    const isSolar = mode === APP_MODES.SOLAR_DESIGN || mode === APP_MODES.SOLAR_SIMULATE;
    const linkageEl = document.getElementById('view-linkage');
    const solarEl = document.getElementById(SOLAR_VIEW_ID);

    if (linkageEl) {
        const active = mode === APP_MODES.LINKAGE;
        linkageEl.classList.toggle('active', active);
        linkageEl.hidden = !active;
    }
    if (solarEl) {
        solarEl.classList.toggle('active', isSolar);
        solarEl.hidden = !isSolar;
    }

    document.body.dataset.appMode = mode;
    document.body.dataset.solarCanvasMode = isSolar
        ? (mode === APP_MODES.SOLAR_SIMULATE ? 'simulate' : 'build')
        : '';
    document.body.classList.toggle('solar-mode', isSolar);
    document.body.classList.toggle('solar-build-mode', mode === APP_MODES.SOLAR_DESIGN);
    document.body.classList.toggle('solar-simulate-mode', mode === APP_MODES.SOLAR_SIMULATE);
}

/** Mark modes as booted (shared solar canvas marks both solar modes). */
export function markModesLoaded(...modes) {
    modes.forEach((m) => {
        if (VIEW_BY_MODE[m]) loadedModes.add(m);
    });
}

export function isSolarMode(mode) {
    return mode === APP_MODES.SOLAR_DESIGN || mode === APP_MODES.SOLAR_SIMULATE;
}

export function isSolarCanvasBooted() {
    return loadedModes.has(APP_MODES.SOLAR_DESIGN) || loadedModes.has(APP_MODES.SOLAR_SIMULATE);
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

    const wasAlreadyLoaded = loadedModes.has(mode)
        || (isSolarMode(mode) && isSolarCanvasBooted());

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
