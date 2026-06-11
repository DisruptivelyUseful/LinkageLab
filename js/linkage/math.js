// ============================================================================
// LINKAGE LAB — Math & general utilities
// ============================================================================

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function degToRad(degrees) {
    return degrees * Math.PI / 180;
}

function radToDeg(radians) {
    return radians * 180 / Math.PI;
}

function formatNumber(value, decimals = 1) {
    return value.toFixed(decimals);
}

function debounce(func, delay) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
}

function sanitize(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

const v3 = (x, y, z) => ({ x, y, z });
const vAdd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const vSub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const vScale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const vMag = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
const vNorm = (a) => {
    const m = vMag(a);
    return m === 0 ? { x: 0, y: 0, z: 0 } : vScale(a, 1 / m);
};
const vCross = (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
});
const vDot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

window.LinkageModules = window.LinkageModules || {};
window.LinkageModules.math = {
    clamp,
    degToRad,
    radToDeg,
    formatNumber,
    debounce,
    sanitize,
    v3,
    vAdd,
    vSub,
    vScale,
    vMag,
    vNorm,
    vCross,
    vDot
};
