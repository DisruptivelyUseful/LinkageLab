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
import { initSolarDesignerApp, refreshSolarDesignerFromExport } from '../solar/designer-app.js';
import { resolveCircuitExport } from '../solar/circuit-export.js';
import { initSolarSimulatorApp, refreshSolarSimulatorFromCircuit } from '../solar/simulator-app.js';

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

function renderModeChrome(activeMode = 'linkage') {
    const modes = [
        { id: 'linkage', icon: '⚙️', title: 'Linkage Design Mode' },
        { id: 'solar-design', icon: '⚡', title: 'Solar/Electrical Design Mode' },
        { id: 'solar-simulate', icon: '▶', title: 'Solar 3D Simulation Mode' },
    ];
    const buttons = modes.map((mode) => `
        <button
            type="button"
            data-app-nav-mode="${mode.id}"
            class="topbar-btn${activeMode === mode.id ? ' active' : ''}"
            title="${mode.title}"
        >${mode.icon}</button>
    `).join('');

    return `
        <div class="app-view-chrome">
            <h1 class="app-view-chrome-title">StarShade Lab</h1>
            <div class="mode-toggle">${buttons}</div>
        </div>
    `;
}

function resolveLinkageExport() {
    const bus = getAppStateBus();
    if (bus.linkageExport) return bus.linkageExport;
    try {
        const saved = localStorage.getItem('linkageLabExport');
        if (saved) return JSON.parse(saved);
    } catch (err) {
        console.warn('[app] Failed to parse linkageLabExport from localStorage:', err);
    }
    return null;
}

registerModeLoader(APP_MODES.LINKAGE, async () => {
    await bootLinkageApp();
});

registerModeLoader(APP_MODES.SOLAR_DESIGN, async (container) => {
    const linkageExport = resolveLinkageExport();
    await initSolarDesignerApp(container, {
        linkageExport,
        chromeHtml: renderModeChrome(APP_MODES.SOLAR_DESIGN),
    });
    wireShellModeButtons(container);
    syncDocumentModeButtons(APP_MODES.SOLAR_DESIGN);
});

registerModeLoader(APP_MODES.SOLAR_SIMULATE, async (container) => {
    await initSolarSimulatorApp(container, {
        circuitExport: resolveCircuitExport(),
        chromeHtml: renderModeChrome(APP_MODES.SOLAR_SIMULATE),
    });
    wireShellModeButtons(container);
    syncDocumentModeButtons(APP_MODES.SOLAR_SIMULATE);
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
        refreshSolarDesignerFromExport,
        refreshSolarSimulatorFromCircuit,
    };

    window.addEventListener('app:navigate', (event) => {
        const mode = event.detail?.mode;
        if (mode === APP_MODES.SOLAR_DESIGN) {
            refreshSolarDesignerFromExport(resolveLinkageExport()).catch((err) => {
                console.error('[app] solar designer refresh failed:', err);
            });
        }
        if (mode === APP_MODES.SOLAR_SIMULATE) {
            refreshSolarSimulatorFromCircuit(resolveCircuitExport()).catch((err) => {
                console.error('[app] solar simulator refresh failed:', err);
            });
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
