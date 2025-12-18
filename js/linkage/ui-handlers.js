// ============================================================================
// UI EVENT HANDLERS
// ============================================================================

// Prevent sidebar interactions from affecting canvas
const sidebar = document.getElementById('sidebar');
sidebar.addEventListener('mousedown', e => e.stopPropagation(), true);
sidebar.addEventListener('mousemove', e => e.stopPropagation(), true);
sidebar.addEventListener('mouseup', e => e.stopPropagation(), true);
sidebar.addEventListener('wheel', e => e.stopPropagation(), true);

// Auto-save pending flag - tracks if autosave was requested during drag
let autoSavePending = false;

let drag = {active: false, x: 0, y: 0, mode: 'orbit'};

function isFormElement(el) {
    if (!el) return false;
    const tagName = el.tagName;
    if (tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA' || tagName === 'BUTTON') {
        return true;
    }
    // Check for custom controls
    if (el.closest('.input-wrap') || el.closest('#sidebar')) {
        return true;
    }
    return false;
}

// Only start drag when clicking in the viewport area
// Use viewport container instead of canvas to avoid issues with canvas stacking
const viewportElement = document.getElementById('viewport');
viewportElement.addEventListener('mousedown', e => {
    // Don't interfere with form elements or sidebar
    if (isFormElement(e.target)) return;
    
    // Only handle clicks on the viewport or its canvases
    if (!viewportElement.contains(e.target)) return;
    
    e.preventDefault(); // Prevent text selection during drag
    
    // Main canvas is now only the 3D view
    drag.active = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.mode = (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
});

// Use document-level listeners to catch mouse events even when cursor leaves canvas
document.addEventListener('mouseup', e => {
    if (drag.active) {
        drag.active = false;
        // If autosave was pending, trigger it now that dragging stopped
        if (autoSavePending) {
            autoSavePending = false;
            autoSave();
        }
    }
});

document.addEventListener('mousemove', e => {
    // Only process if we started a drag on the canvas
    if (!drag.active) return;
    
    // Stop drag if mouse is over sidebar (user moved there while dragging)
    if (isFormElement(e.target)) {
        return;
    }
    
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    
    if (drag.mode === 'orbit') {
        state.cam.yaw -= dx * 0.01;
        state.cam.pitch += dy * 0.01;
        state.cam.panX += dx;
        state.cam.panY += dy;
        let newAngle = state.foldAngle + dx * 0.005;
        newAngle = clamp(newAngle, MIN_FOLD_ANGLE, MAX_FOLD_ANGLE);
        
        // If collision enforcement is enabled, limit to safe range
        if (state.enforceCollision) {
            // Invalidate cache during drag
            invalidateGeometryCache();
            const data = solveLinkage(newAngle);
            const collisions = detectCollisions(data);
            if (collisions.length > 0) {
                // Find safe angle in the direction we're trying to move
                const previousAngle = state.foldAngle;
                const safeAngle = findSafeFoldAngle(newAngle, previousAngle);
                if (safeAngle !== null) {
                    newAngle = safeAngle;
                } else {
                    // Can't find safe angle, don't change
                    newAngle = state.foldAngle;
                }
            }
        }
        
        state.foldAngle = newAngle;
        syncUI('foldAngle');
        // Mark autosave as pending during drag (will save when drag ends)
        autoSavePending = true;
    } else if (drag.mode === 'pan') {
        state.cam.panX += dx;
        state.cam.panY += dy;
    }
    
    drag.x = e.clientX;
    drag.y = e.clientY;
    requestRender();
});

// Attach wheel event to viewport
viewportElement.onwheel = e => {
    e.preventDefault();
    // Main canvas is now only the 3D view
    state.cam.dist += e.deltaY * (state.cam.dist / 1000);
    if (state.cam.dist < MIN_CAM_DIST) state.cam.dist = MIN_CAM_DIST;
    requestRender();

// Prevent context menu on right-click in viewport
viewportElement.oncontextmenu = e => {
    e.preventDefault();
    return false;
};

// Keyboard shortcuts
document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    switch (e.key.toLowerCase()) {
        case 'r':
            if (e.ctrlKey || e.metaKey) return;
            document.getElementById('btn-fit').click();
            break;
        case 'f':
            if (e.ctrlKey || e.metaKey) return;
            document.getElementById('btn-fit').click();
            break;
        case ' ':
            e.preventDefault();
            if (state.animation.playing) {
                document.getElementById('btn-anim-pause').click();
            } else {
                document.getElementById('btn-anim-play').click();
            }
            break;
        case '+':
        case '=':
            state.cam.dist *= 0.9;
            if (state.cam.dist < MIN_CAM_DIST) state.cam.dist = MIN_CAM_DIST;
            requestRender();
            break;
        case '-':
        case '_':
            state.cam.dist *= 1.1;
            requestRender();
            break;
        case 'arrowleft':
            e.preventDefault();
            state.cam.panX += 50;
            requestRender();
            break;
        case 'arrowright':
            e.preventDefault();
            state.cam.panX -= 50;
            requestRender();
            break;
        case 'arrowup':
            e.preventDefault();
            state.cam.panY += 50;
            requestRender();
            break;
        case 'arrowdown':
            e.preventDefault();
            state.cam.panY -= 50;
            requestRender();
            break;
        case 's':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                saveConfig();
            }
            break;
        case 'o':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                loadConfig();
            }
            break;
        case 'e':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                exportToJSON();
            }
            break;
        case 'i':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                importFromJSON();
            }
            break;
        case 'z':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                if (e.shiftKey) {
                    redo();
                } else {
                    undo();
                }
            }
            break;
        case 'y':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                redo();
            }
            break;
    }
});

// Checkbox event listeners
document.getElementById('chk-collide').onchange = e => {
    state.enforceCollision = e.target.checked;
    // Invalidate cache when toggling collision enforcement
    invalidateGeometryCache();
    if (state.enforceCollision) {
        const data = solveLinkage(state.foldAngle);
        state.collisions = detectCollisions(data);
        state.hasCollision = state.collisions.length > 0;
    } else {
        state.collisions = [];
        state.hasCollision = false;
    }
    requestRender();
};

// Auto-resolve collision button
function findOptimalClosedAngle() {
    const targetRotation = Math.PI * 2; // 360 degrees
    const totalModules = state.modules;
    const currentAngle = state.foldAngle;
    
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
    
    // Linear search across the full range to find all crossing points
    // where total rotation = 360ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°
    const stepSize = degToRad(0.5); // Search in 0.5ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â° steps
    const crossings = [];
    
    let prevRotation = getTotalRotation(MIN_FOLD_ANGLE);
    let prevAngle = MIN_FOLD_ANGLE;
    
    for (let angle = MIN_FOLD_ANGLE + stepSize; angle <= MAX_FOLD_ANGLE; angle += stepSize) {
        const rotation = getTotalRotation(angle);
        
        // Check if we crossed the 360ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â° threshold
        const prevDiff = prevRotation - targetRotation;
        const currDiff = rotation - targetRotation;
        
        if ((prevDiff > 0 && currDiff <= 0) || (prevDiff <= 0 && currDiff > 0)) {
            // Found a crossing - interpolate to find precise angle
            const ratio = Math.abs(prevDiff) / (Math.abs(prevDiff) + Math.abs(currDiff));
            const crossingAngle = prevAngle + ratio * stepSize;
            crossings.push(crossingAngle);
        }
        
        // Also track if we're very close to 360ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°
        if (Math.abs(currDiff) < degToRad(2)) {
            // Check if this is better than nearby crossings
            let dominated = false;
            for (const existing of crossings) {
                if (Math.abs(existing - angle) < degToRad(5)) {
                    dominated = true;
                    break;
                }
            }
            if (!dominated) {
                crossings.push(angle);
            }
        }
        
        prevRotation = rotation;
        prevAngle = angle;
    }
    
    // Find the crossing closest to the current angle
    // Prefer crossings that would reduce the fold (go toward 360ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â° from over-folded)
    let bestAngle = null;
    let bestDistance = Infinity;
    
    const currentRotation = getTotalRotation(currentAngle);
    const isOverfolded = currentRotation > targetRotation;
    
    for (const crossing of crossings) {
        const distance = Math.abs(crossing - currentAngle);
        
        // If we're over-folded, prefer angles that are in the direction of less folding
        if (isOverfolded) {
            const crossingRotation = getTotalRotation(crossing);
            // The crossing should have rotation close to 360ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°
            if (Math.abs(crossingRotation - targetRotation) < degToRad(5)) {
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestAngle = crossing;
                }
            }
        } else {
            if (distance < bestDistance) {
                bestDistance = distance;
                bestAngle = crossing;
            }
        }
    }
    
    // If no good crossing found, refine with binary search from current position
    if (bestAngle === null) {
        // Find which direction reduces rotation toward 360ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°
        const rotAtCurrent = getTotalRotation(currentAngle);
        const rotAtHigher = getTotalRotation(Math.min(currentAngle + degToRad(5), MAX_FOLD_ANGLE));
        const rotAtLower = getTotalRotation(Math.max(currentAngle - degToRad(5), MIN_FOLD_ANGLE));
        
        // Search in the direction that moves rotation toward 360ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°
        let searchDir = 0;
        if (rotAtCurrent > targetRotation) {
            // Over-folded, need to reduce rotation
            searchDir = (rotAtHigher < rotAtCurrent) ? 1 : -1;
        } else {
            // Under-folded, need to increase rotation
            searchDir = (rotAtHigher > rotAtCurrent) ? 1 : -1;
        }
        
        // Search in that direction
        let searchAngle = currentAngle;
        for (let i = 0; i < 200; i++) {
            searchAngle += searchDir * stepSize;
            if (searchAngle < MIN_FOLD_ANGLE || searchAngle > MAX_FOLD_ANGLE) break;
            
            const rot = getTotalRotation(searchAngle);
            if (Math.abs(rot - targetRotation) < degToRad(1)) {
                bestAngle = searchAngle;
                break;
            }
        }
    }
    
    // Final refinement with small steps
    if (bestAngle !== null) {
        const fineStep = degToRad(0.1);
        let refined = bestAngle;
        let refinedDiff = Math.abs(getTotalRotation(refined) - targetRotation);
        
        for (let offset = -degToRad(2); offset <= degToRad(2); offset += fineStep) {
            const testAngle = bestAngle + offset;
            if (testAngle < MIN_FOLD_ANGLE || testAngle > MAX_FOLD_ANGLE) continue;
            const diff = Math.abs(getTotalRotation(testAngle) - targetRotation);
            if (diff < refinedDiff) {
                refinedDiff = diff;
                refined = testAngle;
            }
        }
        bestAngle = refined;
    }
    
    console.log('findOptimalClosedAngle:', {
        crossings: crossings.map(a => formatNumber(radToDeg(a), 1)),
        bestAngle: bestAngle ? formatNumber(radToDeg(bestAngle), 1) : null,
        currentRotation: formatNumber(radToDeg(getTotalRotation(currentAngle)), 1),
        bestRotation: bestAngle ? formatNumber(radToDeg(getTotalRotation(bestAngle)), 1) : null
    });
    
    return bestAngle;
}

document.getElementById('btn-auto-resolve').onclick = () => {
    if (!state.hasCollision) {
        showToast('No collisions to resolve', 'info');
        return;
    }
    
    // Check if this is a geometric overfold situation
    const hasGeometricOverfold = state.collisions.some(c => c.type === 'geometric-overfold');
    
    if (hasGeometricOverfold) {
        // Find the optimal angle where the ring just closes
        const optimalAngle = findOptimalClosedAngle();
        if (optimalAngle !== null) {
            state.foldAngle = optimalAngle;
            invalidateGeometryCache();
            syncUI('foldAngle');
            const data = solveLinkage(state.foldAngle);
            state.collisions = detectCollisions(data);
            state.hasCollision = state.collisions.length > 0;
            requestRender();
            showToast(`Set to optimal closed angle: ${formatNumber(radToDeg(optimalAngle), 1)}ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°`, 'info');
            return;
        }
    }
    
    // For other collision types, search for nearest safe angle
    const currentAngle = state.foldAngle;
    let bestAngle = null;
    let bestDistance = Infinity;
    
    // Search upward (more extended)
    const safeUp = findSafeFoldAngle(currentAngle, currentAngle - 0.01);
    if (safeUp !== null) {
        const distUp = Math.abs(safeUp - currentAngle);
        if (distUp < bestDistance) {
            bestAngle = safeUp;
            bestDistance = distUp;
    
    // Search downward (more folded)
    const safeDown = findSafeFoldAngle(currentAngle, currentAngle + 0.01);
    if (safeDown !== null) {
        const distDown = Math.abs(safeDown - currentAngle);
        if (distDown < bestDistance) {
            bestAngle = safeDown;
            bestDistance = distDown;
        }
    }
    
    if (bestAngle !== null) {
        state.foldAngle = bestAngle;
        invalidateGeometryCache();
        syncUI('foldAngle');
        const data = solveLinkage(state.foldAngle);
        state.collisions = detectCollisions(data);
        state.hasCollision = state.collisions.length > 0;
        requestRender();
        showToast(`Resolved to ${formatNumber(radToDeg(bestAngle), 1)}ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°`, 'info');
    } else {
        showToast('Could not find a safe angle nearby', 'error');
    }
};

document.getElementById('chk-brack').onchange = e => {
    state.showBrackets = e.target.checked;
    requestRender();
};
document.getElementById('chk-bolts').onchange = e => {
    state.showBolts = e.target.checked;
    requestRender();
};

// Sun position controls (topbar)
// Daylight slider handler (replaces azimuth/elevation sliders in solar mode)
function setupDaylightSlider() {
    const daylightSlider = document.getElementById('sl-daylight');
    if (!daylightSlider) return;
    
    // Initialize slider position based on current simulation time
    if (typeof SolarDesigner !== 'undefined' && SolarDesigner.isInitialized() && SolarDesigner.Simulation) {
        const hours = SolarDesigner.Simulation.time / 60;
        const sunrise = 5.5;
        const sunset = 19.5;
        const dayLength = sunset - sunrise;
        
        if (hours >= sunrise && hours <= sunset) {
            const daylightPercent = ((hours - sunrise) / dayLength) * 100;
            daylightSlider.value = daylightPercent;
            
            // Update time display
            const timeDisplay = document.getElementById('daylight-time-display');
            if (timeDisplay) {
                const h = Math.floor(hours);
                const m = Math.floor((hours - h) * 60);
                const ampm = h >= 12 ? 'PM' : 'AM';
                const displayHours = h % 12 || 12;
                timeDisplay.textContent = `${displayHours}:${m.toString().padStart(2, '0')} ${ampm}`;
    
    daylightSlider.oninput = e => {
        const daylightPercent = parseFloat(e.target.value);
        
        // Calculate sun position and time from daylight slider
        if (typeof SolarDesigner !== 'undefined' && SolarDesigner.isInitialized() && SolarDesigner.Simulation) {
            const sunPos = SolarDesigner.Simulation.calculateSunPositionFromDaylight(daylightPercent);
            
            // Update simulation time
            SolarDesigner.Simulation.time = sunPos.hours * 60;
            
            // Update time display
            SolarDesigner.Simulation.updateTimeDisplay();
            
            // Update daylight time display
            const timeDisplay = document.getElementById('daylight-time-display');
            if (timeDisplay) {
                const hours = Math.floor(sunPos.hours);
                const minutes = Math.floor((sunPos.hours - hours) * 60);
                const ampm = hours >= 12 ? 'PM' : 'AM';
                const displayHours = hours % 12 || 12;
                timeDisplay.textContent = `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
            
            // Recalculate solar output
            SolarDesigner.Simulation.calculateSolarOutput();
            SolarDesigner.Simulation.updateSimulationStats();
            if (typeof SolarDesigner.calculatePowerFlow === 'function') {
                SolarDesigner.calculatePowerFlow();
            SolarDesigner.render();

// Setup daylight slider when solar mode is initialized
if (typeof SolarDesigner !== 'undefined') {
    // Wait for initialization
    const checkInit = setInterval(() => {
        if (SolarDesigner.isInitialized && SolarDesigner.isInitialized()) {
            setupDaylightSlider();
            clearInterval(checkInit);
    setTimeout(() => clearInterval(checkInit), 5000); // Timeout after 5 seconds

document.getElementById('sel-orientation').onchange = e => {
    state.orientation = e.target.value;
    const isVertical = e.target.value === 'vertical';
    // Show/hide arch-specific options based on orientation
    document.getElementById('cap-upright-row').style.display = isVertical ? 'flex' : 'none';
    document.getElementById('arch-orientation-group').style.display = isVertical ? 'block' : 'none';
    // Update solar panel UI for arch vs cylinder mode
    updateArchWallFacesUI();
    invalidateGeometryCache();
    requestRender();
document.getElementById('chk-cap-uprights').onchange = e => {
    state.archCapUprights = e.target.checked;
    invalidateGeometryCache();
    requestRender();

document.getElementById('chk-fixed-beams').onchange = e => {
    state.useFixedBeams = e.target.checked;
    // Reset fixed beam length and height when toggling to recalculate at current angle
    if (state.useFixedBeams) {
        state.fixedBeamLength = null; // Will be calculated on next render
        state.fixedBeamHeight = null; // Will be calculated on next render
    invalidateGeometryCache();
    requestRender();
document.getElementById('chk-arch-flip').onchange = e => {
    state.archFlipVertical = e.target.checked;
    invalidateGeometryCache();
    requestRender();
document.getElementById('sl-arch-rotation').oninput = e => {
    const val = parseFloat(e.target.value) || 0;
    state.archRotation = val;
    document.getElementById('nb-arch-rotation').value = val;
    invalidateGeometryCache();
    requestRender();
document.getElementById('nb-arch-rotation').onchange = e => {
    let val = parseFloat(e.target.value) || 0;
    val = Math.max(-180, Math.min(180, val));
    state.archRotation = val;
    document.getElementById('sl-arch-rotation').value = val;
    e.target.value = val;
    invalidateGeometryCache();
    requestRender();
document.getElementById('btn-arch-reset').onclick = () => {
    state.archFlipVertical = false;
    state.archRotation = 0;
    document.getElementById('chk-arch-flip').checked = false;
    document.getElementById('sl-arch-rotation').value = 0;
    document.getElementById('nb-arch-rotation').value = 0;
    invalidateGeometryCache();
    requestRender();
document.getElementById('sl-array-count').oninput = e => {
    const val = parseInt(e.target.value) || 1;
    state.arrayCount = val;
    document.getElementById('nb-array-count').value = val;
    invalidateGeometryCache();
    requestRender();
document.getElementById('nb-array-count').onchange = e => {
    let val = parseInt(e.target.value) || 1;
    val = Math.max(1, Math.min(10, val));
    state.arrayCount = val;
    document.getElementById('sl-array-count').value = val;
    e.target.value = val;
    invalidateGeometryCache();
    requestRender();
document.getElementById('chk-vstack-reverse').onchange = e => {
    state.vStackReverse = e.target.checked;
    invalidateGeometryCache();
    requestRender();
document.getElementById('chk-measure').onchange = e => {
    state.measureMode = e.target.checked;
    document.getElementById('measure-display').style.display = state.measureMode ? 'block' : 'none';
    requestRender();

// === SOLAR PANEL EVENT HANDLERS ===
document.getElementById('chk-solar-panels').onchange = e => {
    state.solarPanels.enabled = e.target.checked;
    // Solar panel controls are always visible now
    
    // When enabling solar panels in cylinder/horizontal mode, snap to closed angle for proper alignment
    // In arch/vertical mode, panels can work at any fold angle since they're on wall faces
    if (state.solarPanels.enabled && state.orientation !== 'vertical') {
        const closedAngle = getOptimalClosedAngleForAnimation();
        state.foldAngle = closedAngle;
        // Sync the fold angle UI
        const foldAngleDeg = radToDeg(closedAngle);
        const slFoldAngle = document.getElementById('sl-fold');
        const nbFoldAngle = document.getElementById('nb-fold');
        if (slFoldAngle) slFoldAngle.value = foldAngleDeg;
        if (nbFoldAngle) nbFoldAngle.value = foldAngleDeg.toFixed(1);
        showToast('Structure snapped to closed position for solar panel alignment', 'info');
    
    // Update visibility of arch-mode-specific controls
    updateArchWallFacesUI();
    
    invalidateGeometryCache();
    requestRender();

// ========== TOP PANEL DIMENSION CONTROLS ==========
document.getElementById('sl-panel-length-top').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.topPanels.panelLength = val;
    document.getElementById('nb-panel-length-top').value = val;
    requestRender();
document.getElementById('nb-panel-length-top').onchange = e => {
    let val = parseFloat(e.target.value) || 65;
    val = Math.max(12, Math.min(120, val));
    state.solarPanels.topPanels.panelLength = val;
    document.getElementById('sl-panel-length-top').value = val;
    e.target.value = val;
    requestRender();
document.getElementById('sl-panel-width-top').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.topPanels.panelWidth = val;
    document.getElementById('nb-panel-width-top').value = val;
    requestRender();
document.getElementById('nb-panel-width-top').onchange = e => {
    let val = parseFloat(e.target.value) || 39;
    val = Math.max(12, Math.min(80, val));
    state.solarPanels.topPanels.panelWidth = val;
    document.getElementById('sl-panel-width-top').value = val;
    e.target.value = val;
    requestRender();
document.getElementById('sl-panel-thick-top').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.topPanels.panelThickness = val;
    document.getElementById('nb-panel-thick-top').value = val;
    requestRender();
document.getElementById('nb-panel-thick-top').onchange = e => {
    let val = parseFloat(e.target.value) || 1.5;
    val = Math.max(0.5, Math.min(4, val));
    state.solarPanels.topPanels.panelThickness = val;
    document.getElementById('sl-panel-thick-top').value = val;
    e.target.value = val;
    requestRender();

// ========== SIDE PANEL DIMENSION CONTROLS ==========
document.getElementById('sl-panel-length-side').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.sidePanels.panelLength = val;
    document.getElementById('nb-panel-length-side').value = val;
    requestRender();
document.getElementById('nb-panel-length-side').onchange = e => {
    let val = parseFloat(e.target.value) || 65;
    val = Math.max(12, Math.min(120, val));
    state.solarPanels.sidePanels.panelLength = val;
    document.getElementById('sl-panel-length-side').value = val;
    e.target.value = val;
    requestRender();
document.getElementById('sl-panel-width-side').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.sidePanels.panelWidth = val;
    document.getElementById('nb-panel-width-side').value = val;
    requestRender();
document.getElementById('nb-panel-width-side').onchange = e => {
    let val = parseFloat(e.target.value) || 39;
    val = Math.max(12, Math.min(80, val));
    state.solarPanels.sidePanels.panelWidth = val;
    document.getElementById('sl-panel-width-side').value = val;
    e.target.value = val;
    requestRender();
document.getElementById('sl-panel-thick-side').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.sidePanels.panelThickness = val;
    document.getElementById('nb-panel-thick-side').value = val;
    requestRender();
document.getElementById('nb-panel-thick-side').onchange = e => {
    let val = parseFloat(e.target.value) || 1.5;
    val = Math.max(0.5, Math.min(4, val));
    state.solarPanels.sidePanels.panelThickness = val;
    document.getElementById('sl-panel-thick-side').value = val;
    e.target.value = val;
    requestRender();

// ========== TOP PANEL ELECTRICAL CONTROLS ==========
document.getElementById('sl-panel-watts-top').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.topPanels.ratedWatts = val;
    document.getElementById('nb-panel-watts-top').value = val;
document.getElementById('nb-panel-watts-top').onchange = e => {
    let val = parseFloat(e.target.value) || 400;
    val = Math.max(50, Math.min(1000, val));
    state.solarPanels.topPanels.ratedWatts = val;
    document.getElementById('sl-panel-watts-top').value = Math.min(800, val);
    e.target.value = val;
document.getElementById('nb-panel-voc-top').onchange = e => {
    let val = parseFloat(e.target.value) || 49.5;
    val = Math.max(0, Math.min(100, val));
    state.solarPanels.topPanels.voc = val;
    e.target.value = val;
document.getElementById('nb-panel-vmp-top').onchange = e => {
    let val = parseFloat(e.target.value) || 41.5;
    val = Math.max(0, Math.min(100, val));
    state.solarPanels.topPanels.vmp = val;
    e.target.value = val;
document.getElementById('nb-panel-isc-top').onchange = e => {
    let val = parseFloat(e.target.value) || 10.2;
    val = Math.max(0, Math.min(30, val));
    state.solarPanels.topPanels.isc = val;
    e.target.value = val;
document.getElementById('nb-panel-imp-top').onchange = e => {
    let val = parseFloat(e.target.value) || 9.65;
    val = Math.max(0, Math.min(30, val));
    state.solarPanels.topPanels.imp = val;
    e.target.value = val;

// ========== SIDE PANEL ELECTRICAL CONTROLS ==========
document.getElementById('sl-panel-watts-side').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.sidePanels.ratedWatts = val;
    document.getElementById('nb-panel-watts-side').value = val;
document.getElementById('nb-panel-watts-side').onchange = e => {
    let val = parseFloat(e.target.value) || 400;
    val = Math.max(50, Math.min(1000, val));
    state.solarPanels.sidePanels.ratedWatts = val;
    document.getElementById('sl-panel-watts-side').value = Math.min(800, val);
    e.target.value = val;
document.getElementById('nb-panel-voc-side').onchange = e => {
    let val = parseFloat(e.target.value) || 49.5;
    val = Math.max(0, Math.min(100, val));
    state.solarPanels.sidePanels.voc = val;
    e.target.value = val;
document.getElementById('nb-panel-vmp-side').onchange = e => {
    let val = parseFloat(e.target.value) || 41.5;
    val = Math.max(0, Math.min(100, val));
    state.solarPanels.sidePanels.vmp = val;
    e.target.value = val;
document.getElementById('nb-panel-isc-side').onchange = e => {
    let val = parseFloat(e.target.value) || 10.2;
    val = Math.max(0, Math.min(30, val));
    state.solarPanels.sidePanels.isc = val;
    e.target.value = val;
document.getElementById('nb-panel-imp-side').onchange = e => {
    let val = parseFloat(e.target.value) || 9.65;
    val = Math.max(0, Math.min(30, val));
    state.solarPanels.sidePanels.imp = val;
    e.target.value = val;

// Layout mode dropdown
const layoutDropdown = document.getElementById('sel-panel-layout');
// Prevent event bubbling that might interfere with dropdown selection
['mousedown', 'mouseup', 'click', 'focus', 'pointerdown', 'wheel'].forEach(eventType => {
    layoutDropdown.addEventListener(eventType, e => e.stopPropagation());
// Also prevent scroll events on the parent container while dropdown is focused
layoutDropdown.addEventListener('focus', () => {
    const controlsDiv = document.getElementById('controls');
    if (controlsDiv) {
        controlsDiv.style.overflowY = 'hidden';
layoutDropdown.addEventListener('blur', () => {
    const controlsDiv = document.getElementById('controls');
    if (controlsDiv) {
        controlsDiv.style.overflowY = 'auto';
layoutDropdown.onchange = e => {
    state.solarPanels.layoutMode = e.target.value;
    // Show/hide mode-specific controls
    document.getElementById('rect-mode-controls').style.display = e.target.value === 'rectangular' ? 'block' : 'none';
    document.getElementById('radial-mode-controls').style.display = e.target.value === 'radial' ? 'block' : 'none';
    document.getElementById('spiral-mode-controls').style.display = e.target.value === 'spiral' ? 'block' : 'none';
    requestRender();

// Side wall panels checkbox (cylinder mode)
document.getElementById('chk-side-wall-panels').onchange = e => {
    state.solarPanels.sidePanels.enabled = e.target.checked;
    updateArchWallFacesUI();
    requestRender();

// Top surface panels checkbox (cylinder mode)
document.getElementById('chk-top-panels').onchange = e => {
    state.solarPanels.topPanels.enabled = e.target.checked;
    updateArchWallFacesUI();
    requestRender();

// Side panel grid controls (arch mode or cylinder side walls)
document.getElementById('nb-grid-rows').onchange = e => {
    let val = parseInt(e.target.value) || 2;
    val = Math.max(1, Math.min(10, val));
    state.solarPanels.sidePanels.gridRows = val;
    e.target.value = val;
    requestRender();
document.getElementById('nb-grid-cols').onchange = e => {
    let val = parseInt(e.target.value) || 2;
    val = Math.max(1, Math.min(10, val));
    state.solarPanels.sidePanels.gridCols = val;
    e.target.value = val;
    requestRender();

// Top panel grid controls (cylinder mode)
document.getElementById('nb-top-panel-rows').onchange = e => {
    let val = parseInt(e.target.value) || 2;
    val = Math.max(1, Math.min(10, val));
    state.solarPanels.topPanels.gridRows = val;
    e.target.value = val;
    requestRender();
document.getElementById('nb-top-panel-cols').onchange = e => {
    let val = parseInt(e.target.value) || 2;
    val = Math.max(1, Math.min(10, val));
    state.solarPanels.topPanels.gridCols = val;
    e.target.value = val;
    requestRender();

document.getElementById('sl-grid-rotation').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.gridRotation = val;
    document.getElementById('nb-grid-rotation').value = val;
    requestRender();
document.getElementById('nb-grid-rotation').onchange = e => {
    let val = parseFloat(e.target.value) || 0;
    val = Math.max(-180, Math.min(180, val));
    state.solarPanels.gridRotation = val;
    document.getElementById('sl-grid-rotation').value = val;
    e.target.value = val;
    requestRender();

// Radial/Pinwheel mode controls
document.getElementById('sl-radial-count').oninput = e => {
    const val = parseInt(e.target.value);
    state.solarPanels.radialCount = val;
    document.getElementById('nb-radial-count').value = val;
    requestRender();
document.getElementById('nb-radial-count').onchange = e => {
    let val = parseInt(e.target.value) || 8;
    val = Math.max(3, Math.min(24, val));
    state.solarPanels.radialCount = val;
    document.getElementById('sl-radial-count').value = val;
    e.target.value = val;
    requestRender();
document.getElementById('sl-radial-offset').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.radialOffset = val;
    document.getElementById('nb-radial-offset').value = val;
    requestRender();
document.getElementById('nb-radial-offset').onchange = e => {
    let val = parseFloat(e.target.value) || 0;
    val = Math.max(0, Math.min(200, val));
    state.solarPanels.radialOffset = val;
    document.getElementById('sl-radial-offset').value = val;
    e.target.value = val;
    requestRender();
document.getElementById('sl-radial-rotation').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.radialRotation = val;
    document.getElementById('nb-radial-rotation').value = val;
    requestRender();
document.getElementById('nb-radial-rotation').onchange = e => {
    let val = parseFloat(e.target.value) || 0;
    val = Math.max(-180, Math.min(180, val));
    state.solarPanels.radialRotation = val;
    document.getElementById('sl-radial-rotation').value = val;
    e.target.value = val;
    requestRender();
document.getElementById('sl-radial-lateral').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.radialLateralOffset = val;
    document.getElementById('nb-radial-lateral').value = val;
    requestRender();
document.getElementById('nb-radial-lateral').onchange = e => {
    let val = parseFloat(e.target.value) || 0;
    val = Math.max(-100, Math.min(100, val));
    state.solarPanels.radialLateralOffset = val;
    document.getElementById('sl-radial-lateral').value = val;
    e.target.value = val;
    requestRender();
document.getElementById('sl-pinwheel-angle').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.pinwheelAngle = val;
    document.getElementById('nb-pinwheel-angle').value = val;
    requestRender();
document.getElementById('nb-pinwheel-angle').onchange = e => {
    let val = parseFloat(e.target.value) || 0;
    val = Math.max(-45, Math.min(45, val));
    state.solarPanels.pinwheelAngle = val;
    document.getElementById('sl-pinwheel-angle').value = val;
    e.target.value = val;
    requestRender();

// Spiral (multi-panel arms) controls
document.getElementById('sl-spiral-arm-count').oninput = e => {
    const val = parseInt(e.target.value);
    state.solarPanels.spiralArmCount = val;
    document.getElementById('nb-spiral-arm-count').value = val;
    requestRender();
document.getElementById('nb-spiral-arm-count').onchange = e => {
    let val = parseInt(e.target.value);
    if (isNaN(val)) val = 2;
    state.solarPanels.spiralArmCount = val;
    e.target.value = val;
    requestRender();
document.getElementById('chk-spiral-secondary').onchange = e => {
    state.solarPanels.spiralSecondaryEnabled = e.target.checked;
    requestRender();
document.getElementById('sl-spiral-secondary-radial').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.spiralSecondaryRadialOffset = val;
    document.getElementById('nb-spiral-secondary-radial').value = val;
    requestRender();
document.getElementById('nb-spiral-secondary-radial').onchange = e => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 24;
    state.solarPanels.spiralSecondaryRadialOffset = val;
    e.target.value = val;
    requestRender();
document.getElementById('sl-spiral-secondary-lateral').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.spiralSecondaryLateralOffset = val;
    document.getElementById('nb-spiral-secondary-lateral').value = val;
    requestRender();
document.getElementById('nb-spiral-secondary-lateral').onchange = e => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 0;
    state.solarPanels.spiralSecondaryLateralOffset = val;
    e.target.value = val;
    requestRender();
document.getElementById('sl-spiral-secondary-pinwheel').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.spiralSecondaryPinwheel = val;
    document.getElementById('nb-spiral-secondary-pinwheel').value = val;
    requestRender();
document.getElementById('nb-spiral-secondary-pinwheel').onchange = e => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 0;
    state.solarPanels.spiralSecondaryPinwheel = val;
    e.target.value = val;
    requestRender();
document.getElementById('sl-spiral-secondary-rotation').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.spiralSecondaryRotation = val;
    document.getElementById('nb-spiral-secondary-rotation').value = val;
    requestRender();
document.getElementById('nb-spiral-secondary-rotation').onchange = e => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 0;
    state.solarPanels.spiralSecondaryRotation = val;
    e.target.value = val;
    requestRender();
document.getElementById('sl-spiral-arm-radial-step').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.spiralArmRadialStep = val;
    document.getElementById('nb-spiral-arm-radial-step').value = val;
    requestRender();
document.getElementById('nb-spiral-arm-radial-step').onchange = e => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 0;
    state.solarPanels.spiralArmRadialStep = val;
    e.target.value = val;
    requestRender();
document.getElementById('sl-spiral-arm-lateral-step').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.spiralArmLateralStep = val;
    document.getElementById('nb-spiral-arm-lateral-step').value = val;
    requestRender();
document.getElementById('nb-spiral-arm-lateral-step').onchange = e => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 0;
    state.solarPanels.spiralArmLateralStep = val;
    e.target.value = val;
    requestRender();
document.getElementById('sl-spiral-arm-pinwheel-step').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.spiralArmPinwheelStep = val;
    document.getElementById('nb-spiral-arm-pinwheel-step').value = val;
    requestRender();
document.getElementById('nb-spiral-arm-pinwheel-step').onchange = e => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 0;
    state.solarPanels.spiralArmPinwheelStep = val;
    e.target.value = val;
    requestRender();
document.getElementById('sl-spiral-arm-rotation-step').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.spiralArmRotationStep = val;
    document.getElementById('nb-spiral-arm-rotation-step').value = val;
    requestRender();
document.getElementById('nb-spiral-arm-rotation-step').onchange = e => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 0;
    state.solarPanels.spiralArmRotationStep = val;
    e.target.value = val;
    requestRender();

// ========== TOP PANEL PADDING CONTROLS ==========
document.getElementById('nb-padding-x-top').onchange = e => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 2;
    state.solarPanels.topPanels.paddingX = val;
    e.target.value = val;
    requestRender();
document.getElementById('nb-padding-y-top').onchange = e => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 2;
    state.solarPanels.topPanels.paddingY = val;
    e.target.value = val;
    requestRender();

// ========== SIDE PANEL PADDING CONTROLS ==========
document.getElementById('nb-padding-x-side').onchange = e => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 2;
    state.solarPanels.sidePanels.paddingX = val;
    e.target.value = val;
    requestRender();
document.getElementById('nb-padding-y-side').onchange = e => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 2;
    state.solarPanels.sidePanels.paddingY = val;
    e.target.value = val;
    requestRender();

// Panel lift controls (top panels only)
document.getElementById('sl-panel-lift').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.topPanels.panelLift = val;
    document.getElementById('nb-panel-lift').value = val;
    requestRender();
document.getElementById('nb-panel-lift').onchange = e => {
    let val = parseFloat(e.target.value) || 0;
    val = Math.max(0, Math.min(96, val));
    state.solarPanels.topPanels.panelLift = val;
    document.getElementById('sl-panel-lift').value = Math.min(48, val);
    e.target.value = val;
    requestRender();

// Arch mode roof face selection buttons
document.getElementById('btn-wall-all').onclick = () => {
    const numFaces = state.modules * 2;  // 2 faces per module
    state.solarPanels.archWallFaces = new Array(numFaces).fill(true);
    generateWallFaceButtons();
    requestRender();

document.getElementById('btn-wall-none').onclick = () => {
    const numFaces = state.modules * 2;  // 2 faces per module
    state.solarPanels.archWallFaces = new Array(numFaces).fill(false);
    generateWallFaceButtons();
    requestRender();

document.getElementById('btn-wall-outer').onclick = () => {
    // Select odd-numbered faces (1a, 2a, 3a, etc. - the "a" faces)
    const numFaces = state.modules * 2;
    state.solarPanels.archWallFaces = new Array(numFaces).fill(false);
    for (let i = 0; i < numFaces; i += 2) {
        state.solarPanels.archWallFaces[i] = true;
    generateWallFaceButtons();
    requestRender();

document.getElementById('btn-wall-inner').onclick = () => {
    // Select even-numbered faces (1b, 2b, 3b, etc. - the "b" faces)
    const numFaces = state.modules * 2;
    state.solarPanels.archWallFaces = new Array(numFaces).fill(false);
    for (let i = 1; i < numFaces; i += 2) {
        state.solarPanels.archWallFaces[i] = true;
    generateWallFaceButtons();
    requestRender();

// Arch panel Lift controls (distance above roof surface)
document.getElementById('sl-arch-panel-offset').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.archPanelOffset = val;
    document.getElementById('nb-arch-panel-offset').value = val;
    requestRender();
document.getElementById('nb-arch-panel-offset').onchange = e => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 2;
    state.solarPanels.archPanelOffset = val;
    document.getElementById('sl-arch-panel-offset').value = val;
    e.target.value = val;
    requestRender();

// Arch panel Slide controls (offset along slope direction)
document.getElementById('sl-arch-panel-offset-y').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.archPanelSlide = val;
    document.getElementById('nb-arch-panel-offset-y').value = val;
    requestRender();
document.getElementById('nb-arch-panel-offset-y').onchange = e => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 0;
    state.solarPanels.archPanelSlide = val;
    document.getElementById('sl-arch-panel-offset-y').value = val;
    e.target.value = val;
    requestRender();

// Arch panel A/B Separation controls
document.getElementById('sl-arch-panel-sep').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.archPanelSeparation = val;
    document.getElementById('nb-arch-panel-sep').value = val;
    requestRender();
document.getElementById('nb-arch-panel-sep').onchange = e => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 0;
    state.solarPanels.archPanelSeparation = val;
    document.getElementById('sl-arch-panel-sep').value = val;
    e.target.value = val;
    requestRender();


// Support beams toggle
document.getElementById('chk-support-beams').onchange = e => {
    state.solarPanels.showSupportBeams = e.target.checked;
    document.getElementById('support-beam-controls').style.display = e.target.checked ? 'block' : 'none';
    invalidateGeometryCache();
    requestRender();

// Support beam length controls
document.getElementById('sl-support-length').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.supportBeamLength = val;
    document.getElementById('nb-support-length').value = val;
    invalidateGeometryCache();
    requestRender();
document.getElementById('nb-support-length').onchange = e => {
    let val = parseFloat(e.target.value) || 96;
    val = Math.max(12, Math.min(360, val));
    state.solarPanels.supportBeamLength = val;
    document.getElementById('sl-support-length').value = Math.max(24, Math.min(240, val));
    e.target.value = val;
    invalidateGeometryCache();
    requestRender();

// Support beam fold angle controls
document.getElementById('sl-support-fold').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.supportBeamFoldAngle = val;
    document.getElementById('nb-support-fold').value = val;
    invalidateGeometryCache();
    requestRender();
document.getElementById('nb-support-fold').onchange = e => {
    let val = parseFloat(e.target.value) || 0;
    val = Math.max(-90, Math.min(90, val));
    state.solarPanels.supportBeamFoldAngle = val;
    document.getElementById('sl-support-fold').value = val;
    e.target.value = val;
    invalidateGeometryCache();
    requestRender();

// Support beam rotation controls
document.getElementById('sl-support-rotation').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.supportBeamRotation = val;
    document.getElementById('nb-support-rotation').value = val;
    invalidateGeometryCache();
    requestRender();
document.getElementById('nb-support-rotation').onchange = e => {
    let val = parseFloat(e.target.value) || 0;
    val = Math.max(-180, Math.min(180, val));
    state.solarPanels.supportBeamRotation = val;
    document.getElementById('sl-support-rotation').value = Math.max(-45, Math.min(45, val));
    e.target.value = val;
    invalidateGeometryCache();
    requestRender();

// Support beam horizontal offset controls
document.getElementById('sl-support-offset-h').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.supportBeamOffsetH = val;
    document.getElementById('nb-support-offset-h').value = val;
    invalidateGeometryCache();
    requestRender();
document.getElementById('nb-support-offset-h').onchange = e => {
    let val = parseFloat(e.target.value) || -120;
    state.solarPanels.supportBeamOffsetH = val;
    // Clamp slider to its range, but allow number input to go beyond
    const sliderVal = Math.max(-120, Math.min(120, val));
    document.getElementById('sl-support-offset-h').value = sliderVal;
    e.target.value = val;
    invalidateGeometryCache();
    requestRender();

// Support beam vertical offset controls
document.getElementById('sl-support-offset-v').oninput = e => {
    const val = parseFloat(e.target.value);
    state.solarPanels.supportBeamOffsetV = val;
    document.getElementById('nb-support-offset-v').value = val;
    invalidateGeometryCache();
    requestRender();
document.getElementById('nb-support-offset-v').onchange = e => {
    let val = parseFloat(e.target.value) || 0;
    state.solarPanels.supportBeamOffsetV = val;
    // Clamp slider to its range, but allow number input to go beyond
    const sliderVal = Math.max(-120, Math.min(120, val));
    document.getElementById('sl-support-offset-v').value = sliderVal;
    e.target.value = val;
    invalidateGeometryCache();
    requestRender();

document.getElementById('chk-anim-loop').onchange = e => {
    state.animation.loop = e.target.checked;
    // If enabling loop, disable ping-pong
    if (e.target.checked) {
        document.getElementById('chk-anim-pingpong').checked = false;
        state.animation.pingPong = false;
document.getElementById('chk-high-contrast').onchange = e => {
    document.body.classList.toggle('high-contrast', e.target.checked);

// Button event listeners
document.getElementById('btn-reset').onclick = () => location.reload();
document.getElementById('btn-fit').onclick = () => {
    state.cam = { yaw: 0.4, pitch: -0.3, dist: DEFAULT_CAM_DIST, panX: 0, panY: 0 };
    requestRender();

// Topbar animation controls
document.getElementById('chk-anim-pingpong-top').onchange = e => {
    state.animation.pingPong = e.target.checked;
    // Sync with sidebar checkbox if it exists
    const sidebarChk = document.getElementById('chk-anim-pingpong');
    if (sidebarChk) sidebarChk.checked = e.target.checked;
document.getElementById('nb-anim-stop-top').onchange = e => {
    let val = parseFloat(e.target.value) || 135;
    val = Math.max(0, Math.min(180, val));
    state.animation.stopAngle = val;
    e.target.value = val;
    // Sync with sidebar inputs if they exist
    const sidebarSlider = document.getElementById('sl-anim-stop');
    const sidebarNumber = document.getElementById('nb-anim-stop');
    if (sidebarSlider) sidebarSlider.value = val;
    if (sidebarNumber) sidebarNumber.value = val;

// Topbar Save/Export buttons
document.getElementById('btn-save-top').onclick = saveConfig;
document.getElementById('btn-load-top').onclick = loadConfig;
document.getElementById('btn-export-json-top').onclick = exportToJSON;
document.getElementById('btn-import-json-top').onclick = importFromJSON;
document.getElementById('btn-build-guide-top').onclick = showBuildGuide;
document.getElementById('btn-solar-simulator').onclick = exportToSolarSimulator;

// Preset buttons
document.getElementById('btn-save-preset').onclick = savePreset;
document.getElementById('btn-delete-preset').onclick = deletePreset;
document.getElementById('preset-select').onchange = e => {
    if (e.target.value) loadPreset(e.target.value);

// Animation controls
document.getElementById('btn-anim-play').onclick = () => {
    state.animation.playing = true;
    state.animation.lastTime = 0; // Reset delta time tracking
    updateAnimationStatus();
    requestAnimationFrame(animateFold);
document.getElementById('btn-anim-pause').onclick = () => {
    state.animation.playing = false;
    if (state.animation.frameId) {
        cancelAnimationFrame(state.animation.frameId);
    updateAnimationStatus();
document.getElementById('btn-anim-reverse').onclick = () => {
    state.animation.direction *= -1;
    updateAnimationStatus();
    showToast(`Animation direction: ${state.animation.direction > 0 ? 'Expanding' : 'Collapsing'}`, 'info');
document.getElementById('sl-anim-speed').addEventListener('input', e => {
    state.animation.speed = parseFloat(e.target.value);
document.getElementById('chk-anim-pingpong').onchange = e => {
    state.animation.pingPong = e.target.checked;
    // If enabling ping-pong, disable regular loop
    if (e.target.checked) {
        document.getElementById('chk-anim-loop').checked = false;
        state.animation.loop = false;
document.getElementById('sl-anim-stop').oninput = e => {
    const val = parseFloat(e.target.value) || null;
    state.animation.stopAngle = val;
    document.getElementById('nb-anim-stop').value = val;
document.getElementById('nb-anim-stop').onchange = e => {
    let val = parseFloat(e.target.value);
    if (isNaN(val) || val < 5 || val > 175) {
        // Reset to closed angle if invalid
        const closedAngle = radToDeg(getOptimalClosedAngleForAnimation());
        val = closedAngle;
        e.target.value = val;
        document.getElementById('sl-anim-stop').value = val;
    }
    state.animation.stopAngle = val;
    document.getElementById('sl-anim-stop').value = val;
};

// Undo/Redo buttons
document.getElementById('btn-undo').onclick = undo;
document.getElementById('btn-redo').onclick = redo;

// Sidebar toggle
document.getElementById('sidebar-toggle').onclick = () => {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebar-toggle');
    sidebar.classList.toggle('collapsed');
    toggle.textContent = sidebar.classList.contains('collapsed') ? '▶' : '◀';
};
    toggle.textContent = sidebar.classList.contains('collapsed') ? 'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¶' : 'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬';

// Canvas click handler (reserved for future use)
canvas.onclick = e => {
    // Currently no click functionality needed
};

// ============================================================================
// SOLAR DESIGN MODE - ELECTRICAL SIMULATION (External Module)
// ============================================================================
