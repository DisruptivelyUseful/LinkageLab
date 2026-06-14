import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const content = execSync('git show HEAD:solar_simulator.html', { cwd: root, encoding: 'utf8' });
const lines = content.split(/\r?\n/);
const pick = (start, end) => lines.slice(start, end + 1);
const out = [
    ...pick(203, 1223),
    ...pick(1225, 1312),
    ...pick(1323, 1355),
].join('\n') + '\n';

const dest = path.join(root, 'partials', 'simulator-workspace.html');
fs.writeFileSync(dest, out, 'utf8');

const icon = out.match(/library-category-icon">([^<]+)</)?.[1] ?? '(missing)';
const toggle = out.match(/library-category-toggle">([^<]+)</)?.[1] ?? '(missing)';
console.log(`Wrote ${dest}`);
console.log(`Sample icon: ${icon}`);
console.log(`Sample toggle: ${toggle}`);
