// ============================================================================
// LINKAGE LAB — Joint kinematics (fold angle / ring closure math)
// Shared by solver and animation to avoid circular imports.
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { MIN_FOLD_ANGLE, MAX_FOLD_ANGLE, INCHES_PER_FOOT, MIN_SAFE_DIMENSION } from './constants.js';
import { degToRad } from './math.js';

/**
 * Calculates the joint positions for a scissor linkage at a given fold angle
 * @param {number} foldAngle - Fold angle in radians
 * @param {Object} params - Linkage parameters
 * @returns {Object} Joint positions and derived values
 */
export function calculateJointPositions(foldAngle, params) {
    const { hActiveIn, pivotPct, hobermanAng, pivotAng } = params;

    const safeH = Math.max(MIN_SAFE_DIMENSION, hActiveIn);
    const pivotRatio = pivotPct / 100;
    const activeLength = safeH * pivotRatio;
    const passiveLength = safeH * (1 - pivotRatio);
    const halfAngle = foldAngle / 2;
    const hobermanRad = degToRad(hobermanAng);
    const pivotOffsetRad = degToRad(pivotAng);

    const angle1Bottom = Math.PI - halfAngle;
    const angle1Top = -halfAngle + hobermanRad;
    const angle2Bottom = Math.PI + halfAngle + pivotOffsetRad;
    const angle2Top = halfAngle - hobermanRad + pivotOffsetRad;

    const joints = {
        bl: { x: activeLength * Math.cos(angle1Bottom), y: activeLength * Math.sin(angle1Bottom) },
        tr: { x: passiveLength * Math.cos(angle1Top), y: passiveLength * Math.sin(angle1Top) },
        br: { x: activeLength * Math.cos(angle2Bottom), y: activeLength * Math.sin(angle2Bottom) },
        tl: { x: passiveLength * Math.cos(angle2Top), y: passiveLength * Math.sin(angle2Top) },
    };

    const sourceAngle = Math.atan2(joints.tl.y - joints.bl.y, joints.tl.x - joints.bl.x);
    const targetAngle = Math.atan2(joints.tr.y - joints.br.y, joints.tr.x - joints.br.x);
    const relativeRotation = targetAngle - sourceAngle;

    return {
        joints,
        relativeRotation,
        activeLength,
        passiveLength,
    };
}

/**
 * Calculates the optimal closed angle (where ring completes 360°).
 * Cached on state.animation for performance during animation.
 * @returns {number} The optimal closed angle in radians
 */
export function getOptimalClosedAngleForAnimation() {
    if (state.animation.cachedClosedAngle !== undefined
        && state.animation.cachedModules === state.modules
        && state.animation.cachedPivotPct === state.pivotPct) {
        return state.animation.cachedClosedAngle;
    }

    const targetRotation = Math.PI * 2;
    const totalModules = state.modules;

    const getTotalRotation = (foldAngle) => {
        const jointResult = calculateJointPositions(foldAngle, {
            hActiveIn: state.hLengthFt * INCHES_PER_FOOT - state.offsetTopIn - state.offsetBotIn,
            pivotPct: state.pivotPct,
            hobermanAng: state.hobermanAng,
            pivotAng: state.pivotAng,
        });
        return Math.abs(jointResult.relativeRotation * totalModules);
    };

    const stepSize = degToRad(1);
    let bestAngle = MAX_FOLD_ANGLE;
    let bestDiff = Infinity;

    for (let angle = MIN_FOLD_ANGLE; angle <= MAX_FOLD_ANGLE; angle += stepSize) {
        const rotation = getTotalRotation(angle);
        const diff = Math.abs(rotation - targetRotation);

        if (diff < bestDiff) {
            bestDiff = diff;
            bestAngle = angle;
        }

        if (rotation > targetRotation && diff > bestDiff) {
            break;
        }
    }

    const fineStep = degToRad(0.1);
    for (let angle = bestAngle - degToRad(2); angle <= bestAngle + degToRad(2); angle += fineStep) {
        if (angle < MIN_FOLD_ANGLE || angle > MAX_FOLD_ANGLE) continue;
        const rotation = getTotalRotation(angle);
        const diff = Math.abs(rotation - targetRotation);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestAngle = angle;
        }
    }

    state.animation.cachedClosedAngle = bestAngle;
    state.animation.cachedModules = state.modules;
    state.animation.cachedPivotPct = state.pivotPct;

    return bestAngle;
}

/**
 * Maps a module-local plan point to world XZ (same math as the solver's mapTo3D).
 * Module-local `y` is world `z`.
 */
export function mapPlanToWorld(p, h, curPos, curRot) {
    const rx = p.x * Math.cos(curRot) - p.y * Math.sin(curRot);
    const rz = p.x * Math.sin(curRot) + p.y * Math.cos(curRot);
    return { x: curPos.x + rx, y: h, z: curPos.y + rz };
}

/**
 * Chains `modules` scissor modules at a fold angle (each module's inner-right pivot `br`
 * is the next module's inner-left pivot `bl`) and returns one frame per module.
 * Pure: everything comes from `params`, nothing from global state.
 * @param {number} foldAngle - radians
 * @param {{hActiveIn:number, pivotPct:number, hobermanAng:number, pivotAng:number, modules:number}} params
 * @returns {{joints:Object, relativeRotation:number, frames:Array}} frames[i] = { moduleIndex, curPos:{x,y}, curRot, bl,tr,br,tl: world XZ {x,z} }
 */
export function computeModuleFrames(foldAngle, params) {
    const jr = calculateJointPositions(foldAngle, params);
    const loc = jr.joints;
    const rel = jr.relativeRotation;
    const n = Math.max(0, params.modules | 0);
    const frames = [];
    let curPos = { x: 0, y: 0 };
    let curRot = 0;
    const world = (p) => { const w = mapPlanToWorld(p, 0, curPos, curRot); return { x: w.x, z: w.z }; };
    for (let i = 0; i < n; i++) {
        frames.push({
            moduleIndex: i,
            curPos: { x: curPos.x, y: curPos.y },
            curRot,
            bl: world(loc.bl), tr: world(loc.tr), br: world(loc.br), tl: world(loc.tl),
        });
        const nextRot = curRot + rel;
        const nextBlX = loc.bl.x * Math.cos(nextRot) - loc.bl.y * Math.sin(nextRot);
        const nextBlY = loc.bl.x * Math.sin(nextRot) + loc.bl.y * Math.cos(nextRot);
        const curBrX = loc.br.x * Math.cos(curRot) - loc.br.y * Math.sin(curRot);
        const curBrY = loc.br.x * Math.sin(curRot) + loc.br.y * Math.cos(curRot);
        curPos = { x: curPos.x + curBrX - nextBlX, y: curPos.y + curBrY - nextBlY };
        curRot = nextRot;
    }
    return { joints: loc, relativeRotation: rel, frames };
}

/**
 * Pivot points of every module at a fold angle, without running the full solver.
 * `br` is the inner pivot and `tr` the outer pivot of the bottom ring; the vertical X of
 * uprights runs botInner→topOuter (pattern A) and botOuter→topInner (pattern B).
 * @param {number} foldAngle - radians
 * @param {Object} params - computeModuleFrames params plus
 *   { vActiveIn, yMin, useFixedBeams?, fixedHeightIn? } (yMin = pivot height of the bottom ring)
 * @returns {{span:number, zHeight:number, yMin:number, yMax:number, modules:Array}}
 *   modules[i] = { moduleIndex, curPos, curRot, botInner, botOuter, topInner, topOuter, hCross, inDir, innerLeft, outerLeft }
 */
export function computeModulePivots(foldAngle, params) {
    const { frames, joints } = computeModuleFrames(foldAngle, params);
    const dx = joints.tr.x - joints.br.x, dy = joints.tr.y - joints.br.y;
    const span = Math.hypot(dx, dy);
    let zHeight = 0;
    if (params.useFixedBeams) {
        zHeight = params.fixedHeightIn || 0;
    } else {
        const safeV = Math.max(MIN_SAFE_DIMENSION, params.vActiveIn || 0);
        if (safeV > span) zHeight = Math.sqrt(safeV * safeV - span * span);
    }
    const yMin = params.yMin || 0;
    const yMax = yMin + zHeight;
    const modules = frames.map(f => {
        const at = (p, h) => ({ x: p.x, y: h, z: p.z });
        const botInner = at(f.br, yMin), botOuter = at(f.tr, yMin);
        const topInner = at(f.br, yMax), topOuter = at(f.tr, yMax);
        // Crossing of the two H beams in plan (bl→tr and br→tl); the module origin is the crossing
        const hCross = { x: f.curPos.x, y: 0, z: f.curPos.y };
        const dxw = botInner.x - botOuter.x, dzw = botInner.z - botOuter.z;
        const len = Math.hypot(dxw, dzw) || 1;
        return {
            moduleIndex: f.moduleIndex,
            curPos: f.curPos, curRot: f.curRot,
            botInner, botOuter, topInner, topOuter, hCross,
            innerLeft: at(f.bl, yMin), outerLeft: at(f.tl, yMin),
            inDir: { x: dxw / len, z: dzw / len }, // plan direction from the outer pivot toward the inner pivot
        };
    });
    return { span, zHeight, yMin, yMax, modules };
}

bridgeGlobals({
    calculateJointPositions,
    getOptimalClosedAngleForAnimation,
    computeModuleFrames,
    computeModulePivots,
    mapPlanToWorld,
}, 'jointKinematics');
