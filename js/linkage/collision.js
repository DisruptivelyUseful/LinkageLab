// ============================================================================
// RAY CASTING UTILITIES
// ============================================================================

function screenToRay(screenX, screenY, cx, cy) {
    const cam = state.cam;
    const yawRad = cam.yaw;
    const pitchRad = cam.pitch;
    
    // Camera position in world space (looking from positive Z toward origin)
    const camX = cam.dist * Math.sin(yawRad) * Math.cos(pitchRad);
    const camY = cam.dist * Math.sin(pitchRad);
    const camZ = cam.dist * Math.cos(yawRad) * Math.cos(pitchRad);
    
    // Convert screen position to normalized device coordinates
    const ndcX = (screenX - cx) / PERSPECTIVE_SCALE;
    const ndcY = -(screenY - cy) / PERSPECTIVE_SCALE;
    
    // Create direction vector in camera space
    const dirCamX = ndcX + cam.panX / PERSPECTIVE_SCALE;
    const dirCamY = ndcY - cam.panY / PERSPECTIVE_SCALE;
    const dirCamZ = 1;
    
    // Rotate direction from camera space to world space
    const x1 = dirCamX;
    const y1 = dirCamY * Math.cos(-pitchRad) - dirCamZ * Math.sin(-pitchRad);
    const z1 = dirCamY * Math.sin(-pitchRad) + dirCamZ * Math.cos(-pitchRad);
    
    const x2 = x1 * Math.cos(yawRad) - z1 * Math.sin(yawRad);
    const y2 = y1;
    const z2 = x1 * Math.sin(yawRad) + z1 * Math.cos(yawRad);
    
    const direction = vNorm({x: x2, y: y2, z: z2});
    const origin = {x: camX, y: camY, z: camZ};
    
    return { origin, direction };
}

function rayTriangleIntersect(ray, v0, v1, v2) {
    const EPSILON = 0.0000001;
    const edge1 = vSub(v1, v0);
    const edge2 = vSub(v2, v0);
    const h = vCross(ray.direction, edge2);
    const a = vDot(edge1, h);
    
    if (a > -EPSILON && a < EPSILON) {
        return { hit: false, t: Infinity, point: null };
    }
    
    const f = 1.0 / a;
    const s = vSub(ray.origin, v0);
    const u = f * vDot(s, h);
    
    if (u < 0.0 || u > 1.0) {
        return { hit: false, t: Infinity, point: null };
    }
    
    const q = vCross(s, edge1);
    const v = f * vDot(ray.direction, q);
    
    if (v < 0.0 || u + v > 1.0) {
        return { hit: false, t: Infinity, point: null };
    }
    
    const t = f * vDot(edge2, q);
    
    if (t > EPSILON) {
        const point = vAdd(ray.origin, vScale(ray.direction, t));
        return { hit: true, t, point };
    }
    
    return { hit: false, t: Infinity, point: null };
}

function rayQuadIntersect(ray, corners, indices) {
    const v0 = corners[indices[0]];
    const v1 = corners[indices[1]];
    const v2 = corners[indices[2]];
    const v3 = corners[indices[3]];
    
    const hit1 = rayTriangleIntersect(ray, v0, v1, v2);
    if (hit1.hit) return hit1;
    
    const hit2 = rayTriangleIntersect(ray, v0, v2, v3);
    return hit2;
}

function findClosestBeamHit(ray, beams) {
    let closestHit = { beam: null, point: null, distance: Infinity };
    
    for (const beam of beams) {
        for (const face of beam.faces) {
            const result = rayQuadIntersect(ray, beam.corners, face.idx);
            if (result.hit && result.t < closestHit.distance) {
                closestHit = {
                    beam: beam,
                    point: result.point,
                    distance: result.t
                };
            }
        }
    }
    
    return closestHit;
}

// ============================================================================
// COLLISION DETECTION
// ============================================================================

function findSafeFoldAngle(targetAngle, previousAngle = null) {
    const stepSize = degToRad(0.5);
    const maxSearchRange = degToRad(30);
    
    let searchDirection = 0;
    if (previousAngle !== null) {
        searchDirection = targetAngle < previousAngle ? 1 : -1;
    }
    
    for (let offset = 0; offset <= maxSearchRange; offset += stepSize) {
        const directions = searchDirection !== 0 
            ? [searchDirection, -searchDirection] 
            : [-1, 1];
        
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
    
    return null;
}

function detectCollisions(data) {
    const collisions = [];
    const MIN_OVERLAP_SIZE = 0.5;
    const MIN_OVERLAP_VOLUME = 0.25;
    const totalModules = state.modules;
    
    // CHECK 0: Geometric over-folding check
    const jointResult = calculateJointPositions(state.foldAngle, {
        hActiveIn: state.hLengthFt * INCHES_PER_FOOT - state.offsetTopIn - state.offsetBotIn,
        pivotPct: state.pivotPct,
        hobermanAng: state.hobermanAng,
        pivotAng: state.pivotAng
    });
    
    const rotationPerModule = jointResult.relativeRotation;
    const totalRotation = Math.abs(rotationPerModule * totalModules);
    const maxAllowedRotation = Math.PI * 2 + degToRad(5);
    
    if (totalRotation > maxAllowedRotation) {
        const firstModuleBeams = data.beams.filter(b => b.moduleIndex === 0);
        const lastModuleBeams = data.beams.filter(b => b.moduleIndex === totalModules - 1);
        
        for (const firstBeam of firstModuleBeams) {
            for (const lastBeam of lastModuleBeams) {
                const firstIsHorizontal = firstBeam.stackType && firstBeam.stackType.startsWith('horizontal');
                const lastIsHorizontal = lastBeam.stackType && lastBeam.stackType.startsWith('horizontal');
                
                if (firstIsHorizontal && lastIsHorizontal) {
                    const firstIsTop = firstBeam.stackType === 'horizontal-top';
                    const lastIsTop = lastBeam.stackType === 'horizontal-top';
                    
                    if (firstIsTop === lastIsTop) {
                        collisions.push({
                            beam: firstBeam,
                            other: lastBeam,
                            type: 'geometric-overfold',
                            message: `Ring over-folded: ${formatNumber(radToDeg(totalRotation), 1)} deg exceeds 360 deg`
                        });
                    }
                }
            }
        }
        
        if (collisions.length === 0 && data.beams.length >= 2) {
            collisions.push({
                beam: data.beams[0],
                other: data.beams[1],
                type: 'geometric-overfold',
                message: `Ring over-folded: ${formatNumber(radToDeg(totalRotation), 1)} deg exceeds 360 deg`
            });
        }
        
        return collisions;
    }
    
    // Helper functions
    const areModulesAdjacent = (m1, m2) => {
        if (m1 === undefined || m2 === undefined) return true;
        const diff = Math.abs(m1 - m2);
        return diff <= 1 || diff === totalModules - 1;
    };
    
    const getAngularPosition = (point) => {
        return Math.atan2(point.z, point.x);
    };
    
    const normalizeAngle = (angle) => {
        while (angle < 0) angle += Math.PI * 2;
        while (angle >= Math.PI * 2) angle -= Math.PI * 2;
        return angle;
    };
    
    const angularDistance = (a1, a2) => {
        const diff = Math.abs(normalizeAngle(a1) - normalizeAngle(a2));
        return Math.min(diff, Math.PI * 2 - diff);
    };
    
    // Separate beams by type
    const horizontalBeams = [];
    const verticalBeams = [];
    
    data.beams.forEach(beam => {
        const corners = beam.corners;
        const minY = Math.min(...corners.map(c => c.y));
        const maxY = Math.max(...corners.map(c => c.y));
        const ySpan = maxY - minY;
        
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
            angularCenter: getAngularPosition(beam.center),
            corners: corners
        };
        
        const cornerAngles = corners.map(c => getAngularPosition(c));
        bounds.angularMin = Math.min(...cornerAngles);
        bounds.angularMax = Math.max(...cornerAngles);
        
        const angularSpan = bounds.angularMax - bounds.angularMin;
        if (angularSpan > Math.PI) {
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
    
    // CHECK 1: Vertical-horizontal collisions
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
    for (let i = 0; i < horizontalBeams.length; i++) {
        const h1 = horizontalBeams[i];
        for (let j = i + 1; j < horizontalBeams.length; j++) {
            const h2 = horizontalBeams[j];
            
            if (areModulesAdjacent(h1.moduleIndex, h2.moduleIndex)) {
                continue;
            }
            
            const yOverlap = !(h1.max.y < h2.min.y || h2.max.y < h1.min.y);
            if (!yOverlap) continue;
            
            const boxOverlap = checkOverlap(h1, h2);
            if (boxOverlap && boxOverlap.maxDim > MIN_OVERLAP_SIZE && boxOverlap.volume > MIN_OVERLAP_VOLUME) {
                collisions.push({ 
                    beam: h1.beam, 
                    other: h2.beam,
                    type: 'over-folding'
                });
                continue;
            }
            
            const angDist = angularDistance(h1.angularCenter, h2.angularCenter);
            const minExpectedAngularSeparation = (Math.PI * 2 / totalModules) * 0.3;
            
            if (angDist < minExpectedAngularSeparation) {
                const centerDist = vMag(vSub(h1.center, h2.center));
                const beamLength = Math.max(
                    vMag(vSub(h1.beam.corners[0], h1.beam.corners[4])),
                    vMag(vSub(h2.beam.corners[0], h2.beam.corners[4]))
                );
                
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
