// ============================================================================
// LINKAGE LAB - Shell partials + synchronous module loader (Phase 3u)
// Reads config/linkage-manifest.json, loads CDN + partials + scripts in order.
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

    function loadScriptSync(src) {
        const el = document.createElement('script');
        el.textContent = fetchTextSync(src);
        el.setAttribute('data-src', src);
        document.head.appendChild(el);
    }

    const manifest = JSON.parse(fetchTextSync(MANIFEST_PATH));
    const cdn = manifest.cdn || [];
    const partials = manifest.partials || [];
    const scripts = manifest.scripts || [];

    function injectPartials() {
        // Concatenate consecutive partials that share a mount before inserting.
        // insertAdjacentHTML auto-closes open tags at fragment boundaries, which
        // breaks split controls sections (e.g. head ends with <div class="group">).
        let i = 0;
        while (i < partials.length) {
            const spec = partials[i];
            if (spec.mount === 'body') {
                document.body.insertAdjacentHTML(spec.method || 'beforeend', fetchTextSync(spec.path));
                i++;
                continue;
            }
            const mountSelector = spec.mount;
            const chunks = [];
            while (i < partials.length && partials[i].mount === mountSelector) {
                chunks.push(fetchTextSync(partials[i].path));
                i++;
            }
            const mount = document.querySelector(mountSelector);
            if (!mount) {
                throw new Error('Partial mount not found: ' + mountSelector);
            }
            mount.insertAdjacentHTML('beforeend', chunks.join(''));
        }
    }

    for (const src of cdn) {
        loadScriptSync(src);
    }

    injectPartials();

    for (const src of scripts) {
        loadScriptSync(src);
    }
})();
