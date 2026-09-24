import { describe, expect, it, beforeAll } from 'vitest';
import { createTestState } from './helpers/state-fixture.js';
import { solveLinkage } from '../js/linkage/solver.js';
import { collectParts } from '../js/linkage/part-keys.js';
import {
    addStep,
    autoFrameView,
    normalizeView,
    sequenceProgress,
    captureView,
    computeStepVisibility,
    createDefaultBuildSteps,
    createStep,
    duplicateStep,
    moveStep,
    normalizeBuildSteps,
    removeStep,
    serializeBuildStepsForConfig,
    shortestAngleDelta,
    stepSummary,
    totalDurationMs,
    tweenView,
    updateStep,
    groupSteps,
    ungroupSteps,
    groupOf,
    nextIndexAfter,
    normalizeGroups,
    representativeSteps,
    computeDisplacement,
    resolveParkOffset,
} from '../js/linkage/build-steps.js';

let getConfigSnapshot;
let applyV30Config;

beforeAll(async () => {
    globalThis.resetSupportBeamsToDefaults = () => {};
    globalThis.applyLegacyPanelsSupport = () => {};
    globalThis.applySupportBeamsConfig = (cfg) => { Object.assign(globalThis.state.supportBeams, cfg); };
    await import('../js/linkage/beam-bolt-helpers.js');
    await import('../js/linkage/hardware-detail.js');
    const mod = await import('../js/linkage/config-persistence.js');
    getConfigSnapshot = mod.getConfigSnapshot;
    applyV30Config = mod.applyV30Config;
});

describe('build-steps: model', () => {
    it('createStep fills kind defaults', () => {
        const cut = createStep('cut');
        expect(cut.stage).toBe('bench');
        expect(cut.op.kerfIn).toBeCloseTo(0.125);
        expect(cut.durationMs).toBe(3000);
        expect(cut.id).toMatch(/^step-/);
        const bogus = createStep('nonsense', { title: 'x', durationMs: -5, transitionMs: 'abc' });
        expect(bogus.kind).toBe('view');
        expect(bogus.durationMs).toBe(1500);
        expect(bogus.transitionMs).toBe(800);
    });

    it('list operations keep order and identity', () => {
        const bs = createDefaultBuildSteps();
        const a = addStep(bs, createStep('view', { title: 'A' }));
        const b = addStep(bs, createStep('place', { title: 'B' }));
        const c = addStep(bs, createStep('fasten', { title: 'C' }));
        expect(bs.steps.map(s => s.title)).toEqual(['A', 'B', 'C']);
        expect(moveStep(bs, 2, 0)).toBe(true);
        expect(bs.steps.map(s => s.title)).toEqual(['C', 'A', 'B']);
        expect(moveStep(bs, 0, 99)).toBe(true);
        expect(bs.steps.map(s => s.title)).toEqual(['A', 'B', 'C']);
        expect(moveStep(bs, 1, 1)).toBe(false);
        const dup = duplicateStep(bs, b.id);
        expect(bs.steps[2]).toBe(dup);
        expect(dup.id).not.toBe(b.id);
        expect(dup.title).toBe('B (copy)');
        expect(removeStep(bs, a.id)).toBe(a);
        expect(bs.steps.map(s => s.title)).toEqual(['B', 'B (copy)', 'C']);
        updateStep(bs, c.id, { title: 'C2', op: { turns: 5 } });
        expect(c.title).toBe('C2');
        expect(c.op.turns).toBe(5);
        expect(c.op.allModules).toBe(false); // untouched default survives
        updateStep(bs, c.id, { kind: 'cut' });
        expect(c.kind).toBe('cut');
        expect(c.stage).toBe('bench');
        expect(c.op.kerfIn).toBeCloseTo(0.125);
        expect(totalDurationMs(bs)).toBe(bs.steps.reduce((n, s) => n + s.durationMs + s.transitionMs, 0));
    });

    it('normalizeBuildSteps tolerates garbage and duplicate ids', () => {
        expect(normalizeBuildSteps(null).steps).toEqual([]);
        expect(normalizeBuildSteps('nope').steps).toEqual([]);
        const out = normalizeBuildSteps({ steps: [
            { id: 'x', kind: 'drill', title: 'D', targets: [{ kind: 'beam', stackType: 'vertical' }, null, 5] },
            { id: 'x', kind: 'view' },
            42,
            { kind: 'place', view: { yaw: '1.5', dist: -3 } },
        ] });
        expect(out.steps).toHaveLength(3);
        expect(out.steps[0].targets).toEqual([{ kind: 'beam', stackType: 'vertical' }]);
        expect(out.steps[1].id).not.toBe('x');
        expect(out.steps[2].view.yaw).toBeCloseTo(1.5);
        expect(out.steps[2].view.dist).toBe(1);
        expect(serializeBuildStepsForConfig(createDefaultBuildSteps())).toBeUndefined();
        expect(serializeBuildStepsForConfig(out).steps).toHaveLength(3);
        expect(stepSummary(out.steps[0])).toBe('Drill: V-beam · all modules');
    });
});

describe('build-steps: views', () => {
    it('captureView and tweenView take the shortest yaw arc', () => {
        const a = captureView({ yaw: 3.0, pitch: 0.1, dist: 500, panX: 0, panY: 0 }, Math.PI / 2);
        const b = captureView({ yaw: -3.0, pitch: 0.3, dist: 300, panX: 10, panY: 0 }, Math.PI);
        expect(a.foldAngleDeg).toBeCloseTo(90);
        expect(shortestAngleDelta(3.0, -3.0)).toBeCloseTo(2 * Math.PI - 6.0);
        const mid = tweenView(a, b, 0.5);
        // half way along the short arc goes through +pi, not through 0
        expect(Math.abs(mid.yaw)).toBeCloseTo(Math.PI, 5);
        expect(mid.pitch).toBeCloseTo(0.2);
        expect(mid.dist).toBeCloseTo(400);
        expect(mid.foldAngleDeg).toBeCloseTo(135);
        expect(tweenView(a, b, 0).yaw).toBeCloseTo(3.0);
        expect(tweenView(a, b, 1).dist).toBeCloseTo(300);
        // null fold on one side keeps the other
        const c = captureView({ yaw: 0, pitch: 0, dist: 100, panX: 0, panY: 0 }, null);
        expect(tweenView(a, c, 0.5).foldAngleDeg).toBeCloseTo(90);
    });

    it('normalizeView keeps the close-up frame mode and drops it otherwise', () => {
        const close = normalizeView({ yaw: 0.6, pitch: 0.4, dist: 120, foldAngleDeg: 40, frame: 'targets', radial: true, padding: 1.6 });
        expect(close.frame).toBe('targets');
        expect(close.radial).toBe(true);
        expect(close.padding).toBe(1.6);
        expect(close.foldAngleDeg).toBe(40);
        expect(close.detail).toBe(true);
        expect(normalizeView({ frame: 'targets', detail: false }).detail).toBe(false);
        const wide = normalizeView({ yaw: 0.6, pitch: 0.4, dist: 600, frame: 'bogus' });
        expect(wide.frame).toBeUndefined();
        const step = createStep('fasten', { view: { frame: 'targets', foldAngleDeg: 40 } });
        expect(step.view.frame).toBe('targets');
        expect(step.view.padding).toBe(1.6);
        expect(createStep("fasten", { view: { frame: "targets", padding: 1.35 } }).view.padding).toBe(1.35);
    });

    it('sequenceProgress runs items one after another with overlap', () => {
        expect(sequenceProgress(0.5, 0, 1)).toBe(0.5);
        expect(sequenceProgress(0, 0, 3)).toBe(0);
        expect(sequenceProgress(1, 2, 3)).toBeCloseTo(1);
        expect(sequenceProgress(0.5, 2, 3)).toBe(0);
        expect(sequenceProgress(0.5, 0, 3)).toBeCloseTo(1);
        const mid = sequenceProgress(0.5, 1, 3);
        expect(mid).toBeGreaterThan(0);
        expect(mid).toBeLessThan(1);
    });

    it('autoFrameView fits the bounding sphere', () => {
        const v = autoFrameView({ center: { x: 0, y: 0, z: 0 }, radius: 100 }, { fovDeg: 45, aspect: 1.5 });
        expect(v.dist).toBeGreaterThan(100 / Math.sin((45 * Math.PI) / 360));
        const wide = autoFrameView({ center: { x: 0, y: 0, z: 0 }, radius: 100 }, { fovDeg: 45, aspect: 0.5 });
        expect(wide.dist).toBeGreaterThan(v.dist);
        expect(autoFrameView(null).dist).toBeGreaterThan(12);
    });
});

describe('build-steps: visibility', () => {
    function solvedParts() {
        globalThis.state = createTestState({ showBolts: true, showBrackets: true, modules: 6, foldAngle: (100 * Math.PI) / 180 });
        return collectParts(solveLinkage(globalThis.state.foldAngle));
    }

    it('parts are future before their place step, done after, active during', () => {
        const parts = solvedParts();
        const steps = [
            createStep('view', { title: 'Overview' }),
            createStep('place', { targets: [{ kind: 'beam', stackType: 'horizontal-bottom', moduleIndex: 0 }] }),
            createStep('place', { targets: [{ kind: 'beam', stackType: 'vertical', moduleIndex: 0 }] }),
            createStep('fasten', { targets: [{ kind: 'joint', moduleIndex: 0, ring: 'bottom' }] }),
        ];
        const bottom0 = parts.find(p => p.kind === 'beam' && p.obj.stackType === 'horizontal-bottom' && p.obj.moduleIndex === 0);
        const vert0 = parts.find(p => p.kind === 'beam' && p.obj.stackType === 'vertical' && p.obj.moduleIndex === 0);
        const top3 = parts.find(p => p.kind === 'beam' && p.obj.stackType === 'horizontal-top' && p.obj.moduleIndex === 3);
        const bolt0 = parts.find(p => p.kind === 'bolt' && p.obj.moduleIndex === 0 && p.obj.ring === 'bottom');

        const at0 = computeStepVisibility(steps, 0, parts);
        expect(at0.introducedAny).toBe(true);
        expect(at0.status.get(bottom0.key)).toBe('future');
        expect(at0.status.get(vert0.key)).toBe('future');
        expect(at0.status.get(top3.key)).toBe('unreferenced');

        const at1 = computeStepVisibility(steps, 1, parts);
        expect(at1.status.get(bottom0.key)).toBe('active');
        expect(at1.status.get(vert0.key)).toBe('future');

        const at2 = computeStepVisibility(steps, 2, parts);
        expect(at2.status.get(bottom0.key)).toBe('done');
        expect(at2.status.get(vert0.key)).toBe('active');
        expect(at2.status.get(bolt0.key)).toBe('future');

        const at3 = computeStepVisibility(steps, 3, parts);
        expect(at3.status.get(bolt0.key)).toBe('active');
        expect(at3.activeKeys.size).toBeGreaterThan(0);
    });

    it('a guide with only view steps introduces nothing', () => {
        const parts = solvedParts();
        const res = computeStepVisibility([createStep('view')], 0, parts);
        expect(res.introducedAny).toBe(false);
        expect([...res.status.values()].every(v => v === 'unreferenced')).toBe(true);
    });
});

describe('build-steps: persistence', () => {
    it('round-trips through getConfigSnapshot and applyV30Config', () => {
        globalThis.state = createTestState({ buildSteps: createDefaultBuildSteps() });
        const bs = globalThis.state.buildSteps;
        addStep(bs, createStep('cut', { title: 'Cut H-beams', notes: 'Measure twice', targets: [{ kind: 'beam', stackType: 'horizontal-top' }], op: { stockLengthIn: 96 } }));
        addStep(bs, createStep('view', { title: 'Look', view: { yaw: 1, pitch: 0.2, dist: 400, foldAngleDeg: 120, anchor: { kind: 'beam', moduleIndex: 1 } } }));
        const snap = getConfigSnapshot();
        expect(snap.buildSteps.steps).toHaveLength(2);
        const json = JSON.parse(JSON.stringify(snap));

        globalThis.state = createTestState({ buildSteps: { version: 1, steps: [createStep('view', { title: 'stale' })] } });
        applyV30Config(json);
        expect(globalThis.state.buildSteps.steps.map(s => s.title)).toEqual(['Cut H-beams', 'Look']);
        expect(globalThis.state.buildSteps.steps[0].op.stockLengthIn).toBe(96);
        expect(globalThis.state.buildSteps.steps[0].notes).toBe('Measure twice');
        expect(globalThis.state.buildSteps.steps[1].view.anchor).toEqual({ kind: 'beam', moduleIndex: 1 });

        // A config without steps clears stale ones
        delete json.buildSteps;
        applyV30Config(json);
        expect(globalThis.state.buildSteps.steps).toEqual([]);
    });
});

describe('build-steps: groups and repeat modes', () => {
    function five() {
        const bs = createDefaultBuildSteps();
        ['A', 'B', 'C', 'D', 'E'].forEach(t => addStep(bs, createStep('place', { title: t })));
        return bs;
    }

    it('groups contiguous selections only', () => {
        const bs = five();
        const [a, b, c, d] = bs.steps;
        expect(groupSteps(bs, [c.id, b.id])).toBeTruthy();
        expect(groupOf(bs.steps, 1)).toMatchObject({ count: 2, isFirst: true, position: 0, first: 1, last: 2 });
        expect(groupOf(bs.steps, 2)).toMatchObject({ count: 2, isFirst: false, position: 1 });
        expect(groupOf(bs.steps, 0).groupId).toBeNull();
        expect(groupSteps(bs, [a.id, d.id])).toBeNull(); // not contiguous
        expect(groupSteps(bs, [a.id])).toBeNull();       // too small
        expect(ungroupSteps(bs, [c.id])).toBe(1);
        expect(bs.steps.every(s => !s.groupId)).toBe(true);
    });

    it('normalizes broken groups after moves and deletes', () => {
        const bs = five();
        groupSteps(bs, [bs.steps[1].id, bs.steps[2].id, bs.steps[3].id]);
        const gid = bs.steps[1].groupId;
        moveStep(bs, 2, 4); // pull the middle member out to the end
        expect(bs.steps.map(s => s.groupId)).toEqual([null, gid, gid, null, null]);
        removeStep(bs, bs.steps[1].id);
        expect(bs.steps.every(s => !s.groupId)).toBe(true); // singleton dissolved
        const raw = normalizeGroups([{ groupId: 'g' }, { groupId: null }, { groupId: 'g' }, { groupId: 'g' }]);
        expect(raw.map(s => s.groupId)).toEqual([null, null, 'g', 'g']);
    });

    it('nextIndexAfter skips a group from its first member in skip mode only', () => {
        const bs = five();
        groupSteps(bs, [bs.steps[1].id, bs.steps[2].id, bs.steps[3].id]);
        expect(nextIndexAfter(bs.steps, 0, 'skip')).toBe(1);
        expect(nextIndexAfter(bs.steps, 1, 'skip')).toBe(4);
        expect(nextIndexAfter(bs.steps, 2, 'skip')).toBe(3); // reached manually: advance normally
        expect(nextIndexAfter(bs.steps, 1, 'fast')).toBe(2);
        expect(nextIndexAfter(bs.steps, 4, 'skip')).toBe(-1);
        groupSteps(bs, [bs.steps[3].id, bs.steps[4].id]);
        expect(nextIndexAfter(bs.steps, 3, 'skip')).toBe(-1); // group runs to the end
        expect(representativeSteps(bs.steps).map(r => [r.index, r.count])).toEqual([[0, 1], [1, 2], [3, 2]]);
    });

    it('settings round-trip through normalize and serialize', () => {
        const bs = normalizeBuildSteps({ steps: [{ kind: 'view' }, { kind: 'view', groupId: 'x' }], settings: { repeatMode: 'fast', fastFactor: 6 } });
        expect(bs.settings).toEqual({ repeatMode: 'fast', fastFactor: 6 });
        expect(bs.steps[1].groupId).toBeNull(); // singleton group dissolved
        expect(normalizeBuildSteps({ steps: [], settings: { repeatMode: 'bogus', fastFactor: 0 } }).settings).toEqual({ repeatMode: 'skip', fastFactor: 4 });
        const ser = serializeBuildStepsForConfig(bs);
        expect(ser.settings.repeatMode).toBe('fast');
    });

    it('tracks parked displacement until a later place step re-seats the parts', () => {
        globalThis.state = createTestState({ showBolts: true, showBrackets: true, modules: 4, foldAngle: (100 * Math.PI) / 180 });
        const parts = collectParts(solveLinkage(globalThis.state.foldAngle));
        const park = { mode: 'beside', gapIn: 24 };
        const steps = [
            createStep('place', { targets: [{ kind: 'beam', stackType: 'horizontal-top' }], op: { parkOffset: park } }),
            createStep('fasten', { targets: [{ kind: 'joint', ring: 'top' }] }),
            createStep('place', { targets: [{ kind: 'beam', stackType: 'horizontal-top' }], op: { from: 'parked' } }),
        ];
        const top = parts.find(p => p.kind === 'beam' && p.obj.stackType === 'horizontal-top');
        const bottom = parts.find(p => p.kind === 'beam' && p.obj.stackType === 'horizontal-bottom');
        expect(computeDisplacement(steps, 0, parts).get(top.key)).toEqual(park);
        expect(computeDisplacement(steps, 1, parts).get(top.key)).toEqual(park);
        expect(computeDisplacement(steps, 2, parts).has(top.key)).toBe(false);
        expect(computeDisplacement(steps, 2, parts).has(bottom.key)).toBe(false);
        const vis = computeStepVisibility(steps, 2, parts);
        expect(vis.displacementBefore.get(top.key)).toEqual(park);
        expect(vis.displacement.has(top.key)).toBe(false);
        const off = resolveParkOffset(park, { min: { x: -100, y: 0, z: -100 }, max: { x: 100, y: 96, z: 100 } }, { min: { x: -90, y: 90, z: -90 }, max: { x: 90, y: 96, z: 90 } });
        expect(off.x).toBeCloseTo(100 - (-90) + 24);
        expect(off.y).toBeCloseTo(-90);
        expect(off.z).toBeCloseTo(0);
    });
});
