// ============================================================================
// LINKAGE LAB - Measurement tools, IBC reference stack, human scale figure
// Depends on global: state, THREE, threeRenderer, ibcGlbState, ibcStackLayoutCacheKey, unitConverter, formatNumber, INCHES_PER_FOOT, cloneIbcTemplateForExport, isMainStructureBeam, render, renderPending, showToast
// ============================================================================
(function (g) {
    'use strict';

    // MEASUREMENT TOOLS
    // ============================================================================
    
    /**
     * Calculates critical measurements from the structure geometry
     * @param {Object} data - Linkage data with beams array
     * @returns {Object} Measurements object with inner/outer diameter, height, span
     */
    /**
     * Format a measurement in inches for the sidebar display.
     * Shows ft+in or m+cm depending on the active unit system.
     */
    function formatMeasurementSidebar(inches) {
        if (unitConverter.getPreferredUnitSystem() === 'metric') {
            const cm = inches * 2.54;
            if (cm >= 100) {
                return `${formatNumber(cm / 100, 2)} m (${formatNumber(cm, 0)} cm)`;
            }
            return `${formatNumber(cm, 1)} cm`;
        }
        const trimDec = (s) => (typeof s === 'string' && s.indexOf('.') >= 0)
            ? s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
            : s;
        const ftPart = trimDec(formatNumber(inches / INCHES_PER_FOOT, 2));
        const inPart = trimDec(formatNumber(inches, 2));
        return `${ftPart}' (${inPart}")`;
    }
    
    function calculateMeasurements(data) {
        if (!data || !data.beams || data.beams.length === 0) {
            return { innerDia: 0, outerDia: 0, height: 0, span: 0, innerPoints: null, outerPoints: null };
        }
        
        const isArchMode = state.orientation === 'vertical';
        
        // Calculate bounding box from all beam corners
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        
        data.beams.forEach(beam => {
            if (beam.corners) {
                beam.corners.forEach(c => {
                    if (c) {
                        if (c.x < minX) minX = c.x;
                        if (c.x > maxX) maxX = c.x;
                        if (c.y < minY) minY = c.y;
                        if (c.y > maxY) maxY = c.y;
                        if ((c.z || 0) < minZ) minZ = c.z || 0;
                        if ((c.z || 0) > maxZ) maxZ = c.z || 0;
                    }
                });
            }
        });
        
        // Default values if no geometry found
        if (!isFinite(minX)) {
            return { innerDia: 0, outerDia: 0, height: 0, span: 0, innerPoints: null, outerPoints: null };
        }
        
        const height = maxY - minY;
        const span = maxX - minX;
        const depth = maxZ - minZ;
        
        // Calculate center points
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const centerZ = (minZ + maxZ) / 2;
        
        let innerDia = 0, outerDia = 0;
        let innerPoints = null, outerPoints = null;
        let heightPoints, spanPoints;
        
        if (isArchMode) {
            // ARCH MODE: Measure span at ground level and apex height
            // Span is horizontal distance between feet
            innerDia = 0; // No inner diameter in arch mode
            outerDia = span; // Outer is the full span
            
            // Span line at the base of the arch
            spanPoints = [
                { x: minX, y: minY, z: centerZ },
                { x: maxX, y: minY, z: centerZ }
            ];
            outerPoints = spanPoints;
            
            // Height line from ground to apex
            heightPoints = [
                { x: centerX, y: minY, z: centerZ },
                { x: centerX, y: maxY, z: centerZ }
            ];
            
            // Depth line (along Z axis)
            const depthPoints = [
                { x: centerX, y: centerY, z: minZ },
                { x: centerX, y: centerY, z: maxZ }
            ];
            
            return {
                innerDia: depth, // Show depth as "inner" measurement
                outerDia: span,
                height,
                span,
                innerPoints: depthPoints, // Depth line
                outerPoints: spanPoints, // Span at ground level
                heightPoints,
                spanPoints
            };
        } else {
            // CYLINDER MODE: Measure diameter across widest points and outer diameter
            const hBeams = data.beams.filter(b => b.stackType && b.stackType.startsWith('horizontal'));
            
            // Group beams by ring type (top or bottom)
            const topBeams = hBeams.filter(b => b.stackType === 'horizontal-top');
            const botBeams = hBeams.filter(b => b.stackType === 'horizontal-bottom');
            
            // Use bottom ring for diameter measurements (more consistent)
            const measureBeams = botBeams.length > 0 ? botBeams : hBeams;
            
            // Collect all corner points at ground level for diameter calculation
            const groundPoints = [];
            data.beams.forEach(beam => {
                if (beam.corners) {
                    beam.corners.forEach(c => {
                        if (c && Math.abs(c.y - minY) < 1) { // Points near ground level
                            groundPoints.push({x: c.x, y: minY, z: c.z || 0});
                        }
                    });
                }
            });
            
            // Find the two points that are furthest apart on the ground plane (XZ)
            // This gives us the true diameter across the widest points
            let maxGroundDist = 0;
            let diameterPoint1 = null, diameterPoint2 = null;
            
            for (let i = 0; i < groundPoints.length; i++) {
                for (let j = i + 1; j < groundPoints.length; j++) {
                    const p1 = groundPoints[i];
                    const p2 = groundPoints[j];
                    const dist = Math.sqrt(
                        Math.pow(p2.x - p1.x, 2) + 
                        Math.pow(p2.z - p1.z, 2)
                    );
                    if (dist > maxGroundDist) {
                        maxGroundDist = dist;
                        diameterPoint1 = p1;
                        diameterPoint2 = p2;
                    }
                }
            }
            
            // Set diameter measurement (replaces inner)
            if (diameterPoint1 && diameterPoint2) {
                innerDia = maxGroundDist;
                innerPoints = [
                    { x: diameterPoint1.x, y: minY, z: diameterPoint1.z },
                    { x: diameterPoint2.x, y: minY, z: diameterPoint2.z }
                ];
            }
            
            // Collect pivot points for outer diameter
            const pivotPoints = [];
            measureBeams.forEach(beam => {
                if (beam.p1) pivotPoints.push({...beam.p1, moduleIndex: beam.moduleIndex});
                if (beam.p2) pivotPoints.push({...beam.p2, moduleIndex: beam.moduleIndex});
            });
            
            // Find outer radius
            let maxRad = -Infinity;
            let outerPoint1 = null;
            
            pivotPoints.forEach(p => {
                const rad = Math.sqrt(p.x * p.x + (p.z || 0) * (p.z || 0));
                if (rad > maxRad) {
                    maxRad = rad;
                    outerPoint1 = p;
                }
            });
            
            // Find opposite point for outer diameter (180° away)
            if (outerPoint1) {
                const angle1 = Math.atan2(outerPoint1.z || 0, outerPoint1.x);
                let bestAngleDiff = 0;
                let bestPoint = null;
                
                pivotPoints.forEach(p => {
                    if (p === outerPoint1) return;
                    const rad = Math.sqrt(p.x * p.x + (p.z || 0) * (p.z || 0));
                    // Only consider outer points (within 20% of max radius)
                    if (rad < maxRad * 0.8) return;
                    
                    const angle2 = Math.atan2(p.z || 0, p.x);
                    let angleDiff = Math.abs(angle2 - angle1);
                    if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
                    
                    if (angleDiff > bestAngleDiff) {
                        bestAngleDiff = angleDiff;
                        bestPoint = p;
                    }
                });
                
                if (bestPoint) {
                    outerPoints = [
                        { x: outerPoint1.x, y: outerPoint1.y, z: outerPoint1.z || 0 },
                        { x: bestPoint.x, y: bestPoint.y, z: bestPoint.z || 0 }
                    ];
                    outerDia = Math.sqrt(
                        Math.pow(bestPoint.x - outerPoint1.x, 2) +
                        Math.pow((bestPoint.z || 0) - (outerPoint1.z || 0), 2)
                    );
                }
            }
            
            // Height line along the side of the structure
            heightPoints = [
                { x: maxX + 10, y: minY, z: centerZ },
                { x: maxX + 10, y: maxY, z: centerZ }
            ];
            
            // Span line at the bottom
            spanPoints = [
                { x: minX, y: minY - 10, z: centerZ },
                { x: maxX, y: minY - 10, z: centerZ }
            ];
        }
        
        return {
            innerDia,
            outerDia,
            height,
            span,
            innerPoints,
            outerPoints,
            heightPoints,
            spanPoints
        };
    }
    
    /**
     * Draws live measurement annotations on the canvas
     */
    function drawMeasurements(ctx, data) {
        const measurements = calculateMeasurements(data);
        
        // Update sidebar display
        const innerEl = document.getElementById('meas-inner-dia');
        const outerEl = document.getElementById('meas-outer-dia');
        const heightEl = document.getElementById('meas-height');
        const spanEl = document.getElementById('meas-span');
        
        if (innerEl) innerEl.textContent = formatMeasurementSidebar(measurements.innerDia);
        if (outerEl) outerEl.textContent = formatMeasurementSidebar(measurements.outerDia);
        if (heightEl) heightEl.textContent = formatMeasurementSidebar(measurements.height);
        if (spanEl) spanEl.textContent = formatMeasurementSidebar(measurements.span);
        
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
        
        /**
         * Draws a measurement line with label
         */
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
        // Draw diameter measurement on ground plane (cyan)
        if (measurements.innerPoints) {
            const dist = measurements.innerDia;
            const system = unitConverter.getPreferredUnitSystem();
            const label = system === 'metric'
                ? `Diameter: ${unitConverter.formatLength(dist, 'in', 1)}`
                : `Diameter: ${formatNumber(dist / INCHES_PER_FOOT, 1)}'`;
            drawMeasurementLine(measurements.innerPoints[0], measurements.innerPoints[1], label, '#00d2d3', -20);
        }
        
        // Draw outer diameter measurement (orange)
        if (measurements.outerPoints) {
            const dist = measurements.outerDia;
            const system = unitConverter.getPreferredUnitSystem();
            const label = system === 'metric'
                ? `Outer: ${unitConverter.formatLength(dist, 'in', 1)}`
                : `Outer: ${formatNumber(dist / INCHES_PER_FOOT, 1)}'`;
            drawMeasurementLine(measurements.outerPoints[0], measurements.outerPoints[1], label, '#f0ad4e', 20);
        }
        
        // Draw height measurement (green) - vertical line on the side
        if (measurements.height > 0) {
            const heightPoint1 = {x: measurements.spanPoints[1].x + 10, y: measurements.heightPoints[0].y, z: 0};
            const heightPoint2 = {x: measurements.spanPoints[1].x + 10, y: measurements.heightPoints[1].y, z: 0};
            const system = unitConverter.getPreferredUnitSystem();
            const label = system === 'metric'
                ? `Height: ${unitConverter.formatLength(measurements.height, 'in', 1)}`
                : `Height: ${formatNumber(measurements.height / INCHES_PER_FOOT, 1)}'`;
            drawMeasurementLine(heightPoint1, heightPoint2, label, '#2ecc71', 0);
        }
        
        // Draw span measurement (purple) - horizontal line at bottom
        if (measurements.span > 0) {
            const spanPoint1 = {x: measurements.spanPoints[0].x, y: measurements.spanPoints[0].y - 10, z: 0};
            const spanPoint2 = {x: measurements.spanPoints[1].x, y: measurements.spanPoints[0].y - 10, z: 0};
            const system = unitConverter.getPreferredUnitSystem();
            const label = system === 'metric'
                ? `Span: ${unitConverter.formatLength(measurements.span, 'in', 1)}`
                : `Span: ${formatNumber(measurements.span / INCHES_PER_FOOT, 1)}'`;
            drawMeasurementLine(spanPoint1, spanPoint2, label, '#9b59b6', 0);
        }
        
        ctx.setLineDash([]);
    }
    
    /**
     * Draws measurements as a 2D overlay on top of the WebGL canvas
     * Uses a hidden 2D canvas overlay positioned over the WebGL canvas
     */
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
        
        // Use the existing drawMeasurements function but with the overlay context
        // We need to temporarily swap the ctx reference
        const originalCtx = ctx;
        const originalCanvas = canvas;
        
        // Create a temporary canvas reference that matches the overlay
        const tempCanvas = {
            width: w,
            height: h,
            clientWidth: w,
            clientHeight: h
        };
        
        // Draw measurements using the projection logic
        const measurements = calculateMeasurements(data);
        
        // Update sidebar display (labels change based on mode)
        const innerEl = document.getElementById('meas-inner-dia');
        const outerEl = document.getElementById('meas-outer-dia');
        const heightEl = document.getElementById('meas-height');
        const spanEl = document.getElementById('meas-span');
        
        const isArchModeDisplay = state.orientation === 'vertical';
        
        // Update sidebar labels based on mode
        const innerLabelEl = innerEl ? innerEl.previousElementSibling : null;
        const outerLabelEl = outerEl ? outerEl.previousElementSibling : null;
        
        if (isArchModeDisplay) {
            // Arch mode: show Depth, Span, Height
            if (innerLabelEl) innerLabelEl.textContent = 'Depth:';
            if (outerLabelEl) outerLabelEl.textContent = 'Span:';
            if (innerEl) innerEl.textContent = formatMeasurementSidebar(measurements.innerDia);
            if (outerEl) outerEl.textContent = formatMeasurementSidebar(measurements.outerDia);
        } else {
            // Cylinder mode: show Diameter, Outer Ø, Height
            if (innerLabelEl) innerLabelEl.textContent = 'Diameter:';
            if (outerLabelEl) outerLabelEl.textContent = 'Outer Ø:';
            if (innerEl) innerEl.textContent = formatMeasurementSidebar(measurements.innerDia);
            if (outerEl) outerEl.textContent = formatMeasurementSidebar(measurements.outerDia);
        }
        
        if (heightEl) heightEl.textContent = formatMeasurementSidebar(measurements.height);
        if (spanEl) spanEl.textContent = formatMeasurementSidebar(measurements.span);
        
        const sc = structureCenter || { x: 0, y: 0, z: 0 };
        
        // Project function that matches Three.js camera
        const project = (v) => {
            const cam = state.cam;
            
            // Offset by structure center
            let x = (v.x || 0) - sc.x;
            let y = (v.y || 0) - sc.y;
            let z = (v.z || 0) - sc.z;
            
            // Rotate around Y axis (yaw)
            let x1 = x * Math.cos(-cam.yaw) - z * Math.sin(-cam.yaw);
            let z1 = x * Math.sin(-cam.yaw) + z * Math.cos(-cam.yaw);
            x1 -= cam.panX * 0.5;
            
            // Rotate around X axis (pitch)
            let y2 = y * Math.cos(cam.pitch) - z1 * Math.sin(cam.pitch);
            let z2 = y * Math.sin(cam.pitch) + z1 * Math.cos(cam.pitch);
            y2 += cam.panY * 0.5;
            
            // Perspective projection - match Three.js FOV
            let depth = z2 + cam.dist;
            if (depth < 1) depth = 1;
            const fov = 45 * Math.PI / 180;
            const scale = (h / 2) / Math.tan(fov / 2) / depth;
            
            return { 
                x: w / 2 + x1 * scale, 
                y: h / 2 - y2 * scale, 
                depth 
            };
        };
        
        // Draw measurement line helper
        const drawMeasurementLine = (point1, point2, label, color, offset = 0) => {
            if (!point1 || !point2) return;
            
            const p1 = project(point1);
            const p2 = project(point2);
            
            overlayCtx.strokeStyle = color;
            overlayCtx.lineWidth = 2;
            overlayCtx.setLineDash([]);
            overlayCtx.beginPath();
            overlayCtx.moveTo(p1.x, p1.y);
            overlayCtx.lineTo(p2.x, p2.y);
            overlayCtx.stroke();
            
            const markerSize = 6;
            overlayCtx.fillStyle = color;
            overlayCtx.beginPath();
            overlayCtx.arc(p1.x, p1.y, markerSize, 0, Math.PI * 2);
            overlayCtx.fill();
            overlayCtx.beginPath();
            overlayCtx.arc(p2.x, p2.y, markerSize, 0, Math.PI * 2);
            overlayCtx.fill();
            
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2 + offset;
            
            overlayCtx.font = 'bold 12px Arial';
            const textWidth = overlayCtx.measureText(label).width;
            overlayCtx.fillStyle = 'rgba(21, 32, 43, 0.9)';
            overlayCtx.fillRect(midX - textWidth / 2 - 6, midY - 14, textWidth + 12, 20);
            
            overlayCtx.strokeStyle = color;
            overlayCtx.lineWidth = 1;
            overlayCtx.strokeRect(midX - textWidth / 2 - 6, midY - 14, textWidth + 12, 20);
            
            overlayCtx.fillStyle = color;
            overlayCtx.textAlign = 'center';
            overlayCtx.textBaseline = 'middle';
            overlayCtx.fillText(label, midX, midY - 4);
            overlayCtx.textAlign = 'left';
            overlayCtx.textBaseline = 'alphabetic';
        };
        
        const isArchMode = state.orientation === 'vertical';
        const system = unitConverter.getPreferredUnitSystem();
        
        // Draw measurements based on mode
        if (isArchMode) {
            // ARCH MODE: Show span at ground, height, and depth
            
            // Span line (horizontal at ground level)
            if (measurements.outerPoints && measurements.outerDia > 0) {
                const label = system === 'metric'
                    ? `Span: ${unitConverter.formatLength(measurements.outerDia, 'in', 1)}`
                    : `Span: ${formatNumber(measurements.outerDia / INCHES_PER_FOOT, 1)}'`;
                drawMeasurementLine(measurements.outerPoints[0], measurements.outerPoints[1], label, '#f0ad4e', 20);
            }
            
            // Height line (vertical from ground to apex)
            if (measurements.heightPoints && measurements.height > 0) {
                const label = system === 'metric'
                    ? `Height: ${unitConverter.formatLength(measurements.height, 'in', 1)}`
                    : `Height: ${formatNumber(measurements.height / INCHES_PER_FOOT, 1)}'`;
                drawMeasurementLine(measurements.heightPoints[0], measurements.heightPoints[1], label, '#2ecc71', 0);
            }
            
            // Depth line (along Z axis - shows tunnel depth)
            if (measurements.innerPoints && measurements.innerDia > 0) {
                const label = system === 'metric'
                    ? `Depth: ${unitConverter.formatLength(measurements.innerDia, 'in', 1)}`
                    : `Depth: ${formatNumber(measurements.innerDia / INCHES_PER_FOOT, 1)}'`;
                drawMeasurementLine(measurements.innerPoints[0], measurements.innerPoints[1], label, '#00d2d3', -20);
            }
        } else {
            // CYLINDER MODE: Show inner/outer diameter and height
            
            // Diameter (ground plane - widest distance)
            if (measurements.innerPoints && measurements.innerDia > 0) {
                const label = system === 'metric'
                    ? `Diameter: ${unitConverter.formatLength(measurements.innerDia, 'in', 1)}`
                    : `Diameter: ${formatNumber(measurements.innerDia / INCHES_PER_FOOT, 1)}'`;
                drawMeasurementLine(measurements.innerPoints[0], measurements.innerPoints[1], label, '#00d2d3', -20);
            }
            
            // Outer diameter
            if (measurements.outerPoints && measurements.outerDia > 0) {
                const label = system === 'metric'
                    ? `Outer Ø: ${unitConverter.formatLength(measurements.outerDia, 'in', 1)}`
                    : `Outer Ø: ${formatNumber(measurements.outerDia / INCHES_PER_FOOT, 1)}'`;
                drawMeasurementLine(measurements.outerPoints[0], measurements.outerPoints[1], label, '#f0ad4e', 20);
            }
            
            // Height line
            if (measurements.heightPoints && measurements.height > 0) {
                const label = system === 'metric'
                    ? `Height: ${unitConverter.formatLength(measurements.height, 'in', 1)}`
                    : `Height: ${formatNumber(measurements.height / INCHES_PER_FOOT, 1)}'`;
                drawMeasurementLine(measurements.heightPoints[0], measurements.heightPoints[1], label, '#2ecc71', 0);
            }
        }
    }
    
    // --- IBC “lit from inside” green glow (emissive + soft local fill light) ---
    const IBC_INTERIOR_GLOW_COLOR = 0x2dff8a;
    const IBC_INTERIOR_GLOW_INTENSITY = 0.52;
    const IBC_FILL_LIGHT_COLOR = 0x55ffaa;
    const IBC_FILL_LIGHT_INTENSITY = 0.32;
    
    /** Clone / upgrade materials so black albedo tanks read as self-lit green (does not mutate GLTF originals on disk). */
    function applyIbcInteriorGlow(root) {
        if (!root || typeof THREE === 'undefined') return;
        const glow = new THREE.Color(IBC_INTERIOR_GLOW_COLOR);
        root.traverse((ch) => {
            if (!ch.isMesh || !ch.material) return;
            const upgrade = (mat) => {
                if (mat.isMeshBasicMaterial) {
                    const m = new THREE.MeshStandardMaterial({
                        map: mat.map,
                        metalness: 0.15,
                        roughness: 0.9,
                        emissive: glow.clone(),
                        transparent: mat.transparent,
                        opacity: mat.opacity,
                        side: mat.side != null ? mat.side : THREE.FrontSide
                    });
                    if ('emissiveIntensity' in m) m.emissiveIntensity = IBC_INTERIOR_GLOW_INTENSITY;
                    m.userData = Object.assign({}, mat.userData, { ibcOwnedMaterial: true });
                    return m;
                }
                const m = mat.clone();
                m.userData = Object.assign({}, mat.userData, { ibcOwnedMaterial: true });
                if ('emissive' in m) {
                    m.emissive.copy(glow);
                    if ('emissiveIntensity' in m) m.emissiveIntensity = IBC_INTERIOR_GLOW_INTENSITY;
                }
                return m;
            };
            ch.material = Array.isArray(ch.material) ? ch.material.map(upgrade) : upgrade(ch.material);
        });
    }
    
    const IBC_TEXTURE_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap',
        'displacementMap', 'lightMap', 'specularMap', 'alphaMap', 'envMap', 'clearcoatNormalMap'];
    
    function detachIbcMaterialMapsForDispose(mat) {
        if (!mat) return;
        IBC_TEXTURE_KEYS.forEach((k) => { if (mat[k]) mat[k] = null; });
    }
    
    function disposeIbcGlowMaterialsOnSubtree(root) {
        if (!root) return;
        root.traverse((node) => {
            if (!node.isMesh || !node.material) return;
            const mats = Array.isArray(node.material) ? node.material : [node.material];
            mats.forEach((m) => {
                if (m && m.userData && m.userData.ibcOwnedMaterial) {
                    detachIbcMaterialMapsForDispose(m);
                    m.dispose();
                }
            });
        });
    }
    
    function clearIbcPivotChildren() {
        const pivot = threeRenderer && threeRenderer.ibcPivot;
        if (!pivot) return;
        while (pivot.children.length) {
            const ch = pivot.children[0];
            disposeIbcGlowMaterialsOnSubtree(ch);
            pivot.remove(ch);
        }
        ibcGlbState.fillLight = null;
    }
    
    function addIbcGreenFillLightOnPivot(pivot) {
        if (!pivot || typeof THREE === 'undefined') return;
        pivot.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(pivot);
        if (box.isEmpty()) return;
        const h = Math.max(1, box.max.y - box.min.y);
        const wc = new THREE.Vector3();
        box.getCenter(wc);
        const local = wc.clone();
        pivot.worldToLocal(local);
        if (ibcGlbState.fillLight && ibcGlbState.fillLight.parent) {
            ibcGlbState.fillLight.parent.remove(ibcGlbState.fillLight);
        }
        const light = new THREE.PointLight(IBC_FILL_LIGHT_COLOR, IBC_FILL_LIGHT_INTENSITY, h * 4, 2);
        light.position.copy(local);
        light.userData.ibcFillLight = true;
        pivot.add(light);
        ibcGlbState.fillLight = light;
    }
    
    /** Bottom tank: scale, center XZ, ground at y=0 in pivot space; returns max Y for stacking */
    function layoutBottomIbcTank(root, scale) {
        root.scale.setScalar(scale);
        root.rotation.set(0, 0, 0);
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const midX = (box.min.x + box.max.x) / 2;
        const midZ = (box.min.z + box.max.z) / 2;
        root.position.set(-midX, -box.min.y, -midZ);
        root.updateMatrixWorld(true);
        const box2 = new THREE.Box3().setFromObject(root);
        return box2.max.y;
    }
    
    /** Top tank: mirrored (flip X), stacked with gap under bottom’s max Y */
    function layoutTopFlippedIbcTank(root, scale, bottomTopY, gapIn) {
        root.scale.setScalar(scale);
        root.rotation.set(Math.PI, 0, 0);
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const midX = (box.min.x + box.max.x) / 2;
        const midZ = (box.min.z + box.max.z) / 2;
        root.position.set(-midX, bottomTopY + gapIn - box.min.y, -midZ);
        root.updateMatrixWorld(true);
    }
    
    function applyIbcShadowFlagsToSubtree(root) {
        if (!root) return;
        root.traverse((obj) => {
            if (obj.isMesh) {
                obj.castShadow = !!state.shadowsEnabled;
                obj.receiveShadow = !!state.shadowsEnabled;
            }
        });
    }
    
    function rebuildIbcPivotStack() {
        const pivot = threeRenderer && threeRenderer.ibcPivot;
        if (!pivot) return;
        if (!ibcGlbState.gltf || !ibcGlbState.gltf.scene) {
            clearIbcPivotChildren();
            return;
        }
        const ibc = state.ibc;
        const layoutKey = [ibc.count | 0, ibc.stackGapIn ?? 0, ibc.verticalOffsetAIn ?? 0, ibc.verticalOffsetBIn ?? 0, ibc.scale ?? INCHES_PER_METER].join('|');
        if (layoutKey === ibcStackLayoutCacheKey && pivot.children.length > 0) return;
        ibcStackLayoutCacheKey = layoutKey;
        clearIbcPivotChildren();
    
        const scale = ibc.scale > 0 ? ibc.scale : INCHES_PER_METER;
        const count = Math.min(2, Math.max(1, ibc.count | 0));
        const gap = Math.max(0, ibc.stackGapIn || 0);
        const offA = ibc.verticalOffsetAIn || 0;
        const offB = ibc.verticalOffsetBIn || 0;
        const template = ibcGlbState.gltf.scene;
    
        const bottom = cloneIbcTemplateForExport(template);
        const topY = layoutBottomIbcTank(bottom, scale);
        bottom.position.y += offA;
        applyIbcInteriorGlow(bottom);
        applyIbcShadowFlagsToSubtree(bottom);
        pivot.add(bottom);
    
        if (count >= 2) {
            const top = cloneIbcTemplateForExport(template);
            layoutTopFlippedIbcTank(top, scale, topY + offA, gap);
            top.position.y += offB;
            applyIbcInteriorGlow(top);
            applyIbcShadowFlagsToSubtree(top);
            pivot.add(top);
        }
    
        addIbcGreenFillLightOnPivot(pivot);
    }
    
    function createIbcExportGroup(data, structureCenter) {
        if (typeof THREE === 'undefined') return null;
        const ibc = state.ibc;
        const visibleInEditor = threeRenderer
            && threeRenderer.ibcReferenceGroup
            && threeRenderer.ibcReferenceGroup.visible
            && threeRenderer.ibcPivot
            && threeRenderer.ibcPivot.children.length > 0;
        
        if (!ibc || !ibc.enabled || (ibc.count | 0) < 1 || !visibleInEditor) return null;
        if (!ibcGlbState.gltf || !ibcGlbState.gltf.scene) {
            console.warn('[GLTF Export] IBC is enabled but Just IBC.glb is not loaded; skipping IBC export.');
            return null;
        }
        
        const sc = structureCenter || { x: 0, y: 0, z: 0 };
        const pos = getStructurePlanFootprintForReference(data);
        const exportGroup = new THREE.Group();
        exportGroup.name = 'IBCReference';
        exportGroup.position.set(pos.centerX - sc.x, pos.minY - sc.y, pos.centerZ - sc.z);
        
        const pivot = new THREE.Group();
        pivot.name = 'IBCStack';
        pivot.rotation.y = (ibc.rotationYDeg || 0) * Math.PI / 180;
        exportGroup.add(pivot);
        
        const scale = ibc.scale > 0 ? ibc.scale : INCHES_PER_METER;
        const count = Math.min(2, Math.max(1, ibc.count | 0));
        const gap = Math.max(0, ibc.stackGapIn || 0);
        const offA = ibc.verticalOffsetAIn || 0;
        const offB = ibc.verticalOffsetBIn || 0;
        const template = ibcGlbState.gltf.scene;
        
        const bottom = template.clone(true);
        bottom.name = 'IBC_Bottom';
        const topY = layoutBottomIbcTank(bottom, scale);
        bottom.position.y += offA;
        applyIbcInteriorGlow(bottom);
        applyIbcShadowFlagsToSubtree(bottom);
        pivot.add(bottom);
        
        if (count >= 2) {
            const top = template.clone(true);
            top.name = 'IBC_Top';
            layoutTopFlippedIbcTank(top, scale, topY + offA, gap);
            top.position.y += offB;
            applyIbcInteriorGlow(top);
            applyIbcShadowFlagsToSubtree(top);
            pivot.add(top);
        }
        
        return exportGroup;
    }
    
    function syncIbcStackControlsVisibility() {
        const n = (state && state.ibc && (state.ibc.count | 0)) || 0;
        const showStack = n === 2;
        const gapRow = document.getElementById('ibc-stack-gap-row');
        const offBRow = document.getElementById('ibc-offset-b-row');
        if (gapRow) gapRow.style.display = showStack ? 'flex' : 'none';
        if (offBRow) offBRow.style.display = showStack ? 'flex' : 'none';
    }
    
    /**
     * Horizontal center and ground height for reference props (human, IBC), in scene inches.
     * @param {Object} data - Linkage geometry
     * @returns {{ centerX: number, centerZ: number, minY: number }}
     */
    function getStructurePlanFootprintForReference(data) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity;
        if (data && data.beams) {
            data.beams.forEach(beam => {
                if (!isMainStructureBeam(beam)) return;
                if (beam.corners) {
                    beam.corners.forEach(c => {
                        if (c) {
                            minX = Math.min(minX, c.x);
                            maxX = Math.max(maxX, c.x);
                            minZ = Math.min(minZ, c.z || 0);
                            maxZ = Math.max(maxZ, c.z || 0);
                            minY = Math.min(minY, c.y);
                        }
                    });
                }
            });
        }
        if (!isFinite(minX)) {
            minX = -50; maxX = 50; minZ = -50; maxZ = 50; minY = 0;
        }
        return {
            centerX: (minX + maxX) / 2,
            centerZ: (minZ + maxZ) / 2,
            minY
        };
    }
    
    function startIbcGlbLoad(onLoaded, onError) {
        if (ibcGlbState.gltf) {
            if (onLoaded) onLoaded();
            return true;
        }
        if (ibcGlbState.loading) return false;

        if (typeof THREE === 'undefined' || typeof THREE.GLTFLoader === 'undefined') {
            if (onError) onError(new Error('GLTFLoader unavailable'));
            return false;
        }

        ibcGlbState.loading = true;
        const glbUrl = new URL('Just IBC.glb', window.location.href).href;
        const loader = new THREE.GLTFLoader();
        loader.load(
            glbUrl,
            (gltf) => {
                ibcGlbState.loading = false;
                ibcGlbState.gltf = gltf;
                if (onLoaded) onLoaded(gltf);
            },
            undefined,
            (err) => {
                ibcGlbState.loading = false;
                if (onError) onError(err);
            }
        );
        return true;
    }

    /** Begin loading Just IBC.glb during app init so IBC tanks appear sooner on first paint. */
    function preloadIbcGlb() {
        startIbcGlbLoad(
            () => {
                if (state.ibc.enabled && (state.ibc.count | 0) >= 1 && threeRenderer.ibcReferenceGroup) {
                    rebuildIbcPivotStack();
                    requestRender();
                }
            },
            (err) => console.warn('[IBC GLB] preload failed:', err)
        );
    }

    /**
     * Loads Just IBC.glb once, then each frame rebuilds stacked clones in structure-local space
     * (column center on beam footprint XY, base on lowest beam Y relative to structure center).
     * @param {Object} data - Linkage geometry
     * @param {{x:number,y:number,z:number}} structureCenter - Structure center (beam bbox center)
     */
    function updateIbcGlbReference(data, structureCenter) {
        if (!threeRenderer.ibcReferenceGroup || !threeRenderer.ibcPivot) return;
        const sc = structureCenter || { x: 0, y: 0, z: 0 };
        const ibc = state.ibc;
    
        const show = ibc.enabled && (ibc.count | 0) >= 1;
        if (!show) {
            clearIbcPivotChildren();
            ibcStackLayoutCacheKey = '';
            threeRenderer.ibcReferenceGroup.visible = false;
            return;
        }
    
        threeRenderer.ibcReferenceGroup.visible = true;
        const pos = getStructurePlanFootprintForReference(data);
        // Target world position (0, pos.minY, 0) — the deployed ring center.
        // pos.centerX/Z equal sc.x/z (same bbox calculation on same beams), so using them would
        // always cancel to zero and place the IBC at the drifting bbox center.
        // Instead subtract sc directly so the IBC stays fixed while the ring folds away from it.
        threeRenderer.ibcReferenceGroup.position.set(
            -sc.x,
            pos.minY - sc.y,
            -sc.z
        );
        threeRenderer.ibcPivot.rotation.y = (ibc.rotationYDeg || 0) * Math.PI / 180;
    
        const finishStack = () => {
            if (!state.ibc.enabled || (state.ibc.count | 0) < 1) return;
            rebuildIbcPivotStack();
        };
    
        if (ibcGlbState.gltf) {
            finishStack();
            return;
        }
        if (ibcGlbState.loading) return;

        if (!startIbcGlbLoad(
            () => {
                if (!threeRenderer.ibcReferenceGroup) return;
                if (!state.ibc.enabled || (state.ibc.count | 0) < 1) {
                    threeRenderer.ibcReferenceGroup.visible = false;
                    return;
                }
                finishStack();
                requestRender();
            },
            (err) => {
                console.warn('[IBC GLB] load failed:', err);
                showToast('Could not load Just IBC.glb — add it next to index.html.', 'error');
                state.ibc.enabled = false;
                const chk = document.getElementById('chk-ibc-glb');
                if (chk) chk.checked = false;
                if (threeRenderer.ibcReferenceGroup) threeRenderer.ibcReferenceGroup.visible = false;
            }
        )) {
            showToast('GLTFLoader failed to load (check network). IBC model disabled.', 'error');
            state.ibc.enabled = false;
            const chk = document.getElementById('chk-ibc-glb');
            if (chk) chk.checked = false;
            threeRenderer.ibcReferenceGroup.visible = false;
        }
    }
    
    /**
     * Creates or updates the human scale reference figure (6' tall person)
     * @param {Object} data - Linkage data with structure dimensions
     * @param {{x,y,z}} structureCenter - Center of the structure
     */
    function updateHumanScaleFigure(data, structureCenter) {
        if (!threeRenderer.humanScaleGroup) return;
        
        // Clear existing human figure
        while (threeRenderer.humanScaleGroup.children.length > 0) {
            const child = threeRenderer.humanScaleGroup.children[0];
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
            threeRenderer.humanScaleGroup.remove(child);
        }
        
        if (!state.showHumanScale) return;
        
        const humanHeight = 72; // 6 feet in inches
        const footprint = getStructurePlanFootprintForReference(data);
        
        // Create a stylized human silhouette using basic shapes
        const humanGroup = new THREE.Group();
        
        // Semi-transparent blue material for the silhouette
        const silhouetteMaterial = new THREE.MeshBasicMaterial({
            color: 0x4a90d9,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide
        });
        
        // Outline material
        const outlineMaterial = new THREE.LineBasicMaterial({
            color: 0x2171c9,
            linewidth: 2
        });
        
        // Human proportions (in inches)
        const headRadius = 4.5;      // ~9" head diameter
        const neckHeight = 2;
        const torsoHeight = 24;
        const torsoWidth = 16;
        const legHeight = 32;
        const legWidth = 5;
        const armLength = 24;
        const armWidth = 3;
        const shoulderY = humanHeight - headRadius * 2 - neckHeight - 4;
        
        // Head (sphere)
        const headGeom = new THREE.SphereGeometry(headRadius, 16, 12);
        const headMesh = new THREE.Mesh(headGeom, silhouetteMaterial);
        headMesh.position.y = humanHeight - headRadius;
        humanGroup.add(headMesh);
        
        // Torso (box)
        const torsoGeom = new THREE.BoxGeometry(torsoWidth, torsoHeight, 6);
        const torsoMesh = new THREE.Mesh(torsoGeom, silhouetteMaterial);
        torsoMesh.position.y = shoulderY - torsoHeight / 2;
        humanGroup.add(torsoMesh);
        
        // Left leg
        const legGeom = new THREE.BoxGeometry(legWidth, legHeight, 5);
        const leftLegMesh = new THREE.Mesh(legGeom, silhouetteMaterial);
        leftLegMesh.position.set(-4, legHeight / 2, 0);
        humanGroup.add(leftLegMesh);
        
        // Right leg
        const rightLegMesh = new THREE.Mesh(legGeom.clone(), silhouetteMaterial);
        rightLegMesh.position.set(4, legHeight / 2, 0);
        humanGroup.add(rightLegMesh);
        
        // Left arm
        const armGeom = new THREE.BoxGeometry(armWidth, armLength, 4);
        const leftArmMesh = new THREE.Mesh(armGeom, silhouetteMaterial);
        leftArmMesh.position.set(-torsoWidth / 2 - armWidth / 2, shoulderY - armLength / 2 - 2, 0);
        humanGroup.add(leftArmMesh);
        
        // Right arm
        const rightArmMesh = new THREE.Mesh(armGeom.clone(), silhouetteMaterial);
        rightArmMesh.position.set(torsoWidth / 2 + armWidth / 2, shoulderY - armLength / 2 - 2, 0);
        humanGroup.add(rightArmMesh);
        
        // Add height label above head
        const labelCanvas = document.createElement('canvas');
        labelCanvas.width = 128;
        labelCanvas.height = 48;
        const labelCtx = labelCanvas.getContext('2d');
        labelCtx.fillStyle = 'rgba(21, 32, 43, 0.9)';
        labelCtx.roundRect(4, 4, 120, 40, 6);
        labelCtx.fill();
        labelCtx.strokeStyle = '#4a90d9';
        labelCtx.lineWidth = 2;
        labelCtx.roundRect(4, 4, 120, 40, 6);
        labelCtx.stroke();
        labelCtx.font = 'bold 20px Arial';
        labelCtx.fillStyle = '#4a90d9';
        labelCtx.textAlign = 'center';
        labelCtx.textBaseline = 'middle';
        labelCtx.fillText("6' (72\")", 64, 24);
        
        const labelTexture = new THREE.CanvasTexture(labelCanvas);
        const labelMaterial = new THREE.SpriteMaterial({ map: labelTexture, transparent: true });
        const labelSprite = new THREE.Sprite(labelMaterial);
        labelSprite.position.y = humanHeight + 12;
        labelSprite.scale.set(24, 9, 1);
        humanGroup.add(labelSprite);
        
        // Position the human figure at the deployed ring center (world origin XZ),
        // matching the IBC anchor so both stay fixed as the structure folds/deploys.
        humanGroup.position.set(0, footprint.minY, 0);
        
        // No rotation needed - human will be visible from all angles
        humanGroup.rotation.y = 0;
        
        threeRenderer.humanScaleGroup.add(humanGroup);
    }
    
    /**
     * Creates or updates the 3D measurement lines
     * @param {Object} data - Linkage data with structure dimensions
     */
    function update3DMeasurementLines(data) {
        if (!threeRenderer.measurementGroup) return;
        
        // Clear existing measurement lines
        while (threeRenderer.measurementGroup.children.length > 0) {
            const child = threeRenderer.measurementGroup.children[0];
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (child.material.map) child.material.map.dispose();
                child.material.dispose();
            }
            threeRenderer.measurementGroup.remove(child);
        }
        
        if (!state.measureMode) return;
        
        const measurements = calculateMeasurements(data);
        const isArchMode = state.orientation === 'vertical';
        const system = unitConverter.getPreferredUnitSystem();
        
        // Helper to create a 3D measurement line with endpoints and label
        const createMeasurementLine3D = (point1, point2, label, color) => {
            if (!point1 || !point2) return;
            
            const lineGroup = new THREE.Group();
            
            // Create the line
            const lineMaterial = new THREE.LineBasicMaterial({ 
                color: color,
                linewidth: 2,
                depthTest: true,
                transparent: true,
                opacity: 0.9
            });
            
            const lineGeometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(point1.x, point1.y, point1.z || 0),
                new THREE.Vector3(point2.x, point2.y, point2.z || 0)
            ]);
            
            const line = new THREE.Line(lineGeometry, lineMaterial);
            lineGroup.add(line);
            
            // Create endpoint markers (small spheres)
            const markerGeometry = new THREE.SphereGeometry(1.5, 8, 8);
            const markerMaterial = new THREE.MeshBasicMaterial({ color: color });
            
            const marker1 = new THREE.Mesh(markerGeometry, markerMaterial);
            marker1.position.set(point1.x, point1.y, point1.z || 0);
            lineGroup.add(marker1);
            
            const marker2 = new THREE.Mesh(markerGeometry.clone(), markerMaterial);
            marker2.position.set(point2.x, point2.y, point2.z || 0);
            lineGroup.add(marker2);
            
            // Create floating label at midpoint using a sprite
            const midPoint = {
                x: (point1.x + point2.x) / 2,
                y: (point1.y + point2.y) / 2,
                z: ((point1.z || 0) + (point2.z || 0)) / 2
            };
            
            // Create canvas for label
            const labelCanvas = document.createElement('canvas');
            labelCanvas.width = 256;
            labelCanvas.height = 64;
            const ctx = labelCanvas.getContext('2d');
            
            // Background
            ctx.fillStyle = 'rgba(21, 32, 43, 0.95)';
            ctx.beginPath();
            ctx.roundRect(4, 4, 248, 56, 8);
            ctx.fill();
            
            // Border
            ctx.strokeStyle = '#' + color.toString(16).padStart(6, '0');
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.roundRect(4, 4, 248, 56, 8);
            ctx.stroke();
            
            // Text
            ctx.font = 'bold 28px Arial';
            ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, 128, 32);
            
            const labelTexture = new THREE.CanvasTexture(labelCanvas);
            const labelMaterial = new THREE.SpriteMaterial({ 
                map: labelTexture, 
                transparent: true,
                depthTest: false,  // Always visible
                sizeAttenuation: true
            });
            const labelSprite = new THREE.Sprite(labelMaterial);
            labelSprite.position.set(midPoint.x, midPoint.y + 8, midPoint.z);
            labelSprite.scale.set(40, 10, 1);
            lineGroup.add(labelSprite);
            
            threeRenderer.measurementGroup.add(lineGroup);
        };
        
        // Update sidebar display
        const innerEl = document.getElementById('meas-inner-dia');
        const outerEl = document.getElementById('meas-outer-dia');
        const heightEl = document.getElementById('meas-height');
        const spanEl = document.getElementById('meas-span');
        
        const innerLabelEl = innerEl ? innerEl.previousElementSibling : null;
        const outerLabelEl = outerEl ? outerEl.previousElementSibling : null;
        
        if (isArchMode) {
            if (innerLabelEl) innerLabelEl.textContent = 'Depth:';
            if (outerLabelEl) outerLabelEl.textContent = 'Span:';
        } else {
            if (innerLabelEl) innerLabelEl.textContent = 'Diameter:';
            if (outerLabelEl) outerLabelEl.textContent = 'Outer Ø:';
        }
        
        if (innerEl) innerEl.textContent = formatMeasurementSidebar(measurements.innerDia);
        if (outerEl) outerEl.textContent = formatMeasurementSidebar(measurements.outerDia);
        if (heightEl) heightEl.textContent = formatMeasurementSidebar(measurements.height);
        if (spanEl) spanEl.textContent = formatMeasurementSidebar(measurements.span);
        
        // Draw 3D measurements based on mode
        if (isArchMode) {
            // ARCH MODE: Show span at ground, height, and depth
            
            // Span line (horizontal at ground level) - Orange
            if (measurements.outerPoints && measurements.outerDia > 0) {
                const label = system === 'metric'
                    ? `Span: ${unitConverter.formatLength(measurements.outerDia, 'in', 1)}`
                    : `Span: ${formatNumber(measurements.outerDia / INCHES_PER_FOOT, 1)}'`;
                createMeasurementLine3D(measurements.outerPoints[0], measurements.outerPoints[1], label, 0xf0ad4e);
            }
            
            // Height line (vertical from ground to apex) - Green
            if (measurements.heightPoints && measurements.height > 0) {
                const label = system === 'metric'
                    ? `Height: ${unitConverter.formatLength(measurements.height, 'in', 1)}`
                    : `Height: ${formatNumber(measurements.height / INCHES_PER_FOOT, 1)}'`;
                createMeasurementLine3D(measurements.heightPoints[0], measurements.heightPoints[1], label, 0x2ecc71);
            }
            
            // Depth line (along Z axis) - Cyan
            if (measurements.innerPoints && measurements.innerDia > 0) {
                const label = system === 'metric'
                    ? `Depth: ${unitConverter.formatLength(measurements.innerDia, 'in', 1)}`
                    : `Depth: ${formatNumber(measurements.innerDia / INCHES_PER_FOOT, 1)}'`;
                createMeasurementLine3D(measurements.innerPoints[0], measurements.innerPoints[1], label, 0x00d2d3);
            }
        } else {
            // CYLINDER MODE: Show inner/outer diameter and height
            
            // Diameter on ground plane - Cyan (widest distance across structure)
            if (measurements.innerPoints && measurements.innerDia > 0) {
                const label = system === 'metric'
                    ? `Diameter: ${unitConverter.formatLength(measurements.innerDia, 'in', 1)}`
                    : `Diameter: ${formatNumber(measurements.innerDia / INCHES_PER_FOOT, 1)}'`;
                createMeasurementLine3D(measurements.innerPoints[0], measurements.innerPoints[1], label, 0x00d2d3);
            }
            
            // Outer diameter - Orange
            if (measurements.outerPoints && measurements.outerDia > 0) {
                const label = system === 'metric'
                    ? `Outer: ${unitConverter.formatLength(measurements.outerDia, 'in', 1)}`
                    : `Outer: ${formatNumber(measurements.outerDia / INCHES_PER_FOOT, 1)}'`;
                createMeasurementLine3D(measurements.outerPoints[0], measurements.outerPoints[1], label, 0xf0ad4e);
            }
            
            // Height line - Green
            if (measurements.heightPoints && measurements.height > 0) {
                const label = system === 'metric'
                    ? `Height: ${unitConverter.formatLength(measurements.height, 'in', 1)}`
                    : `Height: ${formatNumber(measurements.height / INCHES_PER_FOOT, 1)}'`;
                createMeasurementLine3D(measurements.heightPoints[0], measurements.heightPoints[1], label, 0x2ecc71);
            }
        }
    }
    

    g.LinkageModules = g.LinkageModules || {};
    g.LinkageModules.measurementOverlay = { formatMeasurementSidebar, calculateMeasurements, drawMeasurements, drawMeasurementsOverlay, applyIbcInteriorGlow, rebuildIbcPivotStack, createIbcExportGroup, syncIbcStackControlsVisibility, getStructurePlanFootprintForReference, preloadIbcGlb, updateIbcGlbReference, updateHumanScaleFigure, update3DMeasurementLines };
    g.formatMeasurementSidebar = formatMeasurementSidebar;
    g.calculateMeasurements = calculateMeasurements;
    g.drawMeasurements = drawMeasurements;
    g.drawMeasurementsOverlay = drawMeasurementsOverlay;
    g.applyIbcInteriorGlow = applyIbcInteriorGlow;
    g.rebuildIbcPivotStack = rebuildIbcPivotStack;
    g.createIbcExportGroup = createIbcExportGroup;
    g.syncIbcStackControlsVisibility = syncIbcStackControlsVisibility;
    g.getStructurePlanFootprintForReference = getStructurePlanFootprintForReference;
    g.preloadIbcGlb = preloadIbcGlb;
    g.updateIbcGlbReference = updateIbcGlbReference;
    g.updateHumanScaleFigure = updateHumanScaleFigure;
    g.update3DMeasurementLines = update3DMeasurementLines;

})(window);

