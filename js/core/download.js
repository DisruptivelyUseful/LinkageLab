// ============================================================================
// LINKAGE LAB — Browser download helpers (shared by exporters)
// ============================================================================

import { bridgeGlobals } from '../linkage/global-bridge.js';

/** Trigger a browser download of a Blob. */
export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 250);
}

/** Trigger a browser download of a text file. */
export function downloadText(text, filename, mime = 'text/plain;charset=utf-8') {
    downloadBlob(new Blob([text], { type: mime }), filename);
}

/** Download several text files one after another (browsers throttle back-to-back downloads). */
export function downloadTextSequence(files, delayMs = 250) {
    files.forEach((f, i) => setTimeout(() => downloadText(f.text, f.filename, f.mime), i * delayMs));
}

/** File-name safe slug. */
export function safeFilename(s) {
    return String(s || '').replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'file';
}

bridgeGlobals({ downloadBlob, downloadText, downloadTextSequence, safeFilename }, 'download');
