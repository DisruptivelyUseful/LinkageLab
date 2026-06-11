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

bridgeGlobals({
    calculateJointPositions,
    getOptimalClosedAngleForAnimation,
}, 'jointKinematics');
