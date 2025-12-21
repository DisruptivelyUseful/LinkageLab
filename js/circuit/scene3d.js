/**
 * 3D Scene Manager Module
 * Manages Three.js scene, camera, renderer, and view modes for circuit visualization
 */

/**
 * Scene3D Manager Class
 */
export class Scene3D {
    constructor(containerId, options = {}) {
        this.containerId = containerId;
        this.container = null;
        this.canvas = null;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.controls = null;
        this.initialized = false;
        
        // View mode: '2d', '3d', or 'split'
        this.viewMode = options.viewMode || '2d';
        
        // Groups for organizing 3D objects
        this.nodeGroup = null;
        this.connectionGroup = null;
        this.structureGroup = null; // For LinkageLab structure beams
        this.gridHelper = null;
        this.groundPlane = null; // Solid ground plane for shadows
        
        // Lighting
        this.ambientLight = null;
        this.directionalLight = null;
        this.moonLight = null; // Pale light from moon
        
        // Celestial objects
        this.moon = null;
        this.stars = null; // Stars group
        this.starParticles = null; // Particle system for stars
        this.northStar = null; // North Star (fixed point for rotation)
        this.northStarPosition = null; // Position of North Star
        this.starOriginalPositions = null; // Original star positions for rotation
        
        // Shadow settings
        this.shadowsEnabled = false;
        
        // Camera settings - much closer for circuit visualization
        this.cameraDistance = options.cameraDistance || 10; // Start close, will auto-adjust
        this.cameraPosition = { x: 0, y: 5, z: 10 };
        
        // Coordinate system: 1 meter = 120 pixels (matching 2D scale)
        this.scale = 120; // pixels per meter
    }
    
    /**
     * Initialize the 3D scene
     */
    init() {
        if (this.initialized || typeof THREE === 'undefined') {
            return false;
        }
        
        try {
            this.container = document.getElementById(this.containerId);
            if (!this.container) {
                console.error(`Container ${this.containerId} not found`);
                return false;
            }
            
            // Create canvas for 3D rendering
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'circuit-3d-canvas';
            this.canvas.style.position = 'absolute';
            this.canvas.style.top = '0';
            this.canvas.style.left = '0';
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.pointerEvents = 'auto';
            this.canvas.style.zIndex = '2';
            this.canvas.style.display = this.viewMode === '3d' || this.viewMode === 'split' ? 'block' : 'none';
            this.container.appendChild(this.canvas);
            
            // Create WebGL renderer
            this.renderer = new THREE.WebGLRenderer({
                canvas: this.canvas,
                antialias: true,
                alpha: false,
                logarithmicDepthBuffer: true
            });
            this.renderer.setPixelRatio(window.devicePixelRatio);
            this.renderer.setClearColor(0x15202b); // Match 2D background
            this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
            this.renderer.sortObjects = true;
            
            // Enable shadow map (will be toggled via setShadowsEnabled)
            this.renderer.shadowMap.enabled = false; // Start disabled
            this.renderer.shadowMap.type = THREE.PCFShadowMap; // Sharper shadows (PCF instead of PCFSoft)
            
            // Create scene
            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(0x15202b);
            
            // Create celestial objects (stars and moon) - will be positioned later
            // Note: These are created here but visibility/position updated in updateSkyAndCelestials
            this.createStars();
            this.createMoon();
            
            // Create camera - closer near plane for better precision
            // Far plane must be large enough to see celestial objects (moon, stars)
            const aspect = this.container.clientWidth / this.container.clientHeight;
            this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 10000);
            this.updateCameraPosition();
            
            // Setup OrbitControls if available
            // Check multiple possible locations for OrbitControls
            let OrbitControls = null;
            if (typeof THREE.OrbitControls !== 'undefined') {
                OrbitControls = THREE.OrbitControls;
            } else if (typeof OrbitControls !== 'undefined') {
                OrbitControls = window.OrbitControls;
            } else if (typeof THREE !== 'undefined' && THREE.OrbitControls) {
                OrbitControls = THREE.OrbitControls;
            }
            
            if (OrbitControls) {
                this.controls = new OrbitControls(this.camera, this.canvas);
                this.controls.enableDamping = true;
                this.controls.dampingFactor = 0.05;
                this.controls.minDistance = 0.5; // Can zoom in very close
                this.controls.maxDistance = 100; // Max zoom out
                this.controls.target.set(0, 0, 0);
                this.controls.update();
            } else {
                console.warn('OrbitControls not available - camera controls disabled. The scene will still work but without mouse controls.');
            }
            
            // Create object groups
            this.nodeGroup = new THREE.Group();
            this.connectionGroup = new THREE.Group();
            this.structureGroup = new THREE.Group();
            // Add structure group first so it renders behind nodes/connections
            this.scene.add(this.structureGroup);
            this.scene.add(this.nodeGroup);
            this.scene.add(this.connectionGroup);
            
            // Setup lighting
            this.setupLighting();
            
            // Create grid
            this.createGrid();
            
            // Create ground plane (hidden by default)
            this.createGroundPlane();
            
            // Handle window resize
            window.addEventListener('resize', () => this.handleResize());
            
            this.initialized = true;
            console.log('Scene3D initialized successfully');
            return true;
        } catch (e) {
            console.error('Failed to initialize Scene3D:', e);
            return false;
        }
    }
    
    /**
     * Setup lighting for the scene
     */
    setupLighting() {
        // Ambient light for overall illumination
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(this.ambientLight);
        
        // Directional light (sun) - configured for shadows
        this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        this.directionalLight.position.set(500, 1000, 500);
        this.directionalLight.castShadow = false; // Will be enabled when shadows are on
        
        // Configure shadow camera for directional light
        this.directionalLight.shadow.camera.left = -50;
        this.directionalLight.shadow.camera.right = 50;
        this.directionalLight.shadow.camera.top = 50;
        this.directionalLight.shadow.camera.bottom = -50;
        this.directionalLight.shadow.camera.near = 0.5;
        this.directionalLight.shadow.camera.far = 2000;
        // Higher resolution for sharper shadows
        this.directionalLight.shadow.mapSize.width = 4096;
        this.directionalLight.shadow.mapSize.height = 4096;
        // Reduced bias for sharper shadow edges
        this.directionalLight.shadow.bias = -0.00005;
        // Increase shadow radius for slightly softer but still sharp edges
        this.directionalLight.shadow.radius = 2;
        
        this.scene.add(this.directionalLight);
        
        // Hemisphere light for more natural lighting
        const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
        this.scene.add(hemisphereLight);
        
        // Moon light (pale, only active at night)
        this.moonLight = new THREE.DirectionalLight(0xaaaaff, 0.1); // Pale blue-white light
        this.moonLight.position.set(-500, 1000, -500);
        this.moonLight.castShadow = false; // Moon light doesn't cast shadows (too dim)
        this.moonLight.visible = false; // Hidden by default
        this.scene.add(this.moonLight);
    }
    
    /**
     * Create stars in the sky
     */
    createStars() {
        const starCount = 2000; // More stars for better visibility
        const starsGeometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];
        const originalPositions = []; // Store original positions for rotation
        
        // Get structure center for North Star positioning
        let structureCenter = { x: 0, y: 0, z: 0 };
        if (typeof window !== 'undefined' && window.getStructureCenter) {
            const sc = window.getStructureCenter();
            if (sc) {
                structureCenter = { x: sc.x || 0, y: sc.y || 0, z: sc.z || 0 };
            }
        }
        
        // Position North Star directly above structure center (centered rotation axis)
        const northStarY = structureCenter.y + 1800; // High above structure
        this.northStarPosition = new THREE.Vector3(
            structureCenter.x,
            northStarY,
            structureCenter.z
        );
        
        for (let i = 0; i < starCount; i++) {
            // Random position on a large sphere (sky dome) centered at origin
            // Only place stars in upper hemisphere (above horizon)
            const radius = 2000; // Within camera far plane (10000) but far enough for sky effect
            const theta = Math.random() * Math.PI * 2; // Azimuth (0 to 2π)
            const phi = Math.acos(Math.random()); // Elevation (0 to π/2 for upper hemisphere only)
            
            // Create star position relative to origin (centered coordinate system)
            const x = radius * Math.sin(phi) * Math.cos(theta);
            const y = radius * Math.sin(phi) * Math.sin(theta);
            const z = radius * Math.cos(phi);
            
            // Store original position relative to origin (for rotation around North Star)
            const starPos = new THREE.Vector3(x, y, z);
            originalPositions.push(starPos);
            
            // Initial position: translate to North Star position
            // Stars are positioned relative to North Star, which is above structure center
            positions.push(
                this.northStarPosition.x + x,
                this.northStarPosition.y + y,
                this.northStarPosition.z + z
            );
            
            // Random star color (mostly white, some blue/white, some yellow)
            const color = new THREE.Color();
            const colorChoice = Math.random();
            if (colorChoice < 0.7) {
                color.setHex(0xffffff); // White
            } else if (colorChoice < 0.9) {
                color.setHex(0xaaaaff); // Blue-white
            } else {
                color.setHex(0xffffaa); // Yellow-white
            }
            colors.push(color.r, color.g, color.b);
        }
        
        starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        starsGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        
        // Store original positions for rotation calculations
        this.starOriginalPositions = originalPositions;
        
        // Use PointsMaterial with better settings for visibility
        const starsMaterial = new THREE.PointsMaterial({
            size: 3, // Smaller, more realistic star size
            vertexColors: true,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: false, // Stars don't get smaller with distance (better visibility)
            fog: false, // Stars shouldn't be affected by fog
            depthWrite: false, // Prevent depth issues
            map: this.createStarTexture() // Custom texture for better star appearance
        });
        
        this.starParticles = new THREE.Points(starsGeometry, starsMaterial);
        this.starParticles.visible = false; // Hidden by default (only show at night)
        this.starParticles.renderOrder = 1000; // Render stars on top
        this.starParticles.frustumCulled = false; // Don't cull stars (they're always far away)
        this.scene.add(this.starParticles);
        
        // Create a visible North Star (brighter and larger)
        const northStarGeometry = new THREE.BufferGeometry();
        const northStarPositions = new Float32Array([
            this.northStarPosition.x,
            this.northStarPosition.y,
            this.northStarPosition.z
        ]);
        northStarGeometry.setAttribute('position', new THREE.BufferAttribute(northStarPositions, 3));
        const northStarColor = new THREE.Color(0xaaaaff); // Blue-white
        const northStarColors = new Float32Array([northStarColor.r, northStarColor.g, northStarColor.b]);
        northStarGeometry.setAttribute('color', new THREE.BufferAttribute(northStarColors, 3));
        
        const northStarMaterial = new THREE.PointsMaterial({
            size: 8, // Larger North Star
            vertexColors: true,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: false,
            fog: false,
            depthWrite: false,
            map: this.createStarTexture()
        });
        
        this.northStar = new THREE.Points(northStarGeometry, northStarMaterial);
        this.northStar.visible = false;
        this.northStar.renderOrder = 1001; // Render above other stars
        this.northStar.frustumCulled = false;
        this.scene.add(this.northStar);
    }
    
    /**
     * Create a custom texture for stars (bright point with glow)
     */
    createStarTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        
        // Create radial gradient for star glow
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }
    
    /**
     * Create moon in the sky
     */
    createMoon() {
        // Make moon larger and more visible
        const moonGeometry = new THREE.SphereGeometry(100, 32, 32); // Larger moon
        const moonMaterial = new THREE.MeshStandardMaterial({
            color: 0xf5f5f5,
            emissive: 0x888888, // Brighter emissive for visibility
            roughness: 0.7,
            metalness: 0.2,
            emissiveIntensity: 0.5
        });
        
        this.moon = new THREE.Mesh(moonGeometry, moonMaterial);
        this.moon.position.set(0, 2000, -800); // Start high in sky (within camera range)
        this.moon.visible = false; // Hidden by default
        this.moon.renderOrder = 100; // Render moon on top
        this.moon.frustumCulled = false; // Always render moon
        this.scene.add(this.moon);
        
        // Add a glow effect around the moon
        const glowGeometry = new THREE.SphereGeometry(90, 32, 32);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: 0xaaaaff,
            transparent: true,
            opacity: 0.2,
            side: THREE.BackSide
        });
        const moonGlow = new THREE.Mesh(glowGeometry, glowMaterial);
        moonGlow.renderOrder = 99;
        this.moon.add(moonGlow);
    }
    
    /**
     * Update sky and celestial objects based on time of day
     * @param {number} hours - Hour of day (0-24)
     */
    updateSkyAndCelestials(hours) {
        // Ensure hours is in valid range
        hours = hours % 24;
        if (hours < 0) hours += 24;
        
        // Update sky background color
        let skyColor;
        
        if (hours < 5 || hours > 21) {
            // Night (dark blue)
            skyColor = 0x0a1520;
        } else if (hours < 6) {
            // Dawn (dark to twilight)
            const t = hours - 5;
            const r = Math.round(10 + t * 20);
            const g = Math.round(21 + t * 20);
            const b = Math.round(32 + t * 30);
            skyColor = (r << 16) | (g << 8) | b;
        } else if (hours < 7) {
            // Sunrise (twilight to warm)
            const t = hours - 6;
            const r = Math.round(30 + t * 30);
            const g = Math.round(41 + t * 30);
            const b = Math.round(62 + t * 20);
            skyColor = (r << 16) | (g << 8) | b;
        } else if (hours < 18) {
            // Day (realistic sky blue)
            const noon = Math.abs(hours - 12) / 5;
            const brightness = 1 - noon * 0.15;
            // Realistic sky blue: RGB(135, 206, 250) = #87CEEB (Sky Blue)
            // Vary brightness throughout the day
            const r = Math.round(135 * brightness);
            const g = Math.round(206 * brightness);
            const b = Math.round(250 * brightness);
            skyColor = (r << 16) | (g << 8) | b;
        } else if (hours < 19) {
            // Sunset (warm to twilight)
            const t = hours - 18;
            const r = Math.round(60 - t * 30);
            const g = Math.round(63 - t * 22);
            const b = Math.round(80 - t * 18);
            skyColor = (r << 16) | (g << 8) | b;
        } else if (hours < 20) {
            // Dusk (twilight to dark)
            const t = hours - 19;
            const r = Math.round(30 - t * 15);
            const g = Math.round(41 - t * 15);
            const b = Math.round(62 - t * 25);
            skyColor = (r << 16) | (g << 8) | b;
        } else {
            // Late evening
            const t = hours - 20;
            const r = Math.round(15 - t * 5);
            const g = Math.round(26 - t * 5);
            const b = Math.round(37 - t * 17);
            skyColor = (r << 16) | (g << 8) | b;
        }
        
        this.scene.background = new THREE.Color(skyColor);
        
        // Determine time periods
        const isNight = hours < 6 || hours > 19;
        const isDawn = hours >= 5 && hours < 7;
        const isDusk = hours >= 18 && hours < 20;
        const isDay = hours >= 7 && hours < 18;
        
        // Update stars visibility and animation
        if (this.starParticles && this.starOriginalPositions) {
            const wasVisible = this.starParticles.visible;
            this.starParticles.visible = isNight;
            if (this.northStar) {
                this.northStar.visible = isNight;
            }
            
            if (isNight) {
                // Rotate stars around North Star (one full rotation per day)
                // Stars rotate opposite to sun (east to west)
                const rotationAngle = (hours / 24) * Math.PI * 2;
                
                // Update North Star position if structure center changed
                let structureCenter = { x: 0, y: 0, z: 0 };
                if (typeof window !== 'undefined' && window.getStructureCenter) {
                    const sc = window.getStructureCenter();
                    if (sc) {
                        structureCenter = { x: sc.x || 0, y: sc.y || 0, z: sc.z || 0 };
                    }
                }
                const northStarY = structureCenter.y + 1800;
                this.northStarPosition.set(
                    structureCenter.x,
                    northStarY,
                    structureCenter.z
                );
                
                // Rotate each star around the North Star (centered rotation axis)
                const positions = this.starParticles.geometry.attributes.position;
                const rotationAxis = new THREE.Vector3(0, 1, 0); // Rotate around Y axis (vertical)
                
                for (let i = 0; i < this.starOriginalPositions.length; i++) {
                    const originalPos = this.starOriginalPositions[i];
                    
                    // To rotate around the North Star (not the origin), we need to:
                    // 1. Translate star position to be relative to North Star's horizontal position
                    // 2. Rotate around Y axis (vertical axis)
                    // 3. Translate back
                    
                    // Get star's current world position
                    const currentWorldPos = new THREE.Vector3(
                        this.northStarPosition.x + originalPos.x,
                        this.northStarPosition.y + originalPos.y,
                        this.northStarPosition.z + originalPos.z
                    );
                    
                    // Translate to origin (relative to North Star's horizontal position)
                    const relativeToNorthStar = new THREE.Vector3(
                        currentWorldPos.x - this.northStarPosition.x,
                        currentWorldPos.y - this.northStarPosition.y,
                        currentWorldPos.z - this.northStarPosition.z
                    );
                    
                    // Rotate around Y axis (vertical axis through North Star)
                    relativeToNorthStar.applyAxisAngle(rotationAxis, rotationAngle);
                    
                    // Translate back to world position (centered rotation around North Star)
                    const worldPos = new THREE.Vector3(
                        this.northStarPosition.x + relativeToNorthStar.x,
                        this.northStarPosition.y + relativeToNorthStar.y,
                        this.northStarPosition.z + relativeToNorthStar.z
                    );
                    
                    positions.setXYZ(
                        i,
                        worldPos.x,
                        worldPos.y,
                        worldPos.z
                    );
                }
                positions.needsUpdate = true;
                
                // Update North Star position
                if (this.northStar) {
                    const northStarPos = this.northStar.geometry.attributes.position;
                    northStarPos.setXYZ(0, this.northStarPosition.x, this.northStarPosition.y, this.northStarPosition.z);
                    northStarPos.needsUpdate = true;
                }
                
                // Animate star opacity for twinkling effect
                const time = Date.now() * 0.001;
                const baseOpacity = 0.95;
                const twinkle = Math.sin(time * 0.5) * 0.1;
                const opacity = Math.max(0.7, Math.min(1.0, baseOpacity + twinkle));
                if (this.starParticles.material) {
                    this.starParticles.material.opacity = opacity;
                }
                if (this.northStar && this.northStar.material) {
                    this.northStar.material.opacity = opacity * 1.2; // North Star slightly brighter
                }
            } else if (wasVisible) {
                // Fade out stars when transitioning to day
                if (this.starParticles.material) {
                    this.starParticles.material.opacity = 0;
                }
                if (this.northStar && this.northStar.material) {
                    this.northStar.material.opacity = 0;
                }
            }
        }
        
        // Update moon position and visibility
        if (this.moon) {
            this.moon.visible = isNight || isDusk;
            
            if (this.moon.visible) {
                // Calculate moon position (arc across sky)
                // Moon rises in east (6pm/18:00), peaks at midnight (12am/0:00), sets in west (6am)
                // For hours 18-24: moonProgress goes from 0 to 1 (rising to peak)
                // For hours 0-6: moonProgress goes from 1 to 2 (peak to setting)
                let moonProgress;
                if (hours >= 18) {
                    // Evening to midnight: 18:00 -> 0.0, 24:00 -> 1.0
                    moonProgress = (hours - 18) / 6;
                } else if (hours < 6) {
                    // Midnight to dawn: 0:00 -> 1.0, 6:00 -> 2.0
                    moonProgress = 1 + (hours / 6);
                } else {
                    // Daytime: moon not visible, but keep calculation for smooth transition
                    moonProgress = 0;
                }
                
                // Normalize progress to 0-1 range for arc calculation
                const normalizedProgress = moonProgress % 2;
                const arcProgress = normalizedProgress > 1 ? 2 - normalizedProgress : normalizedProgress;
                
                // Moon moves in an arc: east (-X) -> overhead (+Y) -> west (+X)
                // Keep moon within camera far plane (10000) but far enough to look like sky
                // X: -1500 (east) to 0 (overhead) to +1500 (west)
                const moonX = -1500 + arcProgress * 3000;
                // Y: Arc from 1500 (horizon) to 2500 (peak) back to 1500 (horizon)
                const moonY = 1500 + Math.sin(arcProgress * Math.PI) * 1000;
                // Z: Keep moon at reasonable distance (behind scene)
                const moonZ = -800;
                
                this.moon.position.set(moonX, moonY, moonZ);
                
                // Update moon light position and intensity
                if (this.moonLight) {
                    this.moonLight.visible = isNight;
                    // Moon light comes from moon position (directional light points toward origin)
                    // Position light far from moon in the direction toward the scene
                    const lightDistance = 2000;
                    const directionToScene = new THREE.Vector3(-moonX, -moonY, -moonZ).normalize();
                    this.moonLight.position.set(
                        moonX + directionToScene.x * lightDistance,
                        moonY + directionToScene.y * lightDistance,
                        moonZ + directionToScene.z * lightDistance
                    );
                    // Moon light intensity varies (brighter when moon is higher)
                    const moonElevation = Math.max(0, (moonY - 2000) / 2000); // 0 at horizon, 1 at peak
                    this.moonLight.intensity = 0.15 + moonElevation * 0.2; // 0.15 to 0.35 (more visible)
                }
                
                // Moon opacity based on time
                const moonOpacity = isDusk ? 0.5 + (20 - hours) * 0.3 : 1.0;
                if (this.moon.material) {
                    this.moon.material.opacity = moonOpacity;
                    this.moon.material.transparent = moonOpacity < 1;
                }
                // Update moon glow opacity
                if (this.moon.children && this.moon.children.length > 0) {
                    const glow = this.moon.children[0];
                    if (glow && glow.material) {
                        glow.material.opacity = moonOpacity * 0.3;
                    }
                }
            } else {
                // Hide moon light when moon is not visible
                if (this.moonLight) {
                    this.moonLight.visible = false;
                }
            }
        }
    }
    
    /**
     * Create grid helper - smaller grid for circuit scale
     * Grid is positioned at y=0 (ground level)
     */
    createGrid() {
        const gridSize = 20; // meters (much smaller for circuit scale)
        const divisions = 20;
        this.gridHelper = new THREE.GridHelper(gridSize, divisions, 0x00f2ea, 0x00a8a0);
        this.gridHelper.material.opacity = 0.15;
        this.gridHelper.material.transparent = true;
        this.gridHelper.position.y = 0; // Always at ground level
        this.scene.add(this.gridHelper);
    }
    
    /**
     * Create solid ground plane for shadows
     */
    createGroundPlane() {
        if (this.groundPlane) {
            this.scene.remove(this.groundPlane);
            if (this.groundPlane.geometry) this.groundPlane.geometry.dispose();
            if (this.groundPlane.material) this.groundPlane.material.dispose();
        }
        
        // Create large ground plane at y=0
        const groundSize = 200; // Large enough for structure
        const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
        const groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x2d4a35, // Darker green grass color
            roughness: 0.9,
            metalness: 0.0
        });
        
        this.groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
        this.groundPlane.rotation.x = -Math.PI / 2; // Rotate to horizontal
        this.groundPlane.position.y = 0;
        this.groundPlane.receiveShadow = true; // Ground receives shadows
        this.groundPlane.visible = false; // Hidden by default (only shown when shadows enabled)
        
        this.scene.add(this.groundPlane);
    }
    
    /**
     * Enable or disable shadows
     */
    setShadowsEnabled(enabled) {
        this.shadowsEnabled = enabled;
        
        // Enable/disable shadow rendering
        this.renderer.shadowMap.enabled = enabled;
        
        // Enable/disable shadow casting on directional light
        if (this.directionalLight) {
            this.directionalLight.castShadow = enabled;
        }
        
        // Show/hide ground plane
        if (this.groundPlane) {
            this.groundPlane.visible = enabled;
        }
        
        // Show/hide grid helper (hide when shadows enabled)
        if (this.gridHelper) {
            this.gridHelper.visible = !enabled;
        }
        
        // Enable/disable shadows on all meshes in the scene
        this.updateShadowSettings();
        
        // Update sun position if shadows are enabled and we're in simulate mode
        if (enabled && typeof window !== 'undefined') {
            const currentMode = window.currentMode;
            if (currentMode === 'simulate') {
                const hourOfDay = typeof window.elapsedHours !== 'undefined' ? window.elapsedHours % 24 : 12;
                const dayOfYear = typeof window.currentDayOfYear !== 'undefined' ? window.currentDayOfYear : 172;
                const latitude = typeof window.simulationLatitude !== 'undefined' ? window.simulationLatitude : 40;
                
                if (typeof window.calculateSolarPosition === 'function') {
                    const solarPos = window.calculateSolarPosition(latitude, dayOfYear, hourOfDay);
                    if (solarPos && solarPos.elevation > 0) {
                        this.updateSunPosition(solarPos.elevation, solarPos.azimuth);
                    }
                }
            }
        }
    }
    
    /**
     * Update sun position based on solar elevation and azimuth angles
     * @param {number} elevation - Solar elevation angle in degrees (0 = horizon, 90 = zenith)
     * @param {number} azimuth - Solar azimuth angle in degrees (0 = North, 90 = East, 180 = South, 270 = West)
     */
    updateSunPosition(elevation, azimuth) {
        if (!this.directionalLight) return;
        
        // Convert angles to radians
        const elevRad = elevation * Math.PI / 180;
        const azimRad = azimuth * Math.PI / 180;
        
        // Calculate sun direction vector
        // In Three.js: X = East, Y = Up, Z = South (right-handed)
        // Azimuth: 0 = North, 90 = East, 180 = South, 270 = West
        // We need to convert from compass azimuth to Three.js coordinates
        // Compass: 0 = North, 90 = East, 180 = South, 270 = West
        // Three.js: 0 = +X (East), 90 = -Z (South)
        // So: Three.js azimuth = compass azimuth - 90 (convert North to East)
        const threeAzimRad = azimRad - Math.PI / 2;
        
        // Calculate direction vector from sun to origin
        // X = cos(elevation) * sin(azimuth) [East component]
        // Y = sin(elevation) [Up component]
        // Z = -cos(elevation) * cos(azimuth) [South component, negative because +Z is South]
        const distance = 1000; // Distance from origin for directional light
        const x = Math.cos(elevRad) * Math.sin(threeAzimRad) * distance;
        const y = Math.sin(elevRad) * distance;
        const z = -Math.cos(elevRad) * Math.cos(threeAzimRad) * distance;
        
        // Set light position (directional light position is where light comes FROM)
        this.directionalLight.position.set(x, y, z);
        
        // Update shadow camera to follow sun
        if (this.directionalLight.shadow) {
            // Adjust shadow camera to cover the scene from sun's perspective
            const shadowDistance = 100;
            this.directionalLight.shadow.camera.left = -shadowDistance;
            this.directionalLight.shadow.camera.right = shadowDistance;
            this.directionalLight.shadow.camera.top = shadowDistance;
            this.directionalLight.shadow.camera.bottom = -shadowDistance;
            this.directionalLight.shadow.camera.updateProjectionMatrix();
        }
    }
    
    /**
     * Update shadow settings on all meshes in the scene
     */
    updateShadowSettings() {
        const enabled = this.shadowsEnabled;
        
        // Update structure group
        if (this.structureGroup) {
            this.structureGroup.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = enabled;
                    child.receiveShadow = enabled;
                }
            });
        }
        
        // Update node group
        if (this.nodeGroup) {
            this.nodeGroup.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = enabled;
                    child.receiveShadow = enabled;
                }
            });
        }
        
        // Update connection group
        if (this.connectionGroup) {
            this.connectionGroup.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = enabled;
                    child.receiveShadow = enabled;
                }
            });
        }
    }
    
    /**
     * Position grid at structure center (if structure exists)
     * Grid should be at y=0 (ground level) for proper shadow rendering
     */
    positionGridAtStructureCenter(structureCenter) {
        if (this.gridHelper && structureCenter) {
            // Position grid at structure center X/Z, but always at y=0 (ground level)
            this.gridHelper.position.set(structureCenter.x, 0, structureCenter.z);
        }
    }
    
    /**
     * Toggle grid visibility
     */
    setGridVisible(visible) {
        if (this.gridHelper) {
            this.gridHelper.visible = visible;
        }
    }
    
    /**
     * Get grid visibility state
     */
    getGridVisible() {
        return this.gridHelper ? this.gridHelper.visible : false;
    }
    
    /**
     * Reset camera to default position
     */
    resetCamera() {
        if (!this.camera || !this.controls) return;
        
        // Reset to default position
        this.cameraDistance = 10;
        this.cameraPosition = { x: 0, y: 5, z: 10 };
        
        // Auto-fit to nodes if available
        this.fitCameraToNodes();
        
        // Reset controls target
        if (this.controls) {
            this.controls.target.set(0, 0, 0);
            this.controls.update();
        }
    }
    
    /**
     * Get camera state for persistence
     */
    getCameraState() {
        if (!this.camera || !this.controls) return null;
        
        return {
            position: {
                x: this.camera.position.x,
                y: this.camera.position.y,
                z: this.camera.position.z
            },
            target: {
                x: this.controls.target.x,
                y: this.controls.target.y,
                z: this.controls.target.z
            },
            distance: this.cameraDistance
        };
    }
    
    /**
     * Restore camera state from saved data
     */
    restoreCameraState(state) {
        if (!this.camera || !this.controls || !state) return;
        
        if (state.position) {
            this.camera.position.set(state.position.x, state.position.y, state.position.z);
        }
        
        if (state.target) {
            this.controls.target.set(state.target.x, state.target.y, state.target.z);
        }
        
        if (state.distance !== undefined) {
            this.cameraDistance = state.distance;
        }
        
        this.camera.updateProjectionMatrix();
        this.controls.update();
    }
    
    /**
     * Auto-adjust camera to fit all nodes and structure
     */
    fitCameraToNodes() {
        // Calculate bounds without cloning - use Box3.expandByPoint
        const box = new THREE.Box3();
        let hasObjects = false;
        
        // Expand box to include node group
        if (this.nodeGroup && this.nodeGroup.children.length > 0) {
            const nodeBox = new THREE.Box3();
            nodeBox.setFromObject(this.nodeGroup);
            if (!nodeBox.isEmpty()) {
                // Expand box to include nodeBox bounds using expandByPoint
                if (!hasObjects) {
                    box.copy(nodeBox);
                } else {
                    box.expandByPoint(nodeBox.min);
                    box.expandByPoint(nodeBox.max);
                }
                hasObjects = true;
            }
        }
        
        // Expand box to include structure group
        if (this.structureGroup && this.structureGroup.children.length > 0) {
            const structureBox = new THREE.Box3();
            structureBox.setFromObject(this.structureGroup);
            if (!structureBox.isEmpty()) {
                // Expand to include structure bounds
                if (!hasObjects) {
                    box.copy(structureBox);
                } else {
                    box.expandByPoint(structureBox.min);
                    box.expandByPoint(structureBox.max);
                }
                hasObjects = true;
            }
        }
        
        if (!hasObjects || box.isEmpty()) return;
        
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        
        // Set camera distance to fit all objects with some padding
        const distance = maxDim * 2;
        this.cameraDistance = Math.max(2, Math.min(50, distance));
        
        // Update camera position
        this.cameraPosition = {
            x: center.x + distance * 0.5,
            y: center.y + distance * 0.3,
            z: center.z + distance * 0.5
        };
        
        this.updateCameraPosition();
        
        // Update controls target
        if (this.controls) {
            this.controls.target.copy(center);
            this.controls.update();
        }
    }
    
    /**
     * Update camera position
     */
    updateCameraPosition() {
        this.camera.position.set(
            this.cameraPosition.x,
            this.cameraPosition.y,
            this.cameraPosition.z
        );
        this.camera.lookAt(0, 0, 0);
        this.camera.updateProjectionMatrix();
    }
    
    /**
     * Handle window resize
     */
    handleResize() {
        if (!this.container || !this.camera || !this.renderer) return;
        
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        
        // In split mode, 3D canvas is still full screen (2D overlays on top)
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        
        this.renderer.setSize(width, height);
        
        // Update overlay size
        this.updateOverlaySize();
    }
    
    /**
     * Set view mode (2d, 3d, or split)
     */
    setViewMode(mode) {
        if (!['2d', '3d', 'split'].includes(mode)) {
            console.warn(`Invalid view mode: ${mode}`);
            return;
        }
        
        this.viewMode = mode;
        
        if (this.canvas) {
            if (mode === '3d') {
                this.canvas.style.display = 'block';
                this.canvas.style.width = '100%';
                this.canvas.style.left = '0';
            } else if (mode === 'split') {
                this.canvas.style.display = 'block';
                // In split mode, 3D canvas is full screen (2D overlays on top)
                this.canvas.style.width = '100%';
                this.canvas.style.left = '0';
            } else {
                this.canvas.style.display = 'none';
            }
        }
        
        // Create or update 2D overlay canvas for split mode
        if (mode === 'split') {
            this.create2DOverlay();
        } else {
            this.remove2DOverlay();
        }
        
        this.handleResize();
    }
    
    /**
     * Create 2D overlay canvas for split view mode
     * Overlays 2D view on top of 3D view (full screen)
     */
    create2DOverlay() {
        if (!this.container) return;
        
        // Remove existing overlay if present
        this.remove2DOverlay();
        
        // Create 2D overlay canvas - full screen overlay on top of 3D
        this.overlayCanvas = document.createElement('canvas');
        this.overlayCanvas.id = 'circuit-2d-overlay-canvas';
        this.overlayCanvas.style.position = 'absolute';
        this.overlayCanvas.style.top = '0';
        this.overlayCanvas.style.left = '0'; // Full width overlay
        this.overlayCanvas.style.width = '100%';
        this.overlayCanvas.style.height = '100%';
        this.overlayCanvas.style.pointerEvents = 'auto'; // Allow 2D interactions
        this.overlayCanvas.style.zIndex = '3'; // Above 3D canvas
        this.overlayCanvas.style.backgroundColor = 'transparent'; // Transparent so 3D shows through
        this.container.appendChild(this.overlayCanvas);
        
        // Get 2D context
        this.overlayContext = this.overlayCanvas.getContext('2d');
        
        // Set size
        this.updateOverlaySize();
    }
    
    /**
     * Remove 2D overlay canvas
     */
    remove2DOverlay() {
        if (this.overlayCanvas && this.overlayCanvas.parentNode) {
            this.overlayCanvas.parentNode.removeChild(this.overlayCanvas);
        }
        this.overlayCanvas = null;
        this.overlayContext = null;
    }
    
    /**
     * Update overlay canvas size
     */
    updateOverlaySize() {
        if (this.overlayCanvas && this.container) {
            const width = this.container.clientWidth; // Full width for overlay
            const height = this.container.clientHeight;
            this.overlayCanvas.width = width;
            this.overlayCanvas.height = height;
        }
    }
    
    /**
     * Render 2D overlay (called from main render loop)
     * @param {Array} allItems - Array of all 2D nodes and connections
     */
    render2DOverlay(allItems) {
        if (!this.overlayContext || !this.overlayCanvas || this.viewMode !== 'split') {
            return;
        }
        
        const ctx = this.overlayContext;
        const width = this.overlayCanvas.width;
        const height = this.overlayCanvas.height;
        
        // Clear canvas
        ctx.fillStyle = '#15202b';
        ctx.fillRect(0, 0, width, height);
        
        // Draw grid background
        this.drawOverlayGrid(ctx, width, height);
        
        // Draw nodes and connections
        if (allItems && allItems.length > 0) {
            // Draw connections first (behind nodes)
            allItems.forEach(item => {
                if (item.type === 'connection') {
                    this.drawOverlayConnection(ctx, item);
                }
            });
            
            // Draw nodes
            allItems.forEach(item => {
                if (item.type !== 'connection') {
                    this.drawOverlayNode(ctx, item);
                }
            });
        }
    }
    
    /**
     * Draw grid on overlay
     */
    drawOverlayGrid(ctx, width, height) {
        ctx.strokeStyle = '#2a3a4a';
        ctx.lineWidth = 1;
        
        const gridSize = 50;
        
        // Vertical lines
        for (let x = 0; x < width; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        
        // Horizontal lines
        for (let y = 0; y < height; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
    }
    
    /**
     * Draw a node on overlay
     */
    drawOverlayNode(ctx, node) {
        if (!node || !node.x || !node.y) return;
        
        // Use full scale (overlay is full screen)
        const x = node.x;
        const y = node.y;
        const w = node.width || 100;
        const h = node.height || 100;
        
        // Draw node rectangle
        ctx.fillStyle = node.color || '#4a7aaa';
        ctx.fillRect(x, y, w, h);
        
        // Draw node border
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
        
        // Draw label
        if (node.label) {
            ctx.fillStyle = '#fff';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(node.label, x + w / 2, y + h / 2);
        }
    }
    
    /**
     * Draw a connection on overlay
     */
    drawOverlayConnection(ctx, connection) {
        if (!connection || !connection.source || !connection.target) return;
        
        const source = connection.source;
        const target = connection.target;
        
        // Get source and target positions (full scale)
        const sourceX = source.x || 0;
        const sourceY = source.y || 0;
        const targetX = target.x || 0;
        const targetY = target.y || 0;
        
        // Draw connection line
        ctx.strokeStyle = connection.color || '#888';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sourceX, sourceY);
        ctx.lineTo(targetX, targetY);
        ctx.stroke();
    }
    
    /**
     * Render the scene
     */
    render() {
        if (!this.initialized || !this.renderer || !this.scene || !this.camera) {
            return;
        }
        
        if (this.controls) {
            this.controls.update();
        }
        
        this.renderer.render(this.scene, this.camera);
    }
    
    /**
     * Start animation loop
     */
    startAnimationLoop() {
        if (!this.initialized) return;
        
        let frameCount = 0;
        const animate = () => {
            requestAnimationFrame(animate);
            this.render();
            
            // Phase 9: Periodically save camera state (every 60 frames ~1 second at 60fps)
            frameCount++;
            if (frameCount % 60 === 0 && this.controls) {
                this.saveCameraState();
            }
        };
        
        animate();
    }
    
    /**
     * Save camera state periodically (throttled)
     */
    saveCameraState() {
        const state = this.getCameraState();
        if (state) {
            // Throttle saves to avoid excessive localStorage writes
            if (!this._lastCameraSave || Date.now() - this._lastCameraSave > 2000) {
                try {
                    localStorage.setItem('circuit3d_cameraState', JSON.stringify(state));
                    this._lastCameraSave = Date.now();
                } catch (e) {
                    // localStorage may be full or unavailable
                    console.warn('Failed to save camera state:', e);
                }
            }
        }
    }
    
    /**
     * Add object to node group
     */
    addNode(mesh) {
        if (this.nodeGroup) {
            // Enable shadows if shadows are enabled
            if (this.shadowsEnabled && mesh.isMesh) {
                mesh.castShadow = true;
                mesh.receiveShadow = true;
            }
            this.nodeGroup.add(mesh);
            
            // If this is a Node3D mesh, add its port handles to the scene
            if (mesh.userData && mesh.userData.node3D) {
                const node3D = mesh.userData.node3D;
                if (node3D && node3D.addPortHandlesToScene) {
                    node3D.addPortHandlesToScene(this.nodeGroup);
                }
            }
        }
    }
    
    /**
     * Remove node from scene
     */
    removeNode(mesh) {
        if (this.nodeGroup && mesh) {
            this.nodeGroup.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) {
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach(m => m.dispose());
                } else {
                    mesh.material.dispose();
                }
            }
        }
    }
    
    /**
     * Add connection to connection group
     */
    addConnection(mesh) {
        if (this.connectionGroup && mesh) {
            // Enable shadows if shadows are enabled
            if (this.shadowsEnabled && mesh.isMesh) {
                mesh.castShadow = true;
                mesh.receiveShadow = true;
            }
            this.connectionGroup.add(mesh);
            // Debug logging disabled - uncomment for debugging
            // if (this.connectionGroup.children.length <= 5) {
            //     console.log('Added connection to scene:', mesh.userData?.connection2D?.id);
            // }
        }
    }
    
    /**
     * Remove connection from scene
     */
    removeConnection(mesh) {
        if (this.connectionGroup && mesh) {
            this.connectionGroup.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) {
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach(m => m.dispose());
                } else {
                    mesh.material.dispose();
                }
            }
        }
    }
    
    /**
     * Add structure mesh to structure group
     */
    addStructure(mesh) {
        if (this.structureGroup && mesh) {
            // Enable shadows if shadows are enabled
            if (this.shadowsEnabled && mesh.isMesh) {
                mesh.castShadow = true;
                mesh.receiveShadow = true;
            }
            this.structureGroup.add(mesh);
        }
    }
    
    /**
     * Remove structure mesh from scene
     */
    removeStructure(mesh) {
        if (this.structureGroup && mesh) {
            this.structureGroup.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) {
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach(m => m.dispose());
                } else {
                    mesh.material.dispose();
                }
            }
        }
    }
    
    /**
     * Clear all nodes and connections
     */
    clear() {
        if (this.nodeGroup) {
            while (this.nodeGroup.children.length > 0) {
                const child = this.nodeGroup.children[0];
                this.removeNode(child);
            }
        }
        
        if (this.connectionGroup) {
            while (this.connectionGroup.children.length > 0) {
                const child = this.connectionGroup.children[0];
                this.removeConnection(child);
            }
        }
        
        if (this.structureGroup) {
            while (this.structureGroup.children.length > 0) {
                const child = this.structureGroup.children[0];
                this.removeStructure(child);
            }
        }
    }
    
    /**
     * Dispose of resources
     */
    dispose() {
        this.clear();
        
        if (this.gridHelper) {
            this.scene.remove(this.gridHelper);
            this.gridHelper = null;
        }
        
        if (this.controls) {
            this.controls.dispose();
            this.controls = null;
        }
        
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }
        
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
            this.canvas = null;
        }
        
        this.initialized = false;
    }
}

/**
 * Coordinate mapping utilities
 */
export class CoordinateMapper {
    constructor(scale = 120) {
        // Scale: 1 meter = scale pixels (default 120)
        this.scale = scale;
    }
    
    /**
     * Convert 2D position to 3D position
     * @param {number} x - 2D X coordinate (pixels)
     * @param {number} y - 2D Y coordinate (pixels)
     * @param {number} z - Optional Z offset (meters, default 0)
     * @returns {Object} 3D position {x, y, z} in meters
     */
    position2Dto3D(x, y, z = 0) {
        // Convert pixels to meters, then to 3D space
        // X maps to X, Y maps to Z (depth), Z is height
        return {
            x: x / this.scale,
            y: z, // Height in meters
            z: y / this.scale // Depth in meters
        };
    }
    
    /**
     * Convert 3D position to 2D position
     * @param {number} x - 3D X coordinate (meters)
     * @param {number} y - 3D Y coordinate (meters, height)
     * @param {number} z - 3D Z coordinate (meters, depth)
     * @returns {Object} 2D position {x, y} in pixels
     */
    position3Dto2D(x, y, z) {
        // Convert meters to pixels
        // X maps to X, Z maps to Y
        return {
            x: x * this.scale,
            y: z * this.scale
        };
    }
    
    /**
     * Convert 2D dimensions to 3D dimensions
     * @param {number} width - Width in pixels
     * @param {number} height - Height in pixels
     * @param {number} depth - Optional depth in pixels (defaults to height)
     * @returns {Object} 3D dimensions {width, height, depth} in meters
     */
    dimensions2Dto3D(width, height, depth = null) {
        return {
            width: width / this.scale,
            height: (depth || height) / this.scale,
            depth: height / this.scale
        };
    }
    
    /**
     * Convert 3D dimensions to 2D dimensions
     * @param {number} width - Width in meters
     * @param {number} height - Height in meters
     * @param {number} depth - Depth in meters
     * @returns {Object} 2D dimensions {width, height} in pixels
     */
    dimensions3Dto2D(width, height, depth) {
        return {
            width: width * this.scale,
            height: depth * this.scale // Use depth for 2D height
        };
    }
}
