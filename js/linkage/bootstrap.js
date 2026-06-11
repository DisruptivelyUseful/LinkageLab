// ============================================================================
// LINKAGE LAB - Async ES module bootstrap (Phase 3zc)
// Reads config/linkage-manifest.json, loads CDN + partials + modules in order.
// Scripts may be classic (global) or ESM (import + global-bridge for compat).
// Requires HTTP server for fetch() — file:// blocks manifest/partials fetch.
// ============================================================================

const MANIFEST_PATH = 'config/linkage-manifest.json';

async function fetchText(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path} (HTTP ${res.status})`);
    return res.text();
}

function normalizeScriptEntry(entry) {
    if (typeof entry === 'string') return { path: entry, format: 'classic' };
    return { path: entry.path, format: entry.format || 'classic' };
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
    const url = new URL(path, `${location.origin}/`);
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

async function boot() {
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
        if (format === 'esm') {
            await importModule(path);
        } else {
            await loadScript(path);
        }
    }
}

boot().catch((err) => {
    console.error('LinkageLab bootstrap failed:', err);
    const mount = document.getElementById('linkage-app-mount') || document.body;
    mount.insertAdjacentHTML('beforeend',
        `<div style="padding:2rem;color:#c0392b;font-family:sans-serif">`
        + `LinkageLab failed to start: ${err.message}</div>`);
});
