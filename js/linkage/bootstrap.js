// ============================================================================
// LINKAGE LAB - Async ES module bootstrap (Phase 3 complete)
// Reads config/linkage-manifest.json, loads CDN + partials + modules in order.
// All app scripts are ESM; CDN entries remain classic global scripts.
// Requires HTTP server for fetch() — file:// blocks manifest/partials fetch.
// ============================================================================

const MANIFEST_PATH = 'config/linkage-manifest.json';

/** @type {Promise<void> | null} */
let linkageBootPromise = null;

async function fetchText(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${path} (HTTP ${res.status})`);
    return res.text();
}

function normalizeScriptEntry(entry) {
    if (typeof entry === 'string') return { path: entry, format: 'esm' };
    return { path: entry.path, format: entry.format || 'esm' };
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.setAttribute('data-src', src);
        el.onload = () => resolve();
        el.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(el);
    });
}

async function importModule(path) {
    const url = new URL(path, location.href);
    await import(url.href);
}

async function injectPartials(partials) {
    let i = 0;
    while (i < partials.length) {
        const spec = partials[i];
        if (spec.mount === 'body') {
            document.body.insertAdjacentHTML(spec.method || 'beforeend', await fetchText(spec.path));
            i++;
            continue;
        }
        const mountSelector = spec.mount;
        const chunks = [];
        while (i < partials.length && partials[i].mount === mountSelector) {
            chunks.push(await fetchText(partials[i].path));
            i++;
        }
        const mount = document.querySelector(mountSelector);
        if (!mount) throw new Error(`Partial mount not found: ${mountSelector}`);
        mount.insertAdjacentHTML('beforeend', chunks.join(''));
    }
}

/**
 * Boots the linkage designer (CDN, partials, ESM modules).
 * Called by js/app/main.js via the app router linkage mode loader.
 *
 * @param {{ errorMountSelector?: string }} [options]
 */
export async function bootLinkageApp(options = {}) {
    if (linkageBootPromise) return linkageBootPromise;

    linkageBootPromise = bootLinkageAppOnce(options).catch((err) => {
        linkageBootPromise = null;
        throw err;
    });
    return linkageBootPromise;
}

async function bootLinkageAppOnce(options = {}) {
    const errorMountSelector = options.errorMountSelector || '#linkage-app-mount';
    const manifest = JSON.parse(await fetchText(MANIFEST_PATH));
    const cdn = manifest.cdn || [];
    const partials = manifest.partials || [];
    const scripts = manifest.scripts || [];

    for (const src of cdn) {
        await loadScript(src);
    }

    await injectPartials(partials);

    for (const entry of scripts) {
        const { path, format } = normalizeScriptEntry(entry);
        try {
            if (format === 'esm') {
                await importModule(path);
            } else {
                await loadScript(path);
            }
        } catch (err) {
            throw new Error(`Failed to load ${path}: ${err.message}`);
        }
    }

    const { initViewportInput } = await import('./viewport-input.js');
    initViewportInput();
}

function showBootstrapError(selector, message) {
    const mount = document.querySelector(selector) || document.body;
    mount.insertAdjacentHTML(
        'beforeend',
        `<div style="padding:2rem;color:#c0392b;font-family:sans-serif">`
        + `LinkageLab failed to start: ${message}</div>`,
    );
}

/** @deprecated Use js/app/main.js — kept for direct bootstrap imports in dev tools */
export async function boot() {
    try {
        await bootLinkageApp();
    } catch (err) {
        console.error('LinkageLab bootstrap failed:', err);
        showBootstrapError('#linkage-app-mount', err.message);
        throw err;
    }
}
