// ============================================================================
// LINKAGE LAB - Synchronous module loader (Phase 3p thin shell)
// Loads core + linkage scripts in dependency order. Run once at end of <body>.
// ============================================================================
(function () {
    'use strict';

    /** @type {string[]} Ordered script URLs relative to index.html */
    const SCRIPTS = [
        'js/core/unit-converter.js',
        'js/core/constants.js',
        'js/core/export-format.js',
        'js/core/feedback.js',
        'js/linkage/constants.js',
        'js/linkage/math.js',
        'js/linkage/beam-bolt-helpers.js',
        'js/linkage/animation.js',
        'js/linkage/geometry-classes.js',
        'js/linkage/config-persistence.js',
        'js/linkage/hardware-detail.js',
        'js/linkage/app-state.js',
        'js/linkage/solver.js',
        'js/linkage/collision.js',
        'js/linkage/renderer-3d.js',
        'js/linkage/measurement-overlay.js',
        'js/linkage/gltf-export.js',
        'js/linkage/scene-render.js',
        'js/linkage/cache.js',
        'js/linkage/linkage-geometry.js',
        'js/linkage/export-bridge.js',
        'js/linkage/build-guide.js',
        'js/linkage/solar-panel-input.js',
        'js/linkage/render-app.js',
        'js/linkage/viewport-input.js',
        'js/linkage/validation.js',
        'js/linkage/history.js',
        'js/linkage/state-sync.js',
        'js/linkage/reference-input.js',
        'js/linkage/ui-bindings.js',
        'js/linkage/dom-setup.js',
        'js/linkage/hardware-ui-init.js',
        'js/linkage/main.js'
    ];

    function loadScriptSync(src) {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', src, false);
        try {
            xhr.send(null);
        } catch (err) {
            throw new Error('Sync load blocked for ' + src + ': ' + err.message);
        }
        if (xhr.status !== 200 && xhr.status !== 0) {
            throw new Error('Failed to load ' + src + ' (HTTP ' + xhr.status + ')');
        }
        const el = document.createElement('script');
        el.textContent = xhr.responseText;
        el.setAttribute('data-src', src);
        document.head.appendChild(el);
    }

    for (const src of SCRIPTS) {
        loadScriptSync(src);
    }
})();
