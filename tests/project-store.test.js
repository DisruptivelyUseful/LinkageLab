import { describe, expect, it, beforeEach } from 'vitest';
import {
    PROJECT_STORAGE_KEY,
    initProjectStore,
    normalizeProjectDocument,
    projectDocumentToLegacyUnified,
    publishProjectDocument,
    resolveProjectDocument,
    saveSimulatorSnapshot,
} from '../js/core/project-store.js';
import { createCircuitDocument } from '../js/circuit/circuit-store.js';

describe('project-store', () => {
    beforeEach(() => {
        localStorage.clear();
        delete globalThis.AppRouter;
    });

    it('normalizes unified-v2 simulator exports', () => {
        const doc = normalizeProjectDocument({
            version: 'unified-v2',
            circuit: {
                items: [{ id: 1, type: 'panel', handles: {} }],
                connections: [],
            },
            simulation: { latitude: 35, dayOfYear: 172 },
            summary: { panelCount: 1 },
        });

        expect(doc.exportType).toBe('linkageLab.project');
        expect(doc.schemaVersion).toBe(4);
        expect(doc.circuit?.items).toHaveLength(1);
        expect(doc.simulation?.latitude).toBe(35);
    });

    it('persists and resolves project documents', () => {
        const doc = normalizeProjectDocument({
            exportType: 'linkageLab.project',
            schemaVersion: 4,
            circuit: createCircuitDocument({
                items: [{ id: 2, type: 'battery', handles: {} }],
                connections: [],
            }),
            simulation: { latitude: 40 },
        });

        publishProjectDocument(doc);

        expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBeTruthy();
        expect(resolveProjectDocument()?.circuit?.items[0].id).toBe(2);
    });

    it('migrates legacy solarUnifiedConfig storage', () => {
        localStorage.setItem('solarUnifiedConfig', JSON.stringify({
            version: 'unified-v2',
            circuit: {
                items: [{ id: 3, type: 'controller', handles: {} }],
                connections: [],
            },
        }));

        const doc = resolveProjectDocument();
        expect(doc?.circuit?.items[0].id).toBe(3);
    });

    it('converts project document to legacy unified config for simulator', () => {
        const legacy = projectDocumentToLegacyUnified(normalizeProjectDocument({
            version: 'unified-v2',
            circuit: {
                items: [{ id: 4, type: 'panel', handles: {} }],
                connections: [{ id: 'w1' }],
                itemIdCounter: 5,
                connectionIdCounter: 2,
            },
            simulation: { weatherDifficulty: 'cloudy' },
        }));

        expect(legacy.version).toBe('unified-v2');
        expect(legacy.circuit.items[0].id).toBe(4);
        expect(legacy.simulation.weatherDifficulty).toBe('cloudy');
    });

    it('saveSimulatorSnapshot merges into canonical project', () => {
        globalThis.AppRouter = { getAppStateBus: () => ({ projectDocument: null, circuitDocument: null, circuitData: null }) };

        saveSimulatorSnapshot({
            circuit: {
                items: [{ id: 9, type: 'panel', handles: {} }],
                connections: [],
            },
            simulation: { latitude: 33 },
            summary: { panelCount: 1 },
        });

        const doc = resolveProjectDocument();
        expect(doc?.circuit?.items[0].id).toBe(9);
        expect(doc?.simulation?.latitude).toBe(33);
    });

    it('initProjectStore hydrates app state bus', () => {
        const bus = { projectDocument: null, circuitDocument: null, circuitData: null };
        globalThis.AppRouter = { getAppStateBus: () => bus };

        publishProjectDocument(normalizeProjectDocument({
            exportType: 'linkageLab.project',
            schemaVersion: 4,
            circuit: createCircuitDocument({ items: [{ id: 1 }], connections: [] }),
        }));

        initProjectStore();
        expect(bus.projectDocument).toBeTruthy();
        expect(bus.circuitDocument).toBeTruthy();
    });

    it('persists foldAngle in compact project storage', () => {
        publishProjectDocument(normalizeProjectDocument({
            exportType: 'linkageLab.project',
            schemaVersion: 4,
            foldAngle: 12.5,
            structure: { modules: 4 },
        }));

        const stored = JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY));
        expect(stored.foldAngle).toBe(12.5);
        expect(projectDocumentToLegacyUnified(resolveProjectDocument()).foldAngle).toBe(12.5);
    });
});
