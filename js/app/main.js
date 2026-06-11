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

function syncDocumentModeButtons(mode) {
    document.querySelectorAll('[data-app-nav-mode]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.appNavMode === mode);
    });
    if (typeof globalThis.syncTopbarModeButtons === 'function') {
        globalThis.syncTopbarModeButtons(mode);
    }
}

function wireShellModeButtons(root) {
    root.querySelectorAll('[data-app-nav-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.appNavMode;
            if (mode) {
                navigateTo(mode).catch((err) => {
                    console.error('[app] navigation failed:', err);
                });
            }
        });
    });
}

function renderModeChrome() {
    return `
        <div class="app-view-chrome">
            <h1 class="app-view-chrome-title">StarShade Lab</h1>
            <div class="mode-toggle">
                <button type="button" data-app-nav-mode="linkage" class="topbar-btn" title="Linkage Design Mode">⚙️</button>
                <button type="button" data-app-nav-mode="solar-design" class="topbar-btn" title="Solar/Electrical Design Mode">⚡</button>
            </div>
        </div>
    `;
}

function mountSolarDesignShell(container) {
    const exportData = getAppStateBus().linkageExport;
    const panelCount = exportData?.solarPanels?.count ?? 0;
    const panelWatts = exportData?.solarPanels?.specs?.wmp ?? 0;
    const totalWatts = panelCount * panelWatts;
    const summary = panelCount > 0
        ? `${panelCount} panels staged (${totalWatts} W total). Full designer loads in Phase 5c.`
        : 'No linkage export staged yet. Return to Linkage and click ⚡ to send your structure here.';

    container.innerHTML = `
        ${renderModeChrome()}
        <div class="app-view-placeholder" role="status">
            <h1>Solar Design</h1>
            <p>${summary}</p>
            <p>Circuit designer will load in this view — no new browser tab.</p>
        </div>
    `;
    wireShellModeButtons(container);
    syncDocumentModeButtons(APP_MODES.SOLAR_DESIGN);
}

function mountSolarSimulateShell(container) {
    container.innerHTML = `
        ${renderModeChrome()}
        <div class="app-view-placeholder" role="status">
            <h1>Solar Simulate</h1>
            <p>Time-based simulator will load here in Phase 5c.</p>
        </div>
    `;
    wireShellModeButtons(container);
    syncDocumentModeButtons(APP_MODES.SOLAR_SIMULATE);
}

registerModeLoader(APP_MODES.LINKAGE, async () => {
    await bootLinkageApp();
});

registerModeLoader(APP_MODES.SOLAR_DESIGN, async (container) => {
    mountSolarDesignShell(container);
});

registerModeLoader(APP_MODES.SOLAR_SIMULATE, async (container) => {
    mountSolarSimulateShell(container);
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

    window.addEventListener('app:navigate', (event) => {
        const mode = event.detail?.mode;
        if (mode === APP_MODES.SOLAR_DESIGN) {
            const container = document.getElementById('view-solar-design');
            if (container) mountSolarDesignShell(container);
        }
        syncDocumentModeButtons(mode);
    });

    await bootFromLocation({ replaceHash: !location.hash });
    syncDocumentModeButtons(getCurrentMode());
}

main().catch((err) => {
    console.error('LinkageLab app boot failed:', err);
    showBootError(err.message);
});
