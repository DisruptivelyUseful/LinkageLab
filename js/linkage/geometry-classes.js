// ============================================================================
// LINKAGE LAB — Geometry classes (Beam3D, Bracket3D, RoofFace, etc.) (ES module)
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { degToRad, vAdd, vCross, vDot, vNorm, vScale, vSub } from './math.js';

// ============================================================================
// GEOMETRY CLASSES
// ============================================================================

/**
 * Represents a 3D beam with rectangular cross-section
 */
class Beam3D {
    /**
     * Creates a 3D beam from start to end point
     * @param {{x: number, y: number, z: number}} start - Start point
     * @param {{x: number, y: number, z: number}} end - End point
     * @param {number} width - Beam width
     * @param {number} thick - Beam thickness
     * @param {{r: number, g: number, b: number}} colorBase - Base color RGB
     */
    constructor(start, end, width, thick, colorBase, metadata = {}) {
        this.type = 'beam';
        this.center = vScale(vAdd(start, end), 0.5);
        this.colorBase = colorBase;
        // Store metadata for collision detection
        this.moduleIndex = metadata.moduleIndex !== undefined ? metadata.moduleIndex : -1;
        this.stackType = metadata.stackType || 'unknown';
        this.stackId = metadata.stackId !== undefined ? metadata.stackId : -1;
        this.patternId = metadata.patternId || null;
        this.kinematicState = metadata.kinematicState || null;
        
        // Calculate local coordinate system
        this.axisZ = vNorm(vSub(end, start));
        let up = {x: 0, y: 1, z: 0};
        if (Math.abs(this.axisZ.y) > 0.99) up = {x: 1, y: 0, z: 0};
        this.axisX = vNorm(vCross(this.axisZ, up));
        this.axisY = vNorm(vCross(this.axisX, this.axisZ));
        
        // Generate corner vertices
        const hw = width / 2;
        const ht = thick / 2;
        this.corners = [];
        const offsets = [
            {u: -hw, v: -ht}, {u: hw, v: -ht},
            {u: hw, v: ht}, {u: -hw, v: ht}
        ];
        
        [start, end].forEach(c => {
            offsets.forEach(o => {
                let p = vAdd(c, vScale(this.axisX, o.u));
                p = vAdd(p, vScale(this.axisY, o.v));
                this.corners.push(p);
            });
        });

        // Define faces with normals for lighting
        this.faces = [
            { idx: [0, 3, 2, 1], norm: vScale(this.axisZ, -1) },
            { idx: [4, 5, 6, 7], norm: this.axisZ },
            { idx: [0, 1, 5, 4], norm: vScale(this.axisY, -1) },
            { idx: [3, 7, 6, 2], norm: this.axisY },
            { idx: [0, 4, 7, 3], norm: vScale(this.axisX, -1) },
            { idx: [1, 2, 6, 5], norm: this.axisX }
        ];
        this.p1 = start;
        this.p2 = end;
        this.w = width;
        this.t = thick;
    }
}

/**
 * Represents a 3D bracket component
 */
class Bracket3D {
    /**
     * Creates a 3D bracket
     * @param {{x: number, y: number, z: number}} pos - Position
     * @param {{x: number, y: number, z: number}} dirUp - Up direction
     * @param {{x: number, y: number, z: number}} dirFwd - Forward direction
     * @param {number} width - Base width
     */
    constructor(pos, dirUp, dirFwd, width) {
        this.type = 'bracket';
        this.pos = pos;
        this.w = width * BRACKET_SIZE_MULT;
        this.h = width * BRACKET_SIZE_MULT;
        this.d = BRACKET_DEPTH;
    }
}

/**
 * Represents a 3D solar panel with rectangular shape
 * Panels are flat rectangles that can be rotated around their center
 */
class Panel3D {
    /**
     * Creates a 3D solar panel
     * @param {{x: number, y: number, z: number}} center - Center point of the panel
     * @param {number} width - Panel width (X direction when rotation=0)
     * @param {number} length - Panel length (Z direction when rotation=0)
     * @param {number} thickness - Panel thickness (Y direction)
     * @param {number} rotation - Rotation around Y axis in radians
     * @param {{x: number, y: number, z: number}} normal - Surface normal (default Y-up for horizontal)
     */
    constructor(center, width, length, thickness, rotation = 0, normal = {x: 0, y: 1, z: 0}) {
        this.type = 'panel';
        this.center = center;
        this.width = width;
        this.length = length;
        this.thickness = thickness;
        this.rotation = rotation;
        this.normal = normal;
        
        // Dark blue color for solar panel top surface
        this.colorBase = {r: 25, g: 50, b: 120};
        // Lighter blue for grid lines
        this.gridColor = {r: 60, g: 90, b: 160};
        // Black for edges and frame
        this.frameColor = {r: 20, g: 20, b: 25};
        // White backsheet for bottom
        this.backColor = {r: 240, g: 240, b: 245};
        // Border width in inches
        this.borderWidth = 1.0;
        
        // Calculate local coordinate system
        // Default: panel lies in XZ plane with Y as up (thickness direction)
        const cosR = Math.cos(rotation);
        const sinR = Math.sin(rotation);
        
        // For horizontal panels (normal pointing up)
        if (Math.abs(normal.y) > 0.99) {
            this.axisX = {x: cosR, y: 0, z: sinR};  // Width direction
            this.axisZ = {x: -sinR, y: 0, z: cosR}; // Length direction
            this.axisY = {x: 0, y: 1, z: 0};        // Thickness direction (up)
        } else {
            // For tilted/vertical panels (arch mode)
            // Use the provided normal as the thickness direction
            this.axisY = vNorm(normal);
            // Create perpendicular axes
            let up = {x: 0, y: 1, z: 0};
            if (Math.abs(vDot(this.axisY, up)) > 0.99) {
                up = {x: 1, y: 0, z: 0};
            }
            this.axisX = vNorm(vCross(up, this.axisY));
            this.axisZ = vNorm(vCross(this.axisY, this.axisX));
            
            // Apply rotation around normal
            const tempX = this.axisX;
            const tempZ = this.axisZ;
            this.axisX = vAdd(vScale(tempX, cosR), vScale(tempZ, sinR));
            this.axisZ = vAdd(vScale(tempX, -sinR), vScale(tempZ, cosR));
        }
        
        // Generate 8 corner vertices (box shape)
        const hw = width / 2;
        const hl = length / 2;
        const ht = thickness / 2;
        
        this.corners = [];
        // Bottom face (Y = -ht)
        // Corner order: starting at -X,-Z and going around
        const bottomOffsets = [
            {x: -hw, z: -hl}, {x: hw, z: -hl},
            {x: hw, z: hl}, {x: -hw, z: hl}
        ];
        
        // Generate bottom corners
        bottomOffsets.forEach(o => {
            let p = vAdd(center, vScale(this.axisX, o.x));
            p = vAdd(p, vScale(this.axisZ, o.z));
            p = vAdd(p, vScale(this.axisY, -ht));
            this.corners.push(p);
        });
        
        // Generate top corners
        bottomOffsets.forEach(o => {
            let p = vAdd(center, vScale(this.axisX, o.x));
            p = vAdd(p, vScale(this.axisZ, o.z));
            p = vAdd(p, vScale(this.axisY, ht));
            this.corners.push(p);
        });
        
        // Define faces with normals for lighting
        // Same structure as Beam3D: bottom, top, front, back, left, right
        this.faces = [
            { idx: [0, 3, 2, 1], norm: vScale(this.axisY, -1) },  // Bottom
            { idx: [4, 5, 6, 7], norm: this.axisY },              // Top (visible solar surface)
            { idx: [0, 1, 5, 4], norm: vScale(this.axisZ, -1) },  // Front
            { idx: [3, 7, 6, 2], norm: this.axisZ },              // Back
            { idx: [0, 4, 7, 3], norm: vScale(this.axisX, -1) },  // Left
            { idx: [1, 2, 6, 5], norm: this.axisX }               // Right
        ];
        
        // Store grid line data for rendering solar cell pattern
        this.gridLines = this.calculateGridLines();
    }
    
    /**
     * Calculate grid lines for solar cell pattern on top surface
     * @returns {Array} Array of line segments for grid pattern
     */
    calculateGridLines() {
        const lines = [];
        const hw = this.width / 2;
        const hl = this.length / 2;
        const ht = this.thickness / 2 + 0.1; // Slightly above surface
        
        // Number of cells in each direction
        const cellsX = Math.max(2, Math.floor(this.width / 6));
        const cellsZ = Math.max(2, Math.floor(this.length / 6));
        
        // Vertical lines (along Z)
        for (let i = 0; i <= cellsX; i++) {
            const x = -hw + (i / cellsX) * this.width;
            const start = vAdd(vAdd(vAdd(this.center, vScale(this.axisX, x)), vScale(this.axisZ, -hl)), vScale(this.axisY, ht));
            const end = vAdd(vAdd(vAdd(this.center, vScale(this.axisX, x)), vScale(this.axisZ, hl)), vScale(this.axisY, ht));
            lines.push({start, end});
        }
        
        // Horizontal lines (along X)
        for (let i = 0; i <= cellsZ; i++) {
            const z = -hl + (i / cellsZ) * this.length;
            const start = vAdd(vAdd(vAdd(this.center, vScale(this.axisX, -hw)), vScale(this.axisZ, z)), vScale(this.axisY, ht));
            const end = vAdd(vAdd(vAdd(this.center, vScale(this.axisX, hw)), vScale(this.axisZ, z)), vScale(this.axisY, ht));
            lines.push({start, end});
        }
        
        return lines;
    }
}

/** Solar panel form factors (commercial categories). */
const SP_FORM_FACTORS = {
    framed: { label: 'Framed (rigid aluminum)' },
    flexible: { label: 'Flexible (thin film)' },
    folding: { label: 'Folding (multi-segment)' }
};

/**
 * Build a solar panel instance with form-factor metadata for 3D rendering.
 */
function makeSolarPanel(center, width, length, thickness, rotation, normal, spec) {
    const panel = new Panel3D(center, width, length, thickness, rotation, normal);
    const s = spec || {};
    panel.formFactor = s.formFactor || 'framed';
    panel.foldCount = s.foldCount || 4;
    panel.foldDeploy = s.foldDeploy != null ? s.foldDeploy : 1;
    panel.foldDirection = s.foldDirection != null ? s.foldDirection : 1;
    panel.foldedLength = s.foldedLength;
    panel.foldedWidth = s.foldedWidth;
    panel.foldedThickness = s.foldedThickness;
    panel.weight = s.weight != null ? s.weight : 45;
    if (panel.formFactor === 'flexible') {
        panel.borderWidth = 0.15;
    }
    return panel;
}

function spPanelSpecFromConfig(cfg) {
    if (!cfg) return {};
    return {
        formFactor: cfg.formFactor || 'framed',
        foldCount: cfg.foldCount || 4,
        foldDeploy: cfg.foldDeploy != null ? cfg.foldDeploy : 1,
        foldedLength: cfg.foldedLength,
        foldedWidth: cfg.foldedWidth,
        foldedThickness: cfg.foldedThickness,
        weight: cfg.weight != null ? cfg.weight : 45
    };
}

function getPanelWeightLbs(panel) {
    if (panel && panel.weight != null && panel.weight > 0) return panel.weight;
    return 0;
}

function calculateSolarPanelArrayWeight(panels) {
    if (!panels || !panels.length) return 0;
    return panels.reduce((sum, p) => sum + getPanelWeightLbs(p), 0);
}

function getSolarPanelWeightSummary(data) {
    const panels = data && data.panels;
    const count = panels ? panels.length : 0;
    if (count > 0) {
        const total = calculateSolarPanelArrayWeight(panels);
        return { count, total, perUnit: total / count };
    }
    const cfg = getActivePanelConfig();
    const perUnit = cfg.weight != null ? cfg.weight : 0;
    return { count: 0, total: 0, perUnit };
}

/** Row index → fold direction so multi-row grids meet at the center (±1). */
function spFoldDirectionForGridRow(row, gridRows) {
    if (gridRows <= 1) return 1;
    const rowOffset = row - (gridRows - 1) / 2;
    return rowOffset <= 0 ? 1 : -1;
}

function spPanelSpecForGridCell(config, row) {
    const spec = spPanelSpecFromConfig(config);
    if (spec.formFactor === 'folding') {
        spec.foldDirection = spFoldDirectionForGridRow(row, config.gridRows || 1);
    }
    return spec;
}

function hasFoldingSolarPanels() {
    if (!state.solarPanels || !state.solarPanels.enabled) return false;
    const top = state.solarPanels.topPanels;
    const side = state.solarPanels.sidePanels;
    return !!(top && top.formFactor === 'folding') || !!(side && side.formFactor === 'folding');
}

/** Structure fully folded (minimum angle). */
function getStructureFoldedAngle() {
    return getEffectiveMinFoldAngle();
}

/** Structure fully deployed / open (360° ring angle). */
function getStructureDeployedAngle() {
    return getOptimalClosedAngleForAnimation();
}

/** Auto animation deploy: structure deploys first (panels stay stowed), then unfold at deployed angle. */
function getFoldingPanelDeployForAnimation() {
    if (!useFoldingPanelStructureDeploy()) return null;
    const phase = state.animation.foldingPanelPhase;
    if (phase === 'panel_deploy') {
        return state.animation.foldingPanelDeploy;
    }
    return 0;
}

function useFoldingPanelAutoAnim() {
    if (!hasFoldingSolarPanels()) return false;
    if (state.animation && state.animation.playing) return true;
    if (state.actuatorAnimation && state.actuatorAnimation.isPlaying) return true;
    const phase = state.animation && state.animation.foldingPanelPhase;
    return phase === 'stowed' || phase === 'structure_deploy' || phase === 'panel_deploy';
}

function useFoldingPanelStructureDeploy() {
    return useFoldingPanelAutoAnim();
}

function getFoldingPanelsVisibleAtAngle(foldAngleRad) {
    if (!hasFoldingSolarPanels()) return false;
    if (!useFoldingPanelAutoAnim()) {
        return true;
    }
    const phase = state.animation.foldingPanelPhase;
    const deployedA = getStructureDeployedAngle();
    const tol = degToRad(1.5);
    if (phase === 'panel_deploy') {
        return foldAngleRad >= deployedA - tol;
    }
    return false;
}

function applyFoldingPanelAnimationState(panels, foldAngleRad, useStructureDeploy) {
    if (!panels || !panels.length) return;
    const deploy = useStructureDeploy ? getFoldingPanelDeployForAnimation() : null;
    panels.forEach(p => {
        if (!p || p.formFactor !== 'folding') return;
        if (useStructureDeploy) p.foldDeploy = deploy;
    });
}

function animateFoldingPanelDeploy(from, to, duration, onComplete) {
    state.actuatorAnimation.isPlaying = true;
    state.animation.foldingPanelPhase = 'panel_deploy';
    state.animation.foldingPanelsUnfoldPhase = true;
    const startTime = Date.now();
    const speed = state.actuatorAnimation.speed || 1.0;
    const adjustedDuration = duration / speed;

    function step() {
        if (!state.actuatorAnimation.isPlaying) return;
        const elapsed = Date.now() - startTime;
        const t = Math.min(1, elapsed / adjustedDuration);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        state.animation.foldingPanelDeploy = from + (to - from) * eased;
        invalidateGeometryCache();
        requestRender();
        if (t < 1) {
            requestAnimationFrame(step);
        } else {
            state.animation.foldingPanelDeploy = to;
            state.actuatorAnimation.isPlaying = false;
            if (to >= 1 - 1e-6) {
                state.animation.foldingPanelPhase = 'idle';
                state.animation.foldingPanelsUnfoldPhase = false;
            } else {
                state.animation.foldingPanelPhase = 'stowed';
                state.animation.foldingPanelDeploy = 0;
            }
            invalidateGeometryCache();
            requestRender();
            if (onComplete) onComplete();
        }
    }
    step();
}

function runFoldingPanelUnfoldSequence(structureDuration = 3000) {
    if (state.actuatorAnimation.isPlaying) return;
    const deployedAngle = getStructureDeployedAngle();
    const foldedAngle = getStructureFoldedAngle();
    const tol = degToRad(0.5);

    const beginPanelDeploy = () => {
        animateFoldingPanelDeploy(0, 1, FOLDING_PANEL_DEPLOY_MS);
    };

    if (state.foldAngle < deployedAngle - tol) {
        state.animation.foldingPanelPhase = 'structure_deploy';
        state.animation.foldingPanelDeploy = 0;
        state.animation.foldingPanelsUnfoldPhase = true;
        if (state.foldAngle <= foldedAngle + tol) {
            state.animation.foldingPanelPhase = 'stowed';
        }
        animateActuatorFold(deployedAngle, structureDuration, beginPanelDeploy);
    } else {
        state.animation.foldingPanelsUnfoldPhase = true;
        state.animation.foldingPanelDeploy = 0;
        beginPanelDeploy();
    }
}

function runFoldingPanelFoldSequence(structureDuration = 3000) {
    if (state.actuatorAnimation.isPlaying) return;
    const foldedAngle = getStructureFoldedAngle();

    const foldStructure = () => {
        animateActuatorFold(foldedAngle, structureDuration, () => {
            state.animation.foldingPanelPhase = 'stowed';
            state.animation.foldingPanelDeploy = 0;
            state.animation.foldingPanelsUnfoldPhase = true;
            invalidateGeometryCache();
            requestRender();
        });
    };

    const manualDeploy = (() => {
        let d = 0;
        const sp = state.solarPanels;
        if (sp.topPanels && sp.topPanels.formFactor === 'folding') {
            d = Math.max(d, sp.topPanels.foldDeploy != null ? sp.topPanels.foldDeploy : 0);
        }
        if (sp.sidePanels && sp.sidePanels.formFactor === 'folding') {
            d = Math.max(d, sp.sidePanels.foldDeploy != null ? sp.sidePanels.foldDeploy : 0);
        }
        return d;
    })();
    const currentDeploy = Math.max(state.animation.foldingPanelDeploy || 0, manualDeploy);
    if (currentDeploy > 0.05) {
        state.animation.foldingPanelsUnfoldPhase = true;
        animateFoldingPanelDeploy(currentDeploy, 0, 800, foldStructure);
    } else {
        foldStructure();
    }
}

function applyPanelAxesToThreeGroup(group, panel) {
    const mat = new THREE.Matrix4();
    mat.makeBasis(
        new THREE.Vector3(panel.axisX.x, panel.axisX.y, panel.axisX.z),
        new THREE.Vector3(panel.axisY.x, panel.axisY.y, panel.axisY.z),
        new THREE.Vector3(panel.axisZ.x, panel.axisZ.y, panel.axisZ.z)
    );
    group.quaternion.setFromRotationMatrix(mat);
}

function getPanelSurfaceMaterials(panel) {
    const cellColor = rgbToThreeColor(panel.colorBase);
    return {
        cell: new THREE.MeshPhongMaterial({ color: cellColor, specular: 0x888899, shininess: 80, side: THREE.DoubleSide }),
        back: new THREE.MeshLambertMaterial({ color: 0xf5f5f5, side: THREE.DoubleSide }),
        edge: new THREE.MeshPhongMaterial({ color: 0x404045, specular: 0x333333, shininess: 20, side: THREE.DoubleSide }),
        hinge: new THREE.MeshLambertMaterial({ color: 0x252528, side: THREE.DoubleSide })
    };
}

/**
 * Multi-segment folding panel mesh (2-fold or 4-fold accordion).
 * foldDeploy 0 = stowed/folded, 1 = fully deployed flat.
 * Hinges run along panel width (local X); segments rotate around that axis
 * and stack in +Y (panel normal / away from the roof), not downward into beams.
 */
function createFoldingPanelMesh(panel) {
    const root = new THREE.Group();
    root.position.set(panel.center.x, panel.center.y, panel.center.z);
    applyPanelAxesToThreeGroup(root, panel);

    const n = Math.max(2, panel.foldCount || 4);
    const deploy = Math.max(0, Math.min(1, panel.foldDeploy != null ? panel.foldDeploy : 1));
    const segLen = panel.length / n;
    const foldAngle = (1 - deploy) * Math.PI;
    const mats = getPanelSurfaceMaterials(panel);
    const flip = (panel.foldDirection != null ? panel.foldDirection : 1) < 0;

    let arm = root;
    for (let i = 0; i < n; i++) {
        const pivot = new THREE.Group();
        if (i === 0) {
            pivot.position.z = flip ? panel.length / 2 : -panel.length / 2;
        } else {
            pivot.position.z = flip ? -segLen : segLen;
            const sign = (i % 2 === 1 ? -1 : 1) * (flip ? -1 : 1);
            pivot.rotation.x = sign * foldAngle;
        }
        arm.add(pivot);

        const segGeo = new THREE.BoxGeometry(panel.width, panel.thickness, segLen);
        const segMesh = new THREE.Mesh(segGeo, mats.cell);
        segMesh.position.z = flip ? -segLen / 2 : segLen / 2;
        pivot.add(segMesh);

        // Hinge accent at the fold line (skip first segment start)
        if (i > 0 && deploy < 0.98) {
            const hingeGeo = new THREE.BoxGeometry(panel.width * 0.98, panel.thickness * 1.05, 0.08);
            const hinge = new THREE.Mesh(hingeGeo, mats.hinge);
            pivot.add(hinge);
        }

        arm = pivot;
    }

    root.userData.panel = panel;
    root.userData.type = 'panel';
    root.renderOrder = 2;
    root.traverse(ch => {
        if (ch.isMesh) {
            ch.castShadow = state.shadowsEnabled || false;
            ch.receiveShadow = state.shadowsEnabled || false;
        }
    });
    return root;
}

/** Thin flexible panel — same mesh as framed but without rigid frame edges. */
function createFlexiblePanelMesh(panel) {
    const saved = panel.formFactor;
    panel.formFactor = 'framed';
    const group = createPanelMesh(panel);
    panel.formFactor = saved;
    return group;
}

// ============================================================================
// STRUCTURE GEOMETRY CLASSES (Refactored Architecture)
// ============================================================================

/**
 * Represents a roof face for solar panel placement.
 * Pre-computes all properties at construction time for stable orientation.
 */
class RoofFace {
    /**
     * @param {Beam3D} topBeam - The top horizontal beam defining this face
     * @param {Beam3D} botBeam - The bottom horizontal beam defining this face
     * @param {boolean} isAFace - True for A pattern faces (even index), false for B
     * @param {number} moduleIndex - Index of the parent module
     * @param {number} faceIndex - Global face index
     * @param {{x,y,z}} structureCenter - Center of the structure for outward direction
     * @param {{x,y,z}} moduleCenter - Module center for face orientation (optional)
     * @param {string} orientation - 'vertical' (arch) or 'horizontal' (cylinder)
     */
    constructor(topBeam, botBeam, isAFace, moduleIndex, faceIndex, structureCenter, moduleCenter = null, orientation = 'vertical') {
        this.topBeam = topBeam;
        this.botBeam = botBeam;
        this.isAFace = isAFace;
        this.moduleIndex = moduleIndex;
        this.faceIndex = faceIndex;
        this.moduleCenter = moduleCenter;
        this.orientation = orientation;
        
        // Pre-compute all geometry at construction time
        this._computeGeometry(structureCenter);
    }
    
    _computeGeometry(structureCenter) {
        const topBeam = this.topBeam;
        const botBeam = this.botBeam;
        
        // Ensure consistent beam direction
        const topDir = vNorm(vSub(topBeam.p2, topBeam.p1));
        const botDir = vNorm(vSub(botBeam.p2, botBeam.p1));
        const sameDirection = vDot(topDir, botDir) > 0;
        
        // Calculate corners
        const tl = topBeam.p1;
        const tr = topBeam.p2;
        const bl = sameDirection ? botBeam.p1 : botBeam.p2;
        const br = sameDirection ? botBeam.p2 : botBeam.p1;
        
        this.corners = [tl, tr, br, bl];
        
        // Calculate center
        this.center = {
            x: (tl.x + tr.x + bl.x + br.x) / 4,
            y: (tl.y + tr.y + bl.y + br.y) / 4,
            z: (tl.z + tr.z + bl.z + br.z) / 4
        };
        
        // Calculate face dimensions and axes
        const topEdge = vSub(tr, tl);
        const botEdge = vSub(br, bl);
        const leftEdge = vSub(bl, tl);
        const rightEdge = vSub(br, tr);
        
        this.width = (vMag(topEdge) + vMag(botEdge)) / 2;
        this.height = (vMag(leftEdge) + vMag(rightEdge)) / 2;
        
        // Width axis: along the beams
        this.widthAxis = vNorm(vScale(vAdd(topEdge, botEdge), 0.5));
        
        // Height axis: from top to bottom (slope direction)
        this.heightAxis = vNorm(vScale(vAdd(leftEdge, rightEdge), 0.5));
        
        // Normal: perpendicular to face, pointing outward
        this.normal = vNorm(vCross(this.widthAxis, this.heightAxis));
        
        // For closed polygon structures (pentagon, etc.), "outward" is different for EACH FACE.
        // Each face should point away from the MODULE CENTER (center of all 4 beams).
        // The module center is passed from ModuleGeometry.createFaces().
        // 
        // CRITICAL: The outward direction calculation depends on the mode:
        // - Arch/Vertical mode: arch stands upright, cylinder axis is Z, radial is in XY plane
        // - Cylinder/Horizontal mode: cylinder is horizontal, axis is along Y, radial is in XZ plane
        
        let outwardHint;
        const isCylinderMode = this.orientation === 'horizontal';
        
        if (this.moduleCenter) {
            // Outward direction: from face center to module center (AWAY from face surface)
            // We want panels to face OUTWARD from each face, which is TOWARD the module center
            let toModuleCenter;
            
            if (isCylinderMode) {
                // Cylinder mode: radial direction is in XZ plane (ignore Y which is the cylinder axis)
                toModuleCenter = {
                    x: this.moduleCenter.x - this.center.x,
                    y: 0,  // Ignore Y - it's along the cylinder length
                    z: this.moduleCenter.z - this.center.z
                };
            } else {
                // Arch mode: radial direction is in XY plane (ignore Z which is the arch depth)
                toModuleCenter = {
                    x: this.moduleCenter.x - this.center.x,
                    y: this.moduleCenter.y - this.center.y,
                    z: 0  // Ignore Z
                };
            }
            
            const toMag = Math.sqrt(toModuleCenter.x * toModuleCenter.x + 
                                   toModuleCenter.y * toModuleCenter.y + 
                                   toModuleCenter.z * toModuleCenter.z);
            
            if (toMag > 0.1) {
                outwardHint = vScale(toModuleCenter, 1 / toMag);
            } else {
                // Fallback: use beam's axisY
                const topAxisY = topBeam.axisY || {x: 0, y: 1, z: 0};
                const botAxisY = botBeam.axisY || {x: 0, y: 1, z: 0};
                outwardHint = vNorm(vAdd(topAxisY, botAxisY));
            }
        } else {
            // Fallback: use beam's axisY
            const topAxisY = topBeam.axisY || {x: 0, y: 1, z: 0};
            const botAxisY = botBeam.axisY || {x: 0, y: 1, z: 0};
            outwardHint = vNorm(vAdd(topAxisY, botAxisY));
        }
        
        // Flip normal if not aligned with outward hint
        if (vDot(this.normal, outwardHint) < 0) {
            this.normal = vScale(this.normal, -1);
            this.heightAxis = vScale(this.heightAxis, -1);
        }
        
        // Re-orthogonalize axes
        this.heightAxis = vNorm(vSub(this.heightAxis, vScale(this.normal, vDot(this.heightAxis, this.normal))));
        this.widthAxis = vNorm(vCross(this.heightAxis, this.normal));
        
        // SLIDE AXIS: Use face's own widthAxis (beam direction along its length)
        // widthAxis points along the beam, and since A and B beams CROSS,
        // their widthAxis directions naturally point in different (opposite) directions.
        // Using widthAxis directly (same sign for both) creates the "apart/together" effect.
        this.slideAxis = this.widthAxis;
    }
    
    /**
     * Transform this face using a transformation function
     * @param {Function} transformPoint - Function to transform a point
     * @param {Function} transformDir - Function to transform a direction vector
     */
    transform(transformPoint, transformDir) {
        this.corners = this.corners.map(c => transformPoint(c));
        this.center = transformPoint(this.center);
        this.normal = transformDir(this.normal);
        this.widthAxis = transformDir(this.widthAxis);
        this.heightAxis = transformDir(this.heightAxis);
        this.slideAxis = transformDir(this.slideAxis);
    }
}

/**
 * Represents geometry for a single linkage module.
 * Contains beams, faces, and pivot points for one module of the structure.
 */
class ModuleGeometry {
    /**
     * @param {number} index - Module index (0 to modules-1)
     */
    constructor(index) {
        this.index = index;
        this.topBeams = [];      // 2 horizontal beams (A/B crossing pattern)
        this.botBeams = [];      // 2 horizontal beams (A/B crossing pattern)
        this.uprights = [];      // Vertical beams (scissor or fixed)
        this.faces = [];         // 2 RoofFace objects (A and B)
        this.pivotInner = null;  // Inner pivot point (br in 2D)
        this.pivotOuter = null;  // Outer pivot point (tr in 2D)
        this.brackets = [];      // Bracket components
        this.bolts = [];         // Bolt components
    }
    
    /**
     * Add a horizontal beam pair (top ring)
     * @param {Beam3D} beamA - First beam of crossing pair
     * @param {Beam3D} beamB - Second beam of crossing pair
     */
    addTopBeams(beamA, beamB) {
        this.topBeams = [beamA, beamB];
    }
    
    /**
     * Add a horizontal beam pair (bottom ring)
     * @param {Beam3D} beamA - First beam of crossing pair
     * @param {Beam3D} beamB - Second beam of crossing pair
     */
    addBotBeams(beamA, beamB) {
        this.botBeams = [beamA, beamB];
    }
    
    /**
     * Create roof faces from the beam pairs
     * @param {{x,y,z}} structureCenter - Center of structure for outward direction
     * @param {number} baseFaceIndex - Starting face index
     * @param {string} orientation - 'vertical' (arch) or 'horizontal' (cylinder)
     */
    createFaces(structureCenter, baseFaceIndex, orientation = 'vertical') {
        if (this.topBeams.length >= 2 && this.botBeams.length >= 2) {
            // Compute TRUE module center from all 4 beam centers
            // This is crucial for determining "outward" direction for each face
            const moduleCenter = {
                x: (this.topBeams[0].center.x + this.topBeams[1].center.x + 
                    this.botBeams[0].center.x + this.botBeams[1].center.x) / 4,
                y: (this.topBeams[0].center.y + this.topBeams[1].center.y + 
                    this.botBeams[0].center.y + this.botBeams[1].center.y) / 4,
                z: (this.topBeams[0].center.z + this.topBeams[1].center.z + 
                    this.botBeams[0].center.z + this.botBeams[1].center.z) / 4
            };
            
            // Face A: topBeams[0] with botBeams[0] (Pattern A beams)
            const faceA = new RoofFace(
                this.topBeams[0], this.botBeams[0],
                true, this.index, baseFaceIndex, structureCenter, moduleCenter, orientation
            );
            // Face B: topBeams[1] with botBeams[1] (Pattern B beams)
            const faceB = new RoofFace(
                this.topBeams[1], this.botBeams[1],
                false, this.index, baseFaceIndex + 1, structureCenter, moduleCenter, orientation
            );
            this.faces = [faceA, faceB];
        }
    }
}

/**
 * Holds all geometry for the linkage structure in structure space.
 * This is the central data structure before mode-specific transformations.
 */
class StructureGeometry {
    constructor() {
        this.modules = [];       // Array of ModuleGeometry
        this.beams = [];         // All Beam3D objects
        this.brackets = [];      // All Bracket3D objects
        this.bolts = [];         // All bolt objects
        this.faces = [];         // All RoofFace objects for panels
        this.maxRadius = 0;      // Maximum radial extent
        this.maxHeight = 0;      // Maximum height
        this.structureCenter = {x: 0, y: 0, z: 0};  // Structure center point
    }
    
    /**
     * Add a module to the structure
     * @param {ModuleGeometry} module - Module to add
     */
    addModule(module) {
        this.modules.push(module);
    }
    
    /**
     * Collect all geometry from modules into flat arrays
     * @param {string} orientation - 'vertical' (arch) or 'horizontal' (cylinder)
     */
    collectGeometry(orientation = 'vertical') {
        this.beams = [];
        this.brackets = [];
        this.bolts = [];
        this.faces = [];
        
        // Calculate structure center from all horizontal beams
        let centerSum = {x: 0, y: 0, z: 0};
        let beamCount = 0;
        
        this.modules.forEach(module => {
            [...module.topBeams, ...module.botBeams].forEach(beam => {
                if (beam && beam.center) {
                    centerSum = vAdd(centerSum, beam.center);
                    beamCount++;
                }
            });
        });
        
        if (beamCount > 0) {
            this.structureCenter = vScale(centerSum, 1 / beamCount);
        }
        
        // Create faces for each module
        let faceIndex = 0;
        this.modules.forEach(module => {
            module.createFaces(this.structureCenter, faceIndex, orientation);
            faceIndex += 2;
        });
        
        // Collect all geometry
        this.modules.forEach(module => {
            this.beams.push(...module.topBeams, ...module.botBeams, ...module.uprights);
            this.brackets.push(...module.brackets);
            this.bolts.push(...module.bolts);
            this.faces.push(...module.faces);
        });
    }
    
    /**
     * Apply a transformation to all geometry
     * @param {Function} transformPoint - Function to transform a point
     * @param {Function} transformDir - Function to transform a direction
     */
    transform(transformPoint, transformDir) {
        // Transform beams
        this.beams.forEach(beam => {
            if (beam.corners) beam.corners = beam.corners.map(c => transformPoint(c));
            if (beam.p1) beam.p1 = transformPoint(beam.p1);
            if (beam.p2) beam.p2 = transformPoint(beam.p2);
            if (beam.center) beam.center = transformPoint(beam.center);
            if (beam.axisX) beam.axisX = transformDir(beam.axisX);
            if (beam.axisY) beam.axisY = transformDir(beam.axisY);
            if (beam.axisZ) beam.axisZ = transformDir(beam.axisZ);
            if (beam.faces) {
                beam.faces.forEach(face => {
                    if (face.norm) face.norm = transformDir(face.norm);
                });
            }
        });
        
        // Transform brackets - position AND direction vectors
        this.brackets.forEach(bracket => {
            // Store offset from pivot to bracket bottom BEFORE transformation
            let bottomOffset = null;
            if (bracket.pos && typeof bracket.bottomY === 'number') {
                bottomOffset = { x: 0, y: bracket.bottomY - bracket.pos.y, z: 0 };
            }
            
            // Transform position and directions
            if (bracket.pos) bracket.pos = transformPoint(bracket.pos);
            if (bracket.beamDir) bracket.beamDir = transformDir(bracket.beamDir);
            if (bracket.right) bracket.right = transformDir(bracket.right);
            
            // Apply transformed offset to get new bottomPos
            if (bottomOffset && bracket.pos) {
                const transformedOffset = transformDir(bottomOffset);
                bracket.bottomPos = {
                    x: bracket.pos.x + transformedOffset.x,
                    y: bracket.pos.y + transformedOffset.y,
                    z: bracket.pos.z + transformedOffset.z
                };
                bracket.bottomY = bracket.pos.y;
            }
        });
        
        // Transform bolts - position, center, start, end, AND direction
        this.bolts.forEach(bolt => {
            if (bolt.pos) bolt.pos = transformPoint(bolt.pos);
            if (bolt.center) bolt.center = transformPoint(bolt.center);
            if (bolt.start) bolt.start = transformPoint(bolt.start);
            if (bolt.end) bolt.end = transformPoint(bolt.end);
            if (bolt.dir) bolt.dir = transformDir(bolt.dir);
        });
        
        // Transform faces
        this.faces.forEach(face => {
            face.transform(transformPoint, transformDir);
        });
        
        // Transform structure center
        this.structureCenter = transformPoint(this.structureCenter);
    }
}

/**
 * Transforms structure geometry for cylinder mode (horizontal orientation).
 * In cylinder mode, the structure is a horizontal ring with Y pointing up.
 */
class CylinderTransform {
    constructor(options = {}) {
        this.options = options;
    }
    
    /**
     * Apply cylinder transformation (identity - no change needed for cylinder mode)
     * @param {StructureGeometry} geometry - Structure geometry to transform
     * @returns {StructureGeometry} Transformed geometry
     */
    apply(geometry) {
        // Cylinder mode is the default structure space orientation
        // No transformation needed
        return geometry;
    }
}

/**
 * Transforms structure geometry for arch mode (vertical orientation).
 * Rotates the structure to stand vertically with feet on the ground.
 */
class ArchTransform {
    constructor(options = {}) {
        this.flipVertical = options.flipVertical || false;
        this.rotation = options.rotation || 0;
        this.capUprights = options.capUprights || false;
    }
    
    /**
     * Apply arch transformation to make structure vertical with ground tracking
     * @param {StructureGeometry} geometry - Structure geometry to transform
     * @param {Object} footInfo - Information about left/right foot positions
     * @returns {StructureGeometry} Transformed geometry
     */
    apply(geometry, footInfo) {
        if (!footInfo || !footInfo.leftFoot || !footInfo.rightFoot) {
            return geometry;
        }
        
        const { leftFoot, rightFoot } = footInfo;
        
        // Calculate transformation
        const midX = (leftFoot.x + rightFoot.x) / 2;
        const midY = (leftFoot.y + rightFoot.y) / 2;
        const midZ = (leftFoot.z + rightFoot.z) / 2;
        
        const dx = rightFoot.x - leftFoot.x;
        const dz = rightFoot.z - leftFoot.z;
        const footAngle = Math.atan2(dz, dx);
        
        const userRotRad = (this.rotation || 0) * Math.PI / 180;
        const totalRotY = -footAngle + userRotRad;
        const cosR = Math.cos(totalRotY);
        const sinR = Math.sin(totalRotY);
        
        const flipY = this.flipVertical ? -1 : 1;
        
        const transformPoint = (p) => {
            let x = p.x - midX;
            let y = p.y - midY;
            let z = p.z - midZ;
            
            const x2 = x * cosR - z * sinR;
            const y2 = y;
            const z2 = x * sinR + z * cosR;
            
            return { x: x2, y: z2 * flipY, z: -y2 };
        };
        
        const transformDir = (v) => {
            if (!v || typeof v.x === 'undefined') return v;
            const x2 = v.x * cosR - v.z * sinR;
            const y2 = v.y;
            const z2 = v.x * sinR + v.z * cosR;
            return { x: x2, y: z2 * flipY, z: -y2 };
        };
        
        geometry.transform(transformPoint, transformDir);
        
        // Ground tracking: move structure so lowest point is at Y=0
        let minY = Infinity;
        geometry.beams.forEach(beam => {
            if (beam.corners) {
                beam.corners.forEach(c => {
                    if (c.y < minY) minY = c.y;
                });
            }
        });
        
        if (minY !== Infinity && Math.abs(minY) > 0.01) {
            const groundOffset = -minY;
            const translatePoint = (p) => ({ x: p.x, y: p.y + groundOffset, z: p.z });
            const identityDir = (v) => v;
            geometry.transform(translatePoint, identityDir);
        }
        
        return geometry;
    }
}

/**
 * Places solar panels on roof faces with simple, predictable positioning.
 */
class PanelPlacer {
    /**
     * @param {Object} config - Panel configuration
     */
    constructor(config) {
        this.panelWidth = config.panelWidth || 40;
        this.panelLength = config.panelLength || 65;
        this.panelThickness = config.panelThickness || 1.5;
        this.paddingX = config.paddingX || 0;
        this.paddingY = config.paddingY || 0;
        this.rows = config.gridRows || 2;
        this.cols = config.gridCols || 1;
        
        // Positioning parameters
        this.lift = config.archPanelOffset || 1.5;
        this.slide = config.archPanelSlide || 0;
        this.separation = config.archPanelSeparation || 0;
        this.separationBaseline = 4.6;  // Built-in alignment offset
        this.panelSpec = spPanelSpecFromConfig(config);
    }
    
    /**
     * Place panels on a single roof face
     * @param {RoofFace} face - The face to place panels on
     * @returns {Panel3D[]} Array of panels
     */
    placeOnFace(face) {
        const panels = [];
        
        // 1. Start at face center
        let baseCenter = { ...face.center };
        
        // 2. Apply separation (all panels move together along height axis)
        const totalSeparation = this.separation + this.separationBaseline;
        baseCenter = vAdd(baseCenter, vScale(face.heightAxis, totalSeparation));
        
        // 3. Apply slide (A/B move opposite along pre-computed slideAxis)
        // slideAxis already encodes the A/B direction
        baseCenter = vAdd(baseCenter, vScale(face.slideAxis, this.slide));
        
        // 4. Apply lift (along normal)
        const liftOffset = this.lift + this.panelThickness / 2;
        baseCenter = vAdd(baseCenter, vScale(face.normal, liftOffset));
        
        // 5. Generate grid of panels
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                const localX = (col - (this.cols - 1) / 2) * (this.panelWidth + this.paddingX);
                const localY = (row - (this.rows - 1) / 2) * (this.panelLength + this.paddingY);
                
                const panelCenter = vAdd(
                    vAdd(baseCenter, vScale(face.widthAxis, localX)),
                    vScale(face.heightAxis, localY)
                );
                
                // Create panel with face orientation
                const panel = makeSolarPanel(
                    panelCenter,
                    this.panelWidth,
                    this.panelLength,
                    this.panelThickness,
                    0,
                    face.normal,
                    spPanelSpecForGridCell({ gridRows: this.rows, formFactor: this.panelSpec.formFactor, foldCount: this.panelSpec.foldCount, foldDeploy: this.panelSpec.foldDeploy, foldedLength: this.panelSpec.foldedLength, foldedWidth: this.panelSpec.foldedWidth, foldedThickness: this.panelSpec.foldedThickness, weight: this.panelSpec.weight }, row)
                );
                
                // Override axes to match face
                panel.axisX = face.widthAxis;
                panel.axisZ = face.heightAxis;
                panel.axisY = face.normal;
                
                // Recalculate corners
                this._recalculateCorners(panel);
                
                panels.push(panel);
            }
        }
        
        return panels;
    }
    
    /**
     * Place panels on multiple faces
     * @param {RoofFace[]} faces - Array of faces
     * @param {boolean[]} enabledFaces - Which faces are enabled
     * @returns {Panel3D[]} Array of all panels
     */
    placeOnFaces(faces, enabledFaces) {
        const allPanels = [];
        
        faces.forEach((face, idx) => {
            if (enabledFaces && idx < enabledFaces.length && !enabledFaces[idx]) {
                return;
            }
            const facePanels = this.placeOnFace(face);
            allPanels.push(...facePanels);
        });
        
        return allPanels;
    }
    
    /**
     * Recalculate panel corners based on axes
     * @param {Panel3D} panel - Panel to update
     */
    _recalculateCorners(panel) {
        const hw = panel.width / 2;
        const hl = panel.length / 2;
        const ht = panel.thickness / 2;
        
        const offsets = [
            {x: -hw, z: -hl}, {x: hw, z: -hl},
            {x: hw, z: hl}, {x: -hw, z: hl}
        ];
        
        panel.corners = [];
        
        // Bottom corners
        offsets.forEach(o => {
            let p = vAdd(panel.center, vScale(panel.axisX, o.x));
            p = vAdd(p, vScale(panel.axisZ, o.z));
            p = vAdd(p, vScale(panel.axisY, -ht));
            panel.corners.push(p);
        });
        
        // Top corners
        offsets.forEach(o => {
            let p = vAdd(panel.center, vScale(panel.axisX, o.x));
            p = vAdd(p, vScale(panel.axisZ, o.z));
            p = vAdd(p, vScale(panel.axisY, ht));
            panel.corners.push(p);
        });
    }
}

const geometryClassesExports = {
    Beam3D,
    Bracket3D,
    RoofFace,
    ModuleGeometry,
    StructureGeometry,
    makeSolarPanel,
    spPanelSpecFromConfig,
    spPanelSpecForGridCell,
    spFoldDirectionForGridRow,
    getPanelWeightLbs,
    calculateSolarPanelArrayWeight,
    getSolarPanelWeightSummary,
    hasFoldingSolarPanels,
    getStructureFoldedAngle,
    getStructureDeployedAngle,
    getFoldingPanelDeployForAnimation,
    useFoldingPanelAutoAnim,
    useFoldingPanelStructureDeploy,
    getFoldingPanelsVisibleAtAngle,
    applyFoldingPanelAnimationState,
    animateFoldingPanelDeploy,
    runFoldingPanelUnfoldSequence,
    runFoldingPanelFoldSequence,
    applyPanelAxesToThreeGroup,
    getPanelSurfaceMaterials,
    createFoldingPanelMesh,
    createFlexiblePanelMesh
};

bridgeGlobals(geometryClassesExports, 'geometryClasses');

export {
    Beam3D,
    Bracket3D,
    RoofFace,
    ModuleGeometry,
    StructureGeometry,
    makeSolarPanel,
    spPanelSpecFromConfig,
    spPanelSpecForGridCell,
    spFoldDirectionForGridRow,
    getPanelWeightLbs,
    calculateSolarPanelArrayWeight,
    getSolarPanelWeightSummary,
    hasFoldingSolarPanels,
    getStructureFoldedAngle,
    getStructureDeployedAngle,
    getFoldingPanelDeployForAnimation,
    useFoldingPanelAutoAnim,
    useFoldingPanelStructureDeploy,
    getFoldingPanelsVisibleAtAngle,
    applyFoldingPanelAnimationState,
    animateFoldingPanelDeploy,
    runFoldingPanelUnfoldSequence,
    runFoldingPanelFoldSequence,
    applyPanelAxesToThreeGroup,
    getPanelSurfaceMaterials,
    createFoldingPanelMesh,
    createFlexiblePanelMesh
};

