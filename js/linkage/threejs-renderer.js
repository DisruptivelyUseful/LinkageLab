// ============================================================================
// THREE.JS RENDERER
// ============================================================================

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
    gridHelper: null       // Grid helper mesh
};

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
    
    threeRenderer.mainScene.add(threeRenderer.beamGroup);
    threeRenderer.mainScene.add(threeRenderer.panelGroup);
    threeRenderer.mainScene.add(threeRenderer.bracketGroup);
    threeRenderer.mainScene.add(threeRenderer.boltGroup);
    
    // Clone groups for other scenes
    threeRenderer.topScene.add(new THREE.Group()); // beams
    threeRenderer.topScene.add(new THREE.Group()); // panels
    threeRenderer.sideScene.add(new THREE.Group()); // beams
    threeRenderer.sideScene.add(new THREE.Group()); // panels
    
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

function createMainCamera() {
    const viewport = document.getElementById('viewport');
    const aspect = viewport ? (viewport.clientWidth / viewport.clientHeight) : 1.5;
    // Near plane at 10 gives better depth precision, far at 5000 is sufficient
    threeRenderer.mainCamera = new THREE.PerspectiveCamera(45, aspect, 10, 5000);
    updateMainCamera();
}

function updateMainCamera(structureCenter = null) {
    const cam = state.cam;
    const sc = structureCenter || { x: 0, y: 0, z: 0 };
    
    // Calculate camera position from yaw, pitch, and distance
    const x = cam.dist * Math.sin(cam.yaw) * Math.cos(cam.pitch);
    const y = cam.dist * Math.sin(cam.pitch);
    const z = cam.dist * Math.cos(cam.yaw) * Math.cos(cam.pitch);
    
    // Position camera relative to structure center
    threeRenderer.mainCamera.position.set(
        sc.x + x - cam.panX * 0.5,
        sc.y + y + cam.panY * 0.5,
        sc.z + z
    );
    
    // Look at structure center
    threeRenderer.mainCamera.lookAt(sc.x, sc.y, sc.z);
    
    // Update aspect ratio
    const viewport = document.getElementById('viewport');
    if (viewport && threeRenderer.mainCamera) {
        const aspect = viewport.clientWidth / viewport.clientHeight;
        threeRenderer.mainCamera.aspect = aspect;
        threeRenderer.mainCamera.updateProjectionMatrix();
    }
}

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

function setupThreeJSLighting() {
    // === MAIN SUN LIGHT - user controllable ===
    // Bright directional light simulating the sun
    threeRenderer.sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
    updateSunPosition(); // Set initial position based on state.sunAzimuth/sunElevation
    
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

function updateSunPosition() {
    if (!threeRenderer.sunLight) return;
    
    const azimuth = state.sunAzimuth || 135;     // Degrees from north (0=N, 90=E, 180=S, 270=W)
    const elevation = state.sunElevation || 45;  // Degrees above horizon
    
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
}

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
}

function updateGridPosition(structureCenter) {
    if (threeRenderer.gridHelper && structureCenter) {
        threeRenderer.gridHelper.position.set(structureCenter.x, 0, structureCenter.z);
    }
}

function rgbToThreeColor(rgb) {
    return new THREE.Color(rgb.r / 255, rgb.g / 255, rgb.b / 255);
}

function createBeamMesh(beam, isColliding = false) {
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
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.beam = beam;
    mesh.userData.type = 'beam';
    mesh.renderOrder = 1;
    
    return mesh;
}

function createPanelMesh(panel) {
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
    
    return group;
}

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

function createBracketMesh(bracket) {
    const geometry = new THREE.BoxGeometry(bracket.w, bracket.h, bracket.d);
    const material = new THREE.MeshLambertMaterial({
        color: 0x909090,
    });
    
    material.polygonOffset = true;
    material.polygonOffsetFactor = 0.5;
    material.polygonOffsetUnits = 0.5;
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(bracket.pos.x, bracket.pos.y, bracket.pos.z);
    mesh.userData.bracket = bracket;
    mesh.userData.type = 'bracket';
    mesh.renderOrder = 0;
    
    return mesh;
}

function createBoltMesh(bolt) {
    // Create cylinder for shaft
    const shaftGeometry = new THREE.CylinderGeometry(
        bolt.radius,
        bolt.radius,
        bolt.length,
        8
    );
    
    const material = new THREE.MeshLambertMaterial({
        color: 0x505050,
    });
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;
    
    const mesh = new THREE.Mesh(shaftGeometry, material);
    
    // Position and orient the bolt
    mesh.position.set(bolt.center.x, bolt.center.y, bolt.center.z);
    
    // Orient along bolt direction
    if (bolt.dir) {
        const dir = new THREE.Vector3(bolt.dir.x, bolt.dir.y, bolt.dir.z);
        const up = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(up, dir.normalize());
        mesh.quaternion.copy(quaternion);
    }
    
    mesh.userData.bolt = bolt;
    mesh.userData.type = 'bolt';
    mesh.renderOrder = 3;
    
    return mesh;
}

function clearGroup(group) {
    while (group.children.length > 0) {
        const child = group.children[0];
        
        // Recursively clear nested groups
        if (child.children && child.children.length > 0) {
            clearGroup(child);
        }
        
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(m => m.dispose());
            } else {
                child.material.dispose();
            }
        }
        group.remove(child);
    }
}

function updateThreeJSScenes(data) {
    if (!threeRenderer.initialized) return;
    
    // Clear existing meshes
    clearGroup(threeRenderer.beamGroup);
    clearGroup(threeRenderer.panelGroup);
    clearGroup(threeRenderer.bracketGroup);
    clearGroup(threeRenderer.boltGroup);
    
    // Check if a beam is colliding
    const isColliding = (beam) => state.collisions.some(c => c.beam === beam || c.other === beam);
    
    // Add beams
    if (data.beams) {
        data.beams.forEach(beam => {
            const mesh = createBeamMesh(beam, isColliding(beam));
            threeRenderer.beamGroup.add(mesh);
        });
    }
    
    // Add panels
    if (data.panels && data.panels.length > 0) {
        data.panels.forEach(panel => {
            const mesh = createPanelMesh(panel);
            threeRenderer.panelGroup.add(mesh);
        });
    }
    
    // Add brackets if enabled
    if (state.showBrackets && data.brackets) {
        data.brackets.forEach(bracket => {
            const mesh = createBracketMesh(bracket);
            threeRenderer.bracketGroup.add(mesh);
        });
    }
    
    // Add bolts if enabled
    if (state.showBolts && data.bolts) {
        data.bolts.forEach(bolt => {
            const mesh = createBoltMesh(bolt);
            threeRenderer.boltGroup.add(mesh);
        });
    }
    
    // Update top and side scenes (simplified - just clone beam/panel geometry)
    updateOrthoScenes(data);
}

function updateOrthoScenes(data) {
    // Clear top and side scenes
    const topBeamGroup = threeRenderer.topScene.children[0];
    const topPanelGroup = threeRenderer.topScene.children[1];
    const sideBeamGroup = threeRenderer.sideScene.children[0];
    const sidePanelGroup = threeRenderer.sideScene.children[1];
    
    if (topBeamGroup) clearGroup(topBeamGroup);
    if (topPanelGroup) clearGroup(topPanelGroup);
    if (sideBeamGroup) clearGroup(sideBeamGroup);
    if (sidePanelGroup) clearGroup(sidePanelGroup);
    
    // Add beams to ortho views
    if (data.beams) {
        data.beams.forEach(beam => {
            const topMesh = createBeamMesh(beam, false);
            const sideMesh = createBeamMesh(beam, false);
            if (topBeamGroup) topBeamGroup.add(topMesh);
            if (sideBeamGroup) sideBeamGroup.add(sideMesh);
        });
    }
    
    // Add panels to ortho views
    if (data.panels && data.panels.length > 0) {
        data.panels.forEach(panel => {
            const topMesh = createPanelMesh(panel);
            const sideMesh = createPanelMesh(panel);
            if (topPanelGroup) topPanelGroup.add(topMesh);
            if (sidePanelGroup) sidePanelGroup.add(sideMesh);
        });
    }
}

function renderThreeJS(data, structureCenter) {
    // Check if Three.js is loaded
    if (typeof THREE === 'undefined') {
        console.log('Three.js not loaded yet, waiting...');
        return false; // Return false to indicate fallback needed
    }
    
    if (!threeRenderer.initialized) {
        initThreeJS();
    }
    
    // If initialization failed, return false for fallback
    if (!threeRenderer.initialized || !threeRenderer.main) {
        console.log('Three.js not initialized');
        return false;
    }
    
    // Ensure WebGL canvas is visible and 2D canvas is hidden
    const mainWebGLCanvas = document.getElementById('canvas-webgl');
    const main2DCanvas = document.getElementById('canvas');
    if (mainWebGLCanvas) mainWebGLCanvas.style.display = 'block';
    if (main2DCanvas) main2DCanvas.style.display = 'none';
    
    // Update renderer sizes using the WebGL canvases
    const viewport = document.getElementById('viewport');
    if (mainWebGLCanvas && viewport) {
        const w = viewport.clientWidth;
        const h = viewport.clientHeight;
        mainWebGLCanvas.width = w;
        mainWebGLCanvas.height = h;
        threeRenderer.main.setSize(w, h, false);
    }
    
    const topWebGLCanvas = document.getElementById('canvas-top-webgl');
    const top2DCanvas = document.getElementById('canvas-top');
    const topSection = document.getElementById('top-view-section');
    if (topWebGLCanvas) topWebGLCanvas.style.display = 'block';
    if (top2DCanvas) top2DCanvas.style.display = 'none';
    if (topWebGLCanvas && topSection && threeRenderer.top) {
        const tw = topSection.clientWidth;
        const th = topSection.clientHeight;
        topWebGLCanvas.width = tw;
        topWebGLCanvas.height = th;
        threeRenderer.top.setSize(tw, th, false);
    }
    
    const sideWebGLCanvas = document.getElementById('canvas-side-webgl');
    const side2DCanvas = document.getElementById('canvas-side');
    const sideSection = document.getElementById('side-view-section');
    if (sideWebGLCanvas) sideWebGLCanvas.style.display = 'block';
    if (side2DCanvas) side2DCanvas.style.display = 'none';
    if (sideWebGLCanvas && sideSection && threeRenderer.side) {
        const sw = sideSection.clientWidth;
        const sh = sideSection.clientHeight;
        sideWebGLCanvas.width = sw;
        sideWebGLCanvas.height = sh;
        threeRenderer.side.setSize(sw, sh, false);
    }
    
    // Update scenes
    updateThreeJSScenes(data);
    
    // Update cameras
    updateMainCamera(structureCenter);
    updateTopCamera(data, structureCenter);
    updateSideCamera(data, structureCenter);
    
    // Update grid position
    updateGridPosition(structureCenter);
    
    // Render all views
    threeRenderer.main.render(threeRenderer.mainScene, threeRenderer.mainCamera);
    
    if (threeRenderer.top && threeRenderer.topCamera) {
        threeRenderer.top.render(threeRenderer.topScene, threeRenderer.topCamera);
    }
    
    if (threeRenderer.side && threeRenderer.sideCamera) {
        threeRenderer.side.render(threeRenderer.sideScene, threeRenderer.sideCamera);
    }
    
    return true; // Success
}

// ============================================================================
