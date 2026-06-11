import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeAll } from 'vitest';
import { createTestState } from './helpers/state-fixture.js';
import { extractSolverMetrics } from './helpers/solver-metrics.js';
import { solveLinkage } from '../js/linkage/solver.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const presets = JSON.parse(
    fs.readFileSync(path.join(root, 'configs', 'presets.json'), 'utf8'),
);

let applyConfig;

beforeAll(async () => {
    globalThis.resetSupportBeamsToDefaults = () => {};
    globalThis.applyLegacyPanelsSupport = () => {};
    globalThis.applySupportBeamsConfig = (cfg) => {
        Object.assign(globalThis.state.supportBeams, cfg);
    };
    globalThis.getOptimalClosedAngleForAnimation = () => 0;
    globalThis.invalidateGeometryCache = () => {};
    globalThis.threeRenderer = null;

    await import('../js/linkage/beam-bolt-helpers.js');
    await import('../js/linkage/hardware-detail.js');
    ({ applyConfig } = await import('../js/linkage/config-persistence.js'));
});

describe('config golden files', () => {
    it.each(presets)('solver metrics match golden snapshot for $name', async (preset) => {
        const configPath = path.join(root, 'configs', preset.file);
        const goldenPath = path.join(
            root,
            'tests',
            'fixtures',
            'golden',
            `${preset.file.replace(/\.json$/i, '').replace(/[^\w.-]+/g, '-')}.json`,
        );

        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const expected = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));

        globalThis.state = createTestState();
        applyConfig(config, false);

        const actual = extractSolverMetrics(
            solveLinkage(globalThis.state.foldAngle),
            globalThis.state,
        );

        expect(actual).toEqual(expected);
    });
});
