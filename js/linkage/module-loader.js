// ============================================================================
// LINKAGE LAB - Shell partials + synchronous module loader (Phase 3s)
// Reads config/linkage-manifest.json, injects partials, loads scripts in order.
// Requires HTTP server (localhost) — sync XHR does not work on file://
// ============================================================================
(function () {
    'use strict';

    const MANIFEST_PATH = 'config/linkage-manifest.json';

    function fetchTextSync(path) {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', path, false);
        try {
            xhr.send(null);
        } catch (err) {
            throw new Error('Sync fetch blocked for ' + path + ': ' + err.message);
        }
        if (xhr.status !== 200 && xhr.status !== 0) {
            throw new Error('Failed to load ' + path + ' (HTTP ' + xhr.status + ')');
        }
        return xhr.responseText;
    }

    const manifest = JSON.parse(fetchTextSync(MANIFEST_PATH));
    const partials = manifest.partials || [];
    const scripts = manifest.scripts || [];

    function injectPartials() {
        for (const spec of partials) {
            const html = fetchTextSync(spec.path);
            if (spec.mount === 'body') {
                document.body.insertAdjacentHTML(spec.method || 'beforeend', html);
                continue;
            }
            const mount = document.querySelector(spec.mount);
            if (!mount) {
                throw new Error('Partial mount not found: ' + spec.mount + ' for ' + spec.path);
            }
            mount.insertAdjacentHTML('beforeend', html);
        }
    }

    function loadScriptSync(src) {
        const el = document.createElement('script');
        el.textContent = fetchTextSync(src);
        el.setAttribute('data-src', src);
        document.head.appendChild(el);
    }

    injectPartials();

    for (const src of scripts) {
        loadScriptSync(src);
    }
})();
