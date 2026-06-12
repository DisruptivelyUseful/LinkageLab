// ============================================================================
// Unified topbar — shared chrome across linkage, solar design, and simulate
// ============================================================================

import { showToast } from '../core/feedback.js';
import {
    exportProjectFile,
    importProjectFile,
    loadProject,
    saveProject,
} from '../core/project-export.js';
import { publishCircuitExport, resolveCircuitExport } from '../solar/circuit-export.js';

const TOPBAR_PARTIALS = Object.freeze({
    'solar-design': 'partials/app-topbar-solar-design.html',
    'solar-simulate': 'partials/app-topbar-simulate.html',
});

async function fetchPartial(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${path} (HTTP ${res.status})`);
    return res.text();
}

/**
 * @param {'solar-design' | 'solar-simulate'} mode
 * @returns {Promise<string>}
 */
export async function renderAppTopbarHtml(mode) {
    const path = TOPBAR_PARTIALS[mode];
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

/** Wire save/load/export actions on the solar designer topbar. */
export function bindSolarDesignerTopbar(root = document) {
    bindOnce(root.querySelector('#btn-solar-save-top'), (btn) => {
        btn.addEventListener('click', () => saveProject());
    });

    bindOnce(root.querySelector('#btn-solar-load-top'), (btn) => {
        btn.addEventListener('click', () => loadProject());
    });

    bindOnce(root.querySelector('#btn-solar-export-top'), (btn) => {
        btn.addEventListener('click', () => exportProjectFile());
    });

    bindOnce(root.querySelector('#btn-solar-import-top'), (btn) => {
        btn.addEventListener('click', () => importProjectFile());
    });

    bindOnce(root.querySelector('#btn-solar-review-top'), (btn) => {
        btn.addEventListener('click', () => {
            openBuildGuide();
        });
    });

    bindOnce(root.querySelector('#btn-solar-simulate-top'), (btn) => {
        btn.addEventListener('click', () => globalThis.SolarDesigner?.exportToSimulator?.());
    });
}

/** Wire save/load/export on the simulate-mode shell topbar. */
export function bindSimulatorTopbar(root = document, options = {}) {
    const onReload = options.onReload;

    bindOnce(root.querySelector('#btn-sim-save-top'), (btn) => {
        btn.addEventListener('click', () => saveProject());
    });

    bindOnce(root.querySelector('#btn-sim-load-top'), (btn) => {
        btn.addEventListener('click', () => {
            loadProject();
            onReload?.(resolveCircuitExport());
        });
    });

    bindOnce(root.querySelector('#btn-sim-export-top'), (btn) => {
        btn.addEventListener('click', () => exportProjectFile());
    });

    bindOnce(root.querySelector('#btn-sim-import-top'), (btn) => {
        btn.addEventListener('click', () => {
            importProjectFile();
            onReload?.(resolveCircuitExport());
        });
    });

    bindOnce(root.querySelector('#btn-sim-build-guide-top'), (btn) => {
        btn.addEventListener('click', () => {
            openBuildGuide();
        });
    });

    bindOnce(root.querySelector('#btn-sim-design-top'), (btn) => {
        btn.addEventListener('click', () => {
            globalThis.AppRouter?.navigateTo?.('solar-design').catch((err) => {
                console.error('[topbar] navigate to designer failed:', err);
                showToast('Failed to open solar designer', 'error');
            });
        });
    });
}

/** Update simulate topbar summary text. */
export function updateSimulatorTopbarSummary(root, circuitData) {
    const el = root.querySelector('#sim-topbar-summary');
    if (!el) return;
    const count = circuitData?.schematic?.components?.length
        ?? circuitData?.summary?.componentCount
        ?? 0;
    el.textContent = count > 0
        ? `${count} components staged for 3D simulation`
        : 'Design a circuit in Solar Design, then simulate here.';
}

globalThis.openBuildGuide = openBuildGuide;
