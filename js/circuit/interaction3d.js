/**
 * 3D Interaction Handler Module
 * Handles mouse/touch interaction for selecting and dragging 3D nodes
 */

/**
 * Interaction3D Handler Class
 */
export class Interaction3D {
    constructor(scene3D, coordinateMapper, nodes3D, connections3D) {
        this.scene3D = scene3D;
        this.coordinateMapper = coordinateMapper;
        this.nodes3D = nodes3D; // Map of node2D.id -> Node3D
        this.connections3D = connections3D; // Map of connection2D.id -> Connection3D
        
        // Raycaster for mouse picking
        this.raycaster = null;
        this.mouse = new THREE.Vector2();
        
        // Dragging state
        this.isDragging = false;
        this.draggedNode3D = null;
        this.draggedWaypointHandle = null; // For dragging waypoint handles
        this.draggedPortHandle = null; // For dragging port handles to create wires
        this.dragPlane = null;
        this.dragOffset = new THREE.Vector3();
        this.dragStartTime = 0;
        this.dragStartPos = null;
        
        // Wire creation state
        this.wireCreationSource = null; // Source port handle when creating wire
        this.tempWireLine = null; // Temporary line showing wire being created
        
        // Selected node
        this.selectedNode3D = null;
        this.outlineMesh = null; // Outline mesh for selection highlight
        
        // Sync settings
        this.sync2D3D = false; // Whether to sync 2D positions when moving in 3D
        
        // Debug mode (set to true for debugging)
        this.debug = false;
        
        // Callbacks
        this.onNodeMoved = null; // Callback when node position changes
        this.onNodeSelected = null; // Callback when node is selected
        this.onWireSelected = null; // Callback when wire is selected
        this.onSync2D3DChanged = null; // Callback when sync setting changes
        this.onWireCreated = null; // Callback when wire is created between ports
        
        this.init();
    }
    
    init() {
        if (typeof THREE === 'undefined') {
            console.error('THREE.js not available for Interaction3D');
            return;
        }
        
        this.raycaster = new THREE.Raycaster();
        
        // Track if we disabled OrbitControls (so we can re-enable it)
        this.orbitControlsWasEnabled = true;
        
        // Setup mouse/touch event listeners
        // Use arrow functions to preserve 'this' context
        this.boundMouseDown = (e) => this.onMouseDown(e);
        this.boundMouseMove = (e) => this.onMouseMove(e);
        this.boundMouseUp = (e) => this.onMouseUp(e);
        this.boundClick = (e) => this.onClick(e);
        this.boundDblClick = (e) => this.onDblClick(e);
        this.boundTouchStart = (e) => this.onTouchStart(e);
        this.boundTouchMove = (e) => this.onTouchMove(e);
        this.boundTouchEnd = (e) => this.onTouchEnd(e);
        
        // Window-level mouseup to catch cases where mouse leaves canvas
        this.boundWindowMouseUp = (e) => {
            if (this.isDragging) {
                this.onMouseUp(e);
            }
        };
        
        if (this.scene3D && this.scene3D.canvas) {
            // Use capture phase for mousedown/mouseup to ensure our handlers run before OrbitControls
            this.scene3D.canvas.addEventListener('mousedown', this.boundMouseDown, { passive: false, capture: true });
            this.scene3D.canvas.addEventListener('mousemove', this.boundMouseMove, { passive: false });
            this.scene3D.canvas.addEventListener('mouseup', this.boundMouseUp, { passive: false, capture: true });
            this.scene3D.canvas.addEventListener('dblclick', this.boundDblClick, { passive: false });
            
            // Touch events
            this.scene3D.canvas.addEventListener('touchstart', this.boundTouchStart, { passive: false });
            this.scene3D.canvas.addEventListener('touchmove', this.boundTouchMove, { passive: false });
            this.scene3D.canvas.addEventListener('touchend', this.boundTouchEnd, { passive: false });
            
            // Window-level mouseup to ensure we catch mouseup even if mouse leaves canvas
            window.addEventListener('mouseup', this.boundWindowMouseUp);
            
            // Track Shift key for vertical movement
            this.boundKeyDown = (e) => this.onKeyDown(e);
            this.boundKeyUp = (e) => this.onKeyUp(e);
            window.addEventListener('keydown', this.boundKeyDown);
            window.addEventListener('keyup', this.boundKeyUp);
        }
        
        this.shiftPressed = false; // Track Shift key state
    }
    
    /**
     * Handle key down
     */
    onKeyDown(event) {
        if (event.key === 'Shift' || event.keyCode === 16) {
            this.shiftPressed = true;
        }
    }
    
    /**
     * Handle key up
     */
    onKeyUp(event) {
        if (event.key === 'Shift' || event.keyCode === 16) {
            this.shiftPressed = false;
        }
    }
    
    /**
     * Update mouse position from event
     */
    updateMousePosition(event) {
        if (!this.scene3D || !this.scene3D.canvas || !event) return;
        
        const rect = this.scene3D.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }
    
    /**
     * Get 3D position from mouse on a plane
     */
    get3DPositionOnPlane(event, planeY = 0) {
        if (!this.scene3D || !this.scene3D.camera) return null;
        
        // Update mouse position from event
        if (event) {
            this.updateMousePosition(event);
        }
        
        // Create a plane at the specified Y height (horizontal plane)
        const planeNormal = new THREE.Vector3(0, 1, 0);
        const planeConstant = -planeY;
        const plane = new THREE.Plane(planeNormal, planeConstant);
        
        // Update raycaster with current mouse position
        this.raycaster.setFromCamera(this.mouse, this.scene3D.camera);
        
        // Find intersection with plane
        const intersection = new THREE.Vector3();
        const result = this.raycaster.ray.intersectPlane(plane, intersection);
        
        if (result) {
            return intersection;
        }
        
        // Fallback: if plane intersection fails, project to plane using camera
        // This can happen if the ray is parallel to the plane
        return null;
    }
    
    /**
     * Find port handle under mouse cursor
     */
    getPortHandleUnderMouse() {
        if (!this.raycaster || !this.scene3D || !this.scene3D.camera || !this.scene3D.nodeGroup) {
            return null;
        }
        
        // Update raycaster with current mouse position
        this.raycaster.setFromCamera(this.mouse, this.scene3D.camera);
        
        // Raycast against the entire nodeGroup to find port handles
        // This will catch handles even if they're nested in groups
        const intersects = this.raycaster.intersectObjects([this.scene3D.nodeGroup], true); // true = recursive
        
        if (intersects.length > 0) {
            // Find the first intersection that is a port handle
            for (const intersect of intersects) {
                const obj = intersect.object;
                
                // Check if this is a port handle mesh
                if (obj.userData && obj.userData.type === 'portHandle') {
                    const handleMesh = obj;
                    const handleGroup = handleMesh.parent; // Parent group
                    const node3D = handleMesh.userData.node3D;
                    
                    if (node3D) {
                        return {
                            handle: handleMesh,
                            handleGroup: handleGroup,
                            node3D: node3D
                        };
                    }
                }
                
                // Also check if it's a glow mesh (parent will have the handle)
                if (obj.userData && obj.userData.type === 'portHandleGlow' && obj.userData.parentHandle) {
                    const handleMesh = obj.userData.parentHandle;
                    const handleGroup = handleMesh.parent;
                    const node3D = handleMesh.userData.node3D;
                    
                    if (node3D) {
                        return {
                            handle: handleMesh,
                            handleGroup: handleGroup,
                            node3D: node3D
                        };
                    }
                }
            }
        }
        
        return null;
    }
    
    /**
     * Update hover state for port handles
     */
    updatePortHandleHover() {
        const portHit = this.getPortHandleUnderMouse();
        
        // Reset all port handles to non-hovered state
        for (const node3D of this.nodes3D.values()) {
            if (node3D && node3D.getPortHandleMeshes) {
                const portHandleMeshes = node3D.getPortHandleMeshes();
                portHandleMeshes.forEach(handleMesh => {
                    const wasHovered = handleMesh.userData.isHovered;
                    handleMesh.userData.isHovered = false;
                    
                    // Update material if state changed
                    if (wasHovered && handleMesh.material) {
                        handleMesh.material.emissiveIntensity = handleMesh.userData.baseEmissiveIntensity;
                        if (handleMesh.userData.glowMesh && handleMesh.userData.glowMesh.material) {
                            handleMesh.userData.glowMesh.material.opacity = handleMesh.userData.glowMesh.userData.baseOpacity;
                        }
                    }
                });
            }
        }
        
        // Set hovered port handle to hovered state
        if (portHit && portHit.handle) {
            const handleMesh = portHit.handle;
            handleMesh.userData.isHovered = true;
            
            if (handleMesh.material) {
                handleMesh.material.emissiveIntensity = handleMesh.userData.hoverEmissiveIntensity;
            }
            
            if (handleMesh.userData.glowMesh && handleMesh.userData.glowMesh.material) {
                handleMesh.userData.glowMesh.material.opacity = handleMesh.userData.glowMesh.userData.hoverOpacity;
            }
        }
    }
    
    /**
     * Find waypoint handle under mouse cursor
     */
    getWaypointHandleUnderMouse() {
        if (!this.raycaster || !this.scene3D || !this.scene3D.camera) {
            return null;
        }
        
        // Update raycaster with current mouse position
        this.raycaster.setFromCamera(this.mouse, this.scene3D.camera);
        
        // Get all waypoint handles from connections
        const handles = [];
        const handleToConnection = new Map();
        
        for (const conn3D of this.connections3D.values()) {
            if (conn3D && conn3D.getWaypointHandles) {
                const waypointHandles = conn3D.getWaypointHandles();
                waypointHandles.forEach(handle => {
                    handles.push(handle);
                    handleToConnection.set(handle, conn3D);
                });
            }
        }
        
        // Find intersections
        const intersects = this.raycaster.intersectObjects(handles, false);
        
        if (intersects.length > 0) {
            return {
                handle: intersects[0].object,
                connection3D: handleToConnection.get(intersects[0].object)
            };
        }
        
        return null;
    }
    
    /**
     * Find node under mouse cursor
     */
    getNodeUnderMouse() {
        if (!this.raycaster || !this.scene3D || !this.scene3D.camera || !this.scene3D.nodeGroup) {
            return null;
        }
        
        // Update raycaster with current mouse position
        this.raycaster.setFromCamera(this.mouse, this.scene3D.camera);
        
        // Get all meshes from nodes3D
        const meshes = [];
        const meshToNode3D = new Map();
        
        for (const node3D of this.nodes3D.values()) {
            if (node3D && node3D.getMesh && node3D.getMesh()) {
                const mesh = node3D.getMesh();
                // Allow dragging panels, controllers, and batteries
                if (node3D.node2D && (
                    node3D.node2D.type === 'panel' || 
                    node3D.node2D.type === 'controller' || 
                    node3D.node2D.type === 'battery'
                )) {
                    meshes.push(mesh);
                    meshToNode3D.set(mesh, node3D);
                }
            }
        }
        
        // Find intersections
        const intersects = this.raycaster.intersectObjects(meshes, false);
        
        if (intersects.length > 0) {
            // Find the corresponding Node3D
            const hitMesh = intersects[0].object;
            return meshToNode3D.get(hitMesh) || null;
        }
        
        return null;
    }
    
    /**
     * Handle mouse down
     */
    onMouseDown(event) {
        if (!this.scene3D || !this.scene3D.canvas) return;
        
        // CRITICAL: Disable OrbitControls FIRST, before any other checks
        // This ensures OrbitControls doesn't process the event
        if (this.scene3D.controls) {
            this.orbitControlsWasEnabled = this.scene3D.controls.enabled;
            // Temporarily disable to check for port handles
            this.scene3D.controls.enabled = false;
        }
        
        this.updateMousePosition(event);
        
        // Check for port handle first (for wire creation) - highest priority
        const portHit = this.getPortHandleUnderMouse();
        if (portHit && portHit.handle) {
            const { handle, node3D } = portHit;
            
            // Start wire creation
            this.isDragging = true;
            this.draggedPortHandle = { handle, node3D };
            this.wireCreationSource = { 
                handle, 
                node3D, 
                handleId: handle.userData.handleId,
                handleGroup: portHit.handleGroup
            };
            this.dragStartTime = Date.now();
            
            // Get handle world position (handle is now a child of node mesh, so get world position)
            const handleWorldPos = new THREE.Vector3();
            if (portHit.handle) {
                // Get world position from the handle mesh (which is in a group that's a child of node mesh)
                portHit.handle.getWorldPosition(handleWorldPos);
            } else if (portHit.handleGroup) {
                portHit.handleGroup.getWorldPosition(handleWorldPos);
            } else {
                handleWorldPos.set(0, 0, 0);
            }
            
            // Create temporary wire line
            this.createTempWireLine(handleWorldPos);
            
            // CRITICAL: Prevent event from reaching camera controls
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            return false;
        }
        
        // Check for waypoint handle (lower priority than port handles)
        const waypointHit = this.getWaypointHandleUnderMouse();
        if (waypointHit) {
            const { handle, connection3D } = waypointHit;
            
            if (this.scene3D.controls) {
                this.orbitControlsWasEnabled = this.scene3D.controls.enabled;
                this.scene3D.controls.enabled = false;
            }
            
            this.isDragging = true;
            this.draggedWaypointHandle = { handle, connection3D, index: handle.userData.waypointIndex };
            this.dragStartTime = Date.now();
            
            const handlePos = handle.position;
            const clickPos3D = this.get3DPositionOnPlane(event, handlePos.y);
            
            if (clickPos3D) {
                this.dragOffset.set(
                    clickPos3D.x - handlePos.x,
                    0,
                    clickPos3D.z - handlePos.z
                );
                this.dragStartPos = clickPos3D.clone();
                this.dragStartMouseY = this.mouse.y;
                this.dragStartY = handlePos.y;
            } else {
                this.dragOffset.set(0, 0, 0);
            }
            
            event.preventDefault();
            event.stopPropagation();
            return false;
        }
        
        const node3D = this.getNodeUnderMouse();
        
        if (node3D) {
            // Check if user wants to drag (hold mouse down and move) vs just click
            // We'll only start dragging if mouse moves significantly
            this.potentialDragNode = node3D;
            this.potentialDragStartTime = Date.now();
            this.potentialDragStartPos = { x: event.clientX, y: event.clientY };
            
            // OrbitControls already disabled above, keep it disabled
            return;
        } else {
            // No node under mouse - re-enable OrbitControls
            if (this.scene3D.controls) {
                this.scene3D.controls.enabled = this.orbitControlsWasEnabled;
            }
        }
    }
    
    /**
     * Handle mouse move
     */
    onMouseMove(event) {
        if (!this.scene3D || !this.scene3D.canvas) return;
        
        this.updateMousePosition(event);
        
        // Update port handle hover state (if not dragging)
        if (!this.isDragging) {
            this.updatePortHandleHover();
        }
        
        // Check if we should start dragging a node (if mouse moved significantly)
        if (this.potentialDragNode && !this.isDragging) {
            const moveDistance = Math.sqrt(
                Math.pow(event.clientX - this.potentialDragStartPos.x, 2) +
                Math.pow(event.clientY - this.potentialDragStartPos.y, 2)
            );
            
            // Start dragging if mouse moved more than 5 pixels
            if (moveDistance > 5) {
                const node3D = this.potentialDragNode;
                
                // Now disable OrbitControls and start dragging
                if (this.scene3D.controls) {
                    this.orbitControlsWasEnabled = this.scene3D.controls.enabled;
                    this.scene3D.controls.enabled = false;
                }
                
                this.isDragging = true;
                this.draggedNode3D = node3D;
                this.dragStartTime = Date.now();
                
                // Calculate drag offset
                const nodePos = node3D.position3D;
                const clickPos3D = this.get3DPositionOnPlane(event, nodePos.y);
                
                if (clickPos3D) {
                    this.dragOffset.set(
                        clickPos3D.x - nodePos.x,
                        0,
                        clickPos3D.z - nodePos.z
                    );
                    this.dragStartPos = clickPos3D.clone();
                    this.dragStartMouseY = this.mouse.y;
                    this.dragStartY = nodePos.y;
                } else {
                    this.dragOffset.set(0, 0, 0);
                }
                
                // Visual feedback: highlight selected node
                this.selectNode(node3D);
                
                this.potentialDragNode = null; // Clear potential drag
            }
        }
        
        // Handle port handle dragging (wire creation)
        if (this.isDragging && this.draggedPortHandle) {
            const { handle, node3D } = this.draggedPortHandle;
            
            // Ensure OrbitControls stays disabled during drag
            if (this.scene3D.controls) {
                this.scene3D.controls.enabled = false;
            }
            
            // Get source position in world space
            const sourcePos = new THREE.Vector3();
            if (this.wireCreationSource && this.wireCreationSource.handleGroup) {
                this.wireCreationSource.handleGroup.getWorldPosition(sourcePos);
            } else if (handle) {
                handle.getWorldPosition(sourcePos);
            } else {
                sourcePos.set(0, 0, 0);
            }
            
            // Update temporary wire line to follow mouse
            const newPos3D = this.get3DPositionOnPlane(event, sourcePos.y);
            if (newPos3D && this.tempWireLine) {
                // Update temp wire line
                const points = [sourcePos, newPos3D];
                const curve = new THREE.CatmullRomCurve3(points);
                const geometry = new THREE.TubeGeometry(curve, 20, 0.005, 8, false);
                
                if (this.tempWireLine.geometry) {
                    this.tempWireLine.geometry.dispose();
                }
                this.tempWireLine.geometry = geometry;
            }
            
            event.preventDefault();
            event.stopPropagation();
            return false;
        }
        
        // Handle waypoint handle dragging
        if (this.isDragging && this.draggedWaypointHandle) {
            const { handle, connection3D, index } = this.draggedWaypointHandle;
            const handlePos = handle.position;
            let newX = handlePos.x;
            let newY = handlePos.y;
            let newZ = handlePos.z;
            
            if (this.shiftPressed) {
                // Shift pressed: move vertically
                const mouseDeltaY = this.mouse.y - (this.dragStartMouseY || 0);
                const worldDeltaY = -mouseDeltaY * 2;
                newY = (this.dragStartY !== undefined ? this.dragStartY : handlePos.y) + worldDeltaY;
                newY = Math.max(0, Math.min(5, newY));
            } else {
                // Normal drag: move on XZ plane
                const newPos3D = this.get3DPositionOnPlane(event, handlePos.y);
                
                if (newPos3D) {
                    newX = newPos3D.x - this.dragOffset.x;
                    newZ = newPos3D.z - this.dragOffset.z;
                }
            }
            
            // Update handle position
            handle.position.set(newX, newY, newZ);
            
            // Update connection waypoint
            if (connection3D && connection3D.updateWaypointFromHandle) {
                connection3D.updateWaypointFromHandle(index, handle.position);
            }
            
            event.preventDefault();
            event.stopPropagation();
            return false;
        }
        
        if (this.isDragging && this.draggedNode3D) {
            const nodePos = this.draggedNode3D.position3D;
            let newX = nodePos.x;
            let newY = nodePos.y;
            let newZ = nodePos.z;
            
            if (this.shiftPressed) {
                // Shift pressed: move vertically (Y axis)
                // Use mouse Y movement to control vertical position
                const mouseDeltaY = this.mouse.y - (this.dragStartMouseY || 0);
                // Scale mouse movement to world units (invert because screen Y is inverted)
                // Camera distance affects sensitivity, use a reasonable default
                const worldDeltaY = -mouseDeltaY * 2; // Adjust sensitivity as needed
                newY = (this.dragStartY !== undefined ? this.dragStartY : nodePos.y) + worldDeltaY;
                // Clamp Y to reasonable bounds (0 to 5 meters)
                newY = Math.max(0, Math.min(5, newY));
            } else {
                // Normal drag: move on XZ plane (ground)
                const newPos3D = this.get3DPositionOnPlane(event, nodePos.y);
                
                if (newPos3D) {
                    // Update node position (subtract drag offset)
                    newX = newPos3D.x - this.dragOffset.x;
                    newZ = newPos3D.z - this.dragOffset.z;
                }
            }
            
            // Update 3D position
            this.draggedNode3D.position3D.x = newX;
            this.draggedNode3D.position3D.y = newY;
            this.draggedNode3D.position3D.z = newZ;
            
            // Update mesh position
            if (this.draggedNode3D.mesh) {
                this.draggedNode3D.mesh.position.set(newX, newY, newZ);
            }
            
            // Disable 2D sync while dragging in 3D (unless sync is enabled)
            if (!this.sync2D3D) {
                this.draggedNode3D.syncEnabled = false;
            }
            
            // Update connections
            this.updateConnectionsForNode(this.draggedNode3D);
            
            // Callback
            if (this.onNodeMoved) {
                this.onNodeMoved(this.draggedNode3D);
            }
            
            if (this.debug && Date.now() - this.dragStartTime < 100) {
                // Log first few drag updates
                console.log('Dragging:', {
                    newPos: { x: newX.toFixed(2), y: newY.toFixed(2), z: newZ.toFixed(2) },
                    mouse: { x: this.mouse.x.toFixed(2), y: this.mouse.y.toFixed(2) }
                });
            }
            
            event.preventDefault();
            event.stopPropagation();
            return false;
        }
    }
    
    /**
     * Handle mouse up
     */
    onMouseUp(event) {
        // Handle wire creation completion
        if (this.isDragging && this.draggedPortHandle && this.wireCreationSource) {
            const targetPortHit = this.getPortHandleUnderMouse();
            
            if (targetPortHit && targetPortHit.node3D !== this.wireCreationSource.node3D) {
                // Check if ports can connect
                const sourceHandle = this.wireCreationSource.handle.userData.handle;
                const targetHandle = targetPortHit.handle.userData.handle;
                
                if (this.canConnectPorts(sourceHandle, targetHandle)) {
                    // Create wire connection
                    if (this.onWireCreated) {
                        this.onWireCreated({
                            sourceNode2D: this.wireCreationSource.node3D.node2D,
                            sourceHandleId: this.wireCreationSource.handleId,
                            targetNode2D: targetPortHit.node3D.node2D,
                            targetHandleId: targetPortHit.handle.userData.handleId
                        });
                    }
                }
            }
            
            // Clean up temporary wire line
            this.cleanupTempWireLine();
            this.wireCreationSource = null;
        }
        
        // Clear potential drag if we didn't actually drag
        if (this.potentialDragNode && !this.isDragging) {
            this.potentialDragNode = null;
            this.potentialDragStartPos = null;
        }
        
        if (this.isDragging) {
            const dragDuration = Date.now() - this.dragStartTime;
            
            if (this.debug) {
                console.log('Drag ended:', {
                    duration: dragDuration + 'ms',
                    nodeId: this.draggedNode3D?.node2D?.id,
                    waypointHandle: this.draggedWaypointHandle ? 'yes' : 'no',
                    portHandle: this.draggedPortHandle ? 'yes' : 'no'
                });
            }
            
            this.isDragging = false;
            this.draggedNode3D = null;
            this.draggedWaypointHandle = null;
            this.draggedPortHandle = null;
            this.dragOffset.set(0, 0, 0);
            this.dragStartPos = null;
            
            // Re-enable OrbitControls (restore previous state)
            if (this.scene3D && this.scene3D.controls) {
                this.scene3D.controls.enabled = this.orbitControlsWasEnabled;
                if (this.debug) {
                    console.log('OrbitControls re-enabled:', this.orbitControlsWasEnabled);
                }
            }
            
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
        } else {
            // If we disabled OrbitControls but didn't drag, re-enable it
            if (this.scene3D && this.scene3D.controls) {
                this.scene3D.controls.enabled = true;
                this.orbitControlsWasEnabled = true;
            }
        }
    }
    
    /**
     * Check if two ports can be connected
     */
    canConnectPorts(sourceHandle, targetHandle) {
        if (!sourceHandle || !targetHandle) return false;
        if (sourceHandle.id === targetHandle.id) return false;
        
        const sp = sourceHandle.polarity;
        const tp = targetHandle.polarity;
        
        // Define polarity groups
        const positives = ['positive', 'pv-positive'];
        const negatives = ['negative', 'pv-negative'];
        
        // PARALLEL connections (same polarity)
        if (positives.includes(sp) && positives.includes(tp)) return true;
        if (negatives.includes(sp) && negatives.includes(tp)) return true;
        
        // SERIES connections (opposite polarity)
        if (positives.includes(sp) && negatives.includes(tp)) return true;
        if (negatives.includes(sp) && positives.includes(tp)) return true;
        
        // AC connections
        if (sp === 'ac' && (tp === 'ac' || tp === 'load')) return true;
        if (tp === 'ac' && (sp === 'ac' || sp === 'load')) return true;
        if (sp === 'load' && tp === 'load') return true;
        
        // Parallel ports can connect to AC outputs
        if (sp === 'parallel' && tp === 'ac') return true;
        if (tp === 'parallel' && sp === 'ac') return true;
        
        // Smart battery ports
        if (sp === 'smart-battery' && tp === 'smart-battery') return true;
        
        return false;
    }
    
    /**
     * Create temporary wire line for wire creation
     */
    createTempWireLine(startPos) {
        const points = [startPos, startPos.clone()];
        const curve = new THREE.CatmullRomCurve3(points);
        const geometry = new THREE.TubeGeometry(curve, 20, 0.005, 8, false);
        const material = new THREE.MeshStandardMaterial({
            color: 0xffd700, // Yellow for AC
            metalness: 0.8,
            roughness: 0.2,
            emissive: 0xffd700,
            emissiveIntensity: 0.3
        });
        
        this.tempWireLine = new THREE.Mesh(geometry, material);
        if (this.scene3D && this.scene3D.connectionGroup) {
            this.scene3D.connectionGroup.add(this.tempWireLine);
        }
    }
    
    /**
     * Clean up temporary wire line
     */
    cleanupTempWireLine() {
        if (this.tempWireLine) {
            if (this.tempWireLine.geometry) {
                this.tempWireLine.geometry.dispose();
            }
            if (this.tempWireLine.material) {
                this.tempWireLine.material.dispose();
            }
            if (this.tempWireLine.parent) {
                this.tempWireLine.parent.remove(this.tempWireLine);
            }
            this.tempWireLine = null;
        }
    }
    
    /**
     * Handle click (no longer used for selection - kept for compatibility)
     */
    onClick(event) {
        // Click is now only used for waypoint handles
        // Selection moved to double-click
    }
    
    /**
     * Handle double-click (for selection)
     */
    onDblClick(event) {
        // Only handle double-click if we didn't drag
        if (!this.isDragging) {
            this.updateMousePosition(event);
            
            // First check for node selection
            const node3D = this.getNodeUnderMouse();
            if (node3D) {
                this.selectNode(node3D);
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            
            // Then check for wire/connection selection
            const connection3D = this.getConnectionUnderMouse();
            if (connection3D) {
                this.selectConnection(connection3D);
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            
            // Nothing under mouse - deselect
            this.deselectNode();
            event.preventDefault();
            event.stopPropagation();
        }
    }
    
    /**
     * Get connection (wire) under mouse cursor
     */
    getConnectionUnderMouse() {
        if (!this.scene3D || !this.scene3D.scene) return null;
        
        // Get all wire meshes from connections3D
        const wireMeshes = [];
        if (this.connections3D) {
            this.connections3D.forEach((conn3D, connId) => {
                const meshes = conn3D.getMeshes ? conn3D.getMeshes() : [];
                meshes.forEach(mesh => {
                    if (mesh) {
                        mesh.userData.connection3D = conn3D;
                        mesh.userData.connectionId = connId;
                        wireMeshes.push(mesh);
                    }
                });
            });
        }
        
        if (wireMeshes.length === 0) return null;
        
        // Raycast against wire meshes
        this.raycaster.setFromCamera(this.mouse, this.scene3D.camera);
        const intersects = this.raycaster.intersectObjects(wireMeshes, true);
        
        if (intersects.length > 0) {
            // Find the connection3D for the intersected mesh
            let mesh = intersects[0].object;
            while (mesh && !mesh.userData?.connection3D) {
                mesh = mesh.parent;
            }
            if (mesh && mesh.userData?.connection3D) {
                return mesh.userData.connection3D;
            }
        }
        
        return null;
    }
    
    /**
     * Select a connection (wire)
     */
    selectConnection(connection3D) {
        if (this.onWireSelected && connection3D.connection2D) {
            this.onWireSelected(connection3D.connection2D);
        }
    }
    
    /**
     * Handle touch start
     */
    onTouchStart(event) {
        if (event.touches.length === 1) {
            // Convert touch to mouse event
            const touch = event.touches[0];
            const mouseEvent = new MouseEvent('mousedown', {
                clientX: touch.clientX,
                clientY: touch.clientY,
                bubbles: true
            });
            this.onMouseDown(mouseEvent);
        }
    }
    
    /**
     * Handle touch move
     */
    onTouchMove(event) {
        if (event.touches.length === 1 && this.isDragging) {
            const touch = event.touches[0];
            const mouseEvent = new MouseEvent('mousemove', {
                clientX: touch.clientX,
                clientY: touch.clientY,
                bubbles: true
            });
            this.onMouseMove(mouseEvent);
            event.preventDefault();
        }
    }
    
    /**
     * Handle touch end
     */
    onTouchEnd(event) {
        if (event.touches.length === 0) {
            const mouseEvent = new MouseEvent('mouseup', {
                bubbles: true
            });
            this.onMouseUp(mouseEvent);
        }
    }
    
    /**
     * Create outline mesh for selection highlight
     */
    createOutlineMesh(mesh) {
        if (!mesh || !mesh.geometry) return null;
        
        // Create a slightly larger copy of the geometry for outline
        const outlineGeometry = mesh.geometry.clone();
        const outlineMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ffff, // Cyan outline
            side: THREE.BackSide, // Render back faces only
            transparent: true,
            opacity: 0.5
        });
        
        const outlineMesh = new THREE.Mesh(outlineGeometry, outlineMaterial);
        outlineMesh.scale.multiplyScalar(1.05); // Slightly larger than original
        outlineMesh.position.copy(mesh.position);
        outlineMesh.rotation.copy(mesh.rotation);
        
        return outlineMesh;
    }
    
    /**
     * Select a node (visual feedback)
     */
    selectNode(node3D) {
        // Deselect previous
        this.deselectNode();
        
        this.selectedNode3D = node3D;
        
        // Visual feedback: add outline and glow
        if (node3D && node3D.mesh) {
            // Store original scale
            node3D.mesh.userData.originalScale = node3D.mesh.scale.clone();
            
            // Add subtle scale increase
            node3D.mesh.scale.multiplyScalar(1.05);
            
            // Add outline mesh
            this.outlineMesh = this.createOutlineMesh(node3D.mesh);
            if (this.outlineMesh && this.scene3D && this.scene3D.nodeGroup) {
                this.scene3D.nodeGroup.add(this.outlineMesh);
            }
            
            // Add emissive glow to material if it's a standard material
            if (node3D.mesh.material && !Array.isArray(node3D.mesh.material)) {
                node3D.mesh.userData.originalEmissive = node3D.mesh.material.emissive
                    ? node3D.mesh.material.emissive.clone()
                    : new THREE.Color(0x000000);
                node3D.mesh.userData.originalEmissiveIntensity = node3D.mesh.material.emissiveIntensity || 0;
                
                if (node3D.mesh.material.emissive !== undefined) {
                    node3D.mesh.material.emissive.setHex(0x00ffff);
                    node3D.mesh.material.emissiveIntensity = 0.3;
                }
            }
        }
        
        // Callback
        if (this.onNodeSelected) {
            this.onNodeSelected(node3D);
        }
    }
    
    /**
     * Deselect current node
     */
    deselectNode() {
        if (this.selectedNode3D && this.selectedNode3D.mesh) {
            // Restore original scale
            if (this.selectedNode3D.mesh.userData.originalScale) {
                this.selectedNode3D.mesh.scale.copy(this.selectedNode3D.mesh.userData.originalScale);
                delete this.selectedNode3D.mesh.userData.originalScale;
            }
            
            // Restore original emissive properties
            if (this.selectedNode3D.mesh.userData.originalEmissive !== undefined) {
                if (this.selectedNode3D.mesh.material && !Array.isArray(this.selectedNode3D.mesh.material)) {
                    if (this.selectedNode3D.mesh.material.emissive !== undefined) {
                        this.selectedNode3D.mesh.material.emissive.copy(this.selectedNode3D.mesh.userData.originalEmissive);
                        this.selectedNode3D.mesh.material.emissiveIntensity = this.selectedNode3D.mesh.userData.originalEmissiveIntensity;
                    }
                }
                delete this.selectedNode3D.mesh.userData.originalEmissive;
                delete this.selectedNode3D.mesh.userData.originalEmissiveIntensity;
            }
        }
        
        // Remove outline mesh
        if (this.outlineMesh) {
            if (this.scene3D && this.scene3D.nodeGroup) {
                this.scene3D.nodeGroup.remove(this.outlineMesh);
            }
            if (this.outlineMesh.geometry) this.outlineMesh.geometry.dispose();
            if (this.outlineMesh.material) this.outlineMesh.material.dispose();
            this.outlineMesh = null;
        }
        
        this.selectedNode3D = null;
    }
    
    /**
     * Set sync 2D/3D positions toggle
     */
    setSync2D3D(enabled) {
        this.sync2D3D = enabled;
        if (this.onSync2D3DChanged) {
            this.onSync2D3DChanged(enabled);
        }
    }
    
    /**
     * Get sync 2D/3D positions toggle state
     */
    getSync2D3D() {
        return this.sync2D3D;
    }
    
    /**
     * Update connections for a moved node
     */
    updateConnectionsForNode(node3D) {
        if (!node3D || !node3D.node2D) return;
        
        // Find all connections involving this node
        const nodeId = node3D.node2D.id;
        
        // Update all connections that involve this node
        for (const [connId, conn3D] of this.connections3D.entries()) {
            if (!conn3D || !conn3D.connection2D) continue;
            
            const conn2D = conn3D.connection2D;
            if (conn2D.sourceItemId === nodeId || conn2D.targetItemId === nodeId) {
                // Update this connection
                conn3D.update();
            }
        }
    }
    
    /**
     * Dispose of resources
     */
    dispose() {
        this.deselectNode();
        this.isDragging = false;
        this.draggedNode3D = null;
        this.selectedNode3D = null;
        
        // Clean up dragging state
        if (this.isDragging) {
            this.onMouseUp(null);
        }
        
        if (this.scene3D && this.scene3D.canvas) {
            this.scene3D.canvas.removeEventListener('mousedown', this.boundMouseDown);
            this.scene3D.canvas.removeEventListener('mousemove', this.boundMouseMove);
            this.scene3D.canvas.removeEventListener('mouseup', this.boundMouseUp);
            this.scene3D.canvas.removeEventListener('click', this.boundClick);
            this.scene3D.canvas.removeEventListener('touchstart', this.boundTouchStart);
            this.scene3D.canvas.removeEventListener('touchmove', this.boundTouchMove);
            this.scene3D.canvas.removeEventListener('touchend', this.boundTouchEnd);
        }
        
        // Remove window-level listener
        if (this.boundWindowMouseUp) {
            window.removeEventListener('mouseup', this.boundWindowMouseUp);
        }
        
        // Remove keyboard listeners
        if (this.boundKeyDown) {
            window.removeEventListener('keydown', this.boundKeyDown);
        }
        if (this.boundKeyUp) {
            window.removeEventListener('keyup', this.boundKeyUp);
        }
    }
}
