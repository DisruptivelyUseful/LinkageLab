// ============================================================================
// LinkageLab unified app entry (Phase 5a shell + router)
// ============================================================================

import {
    APP_MODES,
    bootFromLocation,
    getAppStateBus,
    getCurrentMode,
    initAppRouter,
    navigateTo,
    registerModeLoader,
} from '../core/app-router.js';
import { bootLinkageApp } from '../linkage/bootstrap.js';

function renderPlaceholder(container, title, detail) {
    container.innerHTML = `
        <div class="app-view-placeholder" role="status">
            <h1>${title}</h1>
            <p>${detail}</p>
            <p><a href="#/linkage">← Back to Linkage</a></p>
        </div>
    `;
}

registerModeLoader(APP_MODES.LINKAGE, async () => {
    await bootLinkageApp();
});

registerModeLoader(APP_MODES.SOLAR_DESIGN, async (container) => {
    renderPlaceholder(
        container,
        'Solar Design',
        'Circuit designer will load here in Phase 5c. Use Linkage mode for now.',
    );
});

registerModeLoader(APP_MODES.SOLAR_SIMULATE, async (container) => {
    renderPlaceholder(
        container,
        'Solar Simulate',
        'Time-based simulator will load here in Phase 5c.',
    );
});

function showBootError(message) {
    const root = document.getElementById('app-root') || document.body;
    root.insertAdjacentHTML(
        'beforeend',
        `<div class="app-boot-error">LinkageLab failed to start: ${message}</div>`,
    );
}

async function main() {
    initAppRouter({ defaultMode: APP_MODES.LINKAGE });

    globalThis.AppRouter = {
        APP_MODES,
        navigateTo,
        getAppStateBus,
        getCurrentMode,
    };

    await bootFromLocation({ replaceHash: !location.hash });
}

main().catch((err) => {
    console.error('LinkageLab app boot failed:', err);
    showBootError(err.message);
});
