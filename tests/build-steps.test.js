import { describe, expect, it, beforeAll } from 'vitest';
import { createTestState } from './helpers/state-fixture.js';
import { solveLinkage } from '../js/linkage/solver.js';
import { collectParts } from '../js/linkage/part-keys.js';
import {
    addStep,
    autoFrameView,
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
