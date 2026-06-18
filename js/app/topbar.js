// ============================================================================
// Unified topbar — shared chrome across linkage and solar canvas modes
// ============================================================================

import { showToast } from '../core/feedback.js';
import {
    exportProjectFile,
    importProjectFile,
    loadProject,
    saveProject,
} from '../core/project-export.js';
import { exportGameBundleFile } from '../core/export-game-bundle.js';
import { publishCircuitExport, resolveCircuitExport } from '../solar/circuit-export.js';

const TOPBAR_PARTIALS = Object.freeze({
    'solar-unified': 'partials/app-topbar-solar-unified.html',
    'solar-design': 'partials/app-topbar-solar-unified.html',
    'solar-simulate': 'partials/app-topbar-solar-unified.html',
});

async function fetchPartial(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${path} (HTTP ${res.status})`);
    return res.text();
}

/**
 * @param {'solar-unified' | 'solar-design' | 'solar-simulate'} mode
 * @returns {Promise<string>}
 */
export async function renderAppTopbarHtml(mode) {
    const path = TOPBAR_PARTIALS[mode] || TOPBAR_PARTIALS['solar-unified'];
    if (!path) return '';
    return fetchPartial(path);
}

function bindOnce(element, handler) {
    if (!element || element.dataset.bound) return;
    element.dataset.bound = 'true';
    handler(element);
}

/** Wire unified shell mode-toggle buttons (linkage / design / simulate). */
export function bindAppNavButtons(root = document) {
    root.querySelectorAll('[data-app-nav-mode]').forEach((btn) => {
        if (btn.dataset.shellNavBound === 'true') return;
        btn.dataset.shellNavBound = 'true';
        btn.addEventListener('click', () => {
            const mode = btn.dataset.appNavMode;
            if (mode && globalThis.AppRouter?.navigateTo) {
                globalThis.AppRouter.navigateTo(mode).catch((err) => {
                    console.error('[topbar] navigation failed:', err);
                    showToast(`Could not switch mode: ${err.message}`, 'error');
                });
            }
        });
    });
}

/** Open unified build guide; lazy-boots linkage shell if user started in solar/simulate. */
async function openBuildGuide() {
    if (typeof globalThis.showBuildGuide === 'function') {
        globalThis.showBuildGuide();
        return;
    }
    if (!document.getElementById('build-guide-modal')) {
        try {
            const { bootLinkageApp } = await import('../linkage/bootstrap.js');
            await bootLinkageApp();
        } catch (err) {
            console.error('[topbar] build guide boot failed:', err);
            showToast('Build guide is not available', 'error');
            return;
        }
    }
    if (typeof globalThis.showBuildGuide === 'function') {
        globalThis.showBuildGuide();
    } else {
        showToast('Build guide is not available yet — open Linkage mode first', 'warning');
    }
}

/** Wire save/load/export on the unified solar topbar. */
export function bindSolarTopbar(root = document, options = {}) {
    const onReload = options.onReload;

    bindOnce(root.querySelector('#btn-solar-save-top'), (btn) => {
        btn.addEventListener('click', () => saveProject());
    });

    bindOnce(root.querySelector('#btn-solar-load-top'), (btn) => {
        btn.addEventListener('click', () => {
            loadProject();
            onReload?.(resolveCircuitExport());
        });
    });

    bindOnce(root.querySelector('#btn-solar-export-top'), (btn) => {
        btn.addEventListener('click', () => exportProjectFile());
    });

    bindOnce(root.querySelector('#btn-export-godot'), (btn) => {
        btn.addEventListener('click', () => {
            exportGameBundleFile().catch((err) => {
                console.error('[topbar] game bundle export failed:', err);
                showToast(`Export failed: ${err.message}`, 'error');
            });
        });
    });

    bindOnce(root.querySelector('#btn-solar-import-top'), (btn) => {
        btn.addEventListener('click', () => {
            importProjectFile();
            onReload?.(resolveCircuitExport());
        });
    });

    bindOnce(root.querySelector('#btn-solar-review-top'), (btn) => {
        btn.addEventListener('click', () => {
            openBuildGuide();
        });
    });

    import('../solar/energy-zone-picker.js').then(({ bindEnergyZonePickerButton }) => {
        bindEnergyZonePickerButton(root);
    }).catch((err) => {
        console.warn('[topbar] energy zone picker unavailable:', err.message);
    });
}

/** @deprecated use bindSolarTopbar */
export const bindSolarDesignerTopbar = bindSolarTopbar;

/** @deprecated use bindSolarTopbar */
export const bindSimulatorTopbar = bindSolarTopbar;

/** Update solar topbar summary text. */
export function updateSolarTopbarSummary(root, circuitData) {
    const el = root.querySelector('#sim-topbar-summary');
    if (!el) return;
    const count = circuitData?.schematic?.components?.length
        ?? circuitData?.summary?.componentCount
        ?? globalThis.getSimulatorCircuitItems?.()?.length
        ?? 0;
    el.textContent = count > 0
        ? `${count} components on canvas`
        : 'Add components from the library panel.';
}

/** @deprecated use updateSolarTopbarSummary */
export const updateSimulatorTopbarSummary = updateSolarTopbarSummary;

globalThis.openBuildGuide = openBuildGuide;
