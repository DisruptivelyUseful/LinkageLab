import { describe, expect, it } from 'vitest';
import inputFixture from './fixtures/project-unified-v2-input.json';
import goldenFixture from './fixtures/project-normalized-v4-golden.json';
import {
    normalizeProjectDocument,
    projectDocumentToLegacyUnified,
} from '../js/core/project-store.js';
import { fromDesignerExport, toDesignerExport } from '../js/circuit/circuit-store.js';

function stripVolatile(doc) {
    const clone = JSON.parse(JSON.stringify(doc));
    delete clone.updatedAt;
    if (clone.circuit) delete clone.circuit.updatedAt;
    return clone;
}

describe('project export golden fixtures', () => {
    it('normalizes unified-v2 input to stable v4 document shape', () => {
        const normalized = normalizeProjectDocument(inputFixture);
        expect(stripVolatile(normalized)).toEqual(goldenFixture);
    });

    it('designer export round-trips through circuit store without losing items', () => {
        const doc = normalizeProjectDocument(inputFixture);
        const designerExport = toDesignerExport(doc.circuit);
        const roundTrip = fromDesignerExport({
            version: 2,
            schematic: designerExport.schematic,
            automation: designerExport.automation,
            simulation: designerExport.simulation,
        });

        expect(roundTrip.items).toHaveLength(doc.circuit.items.length);
        expect(roundTrip.connections).toHaveLength(doc.circuit.connections.length);
        expect(roundTrip.items.map((item) => item.id)).toEqual(doc.circuit.items.map((item) => item.id));
    });

    it('legacy unified config preserves circuit and simulation slices', () => {
        const doc = normalizeProjectDocument(inputFixture);
        const legacy = projectDocumentToLegacyUnified(doc);

        expect(legacy.version).toBe('unified-v2');
        expect(legacy.circuit.items).toHaveLength(2);
        expect(legacy.simulation.latitude).toBe(40);
        expect(legacy.simulation.weatherDifficulty).toBe('clear');
    });
});
