// ============================================================================ (ES module)

import { bridgeGlobals } from './global-bridge.js';

// ============================================================================
// THREE.JS RENDERER SYSTEM
// ============================================================================

// Three.js library reference (loaded via script tag, available globally)
// Using window.THREE to access it

/**
 * Three.js renderer manager - manages WebGL renderers, scenes, and cameras
 */
const threeRenderer = {
    main: null,      // WebGLRenderer for main 3D view
    top: null,       // WebGLRenderer for top view  
    side: null,      // WebGLRenderer for side view
    mainScene: null,
    topScene: null,
    sideScene: null,
    mainCamera: null,
    topCamera: null,
    sideCamera: null,
    initialized: false,
    meshCache: new Map(),  // Cache meshes to avoid recreation
    beamGroup: null,       // Group for beam meshes
    panelGroup: null,      // Group for panel meshes
    bracketGroup: null,    // Group for bracket meshes
    boltGroup: null,       // Group for bolt meshes
    washerGroup: null,    // Group for washer meshes
    hardwareAssemblyGroup: null, // Full-detail hardware assembly instances
    structureGroup: null,  // Wrapper group for structure meshes (beams, brackets, bolts - for structure rotation)
    panelGroupRoot: null,  // Root group for panels (separate from structure rotation)
    actuatorLineGroup: null,  // Group for actuator visualization lines
    humanScaleGroup: null,    // Group for human scale reference figure
    ibcReferenceGroup: null,  // Column root (child of structureGroup); sits on beam footprint
    ibcPivot: null,           // Y-rotation + stacked tank clones
    measurementGroup: null,   // Group for 3D measurement lines
    gridHelper: null       // Grid helper mesh
};

/** Cached glTF for IBC; meshes are cloned into ibcPivot (never dispose template maps via clone materials) */
const ibcGlbState = {
    gltf: null,
    loading: false,
    fillLight: null
};
/** When unchanged, skip rebuilding IBC clones (rotation/footprint handled on groups). */
let ibcStackLayoutCacheKey = '';

// ============================================================================
// MATERIAL & GEOMETRY CACHE (Performance Optimization)
// ============================================================================

const materialCache = new Map();
const geometryCache = new Map();

function getCachedMaterial(key, factory) {
    if (materialCache.has(key)) return materialCache.get(key);
    const mat = factory();
    mat._cacheKey = key;
    materialCache.set(key, mat);
    return mat;
}

function getCachedGeometry(key, factory) {
    if (geometryCache.has(key)) return geometryCache.get(key);
    const geo = factory();
    geo._cacheKey = key;
    geometryCache.set(key, geo);
    return geo;
}

function invalidateMeshCaches() {
    geometryCache.forEach(geo => geo.dispose());
    geometryCache.clear();
    if (typeof globalThis.clearMeshStructureCache === 'function') {
        globalThis.clearMeshStructureCache();
    }
    // Materials are lightweight and reused; no need to dispose
}

/**
 * Initializes the Three.js rendering system
 */
function initThreeJS() {
    if (threeRenderer.initialized || typeof THREE === 'undefined') return;
    
    try {
        // Create WebGL renderer for main 3D view using the WebGL-specific canvas
        const mainWebGLCanvas = document.getElementById('canvas-webgl');
        if (!mainWebGLCanvas) {
            console.error('WebGL canvas not found');
            return;
        }
        
        // Set canvas dimensions to match viewport
        const viewport = document.getElementById('viewport');
        if (viewport) {
            mainWebGLCanvas.width = viewport.clientWidth;
            mainWebGLCanvas.height = viewport.clientHeight;
        }
        
        threeRenderer.main = new THREE.WebGLRenderer({
            canvas: mainWebGLCanvas,
            antialias: true,
            alpha: false,
            logarithmicDepthBuffer: true  // Better depth precision for close objects
        });
        threeRenderer.main.setPixelRatio(window.devicePixelRatio);
        threeRenderer.main.setClearColor(0x15202b); // Match background color
        threeRenderer.main.sortObjects = true;  // Ensure objects are sorted by depth
        threeRenderer.main.shadowMap.enabled = true;
        threeRenderer.main.shadowMap.type = THREE.PCFSoftShadowMap;
        
        // Create WebGL renderer for top view
        const topWebGLCanvas = document.getElementById('canvas-top-webgl');
        const topSection = document.getElementById('top-view-section');
        if (topWebGLCanvas && topSection) {
            topWebGLCanvas.width = topSection.clientWidth;
            topWebGLCanvas.height = topSection.clientHeight;
            threeRenderer.top = new THREE.WebGLRenderer({
                canvas: topWebGLCanvas,
                antialias: true,
                alpha: false,
                logarithmicDepthBuffer: true
            });
            threeRenderer.top.setPixelRatio(window.devicePixelRatio);
            threeRenderer.top.setClearColor(0x192734);
            threeRenderer.top.sortObjects = true;
        }
        
        // Create WebGL renderer for side view
        const sideWebGLCanvas = document.getElementById('canvas-side-webgl');
        const sideSection = document.getElementById('side-view-section');
        if (sideWebGLCanvas && sideSection) {
            sideWebGLCanvas.width = sideSection.clientWidth;
            sideWebGLCanvas.height = sideSection.clientHeight;
            threeRenderer.side = new THREE.WebGLRenderer({
                canvas: sideWebGLCanvas,
                antialias: true,
                alpha: false,
                logarithmicDepthBuffer: true
            });
            threeRenderer.side.setPixelRatio(window.devicePixelRatio);
            threeRenderer.side.setClearColor(0x192734);
            threeRenderer.side.sortObjects = true;
        }
    } catch (e) {
        console.error('Failed to create WebGL renderers:', e);
        return;
    }
    
    // Create scenes with background colors
    threeRenderer.mainScene = new THREE.Scene();
    threeRenderer.mainScene.background = new THREE.Color(0x15202b);
    
    threeRenderer.topScene = new THREE.Scene();
    threeRenderer.topScene.background = new THREE.Color(0x192734);
    
    threeRenderer.sideScene = new THREE.Scene();
    threeRenderer.sideScene.background = new THREE.Color(0x192734);
    
    // Create object groups for organization
    threeRenderer.beamGroup = new THREE.Group();
    threeRenderer.panelGroup = new THREE.Group();
    threeRenderer.bracketGroup = new THREE.Group();
    threeRenderer.boltGroup = new THREE.Group();
    threeRenderer.washerGroup = new THREE.Group();
    threeRenderer.hardwareAssemblyGroup = new THREE.Group();
    
    // Create wrapper group for structure rotation (beams, brackets, bolts only - not panels)
    threeRenderer.structureGroup = new THREE.Group();
    threeRenderer.structureGroup.add(threeRenderer.beamGroup);
    threeRenderer.structureGroup.add(threeRenderer.bracketGroup);
    threeRenderer.structureGroup.add(threeRenderer.boltGroup);
    threeRenderer.structureGroup.add(threeRenderer.washerGroup);
    threeRenderer.structureGroup.add(threeRenderer.hardwareAssemblyGroup);
    
    // Create separate root group for panels (not affected by structure rotation)
    threeRenderer.panelGroupRoot = new THREE.Group();
    threeRenderer.panelGroupRoot.add(threeRenderer.panelGroup);
    
    // Create group for actuator visualization lines
    threeRenderer.actuatorLineGroup = new THREE.Group();
    
    // Create group for human scale reference figure
    threeRenderer.humanScaleGroup = new THREE.Group();
    
    // IBC column (Just IBC.glb): rotates with structure, stacked clones in ibcPivot
    threeRenderer.ibcReferenceGroup = new THREE.Group();
    threeRenderer.ibcPivot = new THREE.Group();
    threeRenderer.ibcReferenceGroup.add(threeRenderer.ibcPivot);
    threeRenderer.structureGroup.add(threeRenderer.ibcReferenceGroup);
    
    // Create group for 3D measurement lines
    threeRenderer.measurementGroup = new THREE.Group();
    
    threeRenderer.mainScene.add(threeRenderer.structureGroup);
    threeRenderer.mainScene.add(threeRenderer.panelGroupRoot);
    threeRenderer.mainScene.add(threeRenderer.actuatorLineGroup);
    threeRenderer.mainScene.add(threeRenderer.humanScaleGroup);
    threeRenderer.mainScene.add(threeRenderer.measurementGroup);
    
    // Create wrapper groups for ortho scenes (structure rotation for beams/brackets/bolts only)
    threeRenderer.topStructureGroup = new THREE.Group();
    threeRenderer.topStructureGroup.add(new THREE.Group()); // beams
    threeRenderer.topStructureGroup.add(new THREE.Group()); // brackets
    threeRenderer.topStructureGroup.add(new THREE.Group()); // bolts
    threeRenderer.topScene.add(threeRenderer.topStructureGroup);
    
    threeRenderer.topPanelGroup = new THREE.Group();
    threeRenderer.topScene.add(threeRenderer.topPanelGroup);
    
    threeRenderer.sideStructureGroup = new THREE.Group();
    threeRenderer.sideStructureGroup.add(new THREE.Group()); // beams
    threeRenderer.sideStructureGroup.add(new THREE.Group()); // brackets
    threeRenderer.sideStructureGroup.add(new THREE.Group()); // bolts
    threeRenderer.sideScene.add(threeRenderer.sideStructureGroup);
    
    threeRenderer.sidePanelGroup = new THREE.Group();
    threeRenderer.sideScene.add(threeRenderer.sidePanelGroup);
    
    // Setup cameras
    createMainCamera();
    createTopCamera();
    createSideCamera();
    
    // Setup lighting
    setupThreeJSLighting();
    
    // Create grid
    createGridMesh();
    
    threeRenderer.initialized = true;
    console.log('Three.js initialized successfully');
}

/**
 * Creates the main perspective camera
 */
function createMainCamera() {
    const viewport = document.getElementById('viewport');
    const aspect = viewport ? (viewport.clientWidth / viewport.clientHeight) : 1.5;
    // Near plane at 10 gives better depth precision, far at 5000 is sufficient
    threeRenderer.mainCamera = new THREE.PerspectiveCamera(45, aspect, 10, 5000);
    updateMainCamera();
}

/**
 * Updates the main camera position based on state.cam values
 */
function updateMainCamera(structureCenter = null) {
    const cam = state.cam;
    const sc = structureCenter || { x: 0, y: 0, z: 0 };
    
    // Calculate camera position from yaw, pitch, and distance
    const x = cam.dist * Math.sin(cam.yaw) * Math.cos(cam.pitch);
    const y = cam.dist * Math.sin(cam.pitch);
    const z = cam.dist * Math.cos(cam.yaw) * Math.cos(cam.pitch);
    
    // Pan offsets - use same calculation as original for backward compatibility
    const panOffsetX = cam.panX * 0.5;
    const panOffsetY = cam.panY * 0.5;
    
    // Position camera relative to structure center with pan applied
    threeRenderer.mainCamera.position.set(
        sc.x + x - panOffsetX,
        sc.y + y + panOffsetY,
        sc.z + z
    );
    
    // Apply same pan offset to lookAt target so view doesn't rotate when zooming
    // This is the key fix - both camera and target shift together when panning
    threeRenderer.mainCamera.lookAt(
        sc.x - panOffsetX,
        sc.y + panOffsetY,
        sc.z
    );
    
    // Update aspect ratio
    const viewport = document.getElementById('viewport');
    if (viewport && threeRenderer.mainCamera) {
        const aspect = viewport.clientWidth / viewport.clientHeight;
        threeRenderer.mainCamera.aspect = aspect;
        threeRenderer.mainCamera.updateProjectionMatrix();
    }
}

/**
 * Creates the orthographic camera for top view
 */
function createTopCamera() {
    const topSection = document.getElementById('top-view-section');
    if (!topSection) return;
    const topCanvas = topSection; // Use section for dimensions
    
    const w = topCanvas.clientWidth;
    const h = topCanvas.clientHeight;
    const frustumSize = 500;
    const aspect = w / h;
    
    threeRenderer.topCamera = new THREE.OrthographicCamera(
        -frustumSize * aspect / 2,
        frustumSize * aspect / 2,
        frustumSize / 2,
        -frustumSize / 2,
        1,      // Near plane - better depth precision
        3000    // Far plane - sufficient for structure
    );
    threeRenderer.topCamera.position.set(0, 1000, 0);
    threeRenderer.topCamera.lookAt(0, 0, 0);
    threeRenderer.topCamera.up.set(0, 0, -1); // Z is forward in top view
}

/**
 * Updates the top camera based on structure bounds
 */
function updateTopCamera(data, structureCenter = null) {
    const topSection = document.getElementById('top-view-section');
    if (!topSection || !threeRenderer.topCamera) return;
    
    const sc = structureCenter || { x: 0, y: 0, z: 0 };
    const w = topSection.clientWidth;
    const h = topSection.clientHeight;
    
    // Calculate bounding box
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    if (data.beams) {
        data.beams.forEach(beam => {
            beam.corners.forEach(c => {
                minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
                minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
            });
        });
    }
    
    const width = maxX - minX || 100;
    const depth = maxZ - minZ || 100;
    const padding = 1.2;
    
    const frustumWidth = Math.max(width, depth * (w / h)) * padding;
    const frustumHeight = frustumWidth * (h / w);
    
    threeRenderer.topCamera.left = -frustumWidth / 2;
    threeRenderer.topCamera.right = frustumWidth / 2;
    threeRenderer.topCamera.top = frustumHeight / 2;
    threeRenderer.topCamera.bottom = -frustumHeight / 2;
    
    threeRenderer.topCamera.position.set(sc.x, 1000, sc.z);
    threeRenderer.topCamera.lookAt(sc.x, 0, sc.z);
    threeRenderer.topCamera.updateProjectionMatrix();
}

/**
 * Creates the orthographic camera for side view
 */
function createSideCamera() {
    const sideSection = document.getElementById('side-view-section');
    if (!sideSection) return;
    
    const w = sideSection.clientWidth;
    const h = sideSection.clientHeight;
    const frustumSize = 500;
    const aspect = w / h;
    
    threeRenderer.sideCamera = new THREE.OrthographicCamera(
        -frustumSize * aspect / 2,
        frustumSize * aspect / 2,
        frustumSize / 2,
        -frustumSize / 2,
        1,      // Near plane - better depth precision
        3000    // Far plane - sufficient for structure
    );
    threeRenderer.sideCamera.position.set(0, 0, 1000);
    threeRenderer.sideCamera.lookAt(0, 0, 0);
}

/**
 * Updates the side camera based on structure bounds
 */
function updateSideCamera(data, structureCenter = null) {
    const sideSection = document.getElementById('side-view-section');
    if (!sideSection || !threeRenderer.sideCamera) return;
    
    const sc = structureCenter || { x: 0, y: 0, z: 0 };
    const w = sideSection.clientWidth;
    const h = sideSection.clientHeight;
    
    // Calculate bounding box
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    if (data.beams) {
        data.beams.forEach(beam => {
            beam.corners.forEach(c => {
                minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
                minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
            });
        });
    }
    
    const width = maxX - minX || 100;
    const height = maxY - minY || 100;
    const padding = 1.2;
    
    const frustumWidth = Math.max(width, height * (w / h)) * padding;
    const frustumHeight = frustumWidth * (h / w);
    
    threeRenderer.sideCamera.left = -frustumWidth / 2;
    threeRenderer.sideCamera.right = frustumWidth / 2;
    threeRenderer.sideCamera.top = frustumHeight / 2;
    threeRenderer.sideCamera.bottom = -frustumHeight / 2;
    
    threeRenderer.sideCamera.position.set(sc.x, sc.y, 1000);
    threeRenderer.sideCamera.lookAt(sc.x, sc.y, 0);
    threeRenderer.sideCamera.updateProjectionMatrix();
}

/**
 * Sets up lighting for all Three.js scenes
 */
function setupThreeJSLighting() {
    // === MAIN SUN LIGHT - user controllable ===
    // Bright directional light simulating the sun
    threeRenderer.sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
    threeRenderer.sunLight.castShadow = false; // Will be enabled when shadows toggle is on
    threeRenderer.sunLight.shadow.camera.left = -200;
    threeRenderer.sunLight.shadow.camera.right = 200;
    threeRenderer.sunLight.shadow.camera.top = 200;
    threeRenderer.sunLight.shadow.camera.bottom = -200;
    threeRenderer.sunLight.shadow.camera.near = 0.1;
    threeRenderer.sunLight.shadow.camera.far = 2000;
    threeRenderer.sunLight.shadow.mapSize.width = 2048;
    threeRenderer.sunLight.shadow.mapSize.height = 2048;
    threeRenderer.sunLight.shadow.bias = -0.0001;
    updateSunPosition(); // Set initial position based on time
    
    // Fill light - cooler, softer from opposite side (sky bounce)
    const fillLight = new THREE.DirectionalLight(0xb0c4de, 0.4);
    fillLight.position.set(-100, 50, -100);
    
    // Ambient light for base illumination (prevents pitch black shadows)
    const ambientLight = new THREE.AmbientLight(0x404050, 0.6);
    
    // Hemisphere light - sky blue from above, ground reflection from below
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x444444, 0.4);
    
    // Add to main scene
    threeRenderer.mainScene.add(threeRenderer.sunLight);
    threeRenderer.mainScene.add(fillLight);
    threeRenderer.mainScene.add(ambientLight);
    threeRenderer.mainScene.add(hemiLight);
    
    // Orthographic views get flat, even lighting
    threeRenderer.topScene.add(new THREE.AmbientLight(0xffffff, 1.2));
    threeRenderer.topScene.add(new THREE.DirectionalLight(0xffffff, 0.5));
    threeRenderer.sideScene.add(new THREE.AmbientLight(0xffffff, 1.2));
    threeRenderer.sideScene.add(new THREE.DirectionalLight(0xffffff, 0.5));
}

/**
 * Calculate daylight hours based on latitude and day of year
 */
function getDaylightHours(latitude, dayOfYear) {
    // Solar declination angle (simplified equation)
    const declination = 23.45 * Math.sin((360/365) * (dayOfYear - 81) * Math.PI / 180);
    const latRad = latitude * Math.PI / 180;
    const decRad = declination * Math.PI / 180;
    
    // Hour angle at sunrise/sunset
    const cosHourAngle = -Math.tan(latRad) * Math.tan(decRad);
    
    // Handle polar regions
    if (cosHourAngle > 1) return 0;   // Polar night
    if (cosHourAngle < -1) return 24; // Midnight sun
    
    const hourAngle = Math.acos(cosHourAngle) * 180 / Math.PI;
    const daylightHours = 2 * hourAngle / 15;
    
    return daylightHours;
}

/**
 * Get sunrise and sunset times
 */
function getSunriseSunset(latitude, dayOfYear) {
    const daylight = getDaylightHours(latitude, dayOfYear);
    const solarNoon = 12; // Simplified (ignores longitude/timezone)
    
    return {
        sunrise: Math.max(0, solarNoon - daylight / 2),
        sunset: Math.min(24, solarNoon + daylight / 2),
        daylight: daylight
    };
}

/**
 * Calculate solar position from time of day
 */
function calculateSolarPosition(latitude, dayOfYear, hourOfDay) {
    const declination = 23.45 * Math.sin((360/365) * (dayOfYear - 81) * Math.PI / 180);
    const latRad = latitude * Math.PI / 180;
    const decRad = declination * Math.PI / 180;
    
    // Hour angle (15 degrees per hour from solar noon)
    const hourAngle = (hourOfDay - 12) * 15 * Math.PI / 180;
    
    // Solar elevation angle
    const sinElevation = Math.sin(latRad) * Math.sin(decRad) + 
                         Math.cos(latRad) * Math.cos(decRad) * Math.cos(hourAngle);
    
    // Return default if sun is below horizon
    if (sinElevation <= 0) {
        return { elevation: 0, azimuth: 180 };
    }
    
    const elevation = Math.asin(sinElevation) * 180 / Math.PI;
    
    // Solar azimuth angle (0 = North, 90 = East, 180 = South, 270 = West)
    const sinAzimuth = Math.sin(hourAngle) * Math.cos(decRad) / Math.cos(Math.asin(sinElevation));
    const cosAzimuth = (Math.sin(decRad) - Math.sin(latRad) * sinElevation) / 
                       (Math.cos(latRad) * Math.cos(Math.asin(sinElevation)));
    
    // Calculate azimuth using atan2 for proper quadrant handling
    let azimuth = Math.atan2(sinAzimuth, cosAzimuth) * 180 / Math.PI;
    
    // Convert from -180 to 180 range to 0 to 360 range
    if (azimuth < 0) {
        azimuth += 360;
    }
    
    return { elevation, azimuth };
}

/**
 * Updates sun light position based on time of day
 */
function updateSunPosition() {
    if (!threeRenderer.sunLight) return;
    
    // Get time from slider (0-100 maps to sunrise-sunset)
    const timePercent = state.sunTime || 50;
    const latitude = state.simulationLatitude || 35;
    const dayOfYear = state.simulationDayOfYear || 172;
    
    // Get sunrise and sunset times
    const { sunrise, sunset } = getSunriseSunset(latitude, dayOfYear);
    const dayLength = sunset - sunrise;
    
    // Map slider (0-100) to hour of day
    const hourOfDay = sunrise + (timePercent / 100) * dayLength;
    
    // Calculate solar position
    const solarPos = calculateSolarPosition(latitude, dayOfYear, hourOfDay);
    const azimuth = solarPos.azimuth;     // Degrees from north (0=N, 90=E, 180=S, 270=W)
    const elevation = solarPos.elevation; // Degrees above horizon
    
    // Update time display
    const timeDisplay = document.getElementById('sun-time-display');
    if (timeDisplay) {
        const hours = Math.floor(hourOfDay);
        const minutes = Math.floor((hourOfDay - hours) * 60);
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
        timeDisplay.textContent = `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
    }
    
    // Convert to radians
    const azRad = (azimuth - 90) * Math.PI / 180;  // Adjust so 0 = East
    const elRad = elevation * Math.PI / 180;
    
    // Calculate sun position on unit sphere, then scale
    const dist = 500;
    const x = dist * Math.cos(elRad) * Math.cos(azRad);
    const y = dist * Math.sin(elRad);
    const z = dist * Math.cos(elRad) * Math.sin(azRad);
    
    threeRenderer.sunLight.position.set(x, y, z);
    
    // Adjust intensity based on elevation (dimmer near horizon)
    const intensityFactor = 0.5 + 0.5 * Math.sin(elRad);
    threeRenderer.sunLight.intensity = 1.2 * intensityFactor;
    
    // Warm up color near horizon (sunrise/sunset effect)
    if (elevation < 30) {
        const warmth = 1 - (elevation / 30);
        const r = 1;
        const g = 1 - warmth * 0.3;
        const b = 1 - warmth * 0.5;
        threeRenderer.sunLight.color.setRGB(r, g, b);
    } else {
        threeRenderer.sunLight.color.setHex(0xffffff);
    }
    
    // Update shadows if enabled
    if (state.shadowsEnabled && threeRenderer.sunLight) {
        threeRenderer.sunLight.castShadow = true;
        // Update shadow camera to follow sun
        if (threeRenderer.sunLight.shadow) {
            threeRenderer.sunLight.shadow.camera.left = -200;
            threeRenderer.sunLight.shadow.camera.right = 200;
            threeRenderer.sunLight.shadow.camera.top = 200;
            threeRenderer.sunLight.shadow.camera.bottom = -200;
            threeRenderer.sunLight.shadow.camera.near = 0.1;
            threeRenderer.sunLight.shadow.camera.far = 2000;
            threeRenderer.sunLight.shadow.mapSize.width = 2048;
            threeRenderer.sunLight.shadow.mapSize.height = 2048;
            threeRenderer.sunLight.shadow.bias = -0.0001;
        }
    } else if (threeRenderer.sunLight) {
        threeRenderer.sunLight.castShadow = false;
    }
    
    // Update sky color based on time of day
    updateSkyColor(elevation, hourOfDay);
}

/**
 * Updates the scene background color based on sun elevation and time
 */
function updateSkyColor(elevation, hourOfDay) {
    if (!threeRenderer.mainScene) return;
    
    if (state.shadowsEnabled) {
        // Realistic sky colors based on sun elevation
        let r, g, b;
        
        if (elevation > 45) {
            // Midday - bright blue sky
            r = 135;
            g = 206;
            b = 250; // Sky blue
        } else if (elevation > 20) {
            // Morning/afternoon - lighter blue
            const factor = (elevation - 20) / 25;
            r = Math.floor(135 + (255 - 135) * (1 - factor));
            g = Math.floor(206 + (200 - 206) * (1 - factor));
            b = Math.floor(250 + (100 - 250) * (1 - factor));
        } else if (elevation > 5) {
            // Sunrise/sunset - warm colors
            const factor = (elevation - 5) / 15;
            r = Math.floor(255 - (255 - 135) * factor);
            g = Math.floor(200 - (200 - 100) * factor);
            b = Math.floor(100 - (100 - 50) * factor);
        } else {
            // Below horizon - dark blue/purple
            r = 25;
            g = 25;
            b = 50;
        }
        
        threeRenderer.mainScene.background = new THREE.Color(r / 255, g / 255, b / 255);
    } else {
        // Default dark background when shadows are off
        threeRenderer.mainScene.background = new THREE.Color(0x15202b);
    }
}

/**
 * Creates a grass texture using canvas
 */
function createGrassTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    // Base grass color
    ctx.fillStyle = '#2d5016';
    ctx.fillRect(0, 0, 512, 512);
    
    // Add texture variation with darker and lighter patches
    for (let i = 0; i < 200; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const size = 20 + Math.random() * 40;
        const brightness = 0.7 + Math.random() * 0.3;
        
        ctx.fillStyle = `rgba(${Math.floor(45 * brightness)}, ${Math.floor(80 * brightness)}, ${Math.floor(22 * brightness)}, 0.3)`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Add fine grass blade texture
    ctx.strokeStyle = 'rgba(34, 68, 17, 0.4)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 500; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const length = 5 + Math.random() * 10;
        const angle = Math.random() * Math.PI * 2;
        
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(
            x + Math.cos(angle) * length,
            y + Math.sin(angle) * length
        );
        ctx.stroke();
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    
    return texture;
}

/**
 * Creates an octagon shape for the ground plane
 */
function createOctagonGeometry(size) {
    const shape = new THREE.Shape();
    const radius = size / 2;
    const segments = 8;
    
    // Start at first point
    const firstAngle = -Math.PI / 2; // Start at top
    const firstX = radius * Math.cos(firstAngle);
    const firstY = radius * Math.sin(firstAngle);
    shape.moveTo(firstX, firstY);
    
    // Create octagon points
    for (let i = 1; i <= segments; i++) {
        const angle = firstAngle + (i * 2 * Math.PI / segments);
        const x = radius * Math.cos(angle);
        const y = radius * Math.sin(angle);
        shape.lineTo(x, y);
    }
    
    return new THREE.ShapeGeometry(shape);
}

/**
 * Creates or updates the ground plane for shadows
 */
function updateGroundPlane() {
    if (!threeRenderer.mainScene) return;
    
    // Remove existing ground plane if it exists
    if (threeRenderer.groundPlane) {
        threeRenderer.mainScene.remove(threeRenderer.groundPlane);
        if (threeRenderer.groundPlane.geometry) threeRenderer.groundPlane.geometry.dispose();
        if (threeRenderer.groundPlane.material) {
            if (threeRenderer.groundPlane.material.map) {
                threeRenderer.groundPlane.material.map.dispose();
            }
            threeRenderer.groundPlane.material.dispose();
        }
        threeRenderer.groundPlane = null;
    }
    
    // Create ground plane if shadows are enabled
    if (state.shadowsEnabled) {
        const groundSize = 2000;
        const groundGeometry = createOctagonGeometry(groundSize);
        const grassTexture = createGrassTexture();
        
        const groundMaterial = new THREE.MeshStandardMaterial({
            map: grassTexture,
            color: 0x2d5016, // Base grass color
            roughness: 0.9,
            metalness: 0.0
        });
        
        threeRenderer.groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
        threeRenderer.groundPlane.rotation.x = -Math.PI / 2; // Rotate to horizontal
        // Position at -1.5" (beam thickness) to account for structure resting on beam bottom faces
        const beamThickness = state.hBeamT || 1.5;
        threeRenderer.groundPlane.position.y = -beamThickness;
        threeRenderer.groundPlane.receiveShadow = true;
        
        threeRenderer.mainScene.add(threeRenderer.groundPlane);
    }
}

/**
 * Creates the ground grid mesh
 */
function createGridMesh() {
    const gridSize = GRID_RANGE * 2;
    const gridDivisions = (GRID_RANGE * 2) / GRID_SPACING;
    
    threeRenderer.gridHelper = new THREE.GridHelper(
        gridSize,
        gridDivisions,
        0x00a8a0,  // Center line color (teal)
        0x00a8a0   // Grid line color (teal)
    );
    threeRenderer.gridHelper.material.opacity = 0.2;
    threeRenderer.gridHelper.material.transparent = true;
    threeRenderer.gridHelper.material.depthWrite = false; // Prevent grid from occluding objects
    threeRenderer.gridHelper.renderOrder = -1; // Render grid first (behind everything)
    
    threeRenderer.mainScene.add(threeRenderer.gridHelper);
    
    // Update grid visibility based on shadows
    updateGridVisibility();
}

/**
 * Updates grid visibility based on shadows setting
 */
function updateGridVisibility() {
    if (threeRenderer.gridHelper) {
        threeRenderer.gridHelper.visible = !state.shadowsEnabled;
    }
}

/**
 * Updates grid position based on structure center
 */
function updateGridPosition(structureCenter) {
    if (threeRenderer.gridHelper && structureCenter) {
        threeRenderer.gridHelper.position.set(structureCenter.x, 0, structureCenter.z);
    }
}

/**
 * Converts RGB object to Three.js color
 */
function rgbToThreeColor(rgb) {
    return new THREE.Color(rgb.r / 255, rgb.g / 255, rgb.b / 255);
}

/**
 * For a beam, return the list of bolts that physically pass through it,
 * with the bolt's projected position in the beam's local (length, width, thickness)
 * frame. Used to drill cylindrical holes through beam geometry so SketchUp/3D
 * exports show the actual through-holes instead of just floating bolts.
 *
 * @param {Beam3D} beam - Beam to test
 * @param {Array} allBolts - Bolts produced by buildLinkageGeometry / data.bolts
 * @returns {Array<{posL:number, posW:number, posT:number, radius:number, through:'W'|'T'}>}
 */
function getBeamBoltIntersections(beam, allBolts) {
    if (!beam || !beam.corners || !beam.p1 || !beam.p2) return [];
    if (!Array.isArray(allBolts) || allBolts.length === 0) return [];

    const axisL = beam.axisZ;
    const axisW = beam.axisX;
    const axisT = beam.axisY;
    if (!axisL || !axisW || !axisT) return [];

    const beamLen = vMag(vSub(beam.p2, beam.p1));
    if (beamLen < 1e-4) return [];
    const halfL = beamLen / 2;
    const halfW = (beam.w || 1) / 2;
    const halfT = (beam.t || 1) / 2;
    // Slight slack so a bolt that just touches a beam face still drills cleanly
    const TOL = 0.05;

    const out = [];
    for (const bolt of allBolts) {
        if (!bolt || !bolt.center || !bolt.dir) continue;
        const r = Math.max(bolt.radius || 0, 0.05);
        // Project bolt center into beam-local frame
        const rel = vSub(bolt.center, beam.center);
        const projL = vDot(rel, axisL);
        const projW = vDot(rel, axisW);
        const projT = vDot(rel, axisT);

        // Identify the dominant face axis for the bolt direction
        const dotL = Math.abs(vDot(bolt.dir, axisL));
        const dotW = Math.abs(vDot(bolt.dir, axisW));
        const dotT = Math.abs(vDot(bolt.dir, axisT));

        let through;
        if (dotW >= dotT && dotW >= dotL) through = 'W';
        else if (dotT >= dotL) through = 'T';
        else through = 'L';
        if (through === 'L') continue;

        // The bolt centerline must intersect the beam volume. We check that the
        // bolt center projects within the beam in the length axis and within the
        // beam in the non-bolt axis. Along the bolt-axis we allow a generous
        // window since bolts may be longer than the beam thickness.
        if (projL < -halfL - TOL || projL > halfL + TOL) continue;
        if (through === 'W') {
            if (projT < -halfT - TOL || projT > halfT + TOL) continue;
            // Bolt should reach into the beam along W: half its length must cover
            // the beam half-width relative to the bolt center along W
            const halfBoltLen = (bolt.length || 0) / 2;
            if (Math.abs(projW) - halfBoltLen > halfW + TOL) continue;
        } else {
            if (projW < -halfW - TOL || projW > halfW + TOL) continue;
            const halfBoltLen = (bolt.length || 0) / 2;
            if (Math.abs(projT) - halfBoltLen > halfT + TOL) continue;
        }

        out.push({ posL: projL, posW: projW, posT: projT, radius: r, through });
    }
    return out;
}

/**
 * Builds a wood-beam mesh with cylindrical bolt holes drilled through it.
 *
 * The geometry is constructed manually as a clean indexed BufferGeometry
 * (POSITION + NORMAL + TEXCOORD_0 + INDEX, single material group). We
 * deliberately avoid THREE.ExtrudeGeometry here because the SketchUp Centaur
 * glTF importer (gltf_importer.rbe) chokes on the non-indexed, world-space
 * UV output that ExtrudeGeometry emits and aborts with
 * "no implicit conversion from nil to integer" in create_mesh.
 *
 * If holes go through both width and thickness axes, we pick whichever axis
 * has the most holes and skip the others (rare in practice — almost all bolts
 * on a single beam pass through the same face).
 *
 * @param {Beam3D} beam
 * @param {Array} intersections - from getBeamBoltIntersections
 * @param {THREE.Material} material
 * @returns {THREE.Mesh|null} - null if intersections is empty or invalid
 */
function buildBeamMeshWithHoles(beam, intersections, material) {
    if (!intersections || intersections.length === 0) return null;
    if (!beam || !beam.p1 || !beam.p2 || !beam.axisX || !beam.axisY || !beam.axisZ) return null;

    const wHoles = intersections.filter(i => i.through === 'W');
    const tHoles = intersections.filter(i => i.through === 'T');
    let dominant, holes;
    if (wHoles.length >= tHoles.length) { dominant = 'W'; holes = wHoles; }
    else { dominant = 'T'; holes = tHoles; }
    if (holes.length === 0) return null;

    const beamLen = vMag(vSub(beam.p2, beam.p1));
    const halfL = beamLen / 2;
    const w = beam.w || 1;
    const t = beam.t || 1;
    const halfOther = (dominant === 'W') ? t / 2 : w / 2;
    const depth = (dominant === 'W') ? w : t;
    const halfD = depth / 2;

    // ---------- 2D cross-section (rect + hole circles) ----------
    // Shape coords: x = beam length, y = non-bolt axis. The cross-section is
    // perpendicular to the bolt axis and gets duplicated at z = ±halfD to
    // form the front & back caps of the drilled box.
    //
    // SketchUp's Centaur glTF importer aggressively auto-deletes any
    // SketchUp Group it considers degenerate or empty, then crashes when
    // subsequent faces try to attach to that already-deleted group
    // ("reference to deleted Group"). To minimize the chance of triggering
    // it we keep the geometry simple: a modest hole-circle segment count
    // plus generous clearance between holes and the beam edges.
    const SEG = 12;
    const EDGE_CLEAR = 1.25; // multiplier of radius to keep clear of contour
    const HOLE_CLEAR = 1.5;  // multiplier of (r1+r2) to keep between holes
    const contour2D = [
        new THREE.Vector2(-halfL, -halfOther),
        new THREE.Vector2( halfL, -halfOther),
        new THREE.Vector2( halfL,  halfOther),
        new THREE.Vector2(-halfL,  halfOther)
    ];

    const holes2D = [];
    const holeCenters = [];
    const holeRadii = [];
    for (const h of holes) {
        const r = Math.max(h.radius, 0.05);

        // Skip holes that can't fit with adequate clearance on the
        // non-bolt axis (typical wood beam dims handle this fine, but bail
        // gracefully on weird input).
        if (r * EDGE_CLEAR * 2 >= halfOther * 2) continue;
        if (r * EDGE_CLEAR * 2 >= halfL * 2) continue;

        const minX = -halfL + r * EDGE_CLEAR;
        const maxX =  halfL - r * EDGE_CLEAR;
        const minY = -halfOther + r * EDGE_CLEAR;
        const maxY =  halfOther - r * EDGE_CLEAR;
        const cx = Math.max(minX, Math.min(maxX, h.posL));
        const yRaw = (dominant === 'W') ? h.posT : h.posW;
        const cy = Math.max(minY, Math.min(maxY, yRaw));

        let overlaps = false;
        for (let k = 0; k < holeCenters.length; k++) {
            const dx = cx - holeCenters[k].x;
            const dy = cy - holeCenters[k].y;
            const minSep = (r + holeRadii[k]) * HOLE_CLEAR;
            if (dx * dx + dy * dy < minSep * minSep) { overlaps = true; break; }
        }
        if (overlaps) continue;

        // Hole vertices in CW order (opposite winding to the CCW outer
        // contour) — required by ShapeUtils.triangulateShape.
        const ring = [];
        for (let i = SEG - 1; i >= 0; i--) {
            const a = (i / SEG) * Math.PI * 2;
            ring.push(new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
        }
        holes2D.push(ring);
        holeCenters.push({ x: cx, y: cy });
        holeRadii.push(r);
    }
    if (holes2D.length === 0) return null;

    let capFaces;
    try {
        capFaces = THREE.ShapeUtils.triangulateShape(contour2D, holes2D);
    } catch (err) {
        console.warn('[buildBeamMeshWithHoles] triangulateShape failed', err);
        return null;
    }
    if (!capFaces || capFaces.length === 0) return null;

    // ShapeUtils.triangulateShape may emit degenerate (collinear) triangles
    // near hole-boundary contacts. SketchUp's glTF importer reacts badly to
    // zero-area faces (it deletes the Group, then later code crashes with
    // "reference to deleted Group"), so drop them up front.
    const allShapeVerts = contour2D.concat(...holes2D);
    const TRI_AREA_MIN = 1e-7;
    capFaces = capFaces.filter(f => {
        const v0 = allShapeVerts[f[0]];
        const v1 = allShapeVerts[f[1]];
        const v2 = allShapeVerts[f[2]];
        if (!v0 || !v1 || !v2) return false;
        const ax = v1.x - v0.x, ay = v1.y - v0.y;
        const bx = v2.x - v0.x, by = v2.y - v0.y;
        return Math.abs(ax * by - ay * bx) * 0.5 > TRI_AREA_MIN;
    });
    if (capFaces.length === 0) return null;

    // ---------- Build attributes ----------
    const positions = [];
    const normals = [];
    const indices = [];

    function pushVertex(x, y, z, nx, ny, nz) {
        const i = positions.length / 3;
        positions.push(x, y, z);
        normals.push(nx, ny, nz);
        return i;
    }

    function pushQuad(fa, ba, bb, fb) {
        // Two triangles for a sidewall quad. Vertices are passed in the
        // order (front-a, back-a, back-b, front-b) so that
        // cross(ba-fa, bb-fa) produces the desired outward normal.
        // Verified by hand for an axis-aligned edge:
        //   fa=(L,-O,+h), ba=(L,-O,-h), bb=(L,+O,-h)  →  normal +X.
        indices.push(fa, ba, bb, fa, bb, fb);
    }

    // Front cap (z = +halfD, normal +Z)
    const frontStart = positions.length / 3;
    for (const v of allShapeVerts) pushVertex(v.x, v.y, +halfD, 0, 0, 1);
    for (const f of capFaces) {
        // CCW winding when viewed from +Z so normal points +Z
        indices.push(frontStart + f[0], frontStart + f[1], frontStart + f[2]);
    }

    // Back cap (z = -halfD, normal -Z)
    const backStart = positions.length / 3;
    for (const v of allShapeVerts) pushVertex(v.x, v.y, -halfD, 0, 0, -1);
    for (const f of capFaces) {
        // Reverse winding so normal points -Z
        indices.push(backStart + f[2], backStart + f[1], backStart + f[0]);
    }

    // Outer side walls (4 rectangles around the contour)
    for (let i = 0; i < contour2D.length; i++) {
        const a2 = contour2D[i];
        const b2 = contour2D[(i + 1) % contour2D.length];
        const ex = b2.x - a2.x;
        const ey = b2.y - a2.y;
        const len = Math.hypot(ex, ey) || 1;
        // Outer normal: contour is CCW, so the outward normal is the right-
        // hand rotation of the edge tangent: (ey, -ex).
        const nx = ey / len;
        const ny = -ex / len;
        const fa = pushVertex(a2.x, a2.y, +halfD, nx, ny, 0);
        const ba = pushVertex(a2.x, a2.y, -halfD, nx, ny, 0);
        const bb = pushVertex(b2.x, b2.y, -halfD, nx, ny, 0);
        const fb = pushVertex(b2.x, b2.y, +halfD, nx, ny, 0);
        pushQuad(fa, ba, bb, fb);
    }

    // Hole inner walls (cylinders pointing inward toward each hole's center)
    for (let h = 0; h < holes2D.length; h++) {
        const ring = holes2D[h];
        const c = holeCenters[h];
        for (let i = 0; i < ring.length; i++) {
            const a2 = ring[i];
            const b2 = ring[(i + 1) % ring.length];
            // Inward-facing normal: from the wall surface toward the empty
            // hole interior (i.e., toward the hole's center).
            let nax = c.x - a2.x;
            let nay = c.y - a2.y;
            let nbx = c.x - b2.x;
            let nby = c.y - b2.y;
            const naLen = Math.hypot(nax, nay) || 1;
            const nbLen = Math.hypot(nbx, nby) || 1;
            nax /= naLen; nay /= naLen;
            nbx /= nbLen; nby /= nbLen;
            const fa = pushVertex(a2.x, a2.y, +halfD, nax, nay, 0);
            const ba = pushVertex(a2.x, a2.y, -halfD, nax, nay, 0);
            const bb = pushVertex(b2.x, b2.y, -halfD, nbx, nby, 0);
            const fb = pushVertex(b2.x, b2.y, +halfD, nbx, nby, 0);
            pushQuad(fa, ba, bb, fb);
        }
    }

    const totalVerts = positions.length / 3;
    if (totalVerts === 0 || indices.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    // Zero UVs for every vertex — required by some glTF importers (notably
    // SketchUp's Centaur importer) but harmless for an untextured material.
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(totalVerts * 2), 2));

    const IndexArray = totalVerts > 65535 ? Uint32Array : Uint16Array;
    geometry.setIndex(new THREE.BufferAttribute(IndexArray.from(indices), 1));

    const mesh = new THREE.Mesh(geometry, material);

    // Orient the local shape coords (X=length, Y=non-bolt, Z=bolt) to the
    // beam's world axes. Beam3D defines axisY = cross(axisX, axisZ), which is
    // a LEFT-handed basis, so we always derive the bolt axis via a right-
    // handed cross product to keep the rotation matrix's determinant +1.
    // Because the geometry is symmetric about the bolt axis, flipping that
    // axis has no visible effect.
    const xAxis = new THREE.Vector3(beam.axisZ.x, beam.axisZ.y, beam.axisZ.z).normalize();
    const otherAxis = (dominant === 'W')
        ? new THREE.Vector3(beam.axisY.x, beam.axisY.y, beam.axisY.z).normalize()
        : new THREE.Vector3(beam.axisX.x, beam.axisX.y, beam.axisX.z).normalize();
    const boltAxis = new THREE.Vector3().crossVectors(xAxis, otherAxis).normalize();

    const m = new THREE.Matrix4();
    m.makeBasis(xAxis, otherAxis, boltAxis);
    mesh.quaternion.setFromRotationMatrix(m);
    mesh.position.set(beam.center.x, beam.center.y, beam.center.z);
    return mesh;
}

/**
 * Creates a Three.js mesh from a Beam3D object
 * Uses explicit face geometry with proper normals to avoid rendering artifacts
 */
function createBeamMesh(beam, isColliding = false, allBolts = null) {
    const geometry = new THREE.BufferGeometry();
    const c = beam.corners;
    
    // Build vertices and normals for each face separately
    const positions = [];
    const normals = [];
    
    // Helper to calculate face normal - ensure it points outward from beam center
    function calcOutwardNormal(p0, p1, p2, faceCenter, beamCenter) {
        const ax = p1.x - p0.x, ay = p1.y - p0.y, az = p1.z - p0.z;
        const bx = p2.x - p0.x, by = p2.y - p0.y, bz = p2.z - p0.z;
        let nx = ay * bz - az * by;
        let ny = az * bx - ax * bz;
        let nz = ax * by - ay * bx;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= len; ny /= len; nz /= len;
        
        // Check if normal points outward (away from beam center)
        const toCenterX = beamCenter.x - faceCenter.x;
        const toCenterY = beamCenter.y - faceCenter.y;
        const toCenterZ = beamCenter.z - faceCenter.z;
        const dot = nx * toCenterX + ny * toCenterY + nz * toCenterZ;
        
        // If normal points toward center, flip it
        if (dot > 0) { nx = -nx; ny = -ny; nz = -nz; }
        
        return { x: nx, y: ny, z: nz };
    }
    
    // Calculate beam center
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < 8; i++) { cx += c[i].x; cy += c[i].y; cz += c[i].z; }
    const beamCenter = { x: cx / 8, y: cy / 8, z: cz / 8 };
    
    // Helper to add a quad with outward-facing normal
    function addQuad(p0, p1, p2, p3) {
        const faceCenter = {
            x: (p0.x + p1.x + p2.x + p3.x) / 4,
            y: (p0.y + p1.y + p2.y + p3.y) / 4,
            z: (p0.z + p1.z + p2.z + p3.z) / 4
        };
        const n = calcOutwardNormal(p0, p1, p2, faceCenter, beamCenter);
        
        // Triangle 1: p0, p1, p2
        positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        normals.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
        // Triangle 2: p0, p2, p3
        positions.push(p0.x, p0.y, p0.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
        normals.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
    }
    
    // Add all 6 faces - winding order doesn't matter now since we force outward normals
    addQuad(c[0], c[1], c[2], c[3]); // Near end
    addQuad(c[4], c[7], c[6], c[5]); // Far end
    addQuad(c[0], c[4], c[5], c[1]); // Bottom
    addQuad(c[2], c[6], c[7], c[3]); // Top
    addQuad(c[0], c[3], c[7], c[4]); // Left
    addQuad(c[1], c[5], c[6], c[2]); // Right
    
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    
    // Create material - darker, warmer wood tone
    let woodColor;
    if (isColliding) {
        woodColor = new THREE.Color(0.9, 0.2, 0.1);
    } else if (beam.kinematicState === 'error') {
        woodColor = new THREE.Color(0.82, 0.28, 0.18);
    } else if (beam.kinematicState === 'warning') {
        woodColor = new THREE.Color(0.72, 0.52, 0.18);
    } else {
        // Darken and warm up the base color
        const base = beam.colorBase;
        woodColor = new THREE.Color(
            Math.max(0, (base.r * 0.7 - 20)) / 255,
            Math.max(0, (base.g * 0.65 - 15)) / 255,
            Math.max(0, (base.b * 0.5 - 10)) / 255
        );
    }
    
    const material = new THREE.MeshLambertMaterial({
        color: woodColor,
        side: THREE.DoubleSide,  // Render both sides to prevent x-ray effect
    });
    
    // Use polygon offset to prevent z-fighting
    material.polygonOffset = true;
    material.polygonOffsetFactor = 1;
    material.polygonOffsetUnits = 1;

    // If bolt list provided, drill cylindrical through-holes for any bolt that
    // physically passes through this beam. Falls back to the solid box geometry
    // when no bolts intersect.
    if (Array.isArray(allBolts) && allBolts.length > 0) {
        const intersections = getBeamBoltIntersections(beam, allBolts);
        if (intersections.length > 0) {
            const drilled = buildBeamMeshWithHoles(beam, intersections, material);
            if (drilled) {
                drilled.userData.beam = beam;
                drilled.userData.type = 'beam';
                drilled.renderOrder = 1;
                drilled.castShadow = state.shadowsEnabled || false;
                drilled.receiveShadow = state.shadowsEnabled || false;
                return drilled;
            }
        }
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.beam = beam;
    mesh.userData.type = 'beam';
    mesh.renderOrder = 1;
    mesh.castShadow = state.shadowsEnabled || false;
    mesh.receiveShadow = state.shadowsEnabled || false;
    
    return mesh;
}

/**
 * Creates a Three.js mesh from a Panel3D object
 * Creates realistic solar panel with:
 * - Shiny reflective blue/black front face with cell grid
 * - White backsheet with black border (1.5" inset)
 * - Black border on front (0.25" inset)
 * - Dark aluminum frame edges
 */
function createPanelMesh(panel) {
    if (panel.formFactor === 'folding') return createFoldingPanelMesh(panel);
    if (panel.formFactor === 'flexible') return createFlexiblePanelMesh(panel);

    const group = new THREE.Group();
    const c = panel.corners;
    
    // Border insets in inches
    const FRONT_BORDER = 0.5;
    const BACK_BORDER = 1.5;
    
    // Calculate panel center
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < 8; i++) { cx += c[i].x; cy += c[i].y; cz += c[i].z; }
    const panelCenter = { x: cx / 8, y: cy / 8, z: cz / 8 };
    
    // Helper to calculate outward normal
    function calcOutwardNormal(p0, p1, p2, faceCenter) {
        const ax = p1.x - p0.x, ay = p1.y - p0.y, az = p1.z - p0.z;
        const bx = p2.x - p0.x, by = p2.y - p0.y, bz = p2.z - p0.z;
        let nx = ay * bz - az * by;
        let ny = az * bx - ax * bz;
        let nz = ax * by - ay * bx;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= len; ny /= len; nz /= len;
        
        const toCenterX = panelCenter.x - faceCenter.x;
        const toCenterY = panelCenter.y - faceCenter.y;
        const toCenterZ = panelCenter.z - faceCenter.z;
        if (nx * toCenterX + ny * toCenterY + nz * toCenterZ > 0) {
            nx = -nx; ny = -ny; nz = -nz;
        }
        return { x: nx, y: ny, z: nz };
    }
    
    // Helper to create a quad mesh
    function createQuadMesh(p0, p1, p2, p3, material) {
        const geo = new THREE.BufferGeometry();
        const positions = [
            p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z,
            p0.x, p0.y, p0.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z
        ];
        const faceCenter = {
            x: (p0.x + p1.x + p2.x + p3.x) / 4,
            y: (p0.y + p1.y + p2.y + p3.y) / 4,
            z: (p0.z + p1.z + p2.z + p3.z) / 4
        };
        const n = calcOutwardNormal(p0, p1, p2, faceCenter);
        const normals = [n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z,
                        n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z];
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
        return new THREE.Mesh(geo, material);
    }
    
    // Helper to interpolate between two points
    function lerp(p0, p1, t) {
        return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t, z: p0.z + (p1.z - p0.z) * t };
    }
    
    // Helper to create inset corners for a face
    function getInsetCorners(corners, inset) {
        // corners = [p0, p1, p2, p3] defining a quad
        // Calculate edge lengths to determine inset ratios
        const edge01 = Math.sqrt(
            Math.pow(corners[1].x - corners[0].x, 2) +
            Math.pow(corners[1].y - corners[0].y, 2) +
            Math.pow(corners[1].z - corners[0].z, 2)
        );
        const edge03 = Math.sqrt(
            Math.pow(corners[3].x - corners[0].x, 2) +
            Math.pow(corners[3].y - corners[0].y, 2) +
            Math.pow(corners[3].z - corners[0].z, 2)
        );
        
        const t01 = Math.min(0.4, inset / edge01); // Ratio along 0->1 edge
        const t03 = Math.min(0.4, inset / edge03); // Ratio along 0->3 edge
        
        // Inset each corner
        return [
            lerp(lerp(corners[0], corners[1], t01), lerp(corners[0], corners[3], t03), 0.5),
            lerp(lerp(corners[1], corners[0], t01), lerp(corners[1], corners[2], t03), 0.5),
            lerp(lerp(corners[2], corners[3], t01), lerp(corners[2], corners[1], t03), 0.5),
            lerp(lerp(corners[3], corners[2], t01), lerp(corners[3], corners[0], t03), 0.5)
        ].map((p, i) => {
            // Proper inset calculation
            const c0 = corners[i];
            const c1 = corners[(i + 1) % 4];
            const c3 = corners[(i + 3) % 4];
            const dir01 = { x: c1.x - c0.x, y: c1.y - c0.y, z: c1.z - c0.z };
            const dir03 = { x: c3.x - c0.x, y: c3.y - c0.y, z: c3.z - c0.z };
            const len01 = Math.sqrt(dir01.x * dir01.x + dir01.y * dir01.y + dir01.z * dir01.z) || 1;
            const len03 = Math.sqrt(dir03.x * dir03.x + dir03.y * dir03.y + dir03.z * dir03.z) || 1;
            return {
                x: c0.x + (dir01.x / len01) * inset + (dir03.x / len03) * inset,
                y: c0.y + (dir01.y / len01) * inset + (dir03.y / len03) * inset,
                z: c0.z + (dir01.z / len01) * inset + (dir03.z / len03) * inset
            };
        });
    }
    
    // Materials
    const cellColor = rgbToThreeColor(panel.colorBase);
    
    // Front face material - SHINY reflective solar cells (glass-like)
    const frontMaterial = new THREE.MeshPhongMaterial({
        color: cellColor,
        specular: 0x888899,
        shininess: 80,
        reflectivity: 0.8,
        side: THREE.DoubleSide,
    });
    frontMaterial.polygonOffset = true;
    frontMaterial.polygonOffsetFactor = 2;
    frontMaterial.polygonOffsetUnits = 2;
    
    // Back face material - matte white backsheet
    const backMaterial = new THREE.MeshLambertMaterial({
        color: 0xf5f5f5,
        side: THREE.DoubleSide,
    });
    backMaterial.polygonOffset = true;
    backMaterial.polygonOffsetFactor = 2;
    backMaterial.polygonOffsetUnits = 2;
    
    // Black border/bevel material
    const borderMaterial = new THREE.MeshLambertMaterial({
        color: 0x151518,
        side: THREE.DoubleSide,
    });
    borderMaterial.polygonOffset = true;
    borderMaterial.polygonOffsetFactor = 1.8;
    borderMaterial.polygonOffsetUnits = 1.8;
    
    // Edge material - dark aluminum frame (slightly reflective)
    const edgeMaterial = new THREE.MeshPhongMaterial({
        color: 0x404045,
        specular: 0x333333,
        shininess: 20,
        side: THREE.DoubleSide,
    });
    edgeMaterial.polygonOffset = true;
    edgeMaterial.polygonOffsetFactor = 1.5;
    edgeMaterial.polygonOffsetUnits = 1.5;
    
    // === BACK FACE (corners 0,1,2,3) - white backsheet with black border ===
    const backCorners = [c[0], c[1], c[2], c[3]];
    const backInset = getInsetCorners(backCorners, BACK_BORDER);
    
    // Inner white area
    group.add(createQuadMesh(backInset[0], backInset[1], backInset[2], backInset[3], backMaterial));
    
    // Black border strips (4 trapezoids around the edge)
    group.add(createQuadMesh(backCorners[0], backCorners[1], backInset[1], backInset[0], borderMaterial));
    group.add(createQuadMesh(backCorners[1], backCorners[2], backInset[2], backInset[1], borderMaterial));
    group.add(createQuadMesh(backCorners[2], backCorners[3], backInset[3], backInset[2], borderMaterial));
    group.add(createQuadMesh(backCorners[3], backCorners[0], backInset[0], backInset[3], borderMaterial));
    
    // === FRONT FACE (corners 4,5,6,7) - blue solar cells with black border ===
    const frontCorners = [c[4], c[7], c[6], c[5]]; // Note: different winding for front
    const frontInset = getInsetCorners(frontCorners, FRONT_BORDER);
    
    // Inner blue solar cell area
    group.add(createQuadMesh(frontInset[0], frontInset[1], frontInset[2], frontInset[3], frontMaterial));
    
    // Black border strips
    group.add(createQuadMesh(frontCorners[0], frontCorners[1], frontInset[1], frontInset[0], borderMaterial));
    group.add(createQuadMesh(frontCorners[1], frontCorners[2], frontInset[2], frontInset[1], borderMaterial));
    group.add(createQuadMesh(frontCorners[2], frontCorners[3], frontInset[3], frontInset[2], borderMaterial));
    group.add(createQuadMesh(frontCorners[3], frontCorners[0], frontInset[0], frontInset[3], borderMaterial));
    
    // === EDGE FACES - aluminum frame ===
    group.add(createQuadMesh(c[0], c[4], c[5], c[1], edgeMaterial)); // Bottom edge
    group.add(createQuadMesh(c[2], c[6], c[7], c[3], edgeMaterial)); // Top edge
    group.add(createQuadMesh(c[0], c[3], c[7], c[4], edgeMaterial)); // Left edge
    group.add(createQuadMesh(c[1], c[5], c[6], c[2], edgeMaterial)); // Right edge
    
    // Add cell grid lines on the front face (inside the border)
    const gridLines = createCellGridLines(frontInset[0], frontInset[3], frontInset[2], frontInset[1], panel);
    if (gridLines) group.add(gridLines);
    
    group.userData.panel = panel;
    group.userData.type = 'panel';
    group.renderOrder = 2;
    
    // Enable shadows on all meshes in the group
    group.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = state.shadowsEnabled || false;
            child.receiveShadow = state.shadowsEnabled || false;
        }
    });
    
    return group;
}

/**
 * Creates grid lines to represent solar cells on a panel face
 */
function createCellGridLines(p0, p1, p2, p3, panel) {
    // Create line segments for cell divisions
    const positions = [];
    
    // Number of cell divisions (creates a grid pattern)
    const cellsX = 6; // Number of cell columns
    const cellsY = 10; // Number of cell rows
    
    // Calculate edge vectors
    const edgeX = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
    const edgeY = { x: p3.x - p0.x, y: p3.y - p0.y, z: p3.z - p0.z };
    
    // Calculate normal for slight offset above surface
    const ax = p1.x - p0.x, ay = p1.y - p0.y, az = p1.z - p0.z;
    const bx = p3.x - p0.x, by = p3.y - p0.y, bz = p3.z - p0.z;
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nLen; ny /= nLen; nz /= nLen;
    const offset = 0.03; // Small offset above surface
    
    // Horizontal lines (across width, dividing rows)
    for (let i = 1; i < cellsY; i++) {
        const t = i / cellsY;
        const startX = p0.x + edgeY.x * t + nx * offset;
        const startY = p0.y + edgeY.y * t + ny * offset;
        const startZ = p0.z + edgeY.z * t + nz * offset;
        const endX = startX + edgeX.x;
        const endY = startY + edgeX.y;
        const endZ = startZ + edgeX.z;
        positions.push(startX, startY, startZ, endX, endY, endZ);
    }
    
    // Vertical lines (across height, dividing columns)
    for (let i = 1; i < cellsX; i++) {
        const t = i / cellsX;
        const startX = p0.x + edgeX.x * t + nx * offset;
        const startY = p0.y + edgeX.y * t + ny * offset;
        const startZ = p0.z + edgeX.z * t + nz * offset;
        const endX = startX + edgeY.x;
        const endY = startY + edgeY.y;
        const endZ = startZ + edgeY.z;
        positions.push(startX, startY, startZ, endX, endY, endZ);
    }
    
    if (positions.length === 0) return null;
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    
    // Subtle dark lines for cell divisions
    const material = new THREE.LineBasicMaterial({
        color: 0x101520,
        linewidth: 1,
        transparent: true,
        opacity: 0.5,
    });
    
    return new THREE.LineSegments(geometry, material);
}

/**
 * Creates a Three.js mesh for a bracket
 */
function createBracketMesh(bracket) {
    const material = getCachedMaterial('bracket', () => {
        const m = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
        m.polygonOffset = true;
        m.polygonOffsetFactor = 0.5;
        m.polygonOffsetUnits = 0.5;
        return m;
    });
    
    // Get bracket dimensions
    const width = bracket.width || state.bracketWidth || 2.0;
    const depth = bracket.depth || state.bracketDepth || 3.0;
    const height = bracket.actualHeight || bracket.height || state.bracketHeight || 3.0;
    const wallThickness = bracket.wallThickness || state.bracketWallThickness || 0.25;
    const innerWidth = bracket.innerWidth || state.bracketInnerWidth || 1.5;
    const holeDiameter = bracket.holeDiameter || state.bracketHoleDiameter || 0.375;
    const holeDistance = bracket.holeDistance || state.bracketHoleDistance || 1.5;
    
    // Create a group to hold all bracket parts
    const bracketGroup = new THREE.Group();
    
    // Calculate leg positions (left and right legs of U)
    const legWidth = (width - innerWidth) / 2;
    
    // Build geometry with U opening facing +Y (upward in local coords)
    // Width (X) is the span between legs, Depth (Z) is the length of the channel
    
    const bpKey = `brkBot_${width.toFixed(3)}_${wallThickness.toFixed(3)}_${depth.toFixed(3)}`;
    const bottomPlate = getCachedGeometry(bpKey, () => new THREE.BoxGeometry(width, wallThickness, depth));
    const bottomMesh = new THREE.Mesh(bottomPlate, material);
    bottomMesh.position.y = wallThickness / 2;
    bracketGroup.add(bottomMesh);
    
    const legKey = `brkLeg_${legWidth.toFixed(3)}_${height.toFixed(3)}_${depth.toFixed(3)}`;
    const legGeometry = getCachedGeometry(legKey, () => new THREE.BoxGeometry(legWidth, height, depth));
    const leftMesh = new THREE.Mesh(legGeometry, material);
    leftMesh.position.set(-(width - legWidth) / 2, height / 2 + wallThickness, 0);
    bracketGroup.add(leftMesh);
    
    const rightMesh = new THREE.Mesh(legGeometry, material);
    rightMesh.position.set((width - legWidth) / 2, height / 2 + wallThickness, 0);
    bracketGroup.add(rightMesh);
    
    // Note: Holes would require CSG (Constructive Solid Geometry) operations to properly subtract
    // For now, the bracket structure (U-shape) is correctly represented
    
    // Position the bracket group
    // For arch mode, use bottomPos if available (transformed position with proper offset)
    // For cylinder mode, use the original bottomY calculation
    let bracketX, bracketY, bracketZ;
    
    if (bracket.bottomPos) {
        // Arch mode: use the transformed bottom position directly
        bracketX = bracket.bottomPos.x;
        bracketY = bracket.bottomPos.y;
        bracketZ = bracket.bottomPos.z;
    } else {
        // Cylinder mode: use pivot position with Y offset
        bracketX = bracket.pos.x;
        bracketY = bracket.bottomY || bracket.pos.y;
        bracketZ = bracket.pos.z;
    }
    
    bracketGroup.position.set(bracketX, bracketY, bracketZ);
    
    // Orient bracket:
    // 1. Use beamDir (the actual vertical beam direction) for bracket orientation
    // 2. beamDir is the average direction of the scissor beams in this module
    // 3. Project onto XZ plane to get horizontal angle
    // 4. For top ring, flip 180° so U opening faces down
    // 5. Apply manual Y-axis rotation adjustment for fine-tuning
    
    // Orient bracket based on the beam direction (patternA_dir or patternB_dir)
    // The bracket's U-channel should align with the beam direction
    // so it can capture the beams that run through this pivot point
    //
    // Use different orientation strategies:
    // - Arch mode (bottomPos exists): Use full 3D rotation matrix from transformed vectors
    // - Cylinder mode: Use XZ plane projection with world Y as up
    
    const isArchMode = !!bracket.bottomPos;
    
    if (isArchMode && bracket.beamDir && bracket.right) {
        // ARCH MODE: Use full 3D rotation matrix from transformed vectors
        // Check for valid vectors (non-zero length)
        const beamDirMag = vMag(bracket.beamDir);
        const rightMag = vMag(bracket.right);
        
        if (beamDirMag > 0.001 && rightMag > 0.001) {
            // Normalize vectors
            const beamDir = vNorm(bracket.beamDir);
            const right = vNorm(bracket.right);
            
            // For bottom brackets: U opens "up" (away from beam stack center)
            // For top brackets: U opens "down" (toward beam stack center)
            // The "up" vector is cross(right, beamDir)
            let up = vCross(right, beamDir);
            const upMag = vMag(up);
            
            if (upMag > 0.001) {
                up = vScale(up, 1/upMag); // Normalize
                
                // Flip up direction for top brackets
                if (!bracket.isBottom) {
                    up = vScale(up, -1);
                }
                
                // Construct rotation matrix:
                // Local X (width) = right
                // Local Y (up) = up
                // Local Z (depth) = beamDir
                const matrix = new THREE.Matrix4();
                matrix.set(
                    right.x, up.x, beamDir.x, 0,
                    right.y, up.y, beamDir.y, 0,
                    right.z, up.z, beamDir.z, 0,
                    0, 0, 0, 1
                );
                
                // Apply the rotation from the matrix
                bracketGroup.setRotationFromMatrix(matrix);
                
                // Apply manual rotation adjustment (around local Y-axis)
                const manualYRot = (state.bracketZRotation || 0) * (Math.PI / 180);
                if (Math.abs(manualYRot) > 0.001) {
                    bracketGroup.rotateOnAxis(new THREE.Vector3(0, 1, 0), manualYRot);
                }
            }
        }
    } else if (bracket.beamDir) {
        // CYLINDER MODE: Use XZ plane projection with world Y as up
        let yRotation = 0;
        
        // Project beam direction onto XZ plane (horizontal component)
        const beamX = bracket.beamDir.x;
        const beamZ = bracket.beamDir.z;
        const beamHorizLength = Math.sqrt(beamX * beamX + beamZ * beamZ);
        
        if (beamHorizLength > 0.001) {
            // Calculate angle from the beam's horizontal direction
            // atan2(x, z) gives angle from +Z toward +X
            yRotation = Math.atan2(beamX, beamZ);
        }
        
        // Apply Y rotation - bracket depth now aligns with beam direction
        bracketGroup.rotation.y = yRotation;
        
        // Apply manual Y-axis rotation adjustment (around local Y-axis)
        const manualYRot = (state.bracketZRotation || 0) * (Math.PI / 180);
        if (Math.abs(manualYRot) > 0.001) {
            bracketGroup.rotateOnAxis(new THREE.Vector3(0, 1, 0), manualYRot);
        }
        
        // For top ring brackets, flip the bracket upside down (rotate 180° around local X)
        if (!bracket.isBottom) {
            bracketGroup.rotateOnAxis(new THREE.Vector3(1, 0, 0), Math.PI);
        }
    }
    
    bracketGroup.userData.bracket = bracket;
    bracketGroup.userData.type = 'bracket';
    bracketGroup.renderOrder = 0;
    
    // Set shadow properties on all child meshes
    bracketGroup.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = state.shadowsEnabled || false;
            child.receiveShadow = state.shadowsEnabled || false;
        }
    });
    
    return bracketGroup;
}

/**
 * Creates a Three.js mesh for a bolt
 * Head stays flush with material surface; length changes extend the opposite end
 */
function createBoltMesh(bolt) {
    const boltRadius = bolt.radius || state.boltDiameter / 2;
    const boltLength = bolt.length;
    const stackThickness = bolt.stackThickness || boltLength * 0.8;
    
    const headSide = bolt.headSide !== undefined ? bolt.headSide : 1;
    const headExtraThickness = bolt.headExtraThickness || 0;
    
    let boltColor = 0x1a1a1a;
    if (bolt.boltType === 'rcp-cross') {
        if (bolt.diagnosticState === 'active') boltColor = 0x5a2280;
        else if (bolt.diagnosticState === 'inactive') boltColor = 0x8a6620;
        else if (bolt.diagnosticState === 'error') boltColor = 0xcc3311;
    } else if (bolt.boltType === 'rcp-ring') {
        boltColor = 0x1a4ea0;
    }
    const materialKey = 'bolt_' + boltColor + '_' + (bolt.diagnosticState || '');
    const material = getCachedMaterial(materialKey, () => {
        const m = new THREE.MeshLambertMaterial({ color: boltColor });
        m.polygonOffset = true;
        m.polygonOffsetFactor = -1;
        m.polygonOffsetUnits = -1;
        return m;
    });
    
    const boltGroup = new THREE.Group();
    
    const hexRadius = boltRadius * 1.8;
    const hexHeight = boltRadius * 1.2;
    
    // Hex head geometry - cached per radius, per headSide
    const hexKey = `hex_${boltRadius.toFixed(4)}_${headSide}`;
    const hexGeometry = getCachedGeometry(hexKey, () => {
        const hexShape = new THREE.Shape();
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            if (i === 0) hexShape.moveTo(hexRadius * Math.cos(angle), hexRadius * Math.sin(angle));
            else hexShape.lineTo(hexRadius * Math.cos(angle), hexRadius * Math.sin(angle));
        }
        hexShape.closePath();
        const geo = new THREE.ExtrudeGeometry(hexShape, { depth: hexHeight, bevelEnabled: false });
        geo.rotateX(Math.PI / 2);
        if (headSide > 0) geo.translate(0, hexHeight, 0);
        return geo;
    });
    
    const headBottomY = headSide * (stackThickness / 2 + headExtraThickness);
    const hexMesh = new THREE.Mesh(hexGeometry, material);
    hexMesh.position.y = headBottomY;
    boltGroup.add(hexMesh);
    
    // Shaft geometry - cached per radius+length
    const shaftKey = `shaft_${boltRadius.toFixed(4)}_${boltLength.toFixed(4)}`;
    const shaftGeometry = getCachedGeometry(shaftKey, () => {
        return new THREE.CylinderGeometry(boltRadius, boltRadius, boltLength, 12);
    });
    const shaftMesh = new THREE.Mesh(shaftGeometry, material);
    const shaftY = headBottomY - headSide * boltLength / 2;
    shaftMesh.position.y = shaftY;
    boltGroup.add(shaftMesh);
    
    // Position and orient the bolt group
    boltGroup.position.set(bolt.center.x, bolt.center.y, bolt.center.z);
    
    // Orient along bolt direction
    if (bolt.dir) {
        const dir = new THREE.Vector3(bolt.dir.x, bolt.dir.y, bolt.dir.z);
        const up = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(up, dir.normalize());
        boltGroup.quaternion.copy(quaternion);
    }
    
    boltGroup.userData.bolt = bolt;
    boltGroup.userData.type = 'bolt';
    boltGroup.renderOrder = 3;
    
    // Set shadow properties on child meshes
    boltGroup.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = state.shadowsEnabled || false;
            child.receiveShadow = state.shadowsEnabled || false;
        }
    });
    
    return boltGroup;
}

/**
 * Creates a Three.js mesh for a washer
 * @param {Object} washer - Washer data with center, dir, ID, OD, thickness
 */
function createWasherMesh(washer) {
    const wid = washer.id || 0.4375;
    const od = washer.od || 1.0;
    const thickness = washer.thickness || 0.0;
    
    if (thickness <= 0) return new THREE.Group();
    
    const material = getCachedMaterial('washer', () => {
        const m = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
        m.polygonOffset = true;
        m.polygonOffsetFactor = -1;
        m.polygonOffsetUnits = -1;
        return m;
    });
    
    const washerGroup = new THREE.Group();
    
    const washerGeoKey = `washer_${wid.toFixed(4)}_${od.toFixed(4)}_${thickness.toFixed(4)}`;
    const washerGeometry = getCachedGeometry(washerGeoKey, () => {
        const outerRadius = od / 2;
        const innerRadius = wid / 2;
        const segments = 32;
        
        const outerShape = new THREE.Shape();
        outerShape.moveTo(outerRadius, 0);
        for (let i = 1; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            outerShape.lineTo(outerRadius * Math.cos(angle), outerRadius * Math.sin(angle));
        }
        outerShape.closePath();
        
        const innerPath = new THREE.Path();
        innerPath.moveTo(innerRadius, 0);
        for (let i = 1; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            innerPath.lineTo(innerRadius * Math.cos(angle), innerRadius * Math.sin(angle));
        }
        innerPath.closePath();
        outerShape.holes.push(innerPath);
        
        const geo = new THREE.ExtrudeGeometry(outerShape, { depth: thickness, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, -thickness / 2, 0);
        return geo;
    });
    
    const washerMesh = new THREE.Mesh(washerGeometry, material);
    washerGroup.add(washerMesh);
    
    // Position and orient the washer
    washerGroup.position.set(washer.center.x, washer.center.y, washer.center.z);
    
    // Orient washer so its flat face is perpendicular to the bolt direction
    // The washer's normal is along Y-axis (after rotation), so we align Y with bolt direction
    // This makes the flat face perpendicular to the bolt, allowing the bolt to pass through
    if (washer.dir) {
        const boltDir = new THREE.Vector3(washer.dir.x, washer.dir.y, washer.dir.z).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(up, boltDir);
        washerGroup.setRotationFromQuaternion(quaternion);
    }
    
    washerGroup.userData.washer = washer;
    washerGroup.userData.type = 'washer';
    washerGroup.renderOrder = 0;
    
    // Set shadow properties
    washerGroup.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = state.shadowsEnabled || false;
            child.receiveShadow = state.shadowsEnabled || false;
        }
    });
    
    return washerGroup;
}

/**
 * Clears all meshes from a group (recursively handles nested groups)
 */
function clearGroup(group) {
    while (group.children.length > 0) {
        const child = group.children[0];
        
        if (child.children && child.children.length > 0) {
            clearGroup(child);
        }
        
        if (child.geometry && !child.geometry._cacheKey) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(m => { if (!m._cacheKey) m.dispose(); });
            } else if (!child.material._cacheKey) {
                child.material.dispose();
            }
        }
        group.remove(child);
    }
}


const _moduleExports = {
    threeRenderer,
    ibcGlbState,
    getCachedMaterial,
    getCachedGeometry,
    invalidateMeshCaches,
    initThreeJS,
    createMainCamera,
    updateMainCamera,
    createTopCamera,
    updateTopCamera,
    createSideCamera,
    updateSideCamera,
    setupThreeJSLighting,
    updateSunPosition,
    updateGroundPlane,
    updateGridVisibility,
    updateGridPosition,
    rgbToThreeColor,
    getBeamBoltIntersections,
    buildBeamMeshWithHoles,
    createBeamMesh,
    createPanelMesh,
    createBracketMesh,
    createBoltMesh,
    createWasherMesh,
    clearGroup,
    ibcStackLayoutCacheKey,
};

    Object.defineProperty(globalThis, 'ibcStackLayoutCacheKey', {
        get() { return ibcStackLayoutCacheKey; },
        set(v) { ibcStackLayoutCacheKey = v; },
        configurable: true
    });

bridgeGlobals(_moduleExports, 'renderer3d');

export { threeRenderer, ibcGlbState, getCachedMaterial, getCachedGeometry, invalidateMeshCaches, initThreeJS, createMainCamera, updateMainCamera, createTopCamera, updateTopCamera, createSideCamera, updateSideCamera, setupThreeJSLighting, updateSunPosition, updateGroundPlane, updateGridVisibility, updateGridPosition, rgbToThreeColor, getBeamBoltIntersections, buildBeamMeshWithHoles, createBeamMesh, createPanelMesh, createBracketMesh, createBoltMesh, createWasherMesh, clearGroup, ibcStackLayoutCacheKey };
