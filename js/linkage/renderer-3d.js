// ============================================================================ (ES module)

import { bridgeGlobals } from './global-bridge.js';
import { clearMeshStructureCache } from './cache.js';
import { configureRenderer, installStudio, applySkyModel, updateStudioFrame } from './render-studio.js';
import { skyModelForState, studioModel } from './sky-model.js';
import { updateIbcPower } from './ibc-power.js';
import { getWoodMaterial, getHardwareMaterial, getPanelMaterials, woodUvScale, cloneMaterialForMutation } from './materials.js';

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
    mainScene: null,
    mainCamera: null,
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
    coveringGroup: null,      // Coverings root (child of structureGroup): walls / fabric / tables / pick quads / dims
    coveringWallGroup: null,
    coveringFabricGroup: null,
    coveringTableGroup: null,
    coveringShadeGroup: null,
    coveringPickGroup: null,
    coveringDimGroup: null,
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
    clearMeshStructureCache();
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
            alpha: true,                  // transparent: the CSS sky gradient shows through
            logarithmicDepthBuffer: true  // Better depth precision for close objects
        });
        // sRGB output, ACES tone mapping, physical light units, soft shadows, capped DPR
        configureRenderer(threeRenderer.main);
        
    } catch (e) {
        console.error('Failed to create WebGL renderers:', e);
        return;
    }
    
    // Scene background stays null: the sky is a CSS gradient behind the transparent canvas
    threeRenderer.mainScene = new THREE.Scene();
    threeRenderer.mainScene.background = null;
    
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

    // Coverings (plywood walls, fabric, tables) rotate with the structure
    threeRenderer.coveringGroup = new THREE.Group();
    threeRenderer.coveringGroup.name = 'Coverings';
    threeRenderer.coveringWallGroup = new THREE.Group();
    threeRenderer.coveringFabricGroup = new THREE.Group();
    threeRenderer.coveringTableGroup = new THREE.Group();
    threeRenderer.coveringShadeGroup = new THREE.Group();
    threeRenderer.coveringPickGroup = new THREE.Group();
    threeRenderer.coveringDimGroup = new THREE.Group();
    threeRenderer.coveringGroup.add(threeRenderer.coveringWallGroup);
    threeRenderer.coveringGroup.add(threeRenderer.coveringFabricGroup);
    threeRenderer.coveringGroup.add(threeRenderer.coveringTableGroup);
    threeRenderer.coveringGroup.add(threeRenderer.coveringShadeGroup);
    threeRenderer.coveringGroup.add(threeRenderer.coveringPickGroup);
    threeRenderer.coveringGroup.add(threeRenderer.coveringDimGroup);
    threeRenderer.structureGroup.add(threeRenderer.coveringGroup);
    
    // Create group for 3D measurement lines
    threeRenderer.measurementGroup = new THREE.Group();
    
    threeRenderer.mainScene.add(threeRenderer.structureGroup);
    threeRenderer.mainScene.add(threeRenderer.panelGroupRoot);
    threeRenderer.mainScene.add(threeRenderer.actuatorLineGroup);
    threeRenderer.mainScene.add(threeRenderer.humanScaleGroup);
    threeRenderer.mainScene.add(threeRenderer.measurementGroup);
    
    // Setup cameras
    createMainCamera();
    
    // Lights, environment map, ground, grid, stars and moon (render-studio.js),
    // then the time-of-day model from the sun slider.
    installStudio(threeRenderer);
    updateSunPosition();
    
    threeRenderer.initialized = true;
    console.log('Three.js initialized successfully');
}

/**
 * Creates the main perspective camera
 */
function createMainCamera() {
    const viewport = document.getElementById('viewport');
    const aspect = viewport ? (viewport.clientWidth / viewport.clientHeight) : 1.5;
    // Near plane at 10 gives better depth precision (log depth buffer); far clears the star dome
    threeRenderer.mainCamera = new THREE.PerspectiveCamera(45, aspect, 10, 20000);
    updateMainCamera();
}

/**
 * Updates the main camera position based on state.cam values
 */
function updateMainCamera(structureCenter = null) {
    const cam = state.cam;
    // Build-step playback can pin the orbit/look-at point to a part (cam.target).
    // The parts detail view always looks at its focus target (passed in as
    // structureCenter), so a stale pin from the step editor must not win there.
    const partView = state.hwDetailMode && !(state.buildPlayback && state.buildPlayback.active);
    const sc = (!partView && cam && cam.target) || structureCenter || { x: 0, y: 0, z: 0 };
    
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
    
    // Update aspect ratio from the canvas's current container (the canvas is
    // reparented into the hardware modal viewport in part view).
    const mainWebGLCanvas = document.getElementById('canvas-webgl');
    const sizeEl = (mainWebGLCanvas && mainWebGLCanvas.parentElement) || document.getElementById('viewport');
    let projDirty = false;
    if (sizeEl && sizeEl.clientWidth > 0 && sizeEl.clientHeight > 0 && threeRenderer.mainCamera) {
        threeRenderer.mainCamera.aspect = sizeEl.clientWidth / sizeEl.clientHeight;
        projDirty = true;
    }
    // Small hardware stacks sit close to the camera in part view; a 10 in near plane clips them.
    const near = partView ? 0.5 : 10;
    if (threeRenderer.mainCamera && threeRenderer.mainCamera.near !== near) {
        threeRenderer.mainCamera.near = near;
        projDirty = true;
    }
    if (projDirty && threeRenderer.mainCamera) threeRenderer.mainCamera.updateProjectionMatrix();
}

/**
 * Sets up lighting for the main scene. The rig now lives in render-studio.js;
 * this remains for callers that expect the legacy entry point.
 */
function setupThreeJSLighting() {
    installStudio(threeRenderer);
    updateSunPosition();
}

/**
 * Applies the time of day (state.sunTime, 0-100 over a 24 h clock) to the light
 * rig: real solar azimuth/elevation for the configured latitude and day of year,
 * then the StarShade-style sky model (sun colour and strength, moon, hemisphere,
 * exposure, environment scale, sky gradient, stars). Part view uses neutral studio light.
 */
function updateSunPosition() {
    if (!threeRenderer.studio) return;
    const model = state.hwDetailMode ? studioModel() : skyModelForState(state);
    applySkyModel(model, threeRenderer);
    updateIbcPower();
    const timeDisplay = document.getElementById('sun-time-display');
    if (timeDisplay && model.clock) timeDisplay.textContent = model.clock;
}

/**
 * Legacy hook: the sky is now driven by updateSunPosition() / applySkyModel().
 */
function updateSkyColor() {
    if (threeRenderer.mainScene) threeRenderer.mainScene.background = null;
}

/**
 * Legacy hook: the permanent shadow-catcher ground lives in render-studio.js.
 */
function updateGroundPlane() {
    /* ground is permanent; kept for callers */
}

/**
 * Legacy hook: the tinted grid is created by render-studio.js and stays visible.
 */
function createGridMesh() {
    installStudio(threeRenderer);
}

/**
 * Legacy hook: the grid no longer hides when shadows are on.
 */
function updateGridVisibility() {
    if (threeRenderer.gridHelper) threeRenderer.gridHelper.visible = true;
}

/**
 * Updates grid position based on structure center
 */
function updateGridPosition(structureCenter, radius, groundY) {
    if (structureCenter) updateStudioFrame(structureCenter, radius, threeRenderer, groundY);
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
    const uvs = [];
    const indices = [];

    // Planar UVs: u runs along the beam length (grain), v across the section.
    const uScale = woodUvScale(beamLen) / Math.max(beamLen, 1e-6);
    function pushVertex(x, y, z, nx, ny, nz) {
        const i = positions.length / 3;
        positions.push(x, y, z);
        normals.push(nx, ny, nz);
        uvs.push((x + halfL) * uScale, ((y + halfOther) / Math.max(2 * halfOther, 1e-6) + (z + halfD) / Math.max(2 * halfD, 1e-6)) * 0.5);
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
    // Planar UVs (grain along the beam); some glTF importers (SketchUp) also require a uv attribute.
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));

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
    
    // Build vertices, normals and planar UVs (grain along the beam) for each face separately
    const positions = [];
    const normals = [];
    const uvs = [];
    const beamLen = Math.hypot(c[4].x - c[0].x, c[4].y - c[0].y, c[4].z - c[0].z);
    const uL = woodUvScale(beamLen);   // u at the far end of the beam
    
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
    
    // Helper to add a quad with outward-facing normal and per-corner UVs
    function addQuad(p0, p1, p2, p3, uv) {
        const faceCenter = {
            x: (p0.x + p1.x + p2.x + p3.x) / 4,
            y: (p0.y + p1.y + p2.y + p3.y) / 4,
            z: (p0.z + p1.z + p2.z + p3.z) / 4
        };
        const n = calcOutwardNormal(p0, p1, p2, faceCenter, beamCenter);
        // Keep the winding consistent with the outward normal: double-sided lighting
        // flips the normal on back faces, so a reversed quad would render unlit.
        const wx = (p1.y - p0.y) * (p2.z - p0.z) - (p1.z - p0.z) * (p2.y - p0.y);
        const wy = (p1.z - p0.z) * (p2.x - p0.x) - (p1.x - p0.x) * (p2.z - p0.z);
        const wz = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
        if (wx * n.x + wy * n.y + wz * n.z < 0) {
            const t = p1; p1 = p3; p3 = t;
            uv = [uv[0], uv[3], uv[2], uv[1]];
        }
        
        // Triangle 1: p0, p1, p2
        positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        normals.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
        uvs.push(uv[0][0], uv[0][1], uv[1][0], uv[1][1], uv[2][0], uv[2][1]);
        // Triangle 2: p0, p2, p3
        positions.push(p0.x, p0.y, p0.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
        normals.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
        uvs.push(uv[0][0], uv[0][1], uv[2][0], uv[2][1], uv[3][0], uv[3][1]);
    }
    
    // Add all 6 faces - winding order doesn't matter now since we force outward normals.
    // Corners 0-3 are the near end, 4-7 the far end (c[i+4] is c[i] moved along the beam).
    const END_UV = [[0, 0], [0.12, 0], [0.12, 1], [0, 1]];
    addQuad(c[0], c[1], c[2], c[3], END_UV);                              // Near end
    addQuad(c[4], c[7], c[6], c[5], END_UV);                              // Far end
    addQuad(c[0], c[4], c[5], c[1], [[0, 0], [uL, 0], [uL, 1], [0, 1]]);  // Bottom
    addQuad(c[2], c[6], c[7], c[3], [[0, 0], [uL, 0], [uL, 1], [0, 1]]);  // Top
    addQuad(c[0], c[3], c[7], c[4], [[0, 0], [0, 1], [uL, 1], [uL, 0]]);  // Left
    addQuad(c[1], c[5], c[6], c[2], [[0, 0], [uL, 0], [uL, 1], [0, 1]]);  // Right
    
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    
    // Shared wood material (grain texture, PBR) keyed by the beam's state colour.
    // Cached: callers that fade/tint a beam clone the material first.
    const material = getWoodMaterial(beam, isColliding);

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
 * Builds a closed box from a panel's 8 corners (0-3 bottom face, 4-7 top face,
 * corner k+4 above corner k) with per-face UVs and three material groups:
 * 0 = top (cells), 1 = bottom (backsheet), 2 = the four frame sides.
 */
function buildPanelBoxGeometry(c) {
    const positions = [], normals = [], uvs = [];
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < 8; i++) { cx += c[i].x; cy += c[i].y; cz += c[i].z; }
    const center = { x: cx / 8, y: cy / 8, z: cz / 8 };
    const addQuad = (q0, q1, q2, q3, uvIn) => {
        let p = [q0, q1, q2, q3], uv = uvIn;
        const faceNormal = (a, b, c) => {
            const ax = b.x - a.x, ay = b.y - a.y, az = b.z - a.z;
            const bx = c.x - a.x, by = c.y - a.y, bz = c.z - a.z;
            const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
            const len = Math.hypot(nx, ny, nz) || 1;
            return { x: nx / len, y: ny / len, z: nz / len };
        };
        let n = faceNormal(p[0], p[1], p[2]);
        const fx = (q0.x + q1.x + q2.x + q3.x) / 4, fy = (q0.y + q1.y + q2.y + q3.y) / 4, fz = (q0.z + q1.z + q2.z + q3.z) / 4;
        // Winding must agree with the outward normal (double-sided lighting flips by gl_FrontFacing)
        if (n.x * (center.x - fx) + n.y * (center.y - fy) + n.z * (center.z - fz) > 0) {
            p = [q0, q3, q2, q1];
            uv = [uvIn[0], uvIn[3], uvIn[2], uvIn[1]];
            n = faceNormal(p[0], p[1], p[2]);
        }
        const tri = (a, b, d, ua, ub, ud) => {
            positions.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z);
            normals.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
            uvs.push(ua[0], ua[1], ub[0], ub[1], ud[0], ud[1]);
        };
        tri(p[0], p[1], p[2], uv[0], uv[1], uv[2]);
        tri(p[0], p[2], p[3], uv[0], uv[2], uv[3]);
    };
    const FULL = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const SIDE = [[0, 0], [1, 0], [1, 0.08], [0, 0.08]];
    addQuad(c[4], c[5], c[6], c[7], FULL);   // top: cells (u along width, v along length)
    addQuad(c[0], c[1], c[2], c[3], FULL);   // bottom: backsheet
    addQuad(c[0], c[1], c[5], c[4], SIDE);   // sides: frame
    addQuad(c[1], c[2], c[6], c[5], SIDE);
    addQuad(c[2], c[3], c[7], c[6], SIDE);
    addQuad(c[3], c[0], c[4], c[7], SIDE);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geometry.addGroup(0, 6, 0);
    geometry.addGroup(6, 6, 1);
    geometry.addGroup(12, 24, 2);
    return geometry;
}

/**
 * Creates a Three.js mesh from a Panel3D object: one box mesh with the
 * procedural cell sheet (clearcoat glass) on top, an anodised frame on the
 * sides and a white backsheet underneath. Keeps userData.panel / type on the
 * top-level object for pickers, build steps and coverings.
 */
function createPanelMesh(panel) {
    if (panel.formFactor === 'folding') return createFoldingPanelMesh(panel);
    if (panel.formFactor === 'flexible') return createFlexiblePanelMesh(panel);
    const c = panel.corners;
    if (!c || c.length < 8) return new THREE.Group();
    const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const extentU = panel.width || dist(c[4], c[5]);
    const extentV = panel.length || dist(c[4], c[7]);
    const mats = getPanelMaterials(extentU, extentV);
    const mesh = new THREE.Mesh(buildPanelBoxGeometry(c), [mats.cell, mats.back, mats.frame]);
    mesh.userData.panel = panel;
    mesh.userData.type = 'panel';
    mesh.renderOrder = 2;
    mesh.castShadow = state.shadowsEnabled || false;
    mesh.receiveShadow = state.shadowsEnabled || false;
    return mesh;
}

/**
 * Creates a Three.js mesh for a bracket
 */
function createBracketMesh(bracket) {
    const material = getHardwareMaterial('bracket', 0x1a1a1a, { polygonOffset: 0.5, metalness: 0.7, roughness: 0.45 });
    
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
    const material = getHardwareMaterial('bolt-' + (bolt.diagnosticState || ''), boltColor, { polygonOffset: -1, metalness: 0.8, roughness: 0.35 });
    
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
    
    const material = getHardwareMaterial('washer', 0x2a2a2a, { polygonOffset: -1, metalness: 0.75, roughness: 0.4 });
    
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


// ============================================================================
// COVERINGS (plywood walls / fabric / tables)
// ============================================================================

const COVERING_COLORS = {
    wall: 0xd4b27a,
    table: 0xc9a86a,
    fabric: 0xe6e2d3,
};

/**
 * Builds a closed slab (6 quads) from 8 corners: [4 on one face, 4 on the opposite
 * face, same winding]. Winding is fixed per face so normals point outward.
 */
function buildSlabGeometry(c) {
    // c = n corners of one face followed by the n corners of the opposite face (same winding)
    const n = c.length / 2;
    const cx = c.reduce((a, p) => a + p.x, 0) / c.length;
    const cy = c.reduce((a, p) => a + p.y, 0) / c.length;
    const cz = c.reduce((a, p) => a + p.z, 0) / c.length;
    const pos = [];
    const pushTri = (p0, p1, p2, faceCenter) => {
        // wind so the triangle normal points away from the slab centre
        const ax = p1.x - p0.x, ay = p1.y - p0.y, az = p1.z - p0.z;
        const bx = p2.x - p0.x, by = p2.y - p0.y, bz = p2.z - p0.z;
        const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        const flip = (nx * (faceCenter.x - cx) + ny * (faceCenter.y - cy) + nz * (faceCenter.z - cz)) < 0;
        const tri = flip ? [p0, p2, p1] : [p0, p1, p2];
        tri.forEach(p => pos.push(p.x, p.y, p.z));
    };
    const faceCenter = (idx) => ({
        x: idx.reduce((a, i) => a + c[i].x, 0) / idx.length,
        y: idx.reduce((a, i) => a + c[i].y, 0) / idx.length,
        z: idx.reduce((a, i) => a + c[i].z, 0) / idx.length,
    });
    // the two faces (fan triangulation, fine for convex polygons)
    [0, n].forEach(off => {
        const idx = Array.from({ length: n }, (_, i) => off + i);
        const fc = faceCenter(idx);
        for (let i = 1; i < n - 1; i++) pushTri(c[off], c[off + i], c[off + i + 1], fc);
    });
    // the sides
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const q = [i, j, j + n, i + n];
        const fc = faceCenter(q);
        pushTri(c[q[0]], c[q[1]], c[q[2]], fc);
        pushTri(c[q[0]], c[q[2]], c[q[3]], fc);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
}

function coveringMaterialFor(kind) {
    if (kind === 'shade') {
        const sc = state.shadeCloth || {};
        const op = Math.max(0.05, Math.min(1, typeof sc.opacity === 'number' ? sc.opacity : 0.75));
        const hex = typeof sc.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(sc.color) ? sc.color.toLowerCase() : '#6f8f86';
        return getCachedMaterial(`covering-shade-${hex}-${Math.round(op * 100)}`, () => {
            // The colour stays the raw user hex (readouts and tests compare it); only the
            // environment contribution is tamed so the tarp does not blow out at noon.
            const m = new THREE.MeshStandardMaterial({
                color: parseInt(hex.slice(1), 16), roughness: 1, metalness: 0,
                transparent: op < 1, opacity: op, side: THREE.DoubleSide, depthWrite: op >= 0.95,
            });
            m.envMapIntensity = 0.25;
            return m;
        });
    }
    if (kind === 'fabric') {
        return getCachedMaterial('covering-fabric', () => {
            const m = new THREE.MeshStandardMaterial({
                color: new THREE.Color(COVERING_COLORS.fabric).convertSRGBToLinear(), roughness: 1, metalness: 0,
                transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false,
            });
            m.envMapIntensity = 0.3;
            return m;
        });
    }
    const color = kind === 'table' ? COVERING_COLORS.table : COVERING_COLORS.wall;
    return getCachedMaterial(`covering-${kind}`, () => {
        const m = new THREE.MeshStandardMaterial({
            color: new THREE.Color(color).convertSRGBToLinear(), roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
        });
        m.envMapIntensity = 0.3;
        return m;
    });
}

/**
 * Mesh for one covering shape (from coverings-geometry). Tagged with
 * userData.covering for picking / build steps.
 */
function createCoveringMesh(shape) {
    const corners = shape.slabCorners3D && shape.slabCorners3D.length >= 6 && shape.slabCorners3D.length % 2 === 0
        ? shape.slabCorners3D
        : shape.corners3D.concat(shape.corners3D);
    const mesh = new THREE.Mesh(buildSlabGeometry(corners), coveringMaterialFor(shape.kind));
    mesh.userData.covering = shape;
    mesh.userData.type = 'covering';
    // opaque tarps shade the interior; translucent fabric and mesh do not cast
    const shadeOpaque = shape.kind === 'shade' && state.shadeCloth && state.shadeCloth.opacity >= 0.95;
    mesh.castShadow = (state.shadowsEnabled || false) && shape.kind !== 'fabric' && (shape.kind !== 'shade' || shadeOpaque);
    mesh.receiveShadow = state.shadowsEnabled || false;
    mesh.renderOrder = shape.kind === 'fabric' || shape.kind === 'shade' ? 3 : 1;
    // Edge outline so plywood reads as a sheet, not a blob (shade cloths get a light seam line)
    if (shape.kind !== 'fabric') {
        const edges = new THREE.EdgesGeometry(mesh.geometry, 20);
        const line = new THREE.LineSegments(edges, getCachedMaterial('covering-edge', () =>
            new THREE.LineBasicMaterial({ color: 0x5a4a30, transparent: true, opacity: 0.6 })));
        line.userData.coveringEdge = true;
        mesh.add(line);
    }
    return mesh;
}

/** Translucent quad for an empty span/band so it can be clicked in pick mode. */
function createCoveringPickMesh(quad, highlighted = false) {
    const c = quad.corners3D;
    const geo = new THREE.BufferGeometry();
    const pos = [c[0], c[1], c[2], c[0], c[2], c[3]].flatMap(p => [p.x, p.y, p.z]);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const mat = getCachedMaterial(highlighted ? 'covering-pick-hi' : 'covering-pick', () => new THREE.MeshBasicMaterial({
        color: highlighted ? 0x67e8f9 : 0x22d3ee, transparent: true, opacity: highlighted ? 0.35 : 0.14,
        side: THREE.DoubleSide, depthWrite: false,
    }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.coveringPick = { spanIndex: quad.spanIndex, band: quad.band };
    mesh.userData.type = 'coveringPick';
    mesh.renderOrder = 4;
    return mesh;
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
    createCoveringMesh,
    createCoveringPickMesh,
    buildSlabGeometry,
    clearGroup,
    ibcStackLayoutCacheKey,
};

    Object.defineProperty(globalThis, 'ibcStackLayoutCacheKey', {
        get() { return ibcStackLayoutCacheKey; },
        set(v) { ibcStackLayoutCacheKey = v; },
        configurable: true
    });

bridgeGlobals(_moduleExports, 'renderer3d');

export { threeRenderer, ibcGlbState, getCachedMaterial, getCachedGeometry, invalidateMeshCaches, initThreeJS, createMainCamera, updateMainCamera, setupThreeJSLighting, updateSunPosition, updateGroundPlane, updateGridVisibility, updateGridPosition, rgbToThreeColor, getBeamBoltIntersections, buildBeamMeshWithHoles, createBeamMesh, createPanelMesh, createBracketMesh, createBoltMesh, createWasherMesh, createCoveringMesh, createCoveringPickMesh, buildSlabGeometry, clearGroup, ibcStackLayoutCacheKey };
