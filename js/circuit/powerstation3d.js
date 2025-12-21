/**
 * PowerStation3D Module
 * Creates a 3D representation of a grouped power station (IBC tank) in simulate mode
 * Groups controller, batteries, and distribution panel into a single 3D node
 */

/**
 * PowerStation3D Class
 * Represents a grouped power station as two stacked IBC tanks
 */
export class PowerStation3D {
    constructor(controllerNode2D, batteryNodes2D, breakerPanelNode2D, coordinateMapper, scene = null) {
        this.controllerNode2D = controllerNode2D;
        this.batteryNodes2D = batteryNodes2D || [];
        this.breakerPanelNode2D = breakerPanelNode2D;
        this.coordinateMapper = coordinateMapper;
        this.scene = scene; // Three.js scene for adding lights
        this.mesh = null;
        this.group = null; // THREE.Group containing all meshes
        this.position3D = { x: 0, y: 0, z: 0 };
        this.syncEnabled = true;
        
        // SOC glow effect
        this.glowMaterial = null;
        this.glowMesh = null;
        this.currentSOC = 0; // 0-1
        
        // Lighting effect
        this.batteryLight = null; // PointLight that illuminates the structure
        
        // Create the mesh
        this.createMesh();
        this.updateFromNodes2D();
    }
    
    /**
     * Create the IBC tank mesh (1m x 1m x 2m with rounded corners and cage)
     */
    createMesh() {
        if (typeof THREE === 'undefined') {
            console.error('THREE.js not available for PowerStation3D');
            return;
        }
        
        // Create a group to hold all meshes
        this.group = new THREE.Group();
        
        // IBC tank dimensions: 1m x 1m x 2m (two stacked tanks)
        const tankWidth = 1.0;  // 1 meter
        const tankDepth = 1.0;   // 1 meter
        const tankHeight = 1.0;  // 1 meter per tank
        const totalHeight = 2.0; // 2 meters total (two stacked)
        const cornerRadius = 0.05; // 5cm rounded corners
        const cageTubeDiameter = 0.025; // 25mm diameter for cage tubes (as per plan)
        const cageTubeRadius = cageTubeDiameter / 2;
        
        // Create two stacked tanks
        for (let i = 0; i < 2; i++) {
            const tankY = i * tankHeight;
            
            // Main tank body (rounded box)
            const tankGeometry = this.createRoundedBox(
                tankWidth,
                tankHeight,
                tankDepth,
                cornerRadius
            );
            
            const tankMaterial = new THREE.MeshStandardMaterial({
                color: 0x1a1a1a, // Darker for more realistic IBC tank
                metalness: 0.4,
                roughness: 0.6,
                envMapIntensity: 0.5
            });
            
            const tankMesh = new THREE.Mesh(tankGeometry, tankMaterial);
            tankMesh.position.y = tankY + tankHeight / 2;
            tankMesh.castShadow = true;
            tankMesh.receiveShadow = true;
            this.group.add(tankMesh);
            
            // Add cage frame around tank
            this.addCageFrame(tankWidth, tankHeight, tankDepth, tankY, cageTubeRadius);
        }
        
        // Create glow effect mesh inside cage (will be updated based on SOC)
        // Size matches the two stacked tank bodies
        this.createGlowMesh(tankWidth, totalHeight, tankDepth);
        
        // Create battery light that illuminates the structure
        this.createBatteryLight(tankWidth, totalHeight, tankDepth);
        
        // Add visual details: spigot/tap area on bottom tank
        this.addSpigotDetail(tankWidth, tankHeight, tankDepth, 0);
        
        // Set user data for identification
        this.group.userData = {
            type: 'powerstation',
            powerStation3D: this
        };
        
        // Ensure group is visible
        this.group.visible = true;
        
        this.mesh = this.group; // For compatibility with Node3D interface
        
        // Remove debug logging in production
        // console.log('PowerStation3D mesh created:', {
        //     group: this.group,
        //     children: this.group.children.length,
        //     visible: this.group.visible
        // });
    }
    
    /**
     * Create a rounded box geometry
     */
    createRoundedBox(width, height, depth, radius) {
        // For simplicity, use a regular box with beveled edges
        // A more accurate rounded box would require custom geometry or a library
        const geometry = new THREE.BoxGeometry(
            width - radius * 2,
            height - radius * 2,
            depth - radius * 2
        );
        
        // Add rounded corners using beveled edges
        // This is a simplified approach - for better rounded corners, consider using
        // THREE.ExtrudeGeometry or a library like three-rounded-box
        
        return geometry;
    }
    
    /**
     * Add spigot/tap detail to bottom tank (realistic IBC tank feature)
     */
    addSpigotDetail(width, height, depth, baseY) {
        const spigotMaterial = new THREE.MeshStandardMaterial({
            color: 0x444444, // Lighter metal for visibility
            metalness: 0.8,
            roughness: 0.2
        });
        
        // Spigot valve body (larger cylinder on front face for visibility)
        const spigotGeometry = new THREE.CylinderGeometry(0.04, 0.04, 0.12, 16);
        const spigot = new THREE.Mesh(spigotGeometry, spigotMaterial);
        spigot.rotation.z = Math.PI / 2; // Rotate to horizontal
        spigot.position.set(-width/4, baseY + height * 0.15, depth / 2 + 0.05); // Front face, lower left
        spigot.castShadow = true;
        this.group.add(spigot);
        
        // Spigot handle (larger box for visibility)
        const handleGeometry = new THREE.BoxGeometry(0.08, 0.03, 0.03);
        const handle = new THREE.Mesh(handleGeometry, spigotMaterial);
        handle.position.set(-width/4 + 0.05, baseY + height * 0.15, depth / 2 + 0.08);
        handle.castShadow = true;
        this.group.add(handle);
        
        // Add a label/plate area on front face
        const labelMaterial = new THREE.MeshStandardMaterial({
            color: 0x222222,
            metalness: 0.3,
            roughness: 0.7
        });
        const labelGeometry = new THREE.BoxGeometry(0.15, 0.1, 0.01);
        const label = new THREE.Mesh(labelGeometry, labelMaterial);
        label.position.set(width/4, baseY + height * 0.3, depth / 2 + 0.01);
        this.group.add(label);
    }
    
    /**
     * Add cage frame around tank (IBC tank cage effect with grid pattern)
     * Uses CylinderGeometry for tubes as specified in plan (~25mm diameter)
     * Creates a grid-like pattern similar to real IBC tanks
     */
    addCageFrame(width, height, depth, baseY, tubeRadius) {
        const cageMaterial = new THREE.MeshStandardMaterial({
            color: 0x888888, // Lighter gray for better visibility
            metalness: 0.95,
            roughness: 0.1,
            envMapIntensity: 1.2
        });
        
        // Vertical corner posts (4 corners) - using cylinders
        const postGeometry = new THREE.CylinderGeometry(tubeRadius, tubeRadius, height, 8);
        const cornerPositions = [
            [-width/2 + tubeRadius, baseY + height/2, -depth/2 + tubeRadius],
            [width/2 - tubeRadius, baseY + height/2, -depth/2 + tubeRadius],
            [-width/2 + tubeRadius, baseY + height/2, depth/2 - tubeRadius],
            [width/2 - tubeRadius, baseY + height/2, depth/2 - tubeRadius]
        ];
        
        cornerPositions.forEach(pos => {
            const post = new THREE.Mesh(postGeometry, cageMaterial);
            post.position.set(pos[0], pos[1], pos[2]);
            post.castShadow = true;
            this.group.add(post);
        });
        
        // Create grid pattern with multiple horizontal and vertical bars
        const barLength = width - tubeRadius * 2;
        const sideBarLength = depth - tubeRadius * 2;
        const barGeometry = new THREE.CylinderGeometry(tubeRadius, tubeRadius, barLength, 8);
        const sideBarGeometry = new THREE.CylinderGeometry(tubeRadius, tubeRadius, sideBarLength, 8);
        
        // Horizontal bars on front and back faces (create grid pattern)
        // Top, middle, and bottom frames
        const horizontalLevels = [
            baseY + tubeRadius,           // Bottom
            baseY + height * 0.33,       // Lower third
            baseY + height * 0.5,        // Middle (tank separation)
            baseY + height * 0.67,       // Upper third
            baseY + height - tubeRadius  // Top
        ];
        
        horizontalLevels.forEach(yPos => {
            // Front face bars
            const frontBar = new THREE.Mesh(barGeometry, cageMaterial);
            frontBar.position.set(0, yPos, -depth/2 + tubeRadius);
            frontBar.rotation.z = Math.PI / 2;
            frontBar.castShadow = true;
            this.group.add(frontBar);
            
            // Back face bars
            const backBar = new THREE.Mesh(barGeometry, cageMaterial);
            backBar.position.set(0, yPos, depth/2 - tubeRadius);
            backBar.rotation.z = Math.PI / 2;
            backBar.castShadow = true;
            this.group.add(backBar);
        });
        
        // Vertical bars on front and back faces (create grid pattern)
        const verticalPositions = [
            -width/3 + tubeRadius,  // Left third
            0,                       // Center
            width/3 - tubeRadius     // Right third
        ];
        
        verticalPositions.forEach(xPos => {
            // Front face vertical bars
            const frontVertBar = new THREE.Mesh(
                new THREE.CylinderGeometry(tubeRadius, tubeRadius, height - tubeRadius * 2, 8),
                cageMaterial
            );
            frontVertBar.position.set(xPos, baseY + height/2, -depth/2 + tubeRadius);
            frontVertBar.castShadow = true;
            this.group.add(frontVertBar);
            
            // Back face vertical bars
            const backVertBar = new THREE.Mesh(
                new THREE.CylinderGeometry(tubeRadius, tubeRadius, height - tubeRadius * 2, 8),
                cageMaterial
            );
            backVertBar.position.set(xPos, baseY + height/2, depth/2 - tubeRadius);
            backVertBar.castShadow = true;
            this.group.add(backVertBar);
        });
        
        // Horizontal bars on left and right sides
        horizontalLevels.forEach(yPos => {
            // Left side bars
            const leftBar = new THREE.Mesh(sideBarGeometry, cageMaterial);
            leftBar.position.set(-width/2 + tubeRadius, yPos, 0);
            leftBar.rotation.x = Math.PI / 2;
            leftBar.castShadow = true;
            this.group.add(leftBar);
            
            // Right side bars
            const rightBar = new THREE.Mesh(sideBarGeometry, cageMaterial);
            rightBar.position.set(width/2 - tubeRadius, yPos, 0);
            rightBar.rotation.x = Math.PI / 2;
            rightBar.castShadow = true;
            this.group.add(rightBar);
        });
        
        // Vertical bars on left and right sides (at middle depth)
        const sideVerticalPositions = [
            -depth/3 + tubeRadius,  // Front third
            0,                       // Center
            depth/3 - tubeRadius     // Back third
        ];
        
        sideVerticalPositions.forEach(zPos => {
            // Left side vertical bars (no rotation needed - cylinders are vertical by default)
            const leftVertBar = new THREE.Mesh(
                new THREE.CylinderGeometry(tubeRadius, tubeRadius, height - tubeRadius * 2, 8),
                cageMaterial
            );
            leftVertBar.position.set(-width/2 + tubeRadius, baseY + height/2, zPos);
            // No rotation - cylinder is already vertical
            leftVertBar.castShadow = true;
            this.group.add(leftVertBar);
            
            // Right side vertical bars (no rotation needed - cylinders are vertical by default)
            const rightVertBar = new THREE.Mesh(
                new THREE.CylinderGeometry(tubeRadius, tubeRadius, height - tubeRadius * 2, 8),
                cageMaterial
            );
            rightVertBar.position.set(width/2 - tubeRadius, baseY + height/2, zPos);
            // No rotation - cylinder is already vertical
            rightVertBar.castShadow = true;
            this.group.add(rightVertBar);
        });
    }
    
    /**
     * Create glow mesh that changes color and height based on SOC
     * Positioned inside the cage, acts as a vertical progress bar
     */
    createGlowMesh(width, height, depth) {
        // Slightly inset from cage to be clearly inside
        const inset = 0.02; // 2cm inset from cage
        const glowWidth = width - inset * 2;
        const glowDepth = depth - inset * 2;
        const maxGlowHeight = height - inset * 2; // Maximum height (full SOC)
        
        // Create glow mesh - height will be updated based on SOC
        // Start with minimum height (will grow as SOC increases)
        const glowGeometry = new THREE.BoxGeometry(
            glowWidth,
            0.01, // Start with minimal height
            glowDepth
        );
        
        this.glowMaterial = new THREE.MeshStandardMaterial({
            color: 0x00ff00, // Green (will be updated based on SOC)
            emissive: 0x00ff00,
            emissiveIntensity: 0.5,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide, // Render both sides for visibility
            blending: THREE.AdditiveBlending // Additive blending for glow effect
        });
        
        this.glowMesh = new THREE.Mesh(glowGeometry, this.glowMaterial);
        this.glowMesh.position.y = inset; // Start at bottom (will move up as height increases)
        this.glowMesh.renderOrder = 1; // Render in front of cage but behind other elements
        this.group.add(this.glowMesh);
        
        // Store dimensions for updating
        this.glowWidth = glowWidth;
        this.glowDepth = glowDepth;
        this.maxGlowHeight = maxGlowHeight;
        this.glowBaseY = inset;
    }
    
    /**
     * Create battery light that illuminates the structure at night
     */
    createBatteryLight(width, height, depth) {
        // Create a point light that emits from the battery
        // Position at center of battery (middle height)
        // Use higher intensity and longer range to illuminate the structure
        this.batteryLight = new THREE.PointLight(0x00ff00, 1.0, 100); // Green, initial intensity 1.0, range 100m
        this.batteryLight.position.set(0, height / 2, 0); // Center of battery (relative to group)
        this.batteryLight.castShadow = false; // Don't cast shadows (we have sun/moon for that)
        this.batteryLight.decay = 1.5; // Moderate decay for better range
        
        // Add light to the group so it moves with the power station
        // PointLights work when added to groups, but we'll update position manually for better control
        this.group.add(this.batteryLight);
        
        // Store reference for position updates
        this.lightLocalPosition = { x: 0, y: height / 2, z: 0 };
    }
    
    /**
     * Update glow based on battery SOC (0-1)
     * Updates both color and height (vertical progress bar effect)
     * Called every frame during simulation for smooth updates
     */
    updateSOC(soc) {
        const newSOC = Math.max(0, Math.min(1, soc));
        
        // Only update if SOC changed significantly (avoid unnecessary updates)
        if (Math.abs(newSOC - this.currentSOC) < 0.001 && this.currentSOC !== 0) {
            return;
        }
        
        this.currentSOC = newSOC;
        
        if (!this.glowMaterial || !this.glowMesh) return;
        
        // Update height based on SOC (vertical progress bar)
        const glowHeight = this.maxGlowHeight * this.currentSOC;
        const minHeight = 0.01; // Minimum visible height
        const actualHeight = Math.max(minHeight, glowHeight);
        
        // Update geometry with new height
        this.glowMesh.geometry.dispose();
        this.glowMesh.geometry = new THREE.BoxGeometry(
            this.glowWidth,
            actualHeight,
            this.glowDepth
        );
        
        // Position at bottom, centered vertically based on height
        this.glowMesh.position.y = this.glowBaseY + actualHeight / 2;
        
        // Color mapping per plan: red (<20%), yellow (20-50%), green (>50%)
        // Use smooth transitions between thresholds for better visual effect
        let color, intensity;
        
        if (this.currentSOC < 0.2) {
            // Red glow for SOC < 20%
            const t = this.currentSOC / 0.2; // 0 to 1 as SOC goes from 0% to 20%
            color = new THREE.Color(0xff0000); // Red
            intensity = 0.3 + t * 0.2; // More visible even at low SOC
        } else if (this.currentSOC < 0.5) {
            // Yellow glow for SOC 20-50%
            const t = (this.currentSOC - 0.2) / 0.3; // 0 to 1 as SOC goes from 20% to 50%
            color = new THREE.Color(0xffff00); // Yellow
            intensity = 0.5 + t * 0.3; // Moderate intensity
        } else {
            // Green glow for SOC > 50%
            const t = (this.currentSOC - 0.5) / 0.5; // 0 to 1 as SOC goes from 50% to 100%
            color = new THREE.Color(0x00ff00); // Green
            intensity = 0.8 + t * 0.4; // Higher intensity for high SOC
        }
        
        this.glowMaterial.color.copy(color);
        this.glowMaterial.emissive.copy(color);
        this.glowMaterial.emissiveIntensity = intensity;
        this.glowMaterial.opacity = 0.3 + intensity * 0.5; // More visible overall
        
        // Update battery light to match glow color and intensity
        if (this.batteryLight) {
            this.batteryLight.color.copy(color);
            // Light intensity scales with SOC
            // Base intensity: 0.3-1.2 depending on SOC (reduced for subtler effect)
            const baseIntensity = 0.3 + this.currentSOC * 0.9;
            
            // Check if it's night time (for stronger illumination)
            // Get current hour from window if available, or assume night
            let isNight = true; // Default to night for better visibility
            if (typeof window !== 'undefined' && typeof elapsedHours !== 'undefined') {
                const hourOfDay = elapsedHours % 24;
                isNight = hourOfDay < 6 || hourOfDay > 19; // Night is 7pm-6am
            }
            
            // Much less intense at night, almost invisible during day
            const nightMultiplier = isNight ? 1.2 : 0.1; // Subtle at night, barely visible during day
            
            this.batteryLight.intensity = baseIntensity * nightMultiplier;
            // Shorter range overall, slightly longer at night
            this.batteryLight.distance = isNight ? (40 + this.currentSOC * 30) : (20 + this.currentSOC * 10); // Range: 40-70m at night, 20-30m during day
        }
    }
    
    /**
     * Update position from 2D nodes (use controller position as reference)
     * NOTE: In simulate mode, position should be set directly via updatePosition() at structure center
     * This method is kept for compatibility but should not override manual positioning
     */
    updateFromNodes2D() {
        // If position was manually set (syncEnabled = false), don't override it
        if (!this.syncEnabled) return;
        
        // Only update from 2D if we don't have a structure center position
        // In simulate mode, we want to position at structure center, not 2D coordinates
        if (this.controllerNode2D && this.coordinateMapper) {
            const pos3D = this.coordinateMapper.position2Dto3D(
                this.controllerNode2D.x,
                this.controllerNode2D.y,
                0 // Ground level
            );
            
            this.position3D = pos3D;
            
            if (this.group) {
                this.group.position.set(pos3D.x, pos3D.y, pos3D.z);
            }
            
            // Update light position if it's in the scene separately
            if (this.batteryLight && this.scene && this.scene.children.includes(this.batteryLight)) {
                this.batteryLight.position.set(
                    pos3D.x,
                    pos3D.y + 1.0, // Center height of battery (1m up from base)
                    pos3D.z
                );
            }
        }
    }
    
    /**
     * Update position directly
     */
    updatePosition(x, y, z) {
        this.position3D = { x, y, z };
        this.syncEnabled = false;
        
        if (this.group) {
            this.group.position.set(x, y, z);
        }
    }
    
    /**
     * Get the Three.js mesh/group
     */
    getMesh() {
        return this.group;
    }
    
    /**
     * Get aggregated handles for connections
     * Returns handles for solar inputs (from controller) and AC outputs (from breaker panel)
     */
    getHandles() {
        const handles = {};
        
        // Solar inputs from controller
        if (this.controllerNode2D && this.controllerNode2D.handles) {
            // Get all PV input handles
            Object.values(this.controllerNode2D.handles).forEach(handle => {
                if (handle.polarity && (handle.polarity.includes('pv') || handle.polarity === 'pv-positive' || handle.polarity === 'pv-negative')) {
                    // Store by original handle ID for lookup
                    handles[handle.id] = {
                        ...handle,
                        aggregated: true,
                        sourceNode2D: this.controllerNode2D,
                        originalHandle: handle
                    };
                }
            });
        }
        
        // AC outputs from breaker panel
        if (this.breakerPanelNode2D && this.breakerPanelNode2D.handles) {
            // Get all AC output handles (typically 8 circuits)
            Object.values(this.breakerPanelNode2D.handles).forEach(handle => {
                if (handle.polarity === 'ac' || handle.polarity === 'output') {
                    // Store by original handle ID for lookup
                    handles[handle.id] = {
                        ...handle,
                        aggregated: true,
                        sourceNode2D: this.breakerPanelNode2D,
                        originalHandle: handle
                    };
                }
            });
        }
        
        return handles;
    }
    
    /**
     * Get 3D position of a handle on the PowerStation
     * Maps original handle ID to position on PowerStation mesh
     */
    getHandlePosition3D(originalHandleId) {
        if (typeof THREE === 'undefined') {
            return new THREE.Vector3(0, 0, 0);
        }
        
        // First, try to get position from actual port handle mesh (most accurate)
        if (this.getPortHandleMeshes) {
            const portHandleMeshes = this.getPortHandleMeshes();
            const portHandle = portHandleMeshes.find(h => h.userData && h.userData.handleId === originalHandleId);
            if (portHandle) {
                // Get world position from the port handle mesh
                const worldPos = new THREE.Vector3();
                portHandle.getWorldPosition(worldPos);
                return worldPos;
            }
        }
        
        // Fallback: calculate position based on handle data
        const handles = this.getHandles();
        let handle = handles[originalHandleId];
        
        if (!handle) {
            // Fallback: try to find handle in original nodes
            let originalHandle = null;
            let sourceNode = null;
            
            if (this.controllerNode2D && this.controllerNode2D.handles) {
                originalHandle = Object.values(this.controllerNode2D.handles).find(h => h.id === originalHandleId);
                if (originalHandle) sourceNode = this.controllerNode2D;
            }
            
            if (!originalHandle && this.breakerPanelNode2D && this.breakerPanelNode2D.handles) {
                originalHandle = Object.values(this.breakerPanelNode2D.handles).find(h => h.id === originalHandleId);
                if (originalHandle) sourceNode = this.breakerPanelNode2D;
            }
            
            if (!originalHandle || !sourceNode) {
                // Fallback to center of PowerStation
                return new THREE.Vector3(
                    this.position3D.x,
                    this.position3D.y + 1.0, // Middle height (1m up from base)
                    this.position3D.z
                );
            }
            
            // Use original handle data
            handle = originalHandle;
        } else {
            handle = handle.originalHandle || handle;
        }
        
        // PowerStation dimensions: 1m x 1m x 2m
        const width = 1.0;
        const height = 2.0;
        const depth = 1.0;
        
        // Position handles based on their original side and type
        let handleX = 0, handleY = 0, handleZ = 0;
        const sourceNode = handle.sourceNode2D || (handle.polarity && handle.polarity.includes('pv') ? this.controllerNode2D : this.breakerPanelNode2D);
        
        // Position connection points on cage frame exterior as specified in plan
        const cageOffset = 0.025; // Offset to position on cage frame (tube radius)
        
        if (handle.polarity && handle.polarity.includes('pv')) {
            // PV inputs: single input point on top of cage frame
            handleY = height + cageOffset; // On top of cage
            const nodeWidth = sourceNode ? (sourceNode.width || 400) : 400;
            // Distribute PV inputs along top edge of cage
            handleX = ((handle.x || 0) / nodeWidth) * (width - cageOffset * 2) - (width - cageOffset * 2) / 2;
            handleZ = 0; // Center depth
        } else if (handle.polarity === 'ac' || handle.polarity === 'output') {
            // AC outputs: 8 output points on front face of cage frame
            handleZ = depth / 2 + cageOffset; // On front face of cage
            const nodeHeight = sourceNode ? (sourceNode.height || 400) : 400;
            const nodeWidth = sourceNode ? (sourceNode.width || 200) : 200;
            // Distribute AC outputs vertically along front face
            handleY = height * 0.8 - ((handle.y || 0) / nodeHeight) * height * 0.6; // Upper portion
            handleX = ((handle.x || 0) / nodeWidth) * (width - cageOffset * 2) - (width - cageOffset * 2) / 2;
        } else {
            // Default: center of front face
            handleX = 0;
            handleY = height / 2;
            handleZ = depth / 2 + cageOffset;
        }
        
        return new THREE.Vector3(
            this.position3D.x + handleX,
            this.position3D.y + handleY,
            this.position3D.z + handleZ
        );
    }
    
    /**
     * Check if a node ID is part of this PowerStation
     */
    containsNode(nodeId) {
        if (this.controllerNode2D && this.controllerNode2D.id === nodeId) return true;
        if (this.breakerPanelNode2D && this.breakerPanelNode2D.id === nodeId) return true;
        return this.batteryNodes2D.some(b => b.id === nodeId);
    }
    
    /**
     * Dispose of resources
     */
    dispose() {
        if (this.group) {
            this.group.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        }
    }
}

/**
 * Factory function to create PowerStation3D
 */
export function createPowerStation3D(controllerNode2D, batteryNodes2D, breakerPanelNode2D, coordinateMapper) {
    return new PowerStation3D(controllerNode2D, batteryNodes2D, breakerPanelNode2D, coordinateMapper);
}
