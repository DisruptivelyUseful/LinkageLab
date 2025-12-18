
// ============================================================================
// COLLISION DETECTION
// ============================================================================

function findSafeFoldAngle(targetAngle, previousAngle = null) {
    const stepSize = degToRad(0.5); // Search in 0.5 degree steps
    const maxSearchRange = degToRad(30); // Search up to 30 degrees away
    
    // Determine search direction based on whether we're folding or extending
    let searchDirection = 0;
    if (previousAngle !== null) {
        // If angle decreased (folding), search upward to find minimum safe angle
        // If angle increased (extending), search downward to find maximum safe angle
        searchDirection = targetAngle < previousAngle ? 1 : -1;
    }
    
    // Try angles near the target
    for (let offset = 0; offset <= maxSearchRange; offset += stepSize) {
        // If we have a direction preference, try that first, then both
        const directions = searchDirection !== 0 
            ? [searchDirection, -searchDirection] 
            : [-1, 1]; // Try both directions if no preference
        
        for (const direction of directions) {
            const testAngle = targetAngle + (offset * direction);
            if (testAngle < MIN_FOLD_ANGLE || testAngle > MAX_FOLD_ANGLE) continue;
            
            const data = solveLinkage(testAngle);
            const collisions = detectCollisions(data);
            if (collisions.length === 0) {
                return testAngle;
            }
        }
    }
    
    return null; // No safe angle found
}

function detectCollisions(data) {
    const collisions = [];
    // Tolerance for collision detection
    const MIN_OVERLAP_SIZE = 0.5; // At least 0.5" overlap in one dimension
    const MIN_OVERLAP_VOLUME = 0.25; // Minimum overlap volume (cubic inches)
    
    // Get total module count for adjacency check
    const totalModules = state.modules;
    
    // CHECK 0: Geometric over-folding check based on total angular span
    // Calculate what the total rotation around the ring would be
    // If N modules * rotation per module > 360°, the ring has over-folded
    const jointResult = calculateJointPositions(state.foldAngle, {
        hActiveIn: state.hLengthFt * INCHES_PER_FOOT - state.offsetTopIn - state.offsetBotIn,
        pivotPct: state.pivotPct,
        hobermanAng: state.hobermanAng,
        pivotAng: state.pivotAng
    });
    
    const rotationPerModule = jointResult.relativeRotation;
    const totalRotation = Math.abs(rotationPerModule * totalModules);
    
    // If total rotation exceeds 2*PI (360°), the structure has over-folded
    // Allow a small margin for the ring to close (within ~5 degrees of 360°)
    const maxAllowedRotation = Math.PI * 2 + degToRad(5);
    
    if (totalRotation > maxAllowedRotation) {
        // Find all horizontal beams from first module (index 0) and last module (index N-1)
        // These are the ones that would intersect on overfold
        const firstModuleBeams = data.beams.filter(b => b.moduleIndex === 0);
        const lastModuleBeams = data.beams.filter(b => b.moduleIndex === totalModules - 1);
        
        // Also include beams from second-to-last and second modules for better visualization
        const secondModuleBeams = data.beams.filter(b => b.moduleIndex === 1);
        const secondLastModuleBeams = data.beams.filter(b => b.moduleIndex === totalModules - 2);
        
        // Create collision pairs between first and last module beams
        for (const firstBeam of firstModuleBeams) {
            for (const lastBeam of lastModuleBeams) {
                // Only pair horizontal beams at same level (both top or both bottom)
                const firstIsHorizontal = firstBeam.stackType && firstBeam.stackType.startsWith('horizontal');
                const lastIsHorizontal = lastBeam.stackType && lastBeam.stackType.startsWith('horizontal');
                
                if (firstIsHorizontal && lastIsHorizontal) {
                    // Check if same level (both top or both bottom)
                    const firstIsTop = firstBeam.stackType === 'horizontal-top';
                    const lastIsTop = lastBeam.stackType === 'horizontal-top';
                    
                    if (firstIsTop === lastIsTop) {
                        collisions.push({
                            beam: firstBeam,
                            other: lastBeam,
                            type: 'geometric-overfold',
                            message: `Ring over-folded: ${formatNumber(radToDeg(totalRotation), 1)}° exceeds 360°`
                        });
                    }
                }
            }
        }
        
        // If no horizontal beams found, use first two beams as fallback
        if (collisions.length === 0 && data.beams.length >= 2) {
            collisions.push({
                beam: data.beams[0],
                other: data.beams[1],
                type: 'geometric-overfold',
                message: `Ring over-folded: ${formatNumber(radToDeg(totalRotation), 1)}° exceeds 360°`
            });
        }
        
        // Return early - no need for detailed checks if geometrically impossible
        return collisions;
    }
    
    // Helper to check if two modules are adjacent (including wrap-around)
    const areModulesAdjacent = (m1, m2) => {
        if (m1 === undefined || m2 === undefined) return true;
        const diff = Math.abs(m1 - m2);
        return diff <= 1 || diff === totalModules - 1;
    };
    
    // Helper to get angular position of a point around the Y axis (center of structure)
    const getAngularPosition = (point) => {
        return Math.atan2(point.z, point.x);
    };
    
    // Helper to normalize angle to [0, 2*PI)
    const normalizeAngle = (angle) => {
        while (angle < 0) angle += Math.PI * 2;
        while (angle >= Math.PI * 2) angle -= Math.PI * 2;
        return angle;
    };
    
    // Helper to get angular distance (minimum arc between two angles)
    const angularDistance = (a1, a2) => {
        const diff = Math.abs(normalizeAngle(a1) - normalizeAngle(a2));
        return Math.min(diff, Math.PI * 2 - diff);
    };
    
    // Separate beams by type: horizontal vs vertical
    const horizontalBeams = [];
    const verticalBeams = [];
    
    data.beams.forEach(beam => {
        const corners = beam.corners;
        const minY = Math.min(...corners.map(c => c.y));
        const maxY = Math.max(...corners.map(c => c.y));
        const ySpan = maxY - minY;
        
        // Compute bounding box
        const bounds = {
            min: {
                x: Math.min(...corners.map(c => c.x)),
                y: minY,
                z: Math.min(...corners.map(c => c.z))
            },
            max: {
                x: Math.max(...corners.map(c => c.x)),
                y: maxY,
                z: Math.max(...corners.map(c => c.z))
            },
            beam: beam,
            moduleIndex: beam.moduleIndex,
            center: beam.center,
            // Calculate angular position and span for over-folding check
            angularCenter: getAngularPosition(beam.center),
            corners: corners
        };
        
        // Calculate angular span of beam (how much arc it covers)
        const cornerAngles = corners.map(c => getAngularPosition(c));
        bounds.angularMin = Math.min(...cornerAngles);
        bounds.angularMax = Math.max(...cornerAngles);
        
        // Handle wrap-around (beam crossing the 0/2PI boundary)
        const angularSpan = bounds.angularMax - bounds.angularMin;
        if (angularSpan > Math.PI) {
            // Beam crosses the boundary, swap min/max
            const temp = bounds.angularMin;
            bounds.angularMin = bounds.angularMax;
            bounds.angularMax = temp + Math.PI * 2;
        }
        
        const xSpan = bounds.max.x - bounds.min.x;
        const zSpan = bounds.max.z - bounds.min.z;
        const horizontalExtent = Math.max(xSpan, zSpan);
        
        if (ySpan > horizontalExtent * 0.5) {
            verticalBeams.push(bounds);
        } else {
            horizontalBeams.push(bounds);
        }
    });
    
    // Helper to check bounding box overlap
    const checkOverlap = (b1, b2) => {
        if (b1.max.x < b2.min.x || b1.min.x > b2.max.x ||
            b1.max.y < b2.min.y || b1.min.y > b2.max.y ||
            b1.max.z < b2.min.z || b1.min.z > b2.max.z) {
            return null;
        }
        
        const overlapX = Math.min(b1.max.x, b2.max.x) - Math.max(b1.min.x, b2.min.x);
        const overlapY = Math.min(b1.max.y, b2.max.y) - Math.max(b1.min.y, b2.min.y);
        const overlapZ = Math.min(b1.max.z, b2.max.z) - Math.max(b1.min.z, b2.min.z);
        
        if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) {
            return null;
        }
        
        return {
            x: overlapX, y: overlapY, z: overlapZ,
            volume: overlapX * overlapY * overlapZ,
            maxDim: Math.max(overlapX, overlapY, overlapZ)
        };
    };
    
    // Helper to check if angular ranges overlap
    const angularRangesOverlap = (min1, max1, min2, max2) => {
        // Normalize all to [0, 4*PI) to handle wrap-around
        const normalize = (a) => {
            while (a < 0) a += Math.PI * 2;
            return a;
        };
        min1 = normalize(min1);
        max1 = normalize(max1);
        min2 = normalize(min2);
        max2 = normalize(max2);
        
        // Check overlap
        return !(max1 < min2 || max2 < min1);
    };
    
    // CHECK 1: Vertical-horizontal collisions (struts hitting rings)
    for (const vBeam of verticalBeams) {
        for (const hBeam of horizontalBeams) {
            const overlap = checkOverlap(vBeam, hBeam);
            if (overlap && overlap.maxDim > MIN_OVERLAP_SIZE && overlap.volume > MIN_OVERLAP_VOLUME) {
                collisions.push({ 
                    beam: vBeam.beam, 
                    other: hBeam.beam,
                    type: 'vertical-horizontal'
                });
            }
        }
    }
    
    // CHECK 2: Over-folding - horizontal beams from non-adjacent modules
    // Check both bounding box overlap AND angular proximity
    for (let i = 0; i < horizontalBeams.length; i++) {
        const h1 = horizontalBeams[i];
        for (let j = i + 1; j < horizontalBeams.length; j++) {
            const h2 = horizontalBeams[j];
            
            // Skip adjacent modules (normal scissor motion)
            if (areModulesAdjacent(h1.moduleIndex, h2.moduleIndex)) {
                continue;
            }
            
            // Check if beams are at similar Y levels (same ring level)
            const yOverlap = !(h1.max.y < h2.min.y || h2.max.y < h1.min.y);
            if (!yOverlap) continue;
            
            // Check bounding box overlap
            const boxOverlap = checkOverlap(h1, h2);
            if (boxOverlap && boxOverlap.maxDim > MIN_OVERLAP_SIZE && boxOverlap.volume > MIN_OVERLAP_VOLUME) {
                collisions.push({ 
                    beam: h1.beam, 
                    other: h2.beam,
                    type: 'over-folding'
                });
                continue;
            }
            
            // Also check angular proximity - if non-adjacent beams are at similar angles,
            // they're trying to occupy the same space around the ring
            const angDist = angularDistance(h1.angularCenter, h2.angularCenter);
            const minExpectedAngularSeparation = (Math.PI * 2 / totalModules) * 0.3; // 30% of expected module spacing
            
            if (angDist < minExpectedAngularSeparation) {
                // Beams are too close angularly - check if they're actually close in 3D space
                const centerDist = vMag(vSub(h1.center, h2.center));
                const beamLength = Math.max(
                    vMag(vSub(h1.beam.corners[0], h1.beam.corners[4])),
                    vMag(vSub(h2.beam.corners[0], h2.beam.corners[4]))
                );
                
                // If centers are closer than beam length, it's a collision
                if (centerDist < beamLength * 0.8) {
                    collisions.push({ 
                        beam: h1.beam, 
                        other: h2.beam,
                        type: 'over-folding'
                    });
                }
            }
        }
    }
    
    return collisions;
}

// ============================================================================
