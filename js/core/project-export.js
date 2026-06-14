// ============================================================================
// Unified project export — linkage + hardware + electrical + wiring in one file
// ============================================================================

import { showToast } from './feedback.js';
import { ExportFormat } from './export-format.js';
import { publishCircuitExport } from '../solar/circuit-export.js';
import {
    buildLinkageExportData,
    generateDefaultFilename,
    getUnifiedConfig,
    publishLinkageExport,
} from '../linkage/export-bridge.js';
import {
    PROJECT_SCHEMA_VERSION,
    PROJECT_STORAGE_KEY,
    initProjectStore,
    normalizeProjectDocument,
    publishProjectDocument,
    resolveProjectDocument,
    saveSimulatorSnapshot,
} from './project-store.js';
import { createCircuitDocument, fromDesignerExport } from '../circuit/circuit-store.js';

export {
    PROJECT_SCHEMA_VERSION,
    PROJECT_STORAGE_KEY,
    initProjectStore,
    normalizeProjectDocument,
    publishProjectDocument,
    resolveProjectDocument,
    saveSimulatorSnapshot,
};

/** @deprecated use normalizeProjectDocument */
export const normalizeProjectImport = normalizeProjectDocument;

/**
 * Build a unified project file from the current app state (all modes).
 * @returns {object}
 */
export function buildProjectExport() {
    const project = getUnifiedConfig();
    project.schemaVersion = PROJECT_SCHEMA_VERSION;
    project.exportType = 'linkageLab.project';
    project.updatedAt = Date.now();

    const designer = globalThis.SolarDesigner;
    if (designer?.isInitialized?.()) {
        const items = designer.getItems();
        const connections = designer.getConnections();
        const circuit = designer.getSolarConfig();

        project.circuit = createCircuitDocument({
            items,
            connections,
            itemIdCounter: circuit.itemIdCounter,
            connectionIdCounter: circuit.connectionIdCounter,
        }, {
            automation: circuit.automations || circuit.automation,
            simulation: circuit.simulation,
        });

        const totalPanelWatts = items
            .filter((i) => i.type === 'panel')
            .reduce((sum, p) => sum + (p.specs?.wmp || 0), 0);
        const totalBatteryKwh = items
            .filter((i) => i.type === 'battery' || i.type === 'smartbattery')
            .reduce((sum, b) => sum + (b.specs?.kWh || ((b.specs?.voltage || 0) * (b.specs?.ah || 0)) / 1000), 0);
        const totalLoadWatts = items
            .filter((i) => i.type === 'acload')
            .reduce((sum, l) => sum + (l.specs?.watts || 0), 0);

        project.handoff = {
            linkage: buildLinkageExportData(),
            designer: ExportFormat.createDesignerExport({
                components: items.map((item) => ExportFormat.serializeComponent(item)),
                connections: connections.map((conn) => ExportFormat.serializeConnection({
                    id: conn.id,
                    sourceItemId: conn.sourceItemId,
                    sourceHandle: conn.sourceHandleKey || conn.sourceHandle,
                    targetItemId: conn.targetItemId,
                    targetHandle: conn.targetHandleKey || conn.targetHandle,
                    wireType: conn.wireType,
                    points: conn.points,
                })),
                automationRules: circuit.automations,
                timeOfDay: circuit.simulation?.time,
                isLiveMode: circuit.debug?.mode?.liveViewActive,
                loadStates: circuit.debug?.loadStates,
                breakerStates: circuit.debug?.breakerStates,
                totalPanelWatts,
                totalBatteryKwh,
                totalLoadWatts,
                componentCount: items.length,
                structureGeometry: project.geometrySnapshot || project.handoff?.linkage?.structureGeometry,
                cameraState: project.cameraState,
            }),
        };

        if (designer.generateBOM) {
            project.electricalBom = designer.generateBOM();
        }
        if (designer.getSystemAnalysis) {
            try {
                project.systemAnalysis = designer.getSystemAnalysis();
            } catch (err) {
                console.warn('[project-export] system analysis failed:', err);
            }
        }
    } else if (typeof buildLinkageExportData === 'function') {
        project.handoff = { linkage: buildLinkageExportData() };
    }

    if (typeof globalThis.getSimulatorProjectSnapshot === 'function') {
        const simSlice = globalThis.getSimulatorProjectSnapshot();
        if (simSlice?.simulation) project.simulation = simSlice.simulation;
        if (simSlice?.structureGeometry && !project.structureGeometry) {
            project.structureGeometry = simSlice.structureGeometry;
        }
        if (simSlice?.circuit && !project.circuit) {
            project.circuit = fromDesignerExport({ circuit: simSlice.circuit, simulation: simSlice.simulation });
        }
    }

    return normalizeProjectDocument(project);
}

function resolveCircuitFromProject(project) {
    if (project.circuit?.items) return project.circuit;
    if (project.handoff?.designer) {
        const doc = fromDesignerExport(project.handoff.designer);
        return doc.items?.length ? doc : null;
    }
    if (project.solarDesigner) {
        return fromDesignerExport({ solarDesigner: project.solarDesigner });
    }
    return null;
}

/**
 * Apply a unified project to linkage, solar designer, and simulator handoff bus.
 * @param {object} rawProject
 */
export function applyProjectImport(rawProject) {
    const project = normalizeProjectDocument(rawProject);
    publishProjectDocument(project);

    const linkageTrigger = project.structure || project.mode || project.foldAngle !== undefined
        || ('supportBeams' in project)
        || (project.panels && project.panels.support)
        || project.linkage;
    if (linkageTrigger && typeof globalThis.applyConfig === 'function') {
        try {
            globalThis.applyConfig(project.linkage || project);
        } catch (err) {
            console.warn('[project-export] linkage apply failed:', err);
        }
    }

    const circuit = resolveCircuitFromProject(project);
    const designer = globalThis.SolarDesigner;
    if (circuit && designer?.isInitialized?.()) {
        try {
            designer.loadSolarConfig({
                items: circuit.items,
                connections: circuit.connections,
                itemIdCounter: circuit.itemIdCounter,
                connectionIdCounter: circuit.connectionIdCounter,
                automations: circuit.automation,
                simulation: circuit.simulation || project.simulation,
            });
            designer.render?.();
        } catch (err) {
            console.warn('[project-export] circuit apply failed:', err);
        }
    }

    const linkageHandoff = project.handoff?.linkage
        || (project.solarPanels ? buildLinkageExportData() : null);
    if (linkageHandoff) {
        publishLinkageExport(linkageHandoff);
    }

    const designerHandoff = project.handoff?.designer
        || (circuit ? ExportFormat.createDesignerExport({
            components: (circuit.items || []).map((item) => ExportFormat.serializeComponent(item)),
            connections: (circuit.connections || []).map((conn) => ExportFormat.serializeConnection({
                id: conn.id,
                sourceItemId: conn.sourceItemId,
                sourceHandle: conn.sourceHandleKey || conn.sourceHandle,
                targetItemId: conn.targetItemId,
                targetHandle: conn.targetHandleKey || conn.targetHandle,
            })),
            automationRules: circuit.automation,
            simulation: project.simulation || circuit.simulation,
            componentCount: circuit.items?.length || 0,
            structureGeometry: project.structureGeometry || project.geometrySnapshot,
            cameraState: project.cameraState,
        }) : null);
    if (designerHandoff) {
        publishCircuitExport(designerHandoff);
    }

    if (typeof globalThis.applySimulatorProjectImport === 'function') {
        try {
            globalThis.applySimulatorProjectImport(project);
        } catch (err) {
            console.warn('[project-export] simulator apply failed:', err);
        }
    }

    if (typeof globalThis.saveStateToHistory === 'function') {
        globalThis.saveStateToHistory();
    }
}

/** Save unified project to localStorage. */
export function saveProject() {
    globalThis.flushSimulatorAutosave?.();
    const project = buildProjectExport();
    publishProjectDocument(project);
    // Keep legacy linkage autosave in sync so a normal refresh restores deploy angle, etc.
    if (typeof globalThis.getConfigSnapshot === 'function') {
        try {
            localStorage.setItem('linkageLab_config', JSON.stringify(globalThis.getConfigSnapshot()));
        } catch (err) {
            console.warn('[project-export] Failed to sync linkageLab_config:', err);
        }
    }
    globalThis.clearSimulatorDirtyGuard?.();
    showToast('Project saved (linkage + electrical + wiring)', 'info');
}

/** Load unified project from localStorage. */
export function loadProject() {
    const saved = localStorage.getItem(PROJECT_STORAGE_KEY)
        || localStorage.getItem('unifiedSolarConfig')
        || localStorage.getItem('linkageLab_config');
    if (!saved) {
        showToast('No saved project found', 'warning');
        return;
    }
    try {
        applyProjectImport(JSON.parse(saved));
        showToast('Project loaded', 'info');
    } catch (err) {
        console.error('[project-export] load failed:', err);
        showToast('Failed to load project', 'error');
    }
}

/** Export unified project as a JSON file download. */
export function exportProjectFile() {
    const defaultName = generateDefaultFilename();
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#1e2732;border-radius:8px;padding:24px;min-width:400px;max-width:500px;color:#e1e8ed;font-family:system-ui,sans-serif;';
    dialog.innerHTML = `
        <h3 style="margin:0 0 16px 0;font-size:1.2rem;">Export StarShade Project</h3>
        <p style="margin:0 0 12px 0;color:#8899a6;font-size:0.9rem;">One file includes linkage hardware, electrical design, and wiring.</p>
        <input type="text" id="project-export-filename" value="${defaultName}"
               style="width:100%;padding:10px;border:1px solid #38444d;border-radius:4px;background:#15202b;color:#e1e8ed;font-size:1rem;box-sizing:border-box;">
        <p style="margin:8px 0 16px 0;color:#657786;font-size:0.8rem;">.json extension will be added automatically</p>
        <div style="display:flex;gap:12px;justify-content:flex-end;">
            <button id="project-export-cancel" style="padding:8px 16px;border:1px solid #38444d;border-radius:4px;background:transparent;color:#e1e8ed;cursor:pointer;">Cancel</button>
            <button id="project-export-confirm" style="padding:8px 16px;border:none;border-radius:4px;background:#1da1f2;color:white;cursor:pointer;font-weight:500;">Export</button>
        </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const filenameInput = document.getElementById('project-export-filename');
    filenameInput.focus();
    filenameInput.select();

    const doExport = () => {
        let filename = filenameInput.value.trim() || defaultName;
        filename = filename.replace(/[<>:"/\\|?*]/g, '-');
        if (!filename.endsWith('.json')) filename += '.json';

        const project = buildProjectExport();
        const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(overlay);
        showToast(`Exported project: ${filename}`, 'info');
    };

    const doCancel = () => document.body.removeChild(overlay);

    document.getElementById('project-export-confirm').onclick = doExport;
    document.getElementById('project-export-cancel').onclick = doCancel;
    filenameInput.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); doExport(); }
        else if (e.key === 'Escape') { e.preventDefault(); doCancel(); }
    };
    overlay.onclick = (e) => { if (e.target === overlay) doCancel(); };
}

/** Open file picker and import a unified project. */
export function importProjectFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                applyProjectImport(JSON.parse(String(event.target?.result ?? '')));
                showToast(`Imported project: ${file.name}`, 'info');
            } catch (err) {
                console.error('[project-export] import failed:', err);
                showToast(`Import failed: ${err.message}`, 'error');
            }
        };
        reader.readAsText(file);
    });
    input.click();
}

globalThis.buildProjectExport = buildProjectExport;
globalThis.applyProjectImport = applyProjectImport;
globalThis.saveProject = saveProject;
globalThis.loadProject = loadProject;
globalThis.exportProjectFile = exportProjectFile;
globalThis.importProjectFile = importProjectFile;
