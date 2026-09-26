import { describe, expect, it } from 'vitest';
import { createTestState } from './helpers/state-fixture.js';
import '../js/linkage/beam-bolt-helpers.js';
import { solveLinkage } from '../js/linkage/solver.js';
import { getOptimalClosedAngleForAnimation } from '../js/linkage/joint-kinematics.js';
import { createDefaultFloor, generateFloorBeams, computeFloorDeck, calculateFloorPolygon, normalizeFloor, computeFloorBomContribution } from '../js/linkage/floor-geometry.js';
import { nestPolygonOnSheets } from '../js/linkage/sheet-nesting.js';

function ring(overrides = {}) {
    const st = createTestState({ modules: 8, hLengthFt: 8, vLengthFt: 7.97, pivotPct: 41.4, offsetTopIn: 1.25, offsetBotIn: 1, vertEndOffset: 1, hStackCount: 2, vStackCount: 3, hBeamW: 2.5, hBeamT: 1.5, vBeamW: 0.75, vBeamT: 2.5, ...overrides });
    globalThis.state = st;
    st.animation.cachedClosedAngle = undefined;
    st.foldAngle = getOptimalClosedAngleForAnimation();
    const data = solveLinkage(st.foldAngle);
    data._structureFoldAngleRad = st.foldAngle;
    return { st, data };
}

describe('floor-geometry', () => {
    it('lays two reciprocal floor beams per module on top of the bottom ring', () => {
        const { st, data } = ring();
        const floor = createDefaultFloor();
        floor.enabled = true;
        const beams = generateFloorBeams(data, floor, st);
        expect(beams).toHaveLength(16);
        expect(beams.every(b => b.stackType === 'floor-beam-reciprocal')).toBe(true);
        const ringTop = Math.max(...data.beams.filter(b => b.stackType === 'horizontal-bottom').flatMap(b => b.corners.map(c => c.y)));
        const bBeams = beams.filter(b => b.patternId === 'B');
        const aBeams = beams.filter(b => b.patternId === 'A');
        // B beams rest on the ring; A beams ride one thickness higher (the weave)
        bBeams.forEach(b => expect(b.center.y).toBeCloseTo(ringTop + 0.75, 1));
        aBeams.forEach(b => expect(b.center.y).toBeCloseTo(ringTop + 0.75 + 1.5, 1));
        // every beam is horizontal and 96" long
        beams.forEach(b => {
            expect(Math.abs(b.p1.y - b.p2.y)).toBeLessThan(1e-6);
            expect(Math.hypot(b.p2.x - b.p1.x, b.p2.z - b.p1.z)).toBeCloseTo(96, 3);
        });
        // reciprocal layout: every beam runs from its anchor on the ring across the interior
        const bot = data.beams.filter(b => b.stackType === 'horizontal-bottom');
        const cx = bot.reduce((a, b) => a + b.center.x, 0) / bot.length;
        const cz = bot.reduce((a, b) => a + b.center.z, 0) / bot.length;
        const innerR = Math.min(...bot.flatMap(b => [b.p1, b.p2]).map(p => Math.hypot(p.x - cx, p.z - cz)));
        beams.forEach(b => {
            let best = Infinity;
            for (let t = 0; t <= 1; t += 0.05) best = Math.min(best, Math.hypot(b.p1.x + (b.p2.x - b.p1.x) * t - cx, b.p1.z + (b.p2.z - b.p1.z) * t - cz));
            expect(best).toBeLessThan(innerR);
        });
    });

    it('optional radial beams, lift and swing are honoured; disabled/arch produce nothing', () => {
        const { st, data } = ring();
        const floor = createDefaultFloor();
        floor.enabled = true;
        floor.beams.radialEnabled = true;
        floor.beams.liftIn = 2;
        floor.beams.parallelSwingAngle = 15;
        const beams = generateFloorBeams(data, floor, st);
        expect(beams.filter(b => b.stackType === 'floor-beam')).toHaveLength(8);
        const straight = generateFloorBeams(data, { ...floor, beams: { ...floor.beams, parallelSwingAngle: 0 } }, st).filter(b => b.patternId === 'A')[0];
        const swung = beams.filter(b => b.patternId === 'A')[0];
        const ang = (b) => Math.atan2(b.p2.z - b.p1.z, b.p2.x - b.p1.x);
        expect(Math.abs(ang(swung) - ang(straight)) * 180 / Math.PI).toBeCloseTo(15, 0);
        const ringTop = Math.max(...data.beams.filter(b => b.stackType === 'horizontal-bottom').flatMap(b => b.corners.map(c => c.y)));
        expect(beams.find(b => b.patternId === 'B').center.y).toBeCloseTo(ringTop + 2 + 0.75, 1);
        expect(generateFloorBeams(data, { ...floor, enabled: false }, st)).toHaveLength(0);
        expect(generateFloorBeams(data, floor, { ...st, orientation: 'vertical' })).toHaveLength(0);
    });

    it('deck is the inner octagon on top of the beams and nests into several sheets', () => {
        const { st, data } = ring();
        const floor = createDefaultFloor();
        floor.enabled = true;
        const beams = generateFloorBeams(data, floor, st);
        const withBeams = { ...data, beams: data.beams.concat(beams) };
        const poly = calculateFloorPolygon(withBeams, 0, 8);
        expect(poly.vertices).toHaveLength(8);
        const deck = computeFloorDeck(withBeams, floor, st);
        expect(deck).toBeTruthy();
        expect(deck.band).toBe('floor');
        expect(deck.corners3D).toHaveLength(8);
        expect(deck.slabCorners3D).toHaveLength(16);
        const beamsTop = Math.max(...beams.flatMap(b => b.corners.map(c => c.y)));
        expect(deck.yBottom).toBeCloseTo(beamsTop, 2);
        expect(deck.yTop).toBeCloseTo(beamsTop + 0.75, 2);
        // inner octagon: every vertex is inside the outer foot radius and roughly at the inner pivot radius (~93")
        const rc = poly.ringCenter;
        deck.corners3D.forEach(p => {
            const r = Math.hypot(p.x - rc.x, p.z - rc.z);
            expect(r).toBeGreaterThan(70);
            expect(r).toBeLessThan(110);
        });
        expect(deck.areaIn2).toBeGreaterThan(20000);
        const nest = nestPolygonOnSheets(deck.corners2D, { widthIn: 48, lengthIn: 96 });
        expect(nest.sheetCount).toBeGreaterThanOrEqual(4);
        expect(nest.pieces.some(p => !p.isFullSheet)).toBe(true);
        // an inset shrinks the deck
        floor.deck.insetIn = 6;
        const smaller = computeFloorDeck(withBeams, floor, st);
        expect(smaller.areaIn2).toBeLessThan(deck.areaIn2);
        // deck off → null
        expect(computeFloorDeck(withBeams, { ...floor, deck: { ...floor.deck, enabled: false } }, st)).toBeNull();
    });

    it('normalizeFloor and BOM rows', () => {
        const f = normalizeFloor({ enabled: 1, beams: { parallelLength: 5000, radialEnabled: true }, deck: { thicknessIn: 0 } });
        expect(f.enabled).toBe(true);
        expect(f.beams.parallelLength).toBe(480);
        expect(f.beams.radialEnabled).toBe(true);
        expect(f.deck.thicknessIn).toBe(0.1);
        const st = { orientation: 'horizontal', costHBeam: 10, costVBeam: 8, woodDensity: 0.02 };
        const bom = computeFloorBomContribution(f, 8, st);
        expect(bom.structureItems).toHaveLength(2);
        expect(bom.reciprocalQty).toBe(16);
        expect(bom.radialQty).toBe(8);
        expect(bom.floorBeamCost).toBe(8 * 10 + 16 * 8);
        expect(computeFloorBomContribution({ ...f, enabled: false }, 8, st).floorBeamCost).toBe(0);
    });
});
