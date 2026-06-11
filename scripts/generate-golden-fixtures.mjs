/**
 * Regenerate tests/fixtures/golden/*.json from configs/presets.json.
 * Usage: node scripts/generate-golden-fixtures.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestState } from '../tests/helpers/state-fixture.js';
import { extractSolverMetrics } from '../tests/helpers/solver-metrics.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const goldenDir = path.join(root, 'tests', 'fixtures', 'golden');

globalThis.state = createTestState();
globalThis.ibcStackLayoutCacheKey = '';
globalThis.resetSupportBeamsToDefaults = () => {};
globalThis.applyLegacyPanelsSupport = () => {};
globalThis.applySupportBeamsConfig = (cfg) => {
    Object.assign(globalThis.state.supportBeams, cfg);
};
globalThis.getOptimalClosedAngleForAnimation = () => 0;
globalThis.invalidateGeometryCache = () => {};
globalThis.threeRenderer = null;

await import('../js/linkage/constants.js');
await import('../js/linkage/math.js');
await import('../js/linkage/geometry-classes.js');
await import('../js/linkage/beam-bolt-helpers.js');
await import('../js/linkage/collision.js');
await import('../js/linkage/solver.js');
await import('../js/linkage/hardware-detail.js');
const { applyConfig } = await import('../js/linkage/config-persistence.js');
const { solveLinkage } = await import('../js/linkage/solver.js');

const presets = JSON.parse(
    fs.readFileSync(path.join(root, 'configs', 'presets.json'), 'utf8'),
);

fs.mkdirSync(goldenDir, { recursive: true });

for (const preset of presets) {
    const configPath = path.join(root, 'configs', preset.file);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    globalThis.state = createTestState();
    applyConfig(config, false);

    const data = solveLinkage(globalThis.state.foldAngle);
    const metrics = extractSolverMetrics(data, globalThis.state);
    const slug = preset.file.replace(/\.json$/i, '').replace(/[^\w.-]+/g, '-');

    const outPath = path.join(goldenDir, `${slug}.json`);
    fs.writeFileSync(outPath, `${JSON.stringify(metrics, null, 2)}\n`);
    console.log(`wrote ${path.relative(root, outPath)}`);
}
