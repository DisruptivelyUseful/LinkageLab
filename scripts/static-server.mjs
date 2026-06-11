/**
 * Minimal static file server for local dev and Playwright e2e tests.
 * Usage: node scripts/static-server.mjs [--port 8765]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portArg = process.argv.find((arg, i) => process.argv[i - 1] === '--port');
const port = Number(portArg || process.env.PORT || 8765);

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.glb': 'model/gltf-binary',
    '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${port}`).pathname);
    if (urlPath === '/') urlPath = '/index.html';

    const filePath = path.normalize(path.join(root, urlPath.replace(/^\/+/, '')));
    if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('404 - File Not Found');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        res.end(data);
    });
});

server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`Static server: http://127.0.0.1:${port}/\n`);
});
