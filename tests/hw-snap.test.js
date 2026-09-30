import { describe, expect, it } from 'vitest';
import { computeAxisStack, checkAxisFit } from '../js/linkage/hw-stack-layout.js';
import {
    axisBodiesFromStack,
    computePush,
    collectSnapTargets,
    snapStart,
    seatPush,
} from '../js/linkage/hw-snap.js';

const beam = (seq, extra = {}) => ({ id: `beam${seq}`, type: 'beam', seq, qty: 1, params: { width: 3.5, thickness: 1.5, holeDiameter: 0.5 }, ...extra });
const washer = (seq, extra = {}) => ({ id: `washer${seq}`, type: 'washer', seq, qty: 1, params: { id: 0.5, od: 1.25, thickness: 0.0625 }, ...extra });
const bolt = (seq, length, extra = {}) => ({ id: `bolt${seq}`, type: 'bolt', seq, qty: 1, params: { diameter: 0.5, length, threadLength: length, headHeight: 0.3, headDia: 0.75 }, ...extra });
const bushing = (seq, extra = {}) => ({ id: `bush${seq}`, type: 'bushing', seq, qty: 1, params: { id: 0.5, od: 0.625, length: 1.25 }, ...extra });

const byId = (stack, id, copy = 0) => stack.items.find(it => it.part.id === id && it.copyIndex === copy);
const body = (bodies, id) => bodies.find(b => b.id === id);

describe('manual positions (computeAxisStack opts.manual)', () => {
    it('hand-placed pos wins over the tight layout, relative to the datum origin', () => {
        const parts = [beam(1), washer(2, { pos: -0.5 }), washer(3, { pos: 3 })];
        const s = computeAxisStack(parts, { origin: 2, manual: true });
        expect(byId(s, 'washer2').start).toBeCloseTo(1.5);
        expect(byId(s, 'washer3').start).toBeCloseTo(5);
        // rank follows position: washer2 is now innermost
        expect(byId(s, 'washer2').rank).toBe(0);
        expect(byId(s, 'beam1').rank).toBe(1);
    });

    it('beams keep their tight seat even on a manual axis', () => {
        const s = computeAxisStack([beam(1, { pos: 5 }), washer(2, { pos: 0 })], { origin: 0, manual: true });
        expect(byId(s, 'beam1').start).toBeCloseTo(0);
    });

    it('ignores pos when the axis is not manual', () => {
        const s = computeAxisStack([beam(1), washer(2, { pos: 9 })], { origin: 0 });
        expect(byId(s, 'washer2').start).toBeCloseTo(1.5);
    });

    it('qty copies stay contiguous from pos; parts without pos keep the tight spot', () => {
        const s = computeAxisStack([beam(1), washer(2, { qty: 2, pos: 4 })], { origin: 0, manual: true });
        expect(byId(s, 'washer2', 0).start).toBeCloseTo(4);
        expect(byId(s, 'washer2', 1).start).toBeCloseTo(4.0625);
        expect(byId(s, 'beam1').start).toBeCloseTo(0);
    });

    it('an insert without pos rides with its host member', () => {
        const s = computeAxisStack([washer(1, { pos: 1 }), bushing(2)], { origin: 0, manual: true });
        expect(byId(s, 'bush2').end).toBeCloseTo(byId(s, 'washer1').end);
        expect(byId(s, 'washer1').start).toBeCloseTo(1);
    });

    it('moves the whole bolt (head + shank) by its pos', () => {
        const b = bolt(3, 3, { flipAxis: true, pos: 0.5 });
        const s = computeAxisStack([beam(1), washer(2), b], { origin: 0, manual: true });
        expect(s.bolt.shankStart).toBeCloseTo(0.5);
        expect(s.bolt.headStart).toBeCloseTo(3.5);
        expect(s.bolt.headEnd).toBeCloseTo(3.8);
    });

    it('overlaps are allowed and reported as info, never warn', () => {
        const s = computeAxisStack([beam(1, { pos: 0 }), washer(2, { pos: 0.5 })], { origin: 0, manual: true });
        const ov = s.fit.filter(f => f.code === 'overlap');
        expect(ov).toHaveLength(1);
        expect(ov[0].level).toBe('info');
        expect(ov[0].partId).toBe('washer2');
    });

    it('a tight stack has no overlap notes', () => {
        const s = computeAxisStack([beam(1), washer(2, { qty: 3 }), beam(3)], { origin: 0 });
        expect(checkAxisFit(s).some(f => f.code === 'overlap')).toBe(false);
    });

    it('centered (sandwich) stacks measure pos from the un-centred pivot', () => {
        const s = computeAxisStack([washer(1, { pos: -0.03125 })], { origin: 1, centered: true, manual: true });
        expect(byId(s, 'washer1').start).toBeCloseTo(0.96875);
    });
});

describe('push-stacking (computePush)', () => {
    // beam [0,1.5] · washer2 [1.5,1.5625] · washer3 [1.5625,1.625] · bolt head outside on top
    const parts = () => [beam(1), washer(2), washer(3), bolt(4, 3, { flipAxis: true })];

    it('a bolt head moving inward carries the washers it reaches', () => {
        const s = computeAxisStack(parts(), { origin: 0 });
        const bodies = axisBodiesFromStack(s);
        const b = body(bodies, 'bolt4');
        // move the bolt 0.5 in inward (head underside from 1.625 to 1.125)
        const moved = computePush(bodies, 'bolt4', b.start - 0.5);
        expect(moved.get('washer3')).toBeCloseTo(1.125 - 0.0625);
        expect(moved.get('washer2')).toBeCloseTo(1.125 - 0.125);
        // beams are structure: never pushed
        expect(moved.has('beam1')).toBe(false);
    });

    it('does not pull pushed parts back and ignores parts behind the mover', () => {
        const s = computeAxisStack(parts(), { origin: 0 });
        const bodies = axisBodiesFromStack(s);
        const b = body(bodies, 'bolt4');
        const moved = computePush(bodies, 'bolt4', b.start + 1);
        expect([...moved.keys()]).toEqual(['bolt4']);
    });

    it('only pushes on contact: a gap is closed first', () => {
        const s = computeAxisStack([beam(1), washer(2), washer(3, { gapBefore: 1 })], { origin: 0 });
        const bodies = axisBodiesFromStack(s);
        const w2 = body(bodies, 'washer2');
        const small = computePush(bodies, 'washer2', w2.start + 0.5);
        expect(small.has('washer3')).toBe(false);
        const big = computePush(bodies, 'washer2', w2.start + 1.5);
        expect(big.get('washer3')).toBeCloseTo(w2.start + 1.5 + 0.0625);
    });

    it('push:false slides through without pushing', () => {
        const s = computeAxisStack(parts(), { origin: 0 });
        const bodies = axisBodiesFromStack(s);
        const moved = computePush(bodies, 'bolt4', body(bodies, 'bolt4').start - 0.5, { push: false });
        expect([...moved.keys()]).toEqual(['bolt4']);
    });

    it('parts already overlapping the mover at drag start are left alone', () => {
        const s = computeAxisStack([beam(1, { pos: 0 }), washer(2, { pos: 0.2 }), washer(3, { pos: 0.22 })], { origin: 0, manual: true });
        const bodies = axisBodiesFromStack(s);
        const moved = computePush(bodies, 'washer2', 1.0);
        expect(moved.has('washer3')).toBe(false);
    });

    it('inserts ride with a moved host, and a bolt head can push a bushing', () => {
        const s = computeAxisStack([washer(1), bushing(2), beam(3), bushing(4), bolt(5, 3, { flipAxis: true })], { origin: 0 });
        const bodies = axisBodiesFromStack(s);
        expect(body(bodies, 'bush2').hostId).toBe('washer1');
        const w = body(bodies, 'washer1');
        const withHost = computePush(bodies, 'washer1', w.start - 1, { push: false });
        expect(withHost.get('bush2')).toBeCloseTo(body(bodies, 'bush2').start - 1);
        // bush4 sits in the beam bore, flush with its outer face; the head presses it in
        const b = body(bodies, 'bolt5');
        const pushed = computePush(bodies, 'bolt5', b.start - 0.25);
        expect(pushed.get('bush4')).toBeCloseTo(body(bodies, 'bush4').start - 0.25);
        expect(pushed.has('beam3')).toBe(false);
    });
});

describe('snap', () => {
    it('snaps a washer to the middle of the gap between two beams', () => {
        const s = computeAxisStack([beam(1), beam(2, { gapBefore: 0.5 }), washer(3)], { origin: 0 });
        const bodies = axisBodiesFromStack(s);
        const w = body(bodies, 'washer3');
        const targets = collectSnapTargets(bodies, 'washer3');
        // gap is [1.5, 2.0]; washer centre at 1.75 → start 1.71875
        const snap = snapStart(w, 1.70, targets, 0.1);
        expect(snap.start).toBeCloseTo(1.71875);
        expect(snap.target.kind).toBe('gap');
    });

    it('prefers resting on a face over a coplanar alignment', () => {
        const s = computeAxisStack([beam(1), washer(2, { gapBefore: 2 })], { origin: 0 });
        const bodies = axisBodiesFromStack(s);
        const w = body(bodies, 'washer2');
        const snap = snapStart(w, 1.52, collectSnapTargets(bodies, 'washer2'), 0.1);
        expect(snap.start).toBeCloseTo(1.5);
        expect(snap.target.role).toBe('hi');
    });

    it('snaps a bolt head onto the outer beam face', () => {
        const s = computeAxisStack([beam(1), bolt(2, 3, { flipAxis: true, gapBefore: 0.4 })], { origin: 0 });
        const bodies = axisBodiesFromStack(s);
        const b = body(bodies, 'bolt2');
        const desired = b.start - 0.37; // head underside ≈ 1.53
        const snap = snapStart(b, desired, collectSnapTargets(bodies, 'bolt2'), 0.1);
        expect(snap.start + b.contact[0]).toBeCloseTo(1.5);
    });

    it('uses extra planes and gaps from the adapter (sandwich beams on a centre axis)', () => {
        const s = computeAxisStack([washer(1)], { origin: 0, centered: true });
        const bodies = axisBodiesFromStack(s);
        const w = body(bodies, 'washer1');
        const targets = collectSnapTargets(bodies, 'washer1', { gaps: [{ a: -0.5, b: 0.5 }] });
        const snap = snapStart(w, 0.46, targets, 0.1);
        expect(snap.start + w.len).toBeCloseTo(0.5);
    });

    it('returns the desired start when nothing is within the threshold', () => {
        const s = computeAxisStack([beam(1), washer(2, { gapBefore: 2 })], { origin: 0 });
        const bodies = axisBodiesFromStack(s);
        const snap = snapStart(body(bodies, 'washer2'), 2.7, collectSnapTargets(bodies, 'washer2'), 0.05);
        expect(snap.start).toBeCloseTo(2.7);
        expect(snap.target).toBeNull();
    });

    it('snaps back to the tight home position', () => {
        const s = computeAxisStack([beam(1), washer(2, { gapBefore: 2 })], { origin: 0 });
        const bodies = axisBodiesFromStack(s);
        const snap = snapStart(body(bodies, 'washer2'), 2.97, collectSnapTargets(bodies, 'washer2', { home: 3 }), 0.05);
        expect(snap.start).toBeCloseTo(3);
        expect(snap.target.kind).toBe('home');
    });
});

describe('seatPush (detent on beam faces)', () => {
    // beam [0,1.5] · lock [1.5,1.578] · bolt head outside seated on it
    const lockW = (seq, extra = {}) => ({ id: `lock${seq}`, type: 'lockWasher', seq, qty: 1, params: { id: 0.5, od: 0.9, thickness: 0.078 }, ...extra });
    const setup = () => {
        const s = computeAxisStack([beam(1), lockW(2), bolt(3, 3, { flipAxis: true })], { origin: 0 });
        const bodies = axisBodiesFromStack(s);
        return { bodies, targets: collectSnapTargets(bodies, 'bolt3'), b: body(bodies, 'bolt3') };
    };

    it('holds a pushed washer on the beam face within reach', () => {
        const { bodies, targets, b } = setup();
        const res = seatPush(bodies, 'bolt3', b.start - 0.2, targets, 0.3);
        expect(res.seat).not.toBeNull();
        expect(res.seat.kind).toBe('beam');
        expect(res.start).toBeCloseTo(b.start);
    });

    it('lets a harder push go through the beam face', () => {
        const { bodies, targets, b } = setup();
        const res = seatPush(bodies, 'bolt3', b.start - 0.5, targets, 0.3);
        expect(res.seat).toBeNull();
        expect(res.start).toBeCloseTo(b.start - 0.5);
    });

    it('seats a floating washer when the head pushes it onto the beam', () => {
        const s = computeAxisStack([beam(1), lockW(2, { gapBefore: 0.4 }), bolt(3, 3, { flipAxis: true })], { origin: 0 });
        const bodies = axisBodiesFromStack(s);
        const b = body(bodies, 'bolt3');
        const res = seatPush(bodies, 'bolt3', b.start - 0.45, collectSnapTargets(bodies, 'bolt3'), 0.3);
        // head travels 0.4 (closing the gap), washer rests on the beam at 1.5
        expect(res.start).toBeCloseTo(b.start - 0.4);
        const moved = computePush(bodies, 'bolt3', res.start);
        expect(moved.get('lock2')).toBeCloseTo(1.5);
    });
});
