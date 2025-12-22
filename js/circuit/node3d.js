/**
 * Node3D Module
 * Creates 3D mesh representations of circuit nodes (panels, batteries, controllers)
 */

/**
 * Base class for 3D node representations
 */
export class Node3D {
    constructor(node2D, coordinateMapper) {
        this.node2D = node2D;
        this.coordinateMapper = coordinateMapper;
        this.mesh = null;
        this.position3D = { x: 0, y: 0, z: 0 };
        this.syncEnabled = true; // Whether to sync with 2D position
        this.portHandles = []; // Array of 3D port handle meshes
    }
    
    /**
     * Update 3D position from 2D position
     */
    updateFromNode2D() {
        if (!this.syncEnabled || !this.node2D) return;
        
        const pos3D = this.coordinateMapper.position2Dto3D(
            this.node2D.x,
            this.node2D.y,
            0 // Ground level
        );
        
        this.position3D = pos3D;
        
        if (this.mesh) {
            this.mesh.position.set(pos3D.x, pos3D.y, pos3D.z);
        }
        
        // Update port handle group positions (they're positioned relative to node)
        // The handle groups are children of the node mesh, so they move/rotate with the node
        // We just need to update their relative positions if handle positions changed
        this.portHandles.forEach(handleGroup => {
            if (handleGroup && handleGroup.userData && handleGroup.userData.handleId) {
                // Use relative position method for child objects
                const getRelPos = this.getHandleRelativePosition3D || this.getHandlePosition3D;
                const handleRelPos = getRelPos.call(this, handleGroup.userData.handleId);
                if (handleRelPos) {
                    // Update relative position (handle groups are children of node mesh)
                    handleGroup.position.copy(handleRelPos);
                }
            }
        });
    }
    
    /**
     * Update 3D position directly
     */
    updatePosition(x, y, z) {
        this.position3D = { x, y, z };
        this.syncEnabled = false; // Disable sync when manually positioned
        
        if (this.mesh) {
            this.mesh.position.set(x, y, z);
        }
    }
    
    /**
     * Get the Three.js mesh
     */
    getMesh() {
        // Ensure mesh has node3D reference in userData
        if (this.mesh && this.mesh.userData) {
            this.mesh.userData.node3D = this;
        }
        return this.mesh;
    }
    
    /**
     * Get 3D position of a port handle (relative to node center, not world position)
     */
    getHandlePosition3D(handleId) {
        if (!this.node2D || !this.node2D.handles) return null;
        
        const handle = Object.values(this.node2D.handles).find(h => h.id === handleId);
        if (!handle) return null;
        
        // Default implementation: position relative to node center
        // Subclasses should override this for specific positioning
        const nodeWidthPx = this.node2D.width || 200;
        const nodeHeightPx = this.node2D.height || 200;
        const nodeWidth = nodeWidthPx / 1000; // Convert to meters
        const nodeHeight = nodeHeightPx / 1000;
        
        // Convert 2D handle position to 3D (relative to node center)
        // 2D coordinates: (0,0) is top-left, X increases right, Y increases down
        // 3D coordinates: (0,0,0) is node center, X increases right, Y increases up, Z increases forward
        let handleX = 0, handleY = 0, handleZ = 0.05; // Slightly in front of node
        
        // Check handle side for better positioning
        if (handle.side === 'top') {
            handleX = (handle.x - nodeWidthPx / 2) / 1000;
            handleY = nodeHeight / 2 + 0.01; // Above node
            handleZ = 0;
        } else if (handle.side === 'bottom') {
            handleX = (handle.x - nodeWidthPx / 2) / 1000;
            handleY = -nodeHeight / 2 - 0.01; // Below node
            handleZ = 0;
        } else if (handle.side === 'right') {
            handleX = nodeWidth / 2 + 0.01; // Right side
            handleY = -(handle.y - nodeHeightPx / 2) / 1000; // Invert Y (2D Y down = 3D Y up)
            handleZ = 0;
        } else if (handle.side === 'left') {
            handleX = -nodeWidth / 2 - 0.01; // Left side
            handleY = -(handle.y - nodeHeightPx / 2) / 1000; // Invert Y
            handleZ = 0;
        } else {
            // Default: use handle position relative to center
            handleX = (handle.x - nodeWidthPx / 2) / 1000;
            handleY = -(handle.y - nodeHeightPx / 2) / 1000; // Invert Y (2D Y down = 3D Y up)
            handleZ = 0.05; // Slightly in front
        }
        
        // Return relative position (not world position)
        return new THREE.Vector3(handleX, handleY, handleZ);
    }
    
    /**
     * Create visible port handles for 3D interaction
     */
    createPortHandles() {
        // Clear existing handles
        this.portHandles.forEach(handle => {
            if (handle.geometry) handle.geometry.dispose();
            if (handle.material) handle.material.dispose();
            if (this.mesh && this.mesh.parent) {
                this.mesh.parent.remove(handle);
            }
        });
        this.portHandles = [];
        
        if (!this.node2D || !this.node2D.handles || !this.mesh) return;
        
        // Create a handle for each port
        Object.values(this.node2D.handles).forEach(handle => {
            // Get handle position relative to node first (before creating meshes)
            // Use relative position method if available (for Panel3D), otherwise use world position
            const getRelPos = this.getHandleRelativePosition3D || this.getHandlePosition3D;
            const handleRelPos = getRelPos.call(this, handle.id);
            if (!handleRelPos) return; // Skip this handle if position can't be calculated
            
            // Determine handle color based on polarity
            let handleColor = 0x888888; // Default gray
            if (handle.polarity === 'positive' || handle.polarity === 'pv-positive') {
                handleColor = 0xd9534f; // Red
            } else if (handle.polarity === 'negative' || handle.polarity === 'pv-negative') {
                handleColor = 0x333333; // Dark gray/black
            } else if (handle.polarity === 'ac' || handle.polarity === 'load') {
                handleColor = 0xffd700; // Yellow for AC
            } else if (handle.polarity === 'parallel') {
                handleColor = 0x00a8e8; // Blue
            } else if (handle.polarity === 'smart-battery') {
                handleColor = 0x5cb85c; // Green
            }
            
            // Create a small sphere as a port handle with glow effect
            const handleRadius = 0.025; // 2.5cm radius (slightly larger for visibility)
            const handleGeometry = new THREE.SphereGeometry(handleRadius, 16, 16);
            
            // Main handle material with glow
            const handleMaterial = new THREE.MeshStandardMaterial({
                color: handleColor,
                emissive: handleColor,
                emissiveIntensity: 0.6, // Base glow intensity
                metalness: 0.9,
                roughness: 0.1
            });
            
            const handleMesh = new THREE.Mesh(handleGeometry, handleMaterial);
            handleMesh.position.set(0, 0, 0); // Position relative to group
            handleMesh.userData = {
                type: 'portHandle',
                handleId: handle.id,
                handle: handle,
                node3D: this,
                baseEmissiveIntensity: 0.6,
                hoverEmissiveIntensity: 1.2, // Brighter on hover
                isHovered: false
            };
            
            // Add outer glow sphere (larger, more transparent)
            const glowGeometry = new THREE.SphereGeometry(handleRadius * 1.5, 16, 16);
            const glowMaterial = new THREE.MeshBasicMaterial({
                color: handleColor,
                transparent: true,
                opacity: 0.3,
                side: THREE.BackSide // Render inside-out for glow effect
            });
            const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
            glowMesh.position.set(0, 0, 0); // Position relative to group
            glowMesh.userData = {
                type: 'portHandleGlow',
                parentHandle: handleMesh,
                baseOpacity: 0.3,
                hoverOpacity: 0.6
            };
            
            // Store glow mesh reference
            handleMesh.userData.glowMesh = glowMesh;
            
            // Create a group to hold both handle and glow
            const handleGroup = new THREE.Group();
            handleGroup.add(handleMesh);
            handleGroup.add(glowMesh);
            handleGroup.userData = {
                type: 'portHandleGroup',
                handleMesh: handleMesh,
                glowMesh: glowMesh,
                handleId: handle.id
            };
            
            // Position handle group relative to node center (not world position)
            handleGroup.position.copy(handleRelPos);
            
            // Add handle group as child of node mesh so it rotates/moves with the node
            // This ensures proper orientation and positioning
            if (this.mesh) {
                this.mesh.add(handleGroup);
            }
            
            // Also mark for scene addition (for raycasting - handles need to be in scene)
            handleGroup.userData.needsSceneAdd = true;
            
            this.portHandles.push(handleGroup);
        });
    }
    
    /**
     * Get all port handle meshes (returns handle groups)
     */
    getPortHandles() {
        return this.portHandles;
    }
    
    /**
     * Get all port handle mesh objects (for raycasting - returns the actual handle meshes, not groups)
     */
    getPortHandleMeshes() {
        const meshes = [];
        this.portHandles.forEach(handleGroup => {
            if (handleGroup && handleGroup.userData && handleGroup.userData.handleMesh) {
                meshes.push(handleGroup.userData.handleMesh);
            }
        });
        return meshes;
    }
    
    /**
     * Add port handles to scene (called when node is added to scene)
     * Note: Handles are already children of the node mesh, so they move/rotate with it
     * We just need to ensure they're in the scene for raycasting
     */
    addPortHandlesToScene(nodeGroup) {
        if (!nodeGroup) return;
        
        // Port handles are already children of the node mesh, so they're automatically
        // in the scene when the node is added. We just need to mark them as added.
        this.portHandles.forEach(handleGroup => {
            if (handleGroup && handleGroup.userData) {
                handleGroup.userData.needsSceneAdd = false;
            }
        });
    }
    
    /**
     * Remove port handles from scene
     */
    removePortHandlesFromScene(nodeGroup) {
        if (!nodeGroup) return;
        
        this.portHandles.forEach(handleGroup => {
            if (handleGroup && nodeGroup.children.includes(handleGroup)) {
                nodeGroup.remove(handleGroup);
                handleGroup.userData.needsSceneAdd = true;
            }
        });
    }
    
    /**
     * Dispose of resources
     */
    dispose() {
        // Dispose port handles
        this.portHandles.forEach(handle => {
            if (handle.geometry) handle.geometry.dispose();
            if (handle.material) handle.material.dispose();
            if (handle.parent) {
                handle.parent.remove(handle);
            }
        });
        this.portHandles = [];
        
        if (this.mesh) {
            if (this.mesh.geometry) this.mesh.geometry.dispose();
            if (this.mesh.material) {
                if (Array.isArray(this.mesh.material)) {
                    this.mesh.material.forEach(m => m.dispose());
                } else {
                    this.mesh.material.dispose();
                }
            }
        }
    }
}

/**
 * 3D representation of a solar panel
 */
export class Panel3D extends Node3D {
    constructor(node2D, coordinateMapper) {
        super(node2D, coordinateMapper);
        this.createMesh();
        this.updateFromNode2D();
        this.createPortHandles();
    }
    
    createMesh() {
        if (!this.node2D || !this.node2D.specs) return;
        
        // Create a group to hold all panel parts
        this.mesh = new THREE.Group();
        this.mesh.userData = { node2D: this.node2D, type: 'panel' };
        
        // If linked to LinkageLab panel, use its dimensions (in inches)
        if (this.node2D.linkedStructurePanel) {
            const linkedPanel = this.node2D.linkedStructurePanel;
            const INCHES_TO_METERS = 0.0254;
            
            // Use LinkageLab panel dimensions (width, thickness, length in inches)
            const width = (linkedPanel.width || 65) * INCHES_TO_METERS;  // Default ~65 inches
            const thickness = (linkedPanel.thickness || 1.5) * INCHES_TO_METERS;  // Default ~1.5 inches
            const length = (linkedPanel.length || 39) * INCHES_TO_METERS;  // Default ~39 inches
            
            // Create panel with linkage mode appearance: black sides, white back, reflective front
            // Front face - shiny reflective solar cells (glass-like)
            const frontMaterial = new THREE.MeshPhongMaterial({
                color: 0x1a3a5a, // Dark blue-black
                specular: 0x888899,
                shininess: 80,
                side: THREE.FrontSide
            });
            
            // Back face - matte white backsheet
            const backMaterial = new THREE.MeshLambertMaterial({
                color: 0xf5f5f5, // Off-white
                side: THREE.BackSide
            });
            
            // Edge material - dark aluminum frame
            const edgeMaterial = new THREE.MeshPhongMaterial({
                color: 0x404045, // Dark gray
                specular: 0x333333,
                shininess: 20
            });
            
            // Border material - black border
            const borderMaterial = new THREE.MeshLambertMaterial({
                color: 0x151518 // Very dark gray/black
            });
            
            // Create front face (larger, with border inset)
            // Panel lies in XZ plane (horizontal), front face faces +Y (up)
            const borderInset = 0.0127; // 0.5 inches in meters
            const frontGeometry = new THREE.PlaneGeometry(width - borderInset * 2, length - borderInset * 2);
            const frontFace = new THREE.Mesh(frontGeometry, frontMaterial);
            frontFace.position.set(0, thickness / 2, 0); // Position at top (Y = +thickness/2)
            frontFace.rotation.x = -Math.PI / 2; // Rotate from XY plane to XZ plane (face +Y)
            this.mesh.add(frontFace);
            
            // Create front border (4 strips around edges)
            const borderThickness = 0.001; // Thin border
            // Top border (along +Z edge)
            const topBorder = new THREE.Mesh(
                new THREE.PlaneGeometry(width, borderInset),
                borderMaterial
            );
            topBorder.position.set(0, thickness / 2, length / 2 - borderInset / 2);
            topBorder.rotation.x = -Math.PI / 2;
            this.mesh.add(topBorder);
            // Bottom border (along -Z edge)
            const bottomBorder = new THREE.Mesh(
                new THREE.PlaneGeometry(width, borderInset),
                borderMaterial
            );
            bottomBorder.position.set(0, thickness / 2, -length / 2 + borderInset / 2);
            bottomBorder.rotation.x = -Math.PI / 2;
            this.mesh.add(bottomBorder);
            // Left border (along -X edge)
            const leftBorder = new THREE.Mesh(
                new THREE.PlaneGeometry(borderInset, length - borderInset * 2),
                borderMaterial
            );
            leftBorder.position.set(-width / 2 + borderInset / 2, thickness / 2, 0);
            leftBorder.rotation.x = -Math.PI / 2;
            this.mesh.add(leftBorder);
            // Right border (along +X edge)
            const rightBorder = new THREE.Mesh(
                new THREE.PlaneGeometry(borderInset, length - borderInset * 2),
                borderMaterial
            );
            rightBorder.position.set(width / 2 - borderInset / 2, thickness / 2, 0);
            rightBorder.rotation.x = -Math.PI / 2;
            this.mesh.add(rightBorder);
            
            // Create back face (white)
            const backGeometry = new THREE.PlaneGeometry(width, length);
            const backFace = new THREE.Mesh(backGeometry, backMaterial);
            backFace.position.set(0, -thickness / 2, 0); // Position at bottom (Y = -thickness/2)
            backFace.rotation.x = -Math.PI / 2; // Rotate to XZ plane (face -Y)
            this.mesh.add(backFace);
            
            // Create edges (4 rectangular strips for the frame)
            // Panel is horizontal (XZ plane), edges run along perimeter
            const edgeThickness = 0.002; // Thin frame
            // Top edge (along +Z)
            const topEdge = new THREE.Mesh(
                new THREE.BoxGeometry(width, thickness, edgeThickness),
                edgeMaterial
            );
            topEdge.position.set(0, 0, length / 2);
            this.mesh.add(topEdge);
            // Bottom edge (along -Z)
            const bottomEdge = new THREE.Mesh(
                new THREE.BoxGeometry(width, thickness, edgeThickness),
                edgeMaterial
            );
            bottomEdge.position.set(0, 0, -length / 2);
            this.mesh.add(bottomEdge);
            // Left edge (along -X)
            const leftEdge = new THREE.Mesh(
                new THREE.BoxGeometry(edgeThickness, thickness, length),
                edgeMaterial
            );
            leftEdge.position.set(-width / 2, 0, 0);
            this.mesh.add(leftEdge);
            // Right edge (along +X)
            const rightEdge = new THREE.Mesh(
                new THREE.BoxGeometry(edgeThickness, thickness, length),
                edgeMaterial
            );
            rightEdge.position.set(width / 2, 0, 0);
            this.mesh.add(rightEdge);
            
            // Set shadow casting on all parts
            this.mesh.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
        } else {
            // Fallback to specs-based dimensions (in mm)
            const widthMm = this.node2D.specs.width || 1650;
            const heightMm = this.node2D.specs.height || 992;
            const thicknessMm = 40; // Typical panel thickness
            
            // Convert to meters
            const width = widthMm / 1000;
            const length = heightMm / 1000; // Height becomes length (Z direction - depth)
            const thickness = thicknessMm / 1000; // Thickness is Y direction (vertical)
            
            // Create panel with linkage mode appearance
            // Front face - shiny reflective solar cells
            const frontMaterial = new THREE.MeshPhongMaterial({
                color: 0x1a3a5a,
                specular: 0x888899,
                shininess: 80,
                side: THREE.FrontSide
            });
            
            // Back face - matte white backsheet
            const backMaterial = new THREE.MeshLambertMaterial({
                color: 0xf5f5f5,
                side: THREE.BackSide
            });
            
            // Edge material - dark aluminum frame
            const edgeMaterial = new THREE.MeshPhongMaterial({
                color: 0x404045,
                specular: 0x333333,
                shininess: 20
            });
            
            // Border material - black border
            const borderMaterial = new THREE.MeshLambertMaterial({
                color: 0x151518
            });
            
            // Create front face (with border inset)
            // Panel lies in XZ plane (horizontal), front face faces +Y (up)
            const borderInset = 0.0127; // 0.5 inches in meters
            const frontGeometry = new THREE.PlaneGeometry(width - borderInset * 2, length - borderInset * 2);
            const frontFace = new THREE.Mesh(frontGeometry, frontMaterial);
            frontFace.position.set(0, thickness / 2, 0); // Position at top (Y = +thickness/2)
            frontFace.rotation.x = -Math.PI / 2; // Rotate from XY plane to XZ plane (face +Y)
            this.mesh.add(frontFace);
            
            // Create front border strips
            const borderThickness = 0.001;
            // Top border (along +Z edge)
            const topBorder = new THREE.Mesh(
                new THREE.PlaneGeometry(width, borderInset),
                borderMaterial
            );
            topBorder.position.set(0, thickness / 2, length / 2 - borderInset / 2);
            topBorder.rotation.x = -Math.PI / 2;
            this.mesh.add(topBorder);
            // Bottom border (along -Z edge)
            const bottomBorder = new THREE.Mesh(
                new THREE.PlaneGeometry(width, borderInset),
                borderMaterial
            );
            bottomBorder.position.set(0, thickness / 2, -length / 2 + borderInset / 2);
            bottomBorder.rotation.x = -Math.PI / 2;
            this.mesh.add(bottomBorder);
            // Left border (along -X edge)
            const leftBorder = new THREE.Mesh(
                new THREE.PlaneGeometry(borderInset, length - borderInset * 2),
                borderMaterial
            );
            leftBorder.position.set(-width / 2 + borderInset / 2, thickness / 2, 0);
            leftBorder.rotation.x = -Math.PI / 2;
            this.mesh.add(leftBorder);
            // Right border (along +X edge)
            const rightBorder = new THREE.Mesh(
                new THREE.PlaneGeometry(borderInset, length - borderInset * 2),
                borderMaterial
            );
            rightBorder.position.set(width / 2 - borderInset / 2, thickness / 2, 0);
            rightBorder.rotation.x = -Math.PI / 2;
            this.mesh.add(rightBorder);
            
            // Create back face (white)
            const backGeometry = new THREE.PlaneGeometry(width, length);
            const backFace = new THREE.Mesh(backGeometry, backMaterial);
            backFace.position.set(0, -thickness / 2, 0); // Position at bottom (Y = -thickness/2)
            backFace.rotation.x = -Math.PI / 2; // Rotate to XZ plane (face -Y)
            this.mesh.add(backFace);
            
            // Create edges (frame)
            // Panel is horizontal (XZ plane), edges run along perimeter
            const edgeThickness = 0.002;
            // Top edge (along +Z)
            const topEdge = new THREE.Mesh(
                new THREE.BoxGeometry(width, thickness, edgeThickness),
                edgeMaterial
            );
            topEdge.position.set(0, 0, length / 2);
            this.mesh.add(topEdge);
            // Bottom edge (along -Z)
            const bottomEdge = new THREE.Mesh(
                new THREE.BoxGeometry(width, thickness, edgeThickness),
                edgeMaterial
            );
            bottomEdge.position.set(0, 0, -length / 2);
            this.mesh.add(bottomEdge);
            // Left edge (along -X)
            const leftEdge = new THREE.Mesh(
                new THREE.BoxGeometry(edgeThickness, thickness, length),
                edgeMaterial
            );
            leftEdge.position.set(-width / 2, 0, 0);
            this.mesh.add(leftEdge);
            // Right edge (along +X)
            const rightEdge = new THREE.Mesh(
                new THREE.BoxGeometry(edgeThickness, thickness, length),
                edgeMaterial
            );
            rightEdge.position.set(width / 2, 0, 0);
            this.mesh.add(rightEdge);
            
            // Set shadow casting on all parts
            this.mesh.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
        }
        
        // Add subtle grid pattern to represent cells (only on front face)
        this.addCellPattern();
    }
    
    /**
     * Get RELATIVE position of a port handle (relative to panel center)
     * Used for positioning port handle meshes which are children of the panel mesh
     */
    getHandleRelativePosition3D(handleId) {
        if (!this.node2D || !this.node2D.handles) return null;
        
        const handle = Object.values(this.node2D.handles).find(h => h.id === handleId);
        if (!handle) return null;
        
        // For panels linked to structure, use LinkageLab panel dimensions
        let panelWidth, panelLength, panelThickness;
        if (this.node2D.linkedStructurePanel) {
            const linkedPanel = this.node2D.linkedStructurePanel;
            const INCHES_TO_METERS = 0.0254;
            panelWidth = (linkedPanel.width || 65) * INCHES_TO_METERS;
            panelLength = (linkedPanel.length || 39.1) * INCHES_TO_METERS;
            panelThickness = (linkedPanel.thickness || 1.5) * INCHES_TO_METERS;
        } else {
            // Fallback to specs
            const widthMm = this.node2D.specs?.width || 1650;
            const heightMm = this.node2D.specs?.height || 992;
            panelWidth = widthMm / 1000;
            panelLength = heightMm / 1000;
            panelThickness = 0.04; // 40mm typical
        }
        
        // Panel is horizontal (XZ plane), front face faces +Y (up)
        // Handles are typically on the edges or corners
        let handleX = 0, handleY = 0, handleZ = 0;
        
        // Check handle side for positioning
        if (handle.side === 'left') {
            // Left edge (-X)
            handleX = -panelWidth / 2;
            handleY = panelThickness / 2; // On top surface
            handleZ = 0; // Center along length
        } else if (handle.side === 'right') {
            // Right edge (+X)
            handleX = panelWidth / 2;
            handleY = panelThickness / 2; // On top surface
            handleZ = 0; // Center along length
        } else if (handle.side === 'top') {
            // Top edge (+Z)
            handleX = 0; // Center along width
            handleY = panelThickness / 2; // On top surface
            handleZ = panelLength / 2;
        } else if (handle.side === 'bottom') {
            // Bottom edge (-Z)
            handleX = 0; // Center along width
            handleY = panelThickness / 2; // On top surface
            handleZ = -panelLength / 2;
        } else {
            // Default: use handle position from 2D
            const nodeWidthPx = this.node2D.width || 200;
            const nodeHeightPx = this.node2D.height || 200;
            handleX = ((handle.x || 0) - nodeWidthPx / 2) / 1000;
            handleY = panelThickness / 2 + 0.01; // Slightly above panel surface
            handleZ = -((handle.y || 0) - nodeHeightPx / 2) / 1000; // Invert Y (2D Y down = 3D Z)
        }
        
        return new THREE.Vector3(handleX, handleY, handleZ);
    }
    
    /**
     * Get WORLD position of a port handle (for wire connections)
     * Returns the handle position transformed to world coordinates
     */
    getHandlePosition3D(handleId) {
        // Get relative position first
        const relPos = this.getHandleRelativePosition3D(handleId);
        if (!relPos) return null;
        
        // Transform relative position to world position
        if (this.mesh) {
            const panelWorldPos = new THREE.Vector3();
            const panelWorldQuat = new THREE.Quaternion();
            this.mesh.getWorldPosition(panelWorldPos);
            this.mesh.getWorldQuaternion(panelWorldQuat);
            
            // Clone to avoid modifying original
            const worldPos = relPos.clone();
            
            // Transform by rotation, then add world position
            worldPos.applyQuaternion(panelWorldQuat);
            worldPos.add(panelWorldPos);
            
            return worldPos;
        }
        
        // Fallback: return relative position if no mesh
        return relPos;
    }
    
    /**
     * Update 3D position from 2D position or LinkageLab panel data
     */
    updateFromNode2D() {
        // Phase 2: Use LinkageLab panel position if available
        if (this.node2D.linkedStructurePanel) {
            const linkedPanel = this.node2D.linkedStructurePanel;
            const INCHES_TO_METERS = 0.0254;
            
            // Get structure offsets to account for centering at origin and ground alignment
            const xOffset = (typeof window !== 'undefined' && window.structureXOffset) ? window.structureXOffset : 0;
            const yOffset = (typeof window !== 'undefined' && window.structureYOffset) ? window.structureYOffset : 0;
            const zOffset = (typeof window !== 'undefined' && window.structureZOffset) ? window.structureZOffset : 0;
            
            // Convert LinkageLab panel center from inches to meters and apply all offsets
            // This centers the structure at origin (0, 0, 0) with ground at y=0
            const pos3D = {
                x: linkedPanel.center.x * INCHES_TO_METERS + xOffset,
                y: linkedPanel.center.y * INCHES_TO_METERS + yOffset,
                z: linkedPanel.center.z * INCHES_TO_METERS + zOffset
            };
            
            this.position3D = pos3D;
            this.syncEnabled = false; // Disable 2D sync when using LinkageLab position
            
            if (this.mesh) {
                // Panel positions from LinkageLab are already in the final rotated coordinate system
                // (they already account for global rotation and grid rotation)
                // So we use them as-is - no additional rotation needed
                this.mesh.position.set(pos3D.x, pos3D.y, pos3D.z);
                
                // Apply orientation from axisX (the panel's local X-axis direction in world coords)
                // axisX tells us which direction the panel's width runs in world space
                // For horizontal panels, this is a rotation around Y-axis
                // For tilted panels, we first orient to normal, then rotate around it
                if (linkedPanel.normal && (linkedPanel.normal.x !== 0 || linkedPanel.normal.z !== 0 || linkedPanel.normal.y !== 1)) {
                    // For tilted/vertical panels: apply normal-based orientation
                    const up = new THREE.Vector3(0, 1, 0);
                    const normal = new THREE.Vector3(
                        linkedPanel.normal.x || 0,
                        linkedPanel.normal.y || 1,
                        linkedPanel.normal.z || 0
                    ).normalize();
                    
                    const quaternion = new THREE.Quaternion();
                    quaternion.setFromUnitVectors(up, normal);
                    this.mesh.quaternion.copy(quaternion);
                    
                    // Apply rotation around the normal axis to align with axisX
                    // Positive rotation aligns mesh X-axis with axisX direction
                    if (linkedPanel.rotation !== undefined && linkedPanel.rotation !== 0) {
                        const rotationQuat = new THREE.Quaternion();
                        rotationQuat.setFromAxisAngle(normal, linkedPanel.rotation);
                        this.mesh.quaternion.multiplyQuaternions(this.mesh.quaternion, rotationQuat);
                    }
                } else {
                    // For horizontal panels (normal pointing up): apply rotation around Y axis
                    // Positive rotation aligns mesh X-axis with axisX direction
                    // rotation = atan2(axisX.z, axisX.x) gives us the angle of axisX from +X
                    
                    // Reset rotation/quaternion first, then apply Y rotation
                    this.mesh.rotation.set(0, 0, 0);
                    if (linkedPanel.rotation !== undefined && linkedPanel.rotation !== 0) {
                        this.mesh.rotation.y = linkedPanel.rotation;
                    }
                    
                    // Panel is already horizontal (XZ plane), no need to flip around X
                    // The panel geometry is created in the correct orientation
                }
            }
        } else {
            // Fall back to normal 2D position mapping
            super.updateFromNode2D();
        }
    }
    
    addCellPattern() {
        // Add a subtle grid texture to represent solar cells
        // Grid should be on the front face of the vertical panel (facing +Z direction)
        const width = this.node2D.specs.width / 1000;
        const length = this.node2D.specs.height / 1000;
        
        const gridHelper = new THREE.GridHelper(
            width,
            length,
            0x3c5a7a,
            0x1a3a5a
        );
        gridHelper.material.opacity = 0.15;
        gridHelper.material.transparent = true;
        // Grid lies in XZ plane (horizontal), positioned on front face
        gridHelper.rotation.x = -Math.PI / 2; // Rotate to XZ plane
        gridHelper.position.y = 0.001; // Slightly above panel center (on front face)
        gridHelper.position.z = 0; // Center in Z
        
        // Add as child so it moves with the panel
        this.mesh.add(gridHelper);
    }
}

/**
 * 3D representation of a battery
 */
export class Battery3D extends Node3D {
    constructor(node2D, coordinateMapper) {
        super(node2D, coordinateMapper);
        this.createMesh();
        this.updateFromNode2D();
        this.createPortHandles();
    }
    
    createMesh() {
        if (!this.node2D || !this.node2D.specs) return;
        
        // Get dimensions from specs (in mm)
        const widthMm = this.node2D.specs.width || 200;
        const heightMm = this.node2D.specs.height || 300;
        const depthMm = 200; // Typical battery depth
        
        // Convert to meters
        const width = widthMm / 1000;
        const height = heightMm / 1000;
        const depth = depthMm / 1000;
        
        // Create box geometry with slightly rounded appearance
        const geometry = new THREE.BoxGeometry(width, height, depth);
        
        // Create material - dark gray/black for batteries
        const material = new THREE.MeshStandardMaterial({
            color: 0x2a2a2a,
            metalness: 0.2,
            roughness: 0.6
        });
        
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.userData = { node2D: this.node2D, type: 'battery' };
        
        // Add terminals on top
        this.addTerminals();
    }
    
    addTerminals() {
        const width = (this.node2D.specs.width || 200) / 1000;
        const height = (this.node2D.specs.height || 300) / 1000;
        
        // Positive terminal (red)
        const posTerminal = new THREE.Mesh(
            new THREE.CylinderGeometry(0.01, 0.01, 0.02, 16),
            new THREE.MeshStandardMaterial({ color: 0xcc0000, metalness: 0.8, roughness: 0.2 })
        );
        posTerminal.position.set(width * 0.25, height / 2 + 0.01, 0);
        this.mesh.add(posTerminal);
        
        // Negative terminal (black)
        const negTerminal = new THREE.Mesh(
            new THREE.CylinderGeometry(0.01, 0.01, 0.02, 16),
            new THREE.MeshStandardMaterial({ color: 0x000000, metalness: 0.8, roughness: 0.2 })
        );
        negTerminal.position.set(width * 0.75, height / 2 + 0.01, 0);
        this.mesh.add(negTerminal);
    }
}

/**
 * 3D representation of a charge controller
 */
export class Controller3D extends Node3D {
    constructor(node2D, coordinateMapper) {
        super(node2D, coordinateMapper);
        this.createMesh();
        this.updateFromNode2D();
        this.createPortHandles();
    }
    
    createMesh() {
        if (!this.node2D || !this.node2D.specs) return;
        
        // Get dimensions from specs (in mm)
        const widthMm = this.node2D.specs.width || 400;
        const heightMm = this.node2D.specs.height || 600;
        const depthMm = 100; // Typical controller depth
        
        // Convert to meters
        const width = widthMm / 1000;
        const height = heightMm / 1000;
        const depth = depthMm / 1000;
        
        // Create box geometry
        const geometry = new THREE.BoxGeometry(width, height, depth);
        
        // Create material - gray/silver for controllers
        const material = new THREE.MeshStandardMaterial({
            color: 0x4a4a4a,
            metalness: 0.3,
            roughness: 0.4
        });
        
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.userData = { node2D: this.node2D, type: 'controller' };
        
        // Add visual details
        this.addDetails();
    }
    
    addDetails() {
        const width = (this.node2D.specs.width || 400) / 1000;
        const height = (this.node2D.specs.height || 600) / 1000;
        const depth = 0.1;
        
        // Add a front panel (slightly inset)
        const frontPanel = new THREE.Mesh(
            new THREE.BoxGeometry(width * 0.95, height * 0.95, 0.01),
            new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.1, roughness: 0.8 })
        );
        frontPanel.position.set(0, 0, depth / 2 + 0.005);
        this.mesh.add(frontPanel);
        
        // Add connection ports on top (PV inputs)
        const mpptCount = this.node2D.specs.mpptCount || 1;
        for (let i = 0; i < mpptCount; i++) {
            const xPos = width * (-0.4 + (i * 0.8 / Math.max(1, mpptCount - 1)));
            
            // Positive port (red)
            const posPort = new THREE.Mesh(
                new THREE.CylinderGeometry(0.005, 0.005, 0.01, 8),
                new THREE.MeshStandardMaterial({ color: 0xcc0000 })
            );
            posPort.rotation.z = Math.PI / 2;
            posPort.position.set(xPos - 0.01, height / 2 + 0.005, 0);
            this.mesh.add(posPort);
            
            // Negative port (black)
            const negPort = new THREE.Mesh(
                new THREE.CylinderGeometry(0.005, 0.005, 0.01, 8),
                new THREE.MeshStandardMaterial({ color: 0x000000 })
            );
            negPort.rotation.z = Math.PI / 2;
            negPort.position.set(xPos + 0.01, height / 2 + 0.005, 0);
            this.mesh.add(negPort);
        }
    }
}

/**
 * 3D representation of an AC Load (appliance)
 */
export class ACLoad3D extends Node3D {
    constructor(node2D, coordinateMapper) {
        super(node2D, coordinateMapper);
        this.createMesh();
        this.updateFromNode2D();
        this.createPortHandles();
    }
    
    createMesh() {
        if (!this.node2D || !this.node2D.specs) return;
        
        this.mesh = new THREE.Group();
        this.mesh.userData = { node2D: this.node2D, type: 'acload' };
        
        const width = (this.node2D.width || 70) / 1000; // Convert to meters
        const height = (this.node2D.height || 55) / 1000;
        const depth = 0.08;
        
        // Main body - simple box
        const bodyGeometry = new THREE.BoxGeometry(width, height, depth);
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color: 0x4a4a4a,
            metalness: 0.3,
            roughness: 0.7
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.castShadow = true;
        body.receiveShadow = true;
        this.mesh.add(body);
        
        // Add icon/indicator on front
        const iconMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8
        });
        const iconGeometry = new THREE.PlaneGeometry(width * 0.6, height * 0.6);
        const icon = new THREE.Mesh(iconGeometry, iconMaterial);
        icon.position.set(0, 0, depth / 2 + 0.001);
        this.mesh.add(icon);
    }
}

/**
 * 3D representation of a Combiner
 */
export class Combiner3D extends Node3D {
    constructor(node2D, coordinateMapper) {
        super(node2D, coordinateMapper);
        this.createMesh();
        this.updateFromNode2D();
        this.createPortHandles();
    }
    
    createMesh() {
        if (!this.node2D || !this.node2D.specs) return;
        
        this.mesh = new THREE.Group();
        this.mesh.userData = { node2D: this.node2D, type: 'combiner' };
        
        const width = (this.node2D.width || 120) / 1000;
        const height = (this.node2D.height || 80) / 1000;
        const depth = 0.06;
        
        // Main body
        const bodyGeometry = new THREE.BoxGeometry(width, height, depth);
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color: 0x2a2a2a,
            metalness: 0.5,
            roughness: 0.4
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.castShadow = true;
        body.receiveShadow = true;
        this.mesh.add(body);
        
        // Add terminal strip on top
        const terminalCount = this.node2D.specs.inputCount || 4;
        for (let i = 0; i < terminalCount; i++) {
            const terminalX = (i - (terminalCount - 1) / 2) * (width / (terminalCount + 1));
            const terminalGeometry = new THREE.CylinderGeometry(0.005, 0.005, 0.01, 8);
            const terminalMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc });
            const terminal = new THREE.Mesh(terminalGeometry, terminalMaterial);
            terminal.rotation.z = Math.PI / 2;
            terminal.position.set(terminalX, height / 2 + 0.005, 0);
            this.mesh.add(terminal);
        }
    }
}

/**
 * 3D representation of an AC Breaker Panel
 */
export class BreakerPanel3D extends Node3D {
    constructor(node2D, coordinateMapper) {
        super(node2D, coordinateMapper);
        this.createMesh();
        this.updateFromNode2D();
        this.createPortHandles();
    }
    
    createMesh() {
        if (!this.node2D || !this.node2D.specs) return;
        
        this.mesh = new THREE.Group();
        this.mesh.userData = { node2D: this.node2D, type: 'breakerpanel' };
        
        const width = (this.node2D.width || 200) / 1000;
        const height = (this.node2D.height || 300) / 1000;
        const depth = 0.1;
        
        // Main panel box
        const panelGeometry = new THREE.BoxGeometry(width, height, depth);
        const panelMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            metalness: 0.3,
            roughness: 0.6
        });
        const panel = new THREE.Mesh(panelGeometry, panelMaterial);
        panel.castShadow = true;
        panel.receiveShadow = true;
        this.mesh.add(panel);
        
        // Front door (slightly inset)
        const doorGeometry = new THREE.BoxGeometry(width * 0.95, height * 0.95, 0.01);
        const doorMaterial = new THREE.MeshStandardMaterial({
            color: 0x2a2a2a,
            metalness: 0.4,
            roughness: 0.5
        });
        const door = new THREE.Mesh(doorGeometry, doorMaterial);
        door.position.set(0, 0, depth / 2 + 0.005);
        this.mesh.add(door);
        
        // Breaker switches (if breaker count is known)
        const breakerCount = this.node2D.specs.circuitCount || 8;
        for (let i = 0; i < breakerCount; i++) {
            const breakerY = height * 0.4 - (i * height * 0.8 / breakerCount);
            const breakerGeometry = new THREE.BoxGeometry(width * 0.3, height * 0.05, 0.01);
            const breakerMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 });
            const breaker = new THREE.Mesh(breakerGeometry, breakerMaterial);
            breaker.position.set(0, breakerY, depth / 2 + 0.01);
            this.mesh.add(breaker);
        }
    }
}

/**
 * 3D representation of an AC Outlet
 */
export class ACOutlet3D extends Node3D {
    constructor(node2D, coordinateMapper) {
        super(node2D, coordinateMapper);
        this.createMesh();
        this.updateFromNode2D();
        this.createPortHandles();
    }
    
    createMesh() {
        if (!this.node2D || !this.node2D.specs) return;
        
        this.mesh = new THREE.Group();
        this.mesh.userData = { node2D: this.node2D, type: 'acoutlet' };
        
        const width = (this.node2D.width || 50) / 1000;
        const height = (this.node2D.height || 70) / 1000;
        const depth = 0.03;
        
        // Wall plate
        const plateGeometry = new THREE.BoxGeometry(width, height, depth);
        const plateMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.1,
            roughness: 0.8
        });
        const plate = new THREE.Mesh(plateGeometry, plateMaterial);
        plate.castShadow = true;
        plate.receiveShadow = true;
        this.mesh.add(plate);
        
        // Outlet face (recessed)
        const outletGeometry = new THREE.BoxGeometry(width * 0.7, height * 0.5, 0.01);
        const outletMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            metalness: 0.2,
            roughness: 0.7
        });
        const outlet = new THREE.Mesh(outletGeometry, outletMaterial);
        outlet.position.set(0, 0, depth / 2 + 0.005);
        this.mesh.add(outlet);
        
        // Outlet slots (two vertical slots for 120V, or two horizontal + ground for 240V)
        const voltage = this.node2D.specs.voltage || 120;
        if (voltage === 120) {
            // Two vertical slots
            for (let i = 0; i < 2; i++) {
                const slotGeometry = new THREE.BoxGeometry(0.002, height * 0.3, 0.002);
                const slotMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
                const slot = new THREE.Mesh(slotGeometry, slotMaterial);
                slot.position.set((i - 0.5) * width * 0.2, 0, depth / 2 + 0.01);
                this.mesh.add(slot);
            }
        } else {
            // 240V: two horizontal slots
            for (let i = 0; i < 2; i++) {
                const slotGeometry = new THREE.BoxGeometry(width * 0.2, 0.002, 0.002);
                const slotMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
                const slot = new THREE.Mesh(slotGeometry, slotMaterial);
                slot.position.set(0, (i - 0.5) * height * 0.2, depth / 2 + 0.01);
                this.mesh.add(slot);
            }
        }
    }
}

/**
 * Factory function to create appropriate Node3D based on node type
 */
export function createNode3D(node2D, coordinateMapper) {
    if (!node2D || !coordinateMapper) return null;
    
    switch (node2D.type) {
        case 'panel':
            return new Panel3D(node2D, coordinateMapper);
        case 'battery':
            return new Battery3D(node2D, coordinateMapper);
        case 'controller':
            return new Controller3D(node2D, coordinateMapper);
        case 'acload':
            return new ACLoad3D(node2D, coordinateMapper);
        case 'combiner':
            return new Combiner3D(node2D, coordinateMapper);
        case 'breakerpanel':
            return new BreakerPanel3D(node2D, coordinateMapper);
        case 'acoutlet':
            return new ACOutlet3D(node2D, coordinateMapper);
        default:
            console.warn(`No 3D representation for node type: ${node2D.type}`);
            return null;
    }
}

// Classes are already exported individually above, no need to re-export
