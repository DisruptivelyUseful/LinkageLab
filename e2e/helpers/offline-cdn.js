import fs from 'node:fs';
import path from 'node:path';

/**
 * Optional offline shim for the CDN libraries the linkage app loads at boot.
 *
 * When LINKAGE_E2E_CDN_DIR points at a directory that contains the pinned
 * npm packages (three@0.128.0, jspdf@2.5.1, jspdf-autotable@3.8.4 under
 * node_modules/), CDN requests are answered from those files and every other
 * third-party request is aborted. Without the variable this is a no-op, so CI
 * keeps using the real CDNs.
 */
export async function installOfflineCdn(page) {
    const dir = process.env.LINKAGE_E2E_CDN_DIR;
    if (!dir) return false;
    const lib = path.join(dir, 'node_modules');
    const map = {
        'three.js/r128/three.min.js': 'three/build/three.min.js',
        'examples/js/loaders/GLTFLoader.js': 'three/examples/js/loaders/GLTFLoader.js',
        'examples/js/exporters/GLTFExporter.js': 'three/examples/js/exporters/GLTFExporter.js',
        'examples/js/controls/OrbitControls.js': 'three/examples/js/controls/OrbitControls.js',
        'jspdf/2.5.1/jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js',
        'jspdf.plugin.autotable.min.js': 'jspdf-autotable/dist/jspdf.plugin.autotable.min.js',
    };
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, async (route) => {
        const url = route.request().url();
        const hit = Object.keys(map).find((k) => url.includes(k));
        if (!hit) return route.abort();
        const file = path.join(lib, map[hit]);
        if (!fs.existsSync(file)) return route.abort();
        return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(file, 'utf8') });
    });
    return true;
}
