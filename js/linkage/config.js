// ANIMATION SYSTEM
// ============================================================================

function updateAnimationStatus() {
    const statusEl = document.getElementById('anim-status');
    const statusTopEl = document.getElementById('anim-status-top');
    const directionEl = document.getElementById('anim-direction');
    
    const statusText = state.animation.playing ? '▶ Playing' : '⏸ Stopped';
    const statusColor = state.animation.playing ? 'var(--clr-success)' : 'var(--text-muted)';
    const directionText = state.animation.direction > 0 ? '→' : '←';
    
    if (statusEl) {
        statusEl.textContent = state.animation.playing ? 'Playing' : 'Stopped';
        statusEl.style.color = statusColor;
    }
    if (statusTopEl) {
        statusTopEl.textContent = statusText;
        statusTopEl.style.color = statusColor;
    }
    if (directionEl) {
        directionEl.textContent = state.animation.direction > 0 ? 'Expanding' : 'Collapsing';
    }
}

function getOptimalClosedAngleForAnimation() {
    // Cache the calculation as it's expensive
    if (state.animation.cachedClosedAngle !== undefined && 
        state.animation.cachedModules === state.modules &&
        state.animation.cachedPivotPct === state.pivotPct) {
        return state.animation.cachedClosedAngle;
    }
    
    const targetRotation = Math.PI * 2; // 360 degrees
    const totalModules = state.modules;
    
    // Helper to calculate total rotation for a given fold angle
    const getTotalRotation = (foldAngle) => {
        const jointResult = calculateJointPositions(foldAngle, {
            hActiveIn: state.hLengthFt * INCHES_PER_FOOT - state.offsetTopIn - state.offsetBotIn,
            pivotPct: state.pivotPct,
            hobermanAng: state.hobermanAng,
            pivotAng: state.pivotAng
        });
        return Math.abs(jointResult.relativeRotation * totalModules);
    };
    
    // Search for the angle where rotation = 360 deg
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
        
        // If we've passed 360 deg and are getting worse, stop
        if (rotation > targetRotation && diff > bestDiff) {
            break;
        }
    }
    
    // Fine-tune with smaller steps around the best angle
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
    
    // Cache the result
    state.animation.cachedClosedAngle = bestAngle;
    state.animation.cachedModules = state.modules;
    state.animation.cachedPivotPct = state.pivotPct;
    
    return bestAngle;
}

function animateFold(timestamp) {
    if (!state.animation.playing) {
        updateAnimationStatus();
        return;
    }
    
    // Calculate delta time for smooth animation regardless of frame rate
    if (!state.animation.lastTime) {
        state.animation.lastTime = timestamp;
    }
    const deltaTime = timestamp - state.animation.lastTime;
    state.animation.lastTime = timestamp;
    
    // Min angle = fully unfolded, Max angle = stop angle or optimal closed
    const minAngle = degToRad(5);
    const closedAngle = getOptimalClosedAngleForAnimation();
    // Use stopAngle if set, otherwise use closed angle
    const stopAngleRad = state.animation.stopAngle !== null 
        ? degToRad(state.animation.stopAngle) 
        : closedAngle;
    const maxAngle = Math.min(stopAngleRad, closedAngle); // Don't exceed closed angle
    const speed = state.animation.speed;
    const direction = state.animation.direction;
    
    // Calculate step based on delta time (target ~60fps equivalent)
    // Full cycle should take about 3 seconds at speed 1.0
    const fullCycleMs = 3000 / speed;
    const angleRange = maxAngle - minAngle;
    const step = (angleRange / fullCycleMs) * deltaTime * direction;
    
    // Check if we're in a pause state
    if (state.animation.pauseUntil && timestamp < state.animation.pauseUntil) {
        // Still pausing, continue waiting
        state.animation.frameId = requestAnimationFrame(animateFold);
        return;
    }
    state.animation.pauseUntil = null; // Clear pause flag
    
    let currentAngle = state.foldAngle + step;
    let reachedEnd = false;
    let reachedClosed = false;
    
    // Check bounds - use stop angle as maximum
    if (direction > 0 && currentAngle >= maxAngle) {
        currentAngle = maxAngle;
        reachedEnd = true;
        reachedClosed = (maxAngle >= closedAngle - 0.01); // Reached fully closed if at closed angle
    } else if (direction < 0 && currentAngle <= minAngle) {
        currentAngle = minAngle;
        reachedEnd = true;
    }
    
    // Handle end of animation
    if (reachedEnd) {
        // Update angle first
        state.foldAngle = currentAngle;
        syncUI('foldAngle');
        requestRender();
        
        if (state.animation.pingPong || state.animation.loop) {
            // Pause for 1 second at fully closed position before continuing
            if (reachedClosed) {
                state.animation.pauseUntil = timestamp + 1000; // 1 second pause
            }
            
            if (state.animation.pingPong) {
                // Reverse direction for ping-pong mode
                state.animation.direction *= -1;
                updateAnimationStatus();
            } else {
                // Reset to beginning for loop mode
                state.foldAngle = direction > 0 ? minAngle : maxAngle;
                syncUI('foldAngle');
                requestRender();
            }
            
            // Continue animation (will pause if pauseUntil is set)
            state.animation.frameId = requestAnimationFrame(animateFold);
            return;
        } else {
            // Stop animation
            state.animation.playing = false;
            updateAnimationStatus();
            return;
        }
    }
    
    state.foldAngle = clamp(currentAngle, minAngle, maxAngle);
    syncUI('foldAngle');
    requestRender();
    
    // Continue animation
    if (state.animation.playing) {
        state.animation.frameId = requestAnimationFrame(animateFold);
    }
}

// ============================================================================
// MEASUREMENT TOOLS
// ============================================================================

function calculateMeasurements(data) {
    if (!data || !data.beams || data.beams.length === 0) {
        return { innerDia: 0, outerDia: 0, height: 0, span: 0, innerPoints: null, outerPoints: null };
    }
    
    const hBeams = data.beams.filter(b => b.stackType && b.stackType.startsWith('horizontal'));
    
    // Find inner pivots (smallest radius) and outer pivots (largest radius)
    let minRad = Infinity, maxRad = -Infinity;
    let innerPoint1 = null, innerPoint2 = null;
    let outerPoint1 = null, outerPoint2 = null;
    let minY = Infinity, maxY = -Infinity;
    let minX = Infinity, maxX = -Infinity;
    
    // Collect all pivot points from horizontal beams
    const pivotPoints = [];
    hBeams.forEach(beam => {
        if (beam.p1) pivotPoints.push({...beam.p1, moduleIndex: beam.moduleIndex});
        if (beam.p2) pivotPoints.push({...beam.p2, moduleIndex: beam.moduleIndex});
    });
    
    // Also check corners for more accurate measurements
    data.beams.forEach(beam => {
        if (beam.corners) {
            beam.corners.forEach(c => {
                if (c) {
                    if (c.y < minY) minY = c.y;
                    if (c.y > maxY) maxY = c.y;
                    if (c.x < minX) minX = c.x;
                    if (c.x > maxX) maxX = c.x;
                }
            });
        }
    });
    
    // For each pivot point, calculate radius from center
    pivotPoints.forEach(p => {
        const rad = Math.sqrt(p.x * p.x + (p.z || 0) * (p.z || 0));
        
        // Track inner (smallest radius) points
        if (rad < minRad) {
            minRad = rad;
            innerPoint1 = p;
        }
        
        // Track outer (largest radius) points  
        if (rad > maxRad) {
            maxRad = rad;
            outerPoint1 = p;
        }
    });
    
    // Find the point on the opposite side for inner diameter (opposite X sign)
    if (innerPoint1) {
        let bestDist = -Infinity;
        pivotPoints.forEach(p => {
            // Must be on opposite side (different X sign or far apart)
            const dist = Math.sqrt(Math.pow(p.x - innerPoint1.x, 2) + Math.pow((p.z || 0) - (innerPoint1.z || 0), 2));
            if (dist > bestDist && p !== innerPoint1) {
                const rad = Math.sqrt(p.x * p.x + (p.z || 0) * (p.z || 0));
                // Only consider inner points (within 20% of min radius)
                if (rad < minRad * 1.2) {
                    bestDist = dist;
                    innerPoint2 = p;
                }
            }
        });
    }
    
    // Find the point on the opposite side for outer diameter
    if (outerPoint1) {
        let bestDist = -Infinity;
        pivotPoints.forEach(p => {
            const dist = Math.sqrt(Math.pow(p.x - outerPoint1.x, 2) + Math.pow((p.z || 0) - (outerPoint1.z || 0), 2));
            if (dist > bestDist && p !== outerPoint1) {
                const rad = Math.sqrt(p.x * p.x + (p.z || 0) * (p.z || 0));
                // Only consider outer points (within 20% of max radius)
                if (rad > maxRad * 0.8) {
                    bestDist = dist;
                    outerPoint2 = p;
                }
            }
        });
    }
    
    // Calculate measurements
    let innerDia = 0, outerDia = 0;
    
    if (innerPoint1 && innerPoint2) {
        innerDia = Math.sqrt(
            Math.pow(innerPoint2.x - innerPoint1.x, 2) +
            Math.pow((innerPoint2.y || 0) - (innerPoint1.y || 0), 2) +
            Math.pow((innerPoint2.z || 0) - (innerPoint1.z || 0), 2)
        );
    }
    
    if (outerPoint1 && outerPoint2) {
        outerDia = Math.sqrt(
            Math.pow(outerPoint2.x - outerPoint1.x, 2) +
            Math.pow((outerPoint2.y || 0) - (outerPoint1.y || 0), 2) +
            Math.pow((outerPoint2.z || 0) - (outerPoint1.z || 0), 2)
        );
    }
    
    const height = maxY - minY;
    const span = maxX - minX;
    
    return {
        innerDia,
        outerDia,
        height,
        span,
        innerPoints: innerPoint1 && innerPoint2 ? [innerPoint1, innerPoint2] : null,
        outerPoints: outerPoint1 && outerPoint2 ? [outerPoint1, outerPoint2] : null,
        heightPoints: [{x: 0, y: minY, z: 0}, {x: 0, y: maxY, z: 0}],
        spanPoints: [{x: minX, y: minY, z: 0}, {x: maxX, y: minY, z: 0}]
    };
}

function drawMeasurements(ctx, data) {
    const measurements = calculateMeasurements(data);
    
    // Update sidebar display
    const innerEl = document.getElementById('meas-inner-dia');
    const outerEl = document.getElementById('meas-outer-dia');
    const heightEl = document.getElementById('meas-height');
    const spanEl = document.getElementById('meas-span');
    
    if (innerEl) innerEl.textContent = `${formatNumber(measurements.innerDia / INCHES_PER_FOOT, 2)}' (${formatNumber(measurements.innerDia, 1)}")`;
    if (outerEl) outerEl.textContent = `${formatNumber(measurements.outerDia / INCHES_PER_FOOT, 2)}' (${formatNumber(measurements.outerDia, 1)}")`;
    if (heightEl) heightEl.textContent = `${formatNumber(measurements.height / INCHES_PER_FOOT, 2)}' (${formatNumber(measurements.height, 1)}")`;
    if (spanEl) spanEl.textContent = `${formatNumber(measurements.span / INCHES_PER_FOOT, 2)}' (${formatNumber(measurements.span, 1)}")`;
    
    // Calculate structure center (must match main render)
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    data.beams.forEach(beam => {
        beam.corners.forEach(c => {
            minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
            minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
            minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
        });
    });
    const sc = {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        z: (minZ + maxZ) / 2
    };
    
    // Project 3D point to 2D screen coordinates (must match main renderer exactly)
    const project = (v) => {
        const cam = state.cam;
        const yawRad = cam.yaw;
        const pitchRad = cam.pitch;
        // Offset by structure center
        let x = (v.x || 0) - sc.x, y = (v.y || 0) - sc.y, z = (v.z || 0) - sc.z;
        
        // Rotate around Y axis (yaw)
        let x1 = x * Math.cos(-yawRad) - z * Math.sin(-yawRad);
        let z1 = x * Math.sin(-yawRad) + z * Math.cos(-yawRad);
        // Apply panX after yaw rotation
        x1 -= cam.panX;
        
        // Rotate around X axis (pitch)
        let y2 = y * Math.cos(pitchRad) - z1 * Math.sin(pitchRad);
        let z2 = y * Math.sin(pitchRad) + z1 * Math.cos(pitchRad);
        // Apply panY after pitch rotation
        y2 += cam.panY;
        
        // Perspective projection
        let depth = z2 + cam.dist;
        if (depth < MIN_CAM_DIST) depth = MIN_CAM_DIST;
        let scale = PERSPECTIVE_SCALE / depth;
        
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        return { x: cx + x1 * scale, y: cy - y2 * scale, depth };
    };
    
    const drawMeasurementLine = (point1, point2, label, color, offset = 0) => {
        if (!point1 || !point2) return;
        
        const p1 = project(point1);
        const p2 = project(point2);
        
        // Draw dimension line
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        
        // Draw end markers
        const markerSize = 6;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, markerSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p2.x, p2.y, markerSize, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw label at midpoint
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2 + offset;
        
        // Background for readability
        ctx.font = 'bold 12px Arial';
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(21, 32, 43, 0.9)';
        ctx.fillRect(midX - textWidth / 2 - 6, midY - 14, textWidth + 12, 20);
        
        // Border
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(midX - textWidth / 2 - 6, midY - 14, textWidth + 12, 20);
        
        // Text
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, midX, midY - 4);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    };
    
    // Draw inner diameter measurement (cyan)
    if (measurements.innerPoints) {
        const dist = measurements.innerDia;
        const label = `Inner: ${formatNumber(dist / INCHES_PER_FOOT, 1)}'`;
        drawMeasurementLine(measurements.innerPoints[0], measurements.innerPoints[1], label, '#00d2d3', -20);
    }
    
    // Draw outer diameter measurement (orange)
    if (measurements.outerPoints) {
        const dist = measurements.outerDia;
        const label = `Outer: ${formatNumber(dist / INCHES_PER_FOOT, 1)}'`;
        drawMeasurementLine(measurements.outerPoints[0], measurements.outerPoints[1], label, '#f0ad4e', 20);
    }
    
    // Draw height measurement (green) - vertical line on the side
    if (measurements.height > 0) {
        const heightPoint1 = {x: measurements.spanPoints[1].x + 10, y: measurements.heightPoints[0].y, z: 0};
        const heightPoint2 = {x: measurements.spanPoints[1].x + 10, y: measurements.heightPoints[1].y, z: 0};
        const label = `Height: ${formatNumber(measurements.height / INCHES_PER_FOOT, 1)}'`;
        drawMeasurementLine(heightPoint1, heightPoint2, label, '#2ecc71', 0);
    }
    
    // Draw span measurement (purple) - horizontal line at bottom
    if (measurements.span > 0) {
        const spanPoint1 = {x: measurements.spanPoints[0].x, y: measurements.spanPoints[0].y - 10, z: 0};
        const spanPoint2 = {x: measurements.spanPoints[1].x, y: measurements.spanPoints[0].y - 10, z: 0};
        const label = `Span: ${formatNumber(measurements.span / INCHES_PER_FOOT, 1)}'`;
        drawMeasurementLine(spanPoint1, spanPoint2, label, '#9b59b6', 0);
    }
    
    ctx.setLineDash([]);
}

function drawMeasurementsOverlay(data, structureCenter, w, h) {
    // Get or create the measurement overlay canvas
    let overlayCanvas = document.getElementById('measurement-overlay');
    const viewport = document.getElementById('viewport');
    if (!overlayCanvas && viewport) {
        overlayCanvas = document.createElement('canvas');
        overlayCanvas.id = 'measurement-overlay';
        overlayCanvas.style.position = 'absolute';
        overlayCanvas.style.top = '0';
        overlayCanvas.style.left = '0';
        overlayCanvas.style.pointerEvents = 'none';
        overlayCanvas.style.zIndex = '10';
        viewport.appendChild(overlayCanvas);
    }
    
    if (!overlayCanvas) return;
    
    // Match canvas size
    overlayCanvas.width = w;
    overlayCanvas.height = h;
    overlayCanvas.style.width = w + 'px';
    overlayCanvas.style.height = h + 'px';
    
    const overlayCtx = overlayCanvas.getContext('2d');
    overlayCtx.clearRect(0, 0, w, h);
    
    // Draw measurements on overlay
    if (state.showMeasurements && data) {
        drawMeasurements(overlayCtx, data);
    }
}

// ============================================================================
