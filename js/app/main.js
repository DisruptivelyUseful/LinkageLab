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
import { scheduleLinkageViewportRefresh } from '../linkage/viewport-refresh.js';
import {
    initSolarDesignerApp,
    refreshSolarDesignerFromExport,
    scheduleSolarDesignerLayoutRefresh,
} from '../solar/designer-app.js';
import { resolveCircuitExport } from '../solar/circuit-export.js';
import {
    activateSimulatorFrame,
    initSolarSimulatorApp,
    refreshSolarSimulatorFromCircuit,
} from '../solar/simulator-app.js';
import {
    bindSimulatorTopbar,
    bindSolarDesignerTopbar,
    renderAppTopbarHtml,
    updateSimulatorTopbarSummary,
} from './topbar.js';

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
        if (btn.dataset.shellNavBound === 'true') return;
        btn.dataset.shellNavBound = 'true';
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
    const topbarHtml = await renderAppTopbarHtml(APP_MODES.SOLAR_DESIGN);
    await initSolarDesignerApp(container, {
        linkageExport,
        topbarHtml,
    });
    wireShellModeButtons(container);
    bindSolarDesignerTopbar(container);
    syncDocumentModeButtons(APP_MODES.SOLAR_DESIGN);
});

registerModeLoader(APP_MODES.SOLAR_SIMULATE, async (container) => {
    const circuitExport = resolveCircuitExport();
    const topbarHtml = await renderAppTopbarHtml(APP_MODES.SOLAR_SIMULATE);
    await initSolarSimulatorApp(container, {
        circuitExport,
        topbarHtml,
    });
    wireShellModeButtons(container);
    bindSimulatorTopbar(container, {
        onReload: (data) => refreshSolarSimulatorFromCircuit(data),
    });
    updateSimulatorTopbarSummary(container, circuitExport);
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
        if (mode === APP_MODES.LINKAGE) {
            scheduleLinkageViewportRefresh();
        }
        if (mode === APP_MODES.SOLAR_DESIGN) {
            scheduleSolarDesignerLayoutRefresh();
            refreshSolarDesignerFromExport(resolveLinkageExport()).catch((err) => {
                console.error('[app] solar designer refresh failed:', err);
            });
            bindSolarDesignerTopbar(document.getElementById('view-solar-design') || document);
        }
        if (mode === APP_MODES.SOLAR_SIMULATE) {
            // Sync the designer's current schematic to localStorage before loading the simulator frame
            globalThis.SolarDesigner?.syncExportToStorage?.();
            activateSimulatorFrame();
            const circuit = resolveCircuitExport();
            refreshSolarSimulatorFromCircuit(circuit).catch((err) => {
                console.error('[app] solar simulator refresh failed:', err);
            });
            const simView = document.getElementById('view-solar-simulate');
            if (simView) {
                bindSimulatorTopbar(simView, {
                    onReload: (data) => refreshSolarSimulatorFromCircuit(data),
                });
                updateSimulatorTopbarSummary(simView, circuit);
            }
        }
        syncDocumentModeButtons(mode);
    });

    await bootFromLocation({ replaceHash: !location.hash });
    wireShellModeButtons(document);
    syncDocumentModeButtons(getCurrentMode());
}

main().catch((err) => {
    console.error('LinkageLab app boot failed:', err);
    showBootError(err.message);
});
