
class Beam3D {
    constructor(start, end, width, thick, colorBase, metadata = {}) {
        this.type = 'beam';
        this.center = vScale(vAdd(start, end), 0.5);
        this.colorBase = colorBase;
        // Store metadata for collision detection
        this.moduleIndex = metadata.moduleIndex !== undefined ? metadata.moduleIndex : -1;
        this.stackType = metadata.stackType || 'unknown';
        this.stackId = metadata.stackId !== undefined ? metadata.stackId : -1;
        
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

class Bracket3D {
    constructor(pos, dirUp, dirFwd, width) {
        this.type = 'bracket';
        this.pos = pos;
        this.w = width * BRACKET_SIZE_MULT;
        this.h = width * BRACKET_SIZE_MULT;
        this.d = BRACKET_DEPTH;

class Panel3D {
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
        
        // Horizontal lines (along X)
        for (let i = 0; i <= cellsZ; i++) {
            const z = -hl + (i / cellsZ) * this.length;
            const start = vAdd(vAdd(vAdd(this.center, vScale(this.axisX, -hw)), vScale(this.axisZ, z)), vScale(this.axisY, ht));
            const end = vAdd(vAdd(vAdd(this.center, vScale(this.axisX, hw)), vScale(this.axisZ, z)), vScale(this.axisY, ht));
            lines.push({start, end});
        
        return lines;

// ============================================================================
// STRUCTURE GEOMETRY CLASSES (Refactored Architecture)
// ============================================================================

class RoofFace {
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
                // Arch mode: radial direction is in XY plane (ignore Z which is the arch depth)
                toModuleCenter = {
                    x: this.moduleCenter.x - this.center.x,
                    y: this.moduleCenter.y - this.center.y,
                    z: 0  // Ignore Z
            
            const toMag = Math.sqrt(toModuleCenter.x * toModuleCenter.x + 
                                   toModuleCenter.y * toModuleCenter.y + 
                                   toModuleCenter.z * toModuleCenter.z);
            
            if (toMag > 0.1) {
                outwardHint = vScale(toModuleCenter, 1 / toMag);
                // Fallback: use beam's axisY
                const topAxisY = topBeam.axisY || {x: 0, y: 1, z: 0};
                const botAxisY = botBeam.axisY || {x: 0, y: 1, z: 0};
                outwardHint = vNorm(vAdd(topAxisY, botAxisY));
            // Fallback: use beam's axisY
            const topAxisY = topBeam.axisY || {x: 0, y: 1, z: 0};
            const botAxisY = botBeam.axisY || {x: 0, y: 1, z: 0};
            outwardHint = vNorm(vAdd(topAxisY, botAxisY));
        
        // Flip normal if not aligned with outward hint
        if (vDot(this.normal, outwardHint) < 0) {
            this.normal = vScale(this.normal, -1);
            this.heightAxis = vScale(this.heightAxis, -1);
        
        // Re-orthogonalize axes
        this.heightAxis = vNorm(vSub(this.heightAxis, vScale(this.normal, vDot(this.heightAxis, this.normal))));
        this.widthAxis = vNorm(vCross(this.heightAxis, this.normal));
        
        // SLIDE AXIS: Use face's own widthAxis (beam direction along its length)
        // widthAxis points along the beam, and since A and B beams CROSS,
        // their widthAxis directions naturally point in different (opposite) directions.
        // Using widthAxis directly (same sign for both) creates the "apart/together" effect.
        this.slideAxis = this.widthAxis;
    
    transform(transformPoint, transformDir) {
        this.corners = this.corners.map(c => transformPoint(c));
        this.center = transformPoint(this.center);
        this.normal = transformDir(this.normal);
        this.widthAxis = transformDir(this.widthAxis);
        this.heightAxis = transformDir(this.heightAxis);
        this.slideAxis = transformDir(this.slideAxis);

class ModuleGeometry {
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
    
    addTopBeams(beamA, beamB) {
        this.topBeams = [beamA, beamB];
    
    addBotBeams(beamA, beamB) {
        this.botBeams = [beamA, beamB];
    
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
    
    addModule(module) {
        this.modules.push(module);
    
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
        
        if (beamCount > 0) {
            this.structureCenter = vScale(centerSum, 1 / beamCount);
        
        // Create faces for each module
        let faceIndex = 0;
        this.modules.forEach(module => {
            module.createFaces(this.structureCenter, faceIndex, orientation);
            faceIndex += 2;
        
        // Collect all geometry
        this.modules.forEach(module => {
            this.beams.push(...module.topBeams, ...module.botBeams, ...module.uprights);
            this.brackets.push(...module.brackets);
            this.bolts.push(...module.bolts);
            this.faces.push(...module.faces);
    
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
        
        // Transform brackets
        this.brackets.forEach(bracket => {
            if (bracket.pos) bracket.pos = transformPoint(bracket.pos);
        
        // Transform bolts
        this.bolts.forEach(bolt => {
            if (bolt.pos) bolt.pos = transformPoint(bolt.pos);
            if (bolt.dir) bolt.dir = transformDir(bolt.dir);
        
        // Transform faces
        this.faces.forEach(face => {
            face.transform(transformPoint, transformDir);
        
        // Transform structure center
        this.structureCenter = transformPoint(this.structureCenter);

class CylinderTransform {
    constructor(options = {}) {
        this.options = options;
    
    apply(geometry) {
        // Cylinder mode is the default structure space orientation
        // No transformation needed
        return geometry;

class ArchTransform {
    constructor(options = {}) {
        this.flipVertical = options.flipVertical || false;
        this.rotation = options.rotation || 0;
        this.capUprights = options.capUprights || false;
    
    apply(geometry, footInfo) {
        if (!footInfo || !footInfo.leftFoot || !footInfo.rightFoot) {
            return geometry;
        
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
        
        const transformDir = (v) => {
            if (!v || typeof v.x === 'undefined') return v;
            const x2 = v.x * cosR - v.z * sinR;
            const y2 = v.y;
            const z2 = v.x * sinR + v.z * cosR;
            return { x: x2, y: z2 * flipY, z: -y2 };
        
        geometry.transform(transformPoint, transformDir);
        
        // Ground tracking: move structure so lowest point is at Y=0
        let minY = Infinity;
        geometry.beams.forEach(beam => {
            if (beam.corners) {
                beam.corners.forEach(c => {
                    if (c.y < minY) minY = c.y;
        
        if (minY !== Infinity && Math.abs(minY) > 0.01) {
            const groundOffset = -minY;
            const translatePoint = (p) => ({ x: p.x, y: p.y + groundOffset, z: p.z });
            const identityDir = (v) => v;
            geometry.transform(translatePoint, identityDir);
        
        return geometry;

class PanelPlacer {
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
                const panel = new Panel3D(
                    panelCenter,
                    this.panelWidth,
                    this.panelLength,
                    this.panelThickness,
                    0,
                    face.normal
                );
                
                // Override axes to match face
                panel.axisX = face.widthAxis;
                panel.axisZ = face.heightAxis;
                panel.axisY = face.normal;
                
                // Recalculate corners
                this._recalculateCorners(panel);
                
                panels.push(panel);
        
        return panels;
    
    placeOnFaces(faces, enabledFaces) {
        const allPanels = [];
        
        faces.forEach((face, idx) => {
            if (enabledFaces && idx < enabledFaces.length && !enabledFaces[idx]) {
                return;
            const facePanels = this.placeOnFace(face);
            allPanels.push(...facePanels);
        
        return allPanels;
    
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
        
        // Top corners
        offsets.forEach(o => {
            let p = vAdd(panel.center, vScale(panel.axisX, o.x));
            p = vAdd(p, vScale(panel.axisZ, o.z));
            p = vAdd(p, vScale(panel.axisY, ht));
            panel.corners.push(p);

// ============================================================================
// LINKAGE SOLVER
// ============================================================================

function calculateJointPositions(foldAngle, params) {
    const { hActiveIn, pivotPct, hobermanAng, pivotAng } = params;
    
    const safeH = Math.max(MIN_SAFE_DIMENSION, hActiveIn);
    const pivotRatio = pivotPct / 100;
    const activeLength = safeH * pivotRatio;
    const passiveLength = safeH * (1 - pivotRatio);
    const halfAngle = foldAngle / 2;
    const hobermanRad = degToRad(hobermanAng);
    const pivotOffsetRad = degToRad(pivotAng);
    
    // Calculate angles for linkage joint positions
    const angle1Bottom = Math.PI - halfAngle;
    const angle1Top = -halfAngle + hobermanRad;
    const angle2Bottom = Math.PI + halfAngle + pivotOffsetRad;
    const angle2Top = halfAngle - hobermanRad + pivotOffsetRad;

    // Calculate joint locations in 2D plane
    const joints = {
        bl: {x: activeLength * Math.cos(angle1Bottom), y: activeLength * Math.sin(angle1Bottom)},
        tr: {x: passiveLength * Math.cos(angle1Top), y: passiveLength * Math.sin(angle1Top)},
        br: {x: activeLength * Math.cos(angle2Bottom), y: activeLength * Math.sin(angle2Bottom)},
        tl: {x: passiveLength * Math.cos(angle2Top), y: passiveLength * Math.sin(angle2Top)},

    // Calculate relative rotation between modules
    const sourceAngle = Math.atan2(joints.tl.y - joints.bl.y, joints.tl.x - joints.bl.x);
    const targetAngle = Math.atan2(joints.tr.y - joints.br.y, joints.tr.x - joints.br.x);
    const relativeRotation = targetAngle - sourceAngle;

    return {
        joints,
        relativeRotation,
        activeLength,
        passiveLength

function calculatePivotSpan(foldAngle) {
    const hTotIn = state.hLengthFt * INCHES_PER_FOOT;
    const hActiveIn = hTotIn - state.offsetTopIn - state.offsetBotIn;
    
    const jointResult = calculateJointPositions(foldAngle, {
        hActiveIn,
        pivotPct: state.pivotPct,
        hobermanAng: state.hobermanAng,
        pivotAng: state.pivotAng
    
    const loc = jointResult.joints;
    
    // Calculate distance between inner pivot (br) and outer pivot (tr)
    // These are the pivots where the vertical beams connect to the horizontal ring
    const dx = loc.tr.x - loc.br.x;
    const dy = loc.tr.y - loc.br.y;
    const pivotSpan = Math.sqrt(dx * dx + dy * dy);
    
    return pivotSpan;

function calculateActuatorStroke() {
    // Pivot span at fully open (minimum fold angle) - pivots are closest together
    const openSpan = calculatePivotSpan(MIN_FOLD_ANGLE);
    
    // Get the optimal closed angle for this configuration (where ring closes to 360Ã‚Â°)
    const closedAngle = getOptimalClosedAngleForAnimation();
    // Pivot span at fully closed - pivots are furthest apart
    const closedSpan = calculatePivotSpan(closedAngle);
    
    // Stroke is the difference in pivot spans
    const stroke = Math.abs(closedSpan - openSpan);
    
    return {
        open: openSpan,
        closed: closedSpan,
        stroke: stroke,
        closedAngle: closedAngle

function extendPoint(p, dist) {
    const length = Math.sqrt(p.x * p.x + p.y * p.y);
    if (length === 0) return p;
    const scale = 1 + (dist / length);
    return {x: p.x * scale, y: p.y * scale};

function mapTo3D(p, h, curPos, curRot) {
    const rx = p.x * Math.cos(curRot) - p.y * Math.sin(curRot);
    const rz = p.x * Math.sin(curRot) + p.y * Math.cos(curRot);
    return v3(curPos.x + rx, h, curPos.y + rz);

function createBeamStack(stackParams) {
    const { 
        p1_A, p2_A, p1_B, p2_B, 
        count, width, thick, color, offsetDir,
        moduleIndex, stackType, stackId, 
        beamsArray, gap
    
    // Ensure offset direction is normalized and valid
    let normalizedDir = vNorm(offsetDir);
    if (vMag(normalizedDir) < 0.001) {
        normalizedDir = {x: 1, y: 0, z: 0};
    
    const totalThick = count * thick + (count - 1) * gap;
    const startOffset = -totalThick / 2 + thick / 2;
    
    for (let i = 0; i < count; i++) {
        const offsetValue = startOffset + i * (thick + gap);
        const vectorOffset = vScale(normalizedDir, offsetValue);
        const isPatternA = (i % 2 === 0);
        const start = isPatternA ? p1_A : p1_B;
        const end = isPatternA ? p2_A : p2_B;
        
        const offsetStart = vAdd(start, vectorOffset);
        const offsetEnd = vAdd(end, vectorOffset);
        
        beamsArray.push(new Beam3D(
            offsetStart,
            offsetEnd,
            width, thick, color,
            {moduleIndex, stackType, stackId, patternId: isPatternA ? 'A' : 'B'}
        ));
    
    return totalThick;

function solveLinkage(foldAngle) {
    // Calculate beam lengths in inches
    const hTotIn = state.hLengthFt * INCHES_PER_FOOT;
    const hActiveIn = hTotIn - state.offsetTopIn - state.offsetBotIn;
    const vTotIn = state.vLengthFt * INCHES_PER_FOOT;
    const vActiveIn = vTotIn - (state.vertEndOffset * 2);
    const safeV = Math.max(MIN_SAFE_DIMENSION, vActiveIn);
    
    // Calculate joint positions using helper function
    const jointResult = calculateJointPositions(foldAngle, {
        hActiveIn,
        pivotPct: state.pivotPct,
        hobermanAng: state.hobermanAng,
        pivotAng: state.pivotAng
    
    const loc = jointResult.joints;
    const relativeRotation = jointResult.relativeRotation;

    // Calculate vertical beam height from radial span
    // When using fixed beams, adjust height to maintain fixed beam spacing
    let zHeight = 0;
    if (state.useFixedBeams) {
        // With fixed beams, use the V beam length directly as the height
        // The structure height equals the fixed beam length (converted to inches)
        const fixedBeamLengthInches = state.vLengthFt * INCHES_PER_FOOT;
        
        // Set zHeight directly from the V beam length
        // This ensures fixed beams are always the user-specified length
        zHeight = fixedBeamLengthInches;
        state.fixedBeamHeight = zHeight; // Store for reference
        state.fixedBeamLength = fixedBeamLengthInches;
        // Normal scissor behavior: height changes with radial span
        const dx = loc.tr.x - loc.br.x;
        const dy = loc.tr.y - loc.br.y;
        const radialSpan = Math.sqrt(dx*dx + dy*dy);
        if (safeV > radialSpan) zHeight = Math.sqrt(safeV*safeV - radialSpan*radialSpan);

    let beams = [];
    let brackets = [];
    let bolts = [];
    let curPos = {x:0, y:0};
    let curRot = 0;
    
    // Calculate visible locations with offsets applied
    const visLoc = {
        bl: extendPoint(loc.bl, state.offsetBotIn),
        tr: extendPoint(loc.tr, state.offsetTopIn),
        br: extendPoint(loc.br, state.offsetBotIn),
        tl: extendPoint(loc.tl, state.offsetTopIn)

    const woodColor = WOOD_COLOR; 

    // Helper to create stacks using the modular function
    const createStack = (p1_A, p2_A, p1_B, p2_B, count, width, thick, color, offsetDir, moduleIndex, stackType, stackId) => {
        return createBeamStack({
            p1_A, p2_A, p1_B, p2_B,
            count, width, thick, color, offsetDir,
            moduleIndex, stackType, stackId,
            beamsArray: beams,
            gap: state.stackGap

    let maxRad = 0;

    for(let i=0; i<state.modules; i++) {
        // Local map function that captures curPos and curRot
        const map = (p, h) => mapTo3D(p, h, curPos, curRot);

        const topH = zHeight + (state.bracketOffset * 2);

        // --- HORIZONTAL RINGS ---
        const hUp = {x:0,y:1,z:0};
        const hW = state.hBeamW; const hT = state.hBeamT;
        
        // Bottom horizontal ring - pass module index and type for collision detection
        const hThick = createStack(
            map(visLoc.bl, 0), map(visLoc.tr, 0), // Pattern A
            map(visLoc.br, 0), map(visLoc.tl, 0), // Pattern B
            state.hStackCount, hW, hT, woodColor, hUp,
            i, 'horizontal-bottom', i * 2  // moduleIndex, stackType, stackId
        );
        
        // Top horizontal ring
        createStack(
            map(visLoc.bl, topH), map(visLoc.tr, topH), 
            map(visLoc.br, topH), map(visLoc.tl, topH),
            state.hStackCount, hW, hT, woodColor, hUp,
            i, 'horizontal-top', i * 2 + 1  // moduleIndex, stackType, stackId
        );

        // --- VERTICAL UPRIGHTS (scissor cross-beams) ---
        // Skip when using fixed straight beams (they replace the scissor uprights)
        if (zHeight > 1 && !state.useFixedBeams) {
            const yMin = state.bracketOffset;
            const yMax = topH - state.bracketOffset;
            
            // Define the four corner pivot points
            const pBotInner = map(loc.br, yMin);
            const pTopOuter = map(loc.tr, yMax);
            const pBotOuter = map(loc.tr, yMin);
            const pTopInner = map(loc.br, yMax);
            
            // Calculate CENTER pivot points that all beams in the stack should pass through
            // These are the midpoints between the inner and outer pivot points
            const pivotBotCenter = vScale(vAdd(pBotInner, pBotOuter), 0.5);
            const pivotTopCenter = vScale(vAdd(pTopOuter, pTopInner), 0.5);
            
            const vW = state.vBeamW; 
            const vT = state.vBeamT;
            
            // Calculate the beam direction (from center bottom to center top pivot)
            const beamDir = vNorm(vSub(pivotTopCenter, pivotBotCenter));
            
            // Pre-calculate pattern vectors and directions for stack calculation
            const patternA_bot = pBotInner;
            const patternA_top = pTopOuter;
            const patternA_vec = vSub(patternA_top, patternA_bot);
            const patternA_dir = vNorm(patternA_vec);
            const patternA_mid = vScale(vAdd(patternA_bot, patternA_top), 0.5);
            
            const patternB_bot = pBotOuter;
            const patternB_top = pTopInner;
            const patternB_vec = vSub(patternB_top, patternB_bot);
            const patternB_dir = vNorm(patternB_vec);
            const patternB_mid = vScale(vAdd(patternB_bot, patternB_top), 0.5);
            
            // Use average pattern direction for reference, but calculate stack direction more carefully
            const avgPatternDir = vNorm(vScale(vAdd(patternA_dir, patternB_dir), 0.5));
            
            // Calculate the beam length including end offsets
            const beamLength = vMag(vSub(pivotTopCenter, pivotBotCenter)) + (state.vertEndOffset * 2);
            
            // Calculate stacking direction (perpendicular to beam direction)
            // This is the direction beams will stack side-by-side
            const center = v3(0, 0, 0);
            const radVec = vNorm(vSub(pivotBotCenter, center));
            const up = {x: 0, y: 1, z: 0};
            
            // CRITICAL: Stack direction must be perpendicular to BOTH pattern directions
            // Calculate a direction that's perpendicular to both pattern A and pattern B
            // This ensures consistent stacking regardless of which pattern is used
            
            // Method 1: Cross product of the two pattern directions gives us a perpendicular vector
            let stackDir = vNorm(vCross(patternA_dir, patternB_dir));
            
            // If patterns are parallel, the cross product will be near zero
            if (vMag(stackDir) < 0.1) {
                // Patterns are nearly parallel, use radial-based calculation
                stackDir = vNorm(vCross(radVec, avgPatternDir));
            
            // Verify the stack direction is perpendicular to pattern directions
            const dotCheckA = Math.abs(vDot(stackDir, patternA_dir));
            const dotCheckB = Math.abs(vDot(stackDir, patternB_dir));
            if (dotCheckA > 0.1 || dotCheckB > 0.1 || vMag(stackDir) < 0.1) {
                // Method 2: Cross product of average pattern direction with up vector
                stackDir = vNorm(vCross(avgPatternDir, up));
                const dotCheck2A = Math.abs(vDot(stackDir, patternA_dir));
                const dotCheck2B = Math.abs(vDot(stackDir, patternB_dir));
                if (dotCheck2A > 0.1 || dotCheck2B > 0.1 || vMag(stackDir) < 0.1) {
                    // Method 3: Construct perpendicular vector manually
                    // Find any vector not parallel to pattern directions
                    let perpVec;
                    if (Math.abs(avgPatternDir.y) > 0.9) {
                        // Beam is mostly vertical, use horizontal perpendicular
                        perpVec = {x: 1, y: 0, z: 0};
                        // Beam is mostly in X direction, use Z perpendicular
                        perpVec = {x: 0, y: 0, z: 1};
                        // Use cross product with up vector, then normalize
                        perpVec = {x: -avgPatternDir.z, y: 0, z: avgPatternDir.x};
                    // Make it perpendicular to average pattern direction using Gram-Schmidt
                    stackDir = vSub(perpVec, vScale(avgPatternDir, vDot(perpVec, avgPatternDir)));
                    stackDir = vNorm(stackDir);
            
            // Final verification: ensure stackDir is perpendicular to both pattern directions
            const finalDotA = Math.abs(vDot(stackDir, patternA_dir));
            const finalDotB = Math.abs(vDot(stackDir, patternB_dir));
            
            if (finalDotA > 0.01) {
                // Force perpendicular to pattern A
                stackDir = vSub(stackDir, vScale(patternA_dir, vDot(stackDir, patternA_dir)));
                stackDir = vNorm(stackDir);
            if (finalDotB > 0.01) {
                // Force perpendicular to pattern B
                stackDir = vSub(stackDir, vScale(patternB_dir, vDot(stackDir, patternB_dir)));
                stackDir = vNorm(stackDir);
            
            // Verify stack direction is valid
            if (vMag(stackDir) < 0.1) {
                // Ultimate fallback: use cross product of pattern A with up vector
                stackDir = vNorm(vCross(patternA_dir, up));
                if (vMag(stackDir) < 0.1) {
                    // Final fallback: use radial direction rotated 90 degrees
                    stackDir = vNorm({x: -radVec.z, y: radVec.y, z: radVec.x});
            
            // Create vertical stack centered on pivot points
            // All beams pass through the center pivot points, stacked perpendicular to beam direction
            // CRITICAL: Use vW (width) for stack spacing, not vT (thickness)
            // Beams are stacked along their width dimension, not thickness
            const gap = state.stackGap;
            const totalThick = state.vStackCount * vW + (state.vStackCount - 1) * gap;
            
            // Calculate center pivot line (where stack should be centered)
            const centerLineStart = pivotBotCenter;
            const centerLineEnd = pivotTopCenter;
            const centerLineDir = vNorm(vSub(centerLineEnd, centerLineStart));
            
            // Calculate center pivot midpoint (where stack should be centered)
            // (pattern vectors and midpoints already calculated above)
            const centerMid = vScale(vAdd(centerLineStart, centerLineEnd), 0.5);
            
            // CRITICAL FIX: Center each pattern individually, then stack them
            // Pattern endpoints are fixed (actual pivot connection points)
            // We want each pattern, when at the center of the stack (offsetValue=0), to pass through center pivots
            // Then stack offsets position beams within the centered patterns
            
            const stackDirNorm = vNorm(stackDir);
            
            // Calculate starting offset to center the stack
            // The middle beam(s) should be at offsetValue = 0 (centered)
            const startOffset = -totalThick / 2 + vW / 2;
            
            // CRITICAL FIX: Calculate exact average position of all beam midpoints when stacked
            // Account for both pattern midpoints AND their stack offsets
            let totalPosition = {x: 0, y: 0, z: 0};
            for (let i = 0; i < state.vStackCount; i++) {
                const offsetValue = startOffset + i * (vW + gap);
                const stackOffsetVec = vScale(stackDirNorm, offsetValue);
                // Determine pattern: normally A, B, A, B... but reverse if vStackReverse is true
                const isPatternA = state.vStackReverse ? (i % 2 !== 0) : (i % 2 === 0);
                const patternMid = isPatternA ? patternA_mid : patternB_mid;
                // Actual position = pattern midpoint + stack offset (centering offset will be added later)
                const actualPos = vAdd(patternMid, stackOffsetVec);
                totalPosition = vAdd(totalPosition, actualPos);
            const avgActualMid = vScale(totalPosition, 1 / state.vStackCount);
            
            // Calculate offset needed so average position aligns with center pivot
            const offsetToCenter = vSub(centerMid, avgActualMid);
            
            // Project onto stack direction to get global centering offset
            const globalCenteringOffset = vScale(stackDirNorm, vDot(offsetToCenter, stackDirNorm));
            
            // Apply same offset to both patterns - this centers the entire stack
            const centeringOffsetA = globalCenteringOffset;
            const centeringOffsetB = globalCenteringOffset;
            
            for (let i = 0; i < state.vStackCount; i++) {
                // Calculate stack offset (perpendicular to beam, centered around pivot)
                const offsetValue = startOffset + i * (vW + gap);
                const stackOffset = vScale(stackDirNorm, offsetValue);
                
                // Determine which pattern this beam uses (alternating: A, B, A, B, ...)
                // When vStackReverse is true, the order is reversed (B, A, B, A, ...)
                const isPatternA = state.vStackReverse ? (i % 2 !== 0) : (i % 2 === 0);
                
                // Get the pattern endpoints (actual pivot connection points)
                let patternBot, patternTop, patternDir, centeringOffset;
                if (isPatternA) {
                    patternBot = pBotInner;
                    patternTop = pTopOuter;
                    patternDir = patternA_dir;
                    centeringOffset = centeringOffsetA;
                    patternBot = pBotOuter;
                    patternTop = pTopInner;
                    patternDir = patternB_dir;
                    centeringOffset = centeringOffsetB;
                
                // Calculate beam endpoints:
                // 1. Pattern endpoints (fixed pivot points - actual connection points)
                // 2. Pattern-specific centering offset (centers this pattern on center pivot)
                // 3. Stack offset (positions beam within the centered stack)
                // When offsetValue = 0, the beam passes through center pivots
                const beamStart = vAdd(vAdd(patternBot, centeringOffset), stackOffset);
                const beamEnd = vAdd(vAdd(patternTop, centeringOffset), stackOffset);
                
                // Extend beam ends by vertEndOffset along the beam direction
                const extStart = vAdd(beamStart, vScale(patternDir, -state.vertEndOffset));
                const extEnd = vAdd(beamEnd, vScale(patternDir, state.vertEndOffset));
                
                beams.push(new Beam3D(extStart, extEnd, vW, vT, woodColor, {
                    moduleIndex: i,
                    stackType: 'vertical',
                    stackId: i  // Each module has one vertical stack
            
            // --- CAP UPRIGHTS (for arch mode) ---
            // Add vertical uprights on the open end of the first module
            if (i === 0 && state.archCapUprights) {
                // Cap uprights use the LEFT side pivot points (bl/tl) instead of right side (br/tr)
                const capBotInner = map(loc.bl, yMin);
                const capTopOuter = map(loc.tl, yMax);
                const capBotOuter = map(loc.tl, yMin);
                const capTopInner = map(loc.bl, yMax);
                
                // Calculate center pivot points for cap stack
                const capPivotBotCenter = vScale(vAdd(capBotInner, capBotOuter), 0.5);
                const capPivotTopCenter = vScale(vAdd(capTopOuter, capTopInner), 0.5);
                
                // Pattern vectors for cap uprights
                const capPatternA_bot = capBotInner;
                const capPatternA_top = capTopOuter;
                const capPatternA_dir = vNorm(vSub(capPatternA_top, capPatternA_bot));
                const capPatternA_mid = vScale(vAdd(capPatternA_bot, capPatternA_top), 0.5);
                
                const capPatternB_bot = capBotOuter;
                const capPatternB_top = capTopInner;
                const capPatternB_dir = vNorm(vSub(capPatternB_top, capPatternB_bot));
                const capPatternB_mid = vScale(vAdd(capPatternB_bot, capPatternB_top), 0.5);
                
                // Calculate stack direction for cap uprights
                let capStackDir = vNorm(vCross(capPatternA_dir, capPatternB_dir));
                if (vMag(capStackDir) < 0.1) {
                    const capAvgDir = vNorm(vScale(vAdd(capPatternA_dir, capPatternB_dir), 0.5));
                    capStackDir = vNorm(vCross(capAvgDir, up));
                if (vMag(capStackDir) < 0.1) {
                    capStackDir = vNorm(vCross(capPatternA_dir, up));
                
                const capStackDirNorm = vNorm(capStackDir);
                const capCenterMid = vScale(vAdd(capPivotBotCenter, capPivotTopCenter), 0.5);
                
                // Calculate centering offset for cap stack
                let capTotalPosition = {x: 0, y: 0, z: 0};
                for (let j = 0; j < state.vStackCount; j++) {
                    const offsetValue = startOffset + j * (vW + gap);
                    const stackOffsetVec = vScale(capStackDirNorm, offsetValue);
                    const isPatternA = state.vStackReverse ? (j % 2 !== 0) : (j % 2 === 0);
                    const patternMid = isPatternA ? capPatternA_mid : capPatternB_mid;
                    capTotalPosition = vAdd(capTotalPosition, vAdd(patternMid, stackOffsetVec));
                const capAvgMid = vScale(capTotalPosition, 1 / state.vStackCount);
                const capOffsetToCenter = vSub(capCenterMid, capAvgMid);
                const capCenteringOffset = vScale(capStackDirNorm, vDot(capOffsetToCenter, capStackDirNorm));
                
                // Create cap upright beams
                for (let j = 0; j < state.vStackCount; j++) {
                    const offsetValue = startOffset + j * (vW + gap);
                    const stackOffset = vScale(capStackDirNorm, offsetValue);
                    const isPatternA = state.vStackReverse ? (j % 2 !== 0) : (j % 2 === 0);
                    
                    let patternBot, patternTop, patternDir;
                    if (isPatternA) {
                        patternBot = capBotInner;
                        patternTop = capTopOuter;
                        patternDir = capPatternA_dir;
                        patternBot = capBotOuter;
                        patternTop = capTopInner;
                        patternDir = capPatternB_dir;
                    
                    const beamStart = vAdd(vAdd(patternBot, capCenteringOffset), stackOffset);
                    const beamEnd = vAdd(vAdd(patternTop, capCenteringOffset), stackOffset);
                    const extStart = vAdd(beamStart, vScale(patternDir, -state.vertEndOffset));
                    const extEnd = vAdd(beamEnd, vScale(patternDir, state.vertEndOffset));
                    
                    beams.push(new Beam3D(extStart, extEnd, vW, vT, woodColor, {
                        moduleIndex: i,
                        stackType: 'vertical-cap',
                        stackId: -1  // Cap stack has special ID
            
            // Place brackets and bolts at pivot points
            // Brackets are 3D boxes that connect horizontal beams to vertical beams
            if(state.showBrackets || state.showBolts) {
                // The horizontal pivot points where vertical beams connect
                const hPivotBotInner = map(loc.br, 0);  // Bottom ring, inner pivot
                const hPivotBotOuter = map(loc.tr, 0);  // Bottom ring, outer pivot
                const hPivotTopInner = map(loc.br, topH); // Top ring, inner pivot
                const hPivotTopOuter = map(loc.tr, topH); // Top ring, outer pivot
                
                // Vertical beam direction (for bracket orientation)
                const vBeamDir = avgPatternDir;
                
                // Calculate bracket dimensions
                const bracketWidth = Math.max(vW * 1.2, 2.5);
                const bracketDepth = Math.max(vT * 1.2, 2.5);
                const bracketHeight = state.bracketOffset;
                const bracketThickness = 0.25;
                
                // Vertical stack bolt direction (horizontal, through the stack)
                const vBoltDir = stackDirNorm;
                const vBoltLength = totalThick + 1;
                
                // Helper to create a 3D bracket at a pivot point
                const createBracket = (pivotPos, isBottom, beamDir) => {
                    const baseY = isBottom ? 0 : topH;
                    const extendDir = isBottom ? 1 : -1;
                    const right = vNorm(vCross(beamDir, {x:0, y:1, z:0}));
                    
                    return {
                        pos: pivotPos,
                        baseY: baseY,
                        height: bracketHeight * extendDir,
                        width: bracketWidth,
                        depth: bracketDepth,
                        thickness: bracketThickness,
                        beamDir: beamDir,
                        right: right,
                        isBottom: isBottom,
                        boltDir: vBoltDir,
                        z: pivotPos.y
                
                // Helper to create horizontal bolt (through vertical stack)
                const createHorizontalBolt = (pos, dir, length) => {
                    return {
                        start: vAdd(pos, vScale(dir, -length / 2)),
                        end: vAdd(pos, vScale(dir, length / 2)),
                        center: pos,
                        dir: dir,
                        radius: BOLT_RADIUS,
                        headRadius: BOLT_HEAD_RADIUS,
                        headHeight: BOLT_HEAD_HEIGHT,
                        z: pos.y
                
                // Helper to create vertical bolt (through horizontal stack)
                const createVerticalBolt = (xzPos, yBottom, yTop) => {
                    const boltStart = {x: xzPos.x, y: yBottom, z: xzPos.z};
                    const boltEnd = {x: xzPos.x, y: yTop, z: xzPos.z};
                    const boltCenter = {x: xzPos.x, y: (yBottom + yTop) / 2, z: xzPos.z};
                    return {
                        start: boltStart,
                        end: boltEnd,
                        center: boltCenter,
                        dir: {x: 0, y: 1, z: 0},
                        radius: BOLT_RADIUS,
                        headRadius: BOLT_HEAD_RADIUS,
                        headHeight: BOLT_HEAD_HEIGHT,
                        z: boltCenter.y
                
                if(state.showBrackets) {
                    // Bottom ring brackets (extending upward)
                    brackets.push(createBracket(hPivotBotInner, true, vBeamDir));
                    brackets.push(createBracket(hPivotBotOuter, true, vBeamDir));
                    
                    // Top ring brackets (extending downward)
                    brackets.push(createBracket(hPivotTopInner, false, vBeamDir));
                    brackets.push(createBracket(hPivotTopOuter, false, vBeamDir));
                
                if(state.showBolts) {
                    // === VERTICAL MODULE BOLTS (horizontal orientation) ===
                    // These go through the vertical beam stack at the actual pivot points
                    
                    // 1. Bottom pivot bolts - at yMin (where vertical beams attach to bottom ring)
                    bolts.push(createHorizontalBolt(pBotInner, vBoltDir, vBoltLength));
                    bolts.push(createHorizontalBolt(pBotOuter, vBoltDir, vBoltLength));
                    
                    // 2. Top pivot bolts - at yMax (where vertical beams attach to top ring)
                    bolts.push(createHorizontalBolt(pTopOuter, vBoltDir, vBoltLength));
                    bolts.push(createHorizontalBolt(pTopInner, vBoltDir, vBoltLength));
                    
                    // 3. CENTER pivot bolt (horizontal, where the two X beams cross)
                    bolts.push(createHorizontalBolt(centerMid, vBoltDir, vBoltLength));
                    
                    // 4. CAP UPRIGHT bolts (for first module when cap uprights enabled)
                    if (i === 0 && state.archCapUprights) {
                        // Cap upright pivot positions (using bl/tl instead of br/tr)
                        const capBotInner = map(loc.bl, yMin);
                        const capTopOuter = map(loc.tl, yMax);
                        const capBotOuter = map(loc.tl, yMin);
                        const capTopInner = map(loc.bl, yMax);
                        const capCenterMid = vScale(vAdd(
                            vScale(vAdd(capBotInner, capBotOuter), 0.5),
                            vScale(vAdd(capTopOuter, capTopInner), 0.5)
                        ), 0.5);
                        
                        // Calculate cap stack direction
                        const capPatternA_dir = vNorm(vSub(capTopOuter, capBotInner));
                        const capPatternB_dir = vNorm(vSub(capTopInner, capBotOuter));
                        let capStackDir = vNorm(vCross(capPatternA_dir, capPatternB_dir));
                        if (vMag(capStackDir) < 0.1) {
                            const capAvgDir = vNorm(vScale(vAdd(capPatternA_dir, capPatternB_dir), 0.5));
                            capStackDir = vNorm(vCross(capAvgDir, {x:0, y:1, z:0}));
                        const capBoltDir = vNorm(capStackDir);
                        
                        // Bottom pivot bolts for cap uprights
                        bolts.push(createHorizontalBolt(capBotInner, capBoltDir, vBoltLength));
                        bolts.push(createHorizontalBolt(capBotOuter, capBoltDir, vBoltLength));
                        
                        // Top pivot bolts for cap uprights
                        bolts.push(createHorizontalBolt(capTopOuter, capBoltDir, vBoltLength));
                        bolts.push(createHorizontalBolt(capTopInner, capBoltDir, vBoltLength));
                        
                        // Center pivot bolt for cap uprights
                        bolts.push(createHorizontalBolt(capCenterMid, capBoltDir, vBoltLength));
                
                // CAP UPRIGHT brackets (for first module when cap uprights enabled)
                if (i === 0 && state.archCapUprights && state.showBrackets) {
                    const capBotInner = map(loc.bl, 0);
                    const capBotOuter = map(loc.tl, 0);
                    const capTopInner = map(loc.bl, topH);
                    const capTopOuter = map(loc.tl, topH);
                    
                    const capPatternA_dir = vNorm(vSub(capTopOuter, capBotInner));
                    const capPatternB_dir = vNorm(vSub(capTopInner, capBotOuter));
                    const capAvgDir = vNorm(vScale(vAdd(capPatternA_dir, capPatternB_dir), 0.5));
                    
                    // Bottom ring brackets for cap uprights
                    brackets.push(createBracket(capBotInner, true, capAvgDir));
                    brackets.push(createBracket(capBotOuter, true, capAvgDir));
                    
                    // Top ring brackets for cap uprights
                    brackets.push(createBracket(capTopInner, false, capAvgDir));
                    brackets.push(createBracket(capTopOuter, false, capAvgDir));
        
        // --- FIXED STRAIGHT BEAMS (non-folding, constant spacing) ---
        // Create beams regardless of zHeight - they connect bottom ring to top ring
        // This block is OUTSIDE the scissor uprights block
        if (state.useFixedBeams) {
            // Use vLengthFt for fixed beam length (convert to inches)
            const fixedBeamLengthInches = state.vLengthFt * INCHES_PER_FOOT;
            state.fixedBeamLength = fixedBeamLengthInches;
            
            // Fixed beam dimensions - use vertical beam dimensions
            const fixedBeamWidth = state.vBeamW;
            const fixedBeamThick = state.vBeamT;
            
            // Get pivot points at the horizontal ring level (not offset by bracketOffset)
            // Bottom ring points
            const bottomInner = map(loc.br, 0);
            const bottomOuter = map(loc.tr, 0);
            // Top ring points (at fixed height above bottom)
            const topInner = map(loc.br, topH);
            const topOuter = map(loc.tr, topH);
            
            // Create fixed straight beams connecting bottom to top
            // Beam 1: Inner pivot - straight vertical beam
            const beam1Start = bottomInner;
            const beam1End = topInner;
            
            // Only create if start and end are different
            const beam1Len = vMag(vSub(beam1End, beam1Start));
            if (beam1Len > 0.1) {
                beams.push(new Beam3D(beam1Start, beam1End, fixedBeamWidth, fixedBeamThick, woodColor, {
                    moduleIndex: i,
                    stackType: 'fixed-beam',
                    stackId: i * 2 + 0
            
            // Beam 2: Outer pivot - straight vertical beam
            const beam2Start = bottomOuter;
            const beam2End = topOuter;
            
            const beam2Len = vMag(vSub(beam2End, beam2Start));
            if (beam2Len > 0.1) {
                beams.push(new Beam3D(beam2Start, beam2End, fixedBeamWidth, fixedBeamThick, woodColor, {
                    moduleIndex: i,
                    stackType: 'fixed-beam',
                    stackId: i * 2 + 1
            
            // --- FIXED CAP BEAMS (for arch mode with cap uprights) ---
            // Add fixed straight beams at the cap position (first module, left side)
            if (i === 0 && state.archCapUprights) {
                // Cap beams use LEFT side pivot points (bl/tl) instead of right side (br/tr)
                const capBottomInner = map(loc.bl, 0);
                const capBottomOuter = map(loc.tl, 0);
                const capTopInner = map(loc.bl, topH);
                const capTopOuter = map(loc.tl, topH);
                
                // Cap Beam 1: Inner pivot (bl)
                const capBeam1Len = vMag(vSub(capTopInner, capBottomInner));
                if (capBeam1Len > 0.1) {
                    beams.push(new Beam3D(capBottomInner, capTopInner, fixedBeamWidth, fixedBeamThick, woodColor, {
                        moduleIndex: i,
                        stackType: 'fixed-beam-cap',
                        stackId: -2  // Special ID for cap beams
                
                // Cap Beam 2: Outer pivot (tl)
                const capBeam2Len = vMag(vSub(capTopOuter, capBottomOuter));
                if (capBeam2Len > 0.1) {
                    beams.push(new Beam3D(capBottomOuter, capTopOuter, fixedBeamWidth, fixedBeamThick, woodColor, {
                        moduleIndex: i,
                        stackType: 'fixed-beam-cap',
                        stackId: -3  // Special ID for cap beams
        
        // === HORIZONTAL MODULE BOLTS (vertical orientation) ===
        // These go through the horizontal beam stacks at the center pivot
        if(state.showBolts) {
            // Calculate the actual intersection point of the horizontal X pattern
            // Line 1: from visLoc.bl to visLoc.tr (pattern A)
            // Line 2: from visLoc.br to visLoc.tl (pattern B)
            // Use parametric line intersection formula
            const bl = visLoc.bl, tr = visLoc.tr, br = visLoc.br, tl = visLoc.tl;
            const d1x = tr.x - bl.x, d1y = tr.y - bl.y;
            const d2x = tl.x - br.x, d2y = tl.y - br.y;
            const denom = d1x * d2y - d1y * d2x;
            
            let hCenter2D;
            if (Math.abs(denom) > 0.0001) {
                // Lines intersect - find intersection point
                const t = ((br.x - bl.x) * d2y - (br.y - bl.y) * d2x) / denom;
                hCenter2D = {x: bl.x + t * d1x, y: bl.y + t * d1y};
                // Lines are parallel - use midpoint as fallback
                hCenter2D = vScale(vAdd(vAdd(vAdd(bl, tr), br), tl), 0.25);
            
            // Map to 3D at bottom and top ring heights
            const hCenterBot = map(hCenter2D, 0);
            const hCenterTop = map(hCenter2D, topH);
            
            // Calculate horizontal stack thickness for bolt length
            const hStackThick = state.hStackCount * hT + (state.hStackCount - 1) * state.stackGap;
            const hBoltLength = hStackThick + 1; // Add extra for head/nut
            
            // Bottom horizontal ring center bolt (vertical)
            bolts.push({
                start: {x: hCenterBot.x, y: -hBoltLength / 2, z: hCenterBot.z},
                end: {x: hCenterBot.x, y: hBoltLength / 2, z: hCenterBot.z},
                center: hCenterBot,
                dir: {x: 0, y: 1, z: 0},
                radius: BOLT_RADIUS,
                headRadius: BOLT_HEAD_RADIUS,
                headHeight: BOLT_HEAD_HEIGHT,
                z: hCenterBot.y
            
            // Top horizontal ring center bolt (vertical)
            bolts.push({
                start: {x: hCenterTop.x, y: topH - hBoltLength / 2, z: hCenterTop.z},
                end: {x: hCenterTop.x, y: topH + hBoltLength / 2, z: hCenterTop.z},
                center: hCenterTop,
                dir: {x: 0, y: 1, z: 0},
                radius: BOLT_RADIUS,
                headRadius: BOLT_HEAD_RADIUS,
                headHeight: BOLT_HEAD_HEIGHT,
                z: hCenterTop.y
        
        // Track maximum radius for diameter calculation
        const currentRadius = vMag(map(visLoc.tr, 0));
        if (currentRadius > maxRad) maxRad = currentRadius;

        // Calculate next module position and rotation
        const nextRotation = curRot + relativeRotation;
        const nextBlX = loc.bl.x * Math.cos(nextRotation) - loc.bl.y * Math.sin(nextRotation);
        const nextBlY = loc.bl.x * Math.sin(nextRotation) + loc.bl.y * Math.cos(nextRotation);
        const currentBrX = loc.br.x * Math.cos(curRot) - loc.br.y * Math.sin(curRot);
        const currentBrY = loc.br.x * Math.sin(curRot) + loc.br.y * Math.cos(curRot);
        curPos.x = (curPos.x + currentBrX) - nextBlX;
        curPos.y = (curPos.y + currentBrY) - nextBlY;
        curRot = nextRotation;
    
    let maxHeight = zHeight + (state.bracketOffset*2) + state.hBeamT + state.vertEndOffset;

    // Apply orientation transformation for vertical (arch/bridge) mode
    if (state.orientation === 'vertical') {
        // For arch mode, transform the horizontal ring into a vertical arch
        // The feet (outer pivots of first and last modules) should track along the ground
        
        // Step 1: Find the feet - outer pivots of first and last modules
        // If cap uprights are present, use them for the left foot instead
        const hBeams = beams.filter(b => b.stackType && b.stackType.startsWith('horizontal'));
        // Include both regular cap uprights AND fixed cap beams
        const capBeams = beams.filter(b => b.stackType === 'vertical-cap' || b.stackType === 'fixed-beam-cap');
        let leftFoot = null;
        let rightFoot = null;
        
        // Check for cap uprights/beams first - if present, use them for left foot
        if (state.archCapUprights && capBeams.length > 0) {
            // Find the outermost point of the cap uprights (largest radius)
            let maxRadCap = -Infinity;
            capBeams.forEach(beam => {
                if (beam.p1) {
                    const rad = Math.sqrt(beam.p1.x * beam.p1.x + beam.p1.z * beam.p1.z);
                    if (rad > maxRadCap) { maxRadCap = rad; leftFoot = {...beam.p1}; }
                if (beam.p2) {
                    const rad = Math.sqrt(beam.p2.x * beam.p2.x + beam.p2.z * beam.p2.z);
                    if (rad > maxRadCap) { maxRadCap = rad; leftFoot = {...beam.p2}; }
                // Also check corners for more accurate foot position
                if (beam.corners) {
                    beam.corners.forEach(c => {
                        if (c) {
                            const rad = Math.sqrt(c.x * c.x + c.z * c.z);
                            if (rad > maxRadCap) { maxRadCap = rad; leftFoot = {...c}; }
        
        if (hBeams.length >= 2) {
            const sorted = [...hBeams].sort((a, b) => (a.moduleIndex ?? 0) - (b.moduleIndex ?? 0));
            const minModule = sorted[0].moduleIndex;
            const maxModule = sorted[sorted.length - 1].moduleIndex;
            
            // Get beams from first and last modules
            const firstBeams = sorted.filter(b => b.moduleIndex === minModule);
            const lastBeams = sorted.filter(b => b.moduleIndex === maxModule);
            
            // Only find left foot from first module if not already set by cap uprights
            if (!leftFoot) {
                let maxRadFirst = -Infinity;
                firstBeams.forEach(beam => {
                    if (beam.p1) {
                        const rad = Math.sqrt(beam.p1.x * beam.p1.x + beam.p1.z * beam.p1.z);
                        if (rad > maxRadFirst) { maxRadFirst = rad; leftFoot = {...beam.p1}; }
                    if (beam.p2) {
                        const rad = Math.sqrt(beam.p2.x * beam.p2.x + beam.p2.z * beam.p2.z);
                        if (rad > maxRadFirst) { maxRadFirst = rad; leftFoot = {...beam.p2}; }
            
            // Find outermost pivot from last module for right foot
            let maxRadLast = -Infinity;
            lastBeams.forEach(beam => {
                if (beam.p1) {
                    const rad = Math.sqrt(beam.p1.x * beam.p1.x + beam.p1.z * beam.p1.z);
                    if (rad > maxRadLast) { maxRadLast = rad; rightFoot = {...beam.p1}; }
                if (beam.p2) {
                    const rad = Math.sqrt(beam.p2.x * beam.p2.x + beam.p2.z * beam.p2.z);
                    if (rad > maxRadLast) { maxRadLast = rad; rightFoot = {...beam.p2}; }
        
        // Fallback: use geometry center if feet not found
        if (!leftFoot || !rightFoot) {
            let sumX = 0, sumY = 0, sumZ = 0, count = 0;
            beams.forEach(beam => {
                if (beam.corners) {
                    beam.corners.forEach(c => {
                        if (c) { sumX += c.x; sumY += c.y; sumZ += c.z; count++; }
            const cx = count > 0 ? sumX / count : 0;
            const cy = count > 0 ? sumY / count : 0;
            const cz = count > 0 ? sumZ / count : 0;
            leftFoot = leftFoot || {x: cx - 10, y: cy, z: cz};
            rightFoot = rightFoot || {x: cx + 10, y: cy, z: cz};
        
        // Step 2: Calculate transformation based on feet positions
        // Midpoint between feet becomes the center of rotation
        const midX = (leftFoot.x + rightFoot.x) / 2;
        const midY = (leftFoot.y + rightFoot.y) / 2;
        const midZ = (leftFoot.z + rightFoot.z) / 2;
        
        // Angle to align feet with X axis
        const dx = rightFoot.x - leftFoot.x;
        const dz = rightFoot.z - leftFoot.z;
        const footAngle = Math.atan2(dz, dx);
        
        // User rotation (additional rotation around Y before making vertical)
        const userRotRad = (state.archRotation || 0) * Math.PI / 180;
        const totalRotY = -footAngle + userRotRad;
        const cosR = Math.cos(totalRotY);
        const sinR = Math.sin(totalRotY);
        
        // Flip control
        const flipY = state.archFlipVertical ? -1 : 1;
        
        // Step 3: Combined transformation
        const transformPoint = (p) => {
            if (!p || typeof p.x === 'undefined') return p;
            
            // Translate to center on feet midpoint
            let x = p.x - midX;
            let y = p.y - midY;
            let z = p.z - midZ;
            
            // Rotate around Y to align feet with X axis + user rotation
            const x2 = x * cosR - z * sinR;
            const y2 = y;
            const z2 = x * sinR + z * cosR;
            
            // Rotate 90Ã‚Â° around X: (x, y, z) -> (x, z, -y), with flip
            return { x: x2, y: z2 * flipY, z: -y2 };
        
        const transformDir = (v) => {
            if (!v || typeof v.x === 'undefined') return v;
            const x2 = v.x * cosR - v.z * sinR;
            const y2 = v.y;
            const z2 = v.x * sinR + v.z * cosR;
            return { x: x2, y: z2 * flipY, z: -y2 };
        
        // Apply transformation to all geometry
        beams.forEach(beam => {
            if (beam.corners) beam.corners = beam.corners.map(c => transformPoint(c));
            if (beam.p1) beam.p1 = transformPoint(beam.p1);
            if (beam.p2) beam.p2 = transformPoint(beam.p2);
            if (beam.center) beam.center = transformPoint(beam.center);
            // Also transform beam axes for consistent rendering
            if (beam.axisX) beam.axisX = transformDir(beam.axisX);
            if (beam.axisY) beam.axisY = transformDir(beam.axisY);
            if (beam.axisZ) beam.axisZ = transformDir(beam.axisZ);
            // Transform face normals
            if (beam.faces) {
                beam.faces.forEach(face => {
                    if (face.norm) face.norm = transformDir(face.norm);
        
        brackets.forEach(bracket => {
            if (bracket.pos) bracket.pos = transformPoint(bracket.pos);
            if (bracket.baseY !== undefined && bracket.pos) bracket.baseY = bracket.pos.y;
            if (bracket.beamDir) bracket.beamDir = transformDir(bracket.beamDir);
            if (bracket.right) bracket.right = transformDir(bracket.right);
            if (bracket.boltDir) bracket.boltDir = transformDir(bracket.boltDir);
        
        bolts.forEach(bolt => {
            if (bolt.start) bolt.start = transformPoint(bolt.start);
            if (bolt.end) bolt.end = transformPoint(bolt.end);
            if (bolt.center) bolt.center = transformPoint(bolt.center);
            if (bolt.dir) bolt.dir = transformDir(bolt.dir);
        
        // Transform feet positions too
        leftFoot = transformPoint(leftFoot);
        rightFoot = transformPoint(rightFoot);
        
        // Step 4: Ground to feet positions
        // The feet should be at Y=0, and centered on X
        const feetY = Math.min(leftFoot.y, rightFoot.y);
        const feetCenterX = (leftFoot.x + rightFoot.x) / 2;
        
        const groundPoint = (p) => {
            if (!p || typeof p.y === 'undefined') return p;
            return { x: p.x - feetCenterX, y: p.y - feetY, z: p.z };
        
        beams.forEach(beam => {
            if (beam.corners) beam.corners = beam.corners.map(c => groundPoint(c));
            if (beam.p1) beam.p1 = groundPoint(beam.p1);
            if (beam.p2) beam.p2 = groundPoint(beam.p2);
            if (beam.center) beam.center = groundPoint(beam.center);
        
        brackets.forEach(bracket => {
            if (bracket.pos) bracket.pos = groundPoint(bracket.pos);
            if (bracket.baseY !== undefined) bracket.baseY -= feetY;
        
        bolts.forEach(bolt => {
            if (bolt.start) bolt.start = groundPoint(bolt.start);
            if (bolt.end) bolt.end = groundPoint(bolt.end);
            if (bolt.center) bolt.center = groundPoint(bolt.center);
        
        // Calculate final dimensions
        let maxY = -Infinity;
        let maxAbsX = 0;
        beams.forEach(beam => {
            if (beam.corners) {
                beam.corners.forEach(c => {
                    if (c) {
                        if (typeof c.y !== 'undefined' && c.y > maxY) maxY = c.y;
                        if (typeof c.x !== 'undefined' && Math.abs(c.x) > maxAbsX) maxAbsX = Math.abs(c.x);
        
        maxHeight = maxY > 0 ? maxY : 0;
        maxRad = maxAbsX;
    
    // Duplicate structure for array mode (tunnel/tube)
    if (state.arrayCount > 1 && state.orientation === 'vertical') {
        // Calculate the depth of a single structure in Z direction to determine spacing
        // Find the frontmost and backmost points
        let minZ = Infinity, maxZ = -Infinity;
        beams.forEach(beam => {
            if (beam.corners) {
                beam.corners.forEach(c => {
                    if (c && typeof c.z !== 'undefined') {
                        if (c.z < minZ) minZ = c.z;
                        if (c.z > maxZ) maxZ = c.z;
            // Also check p1 and p2
            if (beam.p1 && typeof beam.p1.z !== 'undefined') {
                if (beam.p1.z < minZ) minZ = beam.p1.z;
                if (beam.p1.z > maxZ) maxZ = beam.p1.z;
            if (beam.p2 && typeof beam.p2.z !== 'undefined') {
                if (beam.p2.z < minZ) minZ = beam.p2.z;
                if (beam.p2.z > maxZ) maxZ = beam.p2.z;
        const structureDepth = maxZ - minZ;
        const spacing = structureDepth; // Connect structures end-to-end (no gap)
        
        // Store original geometry
        const originalBeams = [...beams];
        const originalBrackets = [...brackets];
        const originalBolts = [...bolts];
        
        // Clear arrays for rebuilding
        beams = [];
        brackets = [];
        bolts = [];
        
        // Create arrayCount copies, extending in Z direction (back)
        // Center the array around Z=0
        const totalArrayDepth = (state.arrayCount - 1) * spacing;
        const startOffsetZ = -totalArrayDepth / 2;
        
        for (let i = 0; i < state.arrayCount; i++) {
            const offsetZ = startOffsetZ + i * spacing; // Each structure is offset further back
            
            // Duplicate beams - preserve orientation by copying corners directly
            originalBeams.forEach(beam => {
                // Clone the beam by copying all its properties with Z offset
                const newBeam = {
                    type: 'beam',
                    colorBase: beam.colorBase,
                    moduleIndex: beam.moduleIndex,
                    stackType: beam.stackType,
                    stackId: beam.stackId,
                    arrayIndex: i, // Track which array copy this beam belongs to
                    w: beam.w,
                    t: beam.t,
                    // Copy axes exactly - preserves orientation
                    axisX: {...beam.axisX},
                    axisY: {...beam.axisY},
                    axisZ: {...beam.axisZ},
                    // Offset endpoints
                    p1: {
                        x: beam.p1.x,
                        y: beam.p1.y,
                        z: (beam.p1.z || 0) + offsetZ
                    p2: {
                        x: beam.p2.x,
                        y: beam.p2.y,
                        z: (beam.p2.z || 0) + offsetZ
                    // Offset center
                    center: {
                        x: beam.center.x,
                        y: beam.center.y,
                        z: (beam.center.z || 0) + offsetZ
                    // Offset corners
                    corners: beam.corners.map(c => ({
                        x: c.x,
                        y: c.y,
                        z: (c.z || 0) + offsetZ
                    // Copy faces with offset normals (normals don't change, just reference)
                    faces: beam.faces.map(f => ({
                        idx: [...f.idx],
                        norm: {...f.norm}
                
                beams.push(newBeam);
            
            // Duplicate brackets
            originalBrackets.forEach(bracket => {
                const newBracket = {...bracket};
                if (newBracket.pos) {
                    newBracket.pos = {x: bracket.pos.x, y: bracket.pos.y, z: bracket.pos.z + offsetZ};
                brackets.push(newBracket);
            
            // Duplicate bolts
            originalBolts.forEach(bolt => {
                const newBolt = {...bolt};
                if (newBolt.start) {
                    newBolt.start = {x: bolt.start.x, y: bolt.start.y, z: bolt.start.z + offsetZ};
                if (newBolt.end) {
                    newBolt.end = {x: bolt.end.x, y: bolt.end.y, z: bolt.end.z + offsetZ};
                if (newBolt.center) {
                    newBolt.center = {x: bolt.center.x, y: bolt.center.y, z: bolt.center.z + offsetZ};
                bolts.push(newBolt);
        
        // Update maxRad to account for array depth if needed
        const arrayDepth = (state.arrayCount - 1) * spacing + structureDepth;
        // maxRad is for X direction, so we don't need to update it for Z depth

    // Build StructureGeometry from the generated beams for panel placement
    const structureGeometry = buildStructureGeometry(beams, brackets, bolts, maxRad, maxHeight);
    
    return { beams, brackets, bolts, maxRad, maxHeight, structureGeometry };

function buildStructureGeometry(beams, brackets, bolts, maxRad, maxHeight) {
    const geometry = new StructureGeometry();
    geometry.maxRadius = maxRad;
    geometry.maxHeight = maxHeight;
    geometry.beams = beams;
    geometry.brackets = brackets;
    geometry.bolts = bolts;
    
    // Calculate structure center from all horizontal beams
    let centerSum = {x: 0, y: 0, z: 0};
    let beamCount = 0;
    beams.forEach(beam => {
        if (beam.stackType && beam.stackType.startsWith('horizontal') && beam.center) {
            centerSum = vAdd(centerSum, beam.center);
            beamCount++;
    if (beamCount > 0) {
        geometry.structureCenter = vScale(centerSum, 1 / beamCount);
    
    // Group beams by module and array index
    const topHBeams = beams.filter(b => b.stackType === 'horizontal-top');
    const botHBeams = beams.filter(b => b.stackType === 'horizontal-bottom');
    
    // Group by arrayIndex (for tunnel mode)
    const groupByArrayIndex = (beamList) => {
        const groups = {};
        beamList.forEach(beam => {
            const idx = beam.arrayIndex !== undefined ? beam.arrayIndex : 0;
            if (!groups[idx]) groups[idx] = [];
            groups[idx].push(beam);
        return groups;
    
    const topArrayGroups = groupByArrayIndex(topHBeams);
    const botArrayGroups = groupByArrayIndex(botHBeams);
    
    // Process each array copy
    Object.keys(topArrayGroups).forEach(arrayIdxStr => {
        const arrayIdx = parseInt(arrayIdxStr);
        const topBeamsInArray = topArrayGroups[arrayIdx] || [];
        const botBeamsInArray = botArrayGroups[arrayIdx] || [];
        
        if (topBeamsInArray.length === 0 || botBeamsInArray.length === 0) return;
        
        // Group beams by moduleIndex
        const topByModule = {};
        const botByModule = {};
        topBeamsInArray.forEach(beam => {
            const mi = beam.moduleIndex !== undefined ? beam.moduleIndex : 0;
            if (!topByModule[mi]) topByModule[mi] = [];
            topByModule[mi].push(beam);
        botBeamsInArray.forEach(beam => {
            const mi = beam.moduleIndex !== undefined ? beam.moduleIndex : 0;
            if (!botByModule[mi]) botByModule[mi] = [];
            botByModule[mi].push(beam);
        
        // Create ModuleGeometry for each module
        const moduleIndices = [...new Set([
        ])].sort((a, b) => a - b);
        
        moduleIndices.forEach(moduleIdx => {
            const topBeamsForModule = topByModule[moduleIdx] || [];
            const botBeamsForModule = botByModule[moduleIdx] || [];
            
            if (topBeamsForModule.length < 2 || botBeamsForModule.length < 2) return;
            
            // CRITICAL: Separate beams by crossing pattern (A vs B), not just by stack order
            // Pattern A and B are the two crossing directions of the scissor module
            const topPatternA = topBeamsForModule.filter(b => b.patternId === 'A');
            const topPatternB = topBeamsForModule.filter(b => b.patternId === 'B');
            const botPatternA = botBeamsForModule.filter(b => b.patternId === 'A');
            const botPatternB = botBeamsForModule.filter(b => b.patternId === 'B');
            
            console.log(`Module ${moduleIdx}: topA=${topPatternA.length}, topB=${topPatternB.length}, botA=${botPatternA.length}, botB=${botPatternB.length}`);
            
            // If we don't have both patterns, fall back to using beam positions
            let topBeamA, topBeamB, botBeamA, botBeamB;
            if (topPatternA.length > 0 && topPatternB.length > 0) {
                topBeamA = topPatternA[0];
                topBeamB = topPatternB[0];
                // Fallback: separate by X position (pattern beams are at different X positions)
                const sorted = [...topBeamsForModule].sort((a, b) => a.center.x - b.center.x);
                topBeamA = sorted[0];
                topBeamB = sorted[sorted.length - 1];
            
            if (botPatternA.length > 0 && botPatternB.length > 0) {
                botBeamA = botPatternA[0];
                botBeamB = botPatternB[0];
                const sorted = [...botBeamsForModule].sort((a, b) => a.center.x - b.center.x);
                botBeamA = sorted[0];
                botBeamB = sorted[sorted.length - 1];
            
            const module = new ModuleGeometry(moduleIdx);
            module.topBeams = [topBeamA, topBeamB];
            module.botBeams = [botBeamA, botBeamB];
            
            // Find uprights for this module
            module.uprights = beams.filter(b => 
                (b.stackType === 'vertical' || b.stackType === 'fixed-beam') &&
                b.moduleIndex === moduleIdx &&
                (b.arrayIndex === undefined || b.arrayIndex === arrayIdx)
            );
            
            geometry.addModule(module);
    
    // Collect geometry creates faces using RoofFace class
    // Pass orientation so faces know which plane to use for "outward" calculation
    geometry.collectGeometry(state.orientation);
    
    console.log('buildStructureGeometry: modules:', geometry.modules.length, 'faces:', geometry.faces.length);
    if (geometry.faces.length > 0) {
        console.log('  face[0] slideAxis:', geometry.faces[0].slideAxis);
        console.log('  face[1] slideAxis:', geometry.faces[1]?.slideAxis);
    
    return geometry;
