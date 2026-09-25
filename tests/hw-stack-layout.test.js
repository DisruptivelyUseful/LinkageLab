import { describe, expect, it, beforeAll } from 'vitest';
import { createTestState } from './helpers/state-fixture.js';
import {
    HW_KIND,
    classifyPart,
    partAxialLength,
    computeAxisStack,
    checkAxisFit,
    explodeAxisStack,
    stackGripLength,
} from '../js/linkage/hw-stack-layout.js';

const beam = (seq, extra = {}) => ({ id: `beam${seq}`, type: 'beam', seq, qty: 1, params: { width: 3.5, thickness: 1.5, holeDiameter: 0.5 }, ...extra });
const washer = (seq, extra = {}) => ({ id: `washer${seq}`, type: 'washer', seq, qty: 1, params: { id: 0.5, od: 1.25, thickness: 0.0625 }, ...extra });
const lock = (seq, extra = {}) => ({ id: `lock${seq}`, type: 'lockWasher', seq, qty: 1, params: { id: 0.5, od: 0.9, thickness: 0.1 }, ...extra });
const hexNut = (seq, extra = {}) => ({ id: `nut${seq}`, type: 'nut', seq, qty: 1, params: { id: 0.5, height: 0.4375, style: 'hex', thread: '1/2-13' }, ...extra });
const bolt = (seq, length, extra = {}) => ({ id: `bolt${seq}`, type: 'bolt', seq, qty: 1, params: { diameter: 0.5, length, threadLength: length, headHeight: 0.3, headDia: 0.75 }, ...extra });
const bushing = (seq, extra = {}) => ({ id: `bush${seq}`, type: 'bushing', seq, qty: 1, params: { id: 0.5, od: 0.625, length: 1.25 }, ...extra });

const byId = (stack, id, copy = 0) => stack.items.find(it => it.part.id === id && it.copyIndex === copy);

function assertNoOverlaps(stack) {
    const solid = stack.items.filter(it => it.kind === HW_KIND.MEMBER || it.kind === HW_KIND.NUT).sort((a, b) => a.start - b.start);
    for (let i = 1; i < solid.length; i++) {
        expect(solid[i].start, `${solid[i].part.id} overlaps ${solid[i - 1].part.id}`).toBeGreaterThanOrEqual(solid[i - 1].end - 1e-9);
    }
}

describe('hw-stack-layout: seated stacking', () => {
    it('lays members flush from the datum in seq order with no hidden gaps', () => {
        const s = computeAxisStack([washer(2), beam(1), lock(3)], { origin: 2 });
        expect(byId(s, 'beam1').start).toBeCloseTo(2);
        expect(byId(s, 'washer2').start).toBeCloseTo(3.5);
        expect(byId(s, 'lock3').start).toBeCloseTo(3.5625);
        expect(s.end).toBeCloseTo(3.6625);
        expect(s.span).toBeCloseTo(1.6625);
        assertNoOverlaps(s);
    });

    it('gapBefore pushes every part after it', () => {
        const s = computeAxisStack([beam(1), washer(2, { gapBefore: 0.25 }), lock(3)]);
        expect(byId(s, 'washer2').start).toBeCloseTo(1.75);
        expect(byId(s, 'lock3').start).toBeCloseTo(1.8125);
        expect(byId(s, 'washer2').gapBefore).toBeCloseTo(0.25);
    });

    it('ignores negative gaps and legacy posAssembled', () => {
        const s = computeAxisStack([beam(1), washer(2, { gapBefore: -3, posAssembled: -5.5 })]);
        expect(byId(s, 'washer2').start).toBeCloseTo(1.5);
    });

    it('stacks qty copies flush', () => {
        const s = computeAxisStack([beam(1), washer(2, { qty: 3 }), lock(3)]);
        expect(byId(s, 'washer2', 0).start).toBeCloseTo(1.5);
        expect(byId(s, 'washer2', 2).start).toBeCloseTo(1.625);
        expect(byId(s, 'lock3').start).toBeCloseTo(1.6875);
        expect(byId(s, 'washer2', 2).rank).toBe(3);
        assertNoOverlaps(s);
    });

    it('seats an inside-head bolt on the datum wall with the shank through the members', () => {
        const s = computeAxisStack([bolt(0, 3), beam(1), washer(2), hexNut(3)], { datumWall: 0.12 });
        expect(s.bolt.headOutside).toBe(false);
        expect(s.bolt.headEnd).toBeCloseTo(-0.12);
        expect(s.bolt.headStart).toBeCloseTo(-0.42);
        expect(s.bolt.shankStart).toBeCloseTo(-0.12);
        expect(s.bolt.shankEnd).toBeCloseTo(2.88);
        // bolt consumed no stack thickness
        expect(byId(s, 'beam1').start).toBeCloseTo(0);
        expect(byId(s, 'nut3').start).toBeCloseTo(1.5625);
        expect(stackGripLength(s)).toBeCloseTo(0.12 + 1.5 + 0.0625 + 0.4375);
    });

    it('seats an outside-head bolt on the outermost face with the shank back through the stack', () => {
        const s = computeAxisStack([beam(1), lock(2), bolt(3, 2.36, { flipAxis: true })], { datumWall: 0.12 });
        expect(s.bolt.headOutside).toBe(true);
        expect(s.bolt.headStart).toBeCloseTo(1.6);
        expect(s.bolt.headEnd).toBeCloseTo(1.9);
        expect(s.bolt.shankEnd).toBeCloseTo(1.6);
        expect(s.bolt.shankStart).toBeCloseTo(1.6 - 2.36);
    });

    it('an outside-head bolt ignores its list position: it always seats on the last member', () => {
        const s = computeAxisStack([beam(1), bolt(2, 2.36, { flipAxis: true }), lock(3)], { datumWall: 0.12 });
        expect(s.bolt.headStart).toBeCloseTo(1.6);
        assertNoOverlaps(s);
        const ex = explodeAxisStack(s, 1);
        const b = s.items.find(it => it.kind === HW_KIND.BOLT);
        // exploded head (at the bolt's far end) clears the exploded lock washer
        const headStart = ex.get(b) + b.len - s.bolt.headH;
        expect(headStart).toBeGreaterThan(ex.get(byId(s, 'lock3')) + byId(s, 'lock3').len);
    });

    it('puts a bushing inside the preceding beam bore, flush with its outer face, adding no thickness', () => {
        const s = computeAxisStack([beam(1), bushing(2), lock(3)]);
        const b = byId(s, 'bush2');
        expect(b.kind).toBe(HW_KIND.INSERT);
        expect(b.end).toBeCloseTo(1.5);
        expect(b.start).toBeCloseTo(0.25);
        expect(byId(s, 'lock3').start).toBeCloseTo(1.5);
    });

    it('adds only the flange of a rivet nut to the stack', () => {
        const rivet = { id: 'rn', type: 'nut', seq: 2, params: { id: 0.5, od: 0.67, length: 0.5, flangeOd: 0.71, flangeThickness: 0.04, style: 'rivet' } };
        const s = computeAxisStack([beam(1), rivet, washer(3)]);
        const rn = byId(s, 'rn');
        expect(rn.kind).toBe(HW_KIND.INSERT);
        expect(rn.start).toBeCloseTo(1.0);
        expect(rn.end).toBeCloseTo(1.54);
        expect(byId(s, 'washer3').start).toBeCloseTo(1.54);
    });

    it('centres a sandwich stack on the origin', () => {
        const s = computeAxisStack([washer(1, { qty: 2 })], { origin: 1.885, centered: true });
        expect(s.start).toBeCloseTo(1.885 - 0.0625);
        expect(s.end).toBeCloseTo(1.885 + 0.0625);
        expect(s.span).toBeCloseTo(0.125);
    });

    it('lays a second bolt out as a spacer and warns', () => {
        const s = computeAxisStack([bolt(0, 2), beam(1), bolt(2, 2)]);
        expect(s.items.filter(it => it.kind === HW_KIND.BOLT)).toHaveLength(1);
        expect(s.fit.some(f => f.code === 'extra-bolt')).toBe(true);
    });
});

describe('hw-stack-layout: explode', () => {
    it('preserves order with a uniform gap per rank and withdraws the bolt on its head side', () => {
        const s = computeAxisStack([bolt(0, 3), beam(1), washer(2, { qty: 2 }), hexNut(3)]);
        const ex = explodeAxisStack(s, 1);
        expect(ex.get(byId(s, 'beam1'))).toBeCloseTo(0);
        expect(ex.get(byId(s, 'washer2', 0))).toBeCloseTo(1.5 + 1);
        expect(ex.get(byId(s, 'washer2', 1))).toBeCloseTo(1.5625 + 2);
        expect(ex.get(byId(s, 'nut3'))).toBeCloseTo(1.625 + 3);
        const b = s.items.find(it => it.kind === HW_KIND.BOLT);
        expect(ex.get(b)).toBeCloseTo(b.start - 1);
        // gaps between consecutive exploded solids are all >= gap
        const solids = s.items.filter(it => it.kind !== HW_KIND.BOLT).sort((a, c) => a.rank - c.rank);
        for (let i = 1; i < solids.length; i++) {
            expect(ex.get(solids[i]) - (ex.get(solids[i - 1]) + solids[i - 1].len)).toBeCloseTo(1);
        }
    });

    it('moves an outside-head bolt past the last rank', () => {
        const s = computeAxisStack([beam(1), lock(2), bolt(3, 2, { flipAxis: true })]);
        const ex = explodeAxisStack(s, 0.5);
        const b = s.items.find(it => it.kind === HW_KIND.BOLT);
        expect(ex.get(b)).toBeCloseTo(b.start + 0.5 * (s.lastRank + 1));
    });
});

describe('hw-stack-layout: fit check', () => {
    it('flags a bolt that is too short to reach through the nut', () => {
        const s = computeAxisStack([bolt(0, 1.5), beam(1), washer(2), hexNut(3)]);
        const short = s.fit.find(f => f.code === 'bolt-short');
        expect(short).toBeTruthy();
        // required = 1.5 + 0.0625 + 0.4375 + 2 threads (2/13) = 2.1538 → short by ~0.65
        expect(short.value).toBeCloseTo(2.1538 - 1.5, 2);
    });

    it('passes a correctly sized bolt and reports long protrusion as info only', () => {
        const ok = computeAxisStack([bolt(0, 2.25), beam(1), washer(2), hexNut(3)]);
        expect(ok.fit.filter(f => f.level === 'warn')).toEqual([]);
        const long = computeAxisStack([bolt(0, 4), beam(1), washer(2), hexNut(3)]);
        expect(long.fit.find(f => f.code === 'bolt-long').level).toBe('info');
    });

    it('flags a washer whose hole is smaller than the bolt', () => {
        const small = washer(2, { params: { id: 0.3125, od: 1, thickness: 0.0625 } });
        const s = computeAxisStack([bolt(0, 3), beam(1), small, hexNut(3)]);
        const f = s.fit.find(x => x.code === 'hole-small');
        expect(f).toBeTruthy();
        expect(f.partId).toBe('washer2');
    });

    it('flags threads that do not reach the nut', () => {
        const b = bolt(0, 3, { params: { diameter: 0.5, length: 3, threadLength: 0.25, headHeight: 0.3 } });
        const s = computeAxisStack([b, beam(1), hexNut(2)]);
        expect(s.fit.some(f => f.code === 'thread-short')).toBe(true);
    });

    it('checkAxisFit is idempotent on a stack', () => {
        const s = computeAxisStack([bolt(0, 3), beam(1), hexNut(2)]);
        expect(checkAxisFit(s)).toEqual(s.fit);
    });
});

describe('hw-stack-layout: part lengths', () => {
    it('reconciles the mesh minimums', () => {
        expect(partAxialLength({ type: 'lockWasher', params: { thickness: 0.001 } })).toBeCloseTo(0.02);
        expect(partAxialLength({ type: 'nut', params: { height: 0.001 } })).toBeCloseTo(0.05);
        expect(partAxialLength({ type: 'nut', params: { style: 'rivet', length: 0.5, height: 9, flangeOd: 1, flangeThickness: 0.04 } })).toBeCloseTo(0.54);
        expect(partAxialLength({ type: 'bolt', params: { length: 2, headHeight: 0.3 } })).toBeCloseTo(2.3);
        expect(classifyPart({ type: 'bushing' })).toBe(HW_KIND.INSERT);
        expect(classifyPart({ type: 'nut', params: { style: 'hex' } })).toBe(HW_KIND.NUT);
    });
});

describe('hw-stack-layout: default assemblies', () => {
    let getDefaults;
    beforeAll(async () => {
        globalThis.state = createTestState();
        globalThis.invalidateGeometryCache = () => {};
        globalThis.threeRenderer = null;
        await import('../js/linkage/beam-bolt-helpers.js');
        const hw = await import('../js/linkage/hardware-detail.js');
        getDefaults = hw.getDefaultHardwareAssemblies || globalThis.getDefaultHardwareAssemblies;
    });

    it('every default axis lays out without overlaps', () => {
        const defaults = getDefaults();
        Object.values(defaults.assemblies).forEach(asm => {
            const axes = new Set(asm.parts.filter(p => p.type !== 'bracket').map(p => p.axis || 'right'));
            axes.forEach(axis => {
                const parts = asm.parts.filter(p => (p.axis || 'right') === axis);
                const s = computeAxisStack(parts, { centered: axis === 'center', datumWall: 0.12 });
                assertNoOverlaps(s);
                expect(s.fit.filter(f => f.code === 'hole-small' || f.code === 'extra-bolt'), `${asm.id}/${axis}`).toEqual([]);
            });
        });
    });
});
