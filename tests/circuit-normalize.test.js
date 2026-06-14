import { describe, expect, it } from 'vitest';
import { normalizeCircuitItems, repairCircuitItemHandles } from '../js/circuit/circuit-normalize.js';

describe('circuit-normalize', () => {
    it('repairs panel handle positions from width/height', () => {
        const item = repairCircuitItemHandles({
            id: 'panel-1',
            type: 'panel',
            width: 100,
            height: 80,
            handles: {
                positive: { id: 'panel-1-pos', polarity: 'positive' },
                negative: { id: 'panel-1-neg', polarity: 'negative' },
            },
        });

        expect(item.handles.positive.x).toBe(0);
        expect(item.handles.positive.y).toBe(40);
        expect(item.handles.negative.x).toBe(100);
        expect(item.handles.negative.y).toBe(40);
    });

    it('normalizeCircuitItems maps all items', () => {
        const items = normalizeCircuitItems([
            { id: 'p1', type: 'panel', width: 60, height: 90, handles: {} },
        ]);
        expect(items).toHaveLength(1);
        expect(items[0].handles.positive).toBeTruthy();
        expect(items[0].handles.negative).toBeTruthy();
    });
});
