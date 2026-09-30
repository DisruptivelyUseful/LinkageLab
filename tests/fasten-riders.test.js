import { describe, expect, it } from 'vitest';
import { washersUnderHead } from '../js/linkage/hw-snap.js';

// Fake laid-out part meshes: only userData.build is read.
const mesh = (partType, axisPos, len, extra = {}) => ({ userData: { build: { partType, axisPos, len, renderAxisKey: 'right', ...extra } } });
const buildOf = m => m.userData.build;

describe('fasten: washers ride in with the bolt head', () => {
    // head outside (+end): bolt shank [0.3, 2.65], head [2.65, 2.85] → centre 1.575, len 2.55
    const bolt = mesh('bolt', 1.575, 2.55, { flip: true, headH: 0.2 });

    it('carries contiguous washers under the head, stops at the first other part', () => {
        const lock = mesh('lockWasher', 2.611, 0.078);      // [2.572, 2.65]
        const washer = mesh('washer', 2.541, 0.0625);       // [2.51, 2.572]
        const bushing = mesh('bushing', 1.885, 1.25);       // [1.26, 2.51]
        const riders = washersUnderHead(bolt, [bolt, lock, washer, bushing], buildOf);
        expect(riders).toEqual([lock, washer]);
    });

    it('leaves a washer that sits apart from the head', () => {
        const loose = mesh('washer', 2.0, 0.0625);
        expect(washersUnderHead(bolt, [bolt, loose], buildOf)).toEqual([]);
    });

    it('ignores parts on another axis and on the far side of the head', () => {
        const other = mesh('washer', 2.611, 0.078, { renderAxisKey: 'left' });
        const outside = mesh('washer', 2.9, 0.0625);
        expect(washersUnderHead(bolt, [bolt, other, outside], buildOf)).toEqual([]);
    });
});
