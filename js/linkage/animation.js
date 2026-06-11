// ============================================================================
// LINKAGE LAB - Animation (fold/unfold, actuator, closed-angle cache) (ES module)
// Depends on global: state, solveLinkage helpers, requestRender, syncUI, geometry-classes folding helpers
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';

// ============================================================================
// ANIMATION SYSTEM
// ============================================================================
    
    /**
     * Animates the fold/unfold sequence
     */
    /**
     * Updates the animation status display in both sidebar and topbar
     */
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
    
    /**
     * Calculates the optimal closed angle (where ring completes 360°)
     * Cached for performance during animation
     * @returns {number} The optimal closed angle in radians
     */
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
        
        // Search for the angle where rotation = 360°
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
            
            // If we've passed 360° and are getting worse, stop
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
    
    /**
     * Animates the fold/unfold sequence using requestAnimationFrame
     * Supports forward, reverse, loop, and ping-pong modes
     * Animation stops at fully folded (min angle) and fully deployed (360° ring angle)
     * @param {number} timestamp - Current animation timestamp from requestAnimationFrame
     */
    function animateFold(timestamp) {
        if (!state.animation.playing) {
            updateAnimationStatus();
            return;
        }
    
        const speed = state.animation.speed;
    
        // Panel deploy phase — runs after structure is fully open, independent of fold angle
        if (hasFoldingSolarPanels() && state.animation.foldingPanelPhase === 'panel_deploy') {
            if (!state.animation.foldingPanelDeployStart) {
                state.animation.foldingPanelDeployStart = timestamp;
            }
            const deployDuration = FOLDING_PANEL_DEPLOY_MS / speed;
            const elapsed = timestamp - state.animation.foldingPanelDeployStart;
            const t = Math.min(1, elapsed / deployDuration);
            const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            state.animation.foldingPanelDeploy = eased;
            requestRender();
            if (t >= 1) {
                state.animation.foldingPanelDeploy = 1;
                state.animation.foldingPanelPhase = 'idle';
                state.animation.foldingPanelsUnfoldPhase = false;
                state.animation.foldingPanelDeployStart = 0;
                state.animation.foldingPanelDeploy = 0;
                state.animation.direction = -1;
                state.animation.lastTime = 0;
                updateAnimationStatus();
                requestRender();
            }
            if (state.animation.playing) {
                state.animation.frameId = requestAnimationFrame(animateFold);
            }
            return;
        }
        
        // Calculate delta time for smooth animation regardless of frame rate
        if (!state.animation.lastTime) {
            state.animation.lastTime = timestamp;
        }
        const deltaTime = timestamp - state.animation.lastTime;
        state.animation.lastTime = timestamp;
        
        // Min angle = user-set or auto-computed V-beam contact limit; Max angle = stop angle or optimal closed
        const minAngle = getEffectiveMinFoldAngle();
        const closedAngle = getOptimalClosedAngleForAnimation();
        // Use stopAngle if set, otherwise use closed angle
        const stopAngleRad = state.animation.stopAngle !== null 
            ? degToRad(state.animation.stopAngle) 
            : closedAngle;
        const maxAngle = Math.min(stopAngleRad, closedAngle); // Don't exceed closed angle
        const direction = state.animation.direction;
        
        // Calculate step based on delta time (target ~60fps equivalent)
        // Full cycle should take about 3 seconds at speed 1.0
        const fullCycleMs = 3000 / speed;
        const angleRange = maxAngle - minAngle;
        const step = (angleRange / fullCycleMs) * deltaTime * direction;
        
        // Check if we're in a pause state
        if (state.animation.pauseUntil && timestamp < state.animation.pauseUntil) {
            state.animation.frameId = requestAnimationFrame(animateFold);
            return;
        }
        if (state.animation.pauseUntil) {
            state.animation.pauseUntil = null;
            state.animation.lastTime = 0;
        }
    
        if (hasFoldingSolarPanels() && state.animation.foldingPanelPhase === 'stowed' && direction > 0) {
            state.animation.foldingPanelPhase = 'structure_deploy';
        }
        
        let currentAngle = state.foldAngle + step;
        let reachedEnd = false;
        let reachedDeployed = false;
        let reachedFolded = false;
        
        // Check bounds - max = deployed (360°), min = folded
        if (direction > 0 && currentAngle >= maxAngle) {
            currentAngle = maxAngle;
            reachedEnd = true;
            reachedDeployed = true;
        } else if (direction < 0 && currentAngle <= minAngle) {
            currentAngle = minAngle;
            reachedEnd = true;
            reachedFolded = true;
        }
        
        // Handle end of animation
        if (reachedEnd) {
            // Update angle first
            state.foldAngle = currentAngle;
            syncUI('foldAngle');
            requestRender();
            
            if (state.animation.pingPong || state.animation.loop) {
                if (hasFoldingSolarPanels()) {
                    if (reachedFolded) {
                        state.animation.pauseUntil = timestamp + 1000;
                        state.animation.foldingPanelPhase = 'stowed';
                        state.animation.foldingPanelDeploy = 0;
                        state.animation.foldingPanelsUnfoldPhase = true;
                        state.animation.direction = 1;
                        updateAnimationStatus();
                    } else if (reachedDeployed) {
                        state.animation.foldingPanelPhase = 'panel_deploy';
                        state.animation.foldingPanelDeploy = 0;
                        state.animation.foldingPanelDeployStart = 0;
                        state.animation.foldingPanelsUnfoldPhase = true;
                        state.animation.lastTime = 0;
                    } else if (state.animation.pingPong) {
                        state.animation.direction *= -1;
                        updateAnimationStatus();
                    } else if (state.animation.loop) {
                        state.foldAngle = direction > 0 ? minAngle : maxAngle;
                        syncUI('foldAngle');
                        requestRender();
                    }
                } else {
                    if (reachedDeployed) {
                        state.animation.pauseUntil = timestamp + 1000;
                    }
                    if (state.animation.pingPong) {
                        state.animation.direction *= -1;
                        updateAnimationStatus();
                    } else if (state.animation.loop) {
                        state.foldAngle = direction > 0 ? minAngle : maxAngle;
                        syncUI('foldAngle');
                        requestRender();
                    }
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
    /**
     * Animates the structure folding/unfolding with actuator simulation
     * Uses basic physics to smoothly transition between fold angles
     * @param {number} targetAngle - Target fold angle in radians
     * @param {number} duration - Animation duration in milliseconds
     */
    function animateActuatorFold(targetAngle, duration = 3000, onComplete) {
        if (state.actuatorAnimation.isPlaying) {
            return; // Already animating
        }
    
        state.actuatorAnimation.isPlaying = true;
        state.actuatorAnimation.currentAngle = state.foldAngle;
        state.actuatorAnimation.targetAngle = targetAngle;
        state.actuatorAnimation.direction = targetAngle > state.foldAngle ? 1 : -1;
    
        if (hasFoldingSolarPanels()) {
            if (targetAngle > state.foldAngle + degToRad(0.5)) {
                state.animation.foldingPanelPhase = 'structure_deploy';
                state.animation.foldingPanelDeploy = 0;
                state.animation.foldingPanelsUnfoldPhase = true;
            } else if (targetAngle < state.foldAngle - degToRad(0.5)) {
                state.animation.foldingPanelPhase = 'idle';
                state.animation.foldingPanelsUnfoldPhase = false;
                state.animation.foldingPanelDeploy = 0;
            }
        }
    
        const startAngle = state.foldAngle;
        const startTime = Date.now();
        const speed = state.actuatorAnimation.speed || 1.0;
        const adjustedDuration = duration / speed;
    
        function animate() {
            if (!state.actuatorAnimation.isPlaying) {
                return;
            }
    
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / adjustedDuration, 1);
    
            const eased = progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    
            const currentAngle = startAngle + (targetAngle - startAngle) * eased;
            state.foldAngle = currentAngle;
            syncUI('foldAngle');
    
            invalidateGeometryCache();
            requestRender();
    
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                state.foldAngle = targetAngle;
                syncUI('foldAngle');
                state.actuatorAnimation.isPlaying = false;
                if (hasFoldingSolarPanels() && Math.abs(targetAngle - getStructureFoldedAngle()) < degToRad(1)) {
                    state.animation.foldingPanelPhase = 'stowed';
                    state.animation.foldingPanelDeploy = 0;
                    state.animation.foldingPanelsUnfoldPhase = true;
                }
                invalidateGeometryCache();
                requestRender();
                const stopBtn = document.getElementById('btn-actuator-stop');
                if (stopBtn) stopBtn.style.display = 'none';
                if (onComplete) onComplete();
            }
        }
    
        animate();
    }
    
    /**
     * Stops the actuator animation
     */
    function stopActuatorAnimation() {
        state.actuatorAnimation.isPlaying = false;
        const stopBtn = document.getElementById('btn-actuator-stop');
        if (stopBtn) stopBtn.style.display = 'none';
    }

const animationExports = {
    updateAnimationStatus,
    getOptimalClosedAngleForAnimation,
    animateFold,
    animateActuatorFold,
    stopActuatorAnimation
};

bridgeGlobals(animationExports, 'animation');

export {
    updateAnimationStatus,
    getOptimalClosedAngleForAnimation,
    animateFold,
    animateActuatorFold,
    stopActuatorAnimation
};

