import { describe, expect, it, beforeEach } from 'vitest';
import {
    createCircuitDocument,
    fromDesignerExport,
    initCircuitStore,
    publishCircuitDocument,
    resolveCircuitDocument,
    setState,
    subscribe,
    toDesignerExport,
    normalizeDesignerConnections,
    toDesignerConfig,
    CIRCUIT_DOCUMENT_KEY,
} from '../js/circuit/circuit-store.js';

describe('circuit-store', () => {
    beforeEach(() => {
        localStorage.clear();
        delete globalThis.AppRouter;
    });

    it('persists and resolves a circuit document', () => {
        const doc = createCircuitDocument({
            items: [{ id: 1, type: 'panel' }],
            connections: [{ id: 'c1', sourceItemId: 1, targetItemId: 2 }],
        });
        publishCircuitDocument(doc);

        expect(localStorage.getItem(CIRCUIT_DOCUMENT_KEY)).toBeTruthy();
        expect(resolveCircuitDocument()?.items).toHaveLength(1);
        expect(toDesignerExport(resolveCircuitDocument())?.schematic?.components).toHaveLength(1);
    });

    it('migrates legacy designer export format', () => {
        localStorage.setItem('solarDesignerExport', JSON.stringify({
            schematic: { components: [{ id: 5 }], connections: [] },
        }));

        const doc = fromDesignerExport(JSON.parse(localStorage.getItem('solarDesignerExport')));
        expect(doc.items[0].id).toBe(5);
    });

    it('setState merges partial updates and notifies subscribers', () => {
        publishCircuitDocument(createCircuitDocument({
            items: [{ id: 1 }],
            connections: [],
        }));

        const seen = [];
        subscribe((doc) => seen.push(doc.items.length));

        setState({ items: [{ id: 1 }, { id: 2 }] });

        expect(resolveCircuitDocument()?.items).toHaveLength(2);
        expect(seen).toContain(2);
    });

    it('initCircuitStore hydrates app state bus', () => {
        const bus = { circuitDocument: null, circuitData: null };
        globalThis.AppRouter = { getAppStateBus: () => bus };
        publishCircuitDocument(createCircuitDocument({ items: [{ id: 9 }], connections: [] }));

        const doc = initCircuitStore();
        expect(doc?.items[0].id).toBe(9);
        expect(bus.circuitDocument).toBeTruthy();
    });

    it('normalizeDesignerConnections resolves simulator handle ids to designer keys', () => {
        const items = [{
            id: 'panel-1',
            type: 'panel',
            width: 100,
            height: 80,
            handles: {
                positive: { id: 'panel-1-pos', x: 0, y: 40 },
                negative: { id: 'panel-1-neg', x: 100, y: 40 },
            },
        }];

        const normalized = normalizeDesignerConnections(items, [{
            id: 'w1',
            sourceItemId: 'panel-1',
            sourceHandleId: 'panel-1-pos',
            targetItemId: 'panel-1',
            targetHandleId: 'panel-1-neg',
        }]);

        expect(normalized[0].sourceHandleKey).toBe('positive');
        expect(normalized[0].targetHandleKey).toBe('negative');

        const config = toDesignerConfig(createCircuitDocument({
            items,
            connections: normalized,
        }));
        expect(config.connections[0].sourceHandleKey).toBe('positive');
    });
});
