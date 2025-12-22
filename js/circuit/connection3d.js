/**
 * Connection3D Module
 * Creates 3D tube representations of circuit connections using TubeGeometry
 * 
 * Assumes THREE is available globally (loaded via script tag)
 */

import { WIRE_GAUGE_SPECS } from './wire-styles.js';

/**
 * Create a 3D connection tube between two nodes
 */
export class Connection3D {
    constructor(connection2D, sourceNode3D, targetNode3D, coordinateMapper, wireRenderer) {
        this.connection2D = connection2D;
        this.sourceNode3D = sourceNode3D;
        this.targetNode3D = targetNode3D;
        this.coordinateMapper = coordinateMapper;
        this.wireRenderer = wireRenderer;
        this.tube = null;
        this.endCaps = []; // Array to store end cap meshes
        this.waypointHandles = []; // Interactive handles for waypoints
        this.lastWireRadius = null; // Track radius for efficient updates
        this.createTube();
        this.createWaypointHandles();
    }
    
    /**
     * Get wire radius in meters based on wire gauge
     * Converts from pixel width to 3D radius
     */
    getWireRadius() {
        if (!this.connection2D) {
            return 0.002; // Default 2mm radius (10 AWG equivalent)
        }
        
        // Get wire gauge from connection, default to '10' if not specified
        const wireGauge = this.connection2D.wireGauge || '10';
        const wireSpec = WIRE_GAUGE_SPECS[wireGauge];
        
        if (!wireSpec) {
            return 0.002; // Default 2mm radius
        }
        
        // Convert pixel width to meters
        // Scale: 120 pixels = 1 meter, so 1 pixel = 1/120 meters
        // Wire width in pixels is the diameter, so radius = width / 2 / scale
        // But we want a more realistic wire radius, so we'll use a mapping:
        // 18 AWG = 1mm radius, 10 AWG = 2.5mm radius, 4/0 AWG = 3.5mm radius
        const radiusMap = {
            '18': 0.0005,   // 0.5mm
            '16': 0.00075,  // 0.75mm
            '14': 0.001,    // 1mm
            '12': 0.00125,  // 1.25mm
            '10': 0.0015,   // 1.5mm
            '8': 0.002,     // 2mm
            '6': 0.0025,    // 2.5mm
            '4': 0.003,     // 3mm
            '2': 0.0035,    // 3.5mm
            '1/0': 0.004,   // 4mm
            '2/0': 0.0045,  // 4.5mm
            '3/0': 0.005,   // 5mm
            '4/0': 0.0055   // 5.5mm
        };
        
        return radiusMap[wireGauge] || 0.0015; // Default to 1.5mm (10 AWG)
    }
    
    /**
     * Create metallic material for wire sheath
     */
    createWireMaterial() {
        const color = this.getWireColor();
        
        // Convert hex color to RGB
        const r = ((color >> 16) & 255) / 255;
        const g = ((color >> 8) & 255) / 255;
        const b = (color & 255) / 255;
        
        // Create metallic material with enhanced visibility for structure scale
        return new THREE.MeshStandardMaterial({
            color: new THREE.Color(r, g, b),
            metalness: 0.8,
            roughness: 0.2,
            emissive: new THREE.Color(r * 0.3, g * 0.3, b * 0.3), // More visible glow
            emissiveIntensity: 0.4, // Increased intensity
            side: THREE.DoubleSide // Render both sides for better visibility
        });
    }
    
    /**
     * Create end cap at connection point
     */
    createEndCap(position, radius) {
        // Make end caps slightly larger than wire for visibility
        const capRadius = Math.max(radius * 1.5, 0.02); // At least 2cm radius
        const capGeometry = new THREE.SphereGeometry(capRadius, 12, 12);
        const capMaterial = this.createWireMaterial();
        const cap = new THREE.Mesh(capGeometry, capMaterial);
        cap.position.copy(position);
        cap.userData = { type: 'wireEndCap', connection2D: this.connection2D };
        cap.visible = true;
        return cap;
    }
    
    createTube() {
        // Ensure THREE is available
        if (typeof THREE === 'undefined') {
            console.error('THREE.js not available for Connection3D');
            return;
        }
        
        // Check if nodes have meshes (PowerStation3D uses group instead of mesh)
        const sourceMesh = this.sourceNode3D?.getMesh ? this.sourceNode3D.getMesh() : this.sourceNode3D?.mesh;
        const targetMesh = this.targetNode3D?.getMesh ? this.targetNode3D.getMesh() : this.targetNode3D?.mesh;
        
        if (!this.sourceNode3D || !this.targetNode3D || !sourceMesh || !targetMesh) {
            console.warn('Connection3D: Missing source or target node3D/mesh', {
                hasSource: !!this.sourceNode3D,
                hasTarget: !!this.targetNode3D,
                sourceMesh: !!sourceMesh,
                targetMesh: !!targetMesh
            });
            return;
        }
        
        // Get handle positions in 3D space
        const sourceHandle3D = this.getHandlePosition3D(this.sourceNode3D, this.connection2D.sourceHandleId);
        const targetHandle3D = this.getHandlePosition3D(this.targetNode3D, this.connection2D.targetHandleId);
        
        // Phase 4: Calculate structure-aware wire route if structure geometry is available
        let points = [];
        const structureGeometry = typeof window !== 'undefined' ? window.linkageLabGeometry : null;
        
        if (structureGeometry && this.shouldUseStructureRouting(sourceHandle3D, targetHandle3D)) {
            points = this.calculateStructureAwareRoute(sourceHandle3D, targetHandle3D, structureGeometry);
        } else {
            // Build points array: start + waypoints + end
            points.push(sourceHandle3D);
            
            // Get routing parameters
            const routingStyle = this.connection2D?.wireRoutingStyle || 'curved';
            const lengthMultiplier = this.connection2D?.wireLengthMultiplier || 1.0;
            const verticalOffset = this.connection2D?.wireVerticalOffset || 0;
            const curveAmount = this.connection2D?.wireCurveAmount || 0.5;
            const waypointCount = Math.max(0, Math.min(5, Math.round(this.connection2D?.wireWaypointCount || 1)));
            const horizontalSpread = this.connection2D?.wireHorizontalSpread || 0;
            
            // Skip 2D waypoints for linked structure panels (positions wouldn't match)
            const sourceLinked = this.sourceNode3D?.node2D?.linkedStructurePanel;
            const targetLinked = this.targetNode3D?.node2D?.linkedStructurePanel;
            
            if (routingStyle === 'custom' && !sourceLinked && !targetLinked && 
                this.connection2D.waypoints && this.connection2D.waypoints.length > 0) {
                // Use 2D waypoints for custom routing
                this.connection2D.waypoints.forEach(wp => {
                    const wp3D = this.coordinateMapper.position2Dto3D(wp.x, wp.y, 0.1);
                    wp3D.y += verticalOffset;
                    points.push(new THREE.Vector3(wp3D.x, wp3D.y, wp3D.z));
                });
            } else if (routingStyle === 'direct') {
                // Direct route - no waypoints
            } else {
                // Generate waypoints based on routing parameters
                const dx = targetHandle3D.x - sourceHandle3D.x;
                const dy = targetHandle3D.y - sourceHandle3D.y;
                const dz = targetHandle3D.z - sourceHandle3D.z;
                const totalDist = Math.sqrt(dx * dx + dz * dz);
                
                const numWaypoints = waypointCount > 0 ? waypointCount : (routingStyle === 'curved' ? 1 : 0);
                
                for (let i = 1; i <= numWaypoints; i++) {
                    const t = i / (numWaypoints + 1);
                    
                    let waypointX = sourceHandle3D.x + dx * t;
                    let waypointY = sourceHandle3D.y + dy * t + verticalOffset;
                    let waypointZ = sourceHandle3D.z + dz * t;
                    
                    // Apply curve amount (affects Y position)
                    if (curveAmount > 0 && routingStyle === 'curved') {
                        const curveHeight = curveAmount * totalDist * 0.2;
                        waypointY += curveHeight * Math.sin(t * Math.PI);
                    }
                    
                    // Apply length multiplier
                    if (lengthMultiplier > 1.0 && totalDist > 0.1) {
                        const perpX = -dz / totalDist;
                        const perpZ = dx / totalDist;
                        const extension = (lengthMultiplier - 1.0) * totalDist * 0.3 * curveAmount;
                        waypointX += perpX * extension;
                        waypointZ += perpZ * extension;
                    }
                    
                    // Apply horizontal spread
                    if (horizontalSpread > 0 && totalDist > 0.1) {
                        const perpX = -dz / totalDist;
                        const perpZ = dx / totalDist;
                        const spreadFactor = Math.sin(t * Math.PI);
                        waypointX += perpX * horizontalSpread * spreadFactor;
                        waypointZ += perpZ * horizontalSpread * spreadFactor;
                    }
                    
                    points.push(new THREE.Vector3(waypointX, waypointY, waypointZ));
                }
            }
            
            points.push(targetHandle3D);
        }
        
        // Validate points
        if (points.length < 2) {
            console.warn('Connection3D: Not enough points for connection', {
                connId: this.connection2D?.id,
                points: points.length,
                source: !!sourceHandle3D,
                target: !!targetHandle3D
            });
            return;
        }
        
        // Check for invalid points (NaN or Infinity)
        const invalidPoints = points.filter(p => 
            !p || 
            !isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z) ||
            isNaN(p.x) || isNaN(p.y) || isNaN(p.z)
        );
        if (invalidPoints.length > 0) {
            console.error('Connection3D: Invalid points detected', {
                connId: this.connection2D?.id,
                invalidCount: invalidPoints.length,
                points: points
            });
            return;
        }
        
        // Get wire radius (ensure minimum size for visibility at structure scale)
        let wireRadius = this.getWireRadius();
        
        // Apply custom wire radius multiplier if specified
        const radiusMultiplier = this.connection2D?.wireRadiusMultiplier || 1.0;
        wireRadius *= radiusMultiplier;
        
        // Ensure minimum radius for visibility - use 2cm (0.02m) for structure scale
        // This makes wires clearly visible alongside structure beams
        wireRadius = Math.max(wireRadius, 0.02);
        
        // Create curve for tube
        let curve;
        if (points.length === 2) {
            // For 2 points, create a simple straight line curve
            curve = new THREE.LineCurve3(points[0], points[1]);
        } else {
            // Create Catmull-Rom curve through waypoints
            curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
        }
        
        // Create tube geometry
        // Phase 9: Performance optimization - adjust segments based on curve complexity
        // Use 16 radial segments for smooth circular cross-section
        // Use fewer tubular segments for simple curves (performance optimization)
        const curveLength = points.length === 2 ? 
            points[0].distanceTo(points[1]) : 
            curve.getLength();
        // Use fewer segments for short/straight wires, more for complex curves
        const tubularSegments = curveLength < 2 ? 32 : (curveLength < 5 ? 48 : 64);
        const tubeGeometry = new THREE.TubeGeometry(curve, tubularSegments, wireRadius, 16, false);
        
        // Create material
        const material = this.createWireMaterial();
        
        // Create mesh
        this.tube = new THREE.Mesh(tubeGeometry, material);
        this.tube.userData = { connection2D: this.connection2D, type: 'connection' };
        
        // Make tube visible and ensure it renders
        this.tube.visible = true;
        this.tube.castShadow = true;
        this.tube.receiveShadow = true;
        this.tube.renderOrder = 1; // Render after structure but before nodes
        
        // Create end caps at connection points
        this.endCaps = [];
        this.endCaps.push(this.createEndCap(sourceHandle3D, wireRadius));
        this.endCaps.push(this.createEndCap(targetHandle3D, wireRadius));
        this.lastWireRadius = wireRadius;
        
        // Create waypoint handles after tube is created
        this.createWaypointHandles();
    }
    
    /**
     * Create interactive waypoint handles for 3D wire editing
     */
    createWaypointHandles() {
        // Clear existing handles
        this.waypointHandles.forEach(handle => {
            if (handle.geometry) handle.geometry.dispose();
            if (handle.material) handle.material.dispose();
        });
        this.waypointHandles = [];
        
        // Only create handles if routing style is 'custom' or if waypoints exist
        const routingStyle = this.connection2D?.wireRoutingStyle;
        if (routingStyle !== 'custom' && (!this.connection2D.waypoints || this.connection2D.waypoints.length === 0)) {
            return;
        }
        
        // Get current wire points
        if (!this.tube || !this.sourceNode3D || !this.targetNode3D) return;
        
        const sourceHandle3D = this.getHandlePosition3D(this.sourceNode3D, this.connection2D.sourceHandleId);
        const targetHandle3D = this.getHandlePosition3D(this.targetNode3D, this.connection2D.targetHandleId);
        
        // Get waypoints (either from connection2D.waypoints or calculate from routing)
        let waypoints = [];
        
        if (routingStyle === 'custom' && this.connection2D.waypoints) {
            // Use existing 2D waypoints
            this.connection2D.waypoints.forEach(wp => {
                const wp3D = this.coordinateMapper.position2Dto3D(wp.x, wp.y, 0.1);
                waypoints.push(new THREE.Vector3(wp3D.x, wp3D.y, wp3D.z));
            });
        } else {
            // Calculate waypoints from routing parameters
            const structureGeometry = typeof window !== 'undefined' ? window.linkageLabGeometry : null;
            let points = [];
            
            if (structureGeometry && this.shouldUseStructureRouting(sourceHandle3D, targetHandle3D)) {
                points = this.calculateStructureAwareRoute(sourceHandle3D, targetHandle3D, structureGeometry);
            } else {
                // Regular routing with waypoints
                points.push(sourceHandle3D);
                const waypointCount = Math.max(0, Math.min(5, Math.round(this.connection2D?.wireWaypointCount || 1)));
                if (waypointCount > 0) {
                    const dx = targetHandle3D.x - sourceHandle3D.x;
                    const dy = targetHandle3D.y - sourceHandle3D.y;
                    const dz = targetHandle3D.z - sourceHandle3D.z;
                    const totalDist = Math.sqrt(dx * dx + dz * dz);
                    
                    for (let i = 1; i <= waypointCount; i++) {
                        const t = i / (waypointCount + 1);
                        const waypointX = sourceHandle3D.x + dx * t;
                        const waypointY = sourceHandle3D.y + dy * t;
                        const waypointZ = sourceHandle3D.z + dz * t;
                        points.push(new THREE.Vector3(waypointX, waypointY, waypointZ));
                    }
                }
                points.push(targetHandle3D);
            }
            
            // Extract waypoints (skip first and last - those are source/target)
            if (points.length > 2) {
                waypoints = points.slice(1, -1);
            }
        }
        
        // Create handle for each waypoint
        const handleRadius = Math.max(0.05, (this.getWireRadius() * (this.connection2D?.wireRadiusMultiplier || 1.0)) * 2);
        
        waypoints.forEach((waypoint, index) => {
            const handleGeometry = new THREE.SphereGeometry(handleRadius, 16, 16);
            const handleMaterial = new THREE.MeshStandardMaterial({
                color: 0x00ffff, // Cyan
                emissive: 0x004444,
                metalness: 0.8,
                roughness: 0.2,
                transparent: true,
                opacity: 0.8
            });
            
            const handle = new THREE.Mesh(handleGeometry, handleMaterial);
            handle.position.copy(waypoint);
            handle.userData = {
                type: 'wireWaypoint',
                connection2D: this.connection2D,
                waypointIndex: index,
                isDragging: false
            };
            
            // Make handle larger and more visible
            handle.scale.set(1.2, 1.2, 1.2);
            
            this.waypointHandles.push(handle);
        });
    }
    
    /**
     * Get all waypoint handle meshes
     */
    getWaypointHandles() {
        return this.waypointHandles;
    }
    
    /**
     * Update waypoint position from 3D handle drag
     */
    updateWaypointFromHandle(handleIndex, newPosition3D) {
        if (!this.connection2D.waypoints) {
            this.connection2D.waypoints = [];
        }
        
        // Convert 3D position to 2D
        const pos2D = this.coordinateMapper.position3Dto2D(newPosition3D.x, newPosition3D.y, newPosition3D.z);
        
        // Update or create waypoint
        if (handleIndex < this.connection2D.waypoints.length) {
            this.connection2D.waypoints[handleIndex].x = pos2D.x;
            this.connection2D.waypoints[handleIndex].y = pos2D.y;
        } else {
            this.connection2D.waypoints.push({ x: pos2D.x, y: pos2D.y });
        }
        
        // Force routing style to custom when waypoints are manually edited
        this.connection2D.wireRoutingStyle = 'custom';
        
        // Update wire
        this.update();
    }
    
    getHandlePosition3D(node3D, handleId) {
        if (typeof THREE === 'undefined') {
            console.error('THREE.js not available');
            return new THREE.Vector3(0, 0, 0);
        }
        
        // Check if this is a PowerStation3D or Panel3D (has getHandlePosition3D method)
        // These methods return world positions directly
        if (node3D && typeof node3D.getHandlePosition3D === 'function') {
            return node3D.getHandlePosition3D(handleId);
        }
        
        if (!node3D || !node3D.node2D || !node3D.mesh) {
            return new THREE.Vector3(0, 0, 0);
        }
        
        // Find the handle in the 2D node
        const handle = Object.values(node3D.node2D.handles || {}).find(h => h.id === handleId);
        if (!handle) {
            // Fallback to node center
            return new THREE.Vector3(
                node3D.position3D.x,
                node3D.position3D.y,
                node3D.position3D.z
            );
        }
        
        // Get node position and dimensions
        const nodePos = node3D.position3D;
        const nodeWidthPx = node3D.node2D.width || 100;
        const nodeHeightPx = node3D.node2D.height || 100;
        
        // Convert dimensions from pixels to meters
        // Scale: 120 pixels = 1 meter, so 1 pixel = 1/120 meters
        const nodeWidth = nodeWidthPx / this.coordinateMapper.scale;
        const nodeHeight = nodeHeightPx / this.coordinateMapper.scale;
        
        // Handle x/y are in pixels relative to node's local coordinate system
        // In 2D: (0,0) is top-left, x increases right, y increases down
        // In 3D: X=right, Y=up, Z=forward (depth)
        
        let handleX = 0, handleY = 0, handleZ = 0;
        
        if (node3D.node2D.type === 'panel') {
            // Panels are HORIZONTAL (XZ plane), front face faces +Y (up)
            // In 2D: handle.x is relative to node left (0 = left edge, width = right edge)
            //        handle.y is relative to node top (0 = top, height = bottom)
            // In 3D: Panel lies flat (XZ plane), front face faces +Y
            
            // First, try to get position from actual port handle mesh (most accurate)
            if (node3D.getPortHandleMeshes) {
                const portHandleMeshes = node3D.getPortHandleMeshes();
                const portHandle = portHandleMeshes.find(h => h.userData && h.userData.handleId === handleId);
                if (portHandle) {
                    // Get world position from the port handle mesh
                    const worldPos = new THREE.Vector3();
                    portHandle.getWorldPosition(worldPos);
                    return worldPos;
                }
            }
            
            // Use Panel3D's getHandlePosition3D which returns relative position, then add to panel world position
            if (node3D.getHandlePosition3D && typeof node3D.getHandlePosition3D === 'function') {
                const handleRelPos = node3D.getHandlePosition3D(handleId);
                if (handleRelPos) {
                    // Get panel's world position and rotation
                    const panelWorldPos = new THREE.Vector3();
                    const panelWorldQuat = new THREE.Quaternion();
                    const panelWorldScale = new THREE.Vector3();
                    
                    if (node3D.mesh) {
                        node3D.mesh.getWorldPosition(panelWorldPos);
                        node3D.mesh.getWorldQuaternion(panelWorldQuat);
                        node3D.mesh.getWorldScale(panelWorldScale);
                        
                        // Transform relative position to world space
                        const handleWorldPos = handleRelPos.clone();
                        handleWorldPos.applyQuaternion(panelWorldQuat);
                        handleWorldPos.multiply(panelWorldScale);
                        handleWorldPos.add(panelWorldPos);
                        
                        return handleWorldPos;
                    }
                }
            }
            
            // Fallback: calculate position based on panel dimensions
            // Get panel dimensions (from linked panel or specs)
            let panelWidth, panelLength, panelThickness;
            if (node3D.node2D.linkedStructurePanel) {
                const linkedPanel = node3D.node2D.linkedStructurePanel;
                const INCHES_TO_METERS = 0.0254;
                panelWidth = (linkedPanel.width || 65) * INCHES_TO_METERS;
                panelLength = (linkedPanel.length || 39.1) * INCHES_TO_METERS;
                panelThickness = (linkedPanel.thickness || 1.5) * INCHES_TO_METERS;
            } else {
                panelWidth = nodeWidth;
                panelLength = nodeHeight;
                panelThickness = 0.04; // 40mm typical
            }
            
            // X position: based on handle.x and side
            if (handle.side === 'left') {
                // Left edge (-X)
                handleX = -panelWidth / 2;
            } else if (handle.side === 'right') {
                // Right edge (+X)
                handleX = panelWidth / 2;
            } else {
                // Fallback: use handle.x position relative to center
                handleX = (handle.x - nodeWidthPx / 2) / this.coordinateMapper.scale;
            }
            
            // Y position: On top surface of panel (front face faces +Y)
            handleY = panelThickness / 2 + 0.01; // Slightly above surface
            
            // Z position: Based on handle.y (2D vertical becomes 3D Z)
            // handle.y is relative to node top (0 = top), convert to center-relative
            if (handle.side === 'top') {
                handleZ = panelLength / 2;
            } else if (handle.side === 'bottom') {
                handleZ = -panelLength / 2;
            } else {
                handleZ = -((handle.y || nodeHeightPx / 2) - nodeHeightPx / 2) / this.coordinateMapper.scale;
            }
            
            // Get panel's actual world position from mesh (more accurate than position3D)
            let panelWorldPos = nodePos;
            if (node3D.mesh) {
                const worldPos = new THREE.Vector3();
                node3D.mesh.getWorldPosition(worldPos);
                panelWorldPos = worldPos;
            }
            
            // Add relative handle position to panel's world position
            const handleWorldPos = new THREE.Vector3(
                panelWorldPos.x + handleX,
                panelWorldPos.y + handleY,
                panelWorldPos.z + handleZ
            );
            
            // Apply panel rotation if mesh exists
            if (node3D.mesh) {
                const panelWorldQuat = new THREE.Quaternion();
                node3D.mesh.getWorldQuaternion(panelWorldQuat);
                handleWorldPos.sub(panelWorldPos); // Make relative to panel center
                handleWorldPos.applyQuaternion(panelWorldQuat); // Apply rotation
                handleWorldPos.add(panelWorldPos); // Add back panel position
            }
            
            return handleWorldPos;
            
        } else if (node3D.node2D.type === 'battery') {
            // Batteries: width=X, height=Y (vertical), depth=Z
            // Terminals are on top (y=-5 in 2D means 5px above the node top)
            
            // X: handle.x relative to node center
            // Battery handles are at x positions like 0.25*width and 0.75*width
            handleX = (handle.x - nodeWidthPx / 2) / this.coordinateMapper.scale;
            
            // Y: Terminals are on top of battery
            // handle.y = -5 means 5px above top, so position at top + offset
            if (handle.y < 0) {
                // Handle is above node (y < 0), convert to meters
                handleY = nodeHeight / 2 + Math.abs(handle.y) / this.coordinateMapper.scale;
            } else {
                // Fallback: top of battery with small offset
                handleY = nodeHeight / 2 + 0.01;
            }
            
            // Z: Center depth-wise (batteries are centered)
            handleZ = 0;
            
        } else if (node3D.node2D.type === 'controller') {
            // Controllers: width=X, height=Y (vertical), depth=Z
            
            // X: handle.x relative to node center
            handleX = (handle.x - nodeWidthPx / 2) / this.coordinateMapper.scale;
            
            // Y and Z depend on side
            if (handle.side === 'top') {
                // Top ports (PV inputs) - handle.y is typically -5 (above node)
                if (handle.y < 0) {
                    handleY = nodeHeight / 2 + Math.abs(handle.y) / this.coordinateMapper.scale;
                } else {
                    handleY = nodeHeight / 2 + 0.01;
                }
                handleZ = 0; // Center depth-wise
            } else if (handle.side === 'bottom') {
                // Bottom ports (battery connections) - handle.y is typically height+5 (below node)
                if (handle.y > nodeHeightPx) {
                    handleY = -nodeHeight / 2 - (handle.y - nodeHeightPx) / this.coordinateMapper.scale;
                } else {
                    handleY = -nodeHeight / 2 - 0.01;
                }
                handleZ = 0; // Center depth-wise
            } else if (handle.side === 'right') {
                // Right side ports (AC output) - handle.x is typically width+5
                if (handle.x > nodeWidthPx) {
                    handleX = nodeWidth / 2 + (handle.x - nodeWidthPx) / this.coordinateMapper.scale;
                } else {
                    handleX = nodeWidth / 2 + 0.01;
                }
                handleY = 0; // Center vertically
                handleZ = 0; // Center depth-wise
            } else if (handle.side === 'left') {
                // Left side ports
                if (handle.x < 0) {
                    handleX = -nodeWidth / 2 - Math.abs(handle.x) / this.coordinateMapper.scale;
                } else {
                    handleX = -nodeWidth / 2 - 0.01;
                }
                handleY = 0; // Center vertically
                handleZ = 0; // Center depth-wise
            } else {
                // Default: use handle position relative to center
                handleX = (handle.x - nodeWidthPx / 2) / this.coordinateMapper.scale;
                handleY = (handle.y - nodeHeightPx / 2) / this.coordinateMapper.scale;
                handleZ = 0;
            }
        } else {
            // Default for other node types
            handleX = (handle.x - nodeWidthPx / 2) / this.coordinateMapper.scale;
            handleY = (handle.y - nodeHeightPx / 2) / this.coordinateMapper.scale;
            handleZ = 0;
        }
        
        // For panels, ALWAYS try to get world position from the actual port handle if it exists
        // This ensures we use the correct position from the port handle mesh
        if (node3D.node2D.type === 'panel' && node3D.getPortHandleMeshes) {
            const portHandleMeshes = node3D.getPortHandleMeshes();
            const portHandle = portHandleMeshes.find(h => h.userData && h.userData.handleId === handleId);
            if (portHandle) {
                // Get world position from the port handle mesh
                const worldPos = new THREE.Vector3();
                portHandle.getWorldPosition(worldPos);
                return worldPos;
            }
        }
        
        // Apply panel rotation to handle offset if panel is linked to structure
        // Only do this if we didn't get the position from port handle mesh above
        if (node3D.node2D.type === 'panel' && node3D.node2D.linkedStructurePanel) {
            const rotation = node3D.node2D.linkedStructurePanel.rotation || 0;
            if (rotation !== 0) {
                // Rotate handle offset around Y axis
                const cos = Math.cos(rotation);
                const sin = Math.sin(rotation);
                const rotatedX = handleX * cos - handleZ * sin;
                const rotatedZ = handleX * sin + handleZ * cos;
                handleX = rotatedX;
                handleZ = rotatedZ;
            }
        }
        
        return new THREE.Vector3(
            nodePos.x + handleX,
            nodePos.y + handleY,
            nodePos.z + handleZ
        );
    }
    
    getWireColor() {
        if (!this.connection2D) return 0x888888;
        
        // Check if custom color is enabled and set
        if (this.connection2D.useCustomColor && this.connection2D.customColor) {
            // Convert hex string to number
            if (typeof this.connection2D.customColor === 'string') {
                return parseInt(this.connection2D.customColor.replace('#', ''), 16);
            }
            return this.connection2D.customColor;
        }
        
        const polarity = this.connection2D.polarity || 'mixed';
        
        // AC connections: check voltage for color (yellow for 120V, red for 240V)
        if (polarity === 'ac' || polarity === 'load') {
            // Try to get voltage from connection or connected items
            let voltage = this.connection2D.voltage;
            
            // If no voltage on connection, try to get from source/target nodes
            if (!voltage && this.sourceNode3D && this.sourceNode3D.node2D) {
                const sourceNode = this.sourceNode3D.node2D;
                // Check if source handle has voltage
                if (this.connection2D.sourceHandleId && sourceNode.handles) {
                    const handle = Object.values(sourceNode.handles).find(h => h.id === this.connection2D.sourceHandleId);
                    if (handle && handle.voltage) {
                        voltage = handle.voltage;
                    }
                }
                // Check node specs
                if (!voltage && sourceNode.specs && sourceNode.specs.voltage) {
                    voltage = sourceNode.specs.voltage;
                }
            }
            
            if (!voltage && this.targetNode3D && this.targetNode3D.node2D) {
                const targetNode = this.targetNode3D.node2D;
                // Check if target handle has voltage
                if (this.connection2D.targetHandleId && targetNode.handles) {
                    const handle = Object.values(targetNode.handles).find(h => h.id === this.connection2D.targetHandleId);
                    if (handle && handle.voltage) {
                        voltage = handle.voltage;
                    }
                }
                // Check node specs
                if (!voltage && targetNode.specs && targetNode.specs.voltage) {
                    voltage = targetNode.specs.voltage;
                }
            }
            
            // Return color based on voltage
            if (voltage === 240) {
                return 0xcc0000; // Red for 240V
            } else {
                return 0xffd700; // Yellow for 120V (default for AC)
            }
        }
        
        const colors = {
            'positive': 0xd9534f,      // Red
            'negative': 0x333333,      // Dark gray
            'mixed': 0x888888,         // Gray
            'parallel': 0x00a8e8,     // Blue
            'smart-battery': 0x5cb85c // Green
        };
        
        return colors[polarity] || colors['mixed'];
    }
    
    update() {
        // Update tube geometry when nodes move (more efficient than recreating)
        if (!this.tube || !this.sourceNode3D || !this.targetNode3D) {
            return;
        }
        
        // Get updated handle positions
        const sourceHandle3D = this.getHandlePosition3D(this.sourceNode3D, this.connection2D.sourceHandleId);
        const targetHandle3D = this.getHandlePosition3D(this.targetNode3D, this.connection2D.targetHandleId);
        
        // Phase 4: Use structure-aware routing if available
        let points = [];
        const structureGeometry = typeof window !== 'undefined' ? window.linkageLabGeometry : null;
        
        if (structureGeometry && this.shouldUseStructureRouting(sourceHandle3D, targetHandle3D)) {
            points = this.calculateStructureAwareRoute(sourceHandle3D, targetHandle3D, structureGeometry);
        } else {
            // Build points array: start + waypoints + end (original behavior)
            points.push(sourceHandle3D);
            
            // For panel-to-panel connections, add a small offset to ensure visibility
            const sourceType = this.sourceNode3D?.node2D?.type;
            const targetType = this.targetNode3D?.node2D?.type;
            if (sourceType === 'panel' && targetType === 'panel') {
                // Panel-to-panel: add a small waypoint to make wire visible with natural sag
                const midPoint = new THREE.Vector3();
                midPoint.lerpVectors(sourceHandle3D, targetHandle3D, 0.5);
                // Lower the midpoint to create a natural sag (gravity pulls wire down)
                midPoint.y -= 0.1; // 10cm below the direct line (natural sag)
                points.push(midPoint);
            } else {
                // Add waypoints if they exist
                if (this.connection2D.waypoints && this.connection2D.waypoints.length > 0) {
                    this.connection2D.waypoints.forEach(wp => {
                        const wp3D = this.coordinateMapper.position2Dto3D(wp.x, wp.y, 0.1);
                        points.push(new THREE.Vector3(wp3D.x, wp3D.y, wp3D.z));
                    });
                }
            }
            
            points.push(targetHandle3D);
        }
        
        // Apply catenary sag to all routing styles
        const sagAmount = this.connection2D?.wireSagAmount || 0;
        if (sagAmount > 0 && points.length >= 2) {
            // Apply catenary curve to the entire path
            const saggedPoints = [];
            saggedPoints.push(points[0].clone());
            
            for (let i = 1; i < points.length; i++) {
                const segmentStart = points[i - 1];
                const segmentEnd = points[i];
                
                const segDx = segmentEnd.x - segmentStart.x;
                const segDz = segmentEnd.z - segmentStart.z;
                const segHorizontalDist = Math.sqrt(segDx * segDx + segDz * segDz);
                
                if (segHorizontalDist > 0.1) {
                    // Apply catenary to this segment
                    const segmentSag = sagAmount * (segHorizontalDist / 5.0); // Scale sag by distance
                    const catenaryPoints = this.calculateCatenaryCurve(segmentStart, segmentEnd, segmentSag);
                    for (let j = 1; j < catenaryPoints.length; j++) {
                        saggedPoints.push(catenaryPoints[j]);
                    }
                } else {
                    saggedPoints.push(segmentEnd.clone());
                }
            }
            
            points.length = 0;
            points.push(...saggedPoints);
        }
        
        // Update geometry
        if (points.length >= 2) {
            // Get wire radius (may have changed if gauge was updated)
            // Apply custom wire radius multiplier if specified
            let wireRadius = this.getWireRadius();
            const radiusMultiplier = this.connection2D?.wireRadiusMultiplier || 1.0;
            wireRadius *= radiusMultiplier;
            // Ensure minimum radius for visibility at structure scale
            // Panel-to-panel connections need to be visible even when close together
            const sourceType = this.sourceNode3D?.node2D?.type;
            const targetType = this.targetNode3D?.node2D?.type;
            const minRadius = (sourceType === 'panel' && targetType === 'panel') ? 0.01 : 0.02; // 1cm for panel-to-panel, 2cm for others
            wireRadius = Math.max(wireRadius, minRadius);
            
            // Create new curve
            let curve;
            if (points.length === 2) {
                curve = new THREE.LineCurve3(points[0], points[1]);
            } else {
                curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
            }
            
            // Phase 9: Performance optimization - adjust segments based on curve complexity
            const curveLength = points.length === 2 ? 
                points[0].distanceTo(points[1]) : 
                curve.getLength();
            const tubularSegments = curveLength < 2 ? 32 : (curveLength < 5 ? 48 : 64);
            const tubeGeometry = new THREE.TubeGeometry(curve, tubularSegments, wireRadius, 16, false);
            
            // Update material if color changed
            const newColor = this.getWireColor();
            if (this.tube.material) {
                // Check if color changed
                const currentColor = this.tube.material.color.getHex();
                if (currentColor !== newColor) {
                    // Update material color
                    this.tube.material.color.setHex(newColor);
                }
            } else {
                // Create new material if it doesn't exist
                this.tube.material = this.createWireMaterial();
            }
            
            // Dispose old geometry and assign new one
            if (this.tube.geometry) {
                this.tube.geometry.dispose();
            }
            this.tube.geometry = tubeGeometry;
            
            // Update end cap positions and create if needed
            if (this.endCaps.length < 2) {
                // Create end caps if they don't exist
                this.endCaps = [
                    this.createEndCap(sourceHandle3D, wireRadius),
                    this.createEndCap(targetHandle3D, wireRadius)
                ];
                this.lastWireRadius = wireRadius;
            } else {
                // Update existing end cap positions
                this.endCaps[0].position.copy(sourceHandle3D);
                this.endCaps[1].position.copy(targetHandle3D);
                
                // Update end cap colors to match wire
                const wireColor = this.getWireColor();
                if (this.endCaps[0].material) {
                    this.endCaps[0].material.color.setHex(wireColor);
                }
                if (this.endCaps[1].material) {
                    this.endCaps[1].material.color.setHex(wireColor);
                }
                
                // Only recreate geometry if radius changed significantly (more than 10%)
                if (this.lastWireRadius === null || 
                    Math.abs(this.lastWireRadius - wireRadius) > wireRadius * 0.1) {
                    if (this.endCaps[0].geometry) {
                        this.endCaps[0].geometry.dispose();
                        this.endCaps[1].geometry.dispose();
                    }
                    const capGeometry = new THREE.SphereGeometry(wireRadius * 1.5, 8, 8);
                    this.endCaps[0].geometry = capGeometry;
                    this.endCaps[1].geometry = capGeometry.clone();
                    this.lastWireRadius = wireRadius;
                }
            }
            
            // Update waypoint handles after wire update
            this.createWaypointHandles();
        }
    }
    
    dispose() {
        // Dispose tube
        if (this.tube) {
            if (this.tube.geometry) this.tube.geometry.dispose();
            if (this.tube.material) this.tube.material.dispose();
        }
        
        // Dispose end caps
        this.endCaps.forEach(cap => {
            if (cap.geometry) cap.geometry.dispose();
            if (cap.material) cap.material.dispose();
        });
        this.endCaps = [];
        
        // Dispose waypoint handles
        this.waypointHandles.forEach(handle => {
            if (handle.geometry) handle.geometry.dispose();
            if (handle.material) handle.material.dispose();
        });
        this.waypointHandles = [];
    }
    
    /**
     * Get the tube mesh (for adding to scene)
     */
    getTube() {
        return this.tube;
    }
    
    /**
     * Get all meshes (tube + end caps + waypoint handles) for adding to scene
     */
    getMeshes() {
        const meshes = [];
        if (this.tube) {
            meshes.push(this.tube);
        }
        meshes.push(...this.endCaps);
        meshes.push(...this.waypointHandles);
        return meshes;
    }
    
    /**
     * Legacy method for compatibility - returns tube instead of line
     */
    getLine() {
        return this.tube;
    }
    
    /**
     * Phase 4: Determine if structure-aware routing should be used
     * Respects user's routing style preference
     */
    shouldUseStructureRouting(sourcePos, targetPos) {
        if (!this.sourceNode3D || !this.targetNode3D) return false;
        
        // Check user's routing style preference
        const routingStyle = this.connection2D?.wireRoutingStyle;
        if (routingStyle === 'structure-aware') {
            return true;
        }
        if (routingStyle === 'direct' || routingStyle === 'custom') {
            return false;
        }
        
        // Determine connection type based on handle polarities
        // Series connections: panel + to panel - (opposite polarities)
        // Parallel connections: panel + to controller +, or panel - to controller - (same polarities)
        const sourceType = this.sourceNode3D.node2D?.type;
        const targetType = this.targetNode3D.node2D?.type;
        
        // Get handle polarities to determine if this is series or parallel
        const sourceHandle = this.sourceNode3D.node2D?.handles ? 
            Object.values(this.sourceNode3D.node2D.handles).find(h => h.id === this.connection2D.sourceHandleId) : null;
        const targetHandle = this.targetNode3D.node2D?.handles ? 
            Object.values(this.targetNode3D.node2D.handles).find(h => h.id === this.connection2D.targetHandleId) : null;
        
        const sourcePolarity = sourceHandle?.polarity || '';
        const targetPolarity = targetHandle?.polarity || '';
        
        // Normalize polarities
        const normalizePolarity = (p) => {
            if (p === 'pv-positive') return 'positive';
            if (p === 'pv-negative') return 'negative';
            return p;
        };
        const srcPol = normalizePolarity(sourcePolarity);
        const tgtPol = normalizePolarity(targetPolarity);
        
        // Panel-to-panel connections
        if (sourceType === 'panel' && targetType === 'panel') {
            // Series connection: + to - (opposite polarities)
            // Parallel connection: + to + or - to - (same polarities)
            // Series connections should be direct (no structure routing)
            // Parallel connections between panels are rare but should also be direct
            return false; // Panel-to-panel: always direct connection
        }
        
        // Panel-to-controller/PowerStation connections
        const isPanelSource = sourceType === 'panel';
        const isPowerStationTarget = targetType === 'controller' || 
                                     (this.targetNode3D.constructor?.name === 'PowerStation3D');
        
        if (isPanelSource && isPowerStationTarget) {
            // This is a parallel connection (string to controller)
            // Use structure routing for these
            return true;
        }
        
        return false;
    }
    
    /**
     * Calculate catenary curve points (wire hanging under gravity)
     * Returns array of points along the catenary curve
     */
    calculateCatenaryCurve(startPos, endPos, sagAmount) {
        if (sagAmount <= 0) {
            // No sag - return direct line
            return [startPos.clone(), endPos.clone()];
        }
        
        const points = [];
        const dx = endPos.x - startPos.x;
        const dy = endPos.y - startPos.y;
        const dz = endPos.z - startPos.z;
        const horizontalDist = Math.sqrt(dx * dx + dz * dz);
        const verticalDist = Math.abs(dy);
        
        if (horizontalDist < 0.1) {
            // Vertical wire - no catenary needed
            return [startPos.clone(), endPos.clone()];
        }
        
        // Calculate catenary parameters
        // Sag is the maximum vertical drop from the straight line
        // For a catenary: y = a * cosh(x/a) - a
        // We need to find 'a' such that the sag matches sagAmount
        
        // Approximate catenary using parabola for simplicity
        // y = (4 * sag / L^2) * x * (L - x)
        // where L is horizontal distance and sag is maximum sag
        
        const numPoints = Math.max(8, Math.ceil(horizontalDist * 10)); // More points for longer wires
        
        for (let i = 0; i <= numPoints; i++) {
            const t = i / numPoints;
            
            // Position along horizontal path
            const x = startPos.x + dx * t;
            const z = startPos.z + dz * t;
            
            // Calculate sag at this point (parabolic approximation)
            const sagAtPoint = 4 * sagAmount * t * (1 - t);
            
            // Y position: linear interpolation minus sag
            const baseY = startPos.y + dy * t;
            const y = baseY - sagAtPoint; // Subtract sag (wire hangs down)
            
            points.push(new THREE.Vector3(x, y, z));
        }
        
        return points;
    }
    
    /**
     * Phase 4: Calculate structure-aware wire route
     * Advanced routing with multiple parameters for full control
     */
    calculateStructureAwareRoute(sourcePos, targetPos, structureGeometry) {
        const points = [];
        
        // Validate input positions
        if (!sourcePos || !targetPos) {
            console.warn('calculateStructureAwareRoute: Invalid source or target position');
            return [sourcePos, targetPos].filter(p => p);
        }
        
        // Get all routing parameters from connection2D
        const routingStyle = this.connection2D?.wireRoutingStyle || 'structure-aware';
        const lengthMultiplier = this.connection2D?.wireLengthMultiplier || 1.0;
        const verticalOffset = this.connection2D?.wireVerticalOffset || 0;
        const curveAmount = this.connection2D?.wireCurveAmount || 0.5;
        const waypointCount = Math.max(0, Math.min(5, Math.round(this.connection2D?.wireWaypointCount || 1)));
        const horizontalSpread = this.connection2D?.wireHorizontalSpread || 0;
        
        // Start point
        points.push(sourcePos.clone());
        
        // Calculate direct path vector
        const dx = targetPos.x - sourcePos.x;
        const dy = targetPos.y - sourcePos.y;
        const dz = targetPos.z - sourcePos.z;
        const totalDist = Math.sqrt(dx * dx + dz * dz);
        const totalHeight = Math.abs(dy);
        
        if (routingStyle === 'direct') {
            // Direct route - just source and target
            points.push(targetPos.clone());
            return points;
        }
        
        // Calculate waypoints based on style
        if (routingStyle === 'structure-aware' || routingStyle === 'curved') {
            // Calculate base midpoint height
            let baseY = Math.max(0.15, Math.min(sourcePos.y, targetPos.y) + 0.1);
            baseY += verticalOffset;
            
            // Generate waypoints
            const numWaypoints = waypointCount > 0 ? waypointCount : 1;
            
            for (let i = 1; i <= numWaypoints; i++) {
                const t = i / (numWaypoints + 1); // Normalized position along path (0 to 1)
                
                // Base position along direct path
                let waypointX = sourcePos.x + dx * t;
                let waypointY = baseY + (targetPos.y - baseY) * t * curveAmount;
                let waypointZ = sourcePos.z + dz * t;
                
                // Apply length multiplier by extending perpendicular to path
                if (lengthMultiplier > 1.0 && totalDist > 0.1) {
                    // Perpendicular direction
                    const perpX = -dz / totalDist;
                    const perpZ = dx / totalDist;
                    
                    // Extension based on multiplier and curve amount
                    const extension = (lengthMultiplier - 1.0) * totalDist * 0.3 * curveAmount;
                    waypointX += perpX * extension;
                    waypointZ += perpZ * extension;
                }
                
                // Apply horizontal spread
                if (horizontalSpread > 0 && totalDist > 0.1) {
                    const perpX = -dz / totalDist;
                    const perpZ = dx / totalDist;
                    // Spread varies along path (more in middle)
                    const spreadFactor = Math.sin(t * Math.PI); // 0 at ends, 1 in middle
                    waypointX += perpX * horizontalSpread * spreadFactor;
                    waypointZ += perpZ * horizontalSpread * spreadFactor;
                }
                
                points.push(new THREE.Vector3(waypointX, waypointY, waypointZ));
            }
        }
        
        // End at target
        points.push(targetPos.clone());
        
        // Apply catenary sag if specified
        const sagAmount = this.connection2D?.wireSagAmount || 0;
        if (sagAmount > 0 && points.length >= 2) {
            // Apply catenary curve to the entire path
            // For multi-point paths, apply sag between each segment
            const saggedPoints = [];
            saggedPoints.push(points[0].clone());
            
            for (let i = 1; i < points.length; i++) {
                const segmentStart = points[i - 1];
                const segmentEnd = points[i];
                
                // Calculate sag for this segment based on horizontal distance
                const segDx = segmentEnd.x - segmentStart.x;
                const segDz = segmentEnd.z - segmentStart.z;
                const segHorizontalDist = Math.sqrt(segDx * segDx + segDz * segDz);
                
                if (segHorizontalDist > 0.1) {
                    // Apply catenary to this segment
                    const segmentSag = sagAmount * (segHorizontalDist / 5.0); // Scale sag by distance
                    const catenaryPoints = this.calculateCatenaryCurve(segmentStart, segmentEnd, segmentSag);
                    // Skip first point (already added) and add the rest
                    for (let j = 1; j < catenaryPoints.length; j++) {
                        saggedPoints.push(catenaryPoints[j]);
                    }
                } else {
                    // Very short segment - just add the end point
                    saggedPoints.push(segmentEnd.clone());
                }
            }
            
            return saggedPoints;
        }
        
        return points;
    }
}

/**
 * Factory function to create connection3D
 */
export function createConnection3D(connection2D, sourceNode3D, targetNode3D, coordinateMapper, wireRenderer) {
    return new Connection3D(connection2D, sourceNode3D, targetNode3D, coordinateMapper, wireRenderer);
}

// Connection3D class is already exported above with "export class Connection3D"
