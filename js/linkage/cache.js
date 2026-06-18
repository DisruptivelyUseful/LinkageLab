// ============================================================================
// LINKAGE LAB â€” Geometry & collision caches (ES module)
// Depends on global: state, solveLinkage, detectCollisions
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { solveLinkage } from './solver.js';
import { detectCollisions } from './collision.js';

let cachedLinkageData = null;
let cachedFoldAngle = null;
let cachedCollisions = null;
let cachedCollisionFoldAngle = null;
let cachedGeometryHash = null;

globalThis.threeRendererMeshStructureKey = null;
globalThis.threeRendererMeshCounts = null;

function clearMeshStructureCache() {
    globalThis.threeRendererMeshStructureKey = null;
    globalThis.threeRendererMeshCounts = null;
}

function applyCollisionDetection(data) {
    if (!state.enforceCollision) {
        state.collisions = [];
        state.hasCollision = false;
        cachedCollisions = null;
        cachedCollisionFoldAngle = null;
        return;
    }
    if (cachedCollisions !== null && cachedCollisionFoldAngle === state.foldAngle) {
        state.collisions = cachedCollisions;
    } else {
        state.collisions = detectCollisions(data);
        cachedCollisions = state.collisions;
        cachedCollisionFoldAngle = state.foldAngle;
    }
    state.hasCollision = state.collisions.length > 0;
}

function computeGeometryHash() {
    const params = [
        state.modules,
        state.hLengthFt,
        state.vLengthFt,
        state.pivotPct,
        state.hobermanAng,
        state.pivotAng,
        state.hStackCount,
        state.vStackCount,
        state.vStackReverse,
        state.offsetTopIn,
        state.offsetBotIn,
        state.vertEndOffset,
        state.bracketHeight,
        state.hStackGap,
        state.vStackGap,
        state.hBeamW,
        state.hBeamT,
        state.vBeamW,
        state.vBeamT,
        state.vBeamDimensionsLinked,
        state.vBeamInnerW,
        state.vBeamInnerT,
        state.vBeamOuterW,
        state.vBeamOuterT,
        state.showBrackets,
        state.showBolts,
        state.showHardwareFullDetail,
        state.showHardwareFullDetail && typeof globalThis.serializeHardwareAssembliesForConfig === 'function'
            ? JSON.stringify(globalThis.serializeHardwareAssembliesForConfig())
            : '',
        state.foldAngle.toFixed(6),
        state.orientation
    ];
    return params.join('|');
}

function isGeometryCacheValid() {
    if (!cachedLinkageData || !cachedGeometryHash) return false;
    return cachedGeometryHash === computeGeometryHash();
}

function invalidateGeometryCache() {
    cachedLinkageData = null;
    cachedGeometryHash = null;
    cachedCollisions = null;
    cachedCollisionFoldAngle = null;
    clearMeshStructureCache();
    state._deployedRingCenter = null;
}

function invalidateRcpCrossings() {
    if (!state.supportBeams) return;
    state.supportBeams.rcpCrossings = null;
    state.supportBeams.rcpFinalTopology = null;
    state.supportBeams.rcpHoleTsByBeam = null;
    state.supportBeams.rcpDiagnostics = null;
    state.supportBeams._lastPhi = null;
}

function invalidateHardwareCache() {
    invalidateGeometryCache();
    if (typeof invalidateMeshCaches === 'function') {
        invalidateMeshCaches();
    }
}

function getLinkageData() {
    if (isGeometryCacheValid()) {
        return cachedLinkageData;
    }

    cachedLinkageData = solveLinkage(state.foldAngle);
    cachedGeometryHash = computeGeometryHash();
    cachedFoldAngle = state.foldAngle;

    cachedCollisions = null;
    cachedCollisionFoldAngle = null;

    return cachedLinkageData;
}

function getCachedGeometryHash() {
    return cachedGeometryHash;
}

const cacheExports = {
    applyCollisionDetection,
    computeGeometryHash,
    isGeometryCacheValid,
    invalidateGeometryCache,
    invalidateRcpCrossings,
    invalidateHardwareCache,
    getLinkageData,
    clearMeshStructureCache,
    getCachedGeometryHash
};

bridgeGlobals(cacheExports, 'cache');

export {
    applyCollisionDetection,
    computeGeometryHash,
    isGeometryCacheValid,
    invalidateGeometryCache,
    invalidateRcpCrossings,
    invalidateHardwareCache,
    getLinkageData,
    clearMeshStructureCache,
    getCachedGeometryHash
};
