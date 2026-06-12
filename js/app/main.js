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
    initSolarSimulatorApp,
    refreshSolarSimulatorFromCircuit,
} from '../solar/simulator-app.js';
import {
    bindAppNavButtons,
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
    bindAppNavButtons(root);
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

/** Build + publish linkage export when linkage view is active (designer handoff). */
function buildFreshLinkageExportForHandoff() {
    if (typeof globalThis.buildLinkageExportData !== 'function' || !globalThis.state) {
        return resolveLinkageExport();
    }
    const exportData = globalThis.buildLinkageExportData();
    globalThis.publishLinkageExport?.(exportData);
    return exportData;
}

registerModeLoader(APP_MODES.LINKAGE, async () => {
    await bootLinkageApp();
});

registerModeLoader(APP_MODES.SOLAR_DESIGN, async (container) => {
    const linkageExport = buildFreshLinkageExportForHandoff();
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
            const lastMode = getAppStateBus().lastMode;
            const linkageExport = lastMode === APP_MODES.LINKAGE
                ? buildFreshLinkageExportForHandoff()
                : resolveLinkageExport();
            refreshSolarDesignerFromExport(linkageExport).catch((err) => {
                console.error('[app] solar designer refresh failed:', err);
            });
            bindSolarDesignerTopbar(document.getElementById('view-solar-design') || document);
        }
        if (mode === APP_MODES.SOLAR_SIMULATE && !event.detail?.isFirstLoad) {
            globalThis.SolarDesigner?.syncExportToStorage?.();
            const circuit = resolveCircuitExport();
            const simView = document.getElementById('view-solar-simulate');
            refreshSolarSimulatorFromCircuit(circuit)
                .then(() => {
                    if (!simView) return;
                    bindAppNavButtons(simView);
                    bindSimulatorTopbar(simView, {
                        onReload: (data) => refreshSolarSimulatorFromCircuit(data),
                    });
                    updateSimulatorTopbarSummary(simView, circuit);
                })
                .catch((err) => {
                    console.error('[app] solar simulator refresh failed:', err);
                });
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
