// ============================================================================
// LINKAGE LAB — Linkage solver (ES module)
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';

// ============================================================================
// LINKAGE SOLVER
// ============================================================================

/**
 * Calculates the joint positions for a scissor linkage at a given fold angle
 * @param {number} foldAngle - Fold angle in radians
 * @param {Object} params - Linkage parameters
 * @returns {Object} Joint positions and derived values
 */
function calculateJointPositions(foldAngle, params) {
    const { hActiveIn, pivotPct, hobermanAng, pivotAng } = params;
    
    const safeH = Math.max(MIN_SAFE_DIMENSION, hActiveIn);
    const pivotRatio = pivotPct / 100;
    const activeLength = safeH * pivotRatio;
    const passiveLength = safeH * (1 - pivotRatio);
    const halfAngle = foldAngle / 2;
    const hobermanRad = degToRad(hobermanAng);
    const pivotOffsetRad = degToRad(pivotAng);
    
    // Calculate angles for linkage joint positions
    const angle1Bottom = Math.PI - halfAngle;
    const angle1Top = -halfAngle + hobermanRad;
    const angle2Bottom = Math.PI + halfAngle + pivotOffsetRad;
    const angle2Top = halfAngle - hobermanRad + pivotOffsetRad;

    // Calculate joint locations in 2D plane
    const joints = {
        bl: {x: activeLength * Math.cos(angle1Bottom), y: activeLength * Math.sin(angle1Bottom)},
        tr: {x: passiveLength * Math.cos(angle1Top), y: passiveLength * Math.sin(angle1Top)},
        br: {x: activeLength * Math.cos(angle2Bottom), y: activeLength * Math.sin(angle2Bottom)},
        tl: {x: passiveLength * Math.cos(angle2Top), y: passiveLength * Math.sin(angle2Top)},
    };

    // Calculate relative rotation between modules
    const sourceAngle = Math.atan2(joints.tl.y - joints.bl.y, joints.tl.x - joints.bl.x);
    const targetAngle = Math.atan2(joints.tr.y - joints.br.y, joints.tr.x - joints.br.x);
    const relativeRotation = targetAngle - sourceAngle;

    return {
        joints,
        relativeRotation,
        activeLength,
        passiveLength
    };
}

/**
 * Calculates the distance between inner and outer horizontal pivots at a given fold angle
 * This is the radial span - the distance a linear actuator between these pivots would need to travel
 * @param {number} foldAngle - The fold angle in radians
 * @returns {number} Distance in inches between inner (br) and outer (tr) pivots
 */
function calculatePivotSpan(foldAngle) {
    const hTotIn = state.hLengthFt * INCHES_PER_FOOT;
    const hActiveIn = hTotIn - state.offsetTopIn - state.offsetBotIn;
    
    const jointResult = calculateJointPositions(foldAngle, {
        hActiveIn,
        pivotPct: state.pivotPct,
        hobermanAng: state.hobermanAng,
        pivotAng: state.pivotAng
    });
    
    const loc = jointResult.joints;
    
    // Calculate distance between inner pivot (br) and outer pivot (tr)
    // These are the pivots where the vertical beams connect to the horizontal ring
    const dx = loc.tr.x - loc.br.x;
    const dy = loc.tr.y - loc.br.y;
    const pivotSpan = Math.sqrt(dx * dx + dy * dy);
    
    return pivotSpan;
}

/**
 * Computes the fold angle at which adjacent modules' outer V-beam tips (loc.tr) are
 * separated by exactly one outer V-beam width in the horizontal plane. This is the
 * physical "can't fold further" limit for the outer V-legs.
 *
 * Returns the minimum angle in radians, or MIN_FOLD_ANGLE if geometry can't be computed.
 */
function computeMinFoldAngleVBeamOverlap() {
    const totalModules = state.modules;
    if (!totalModules || totalModules < 2) return MIN_FOLD_ANGLE;

    const hActiveIn = state.hLengthFt * INCHES_PER_FOOT - state.offsetTopIn - state.offsetBotIn;
    // Outer V-beam width is the larger of width/thickness in the tangential direction
    const outerW = Math.max(state.vBeamOuterW || state.vBeamW || 1.5,
                            state.vBeamOuterT || state.vBeamT || 3.5);

    // Compute world-space positions of each module's outer pivot (tr) at a given fold angle.
    const trPositions = (foldAngle) => {
        const jr = calculateJointPositions(foldAngle, {
            hActiveIn,
            pivotPct: state.pivotPct,
            hobermanAng: state.hobermanAng,
            pivotAng: state.pivotAng
        });
        const loc = jr.joints;
        const rel = jr.relativeRotation;
        const pts = [];
        let curRot = 0;
        let curPos = { x: 0, y: 0 };
        for (let i = 0; i < totalModules; i++) {
            const rx = loc.tr.x * Math.cos(curRot) - loc.tr.y * Math.sin(curRot);
            const rz = loc.tr.x * Math.sin(curRot) + loc.tr.y * Math.cos(curRot);
            pts.push({ x: curPos.x + rx, z: curPos.y + rz });
            const nextRot = curRot + rel;
            const nextBlX = loc.bl.x * Math.cos(nextRot) - loc.bl.y * Math.sin(nextRot);
            const nextBlY = loc.bl.x * Math.sin(nextRot) + loc.bl.y * Math.cos(nextRot);
            const curBrX = loc.br.x * Math.cos(curRot) - loc.br.y * Math.sin(curRot);
            const curBrY = loc.br.x * Math.sin(curRot) + loc.br.y * Math.cos(curRot);
            curPos = { x: curPos.x + curBrX - nextBlX, y: curPos.y + curBrY - nextBlY };
            curRot = nextRot;
        }
        return pts;
    };

    // Minimum gap between any pair of adjacent module tr points across the full ring.
    const minAdjacentGap = (foldAngle) => {
        let pts;
        try { pts = trPositions(foldAngle); } catch (e) { return Infinity; }
        let minGap = Infinity;
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            const d = Math.hypot(a.x - b.x, a.z - b.z);
            if (d < minGap) minGap = d;
        }
        return minGap;
    };

    // Binary search: find the fold angle where the gap equals outerW (contact point).
    // Higher fold angle → more open → larger gap. We want the angle where gap = outerW.
    let lo = MIN_FOLD_ANGLE, hi = getOptimalClosedAngleForAnimation();
    const gapAtHi = minAdjacentGap(hi);
    if (gapAtHi <= outerW) return hi; // Already overlapping at deploy — unusual
    const gapAtLo = minAdjacentGap(lo);
    if (gapAtLo >= outerW) return lo; // Never overlaps in range

    for (let iter = 0; iter < 40; iter++) {
        const mid = (lo + hi) / 2;
        if (minAdjacentGap(mid) < outerW) lo = mid; else hi = mid;
        if (hi - lo < degToRad(0.05)) break;
    }
    return (lo + hi) / 2;
}

/**
 * Returns the effective minimum fold angle in radians: user override if set,
 * otherwise the computed V-beam contact angle.
 */
function getEffectiveMinFoldAngle() {
    const userDeg = state.animation.minFoldAngle;
    if (userDeg !== null && userDeg !== undefined) return degToRad(userDeg);
    return computeMinFoldAngleVBeamOverlap();
}

/**
 * Calculates the volume of a beam in cubic inches
 * @param {number} width - Beam width in inches
 * @param {number} thickness - Beam thickness in inches  
 * @param {number} lengthFt - Beam length in feet
 * @returns {number} Volume in cubic inches
 */
function calculateBeamVolume(width, thickness, lengthFt) {
    return width * thickness * (lengthFt * INCHES_PER_FOOT);
}

/**
 * Calculates the price per cubic inch based on reference beam
 * @returns {number} Price per cubic inch
 */
function getRefPricePerCubicInch() {
    const refVolume = calculateBeamVolume(state.refBeamWidth, state.refBeamThick, state.refBeamLength);
    return state.refBeamPrice / refVolume;
}

/**
 * Calculates the cost of a beam based on volume scaling from reference beam
 * @param {number} width - Beam width in inches
 * @param {number} thickness - Beam thickness in inches
 * @param {number} lengthFt - Beam length in feet
 * @returns {number} Calculated cost
 */
function calculateBeamCostByVolume(width, thickness, lengthFt) {
    const beamVolume = calculateBeamVolume(width, thickness, lengthFt);
    const pricePerCuIn = getRefPricePerCubicInch();
    return beamVolume * pricePerCuIn;
}

/**
 * Updates the auto-calculated beam costs if auto-pricing is enabled
 * Called when beam dimensions or reference pricing changes
 */
function updateAutoBeamPricing() {
    if (!state.autoLumberPricing) return;
    
    // Calculate costs based on current beam dimensions
    const hCost = calculateBeamCostByVolume(state.hBeamW, state.hBeamT, state.hLengthFt);
    let vCost;
    if (needsSplitVBeamDimensions() && !isVBeamDimensionsLinked()) {
        const innerCost = calculateBeamCostByVolume(state.vBeamInnerW, state.vBeamInnerT, state.vLengthFt);
        const outerCost = calculateBeamCostByVolume(state.vBeamOuterW, state.vBeamOuterT, state.vLengthFt);
        const counts = getVBeamCountsByType();
        vCost = counts.total > 0
            ? ((counts.inner * innerCost) + (counts.outer * outerCost)) / counts.total
            : innerCost;
    } else {
        vCost = calculateBeamCostByVolume(state.vBeamW, state.vBeamT, state.vLengthFt);
    }
    
    // Update state
    state.costHBeam = hCost;
    state.costVBeam = vCost;
    
    // Update UI inputs
    const hInput = document.getElementById('nb-cost-hbeam');
    const vInput = document.getElementById('nb-cost-vbeam');
    if (hInput) hInput.value = formatNumber(hCost, 2);
    if (vInput) vInput.value = formatNumber(vCost, 2);
}

/**
 * Calculates the linear actuator stroke length needed to fully fold/unfold the structure
 * The stroke is the change in distance between inner and outer horizontal pivots
 * from fully open (minimum fold angle) to fully closed (ring completes 360°)
 * @returns {{open: number, closed: number, stroke: number}} Pivot spans at open/closed positions and stroke length
 */
function calculateActuatorStroke() {
    // Pivot span at fully open (minimum fold angle) - pivots are closest together
    const openSpan = calculatePivotSpan(MIN_FOLD_ANGLE);
    
    // Get the optimal closed angle for this configuration (where ring closes to 360°)
    const closedAngle = getOptimalClosedAngleForAnimation();
    // Pivot span at fully closed - pivots are furthest apart
    const closedSpan = calculatePivotSpan(closedAngle);
    
    // Stroke is the difference in pivot spans
    const stroke = Math.abs(closedSpan - openSpan);
    
    return {
        open: openSpan,
        closed: closedSpan,
        stroke: stroke,
        closedAngle: closedAngle
    };
}

/**
 * Calculates the center of mass (CoM) of the structure at a given fold angle
 * Accounts for structure weight (beams, brackets, bolts) and optionally solar panel weight
 * @param {Object} data - Linkage geometry data from solveLinkage()
 * @param {number} foldAngle - Current fold angle in radians
 * @param {boolean} includeSolarPanels - Whether to include solar panel weight (default: true)
 * @returns {{x: number, y: number, z: number, totalWeight: number}} Center of mass position and total weight
 */
function calculateCenterOfMass(data, foldAngle, includeSolarPanels = true) {
    const com = { x: 0, y: 0, z: 0 };
    let totalWeight = 0;
    
    // Calculate structure weights
    const moduleCount = state.modules;
    const hBeams = moduleCount * 2 * state.hStackCount;
    const vBeams = moduleCount * state.vStackCount;
    const uBrackets = moduleCount * 4;
    const nBolts = moduleCount * (4 + 2);
    
    const hBeamWeightPerFoot = (state.hBeamW * state.hBeamT * INCHES_PER_FOOT) * state.woodDensity;
    const hBeamWeightPerBeam = state.hLengthFt * hBeamWeightPerFoot;
    const bracketWeight = state.weightBracket;
    const boltWeight = state.weightBolt;
    
    // Add beam weights to CoM calculation
    if (data.beams) {
        data.beams.forEach(beam => {
            let weight = 0;
            if (beam.stackType && beam.stackType.startsWith('horizontal')) {
                weight = hBeamWeightPerBeam;
            } else if (beam.stackType && (beam.stackType.startsWith('vertical') || beam.stackType.startsWith('fixed-beam'))) {
                const beamW = beam.w || state.vBeamW;
                const beamT = beam.t || state.vBeamT;
                weight = state.vLengthFt * (beamW * beamT * INCHES_PER_FOOT) * state.woodDensity;
            }
            
            if (weight > 0 && beam.center) {
                com.x += beam.center.x * weight;
                com.y += beam.center.y * weight;
                com.z += beam.center.z * weight;
                totalWeight += weight;
            }
        });
    }
    
    // Add bracket weights
    if (data.brackets) {
        data.brackets.forEach(bracket => {
            if (bracket.pos) {
                com.x += bracket.pos.x * bracketWeight;
                com.y += bracket.pos.y * bracketWeight;
                com.z += bracket.pos.z * bracketWeight;
                totalWeight += bracketWeight;
            }
        });
    }
    
    // Add bolt weights (negligible but included for completeness)
    if (data.bolts) {
        data.bolts.forEach(bolt => {
            if (bolt.pos) {
                com.x += bolt.pos.x * boltWeight;
                com.y += bolt.pos.y * boltWeight;
                com.z += bolt.pos.z * boltWeight;
                totalWeight += boltWeight;
            }
        });
    }
    
    // Add solar panel weights (only if includeSolarPanels is true)
    // Note: For actuator analysis, panels are added after unfolding, so exclude them
    if (includeSolarPanels && data.panels && data.panels.length > 0) {
        data.panels.forEach(panel => {
            if (panel.center) {
                const panelWeight = getPanelWeightLbs(panel);
                com.x += panel.center.x * panelWeight;
                com.y += panel.center.y * panelWeight;
                com.z += panel.center.z * panelWeight;
                totalWeight += panelWeight;
            }
        });
    }
    
    // Calculate weighted average (CoM)
    if (totalWeight > 0) {
        com.x /= totalWeight;
        com.y /= totalWeight;
        com.z /= totalWeight;
    }
    
    return { ...com, totalWeight };
}

/**
 * Calculates the mechanical advantage of the scissor mechanism at a given fold angle
 * The scissor mechanism provides leverage based on the angle between the beams
 * @param {number} foldAngle - Current fold angle in radians
 * @param {Object} jointResult - Result from calculateJointPositions
 * @returns {number} Mechanical advantage factor (>1 means force is amplified)
 */
function calculateScissorMechanicalAdvantage(foldAngle, jointResult) {
    const loc = jointResult.joints;
    
    // Calculate the angle between the two scissor arms
    // This is the key to mechanical advantage in scissor mechanisms
    const arm1Angle = Math.atan2(loc.tl.y - loc.bl.y, loc.tl.x - loc.bl.x);
    const arm2Angle = Math.atan2(loc.tr.y - loc.br.y, loc.tr.x - loc.br.x);
    const scissorAngle = Math.abs(arm2Angle - arm1Angle);
    
    // Mechanical advantage in a scissor mechanism is related to the angle between arms
    // When arms are nearly parallel (small angle), mechanical advantage is high
    // When arms are spread wide (large angle), mechanical advantage is lower
    // MA ≈ 1 / (2 * sin(θ/2)) where θ is the angle between arms
    const halfAngle = scissorAngle / 2;
    const mechanicalAdvantage = 1 / (2 * Math.sin(Math.max(0.01, halfAngle)));
    
    return mechanicalAdvantage;
}

/**
 * Calculates the required actuator force at a given fold angle and actuator position
 * Accounts for scissor mechanism leverage and mechanical advantage
 * @param {{x: number, y: number, z: number}} actuatorPos1 - First attachment point (on structure)
 * @param {{x: number, y: number, z: number}} actuatorPos2 - Second attachment point (on structure)
 * @param {number} foldAngle - Current fold angle in radians
 * @param {Object} data - Linkage geometry data
 * @param {number} frictionCoefficient - Friction coefficient (default 0.1)
 * @returns {{force: number, angle: number, mechanicalAdvantage: number, stroke: number, minStroke: number, maxStroke: number}} Required force and analysis
 */
function calculateRequiredActuatorForce(actuatorPos1, actuatorPos2, foldAngle, data, frictionCoefficient = 0.1) {
    // Calculate center of mass (exclude solar panels - they're added after unfolding)
    const com = calculateCenterOfMass(data, foldAngle, false);
    
    // Get joint positions to calculate scissor mechanical advantage
    const hActiveIn = state.hLengthFt * INCHES_PER_FOOT - state.offsetTopIn - state.offsetBotIn;
    const jointResult = calculateJointPositions(foldAngle, {
        hActiveIn: hActiveIn,
        pivotPct: state.pivotPct,
        hobermanAng: state.hobermanAng,
        pivotAng: state.pivotAng
    });
    
    // Calculate scissor mechanism mechanical advantage
    const scissorMA = calculateScissorMechanicalAdvantage(foldAngle, jointResult);
    
    // Calculate actuator vector
    const actuatorVec = {
        x: actuatorPos2.x - actuatorPos1.x,
        y: actuatorPos2.y - actuatorPos1.y,
        z: actuatorPos2.z - actuatorPos1.z
    };
    const actuatorLength = Math.sqrt(
        actuatorVec.x * actuatorVec.x + 
        actuatorVec.y * actuatorVec.y + 
        actuatorVec.z * actuatorVec.z
    );
    
    if (actuatorLength === 0) return { force: Infinity, angle: 0, mechanicalAdvantage: 0, stroke: 0, minStroke: 0, maxStroke: 0 };
    
    // Normalize actuator vector
    const actuatorDir = {
        x: actuatorVec.x / actuatorLength,
        y: actuatorVec.y / actuatorLength,
        z: actuatorVec.z / actuatorLength
    };
    
    // Calculate angle between actuator and the direction of motion (radial for scissor)
    // For scissor mechanisms, the effective force direction is along the radial span
    const loc = jointResult.joints;
    const radialVec = {
        x: loc.tr.x - loc.br.x,
        y: loc.tr.y - loc.br.y,
        z: 0
    };
    const radialLength = Math.sqrt(radialVec.x * radialVec.x + radialVec.y * radialVec.y);
    
    if (radialLength === 0) {
        return { force: Infinity, angle: 0, mechanicalAdvantage: 0, stroke: 0, minStroke: 0, maxStroke: 0 };
    }
    
    // Normalize radial vector
    const radialDir = {
        x: radialVec.x / radialLength,
        y: radialVec.y / radialLength,
        z: 0
    };
    
    // Calculate angle between actuator and radial direction
    const dotProduct = actuatorDir.x * radialDir.x + actuatorDir.y * radialDir.y + actuatorDir.z * radialDir.z;
    const angle = Math.acos(Math.max(-1, Math.min(1, dotProduct)));
    
    // The weight force needs to be lifted vertically, but actuator works in radial direction
    // Account for the angle between actuator and the direction of motion
    const weightForce = com.totalWeight; // lbs
    
    // Combined mechanical advantage: scissor mechanism × actuator angle efficiency
    // Actuator efficiency decreases as angle from optimal direction increases
    const actuatorEfficiency = Math.cos(angle);
    const totalMechanicalAdvantage = scissorMA * actuatorEfficiency;
    
    // Required force = weight / (mechanical advantage) + friction
    // Friction acts against motion, so it's added
    const baseForce = weightForce / Math.max(0.01, totalMechanicalAdvantage);
    const frictionForce = weightForce * frictionCoefficient;
    const totalForce = baseForce + frictionForce;
    
    // Calculate stroke length range (min to max over full fold range)
    // This calculates the actual distance change for these specific actuator positions
    const closedAngle = getOptimalClosedAngleForAnimation();
    const openAngle = MIN_FOLD_ANGLE;
    
    // Helper function to get actuator positions at a specific fold angle
    // We need to map the current positions to their corresponding positions at different angles
    const getActuatorPositionsAtAngle = (angle, pos1Ref, pos2Ref) => {
        const testJoint = calculateJointPositions(angle, {
            hActiveIn: hActiveIn,
            pivotPct: state.pivotPct,
            hobermanAng: state.hobermanAng,
            pivotAng: state.pivotAng
        });
        const testLoc = testJoint.joints;
        const sc = data.structureCenter || { x: 0, y: 0, z: 0 };
        
        // Get current joint positions to determine which joints these positions track
        const currentJoint = calculateJointPositions(foldAngle, {
            hActiveIn: hActiveIn,
            pivotPct: state.pivotPct,
            hobermanAng: state.hobermanAng,
            pivotAng: state.pivotAng
        });
        const currentLoc = currentJoint.joints;
        
        // Find which joint each position is closest to (or if it's a fixed position)
        const findClosestJoint = (pos) => {
            const joints = ['bl', 'br', 'tl', 'tr'];
            let closest = 'br';
            let minDist = Infinity;
            joints.forEach(j => {
                const jointPos = { x: currentLoc[j].x + sc.x, y: 0, z: currentLoc[j].y + sc.z };
                const dx = pos.x - jointPos.x;
                const dz = pos.z - jointPos.z;
                const dist = Math.sqrt(dx*dx + dz*dz);
                if (dist < minDist) {
                    minDist = dist;
                    closest = j;
                }
            });
            return { joint: closest, distance: minDist };
        };
        
        const pos1Info = findClosestJoint(pos1Ref);
        const pos2Info = findClosestJoint(pos2Ref);
        
        // Calculate positions at this angle
        let testPos1, testPos2;
        
        // If position is close to a joint (< 2 inches), it tracks that joint
        // Otherwise, it's a fixed position (like vertical actuators)
        if (pos1Info.distance < 2) {
            const joint = testLoc[pos1Info.joint];
            const offsetX = pos1Ref.x - (currentLoc[pos1Info.joint].x + sc.x);
            const offsetZ = pos1Ref.z - (currentLoc[pos1Info.joint].y + sc.z);
            testPos1 = {
                x: joint.x + sc.x + offsetX,
                y: pos1Ref.y, // Y is typically fixed or follows joint
                z: joint.y + sc.z + offsetZ
            };
        } else {
            // Fixed position (e.g., vertical actuator)
            testPos1 = pos1Ref;
        }
        
        if (pos2Info.distance < 2) {
            const joint = testLoc[pos2Info.joint];
            const offsetX = pos2Ref.x - (currentLoc[pos2Info.joint].x + sc.x);
            const offsetZ = pos2Ref.z - (currentLoc[pos2Info.joint].y + sc.z);
            testPos2 = {
                x: joint.x + sc.x + offsetX,
                y: pos2Ref.y,
                z: joint.y + sc.z + offsetZ
            };
        } else {
            testPos2 = pos2Ref;
        }
        
        return { pos1: testPos1, pos2: testPos2 };
    };
    
    // Calculate lengths at open and closed positions
    const openPos = getActuatorPositionsAtAngle(openAngle, actuatorPos1, actuatorPos2);
    const closedPos = getActuatorPositionsAtAngle(closedAngle, actuatorPos1, actuatorPos2);
    
    const calcLength = (p1, p2) => {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dz = p2.z - p1.z;
        return Math.sqrt(dx*dx + dy*dy + dz*dz);
    };
    
    const minLength = calcLength(openPos.pos1, openPos.pos2);
    const maxLength = calcLength(closedPos.pos1, closedPos.pos2);
    const stroke = Math.abs(maxLength - minLength);
    
    return {
        force: totalForce,
        angle: angle * 180 / Math.PI, // Convert to degrees
        mechanicalAdvantage: totalMechanicalAdvantage,
        scissorMechanicalAdvantage: scissorMA,
        actuatorLength: actuatorLength,
        stroke: stroke,
        minStroke: Math.min(minLength, maxLength),
        maxStroke: Math.max(minLength, maxLength),
        minLength: minLength,
        maxLength: maxLength
    };
}

/**
 * Finds optimal actuator placement positions for the structure
 * Tests key leverage points in the scissor mechanism and ranks them by efficiency
 * @param {Object} data - Linkage geometry data
 * @param {Object} options - Configuration options
 * @returns {Array} Array of recommended actuator placements, sorted by efficiency
 */
function findOptimalActuatorPlacements(data, options = {}) {
    const {
        maxActuators = 5,
        maxForce = 2000, // lbs
        preferredLocations = 'all', // 'pivot', 'ring', 'vertical', 'all'
        testAngles = [MIN_FOLD_ANGLE, state.foldAngle, getOptimalClosedAngleForAnimation()]
    } = options;
    
    const recommendations = [];
    const hActiveIn = state.hLengthFt * INCHES_PER_FOOT - state.offsetTopIn - state.offsetBotIn;
    const sc = data.structureCenter || { x: 0, y: 0, z: 0 };
    
    // Candidate positions - key leverage points in scissor mechanism
    const candidates = [];
    
    // Test at mid-angle to get representative positions
    const midAngle = (MIN_FOLD_ANGLE + getOptimalClosedAngleForAnimation()) / 2;
    const midJointResult = calculateJointPositions(midAngle, {
        hActiveIn: hActiveIn,
        pivotPct: state.pivotPct,
        hobermanAng: state.hobermanAng,
        pivotAng: state.pivotAng
    });
    const midLoc = midJointResult.joints;
    
    if (preferredLocations === 'pivot' || preferredLocations === 'all') {
        // 1. Between inner and outer pivots (br and tr) - PRIMARY LEVERAGE POINT
        // This is the most efficient location for scissor mechanisms
        candidates.push({
            name: 'Inner-Outer Pivot (Primary)',
            description: 'Between inner pivot (br) and outer pivot (tr) - optimal leverage',
            pos1: { x: midLoc.br.x + sc.x, y: 0, z: midLoc.br.y + sc.z },
            pos2: { x: midLoc.tr.x + sc.x, y: 0, z: midLoc.tr.y + sc.z },
            type: 'pivot',
            priority: 1
        });
        
        // 2. Between bottom-left and top-right (bl and tr) - alternative pivot
        candidates.push({
            name: 'Diagonal Pivot',
            description: 'Between bottom-left (bl) and top-right (tr) pivots',
            pos1: { x: midLoc.bl.x + sc.x, y: 0, z: midLoc.bl.y + sc.z },
            pos2: { x: midLoc.tr.x + sc.x, y: 0, z: midLoc.tr.y + sc.z },
            type: 'pivot',
            priority: 2
        });
    }
    
    if (preferredLocations === 'ring' || preferredLocations === 'all') {
        // 3. Between scissor intersection points (midpoints of arms)
        const intersection1 = {
            x: (midLoc.bl.x + midLoc.tl.x) / 2 + sc.x,
            y: state.vLengthFt * INCHES_PER_FOOT / 4,
            z: (midLoc.bl.y + midLoc.tl.y) / 2 + sc.z
        };
        const intersection2 = {
            x: (midLoc.br.x + midLoc.tr.x) / 2 + sc.x,
            y: state.vLengthFt * INCHES_PER_FOOT / 4,
            z: (midLoc.br.y + midLoc.tr.y) / 2 + sc.z
        };
        candidates.push({
            name: 'Scissor Intersection',
            description: 'Between scissor arm intersection points',
            pos1: intersection1,
            pos2: intersection2,
            type: 'intersection',
            priority: 3
        });
    }
    
    if (preferredLocations === 'vertical' || preferredLocations === 'all') {
        // 4. Vertical actuator between horizontal rings
        const vHeight = state.vLengthFt * INCHES_PER_FOOT / 2;
        candidates.push({
            name: 'Vertical Ring',
            description: 'Vertical actuator between top and bottom horizontal rings',
            pos1: { x: midLoc.br.x + sc.x, y: 0, z: midLoc.br.y + sc.z },
            pos2: { x: midLoc.br.x + sc.x, y: vHeight, z: midLoc.br.y + sc.z },
            type: 'vertical',
            priority: 4
        });
    }
    
    // Test each candidate at different fold angles
    candidates.forEach(candidate => {
        let maxForce = 0;
        let minForce = Infinity;
        let avgForce = 0;
        let maxStroke = 0;
        let minStroke = Infinity;
        const forces = [];
        const strokes = [];
        let totalMA = 0;
        
        testAngles.forEach(angle => {
            const testData = solveLinkage(angle);
            
            // Recalculate positions at this angle
            const testJoint = calculateJointPositions(angle, {
                hActiveIn: hActiveIn,
                pivotPct: state.pivotPct,
                hobermanAng: state.hobermanAng,
                pivotAng: state.pivotAng
            });
            const testLoc = testJoint.joints;
            
            // Map candidate positions to this angle
            let testPos1, testPos2;
            if (candidate.type === 'pivot') {
                if (candidate.name.includes('Diagonal')) {
                    testPos1 = { x: testLoc.bl.x + sc.x, y: 0, z: testLoc.bl.y + sc.z };
                    testPos2 = { x: testLoc.tr.x + sc.x, y: 0, z: testLoc.tr.y + sc.z };
                } else {
                    testPos1 = { x: testLoc.br.x + sc.x, y: 0, z: testLoc.br.y + sc.z };
                    testPos2 = { x: testLoc.tr.x + sc.x, y: 0, z: testLoc.tr.y + sc.z };
                }
            } else if (candidate.type === 'intersection') {
                const i1 = {
                    x: (testLoc.bl.x + testLoc.tl.x) / 2 + sc.x,
                    y: state.vLengthFt * INCHES_PER_FOOT / 4,
                    z: (testLoc.bl.y + testLoc.tl.y) / 2 + sc.z
                };
                const i2 = {
                    x: (testLoc.br.x + testLoc.tr.x) / 2 + sc.x,
                    y: state.vLengthFt * INCHES_PER_FOOT / 4,
                    z: (testLoc.br.y + testLoc.tr.y) / 2 + sc.z
                };
                testPos1 = i1;
                testPos2 = i2;
            } else if (candidate.type === 'vertical') {
                testPos1 = { x: testLoc.br.x + sc.x, y: 0, z: testLoc.br.y + sc.z };
                testPos2 = { x: testLoc.br.x + sc.x, y: state.vLengthFt * INCHES_PER_FOOT / 2, z: testLoc.br.y + sc.z };
            } else {
                testPos1 = candidate.pos1;
                testPos2 = candidate.pos2;
            }
            
            const forceResult = calculateRequiredActuatorForce(
                testPos1, 
                testPos2, 
                angle, 
                testData
            );
            
            if (forceResult.force && isFinite(forceResult.force)) {
                forces.push(forceResult.force);
                maxForce = Math.max(maxForce, forceResult.force);
                minForce = Math.min(minForce, forceResult.force);
                avgForce += forceResult.force;
                
                if (forceResult.stroke) {
                    strokes.push(forceResult.stroke);
                    maxStroke = Math.max(maxStroke, forceResult.stroke);
                    minStroke = Math.min(minStroke, forceResult.stroke);
                }
                
                totalMA += forceResult.mechanicalAdvantage || 0;
            }
        });
        
        if (forces.length === 0) return; // Skip invalid candidates
        
        avgForce /= forces.length;
        const avgMA = totalMA / testAngles.length;
        
        // Calculate stroke length over full fold range (open to closed)
        // This is specific to each actuator position, not a fixed value
        const openAngle = MIN_FOLD_ANGLE;
        const closedAngle = getOptimalClosedAngleForAnimation();
        
        // Get positions at open and closed angles
        const openJoint = calculateJointPositions(openAngle, {
            hActiveIn: hActiveIn,
            pivotPct: state.pivotPct,
            hobermanAng: state.hobermanAng,
            pivotAng: state.pivotAng
        });
        const closedJoint = calculateJointPositions(closedAngle, {
            hActiveIn: hActiveIn,
            pivotPct: state.pivotPct,
            hobermanAng: state.hobermanAng,
            pivotAng: state.pivotAng
        });
        const openLoc = openJoint.joints;
        const closedLoc = closedJoint.joints;
        
        // Calculate positions at open and closed based on candidate type
        let openPos1, openPos2, closedPos1, closedPos2;
        if (candidate.type === 'pivot') {
            if (candidate.name.includes('Diagonal')) {
                openPos1 = { x: openLoc.bl.x + sc.x, y: 0, z: openLoc.bl.y + sc.z };
                openPos2 = { x: openLoc.tr.x + sc.x, y: 0, z: openLoc.tr.y + sc.z };
                closedPos1 = { x: closedLoc.bl.x + sc.x, y: 0, z: closedLoc.bl.y + sc.z };
                closedPos2 = { x: closedLoc.tr.x + sc.x, y: 0, z: closedLoc.tr.y + sc.z };
            } else {
                openPos1 = { x: openLoc.br.x + sc.x, y: 0, z: openLoc.br.y + sc.z };
                openPos2 = { x: openLoc.tr.x + sc.x, y: 0, z: openLoc.tr.y + sc.z };
                closedPos1 = { x: closedLoc.br.x + sc.x, y: 0, z: closedLoc.br.y + sc.z };
                closedPos2 = { x: closedLoc.tr.x + sc.x, y: 0, z: closedLoc.tr.y + sc.z };
            }
        } else if (candidate.type === 'intersection') {
            openPos1 = {
                x: (openLoc.bl.x + openLoc.tl.x) / 2 + sc.x,
                y: state.vLengthFt * INCHES_PER_FOOT / 4,
                z: (openLoc.bl.y + openLoc.tl.y) / 2 + sc.z
            };
            openPos2 = {
                x: (openLoc.br.x + openLoc.tr.x) / 2 + sc.x,
                y: state.vLengthFt * INCHES_PER_FOOT / 4,
                z: (openLoc.br.y + openLoc.tr.y) / 2 + sc.z
            };
            closedPos1 = {
                x: (closedLoc.bl.x + closedLoc.tl.x) / 2 + sc.x,
                y: state.vLengthFt * INCHES_PER_FOOT / 4,
                z: (closedLoc.bl.y + closedLoc.tl.y) / 2 + sc.z
            };
            closedPos2 = {
                x: (closedLoc.br.x + closedLoc.tr.x) / 2 + sc.x,
                y: state.vLengthFt * INCHES_PER_FOOT / 4,
                z: (closedLoc.br.y + closedLoc.tr.y) / 2 + sc.z
            };
        } else if (candidate.type === 'vertical') {
            const vHeight = state.vLengthFt * INCHES_PER_FOOT / 2;
            openPos1 = { x: openLoc.br.x + sc.x, y: 0, z: openLoc.br.y + sc.z };
            openPos2 = { x: openLoc.br.x + sc.x, y: vHeight, z: openLoc.br.y + sc.z };
            closedPos1 = { x: closedLoc.br.x + sc.x, y: 0, z: closedLoc.br.y + sc.z };
            closedPos2 = { x: closedLoc.br.x + sc.x, y: vHeight, z: closedLoc.br.y + sc.z };
        } else {
            // Fixed positions (shouldn't change)
            openPos1 = candidate.pos1;
            openPos2 = candidate.pos2;
            closedPos1 = candidate.pos1;
            closedPos2 = candidate.pos2;
        }
        
        // Calculate stroke length (difference between open and closed positions)
        const calcLength = (p1, p2) => {
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const dz = p2.z - p1.z;
            return Math.sqrt(dx*dx + dy*dy + dz*dz);
        };
        
        const openLength = calcLength(openPos1, openPos2);
        const closedLength = calcLength(closedPos1, closedPos2);
        const actualStroke = Math.abs(closedLength - openLength);
        const actualMinLength = Math.min(openLength, closedLength);
        const actualMaxLength = Math.max(openLength, closedLength);
        
        // Calculate efficiency score
        // Lower force and stroke = better, higher mechanical advantage = better
        // Efficiency = (MA / force) / stroke (normalized)
        const forcePenalty = avgForce / 1000; // Normalize to reasonable range
        const strokePenalty = actualStroke / 100; // Normalize to reasonable range
        const efficiency = (avgMA / (forcePenalty * strokePenalty + 1)) * 100;
        
        recommendations.push({
            name: candidate.name,
            description: candidate.description,
            type: candidate.type,
            priority: candidate.priority,
            position1: candidate.pos1,
            position2: candidate.pos2,
            tracksJoints: candidate.type === 'pivot' || candidate.type === 'intersection',
            maxForce: maxForce,
            minForce: minForce,
            avgForce: avgForce,
            maxStroke: actualMaxLength,
            minStroke: actualMinLength,
            stroke: actualStroke,
            mechanicalAdvantage: avgMA,
            efficiency: efficiency,
            recommended: maxForce <= options.maxForce && maxForce > 0,
            forceRating: Math.ceil(maxForce * 1.5) // Recommend 50% safety margin
        });
    });
    
    // Sort by efficiency (best first), then by priority
    recommendations.sort((a, b) => {
        if (Math.abs(a.efficiency - b.efficiency) < 0.1) {
            return a.priority - b.priority;
        }
        return b.efficiency - a.efficiency;
    });
    
    return recommendations.slice(0, maxActuators);
}

/**
 * Extends a point outward by a given distance
 * @param {{x: number, y: number}} p - Point to extend
 * @param {number} dist - Distance to extend
 * @returns {{x: number, y: number}} Extended point
 */
function extendPoint(p, dist) {
    const length = Math.sqrt(p.x * p.x + p.y * p.y);
    if (length === 0) return p;
    const scale = 1 + (dist / length);
    return {x: p.x * scale, y: p.y * scale};
}

/**
 * Maps a 2D point to 3D space with rotation and translation
 * @param {{x: number, y: number}} p - 2D point
 * @param {number} h - Height (y coordinate in 3D)
 * @param {{x: number, y: number}} curPos - Current position offset
 * @param {number} curRot - Current rotation angle
 * @returns {{x: number, y: number, z: number}} 3D point
 */
function mapTo3D(p, h, curPos, curRot) {
    const rx = p.x * Math.cos(curRot) - p.y * Math.sin(curRot);
    const rz = p.x * Math.sin(curRot) + p.y * Math.cos(curRot);
    return v3(curPos.x + rx, h, curPos.y + rz);
}

/**
 * Creates a stack of beams with alternating pattern
 * @param {Object} stackParams - Stack parameters
 * @returns {number} Total thickness of the stack
 */
function createBeamStack(stackParams) {
    const { 
        p1_A, p2_A, p1_B, p2_B, 
        count, width, thick, color, offsetDir,
        moduleIndex, stackType, stackId, 
        beamsArray, gap
    } = stackParams;
    
    // Ensure offset direction is normalized and valid
    let normalizedDir = vNorm(offsetDir);
    if (vMag(normalizedDir) < 0.001) {
        normalizedDir = {x: 1, y: 0, z: 0};
    }
    
    const totalThick = count * thick + (count - 1) * gap;
    const startOffset = -totalThick / 2 + thick / 2;
    
    for (let i = 0; i < count; i++) {
        const offsetValue = startOffset + i * (thick + gap);
        const vectorOffset = vScale(normalizedDir, offsetValue);
        const isPatternA = (i % 2 === 0);
        const start = isPatternA ? p1_A : p1_B;
        const end = isPatternA ? p2_A : p2_B;
        
        const offsetStart = vAdd(start, vectorOffset);
        const offsetEnd = vAdd(end, vectorOffset);
        
        beamsArray.push(new Beam3D(
            offsetStart,
            offsetEnd,
            width, thick, color,
            {moduleIndex, stackType, stackId, patternId: isPatternA ? 'A' : 'B'}
        ));
    }
    
    return totalThick;
}

/**
 * Solves the linkage geometry for a given fold angle
 * Calculates positions of all beams, brackets, and bolts based on state parameters
 * @param {number} foldAngle - Fold angle in radians
 * @returns {{beams: Beam3D[], brackets: Bracket3D[], bolts: Array, maxRad: number, maxHeight: number}} Geometry data
 */
function solveLinkage(foldAngle) {
    // Calculate beam lengths in inches
    const hTotIn = state.hLengthFt * INCHES_PER_FOOT;
    const hActiveIn = hTotIn - state.offsetTopIn - state.offsetBotIn;
    const vTotIn = state.vLengthFt * INCHES_PER_FOOT;
    const vActiveIn = vTotIn - (state.vertEndOffset * 2);
    const safeV = Math.max(MIN_SAFE_DIMENSION, vActiveIn);
    
    // Calculate joint positions using helper function
    const jointResult = calculateJointPositions(foldAngle, {
        hActiveIn,
        pivotPct: state.pivotPct,
        hobermanAng: state.hobermanAng,
        pivotAng: state.pivotAng
    });
    
    const loc = jointResult.joints;
    const relativeRotation = jointResult.relativeRotation;

    // Calculate vertical beam height from radial span
    // When using fixed beams, adjust height to maintain fixed beam spacing
    let zHeight = 0;
    if (state.useFixedBeams) {
        // With fixed beams, use the V beam length directly as the height
        // The structure height equals the fixed beam length (converted to inches)
        const fixedBeamLengthInches = state.vLengthFt * INCHES_PER_FOOT;
        
        // Set zHeight directly from the V beam length
        // This ensures fixed beams are always the user-specified length
        zHeight = fixedBeamLengthInches;
        state.fixedBeamHeight = zHeight; // Store for reference
        state.fixedBeamLength = fixedBeamLengthInches;
    } else {
        // Normal scissor behavior: height changes with radial span
        const dx = loc.tr.x - loc.br.x;
        const dy = loc.tr.y - loc.br.y;
        const radialSpan = Math.sqrt(dx*dx + dy*dy);
        if (safeV > radialSpan) zHeight = Math.sqrt(safeV*safeV - radialSpan*radialSpan);
    }

    let beams = [];
    let brackets = [];
    let bolts = [];
    let washers = [];
    let hardwareAssemblyPlacements = [];
    let curPos = {x:0, y:0};
    let curRot = 0;
    
    // Helper to create washers for a bolt (defined outside module loop for reuse)
    // Washers are positioned FLUSH with the inner beam face (towards stack center)
    // and EXPAND OUTWARD towards the brackets when thickness increases
    const createWashersForBolt = (bolt, stackCount, stackGap, beamThickness, washerConfig, stackDirNorm) => {
        const washers = [];
        if (!washerConfig.enabled || washerConfig.thickness <= 0) return washers;
        
        const washerCount = stackCount - 1; // One washer per gap
        if (washerCount <= 0) return washers;
        
        const beamWidths = Array.isArray(beamThickness) ? beamThickness : null;
        const uniformThickness = !beamWidths;
        
        // Use provided stack direction, or calculate from bolt type
        let stackDir = stackDirNorm;
        if (!stackDir) {
            // Fallback: calculate stack direction from bolt
            const boltDir = bolt.dir;
            if (Math.abs(boltDir.y) < 0.1) {
                // Horizontal bolt (v-stack) - stack is along Y-axis (vertical)
                stackDir = {x: 0, y: 1, z: 0};
            } else {
                // Vertical bolt (h-stack) - stack is horizontal (radial)
                const radial = vNorm({x: bolt.center.x, y: 0, z: bolt.center.z});
                if (vMag(radial) < 0.1) radial = {x: 1, y: 0, z: 0}; // Fallback
                stackDir = radial;
            }
        }
        
        const getBeamWidth = (beamIndex) => uniformThickness ? beamThickness : beamWidths[beamIndex];
        
        // Calculate beam positions relative to bolt center (which is at stack center)
        const totalStackThick = uniformThickness
            ? stackCount * beamThickness + (stackCount - 1) * stackGap
            : calculateVStackTotalThickness(beamWidths, stackGap);
        
        // Helper to get beam center position (index 0 is first beam)
        const getBeamCenter = (beamIndex) => {
            if (uniformThickness) {
                const stackStart = -totalStackThick / 2;
                return stackStart + beamThickness / 2 + beamIndex * (beamThickness + stackGap);
            }
            return getVStackBeamCenterOffset(beamIndex, beamWidths);
        };
        
        // Center gap index (for determining which half of stack we're in)
        const centerGapIndex = (washerCount - 1) / 2;
        
        // Create washers at each gap
        for (let i = 0; i < washerCount; i++) {
            // This gap is between beam i and beam i+1
            const beamI_center = getBeamCenter(i);
            const beamIPlusOne_center = getBeamCenter(i + 1);
            
            // Beam face positions (sides of the gap)
            const beamI_outerFace = beamI_center + getBeamWidth(i) / 2; // Face towards beam i+1
            const beamIPlusOne_innerFace = beamIPlusOne_center - getBeamWidth(i + 1) / 2; // Face towards beam i
            
            // Position washer: FLUSH with inner beam (towards stack center), EXPAND outward (towards bracket)
            // The washer mesh is centered, so we calculate where its center should be
            let washerCenterPos;
            
            if (i < centerGapIndex) {
                // Left half of stack: inner beam is i+1 (closer to center)
                // Washer is flush with beam i+1's inner face, expands LEFT towards bracket
                // Washer's right face at beamIPlusOne_innerFace, so center is shifted left by thickness/2
                washerCenterPos = beamIPlusOne_innerFace - washerConfig.thickness / 2;
            } else if (i > centerGapIndex) {
                // Right half of stack: inner beam is i (closer to center)
                // Washer is flush with beam i's outer face, expands RIGHT towards bracket
                // Washer's left face at beamI_outerFace, so center is shifted right by thickness/2
                washerCenterPos = beamI_outerFace + washerConfig.thickness / 2;
            } else {
                // Center gap (for odd number of gaps) or single gap
                // For single washer (2 beams), flush with the first beam and expand towards second
                // This makes the behavior consistent - always flush with "inner" side
                if (washerCount === 1) {
                    // Single gap: flush with first beam's outer face, expand towards second beam
                    washerCenterPos = beamI_outerFace + washerConfig.thickness / 2;
                } else {
                    // True center gap in odd stack: center the washer (both sides equally)
                    washerCenterPos = (beamI_outerFace + beamIPlusOne_innerFace) / 2;
                }
            }
            
            const washerCenter = vAdd(bolt.center, vScale(stackDir, washerCenterPos));
            
            washers.push({
                center: washerCenter,
                dir: bolt.dir, // Washer normal is along bolt direction
                id: washerConfig.id,
                od: washerConfig.od,
                thickness: washerConfig.thickness,
                washerType: bolt.boltType,
                z: washerCenter.y
            });
        }
        
        return washers;
    };
    
    // Calculate visible locations with offsets applied
    const visLoc = {
        bl: extendPoint(loc.bl, state.offsetBotIn),
        tr: extendPoint(loc.tr, state.offsetTopIn),
        br: extendPoint(loc.br, state.offsetBotIn),
        tl: extendPoint(loc.tl, state.offsetTopIn)
    };

    const woodColor = WOOD_COLOR; 

    // Helper to create stacks using the modular function
    const createStack = (p1_A, p2_A, p1_B, p2_B, count, width, thick, color, offsetDir, moduleIndex, stackType, stackId) => {
        return createBeamStack({
            p1_A, p2_A, p1_B, p2_B,
            count, width, thick, color, offsetDir,
            moduleIndex, stackType, stackId,
            beamsArray: beams,
            gap: state.hStackGap
        });
    };

    let maxRad = 0;

    for(let i=0; i<state.modules; i++) {
        // Local map function that captures curPos and curRot
        const map = (p, h) => mapTo3D(p, h, curPos, curRot);

        // --- BRACKET AND PIVOT CALCULATION ---
        // Brackets sit flat on horizontal beams. The hole offset (from bracket base to hole center)
        // determines where the pivot point is, which affects the entire structure height.
        const hT = state.hBeamT || 1.5;
        const hStackCount = state.hStackCount || 1;
        const hStackGap = state.hStackGap || 0;
        const bracketHeight = state.bracketHeight || 3.0;
        const holeDiameter = state.bracketHoleDiameter || 0.375;
        const holeRadius = holeDiameter / 2;
        const wallThickness = state.bracketWallThickness || 0.25;
        
        // Calculate total horizontal stack thickness (stack is centered at Y=0)
        // Stack extends from -hStackThick/2 to +hStackThick/2
        const hStackThick = hStackCount * hT + (hStackCount - 1) * hStackGap;
        
        // Hole offset: distance from bracket base (closed end) to hole center
        // Default to center of bracket if not specified
        const userHoleOffset = state.bracketHoleDistance;
        const defaultHoleOffset = bracketHeight / 2;
        const holeOffset = (userHoleOffset !== undefined && userHoleOffset !== null) ? userHoleOffset : defaultHoleOffset;
        
        // Ensure hole has minimum clearance from bracket base (physical constraint)
        const minHoleOffset = wallThickness + holeRadius + 0.1;
        const effectiveHoleOffset = Math.max(holeOffset, minHoleOffset);
        
        // Calculate required bracket height: hole position + hole radius + 0.1" clearance at open end
        const minBracketHeight = effectiveHoleOffset + holeRadius + 0.1;
        const actualBracketHeight = Math.max(bracketHeight, minBracketHeight);
        
        // Bottom bracket sits on top of bottom horizontal beam STACK (centered at Y=0)
        // Top of stack is at Y = hStackThick/2
        const bracketBottomY_bot = hStackThick / 2;
        
        // The pivot point (yMin) is where the hole is: bracket base + hole offset
        const yMin = bracketBottomY_bot + effectiveHoleOffset;
        
        // Vertical beams span zHeight, so yMax = yMin + zHeight
        const yMax = yMin + zHeight;
        
        // Top horizontal beam position: top bracket hangs from its bottom surface
        // Top bracket base is at the bottom of the top horizontal stack
        // Stack is centered at topH, so bottom is at topH - hStackThick/2
        // Top bracket hole (at effectiveHoleOffset from its base) must be at yMax
        // So: yMax = topH - hStackThick/2 - effectiveHoleOffset
        // topH = yMax + hStackThick/2 + effectiveHoleOffset
        const topH = yMax + hStackThick / 2 + effectiveHoleOffset;
        
        // Legacy compatibility: bracketH was used elsewhere in this function
        const bracketH = actualBracketHeight;

        // --- HORIZONTAL RINGS ---
        const hUp = {x:0,y:1,z:0};
        const hW = state.hBeamW; // hT already defined above
        
        // Bottom horizontal ring - pass module index and type for collision detection
        const hThick = createStack(
            map(visLoc.bl, 0), map(visLoc.tr, 0), // Pattern A
            map(visLoc.br, 0), map(visLoc.tl, 0), // Pattern B
            state.hStackCount, hW, hT, woodColor, hUp,
            i, 'horizontal-bottom', i * 2  // moduleIndex, stackType, stackId
        );
        
        // Top horizontal ring (inverted/mirrored - stacks downward, same pattern)
        const hDown = {x:0, y:-1, z:0}; // Invert stacking direction for mirror effect
        createStack(
            map(visLoc.bl, topH), map(visLoc.tr, topH), // Same Pattern A as bottom
            map(visLoc.br, topH), map(visLoc.tl, topH), // Same Pattern B as bottom
            state.hStackCount, hW, hT, woodColor, hDown,
            i, 'horizontal-top', i * 2 + 1  // moduleIndex, stackType, stackId
        );

        // --- VERTICAL UPRIGHTS (scissor cross-beams) ---
        // yMin and yMax are calculated above based on bracket hole offset
        // They define where vertical beams connect (at the pivot/bolt holes)
        
        // Define the four corner pivot points (used by both vertical uprights and fixed beams)
        const pBotInner = map(loc.br, yMin);
        const pTopOuter = map(loc.tr, yMax);
        const pBotOuter = map(loc.tr, yMin);
        const pTopInner = map(loc.br, yMax);
        
        // Skip when using fixed straight beams (they replace the scissor uprights)
        if (zHeight > 1 && !state.useFixedBeams) {
            
            // Calculate CENTER pivot points that all beams in the stack should pass through
            // These are the midpoints between the inner and outer pivot points
            const pivotBotCenter = vScale(vAdd(pBotInner, pBotOuter), 0.5);
            const pivotTopCenter = vScale(vAdd(pTopOuter, pTopInner), 0.5);
            
            const stackBeamWidths = getVStackBeamWidths();
            
            // Calculate the beam direction (from center bottom to center top pivot)
            const beamDir = vNorm(vSub(pivotTopCenter, pivotBotCenter));
            
            // Pre-calculate pattern vectors and directions for stack calculation
            const patternA_bot = pBotInner;
            const patternA_top = pTopOuter;
            const patternA_vec = vSub(patternA_top, patternA_bot);
            const patternA_dir = vNorm(patternA_vec);
            const patternA_mid = vScale(vAdd(patternA_bot, patternA_top), 0.5);
            
            const patternB_bot = pBotOuter;
            const patternB_top = pTopInner;
            const patternB_vec = vSub(patternB_top, patternB_bot);
            const patternB_dir = vNorm(patternB_vec);
            const patternB_mid = vScale(vAdd(patternB_bot, patternB_top), 0.5);
            
            // Use average pattern direction for reference, but calculate stack direction more carefully
            const avgPatternDir = vNorm(vScale(vAdd(patternA_dir, patternB_dir), 0.5));
            
            // Calculate the beam length including end offsets
            const beamLength = vMag(vSub(pivotTopCenter, pivotBotCenter)) + (state.vertEndOffset * 2);
            
            // Calculate stacking direction (perpendicular to beam direction)
            // This is the direction beams will stack side-by-side
            const center = v3(0, 0, 0);
            const radVec = vNorm(vSub(pivotBotCenter, center));
            const up = {x: 0, y: 1, z: 0};
            
            // CRITICAL: Stack direction must be perpendicular to BOTH pattern directions
            // Calculate a direction that's perpendicular to both pattern A and pattern B
            // This ensures consistent stacking regardless of which pattern is used
            
            // Method 1: Cross product of the two pattern directions gives us a perpendicular vector
            let stackDir = vNorm(vCross(patternA_dir, patternB_dir));
            
            // If patterns are parallel, the cross product will be near zero
            if (vMag(stackDir) < 0.1) {
                // Patterns are nearly parallel, use radial-based calculation
                stackDir = vNorm(vCross(radVec, avgPatternDir));
            }
            
            // Verify the stack direction is perpendicular to pattern directions
            const dotCheckA = Math.abs(vDot(stackDir, patternA_dir));
            const dotCheckB = Math.abs(vDot(stackDir, patternB_dir));
            if (dotCheckA > 0.1 || dotCheckB > 0.1 || vMag(stackDir) < 0.1) {
                // Method 2: Cross product of average pattern direction with up vector
                stackDir = vNorm(vCross(avgPatternDir, up));
                const dotCheck2A = Math.abs(vDot(stackDir, patternA_dir));
                const dotCheck2B = Math.abs(vDot(stackDir, patternB_dir));
                if (dotCheck2A > 0.1 || dotCheck2B > 0.1 || vMag(stackDir) < 0.1) {
                    // Method 3: Construct perpendicular vector manually
                    // Find any vector not parallel to pattern directions
                    let perpVec;
                    if (Math.abs(avgPatternDir.y) > 0.9) {
                        // Beam is mostly vertical, use horizontal perpendicular
                        perpVec = {x: 1, y: 0, z: 0};
                    } else if (Math.abs(avgPatternDir.x) > 0.9) {
                        // Beam is mostly in X direction, use Z perpendicular
                        perpVec = {x: 0, y: 0, z: 1};
                    } else {
                        // Use cross product with up vector, then normalize
                        perpVec = {x: -avgPatternDir.z, y: 0, z: avgPatternDir.x};
                    }
                    // Make it perpendicular to average pattern direction using Gram-Schmidt
                    stackDir = vSub(perpVec, vScale(avgPatternDir, vDot(perpVec, avgPatternDir)));
                    stackDir = vNorm(stackDir);
                }
            }
            
            // Final verification: ensure stackDir is perpendicular to both pattern directions
            const finalDotA = Math.abs(vDot(stackDir, patternA_dir));
            const finalDotB = Math.abs(vDot(stackDir, patternB_dir));
            
            if (finalDotA > 0.01) {
                // Force perpendicular to pattern A
                stackDir = vSub(stackDir, vScale(patternA_dir, vDot(stackDir, patternA_dir)));
                stackDir = vNorm(stackDir);
            }
            if (finalDotB > 0.01) {
                // Force perpendicular to pattern B
                stackDir = vSub(stackDir, vScale(patternB_dir, vDot(stackDir, patternB_dir)));
                stackDir = vNorm(stackDir);
            }
            
            // Verify stack direction is valid
            if (vMag(stackDir) < 0.1) {
                // Ultimate fallback: use cross product of pattern A with up vector
                stackDir = vNorm(vCross(patternA_dir, up));
                if (vMag(stackDir) < 0.1) {
                    // Final fallback: use radial direction rotated 90 degrees
                    stackDir = vNorm({x: -radVec.z, y: radVec.y, z: radVec.x});
                }
            }
            
            // Create vertical stack centered on pivot points
            // All beams pass through the center pivot points, stacked perpendicular to beam direction
            // CRITICAL: Use vW (width) for stack spacing, not vT (thickness)
            // Beams are stacked along their width dimension, not thickness
            const gap = state.vStackGap;
            const totalThick = calculateVStackTotalThickness(stackBeamWidths, gap);
            
            // Calculate center pivot line (where stack should be centered)
            const centerLineStart = pivotBotCenter;
            const centerLineEnd = pivotTopCenter;
            const centerLineDir = vNorm(vSub(centerLineEnd, centerLineStart));
            
            // Calculate center pivot midpoint (where stack should be centered)
            // (pattern vectors and midpoints already calculated above)
            const centerMid = vScale(vAdd(centerLineStart, centerLineEnd), 0.5);
            
            // CRITICAL FIX: Center each pattern individually, then stack them
            // Pattern endpoints are fixed (actual pivot connection points)
            // We want each pattern, when at the center of the stack (offsetValue=0), to pass through center pivots
            // Then stack offsets position beams within the centered patterns
            
            const stackDirNorm = vNorm(stackDir);
            
            // CRITICAL FIX: Calculate exact average position of all beam midpoints when stacked
            // Account for both pattern midpoints AND their stack offsets
            let totalPosition = {x: 0, y: 0, z: 0};
            for (let vi = 0; vi < state.vStackCount; vi++) {
                const offsetValue = getVStackBeamCenterOffset(vi, stackBeamWidths);
                const stackOffsetVec = vScale(stackDirNorm, offsetValue);
                // Determine pattern: normally A, B, A, B... but reverse if vStackReverse is true
                const isPatternA = state.vStackReverse ? (vi % 2 !== 0) : (vi % 2 === 0);
                const patternMid = isPatternA ? patternA_mid : patternB_mid;
                // Actual position = pattern midpoint + stack offset (centering offset will be added later)
                const actualPos = vAdd(patternMid, stackOffsetVec);
                totalPosition = vAdd(totalPosition, actualPos);
            }
            const avgActualMid = vScale(totalPosition, 1 / state.vStackCount);
            
            // Calculate offset needed so average position aligns with center pivot
            const offsetToCenter = vSub(centerMid, avgActualMid);
            
            // Project onto stack direction to get global centering offset
            const globalCenteringOffset = vScale(stackDirNorm, vDot(offsetToCenter, stackDirNorm));
            
            // Apply same offset to both patterns - this centers the entire stack
            const centeringOffsetA = globalCenteringOffset;
            const centeringOffsetB = globalCenteringOffset;
            
            for (let vi = 0; vi < state.vStackCount; vi++) {
                // Calculate stack offset (perpendicular to beam, centered around pivot)
                const offsetValue = getVStackBeamCenterOffset(vi, stackBeamWidths);
                const stackOffset = vScale(stackDirNorm, offsetValue);
                const beamDims = getVBeamDimsForStackIndex(vi);
                
                // Determine which pattern this beam uses (alternating: A, B, A, B, ...)
                // When vStackReverse is true, the order is reversed (B, A, B, A, ...)
                const isPatternA = state.vStackReverse ? (vi % 2 !== 0) : (vi % 2 === 0);
                
                // Get the pattern endpoints (actual pivot connection points)
                let patternBot, patternTop, patternDir, centeringOffset;
                if (isPatternA) {
                    patternBot = pBotInner;
                    patternTop = pTopOuter;
                    patternDir = patternA_dir;
                    centeringOffset = centeringOffsetA;
                } else {
                    patternBot = pBotOuter;
                    patternTop = pTopInner;
                    patternDir = patternB_dir;
                    centeringOffset = centeringOffsetB;
                }
                
                // Calculate beam endpoints:
                // 1. Pattern endpoints (fixed pivot points - actual connection points)
                // 2. Pattern-specific centering offset (centers this pattern on center pivot)
                // 3. Stack offset (positions beam within the centered stack)
                // When offsetValue = 0, the beam passes through center pivots
                const beamStart = vAdd(vAdd(patternBot, centeringOffset), stackOffset);
                const beamEnd = vAdd(vAdd(patternTop, centeringOffset), stackOffset);
                
                // Extend beam ends by vertEndOffset along the beam direction
                const extStart = vAdd(beamStart, vScale(patternDir, -state.vertEndOffset));
                const extEnd = vAdd(beamEnd, vScale(patternDir, state.vertEndOffset));
                
                beams.push(new Beam3D(extStart, extEnd, beamDims.w, beamDims.t, woodColor, {
                    moduleIndex: i,
                    stackType: 'vertical',
                    stackId: i,
                    patternId: isPatternA ? 'A' : 'B'
                }));
            }
            
            // --- CAP UPRIGHTS (for arch mode) ---
            // Add vertical uprights on the open end of the first module
            if (i === 0 && state.archCapUprights) {
                // Cap uprights use the LEFT side pivot points (bl/tl) instead of right side (br/tr)
                const capBotInner = map(loc.bl, yMin);
                const capTopOuter = map(loc.tl, yMax);
                const capBotOuter = map(loc.tl, yMin);
                const capTopInner = map(loc.bl, yMax);
                
                // Calculate center pivot points for cap stack
                const capPivotBotCenter = vScale(vAdd(capBotInner, capBotOuter), 0.5);
                const capPivotTopCenter = vScale(vAdd(capTopOuter, capTopInner), 0.5);
                
                // Pattern vectors for cap uprights
                const capPatternA_bot = capBotInner;
                const capPatternA_top = capTopOuter;
                const capPatternA_dir = vNorm(vSub(capPatternA_top, capPatternA_bot));
                const capPatternA_mid = vScale(vAdd(capPatternA_bot, capPatternA_top), 0.5);
                
                const capPatternB_bot = capBotOuter;
                const capPatternB_top = capTopInner;
                const capPatternB_dir = vNorm(vSub(capPatternB_top, capPatternB_bot));
                const capPatternB_mid = vScale(vAdd(capPatternB_bot, capPatternB_top), 0.5);
                
                // Calculate stack direction for cap uprights
                let capStackDir = vNorm(vCross(capPatternA_dir, capPatternB_dir));
                if (vMag(capStackDir) < 0.1) {
                    const capAvgDir = vNorm(vScale(vAdd(capPatternA_dir, capPatternB_dir), 0.5));
                    capStackDir = vNorm(vCross(capAvgDir, up));
                }
                if (vMag(capStackDir) < 0.1) {
                    capStackDir = vNorm(vCross(capPatternA_dir, up));
                }
                
                const capStackDirNorm = vNorm(capStackDir);
                const capCenterMid = vScale(vAdd(capPivotBotCenter, capPivotTopCenter), 0.5);
                
                // Calculate centering offset for cap stack
                let capTotalPosition = {x: 0, y: 0, z: 0};
                for (let j = 0; j < state.vStackCount; j++) {
                    const offsetValue = getVStackBeamCenterOffset(j, stackBeamWidths);
                    const stackOffsetVec = vScale(capStackDirNorm, offsetValue);
                    const isPatternA = state.vStackReverse ? (j % 2 !== 0) : (j % 2 === 0);
                    const patternMid = isPatternA ? capPatternA_mid : capPatternB_mid;
                    capTotalPosition = vAdd(capTotalPosition, vAdd(patternMid, stackOffsetVec));
                }
                const capAvgMid = vScale(capTotalPosition, 1 / state.vStackCount);
                const capOffsetToCenter = vSub(capCenterMid, capAvgMid);
                const capCenteringOffset = vScale(capStackDirNorm, vDot(capOffsetToCenter, capStackDirNorm));
                
                // Create cap upright beams
                for (let j = 0; j < state.vStackCount; j++) {
                    const offsetValue = getVStackBeamCenterOffset(j, stackBeamWidths);
                    const stackOffset = vScale(capStackDirNorm, offsetValue);
                    const beamDims = getVBeamDimsForStackIndex(j);
                    const isPatternA = state.vStackReverse ? (j % 2 !== 0) : (j % 2 === 0);
                    
                    let patternBot, patternTop, patternDir;
                    if (isPatternA) {
                        patternBot = capBotInner;
                        patternTop = capTopOuter;
                        patternDir = capPatternA_dir;
                    } else {
                        patternBot = capBotOuter;
                        patternTop = capTopInner;
                        patternDir = capPatternB_dir;
                    }
                    
                    const beamStart = vAdd(vAdd(patternBot, capCenteringOffset), stackOffset);
                    const beamEnd = vAdd(vAdd(patternTop, capCenteringOffset), stackOffset);
                    const extStart = vAdd(beamStart, vScale(patternDir, -state.vertEndOffset));
                    const extEnd = vAdd(beamEnd, vScale(patternDir, state.vertEndOffset));
                    
                    beams.push(new Beam3D(extStart, extEnd, beamDims.w, beamDims.t, woodColor, {
                        moduleIndex: i,
                        stackType: 'vertical-cap',
                        stackId: -1  // Cap stack has special ID
                    }));
                }
            }
        }
        
        // --- FIXED STRAIGHT BEAMS (non-folding, constant spacing) ---
        // These are STRAIGHT vertical beams (not crossing like scissor uprights)
        // Each beam goes straight up from bottom to top at the same radial position
        if (state.useFixedBeams && zHeight > 1) {
            const innerDims = getVBeamDimsForPivot(true);
            const outerDims = getVBeamDimsForPivot(false);
            const hT = state.hBeamT; // Horizontal beam thickness for offset
            
            // Calculate Y positions for flush alignment with horizontal beams
            // Bottom horizontal beam top surface is at y = hT/2
            // Top horizontal beam bottom surface is at y = topH - hT/2
            const bottomFlushY = hT / 2;
            const topFlushY = topH - hT / 2;
            
            // STRAIGHT beams: each beam goes straight up at the same X/Z position
            // Inner beam: straight up at inner pivot position (br)
            const innerBeamStart = {x: pBotInner.x, y: bottomFlushY, z: pBotInner.z};
            const innerBeamEnd = {x: pTopInner.x, y: topFlushY, z: pTopInner.z};
            
            const innerBeamLen = vMag(vSub(innerBeamEnd, innerBeamStart));
            if (innerBeamLen > 0.1) {
                beams.push(new Beam3D(innerBeamStart, innerBeamEnd, innerDims.w, innerDims.t, woodColor, {
                    moduleIndex: i,
                    stackType: 'fixed-beam',
                    stackId: i * 2 + 0
                }));
            }
            
            // Outer beam: straight up at outer pivot position (tr)
            const outerBeamStart = {x: pBotOuter.x, y: bottomFlushY, z: pBotOuter.z};
            const outerBeamEnd = {x: pTopOuter.x, y: topFlushY, z: pTopOuter.z};
            
            const outerBeamLen = vMag(vSub(outerBeamEnd, outerBeamStart));
            if (outerBeamLen > 0.1) {
                beams.push(new Beam3D(outerBeamStart, outerBeamEnd, outerDims.w, outerDims.t, woodColor, {
                    moduleIndex: i,
                    stackType: 'fixed-beam',
                    stackId: i * 2 + 1
                }));
            }
            
            // --- FIXED CAP BEAMS (for arch mode with cap uprights) ---
            if (i === 0 && state.archCapUprights) {
                // Cap beams use LEFT side pivot points (bl/tl) instead of right side (br/tr)
                const capBotInner = map(loc.bl, yMin);
                const capTopInner = map(loc.bl, yMax);
                const capBotOuter = map(loc.tl, yMin);
                const capTopOuter = map(loc.tl, yMax);
                
                // Cap inner beam: straight up at inner position (bl)
                const capInnerStart = {x: capBotInner.x, y: bottomFlushY, z: capBotInner.z};
                const capInnerEnd = {x: capTopInner.x, y: topFlushY, z: capTopInner.z};
                
                const capInnerLen = vMag(vSub(capInnerEnd, capInnerStart));
                if (capInnerLen > 0.1) {
                    beams.push(new Beam3D(capInnerStart, capInnerEnd, innerDims.w, innerDims.t, woodColor, {
                        moduleIndex: i,
                        stackType: 'fixed-beam-cap',
                        stackId: -2
                    }));
                }
                
                // Cap outer beam: straight up at outer position (tl)
                const capOuterStart = {x: capBotOuter.x, y: bottomFlushY, z: capBotOuter.z};
                const capOuterEnd = {x: capTopOuter.x, y: topFlushY, z: capTopOuter.z};
                
                const capOuterLen = vMag(vSub(capOuterEnd, capOuterStart));
                if (capOuterLen > 0.1) {
                    beams.push(new Beam3D(capOuterStart, capOuterEnd, outerDims.w, outerDims.t, woodColor, {
                        moduleIndex: i,
                        stackType: 'fixed-beam-cap',
                        stackId: -3
                    }));
                }
            }
        }
        
        // Place brackets and bolts at pivot points
        // Brackets are 3D boxes that connect horizontal beams to vertical beams
        // Only create brackets/bolts if we have vertical elements (uprights or fixed beams)
        if((state.showBrackets || state.showBolts) && zHeight > 1) {
            // The horizontal pivot points where vertical beams connect
            const hPivotBotInner = map(loc.br, 0);  // Bottom ring, inner pivot
            const hPivotBotOuter = map(loc.tr, 0);  // Bottom ring, outer pivot
            const hPivotTopInner = map(loc.br, topH); // Top ring, inner pivot
            const hPivotTopOuter = map(loc.tr, topH); // Top ring, outer pivot
            
            // Calculate pattern directions (needed for brackets/bolts)
            // These are the same for both vertical uprights and fixed beams
            const patternA_dir = vNorm(vSub(pTopOuter, pBotInner));
            const patternB_dir = vNorm(vSub(pTopInner, pBotOuter));
            const avgPatternDir = vNorm(vScale(vAdd(patternA_dir, patternB_dir), 0.5));
            
            // Calculate stack direction and total thickness
            let stackDirNorm, totalThick, centerMid;
            if (state.useFixedBeams) {
                // For fixed beams, use a simple stack direction (perpendicular to average pattern)
                const up = {x: 0, y: 1, z: 0};
                stackDirNorm = vNorm(vCross(avgPatternDir, up));
                if (vMag(stackDirNorm) < 0.1) {
                    stackDirNorm = vNorm(vCross(patternA_dir, up));
                }
                totalThick = state.vBeamW; // Single beam thickness for fixed beams
                // Center mid point for fixed beams (midpoint between bottom and top center pivots)
                const pivotBotCenter = vScale(vAdd(pBotInner, pBotOuter), 0.5);
                const pivotTopCenter = vScale(vAdd(pTopOuter, pTopInner), 0.5);
                centerMid = vScale(vAdd(pivotBotCenter, pivotTopCenter), 0.5);
            } else {
                // Use values from vertical uprights block if available
                // Otherwise calculate defaults
                const up = {x: 0, y: 1, z: 0};
                stackDirNorm = vNorm(vCross(avgPatternDir, up));
                if (vMag(stackDirNorm) < 0.1) {
                    stackDirNorm = vNorm(vCross(patternA_dir, up));
                }
                totalThick = calculateVStackTotalThickness();
                // Center mid point (midpoint between bottom and top center pivots)
                const pivotBotCenter = vScale(vAdd(pBotInner, pBotOuter), 0.5);
                const pivotTopCenter = vScale(vAdd(pTopOuter, pTopInner), 0.5);
                centerMid = vScale(vAdd(pivotBotCenter, pivotTopCenter), 0.5);
            }
            
            // Vertical beam direction (for bracket orientation)
            const vBeamDir = avgPatternDir;
            
            // Bracket dimensions now come from state (bracketWidth, bracketDepth, etc.)
            
            // Vertical stack bolt direction (horizontal, through the stack)
            const vBoltDir = stackDirNorm;
            // Use state bolt length (auto-calculated or user-defined)
            // For odd stacks > 2, inner and outer bolts have different lengths
            const splitBolts = needsSplitVBolts();
            const vBoltLength = state.vBoltLength || (totalThick + 1);
            const vBoltInnerLength = splitBolts ? (state.vBoltInnerLength || vBoltLength) : vBoltLength;
            const vBoltOuterLength = splitBolts ? (state.vBoltOuterLength || vBoltLength) : vBoltLength;
            
            // Helper to create a 3D bracket at a pivot point
            // moduleRotation: the angular position of this module around the ring (curRot)
            // moduleIndex: the index of this module (0 to modules-1)
            // 
            // BRACKET POSITIONING:
            // - Bracket base sits at a fixed position relative to horizontal beams
            // - Hole offset (effectiveHoleOffset) determines where the hole is within the bracket
            // - The pivot point (yMin/yMax) is where the hole is, which affects structure height
            // - Horizontal rings adjust their positions to keep holes aligned with bolts
            const createBracket = (pivotPos, isBottom, beamDir, moduleRotation, moduleIndex) => {
                    // Use the effectiveHoleOffset and actualBracketHeight calculated in outer scope
                    // These determine the bracket geometry and hole position
                    
                    // Bracket positions relative to horizontal beam STACKS (fixed)
                    // Bottom bracket: base sits on top of bottom horizontal stack
                    // Top bracket: base (after flip) is at bottom of top horizontal stack
                    let bracketBottomY;
                    if (isBottom) {
                        // Bottom bracket: base at top of bottom stack (hStackThick/2), no flip
                        // Bracket extends upward from there
                        bracketBottomY = hStackThick / 2;
                    } else {
                        // Top bracket: after 180° flip, extends downward from rotation point
                        // Rotation point is at bottom of top stack (topH - hStackThick/2)
                        // After flip, the bracket extends downward, so "bottomY" = rotation point
                        bracketBottomY = topH - hStackThick / 2;
                    }
                    
                    // The pivot/hole Y position (already calculated in outer scope)
                    const pivotY = isBottom ? yMin : yMax;
                    const sideHoleY = pivotY;
                    
                    const right = vNorm(vCross(beamDir, {x:0, y:1, z:0}));
                    
                    return {
                        pos: pivotPos,
                        originalPosY: pivotPos.y, // Store original Y for transformation reference
                        bottomY: bracketBottomY,
                        sideHoleY: sideHoleY,
                        actualHeight: actualBracketHeight, // From outer scope
                        holeDistance: effectiveHoleOffset, // Distance from closed end to hole center (from outer scope)
                        holeOffset: holeOffset, // User's specified offset (from outer scope)
                        width: state.bracketWidth || 2.0,
                        depth: state.bracketDepth || 3.0,
                        wallThickness: wallThickness,
                        innerWidth: state.bracketInnerWidth || 1.5,
                        holeDiameter: holeDiameter,
                        beamDir: beamDir,
                        right: right,
                        isBottom: isBottom,
                        boltDir: vBoltDir,
                        moduleRotation: moduleRotation, // Store module's angular position for consistent orientation
                        moduleIndex: moduleIndex, // Store module index for alternating rotation offset
                        z: pivotPos.y
                    };
                };
                
                // Helper to create horizontal bolt (through vertical stack)
                // subType: 'inner', 'outer', or 'center' for tracking different bolt sizes
                const createHorizontalBolt = (pos, dir, length, subType = 'full') => {
                    const boltRadius = getBoltRadius();
                    const bracketWall = state.bracketWallThickness || 0.25;
                    
                    // Calculate stack thickness based on which beams this bolt passes through
                    let beamCount;
                    let headSide; // +1 for positive dir side, -1 for negative dir side
                    let headExtraThickness; // Additional thickness (e.g., bracket wall)
                    
                    if (subType === 'inner') {
                        // Inner bolts: pass through ceil(stackCount/2) beams
                        // Head rests on the outer beam (positive side, away from bracket)
                        beamCount = Math.ceil(state.vStackCount / 2);
                        headSide = +1;
                        headExtraThickness = 0; // No bracket wall on head side
                    } else if (subType === 'outer') {
                        // Outer bolts: pass through floor(stackCount/2) beams
                        // Head rests on outer bracket wall (negative side, bracket is between head and beams)
                        beamCount = Math.floor(state.vStackCount / 2);
                        headSide = -1;
                        headExtraThickness = bracketWall; // Head rests on bracket wall
                    } else {
                        // Center or full bolts: pass through all beams
                        // Head on positive side
                        beamCount = state.vStackCount;
                        headSide = +1;
                        headExtraThickness = 0;
                    }
                    
                    const stackThickness = calculateVBoltStackBeamWidth(subType) + Math.max(0, beamCount - 1) * (state.vStackGap || 0);
                    
                    return {
                        start: vAdd(pos, vScale(dir, -length / 2)),
                        end: vAdd(pos, vScale(dir, length / 2)),
                        center: pos,
                        dir: dir,
                        length: length,
                        radius: boltRadius,
                        headRadius: boltRadius * 1.8,
                        headHeight: boltRadius * 1.2,
                        boltType: 'vstack',
                        boltSubType: subType, // 'inner', 'outer', or 'center'
                        stackThickness: stackThickness, // Thickness of beams bolt passes through
                        headSide: headSide, // Which side the head is on (+1 or -1)
                        headExtraThickness: headExtraThickness, // Extra thickness for bracket wall etc.
                        z: pos.y
                    };
            };
            
            // Helper to create vertical bolt (through horizontal stack at center)
            const createVerticalBolt = (xzPos, yBottom, yTop) => {
                    const boltRadius = getBoltRadius();
                    const boltStart = {x: xzPos.x, y: yBottom, z: xzPos.z};
                    const boltEnd = {x: xzPos.x, y: yTop, z: xzPos.z};
                    const boltCenter = {x: xzPos.x, y: (yBottom + yTop) / 2, z: xzPos.z};
                    const length = yTop - yBottom;
                    // Stack thickness for H-stack center bolts
                    const stackThickness = state.hStackCount * hT + Math.max(0, state.hStackCount - 1) * (state.hStackGap || 0);
                    return {
                        start: boltStart,
                        end: boltEnd,
                        center: boltCenter,
                        dir: {x: 0, y: 1, z: 0},
                        length: length,
                        radius: boltRadius,
                        headRadius: boltRadius * 1.8,
                        headHeight: boltRadius * 1.2,
                        boltType: 'hstack',
                        boltSubType: 'center',
                        stackThickness: stackThickness,
                        headSide: +1, // Head on positive Y (top of stack)
                        headExtraThickness: 0,
                        z: boltCenter.y
                    };
            };
            
            // Helper to create H-pivot bolt (vertical, through H-beams into bracket)
            // isBottom: true for bottom ring brackets, false for top ring
            const createHPivotBolt = (pivotPos, isBottom) => {
                    const boltRadius = getBoltRadius();
                    const boltLength = state.hPivotBoltLength || calculateHPivotBoltLength();
                    
                    // Bolt goes vertically through horizontal beam stack
                    // Center the bolt at the same Y level as H-center bolts:
                    // - Bottom ring: Y=0 (center of bottom horizontal stack)
                    // - Top ring: Y=topH (center of top horizontal stack)
                    const centerY = isBottom ? 0 : topH;
                    
                    const yBottom = centerY - boltLength / 2;
                    const yTop = centerY + boltLength / 2;
                    
                    const boltStart = {x: pivotPos.x, y: yBottom, z: pivotPos.z};
                    const boltEnd = {x: pivotPos.x, y: yTop, z: pivotPos.z};
                    const boltCenter = {x: pivotPos.x, y: centerY, z: pivotPos.z};
                    
                    // Stack thickness for H-pivot bolts (same as H-center bolts)
                    const stackThickness = state.hStackCount * hT + Math.max(0, state.hStackCount - 1) * (state.hStackGap || 0);
                    
                    return {
                        start: boltStart,
                        end: boltEnd,
                        center: boltCenter,
                        dir: {x: 0, y: 1, z: 0},
                        length: boltLength,
                        radius: boltRadius,
                        headRadius: boltRadius * 1.8,
                        headHeight: boltRadius * 1.2,
                        boltType: 'hpivot',
                        boltSubType: isBottom ? 'bottom' : 'top',
                        stackThickness: stackThickness,
                        headSide: +1, // Head on positive Y (top of stack)
                        headExtraThickness: 0,
                        z: boltCenter.y
                    };
            };
            
            if(state.showBrackets || hwUseFullDetailAssemblies()) {
                // Bottom ring brackets (U opens upward)
                // Inner brackets sit on Pattern A beams, outer brackets sit on Pattern B beams
                if (state.showBrackets) {
                    brackets.push(createBracket(hPivotBotInner, true, patternA_dir, curRot, i));
                    brackets.push(createBracket(hPivotTopInner, false, patternA_dir, curRot, i));
                }
                const outerBotBracket = createBracket(hPivotBotOuter, true, patternB_dir, curRot, i);
                const outerTopBracket = createBracket(hPivotTopOuter, false, patternB_dir, curRot, i);
                if (hwUseFullDetailAssemblies()) {
                    if (window.__hwDebug) window.__hwDebug.push({mod:i, hPivotBotOuter:{...hPivotBotOuter}, outerBotBracketPos:{...outerBotBracket.pos}, pBotOuter:{...pBotOuter}});
                    hwAddOuterAssemblyPlacement(hardwareAssemblyPlacements, outerBotBracket, vBoltDir, pBotOuter);
                    hwAddOuterAssemblyPlacement(hardwareAssemblyPlacements, outerTopBracket, vBoltDir, pTopOuter);
                } else if (state.showBrackets) {
                    brackets.push(outerBotBracket);
                    brackets.push(outerTopBracket);
                }
            }
            
            if(state.showBolts) {
                // === H-PIVOT BOLTS (vertical, through H-beams into brackets) ===
                // These bolts pass through the horizontal beam stack and into the bracket base
                // 4 per module: inner/outer × bottom/top
                const hPivotBotInnerBolt = createHPivotBolt(hPivotBotInner, true);
                const hPivotBotOuterBolt = createHPivotBolt(hPivotBotOuter, true);
                const hPivotTopInnerBolt = createHPivotBolt(hPivotTopInner, false);
                const hPivotTopOuterBolt = createHPivotBolt(hPivotTopOuter, false);
                
                bolts.push(hPivotBotInnerBolt);
                if (!hwUseFullDetailAssemblies()) bolts.push(hPivotBotOuterBolt);
                bolts.push(hPivotTopInnerBolt);
                if (!hwUseFullDetailAssemblies()) bolts.push(hPivotTopOuterBolt);
                
                // H-stack washers for H-pivot bolts
                if (state.hWasherEnabled && state.hStackCount > 1) {
                    const hWasherConfig = {
                        enabled: state.hWasherEnabled,
                        id: state.hWasherID,
                        od: state.hWasherOD,
                        thickness: state.hWasherThickness
                    };
                    // Calculate radial direction for horizontal stack (perpendicular to vertical bolt)
                    const hPivotRadialInner = vNorm({x: hPivotBotInner.x, y: 0, z: hPivotBotInner.z});
                    const hPivotRadialOuter = vNorm({x: hPivotBotOuter.x, y: 0, z: hPivotBotOuter.z});
                    if (vMag(hPivotRadialInner) < 0.1) hPivotRadialInner = {x: 1, y: 0, z: 0};
                    if (vMag(hPivotRadialOuter) < 0.1) hPivotRadialOuter = {x: 1, y: 0, z: 0};
                    washers.push(...createWashersForBolt(hPivotBotInnerBolt, state.hStackCount, state.hStackGap, hT, hWasherConfig, hPivotRadialInner));
                    if (!hwUseFullDetailAssemblies()) washers.push(...createWashersForBolt(hPivotBotOuterBolt, state.hStackCount, state.hStackGap, hT, hWasherConfig, hPivotRadialOuter));
                    washers.push(...createWashersForBolt(hPivotTopInnerBolt, state.hStackCount, state.hStackGap, hT, hWasherConfig, hPivotRadialInner));
                    if (!hwUseFullDetailAssemblies()) washers.push(...createWashersForBolt(hPivotTopOuterBolt, state.hStackCount, state.hStackGap, hT, hWasherConfig, hPivotRadialOuter));
                }
                
                // === VERTICAL MODULE BOLTS (horizontal orientation) ===
                // These go through the vertical beam stack at the actual pivot points
                // For odd stacks > 2: inner bolts are longer (more beams), outer bolts are shorter
                
                // 1. Bottom pivot bolts - at yMin (where vertical beams attach to bottom ring)
                const botInnerBolt = createHorizontalBolt(pBotInner, vBoltDir, vBoltInnerLength, 'inner');
                const botOuterBolt = createHorizontalBolt(pBotOuter, vBoltDir, vBoltOuterLength, 'outer');
                bolts.push(botInnerBolt);
                if (!hwUseFullDetailAssemblies()) bolts.push(botOuterBolt);
                
                // 2. Top pivot bolts - at yMax (where vertical beams attach to top ring)
                const topOuterBolt = createHorizontalBolt(pTopOuter, vBoltDir, vBoltOuterLength, 'outer');
                const topInnerBolt = createHorizontalBolt(pTopInner, vBoltDir, vBoltInnerLength, 'inner');
                if (!hwUseFullDetailAssemblies()) bolts.push(topOuterBolt);
                bolts.push(topInnerBolt);
                
                // 3. CENTER pivot bolt (horizontal, where ALL beams cross - uses full length)
                const centerBolt = createHorizontalBolt(centerMid, vBoltDir, vBoltLength, 'center');
                bolts.push(centerBolt);
                
                // V-stack washers for vertical module bolts
                if (state.vWasherEnabled && state.vStackCount > 1) {
                    const vWasherConfig = {
                        enabled: state.vWasherEnabled,
                        id: state.vWasherID,
                        od: state.vWasherOD,
                        thickness: state.vWasherThickness
                    };
                    // Use the same stack direction as the vertical beams
                    const vWasherBeamSize = (needsSplitVBeamDimensions() && !isVBeamDimensionsLinked())
                        ? getVStackBeamWidths()
                        : state.vBeamW;
                    washers.push(...createWashersForBolt(botInnerBolt, state.vStackCount, state.vStackGap, vWasherBeamSize, vWasherConfig, stackDirNorm));
                    if (!hwUseFullDetailAssemblies()) washers.push(...createWashersForBolt(botOuterBolt, state.vStackCount, state.vStackGap, vWasherBeamSize, vWasherConfig, stackDirNorm));
                    if (!hwUseFullDetailAssemblies()) washers.push(...createWashersForBolt(topOuterBolt, state.vStackCount, state.vStackGap, vWasherBeamSize, vWasherConfig, stackDirNorm));
                    washers.push(...createWashersForBolt(topInnerBolt, state.vStackCount, state.vStackGap, vWasherBeamSize, vWasherConfig, stackDirNorm));
                    washers.push(...createWashersForBolt(centerBolt, state.vStackCount, state.vStackGap, vWasherBeamSize, vWasherConfig, stackDirNorm));
                }
                
                // 4. CAP UPRIGHT bolts (for first module when cap uprights enabled)
                if (i === 0 && state.archCapUprights) {
                        // Cap upright pivot positions (using bl/tl instead of br/tr)
                        const capBotInner = map(loc.bl, yMin);
                        const capTopOuter = map(loc.tl, yMax);
                        const capBotOuter = map(loc.tl, yMin);
                        const capTopInner = map(loc.bl, yMax);
                        const capCenterMid = vScale(vAdd(
                            vScale(vAdd(capBotInner, capBotOuter), 0.5),
                            vScale(vAdd(capTopOuter, capTopInner), 0.5)
                        ), 0.5);
                        
                        // Calculate cap stack direction
                        const capPatternA_dir = vNorm(vSub(capTopOuter, capBotInner));
                        const capPatternB_dir = vNorm(vSub(capTopInner, capBotOuter));
                        let capStackDir = vNorm(vCross(capPatternA_dir, capPatternB_dir));
                        if (vMag(capStackDir) < 0.1) {
                            const capAvgDir = vNorm(vScale(vAdd(capPatternA_dir, capPatternB_dir), 0.5));
                            capStackDir = vNorm(vCross(capAvgDir, {x:0, y:1, z:0}));
                        }
                        const capBoltDir = vNorm(capStackDir);
                        
                        // Bottom pivot bolts for cap uprights (same inner/outer logic)
                        bolts.push(createHorizontalBolt(capBotInner, capBoltDir, vBoltInnerLength, 'inner'));
                        if (!hwUseFullDetailAssemblies()) bolts.push(createHorizontalBolt(capBotOuter, capBoltDir, vBoltOuterLength, 'outer'));
                        
                        // Top pivot bolts for cap uprights
                        if (!hwUseFullDetailAssemblies()) bolts.push(createHorizontalBolt(capTopOuter, capBoltDir, vBoltOuterLength, 'outer'));
                        bolts.push(createHorizontalBolt(capTopInner, capBoltDir, vBoltInnerLength, 'inner'));
                        
                    // Center pivot bolt for cap uprights (full length)
                    bolts.push(createHorizontalBolt(capCenterMid, capBoltDir, vBoltLength, 'center'));
                }
            }
            
            // CAP UPRIGHT brackets (for first module when cap uprights enabled)
            if (i === 0 && state.archCapUprights && (state.showBrackets || hwUseFullDetailAssemblies())) {
                    const capBotInner = map(loc.bl, 0);
                    const capBotOuter = map(loc.tl, 0);
                    const capTopInner = map(loc.bl, topH);
                    const capTopOuter = map(loc.tl, topH);
                    
                    // Cap pattern directions (same logic as main vertical modules)
                    const capPatternA_dir = vNorm(vSub(capTopOuter, capBotInner));
                    const capPatternB_dir = vNorm(vSub(capTopInner, capBotOuter));
                    let capStackDir = vNorm(vCross(capPatternA_dir, capPatternB_dir));
                    if (vMag(capStackDir) < 0.1) {
                        const capAvgDir = vNorm(vScale(vAdd(capPatternA_dir, capPatternB_dir), 0.5));
                        capStackDir = vNorm(vCross(capAvgDir, {x:0, y:1, z:0}));
                    }
                    const capBoltDir = vNorm(capStackDir);
                    
                    // Bottom ring brackets for cap uprights
                    // Inner brackets on Pattern A, outer brackets on Pattern B
                    if (state.showBrackets) {
                        brackets.push(createBracket(capBotInner, true, capPatternA_dir, curRot, i));
                        brackets.push(createBracket(capTopInner, false, capPatternA_dir, curRot, i));
                    }
                    const capOuterBotBracket = createBracket(capBotOuter, true, capPatternB_dir, curRot, i);
                    const capOuterTopBracket = createBracket(capTopOuter, false, capPatternB_dir, curRot, i);
                    if (hwUseFullDetailAssemblies()) {
                        hwAddOuterAssemblyPlacement(hardwareAssemblyPlacements, capOuterBotBracket, capBoltDir, map(loc.tl, yMin));
                        hwAddOuterAssemblyPlacement(hardwareAssemblyPlacements, capOuterTopBracket, capBoltDir, map(loc.tl, yMax));
                    } else if (state.showBrackets) {
                        brackets.push(capOuterBotBracket);
                        brackets.push(capOuterTopBracket);
                    }
            }
        }
        
        // === HORIZONTAL MODULE BOLTS (vertical orientation) ===
        // These go through the horizontal beam stacks at the center pivot
        if(state.showBolts) {
            // Calculate the actual intersection point of the horizontal X pattern
            // Line 1: from visLoc.bl to visLoc.tr (pattern A)
            // Line 2: from visLoc.br to visLoc.tl (pattern B)
            // Use parametric line intersection formula
            const bl = visLoc.bl, tr = visLoc.tr, br = visLoc.br, tl = visLoc.tl;
            const d1x = tr.x - bl.x, d1y = tr.y - bl.y;
            const d2x = tl.x - br.x, d2y = tl.y - br.y;
            const denom = d1x * d2y - d1y * d2x;
            
            let hCenter2D;
            if (Math.abs(denom) > 0.0001) {
                // Lines intersect - find intersection point
                const t = ((br.x - bl.x) * d2y - (br.y - bl.y) * d2x) / denom;
                hCenter2D = {x: bl.x + t * d1x, y: bl.y + t * d1y};
            } else {
                // Lines are parallel - use midpoint as fallback
                hCenter2D = vScale(vAdd(vAdd(vAdd(bl, tr), br), tl), 0.25);
            }
            
            // Map to 3D at bottom and top ring heights
            const hCenterBot = map(hCenter2D, 0);
            const hCenterTop = map(hCenter2D, topH);
            
            // Use state bolt length (auto-calculated or user-defined)
            const hBoltLength = state.hBoltLength || (state.hStackCount * hT + 1);
            const boltRadius = getBoltRadius();
            
            // Stack thickness for H-center bolts
            const hCenterStackThickness = state.hStackCount * hT + Math.max(0, state.hStackCount - 1) * (state.hStackGap || 0);
            
            // Bottom horizontal ring center bolt (vertical)
            const hCenterBotBolt = {
                start: {x: hCenterBot.x, y: -hBoltLength / 2, z: hCenterBot.z},
                end: {x: hCenterBot.x, y: hBoltLength / 2, z: hCenterBot.z},
                center: hCenterBot,
                dir: {x: 0, y: 1, z: 0},
                length: hBoltLength,
                radius: boltRadius,
                headRadius: boltRadius * 1.8,
                headHeight: boltRadius * 1.2,
                boltType: 'hstack',
                stackThickness: hCenterStackThickness,
                headSide: +1, // Head on positive Y (top of stack)
                headExtraThickness: 0,
                z: hCenterBot.y
            };
            bolts.push(hCenterBotBolt);
            
            // Top horizontal ring center bolt (vertical)
            const hCenterTopBolt = {
                start: {x: hCenterTop.x, y: topH - hBoltLength / 2, z: hCenterTop.z},
                end: {x: hCenterTop.x, y: topH + hBoltLength / 2, z: hCenterTop.z},
                center: hCenterTop,
                dir: {x: 0, y: 1, z: 0},
                length: hBoltLength,
                radius: boltRadius,
                headRadius: boltRadius * 1.8,
                headHeight: boltRadius * 1.2,
                boltType: 'hstack',
                stackThickness: hCenterStackThickness,
                headSide: +1, // Head on positive Y (top of stack)
                headExtraThickness: 0,
                z: hCenterTop.y
            };
            bolts.push(hCenterTopBolt);
            
            // H-stack washers for H-center bolts
            if (state.hWasherEnabled && state.hStackCount > 1) {
                const hWasherConfig = {
                    enabled: state.hWasherEnabled,
                    id: state.hWasherID,
                    od: state.hWasherOD,
                    thickness: state.hWasherThickness
                };
                // Calculate radial direction for horizontal stack (perpendicular to vertical bolt)
                let hCenterRadial = vNorm({x: hCenterBot.x, y: 0, z: hCenterBot.z});
                if (vMag(hCenterRadial) < 0.1) hCenterRadial = {x: 1, y: 0, z: 0}; // Fallback
                const hT = state.hBeamT || 1.5;
                washers.push(...createWashersForBolt(hCenterBotBolt, state.hStackCount, state.hStackGap, hT, hWasherConfig, hCenterRadial));
                washers.push(...createWashersForBolt(hCenterTopBolt, state.hStackCount, state.hStackGap, hT, hWasherConfig, hCenterRadial));
            }
        }
        
        // Track maximum radius for diameter calculation
        const currentRadius = vMag(map(visLoc.tr, 0));
        if (currentRadius > maxRad) maxRad = currentRadius;

        // Calculate next module position and rotation
        const nextRotation = curRot + relativeRotation;
        const nextBlX = loc.bl.x * Math.cos(nextRotation) - loc.bl.y * Math.sin(nextRotation);
        const nextBlY = loc.bl.x * Math.sin(nextRotation) + loc.bl.y * Math.cos(nextRotation);
        const currentBrX = loc.br.x * Math.cos(curRot) - loc.br.y * Math.sin(curRot);
        const currentBrY = loc.br.x * Math.sin(curRot) + loc.br.y * Math.cos(curRot);
        curPos.x = (curPos.x + currentBrX) - nextBlX;
        curPos.y = (curPos.y + currentBrY) - nextBlY;
        curRot = nextRotation;
    }
    
    // Calculate max height using the new hole offset logic
    // The hole offset determines the pivot point height, which affects structure height
    const calcHT = state.hBeamT || 1.5;
    const calcHStackCount = state.hStackCount || 1;
    const calcHStackGap = state.hStackGap || 0;
    const calcHStackThick = calcHStackCount * calcHT + (calcHStackCount - 1) * calcHStackGap;
    const calcBracketHeight = state.bracketHeight || 3.0;
    const calcHoleDiameter = state.bracketHoleDiameter || 0.375;
    const calcWallThickness = state.bracketWallThickness || 0.25;
    const calcUserHoleOffset = state.bracketHoleDistance;
    const calcDefaultHoleOffset = calcBracketHeight / 2;
    const calcHoleOffset = (calcUserHoleOffset !== undefined && calcUserHoleOffset !== null) ? calcUserHoleOffset : calcDefaultHoleOffset;
    const calcMinHoleOffset = calcWallThickness + (calcHoleDiameter / 2) + 0.1;
    const calcEffectiveHoleOffset = Math.max(calcHoleOffset, calcMinHoleOffset);
    // topH = zHeight + hStackThick + 2*effectiveHoleOffset (from the new formula)
    // maxHeight = topH + hStackThick/2 + vertEndOffset (top surface of top stack + vertical extension)
    let maxHeight = zHeight + calcHStackThick + 2 * calcEffectiveHoleOffset + calcHStackThick / 2 + state.vertEndOffset;

    // Apply orientation transformation for vertical (arch/bridge) mode
    if (state.orientation === 'vertical') {
        console.log('[solveLinkage] Applying arch mode transformation (vertical orientation)');
        // For arch mode, transform the horizontal ring into a vertical arch
        // The feet (outer pivots of first and last modules) should track along the ground
        
        // Step 1: Find the feet - outer pivots of first and last modules
        // If cap uprights are present, use them for the left foot instead
        const hBeams = beams.filter(b => b.stackType && b.stackType.startsWith('horizontal'));
        // Include both regular cap uprights AND fixed cap beams
        const capBeams = beams.filter(b => b.stackType === 'vertical-cap' || b.stackType === 'fixed-beam-cap');
        let leftFoot = null;
        let rightFoot = null;
        
        // Check for cap uprights/beams first - if present, use them for left foot
        if (state.archCapUprights && capBeams.length > 0) {
            // Find the outermost point of the cap uprights (largest radius)
            let maxRadCap = -Infinity;
            capBeams.forEach(beam => {
                if (beam.p1) {
                    const rad = Math.sqrt(beam.p1.x * beam.p1.x + beam.p1.z * beam.p1.z);
                    if (rad > maxRadCap) { maxRadCap = rad; leftFoot = {...beam.p1}; }
                }
                if (beam.p2) {
                    const rad = Math.sqrt(beam.p2.x * beam.p2.x + beam.p2.z * beam.p2.z);
                    if (rad > maxRadCap) { maxRadCap = rad; leftFoot = {...beam.p2}; }
                }
                // Also check corners for more accurate foot position
                if (beam.corners) {
                    beam.corners.forEach(c => {
                        if (c) {
                            const rad = Math.sqrt(c.x * c.x + c.z * c.z);
                            if (rad > maxRadCap) { maxRadCap = rad; leftFoot = {...c}; }
                        }
                    });
                }
            });
        }
        
        if (hBeams.length >= 2) {
            const sorted = [...hBeams].sort((a, b) => (a.moduleIndex ?? 0) - (b.moduleIndex ?? 0));
            const minModule = sorted[0].moduleIndex;
            const maxModule = sorted[sorted.length - 1].moduleIndex;
            
            // Get beams from first and last modules
            const firstBeams = sorted.filter(b => b.moduleIndex === minModule);
            const lastBeams = sorted.filter(b => b.moduleIndex === maxModule);
            
            // Only find left foot from first module if not already set by cap uprights
            if (!leftFoot) {
                let maxRadFirst = -Infinity;
                firstBeams.forEach(beam => {
                    if (beam.p1) {
                        const rad = Math.sqrt(beam.p1.x * beam.p1.x + beam.p1.z * beam.p1.z);
                        if (rad > maxRadFirst) { maxRadFirst = rad; leftFoot = {...beam.p1}; }
                    }
                    if (beam.p2) {
                        const rad = Math.sqrt(beam.p2.x * beam.p2.x + beam.p2.z * beam.p2.z);
                        if (rad > maxRadFirst) { maxRadFirst = rad; leftFoot = {...beam.p2}; }
                    }
                });
            }
            
            // Find outermost pivot from last module for right foot
            let maxRadLast = -Infinity;
            lastBeams.forEach(beam => {
                if (beam.p1) {
                    const rad = Math.sqrt(beam.p1.x * beam.p1.x + beam.p1.z * beam.p1.z);
                    if (rad > maxRadLast) { maxRadLast = rad; rightFoot = {...beam.p1}; }
                }
                if (beam.p2) {
                    const rad = Math.sqrt(beam.p2.x * beam.p2.x + beam.p2.z * beam.p2.z);
                    if (rad > maxRadLast) { maxRadLast = rad; rightFoot = {...beam.p2}; }
                }
            });
        }
        
        // Fallback: use geometry center if feet not found
        if (!leftFoot || !rightFoot) {
            let sumX = 0, sumY = 0, sumZ = 0, count = 0;
            beams.forEach(beam => {
                if (beam.corners) {
                    beam.corners.forEach(c => {
                        if (c) { sumX += c.x; sumY += c.y; sumZ += c.z; count++; }
                    });
                }
            });
            const cx = count > 0 ? sumX / count : 0;
            const cy = count > 0 ? sumY / count : 0;
            const cz = count > 0 ? sumZ / count : 0;
            leftFoot = leftFoot || {x: cx - 10, y: cy, z: cz};
            rightFoot = rightFoot || {x: cx + 10, y: cy, z: cz};
        }
        
        // Step 2: Calculate transformation based on feet positions
        // Midpoint between feet becomes the center of rotation
        const midX = (leftFoot.x + rightFoot.x) / 2;
        const midY = (leftFoot.y + rightFoot.y) / 2;
        const midZ = (leftFoot.z + rightFoot.z) / 2;
        
        // Angle to align feet with X axis
        const dx = rightFoot.x - leftFoot.x;
        const dz = rightFoot.z - leftFoot.z;
        const footAngle = Math.atan2(dz, dx);
        
        // User rotation (additional rotation around Y before making vertical)
        const userRotRad = (state.archRotation || 0) * Math.PI / 180;
        const totalRotY = -footAngle + userRotRad;
        const cosR = Math.cos(totalRotY);
        const sinR = Math.sin(totalRotY);
        
        // Flip control
        const flipY = state.archFlipVertical ? -1 : 1;
        
        // Step 3: Combined transformation
        const transformPoint = (p) => {
            if (!p || typeof p.x === 'undefined') return p;
            
            // Translate to center on feet midpoint
            let x = p.x - midX;
            let y = p.y - midY;
            let z = p.z - midZ;
            
            // Rotate around Y to align feet with X axis + user rotation
            const x2 = x * cosR - z * sinR;
            const y2 = y;
            const z2 = x * sinR + z * cosR;
            
            // Rotate 90° around X: (x, y, z) -> (x, z, -y), with flip
            return { x: x2, y: z2 * flipY, z: -y2 };
        };
        
        const transformDir = (v) => {
            if (!v || typeof v.x === 'undefined') return v;
            const x2 = v.x * cosR - v.z * sinR;
            const y2 = v.y;
            const z2 = v.x * sinR + v.z * cosR;
            return { x: x2, y: z2 * flipY, z: -y2 };
        };
        
        // Apply transformation to all geometry
        beams.forEach(beam => {
            if (beam.corners) beam.corners = beam.corners.map(c => transformPoint(c));
            if (beam.p1) beam.p1 = transformPoint(beam.p1);
            if (beam.p2) beam.p2 = transformPoint(beam.p2);
            if (beam.center) beam.center = transformPoint(beam.center);
            // Also transform beam axes for consistent rendering
            if (beam.axisX) beam.axisX = transformDir(beam.axisX);
            if (beam.axisY) beam.axisY = transformDir(beam.axisY);
            if (beam.axisZ) beam.axisZ = transformDir(beam.axisZ);
            // Transform face normals
            if (beam.faces) {
                beam.faces.forEach(face => {
                    if (face.norm) face.norm = transformDir(face.norm);
                });
            }
        });
        
        brackets.forEach(bracket => {
            // Store the original offset from pivot to bracket bottom BEFORE transformation
            // This offset is in the local "up" direction of the bracket
            let bottomOffset = null;
            if (bracket.pos && typeof bracket.bottomY === 'number') {
                // The offset vector points from pivot to bracket bottom
                // In cylinder mode, this is purely along the Y axis
                bottomOffset = { x: 0, y: bracket.bottomY - bracket.pos.y, z: 0 };
            }
            
            // Transform position and direction vectors
            if (bracket.pos) bracket.pos = transformPoint(bracket.pos);
            if (bracket.baseY !== undefined && bracket.pos) bracket.baseY = bracket.pos.y;
            if (bracket.beamDir) bracket.beamDir = transformDir(bracket.beamDir);
            if (bracket.right) bracket.right = transformDir(bracket.right);
            if (bracket.boltDir) bracket.boltDir = transformDir(bracket.boltDir);
            
            // After transformation, compute the bracket bottom position
            // by adding the transformed offset to the transformed pos
            if (bottomOffset && bracket.pos) {
                const transformedOffset = transformDir(bottomOffset);
                const bottomPos = {
                    x: bracket.pos.x + transformedOffset.x,
                    y: bracket.pos.y + transformedOffset.y,
                    z: bracket.pos.z + transformedOffset.z
                };
                // Store as a full position, not just Y
                bracket.bottomPos = bottomPos;
                // Keep bottomY for backward compatibility (now represents offset along local up)
                bracket.bottomY = bracket.pos.y; // Use pos.y as base; offset handled via bottomPos
            }
        });

        hardwareAssemblyPlacements.forEach(pl => {
            let bottomOffset = null;
            if (pl.pos && typeof pl.bottomY === 'number') {
                bottomOffset = { x: 0, y: pl.bottomY - pl.pos.y, z: 0 };
            }
            if (pl.pos) pl.pos = transformPoint(pl.pos);
            if (pl.beamDir) pl.beamDir = transformDir(pl.beamDir);
            if (pl.right) pl.right = transformDir(pl.right);
            if (pl.vBoltDir) pl.vBoltDir = transformDir(pl.vBoltDir);
            if (pl.vBoltPivot) pl.vBoltPivot = transformPoint(pl.vBoltPivot);
            if (bottomOffset && pl.pos) {
                const transformedOffset = transformDir(bottomOffset);
                pl.bottomPos = {
                    x: pl.pos.x + transformedOffset.x,
                    y: pl.pos.y + transformedOffset.y,
                    z: pl.pos.z + transformedOffset.z
                };
                pl.bottomY = pl.pos.y;
            }
        });
        
        bolts.forEach(bolt => {
            if (bolt.start) bolt.start = transformPoint(bolt.start);
            if (bolt.end) bolt.end = transformPoint(bolt.end);
            if (bolt.center) bolt.center = transformPoint(bolt.center);
            if (bolt.dir) bolt.dir = transformDir(bolt.dir);
        });
        
        // Transform feet positions too
        leftFoot = transformPoint(leftFoot);
        rightFoot = transformPoint(rightFoot);
        
        console.log('[solveLinkage] Arch transformation complete:', {
            leftFoot: leftFoot,
            rightFoot: rightFoot,
            transformation: '90° X-axis rotation: (x, y, z) -> (x, z, -y)',
            beamCount: beams.length
        });
        
        // Step 4: Ground to feet positions
        // The feet should be at Y=0, and centered on X
        const feetY = Math.min(leftFoot.y, rightFoot.y);
        const feetCenterX = (leftFoot.x + rightFoot.x) / 2;
        
        const groundPoint = (p) => {
            if (!p || typeof p.y === 'undefined') return p;
            return { x: p.x - feetCenterX, y: p.y - feetY, z: p.z };
        };
        
        beams.forEach(beam => {
            if (beam.corners) beam.corners = beam.corners.map(c => groundPoint(c));
            if (beam.p1) beam.p1 = groundPoint(beam.p1);
            if (beam.p2) beam.p2 = groundPoint(beam.p2);
            if (beam.center) beam.center = groundPoint(beam.center);
        });
        
        brackets.forEach(bracket => {
            if (bracket.pos) bracket.pos = groundPoint(bracket.pos);
            if (bracket.baseY !== undefined) bracket.baseY -= feetY;
            if (typeof bracket.bottomY === 'number') bracket.bottomY -= feetY;
            if (bracket.bottomPos) bracket.bottomPos = groundPoint(bracket.bottomPos);
        });

        hardwareAssemblyPlacements.forEach(pl => {
            if (pl.pos) pl.pos = groundPoint(pl.pos);
            if (typeof pl.bottomY === 'number') pl.bottomY -= feetY;
            if (pl.bottomPos) pl.bottomPos = groundPoint(pl.bottomPos);
            if (pl.vBoltPivot) pl.vBoltPivot = groundPoint(pl.vBoltPivot);
        });
        
        bolts.forEach(bolt => {
            if (bolt.start) bolt.start = groundPoint(bolt.start);
            if (bolt.end) bolt.end = groundPoint(bolt.end);
            if (bolt.center) bolt.center = groundPoint(bolt.center);
        });
        
        // Calculate final dimensions
        let maxY = -Infinity;
        let maxAbsX = 0;
        beams.forEach(beam => {
            if (beam.corners) {
                beam.corners.forEach(c => {
                    if (c) {
                        if (typeof c.y !== 'undefined' && c.y > maxY) maxY = c.y;
                        if (typeof c.x !== 'undefined' && Math.abs(c.x) > maxAbsX) maxAbsX = Math.abs(c.x);
                    }
                });
            }
        });
        
        maxHeight = maxY > 0 ? maxY : 0;
        maxRad = maxAbsX;
    } // End of arch mode transformation block
    
    // Duplicate structure for array mode (tunnel/tube)
    if (state.arrayCount > 1 && state.orientation === 'vertical') {
        // Calculate the depth of a single structure in Z direction to determine spacing
        // Find the frontmost and backmost points
        let minZ = Infinity, maxZ = -Infinity;
        beams.forEach(beam => {
            if (beam.corners) {
                beam.corners.forEach(c => {
                    if (c && typeof c.z !== 'undefined') {
                        if (c.z < minZ) minZ = c.z;
                        if (c.z > maxZ) maxZ = c.z;
                    }
                });
            }
            // Also check p1 and p2
            if (beam.p1 && typeof beam.p1.z !== 'undefined') {
                if (beam.p1.z < minZ) minZ = beam.p1.z;
                if (beam.p1.z > maxZ) maxZ = beam.p1.z;
            }
            if (beam.p2 && typeof beam.p2.z !== 'undefined') {
                if (beam.p2.z < minZ) minZ = beam.p2.z;
                if (beam.p2.z > maxZ) maxZ = beam.p2.z;
            }
        });
        const structureDepth = maxZ - minZ;
        const spacing = structureDepth; // Connect structures end-to-end (no gap)
        
        // Store original geometry
        const originalBeams = [...beams];
        const originalBrackets = [...brackets];
        const originalBolts = [...bolts];
        const originalWashers = [...washers];
        const originalHardwarePlacements = [...hardwareAssemblyPlacements];
        
        // Clear arrays for rebuilding
        beams = [];
        brackets = [];
        bolts = [];
        washers = [];
        hardwareAssemblyPlacements = [];
        
        // Create arrayCount copies, extending in Z direction (back)
        // Center the array around Z=0
        const totalArrayDepth = (state.arrayCount - 1) * spacing;
        const startOffsetZ = -totalArrayDepth / 2;
        
        for (let i = 0; i < state.arrayCount; i++) {
            const offsetZ = startOffsetZ + i * spacing; // Each structure is offset further back
            
            // Duplicate beams - preserve orientation by copying corners directly
            originalBeams.forEach(beam => {
                // Clone the beam by copying all its properties with Z offset
                const newBeam = {
                    type: 'beam',
                    colorBase: beam.colorBase,
                    moduleIndex: beam.moduleIndex,
                    stackType: beam.stackType,
                    stackId: beam.stackId,
                    arrayIndex: i, // Track which array copy this beam belongs to
                    w: beam.w,
                    t: beam.t,
                    // Copy axes exactly - preserves orientation
                    axisX: {...beam.axisX},
                    axisY: {...beam.axisY},
                    axisZ: {...beam.axisZ},
                    // Offset endpoints
                    p1: {
                        x: beam.p1.x,
                        y: beam.p1.y,
                        z: (beam.p1.z || 0) + offsetZ
                    },
                    p2: {
                        x: beam.p2.x,
                        y: beam.p2.y,
                        z: (beam.p2.z || 0) + offsetZ
                    },
                    // Offset center
                    center: {
                        x: beam.center.x,
                        y: beam.center.y,
                        z: (beam.center.z || 0) + offsetZ
                    },
                    // Offset corners
                    corners: beam.corners.map(c => ({
                        x: c.x,
                        y: c.y,
                        z: (c.z || 0) + offsetZ
                    })),
                    // Copy faces with offset normals (normals don't change, just reference)
                    faces: beam.faces.map(f => ({
                        idx: [...f.idx],
                        norm: {...f.norm}
                    }))
                };
                
                beams.push(newBeam);
            });
            
            // Duplicate brackets
            originalBrackets.forEach(bracket => {
                const newBracket = {...bracket};
                if (newBracket.pos) {
                    newBracket.pos = {x: bracket.pos.x, y: bracket.pos.y, z: bracket.pos.z + offsetZ};
                }
                if (newBracket.bottomPos) {
                    newBracket.bottomPos = {x: bracket.bottomPos.x, y: bracket.bottomPos.y, z: bracket.bottomPos.z + offsetZ};
                }
                brackets.push(newBracket);
            });
            
            // Duplicate bolts
            originalBolts.forEach(bolt => {
                const newBolt = {...bolt};
                if (newBolt.start) {
                    newBolt.start = {x: bolt.start.x, y: bolt.start.y, z: bolt.start.z + offsetZ};
                }
                if (newBolt.end) {
                    newBolt.end = {x: bolt.end.x, y: bolt.end.y, z: bolt.end.z + offsetZ};
                }
                if (newBolt.center) {
                    newBolt.center = {x: bolt.center.x, y: bolt.center.y, z: bolt.center.z + offsetZ};
                }
                bolts.push(newBolt);
            });
            
            // Duplicate washers
            originalWashers.forEach(washer => {
                const newWasher = {...washer};
                if (newWasher.center) {
                    newWasher.center = {x: washer.center.x, y: washer.center.y, z: washer.center.z + offsetZ};
                }
                washers.push(newWasher);
            });

            originalHardwarePlacements.forEach(pl => {
                const newPl = {
                    assemblyId: pl.assemblyId,
                    pos: pl.pos ? { x: pl.pos.x, y: pl.pos.y, z: pl.pos.z + offsetZ } : null,
                    bottomY: pl.bottomY,
                    isBottom: pl.isBottom,
                    beamDir: pl.beamDir ? { ...pl.beamDir } : null,
                    right: pl.right ? { ...pl.right } : null,
                    vBoltDir: pl.vBoltDir ? { ...pl.vBoltDir } : null,
                    sideHoleY: pl.sideHoleY,
                    vBoltPivot: pl.vBoltPivot ? { x: pl.vBoltPivot.x, y: pl.vBoltPivot.y, z: pl.vBoltPivot.z + offsetZ } : null,
                    bottomPos: pl.bottomPos ? { x: pl.bottomPos.x, y: pl.bottomPos.y, z: pl.bottomPos.z + offsetZ } : null
                };
                hardwareAssemblyPlacements.push(newPl);
            });
        }
    } // End of array duplication block

    // Build StructureGeometry from the generated beams for panel placement
    const structureGeometry = buildStructureGeometry(beams, brackets, bolts, maxRad, maxHeight);
    
    return { beams, brackets, bolts, washers, hardwareAssemblyPlacements, maxRad, maxHeight, structureGeometry };
}

/**
 * Builds a StructureGeometry object from the beam arrays generated by solveLinkage.
 * This provides the foundation for stable solar panel placement.
 * @param {Beam3D[]} beams - Array of all beams
 * @param {Bracket3D[]} brackets - Array of all brackets
 * @param {Array} bolts - Array of all bolts
 * @param {number} maxRad - Maximum radius
 * @param {number} maxHeight - Maximum height
 * @returns {StructureGeometry} The structure geometry object
 */
function buildStructureGeometry(beams, brackets, bolts, maxRad, maxHeight) {
    const geometry = new StructureGeometry();
    geometry.maxRadius = maxRad;
    geometry.maxHeight = maxHeight;
    geometry.beams = beams;
    geometry.brackets = brackets;
    geometry.bolts = bolts;
    
    // Calculate structure center from all horizontal beams
    let centerSum = {x: 0, y: 0, z: 0};
    let beamCount = 0;
    beams.forEach(beam => {
        if (beam.stackType && beam.stackType.startsWith('horizontal') && beam.center) {
            centerSum = vAdd(centerSum, beam.center);
            beamCount++;
        }
    });
    if (beamCount > 0) {
        geometry.structureCenter = vScale(centerSum, 1 / beamCount);
    }
    
    // Group beams by module and array index
    const topHBeams = beams.filter(b => b.stackType === 'horizontal-top');
    const botHBeams = beams.filter(b => b.stackType === 'horizontal-bottom');
    
    // Group by arrayIndex (for tunnel mode)
    const groupByArrayIndex = (beamList) => {
        const groups = {};
        beamList.forEach(beam => {
            const idx = beam.arrayIndex !== undefined ? beam.arrayIndex : 0;
            if (!groups[idx]) groups[idx] = [];
            groups[idx].push(beam);
        });
        return groups;
    };
    
    const topArrayGroups = groupByArrayIndex(topHBeams);
    const botArrayGroups = groupByArrayIndex(botHBeams);
    
    // Process each array copy
    Object.keys(topArrayGroups).forEach(arrayIdxStr => {
        const arrayIdx = parseInt(arrayIdxStr);
        const topBeamsInArray = topArrayGroups[arrayIdx] || [];
        const botBeamsInArray = botArrayGroups[arrayIdx] || [];
        
        if (topBeamsInArray.length === 0 || botBeamsInArray.length === 0) return;
        
        // Group beams by moduleIndex
        const topByModule = {};
        const botByModule = {};
        topBeamsInArray.forEach(beam => {
            const mi = beam.moduleIndex !== undefined ? beam.moduleIndex : 0;
            if (!topByModule[mi]) topByModule[mi] = [];
            topByModule[mi].push(beam);
        });
        botBeamsInArray.forEach(beam => {
            const mi = beam.moduleIndex !== undefined ? beam.moduleIndex : 0;
            if (!botByModule[mi]) botByModule[mi] = [];
            botByModule[mi].push(beam);
        });
        
        // Create ModuleGeometry for each module
        const moduleIndices = [...new Set([
            ...Object.keys(topByModule).map(k => parseInt(k)),
            ...Object.keys(botByModule).map(k => parseInt(k))
        ])].sort((a, b) => a - b);
        
        moduleIndices.forEach(moduleIdx => {
            const topBeamsForModule = topByModule[moduleIdx] || [];
            const botBeamsForModule = botByModule[moduleIdx] || [];
            
            if (topBeamsForModule.length < 2 || botBeamsForModule.length < 2) return;
            
            // CRITICAL: Separate beams by crossing pattern (A vs B), not just by stack order
            // Pattern A and B are the two crossing directions of the scissor module
            const topPatternA = topBeamsForModule.filter(b => b.patternId === 'A');
            const topPatternB = topBeamsForModule.filter(b => b.patternId === 'B');
            const botPatternA = botBeamsForModule.filter(b => b.patternId === 'A');
            const botPatternB = botBeamsForModule.filter(b => b.patternId === 'B');
            
            console.log(`Module ${moduleIdx}: topA=${topPatternA.length}, topB=${topPatternB.length}, botA=${botPatternA.length}, botB=${botPatternB.length}`);
            
            // If we don't have both patterns, fall back to using beam positions
            let topBeamA, topBeamB, botBeamA, botBeamB;
            if (topPatternA.length > 0 && topPatternB.length > 0) {
                topBeamA = topPatternA[0];
                topBeamB = topPatternB[0];
            } else {
                // Fallback: separate by X position (pattern beams are at different X positions)
                const sorted = [...topBeamsForModule].sort((a, b) => a.center.x - b.center.x);
                topBeamA = sorted[0];
                topBeamB = sorted[sorted.length - 1];
            }
            
            if (botPatternA.length > 0 && botPatternB.length > 0) {
                botBeamA = botPatternA[0];
                botBeamB = botPatternB[0];
            } else {
                const sorted = [...botBeamsForModule].sort((a, b) => a.center.x - b.center.x);
                botBeamA = sorted[0];
                botBeamB = sorted[sorted.length - 1];
            }
            
            const module = new ModuleGeometry(moduleIdx);
            module.topBeams = [topBeamA, topBeamB];
            module.botBeams = [botBeamA, botBeamB];
            
            // Find uprights for this module
            module.uprights = beams.filter(b => 
                (b.stackType === 'vertical' || b.stackType === 'fixed-beam') &&
                b.moduleIndex === moduleIdx &&
                (b.arrayIndex === undefined || b.arrayIndex === arrayIdx)
            );
            
            geometry.addModule(module);
        });
    });
    
    // Collect geometry creates faces using RoofFace class
    // Pass orientation so faces know which plane to use for "outward" calculation
    geometry.collectGeometry(state.orientation);
    
    console.log('buildStructureGeometry: modules:', geometry.modules.length, 'faces:', geometry.faces.length);
    if (geometry.faces.length > 0) {
        console.log('  face[0] slideAxis:', geometry.faces[0].slideAxis);
        console.log('  face[1] slideAxis:', geometry.faces[1]?.slideAxis);
    }
    
    return geometry;
}

const solverExports = {
    calculateJointPositions,
    createBeamStack,
    solveLinkage,
    buildStructureGeometry,
    computeMinFoldAngleVBeamOverlap,
    getEffectiveMinFoldAngle,
    getRefPricePerCubicInch,
    calculateBeamCostByVolume,
    updateAutoBeamPricing,
    calculateActuatorStroke,
    calculateCenterOfMass,
    calculateRequiredActuatorForce,
    findOptimalActuatorPlacements
};

bridgeGlobals(solverExports, 'solver');

export {
    calculateJointPositions,
    createBeamStack,
    solveLinkage,
    buildStructureGeometry,
    computeMinFoldAngleVBeamOverlap,
    getEffectiveMinFoldAngle,
    getRefPricePerCubicInch,
    calculateBeamCostByVolume,
    updateAutoBeamPricing,
    calculateActuatorStroke,
    calculateCenterOfMass,
    calculateRequiredActuatorForce,
    findOptimalActuatorPlacements
};

