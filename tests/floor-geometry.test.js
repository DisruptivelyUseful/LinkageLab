import { describe, expect, it } from 'vitest';
import { createTestState } from './helpers/state-fixture.js';
import '../js/linkage/beam-bolt-helpers.js';
import { solveLinkage } from '../js/linkage/solver.js';
import { getOptimalClosedAngleForAnimation } from '../js/linkage/joint-kinematics.js';
import { createDefaultFloor, generateFloorBeams, generateFloorTracks, trackSpanRange, describeFloorTrack, computeFloorDeck, calculateFloorPolygon, normalizeFloor, computeFloorBomContribution } from '../js/linkage/floor-geometry.js';
import { degToRad } from '../js/linkage/math.js';
import { pivotsFromState } from '../js/linkage/actuation.js';
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
        // Each beam's bottom face sits exactly on the top face of the leg it crosses (A on A, B on B),
        // which in a 2-layer bottom ring puts the B beam one H-beam thickness above the A beam.
        const legTop = (pat) => Math.max(...data.beams.filter(b => b.stackType === 'horizontal-bottom' && b.patternId === pat).flatMap(b => b.corners.map(c => c.y)));
        expect(legTop('B') - legTop('A')).toBeCloseTo(1.5, 3);
        beams.forEach(b => expect(b.center.y - 0.75).toBeCloseTo(legTop(b.patternId), 3));
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

    it('optional radial beams, vertical offset and swing are honoured; disabled/arch produce nothing', () => {
        const { st, data } = ring();
        const floor = createDefaultFloor();
        floor.enabled = true;
        floor.beams.radialEnabled = true;
        floor.beams.parallelOffsetV = 2;
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

    it('seating modes, A/B split and the signed anchor / radial offsets move the beams as labelled', () => {
        const { st, data } = ring();
        const base = createDefaultFloor();
        base.enabled = true;
        base.beams.radialEnabled = true;
        const gen = (over) => generateFloorBeams(data, { ...base, beams: { ...base.beams, ...over } }, st);
        const ringTop = Math.max(...data.beams.filter(b => b.stackType === 'horizontal-bottom').flatMap(b => b.corners.map(c => c.y)));
        const ref = gen({});
        const rcp = (bs, pat) => bs.filter(b => b.stackType === 'floor-beam-reciprocal' && b.patternId === pat);
        const rad = (bs) => bs.filter(b => b.stackType === 'floor-beam');
        // ring-top seating puts both patterns on the ring's highest face
        const onRing = gen({ seat: 'ringTop' });
        rcp(onRing, 'A').concat(rcp(onRing, 'B')).forEach(b => expect(b.center.y - 0.75).toBeCloseTo(ringTop, 3));
        // split: A up by half, B down by half
        const split = gen({ parallelVOffset: 2 });
        expect(rcp(split, 'A')[0].center.y - rcp(ref, 'A')[0].center.y).toBeCloseTo(1, 6);
        expect(rcp(split, 'B')[0].center.y - rcp(ref, 'B')[0].center.y).toBeCloseTo(-1, 6);
        // negative vertical offsets lower the beams
        expect(rcp(gen({ parallelOffsetV: -3 }), 'A')[0].center.y - rcp(ref, 'A')[0].center.y).toBeCloseTo(-3, 6);
        expect(rad(gen({ offsetV: -3 }))[0].center.y - rad(ref)[0].center.y).toBeCloseTo(-3, 6);
        expect(rad(ref)[0].center.y - 3.5 / 2).toBeCloseTo(ringTop, 6);
        // side-to-side shift of a radial beam: 4" along the ring tangent, perpendicular to its own direction
        const shifted = rad(gen({ offsetT: 4 }))[0], r0 = rad(ref)[0];
        const dx = shifted.p1.x - r0.p1.x, dz = shifted.p1.z - r0.p1.z;
        const ux = r0.p2.x - r0.p1.x, uz = r0.p2.z - r0.p1.z, ul = Math.hypot(ux, uz);
        expect(Math.hypot(dx, dz)).toBeCloseTo(4, 6);
        expect(Math.abs(dx * ux + dz * uz) / ul).toBeLessThan(1e-6);
        // anchor across the leg: 3" perpendicular to the beam's own (unswung) direction, mirrored per side
        const side = gen({ anchorSideIn: 3 });
        ['A', 'B'].forEach(pat => {
            const a = rcp(side, pat)[0], b = rcp(ref, pat)[0];
            const ddx = a.p1.x - b.p1.x, ddz = a.p1.z - b.p1.z;
            const vx = b.p2.x - b.p1.x, vz = b.p2.z - b.p1.z, vl = Math.hypot(vx, vz);
            expect(Math.hypot(ddx, ddz)).toBeCloseTo(3, 6);
            expect(Math.abs(ddx * vx + ddz * vz) / vl).toBeLessThan(1e-6);
        });
        // negative anchor distance walks back past the crossing along the same leg line
        const back = rcp(gen({ anchorDist: -10 }), 'A')[0], fwd = rcp(ref, 'A')[0];
        expect(Math.hypot(back.p1.x - fwd.p1.x, back.p1.z - fwd.p1.z)).toBeCloseTo(30, 6);
    });

    it('normalizeFloor maps legacy liftIn / one-sided A lift onto ring-top seating and accepts wide signed values', () => {
        const legacy = normalizeFloor({ enabled: true, beams: { liftIn: 2, parallelVOffset: 1.5 } });
        expect(legacy.beams.seat).toBe('ringTop');
        expect(legacy.beams.parallelOffsetV).toBeCloseTo(2.75, 6);
        expect(legacy.beams.parallelVOffset).toBeCloseTo(1.5, 6);
        expect(legacy.beams.offsetV).toBeCloseTo(2, 6);
        expect(legacy.beams.liftIn).toBeUndefined();
        const { st, data } = ring();
        // the legacy mapping reproduces the Phase-4 heights: B on the ring top, A one 1.5" beam higher
        const beams = generateFloorBeams(data, normalizeFloor({ enabled: true, beams: { liftIn: 0, parallelVOffset: 1.5 } }), st);
        const ringTop = Math.max(...data.beams.filter(b => b.stackType === 'horizontal-bottom').flatMap(b => b.corners.map(c => c.y)));
        expect(beams.find(b => b.patternId === 'B').center.y).toBeCloseTo(ringTop + 0.75, 6);
        expect(beams.find(b => b.patternId === 'A').center.y).toBeCloseTo(ringTop + 2.25, 6);
        const wide = normalizeFloor({ beams: { offsetV: -300, offsetT: -50, anchorDist: -20, anchorSideIn: -8, rcpEndOffset: -6, parallelSwingAngle: -200, parallelOffsetV: -9 }, deck: { insetIn: -4 } });
        expect(wide.beams.seat).toBe('leg');
        expect(wide.beams).toMatchObject({ offsetV: -300, offsetT: -50, anchorDist: -20, anchorSideIn: -8, rcpEndOffset: -6, parallelSwingAngle: -200, parallelOffsetV: -9 });
        expect(wide.deck.insetIn).toBe(-4);
        expect(normalizeFloor({ beams: { offsetV: -99999 } }).beams.offsetV).toBe(-1200);
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
        expect(f.beams.parallelLength).toBe(2400);
        expect(f.beams.radialEnabled).toBe(true);
        expect(f.deck.thicknessIn).toBe(0.05);
        const st = { orientation: 'horizontal', costHBeam: 10, costVBeam: 8, woodDensity: 0.02 };
        const bom = computeFloorBomContribution(f, 8, st);
        expect(bom.structureItems).toHaveLength(2);
        expect(bom.reciprocalQty).toBe(16);
        expect(bom.radialQty).toBe(8);
        expect(bom.floorBeamCost).toBe(8 * 10 + 16 * 8);
        expect(computeFloorBomContribution({ ...f, enabled: false }, 8, st).floorBeamCost).toBe(0);
    });

    describe('radial beams as slotted track feet', () => {
        const trackFloor = () => {
            const floor = createDefaultFloor();
            floor.enabled = true;
            floor.beams.radialEnabled = true;
            floor.beams.radialMode = 'track';
            floor.beams.parallelEnabled = false;
            return floor;
        };

        it('lays one track beam per module under the ring at every fold angle, with a slot bolt', () => {
            const { st, data } = ring();
            const floor = trackFloor();
            // Reciprocal floor beams are hidden below the RCP visibility angle; track feet are not
            const packed = solveLinkage(degToRad(10));
            packed._structureFoldAngleRad = degToRad(10);
            expect(generateFloorBeams(packed, floor, st)).toHaveLength(0);
            const tr = generateFloorTracks(packed, floor, st);
            expect(tr.beams).toHaveLength(8);
            expect(tr.tracks).toHaveLength(8);
            expect(tr.bolts).toHaveLength(8);
            expect(tr.beams.every(b => b.stackType === 'floor-beam-track')).toBe(true);
            expect(tr.bolts.every(b => b.boltType === 'track-bolt')).toBe(true);
            // below the bottom H stack (centred at y = 0), top face a clearance under the stack
            const hStackThick = data.frame.hStackThick;
            tr.tracks.forEach(t => {
                expect(t.topY).toBeCloseTo(-hStackThick / 2 - 0.25, 6);
                expect(t.bottomY).toBeCloseTo(t.topY - floor.beams.thickness, 6);
            });
            tr.beams.forEach(b => expect(b.center.y).toBeCloseTo(-hStackThick / 2 - 0.25 - floor.beams.thickness / 2, 6));
        });

        it('keeps the inner pivot bolt inside the slot and the beam axis under it across the sweep', () => {
            const { st } = ring();
            const floor = trackFloor();
            const spans = trackSpanRange(st);
            expect(spans.packed).toBeGreaterThan(spans.deployed);
            for (const deg of [8, 30, 60, 90, 120, 134]) {
                const d = solveLinkage(degToRad(deg));
                const tr = generateFloorTracks(d, floor, st);
                tr.tracks.forEach((t, i) => {
                    const mp = d.modulePivots[i];
                    // beam axis passes through the pin and under the inner pivot
                    const axis = { x: t.dir.x, z: t.dir.z };
                    const rel = { x: mp.botInner.x - t.pin.x, z: mp.botInner.z - t.pin.z };
                    const cross = Math.abs(rel.x * axis.z - rel.z * axis.x);
                    expect(cross).toBeLessThan(1e-6);
                    const along = rel.x * axis.x + rel.z * axis.z;
                    expect(along).toBeGreaterThanOrEqual(spans.deployed - 0.126);
                    expect(along).toBeLessThanOrEqual(spans.packed + 0.126);
                    // the retaining bolt stands on the inner pivot
                    expect(tr.bolts[i].center.x).toBeCloseTo(mp.botInner.x, 9);
                    expect(tr.bolts[i].center.z).toBeCloseTo(mp.botInner.z, 9);
                });
            }
        });

        it('slot length is the pivot span travel and the readout reports swing and drag', () => {
            const { st, data } = ring();
            const floor = trackFloor();
            const tr = generateFloorTracks(data, floor, st);
            const spans = trackSpanRange(st);
            expect(tr.tracks[0].slotLengthIn).toBeCloseTo(spans.travel + 0.25, 6);
            expect(tr.tracks[0].lengthIn).toBeCloseTo(18 + spans.packed + 6, 6);
            const d = describeFloorTrack(st, tr.tracks, (ang) => pivotsFromState(st, ang));
            expect(d.slotLengthIn).toBeCloseTo(spans.travel, 2);
            expect(d.swingDeg).toBeGreaterThan(5);      // pivot at 41.4 %: the beam swings about its pin
            expect(d.swingDeg).toBeLessThan(45);
            expect(d.footDragIn).toBeGreaterThan(0);
            // a 50 % pivot gives a straight slot: no swing
            const { st: st50 } = ring({ pivotPct: 50 });
            const d50 = describeFloorTrack(st50, [], (ang) => pivotsFromState(st50, ang));
            expect(Math.abs(d50.swingDeg)).toBeLessThan(0.01);
        });

        it('normalizes legacy configs to offset mode and prices the track in the BOM', () => {
            expect(normalizeFloor({ enabled: true, beams: { radialEnabled: true } }).beams.radialMode).toBe('offset');
            expect(normalizeFloor({ beams: { radialMode: 'track', trackTailIn: -5 } }).beams).toMatchObject({ radialMode: 'track', trackTailIn: 0 });
            const { st } = ring();
            st.costHBeam = 10; st.costBoltHPivot = 2;
            const bom = computeFloorBomContribution(trackFloor(), 8, st);
            expect(bom.trackQty).toBe(8);
            expect(bom.structureItems).toHaveLength(2);
            expect(bom.floorBeamCost).toBeCloseTo(8 * 10 + 8 * 2, 6);
            expect(bom.trackLengthIn).toBeGreaterThan(24);
        });
    });
});
