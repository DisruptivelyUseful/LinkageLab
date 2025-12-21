/**
 * Animation3D Module
 * Provides animation utilities for 3D transitions (grouping/ungrouping, etc.)
 */

// Ensure THREE is available
if (typeof THREE === 'undefined') {
    console.warn('THREE.js not available for Animation3D');
}

/**
 * Simple easing functions
 */
const Easing = {
    easeInOut: (t) => {
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    },
    easeOut: (t) => {
        return t * (2 - t);
    },
    easeIn: (t) => {
        return t * t;
    }
};

/**
 * Animate a value from start to end over duration
 */
export function animateValue(start, end, duration, easing = Easing.easeInOut, onUpdate, onComplete) {
    const startTime = performance.now();
    let animationFrameId = null;
    let cancelled = false;
    
    // Create animation object first
    const animObj = {
        cancel: () => {
            cancelled = true;
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
        },
        onComplete: onComplete || null
    };
    
    const animate = (currentTime) => {
        if (cancelled) return;
        
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = easing(progress);
        const current = start + (end - start) * eased;
        
        onUpdate(current, progress);
        
        if (progress < 1) {
            animationFrameId = requestAnimationFrame(animate);
        } else {
            // Call onComplete callback
            if (animObj.onComplete) {
                animObj.onComplete();
            }
        }
    };
    
    animationFrameId = requestAnimationFrame(animate);
    
    return animObj;
}

/**
 * Animate mesh scale from current to target
 */
export function animateScale(mesh, targetScale, duration = 500, onComplete) {
    if (!mesh || typeof THREE === 'undefined') return { cancel: () => {} };
    
    const startScale = mesh.scale.clone();
    const target = typeof targetScale === 'number' 
        ? new THREE.Vector3(targetScale, targetScale, targetScale)
        : targetScale.clone();
    
    const anim = animateValue(
        0,
        1,
        duration,
        Easing.easeInOut,
        (t, progress) => {
            mesh.scale.lerpVectors(startScale, target, progress);
        },
        onComplete
    );
    
    return anim;
}

/**
 * Animate mesh position from current to target
 */
export function animatePosition(mesh, targetPosition, duration = 500, onComplete) {
    if (!mesh) return { cancel: () => {} };
    
    const startPosition = mesh.position.clone();
    const target = targetPosition.clone();
    
    return animateValue(
        0,
        1,
        duration,
        Easing.easeInOut,
        (t, progress) => {
            mesh.position.lerpVectors(startPosition, target, progress);
        },
        onComplete
    );
}

/**
 * Animate mesh opacity (for materials)
 * Handles both single materials and groups with multiple materials
 */
export function animateOpacity(mesh, targetOpacity, duration = 500, onComplete) {
    if (!mesh || typeof THREE === 'undefined') return { cancel: () => {} };
    
    // Collect all materials from mesh and children
    const materials = [];
    const startOpacities = [];
    
    const collectMaterials = (obj) => {
        if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach(m => {
                if (m) {
                    materials.push(m);
                    startOpacities.push(m.opacity !== undefined ? m.opacity : 1);
                    if (!m.transparent) {
                        m.transparent = true;
                    }
                }
            });
        }
        if (obj.children) {
            obj.children.forEach(child => collectMaterials(child));
        }
    };
    
    collectMaterials(mesh);
    
    if (materials.length === 0) {
        if (onComplete) onComplete();
        return { cancel: () => {} };
    }
    
    return animateValue(
        0,
        1,
        duration,
        Easing.easeInOut,
        (t, progress) => {
            materials.forEach((m, i) => {
                m.opacity = startOpacities[i] + (targetOpacity - startOpacities[i]) * progress;
            });
        },
        onComplete
    );
}

/**
 * Animate grouping: nodes fade out and scale down, PowerStation fades in and scales up
 */
export function animateGrouping(nodes3D, powerStation3D, duration = 800, onComplete) {
    if (typeof THREE === 'undefined') {
        if (onComplete) onComplete();
        return { cancel: () => {} };
    }
    
    const animations = [];
    
    // Animate individual nodes: fade out and scale down
    nodes3D.forEach(node3D => {
        if (node3D && node3D.mesh) {
            // Fade out
            animations.push(animateOpacity(node3D.mesh, 0, duration));
            // Scale down
            animations.push(animateScale(node3D.mesh, 0.1, duration));
        }
    });
    
    // Animate PowerStation: fade in and scale up
    if (powerStation3D && powerStation3D.getMesh) {
        const mesh = powerStation3D.getMesh();
        if (mesh) {
            // Ensure materials are transparent
            mesh.traverse(child => {
                if (child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach(m => {
                        if (m) {
                            m.transparent = true;
                            m.opacity = 0;
                        }
                    });
                }
            });
            mesh.visible = true;
            
            // Fade in and scale up
            animations.push(animateOpacity(mesh, 1, duration));
            animations.push(animateScale(mesh, 1, duration));
        }
    }
    
    if (animations.length === 0) {
        if (onComplete) onComplete();
        return { cancel: () => {} };
    }
    
    // Wait for all animations to complete
    let completed = 0;
    const total = animations.length;
    
    if (total === 0) {
        if (onComplete) onComplete();
        return { cancel: () => {} };
    }
    
    const checkComplete = () => {
        completed++;
        if (completed === total && onComplete) {
            onComplete();
        }
    };
    
    // Track completion for each animation
    animations.forEach(anim => {
        if (anim && typeof anim === 'object') {
            // Store original onComplete if it exists
            const originalOnComplete = anim.onComplete;
            anim.onComplete = () => {
                if (originalOnComplete) originalOnComplete();
                checkComplete();
            };
        }
    });
    
    return {
        cancel: () => {
            animations.forEach(anim => {
                if (anim && anim.cancel) anim.cancel();
            });
        }
    };
}

/**
 * Animate ungrouping: PowerStation fades out and scales down, nodes fade in and scale up
 */
export function animateUngrouping(powerStation3D, nodes3D, duration = 800, onComplete) {
    if (typeof THREE === 'undefined') {
        if (onComplete) onComplete();
        return { cancel: () => {} };
    }
    
    const animations = [];
    
    // Animate PowerStation: fade out and scale down
    if (powerStation3D && powerStation3D.getMesh) {
        const mesh = powerStation3D.getMesh();
        if (mesh) {
            animations.push(animateOpacity(mesh, 0, duration));
            animations.push(animateScale(mesh, 0.1, duration));
        }
    }
    
    // Animate individual nodes: fade in and scale up
    nodes3D.forEach(node3D => {
        if (node3D && node3D.mesh) {
            // Start invisible and small
            if (node3D.mesh.material) {
                const materials = Array.isArray(node3D.mesh.material) 
                    ? node3D.mesh.material 
                    : [node3D.mesh.material];
                materials.forEach(m => {
                    if (m) {
                        m.transparent = true;
                        m.opacity = 0;
                    }
                });
            }
            node3D.mesh.scale.set(0.1, 0.1, 0.1);
            node3D.mesh.visible = true;
            
            // Fade in and scale up
            animations.push(animateOpacity(node3D.mesh, 1, duration));
            animations.push(animateScale(node3D.mesh, 1, duration));
        }
    });
    
    if (animations.length === 0) {
        if (onComplete) onComplete();
        return { cancel: () => {} };
    }
    
    // Wait for all animations to complete
    let completed = 0;
    const total = animations.length;
    
    if (total === 0) {
        if (onComplete) onComplete();
        return { cancel: () => {} };
    }
    
    const checkComplete = () => {
        completed++;
        if (completed === total && onComplete) {
            onComplete();
        }
    };
    
    // Track completion for each animation
    animations.forEach(anim => {
        if (anim && typeof anim === 'object') {
            // Store original onComplete if it exists
            const originalOnComplete = anim.onComplete;
            anim.onComplete = () => {
                if (originalOnComplete) originalOnComplete();
                checkComplete();
            };
        }
    });
    
    return {
        cancel: () => {
            animations.forEach(anim => {
                if (anim && anim.cancel) anim.cancel();
            });
        }
    };
}

