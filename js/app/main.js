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
    SOLAR_VIEW_ID,
} from '../core/app-router.js';
import { bootLinkageApp } from '../linkage/bootstrap.js';
import { scheduleLinkageViewportRefresh } from '../linkage/viewport-refresh.js';
import { linkageExportToSyncConfig, shouldSyncPanelsFromLinkage } from '../solar/linkage-import.js';
import { resolveCircuitExport } from '../solar/circuit-export.js';
import {
    initCircuitStore,
    subscribe,
    toDesignerExport,
} from '../circuit/circuit-store.js';
import { initProjectStore } from '../core/project-store.js';
import {
    ensureSolarCanvasBoot,
    refreshSolarCanvasFromCircuit,
    setSolarCanvasAppMode,
} from '../solar/simulator-app.js';
import {
    bindAppNavButtons,
    bindSolarTopbar,
    renderAppTopbarHtml,
    updateSolarTopbarSummary,
} from './topbar.js';
import { showToast } from '../core/feedback.js';

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

/** Build + publish linkage export when linkage view is active. */
function buildFreshLinkageExportForHandoff() {
    if (typeof globalThis.buildLinkageExportData !== 'function' || !globalThis.state) {
        return resolveLinkageExport();
    }
    const exportData = globalThis.buildLinkageExportData();
    globalThis.publishLinkageExport?.(exportData);
    return exportData;
}

async function bootSolarMode(container, appMode) {
    const topbarHtml = await renderAppTopbarHtml('solar-unified');
    if (!container.querySelector('#topbar')) {
        container.innerHTML = topbarHtml;
    }
    await ensureSolarCanvasBoot(container, appMode);
    wireShellModeButtons(container);
    bindSolarTopbar(container, {
        onReload: (data) => refreshSolarCanvasFromCircuit(data),
    });
    updateSolarTopbarSummary(container, resolveCircuitExport());
    syncDocumentModeButtons(appMode);
}

registerModeLoader(APP_MODES.LINKAGE, async () => {
    await bootLinkageApp();
});

registerModeLoader(APP_MODES.SOLAR_DESIGN, async (container) => {
    await bootSolarMode(container, APP_MODES.SOLAR_DESIGN);
});

registerModeLoader(APP_MODES.SOLAR_SIMULATE, async (container) => {
    await bootSolarMode(container, APP_MODES.SOLAR_SIMULATE);
});

function applyLinkagePanelSync() {
    const linkageExport = buildFreshLinkageExportForHandoff();
    const syncConfig = linkageExportToSyncConfig(linkageExport);
    if (!syncConfig) return;

    let attempts = 0;
    const trySync = () => {
        if (!globalThis.SolarDesigner?.isInitialized?.()) {
            if (attempts++ < 120) requestAnimationFrame(trySync);
            return;
        }
        if (!shouldSyncPanelsFromLinkage(globalThis.SolarDesigner, syncConfig)) return;

        const result = globalThis.SolarDesigner.syncPanelsFromLinkage(syncConfig);
        globalThis.saveSimulatorCircuitToStore?.();
        globalThis.SolarDesigner.render?.();
        if (result?.synced) {
            showToast(result.message || 'Linkage panels synced to solar canvas', 'info');
        }
    };

    trySync();
}

function showBootError(message) {
    const root = document.getElementById('app-root') || document.body;
    root.insertAdjacentHTML(
        'beforeend',
        `<div class="app-boot-error">LinkageLab failed to start: ${message}</div>`,
    );
}

async function main() {
    initAppRouter({ defaultMode: APP_MODES.LINKAGE });
    initProjectStore();
    initCircuitStore();

    subscribe((doc) => {
        const bus = getAppStateBus();
        bus.circuitDocument = doc;
        bus.circuitData = toDesignerExport(doc);

        const mode = getCurrentMode();
        if ((mode === APP_MODES.SOLAR_DESIGN || mode === APP_MODES.SOLAR_SIMULATE)
            && typeof globalThis.applySimulatorCircuitImport === 'function'
            && bus.circuitData) {
            globalThis.applySimulatorCircuitImport(bus.circuitData, { fitView: false });
        }
    });

    globalThis.AppRouter = {
        APP_MODES,
        navigateTo,
        getAppStateBus,
        getCurrentMode,
        refreshSolarCanvasFromCircuit,
        refreshSolarSimulatorFromCircuit: refreshSolarCanvasFromCircuit,
    };

    window.addEventListener('app:navigate', (event) => {
        const mode = event.detail?.mode;
        const lastMode = getAppStateBus().lastMode;
        const solarView = document.getElementById(SOLAR_VIEW_ID);

        if (mode === APP_MODES.LINKAGE) {
            scheduleLinkageViewportRefresh();
            document.getElementById('incidentReportOverlay')?.classList.remove('visible');
        }

        if (mode === APP_MODES.SOLAR_DESIGN) {
            setSolarCanvasAppMode('build');
            if (lastMode === APP_MODES.LINKAGE) {
                applyLinkagePanelSync();
            }
            if (solarView) {
                bindSolarTopbar(solarView, {
                    onReload: (data) => refreshSolarCanvasFromCircuit(data),
                });
            }
        }

        if (mode === APP_MODES.SOLAR_SIMULATE) {
            setSolarCanvasAppMode('simulate');
            if (solarView) {
                bindSolarTopbar(solarView, {
                    onReload: (data) => refreshSolarCanvasFromCircuit(data),
                });
                updateSolarTopbarSummary(solarView, resolveCircuitExport());
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
