// ============================================================================ (ES module)

import { bridgeGlobals } from './global-bridge.js';
import { showToast } from '../core/feedback.js';
import { getConfigSnapshot } from './config-persistence.js';

// HARDWARE ASSEMBLY DETAIL VIEW
// Parametric, editable hardware stacks rendered as an interactive exploded
// 3D view. Each assembly is a list of parts laid out along radiating axes from
// a common center; the explode slider pulls parts outward along their axis.
// This data also enriches the BOM (bushings / lock washers / nuts).
// ============================================================================

const HW_AXIS_DIRS = {
    right: { x: 1, y: 0, z: 0 },
    left:  { x: -1, y: 0, z: 0 },
    up:    { x: 0, y: 1, z: 0 },
    down:  { x: 0, y: -1, z: 0 },
    front: { x: 0, y: 0, z: 1 },
    back:  { x: 0, y: 0, z: -1 }
};

// Perpendicular direction used for crossOffset (hole alignment, etc.)
const HW_AXIS_CROSS = {
    right: { x: 0, y: 1, z: 0 },
    left:  { x: 0, y: 1, z: 0 },
    up:    { x: 1, y: 0, z: 0 },
    down:  { x: 1, y: 0, z: 0 },
    front: { x: 0, y: 1, z: 0 },
    back:  { x: 0, y: 1, z: 0 }
};

const HW_HORIZONTAL_AXES = ['right', 'left', 'front', 'back'];

const HW_MM_TO_IN = 1 / 25.4;

const HW_PART_TYPES = ['bolt', 'bushing', 'washer', 'lockWasher', 'nut', 'bracket', 'beam'];

// Default position fields added to every stack part.
function hwDefaultPartPos() {
    return { posAssembled: 0, posExploded: 0, crossOffset: 0, flipAxis: false };
}

function hwBindNumberScrub(input, onChange) {
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('click', (e) => e.stopPropagation());
    let scrub = null;
    input.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        scrub = { x: e.clientX, val: parseFloat(input.value) || 0, step: parseFloat(input.step) || 0.01 };
        input.setPointerCapture(e.pointerId);
    });
    input.addEventListener('pointermove', (e) => {
        if (!scrub || !input.hasPointerCapture(e.pointerId)) return;
        const steps = Math.round((e.clientX - scrub.x) / 3);
        if (steps === 0) return;
        e.preventDefault();
        scrub.val += steps * scrub.step;
        scrub.x = e.clientX;
        const decimals = input.dataset.decimals != null
            ? parseInt(input.dataset.decimals, 10)
            : ((input.step && String(input.step).includes('.')) ? String(input.step).split('.')[1].length : 2);
        input.value = scrub.val.toFixed(decimals);
        onChange(parseFloat(input.value) || 0);
    });
    input.addEventListener('pointerup', (e) => {
        if (input.hasPointerCapture(e.pointerId)) input.releasePointerCapture(e.pointerId);
        scrub = null;
    });
}

function hwGetPartAxialLength(part) {
    const p = part.params || {};
    switch (part.type) {
        case 'bolt':
            return Math.max(0.1, p.length || 1) + (p.headHeight || (p.diameter || 0.25) * 0.6);
        case 'bushing': {
            let len = Math.max(0.05, p.length || 0.5);
            if (p.flangeOd && p.flangeThickness && p.flangeOd > (p.od || 0)) len += p.flangeThickness;
            return len;
        }
        case 'washer':
        case 'lockWasher':
            return Math.max(0.01, p.thickness || 0.0625);
        case 'nut': {
            let len = Math.max(0.01, p.height || p.length || 0.4375);
            if (p.style === 'rivet' && p.flangeOd && p.flangeThickness) len += p.flangeThickness;
            return len;
        }
        case 'beam':
            return Math.max(0.25, p.thickness || 1.5);
        case 'bracket':
            return Math.max(0.2, p.height || 3.77);
        default:
            return 0.1;
    }
}

function hwGetPartStackContext(part, assembly, explode) {
    const bracketPart = assembly.parts.find(p => p.type === 'bracket');
    const axisKey = part.axis || 'right';
    const dir = HW_AXIS_DIRS[axisKey] || HW_AXIS_DIRS.right;
    const dirVec = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
    const cross = HW_AXIS_CROSS[axisKey] || HW_AXIS_CROSS.right;
    const crossVec = new THREE.Vector3(cross.x, cross.y, cross.z).normalize();
    const gap = assembly.explodeGap || 1.4;

    const axisParts = assembly.parts.filter(p => p.type !== 'bracket' && p.axis === axisKey)
        .sort((a, b) => (a.seq || 0) - (b.seq || 0));

    const stackOrigin = hwGetBracketStackOrigin(bracketPart, axisKey);
    let stackPos = stackOrigin;
    let rank = 0;
    let ctx = null;

    axisParts.forEach(p => {
        const qty = Math.max(1, p.qty || 1);
        const partRank = rank;
        const len = hwGetPartAxialLength(p);
        for (let c = 0; c < qty; c++) {
            if (p.id === part.id) {
                ctx = { stackBase: stackPos, stackOrigin, rank: partRank, copyIndex: c, axisKey, dirVec, crossVec, gap, posExp: p.posExploded || 0, explode };
                return;
            }
        }
        stackPos += hwQtyAssembledSpan(p) + 0.04;
        rank = partRank + 1;
    });
    return ctx;
}

function hwAxisPosFromPart(part, ctx) {
    if (!ctx) return 0;
    const posAsm = part.posAssembled || 0;
    const assembledPos = ctx.stackBase + posAsm;
    const explodedPos = hwExplodedAxisPos(part, ctx.stackOrigin, ctx.rank, ctx.gap);
    return (1 - ctx.explode) * assembledPos + ctx.explode * explodedPos;
}

function hwSetPartAxisPosFromWorld(part, ctx, axisPos) {
    if (!ctx) return;
    const explodedPos = hwExplodedAxisPos(part, ctx.stackOrigin, ctx.rank, ctx.gap);
    const denom = Math.max(1 - ctx.explode, 0.001);
    part.posAssembled = (axisPos - ctx.explode * explodedPos - (1 - ctx.explode) * ctx.stackBase) / denom;
}

function hwProjectPointerToAxisPos(event, ctx) {
    if (!ctx || !hwDetail.raycaster || !hwDetail.camera) return null;
    const canvas = document.getElementById('hw-detail-canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    hwDetail.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    hwDetail.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    hwDetail.raycaster.setFromCamera(hwDetail.pointer, hwDetail.camera);

    const camDir = new THREE.Vector3();
    hwDetail.camera.getWorldDirection(camDir);
    let planeNormal = new THREE.Vector3().crossVectors(ctx.dirVec, camDir);
    if (planeNormal.lengthSq() < 1e-8) {
        planeNormal = new THREE.Vector3().crossVectors(ctx.dirVec, ctx.crossVec);
    }
    planeNormal.normalize();

    const dragPart = getActiveHardwareAssembly().parts.find(p => p.id === hwDetail.dragPartId) || { posAssembled: 0, crossOffset: 0 };
    const anchor = ctx.dirVec.clone().multiplyScalar(hwAxisPosFromPart(dragPart, ctx));
    let crossPos = dragPart.crossOffset || 0;
    if (HW_HORIZONTAL_AXES.indexOf(ctx.axisKey) >= 0) {
        const bracketPart = getActiveHardwareAssembly().parts.find(p => p.type === 'bracket');
        if (bracketPart) crossPos += hwGetBracketHoleY(bracketPart);
    }
    anchor.addScaledVector(ctx.crossVec, crossPos);

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, anchor);
    const hit = new THREE.Vector3();
    if (!hwDetail.raycaster.ray.intersectPlane(plane, hit)) return null;
    return hit.dot(ctx.dirVec);
}

function hwRaycastPartId(event) {
    if (!hwDetail.raycaster || !hwDetail.camera || !hwDetail.assemblyGroup) return null;
    const canvas = document.getElementById('hw-detail-canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    hwDetail.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    hwDetail.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    hwDetail.raycaster.setFromCamera(hwDetail.pointer, hwDetail.camera);
    const hits = hwDetail.raycaster.intersectObjects(hwDetail.assemblyGroup.children, true);
    for (let i = 0; i < hits.length; i++) {
        let node = hits[i].object;
        while (node) {
            if (node.userData && node.userData.partId) return node.userData.partId;
            node = node.parent;
        }
    }
    return null;
}

function hwGetBracketHoleY(bracketPart) {
    if (!bracketPart || !bracketPart.params) return 0;
    const H = bracketPart.params.height || 3.77;
    const fromTop = bracketPart.params.sideHoleFromTop != null ? bracketPart.params.sideHoleFromTop : 1.1875;
    // Hole position is fixed on the full bracket; cutoffHeight only clips the mesh visually.
    return (H / 2) - fromTop;
}

function hwGetBracketStackOrigin(bracketPart, axisKey) {
    if (!bracketPart || !bracketPart.params) return 0.6;
    const halfW = (bracketPart.params.width || 2.15) / 2;
    const halfD = (bracketPart.params.depth || 1.57) / 2;
    if (axisKey === 'right' || axisKey === 'left') return halfW + 0.02;
    if (axisKey === 'front' || axisKey === 'back') return halfD + 0.02;
    if (axisKey === 'up' || axisKey === 'down') return (bracketPart.params.height || 3.77) / 2 + 0.02;
    return 0.6;
}

// Default parameter sets used when adding a new part of a given type in the editor.
function getRivetNutDefaults() {
    return {
        id: 0.5,
        od: 17 * HW_MM_TO_IN,
        length: 0.5,
        flangeOd: 18 * HW_MM_TO_IN,
        flangeThickness: HW_MM_TO_IN,
        style: 'rivet',
        thread: '1/2-13'
    };
}

function getHardwarePartDefaults(type) {
    switch (type) {
        case 'bolt':
            return { diameter: 0.5, length: 3.0, threadLength: 1.0, headType: 'hex', headDia: 0.75, headHeight: 0.3125, driveSize: 0, metric: '' };
        case 'bushing':
            return { id: 0.3125, od: 0.625, length: 1.25, flangeOd: 0, flangeThickness: 0 };
        case 'washer':
            return { id: 0.3125, od: 1.0, thickness: 0.0625 };
        case 'lockWasher':
            return { id: 0.3125, od: 0.5, thickness: 0.078, style: 'split' };
        case 'nut':
            return { id: 0.5, widthAcrossFlats: 0.75, height: 0.4375, style: 'hex', thread: '' };
        case 'rivetNut':
            return getRivetNutDefaults();
        case 'bracket':
            return { useGlb: true, height: 3.77, width: 2.15, depth: 1.57, wallThickness: 0.12, holeDiameter: 0.41, bottomLip: 1.01, sideHoleFromTop: 1.1875, cutoffHeight: 0, glbScaleMul: 1, glbRotX: 0, glbRotY: 90, glbRotZ: 0, posX: 0, posY: 0, posZ: 0 };
        case 'beam':
            return { width: 3.5, thickness: 1.5, length: 96, holeOffset: 1.5, holeDiameter: 8 / 25.4, holeAlign: 'near', rotDeg: 90, syncStructure: true, color: 0x8B6914 };
        default:
            return {};
    }
}

// Seed data. Units are inches internally; metric bolts carry an mm label.
function getDefaultHardwareAssemblies() {
    const mm = (v) => +(v * (1 / 25.4)).toFixed(4);
    const outerVBoltParams = () => ({ diameter: mm(8), length: mm(60), threadLength: mm(24), headType: 'button', headDia: mm(13), headHeight: mm(5), driveSize: mm(4), metric: 'M8x1.25' });
    const bushingParams = () => ({ id: 0.3125, od: 0.625, length: 1.25, flangeOd: 0, flangeThickness: 0 });
    const lockParams = () => ({ id: 0.3125, od: 0.5, thickness: 0.078, style: 'split' });
    const hBeamBeamParams = () => ({
        width: 3.5, thickness: 1.5, length: 18, holeOffset: 9, holeDiameter: 0.5,
        rotDeg: 0, syncStructure: 'hBeam', color: 0x8B6914
    });
    return {
        activeId: 'outerVBeam',
        explode: 0,
        assemblies: {
            outerVBeam: {
                id: 'outerVBeam',
                label: 'Outer V-Beam Assembly',
                detailed: true,
                explodeGap: 1.4,
                // Right and left horizontal stacks are identical and mirrored:
                // only the 'right' parts are stored; the 'left' side is rendered
                // (and edited) as a live mirror of 'right'.
                mirror: { from: 'right', to: 'left' },
                parts: [
                    // U-bracket (fixed at center). sideHoleFromTop aligns horizontal stacks.
                    { id: 'bracket', type: 'bracket', label: 'U-Bracket (Unistrut Trolley)', axis: 'center', seq: 0, qty: 1, perModule: 4, cost: 5.0,
                      params: { useGlb: true, height: 3.77, width: 2.15, depth: 1.57, wallThickness: 0.12, holeDiameter: 0.41, bottomLip: 1.01, sideHoleFromTop: 1.1875, cutoffHeight: 0, glbScaleMul: 1, glbRotX: 0, glbRotY: 90, glbRotZ: 0, posX: 0, posY: 0, posZ: 0 } },
                    // Right horizontal stack (bracket wall -> outward); mirrored to left.
                    { id: 'r-beam', type: 'beam', label: 'Outer V-Beam', axis: 'right', seq: 1, qty: 1, perModule: 2, cost: 0, posAssembled: 0, posExploded: 0, crossOffset: 0, flipAxis: false,
                      params: { width: 3.5, thickness: 1.5, length: 96, holeOffset: 1.5, holeDiameter: 8 / 25.4, rotDeg: 90, syncStructure: true, color: 0x8B6914 } },
                    { id: 'r-bushing', type: 'bushing', label: 'Bushing 5/16"ID 5/8"OD 1.25"', axis: 'right', seq: 2, qty: 1, perModule: 2, cost: 0.85, posAssembled: 0, posExploded: 0, crossOffset: 0, params: bushingParams() },
                    { id: 'r-lock', type: 'lockWasher', label: '5/16" Split Lock Washer', axis: 'right', seq: 3, qty: 1, perModule: 2, cost: 0.06, posAssembled: 0, posExploded: 0, crossOffset: 0, params: lockParams() },
                    { id: 'r-bolt', type: 'bolt', label: 'Outer V-Beam Bolt (8x60mm button)', axis: 'right', seq: 4, qty: 1, perModule: 2, cost: 0.55, posAssembled: 0, posExploded: 0, crossOffset: 0, params: outerVBoltParams() },
                    // Horizontal H-beams at pivot (up/down axes); vertical hardware stack on down.
                    { id: 'u-hbeam', type: 'beam', label: 'Horizontal H-Beam', axis: 'up', seq: 0, qty: 1, perModule: 0, cost: 0, posAssembled: 0, posExploded: 0, crossOffset: 0, flipAxis: false,
                      params: hBeamBeamParams() },
                    { id: 'd-hbeam', type: 'beam', label: 'Horizontal H-Beam', axis: 'down', seq: 0, qty: 1, perModule: 0, cost: 0, posAssembled: 0, posExploded: 0, crossOffset: 0, flipAxis: false,
                      params: Object.assign({}, hBeamBeamParams()) },
                    { id: 'c-inner-washer', type: 'washer', label: 'Inner Washer 5/8"ID 1-5/16"OD', axis: 'down', seq: 1, qty: 1, perModule: 1, cost: 0.08, posAssembled: 0, posExploded: 0, crossOffset: 0, params: { id: 0.625, od: 1.3125, thickness: 0.0625 } },
                    { id: 'c-bolt', type: 'bolt', label: 'H-Pivot Bolt 1/2"x3" Hex', axis: 'down', seq: 2, qty: 1, perModule: 1, cost: 0.75, posAssembled: 0, posExploded: 0, crossOffset: 0, flipAxis: false,
                      params: { diameter: 0.5, length: 3.0, threadLength: 1.0, headType: 'hex', headDia: 0.75, headHeight: 0.3125, driveSize: 0, metric: '', headAtInsert: true } },
                    { id: 'c-outer-washer', type: 'washer', label: 'Outer Washer 5/16"ID 1.5"OD', axis: 'down', seq: 3, qty: 1, perModule: 1, cost: 0.08, posAssembled: 0, posExploded: 0, crossOffset: 0, params: { id: 0.3125, od: 1.5, thickness: 0.0625 } },
                    { id: 'c-nut', type: 'nut', label: '1/2"-13 Rivet Nut', axis: 'down', seq: 4, qty: 1, perModule: 1, cost: 0.40, posAssembled: 0, posExploded: 0, crossOffset: 0, params: { id: 0.5, od: 17 * HW_MM_TO_IN, length: 0.5, flangeOd: 18 * HW_MM_TO_IN, flangeThickness: HW_MM_TO_IN, style: 'rivet', thread: '1/2-13' } }
                ]
            },
            innerVBeam: { id: 'innerVBeam', label: 'Inner V-Beam Assembly', detailed: false, explodeGap: 1.4, parts: [] },
            hCenter:    { id: 'hCenter', label: 'H-Beam Center Linkage Assembly', detailed: false, explodeGap: 1.4, parts: [] },
            vCenter:    { id: 'vCenter', label: 'V-Beam Center Assembly', detailed: false, explodeGap: 1.4, parts: [] }
        }
    };
}

// Ensure a loaded/legacy state always has a valid hardwareAssemblies shape.
function ensureHardwareAssemblies() {
    const defaults = getDefaultHardwareAssemblies();
    if (!state.hardwareAssemblies || typeof state.hardwareAssemblies !== 'object') {
        state.hardwareAssemblies = defaults;
        return;
    }
    const ha = state.hardwareAssemblies;
    if (!ha.assemblies || typeof ha.assemblies !== 'object') ha.assemblies = {};
    Object.keys(defaults.assemblies).forEach(key => {
        if (!ha.assemblies[key]) ha.assemblies[key] = defaults.assemblies[key];
    });
    if (!ha.activeId || !ha.assemblies[ha.activeId]) ha.activeId = 'outerVBeam';
    if (typeof ha.explode !== 'number') ha.explode = 0;

    // Migrate parts: position fields, bracket hole param, outer V-beam stack beam.
    Object.values(ha.assemblies).forEach(asm => {
        if (!asm.parts) return;
        asm.parts.forEach(p => {
            if (p.type !== 'bracket') {
                if (p.posAssembled == null) p.posAssembled = 0;
                if (p.posExploded == null) p.posExploded = 0;
                if (p.crossOffset == null) p.crossOffset = 0;
                if (p.flipAxis == null) p.flipAxis = false;
            }
            if (p.type === 'bracket' && p.params) {
                if (p.params.sideHoleFromTop == null) p.params.sideHoleFromTop = 1.1875;
                if (p.params.posX == null) p.params.posX = 0;
                if (p.params.posY == null) p.params.posY = 0;
                if (p.params.posZ == null) p.params.posZ = 0;
                // Default bracket orientation: 90° Y from legacy zero rotation.
                if (p.params.glbRotY == null && p.params.glbRotX === 0 && p.params.glbRotZ === 0) p.params.glbRotY = 90;
            }
            if (p.type === 'beam' && p.params) {
                if (p.params.syncStructure == null) p.params.syncStructure = true;
                if (p.params.rotDeg == null) p.params.rotDeg = 90;
                if (p.params.holeOffset == null) p.params.holeOffset = state.vertEndOffset || 1.5;
                if (p.params.holeDiameter == null) p.params.holeDiameter = 8 / 25.4;
                if (p.params.holeAlign == null) {
                    const hasBracket = asm.parts.some(x => x.type === 'bracket');
                    p.params.holeAlign = hasBracket ? 'near' : 'center';
                }
            }
        });
        if (asm.id === 'outerVBeam' && !asm.parts.some(p => p.id === 'r-beam')) {
            const defBeam = defaults.assemblies.outerVBeam.parts.find(p => p.id === 'r-beam');
            if (defBeam) {
                asm.parts.push(JSON.parse(JSON.stringify(defBeam)));
                hwRenumberAxis(asm, 'right');
            }
        }
        if (asm.id === 'outerVBeam') {
            const defParts = defaults.assemblies.outerVBeam.parts;
            ['u-hbeam', 'd-hbeam'].forEach(id => {
                if (!asm.parts.some(p => p.id === id)) {
                    const def = defParts.find(p => p.id === id);
                    if (def) asm.parts.push(JSON.parse(JSON.stringify(def)));
                }
            });
            const cBolt = asm.parts.find(p => p.id === 'c-bolt');
            if (cBolt && cBolt.params && cBolt.params.headAtInsert == null) cBolt.params.headAtInsert = true;
            const cNut = asm.parts.find(p => p.id === 'c-nut');
            if (cNut && cNut.params && cNut.params.style === 'rivet') {
                if (cNut.params.od == null) cNut.params.od = 17 * HW_MM_TO_IN;
                if (cNut.params.length == null && cNut.params.height == null) cNut.params.length = 0.5;
                if (cNut.params.flangeOd == null) cNut.params.flangeOd = 18 * HW_MM_TO_IN;
                if (cNut.params.flangeThickness == null) cNut.params.flangeThickness = HW_MM_TO_IN;
            }
            hwRenumberAxis(asm, 'up');
            hwRenumberAxis(asm, 'down');
        }
        // Remove legacy mirrored left-side duplicates (now rendered via mirror flag).
        if (asm.mirror && asm.mirror.from && asm.mirror.to) {
            asm.parts = asm.parts.filter(p => !(p.axis === asm.mirror.to && p.id.startsWith('l-')));
        }
    });
}

// ---------------------------------------------------------------------------
// Mesh factories (each returns a THREE.Group centered at origin, primary axis
// along +Y, with userData.axialLength = extent along that axis for stacking).
// ---------------------------------------------------------------------------

function hwMaterial(kind) {
    const colors = {
        bolt: 0x3a3d42,
        steel: 0x8a8f96,
        bronze: 0xa9742f,
        copper: 0xb87333,
        zinc: 0x9fa6ad,
        thread: 0x2c2f33
    };
    return getCachedMaterial('hw_' + kind, () => new THREE.MeshStandardMaterial({
        color: colors[kind] || 0x888888,
        metalness: 0.75,
        roughness: 0.4
    }));
}

function hwAddHead(group, p, topY) {
    const r = (p.headDia || p.diameter * 1.6) / 2;
    const h = p.headHeight || p.diameter * 0.6;
    const mat = hwMaterial('bolt');
    if (p.headType === 'hex') {
        const shape = new THREE.Shape();
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
            const x = r * Math.cos(a), z = r * Math.sin(a);
            if (i === 0) shape.moveTo(x, z); else shape.lineTo(x, z);
        }
        shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, h, 0); // head spans topY .. topY+h along +Y
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = topY;
        group.add(mesh);
    } else if (p.headType === 'button') {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h * 0.5, 24), mat);
        body.position.y = topY + h * 0.25;
        group.add(body);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
        cap.scale.y = (h * 0.8) / r;
        cap.position.y = topY + h * 0.5;
        group.add(cap);
    } else {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), mat);
        body.position.y = topY + h / 2;
        group.add(body);
    }
    return h;
}

function createHWBoltMesh(p) {
    const group = new THREE.Group();
    const L = Math.max(0.1, p.length || 1);
    const r = Math.max(0.02, (p.diameter || 0.25) / 2);
    const headAtInsert = !!p.headAtInsert;
    const threadLen = Math.min(L, Math.max(0, p.threadLength || 0));

    if (headAtInsert) {
        const headH = hwAddHead(group, p, 0);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 16), hwMaterial('steel'));
        shaft.position.y = headH + L / 2;
        group.add(shaft);
        if (threadLen > 0) {
            const thread = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.04, r * 1.04, threadLen, 16), hwMaterial('thread'));
            thread.position.y = headH + L - threadLen / 2;
            group.add(thread);
        }
        group.userData.axialLength = headH + L;
    } else {
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 16), hwMaterial('steel'));
        shaft.position.y = L / 2;
        group.add(shaft);
        if (threadLen > 0) {
            const thread = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.04, r * 1.04, threadLen, 16), hwMaterial('thread'));
            thread.position.y = threadLen / 2;
            group.add(thread);
        }
        const headH = hwAddHead(group, p, L);
        group.userData.axialLength = L + (headH || 0);
    }
    return group;
}

function hwAnnulusGeometry(id, od, depth, segments) {
    const outerR = od / 2;
    const innerR = Math.min(id / 2, outerR - 0.001);
    const seg = segments || 40;
    const shape = new THREE.Shape();
    shape.moveTo(outerR, 0);
    for (let i = 1; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        shape.lineTo(outerR * Math.cos(a), outerR * Math.sin(a));
    }
    const hole = new THREE.Path();
    hole.moveTo(innerR, 0);
    for (let i = 1; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        hole.lineTo(innerR * Math.cos(a), innerR * Math.sin(a));
    }
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, depth, 0); // span 0..depth along +Y
    return geo;
}

function createHWBushingMesh(p) {
    const group = new THREE.Group();
    const len = Math.max(0.05, p.length || 0.5);
    const matKind = p.copper ? 'copper' : 'steel';
    const tube = new THREE.Mesh(hwAnnulusGeometry(p.id || 0.3, p.od || 0.6, len, 40), hwMaterial(matKind));
    group.add(tube);
    let total = len;
    if (p.flangeOd && p.flangeThickness && p.flangeOd > p.od) {
        const flange = new THREE.Mesh(hwAnnulusGeometry(p.id || 0.3, p.flangeOd, p.flangeThickness, 40), hwMaterial(matKind));
        flange.position.y = len;
        group.add(flange);
        total += p.flangeThickness;
    }
    group.userData.axialLength = total;
    return group;
}

function createHWWasherMesh(p) {
    const group = new THREE.Group();
    const t = Math.max(0.01, p.thickness || 0.0625);
    const mesh = new THREE.Mesh(hwAnnulusGeometry(p.id || 0.3, p.od || 1.0, t, 40), hwMaterial('zinc'));
    group.add(mesh);
    group.userData.axialLength = t;
    return group;
}

function createHWLockWasherMesh(p) {
    const group = new THREE.Group();
    const t = Math.max(0.02, p.thickness || 0.078);
    const outerR = (p.od || 0.5) / 2;
    const innerR = Math.min((p.id || 0.31) / 2, outerR - 0.001);
    const gap = 0.32; // radians of split opening
    const seg = 36;
    const shape = new THREE.Shape();
    shape.moveTo(outerR * Math.cos(gap / 2), outerR * Math.sin(gap / 2));
    for (let i = 1; i <= seg; i++) {
        const a = gap / 2 + (i / seg) * (Math.PI * 2 - gap);
        shape.lineTo(outerR * Math.cos(a), outerR * Math.sin(a));
    }
    for (let i = seg; i >= 0; i--) {
        const a = gap / 2 + (i / seg) * (Math.PI * 2 - gap);
        shape.lineTo(innerR * Math.cos(a), innerR * Math.sin(a));
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, t, 0);
    const mesh = new THREE.Mesh(geo, hwMaterial('steel'));
    group.add(mesh);
    group.userData.axialLength = t;
    return group;
}

function createHWNutMesh(p) {
    if (p.style === 'rivet') {
        return createHWBushingMesh({
            id: p.id || 0.5,
            od: p.od || (17 * HW_MM_TO_IN),
            length: p.length || p.height || 0.5,
            flangeOd: p.flangeOd || (18 * HW_MM_TO_IN),
            flangeThickness: p.flangeThickness || HW_MM_TO_IN,
            copper: true
        });
    }
    const group = new THREE.Group();
    const h = Math.max(0.05, p.height || 0.4375);
    const waf = p.widthAcrossFlats || 0.75;
    const r = waf / Math.cos(Math.PI / 6) / 2; // across-corners radius
    const innerR = Math.max(0.02, (p.id || 0.4) / 2);
    const shape = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const x = r * Math.cos(a), z = r * Math.sin(a);
        if (i === 0) shape.moveTo(x, z); else shape.lineTo(x, z);
    }
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, h, 0);
    const mesh = new THREE.Mesh(geo, hwMaterial('steel'));
    group.add(mesh);
    group.userData.axialLength = h;
    return group;
}

function createHWBeamMesh(p) {
    const group = new THREE.Group();
    const inner = new THREE.Group();
    const W = Math.max(0.25, p.width || 1.5);
    const T = Math.max(0.25, p.thickness || 3.5);
    const L = Math.max(2, p.length || 96);
    const holeOff = Math.max(0.25, p.holeOffset != null ? p.holeOffset : (state.vertEndOffset || 1.5));
    const holeR = Math.max(0.04, (p.holeDiameter || (8 / 25.4)) / 2);
    const holeAlign = p.holeAlign || 'near';
    const rotDeg = p.rotDeg != null ? p.rotDeg : 90;
    const color = p.color || 0x8B6914;
    const mat = getCachedMaterial('hw_beam_' + color, () => new THREE.MeshStandardMaterial({
        color, metalness: 0.05, roughness: 0.85,
        transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide
    }));

    const alignHoleX = hwGetBeamAlignHoleX(p, L, holeOff);

    // Cross-section in shape XY: X = beam length, Y = width. Extruded along Z (= bolt-axis thickness).
    // After rotateX(-90°): length→X, thickness→Y (stack axis), width→Z.
    const shape = new THREE.Shape();
    shape.moveTo(0, -W / 2);
    shape.lineTo(L, -W / 2);
    shape.lineTo(L, W / 2);
    shape.lineTo(0, W / 2);
    shape.closePath();

    const addHole = (cx) => {
        if (cx < holeR || cx > L - holeR) return;
        const holePath = new THREE.Path();
        holePath.absarc(cx, 0, holeR, 0, Math.PI * 2, false);
        shape.holes.push(holePath);
    };
    addHole(holeOff);
    addHole(L - holeOff);
    if (holeAlign === 'center' && Math.abs(alignHoleX - holeOff) > holeR * 2 && Math.abs(alignHoleX - (L - holeOff)) > holeR * 2) {
        addHole(alignHoleX);
    }

    const geo = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    // Anchor stack origin at the selected alignment hole (near end, far end, or center).
    geo.translate(-alignHoleX, 0, 0);
    inner.add(new THREE.Mesh(geo, mat));

    // Center bolt axis (mid-thickness) on local origin for stack alignment.
    inner.position.y = -T / 2;

    if (rotDeg) inner.rotation.y = (rotDeg * Math.PI) / 180;
    group.add(inner);
    group.userData.axialLength = T;
    return group;
}

function hwGetBeamAlignHoleX(p, length, holeOff) {
    const L = length != null ? length : Math.max(2, p.length || 96);
    const off = holeOff != null ? holeOff : Math.max(0.25, p.holeOffset != null ? p.holeOffset : (state.vertEndOffset || 1.5));
    const align = p.holeAlign || 'near';
    if (align === 'center') return L / 2;
    if (align === 'far') return L - off;
    return off;
}

function hwSyncBeamPartFromState(part) {
    if (!part || part.type !== 'beam' || !part.params) return;
    if (part.params.syncStructure === 'hBeam' || part.params.syncStructure === false) return;
    part.params.width = state.vBeamOuterT || state.vBeamT || 3.5;
    part.params.thickness = state.vBeamOuterW || state.vBeamW || 1.5;
    part.params.length = (state.vLengthFt || 8) * 12;
    part.params.holeOffset = state.vertEndOffset || 1.5;
    part.params.holeDiameter = 8 / 25.4;
}

function hwSyncHBeamPartFromState(part) {
    if (!part || part.type !== 'beam' || !part.params || part.params.syncStructure !== 'hBeam') return;
    const segLen = Math.min(24, Math.max(8, (state.hLengthFt || 8) * 12 * 0.2));
    part.params.width = state.hBeamW || 3.5;
    part.params.thickness = state.hBeamT || 1.5;
    part.params.length = segLen;
    part.params.holeOffset = segLen / 2;
    part.params.holeDiameter = state.boltDiameter || 0.5;
}

function hwTagPartMesh(mesh, part) {
    mesh.userData.partId = part.id;
    mesh.userData.hwPartType = part.type;
    mesh.traverse(ch => { ch.userData.partId = part.id; });
}

// --- Bracket GLB loading + cutoff clipping ------------------------------------
const hwBracketGlb = { loading: false, loaded: false, scene: null, error: false };
// Shared horizontal clip plane (world space). Keeps y <= constant; updated per build.
const hwBracketClipPlane = (typeof THREE !== 'undefined') ? new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6) : null;

function loadHwBracketGlb(onReady) {
    if (hwBracketGlb.loaded) { if (onReady) onReady(hwBracketGlb.scene); return; }
    if (hwBracketGlb.error) { if (onReady) onReady(null); return; }
    if (hwBracketGlb.loading) return;
    if (typeof THREE === 'undefined' || !THREE.GLTFLoader) { hwBracketGlb.error = true; if (onReady) onReady(null); return; }
    hwBracketGlb.loading = true;
    const url = new URL('Unistrut Trolley Bracket.glb', window.location.href).href;
    new THREE.GLTFLoader().load(url, (gltf) => {
        hwBracketGlb.loading = false;
        hwBracketGlb.loaded = true;
        hwBracketGlb.scene = gltf.scene;
        // Mark source geometries as cached so clearGroup() never disposes the shared template.
        hwBracketGlb.scene.traverse(ch => { if (ch.isMesh && ch.geometry && !ch.geometry._cacheKey) ch.geometry._cacheKey = 'glbBracketGeo'; });
        if (onReady) onReady(gltf.scene);
    }, undefined, (err) => {
        console.warn('[HW] Failed to load bracket GLB; using parametric fallback.', err);
        hwBracketGlb.loading = false;
        hwBracketGlb.error = true;
        if (onReady) onReady(null);
    });
}

function buildGlbBracketMesh(p) {
    const targetH = Math.max(0.2, p.height || 3.77);
    const group = new THREE.Group();
    const inner = hwBracketGlb.scene.clone(true);

    // Manual orientation overrides (degrees)
    const d2r = Math.PI / 180;
    inner.rotation.set((p.glbRotX || 0) * d2r, (p.glbRotY || 0) * d2r, (p.glbRotZ || 0) * d2r);
    inner.updateMatrixWorld(true);

    // Auto-orient so the longest dimension is vertical (Y), unless disabled.
    if (p.glbAutoOrient !== false) {
        let box = new THREE.Box3().setFromObject(inner);
        const size = box.getSize(new THREE.Vector3());
        if (size.x >= size.y && size.x >= size.z) inner.rotateZ(Math.PI / 2);
        else if (size.z >= size.y && size.z >= size.x) inner.rotateX(Math.PI / 2);
        inner.updateMatrixWorld(true);
    }

    // Fit to target height + recenter at origin.
    let box = new THREE.Box3().setFromObject(inner);
    let size = box.getSize(new THREE.Vector3());
    const scale = (size.y > 1e-6 ? targetH / size.y : 1) * (p.glbScaleMul || 1);
    inner.scale.multiplyScalar(scale);
    inner.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(inner);
    const center = box.getCenter(new THREE.Vector3());
    inner.position.sub(center);

    // Uniform semi-transparent material + cutoff clipping plane.
    const cutoff = Math.max(0, p.cutoffHeight || 0);
    hwBracketClipPlane.constant = cutoff > 0 ? (targetH / 2 - cutoff) : 1e6;
    const mat = getCachedMaterial('hw_bracket_glb_solid', () => new THREE.MeshStandardMaterial({
        color: 0xc2cdd8, metalness: 0.85, roughness: 0.32,
        side: THREE.DoubleSide,
        clippingPlanes: [hwBracketClipPlane], clipShadows: true
    }));
    inner.traverse(ch => { if (ch.isMesh) ch.material = mat; });

    group.add(inner);
    group.userData.axialLength = targetH;
    group.userData.isBracket = true;
    return group;
}

// Parametric U-channel bracket fallback. Side walls lie at +/-X (horizontal bolts
// pass through them), the channel opens toward +Z. cutoffHeight clips the top
// of the mesh only (same as GLB); it does not move stack alignment.
function buildParametricBracketMesh(p) {
    const W = Math.max(0.2, p.width || 2.15);
    const D = Math.max(0.2, p.depth || 1.57);
    const H = Math.max(0.2, p.height || 3.77);
    const t = Math.max(0.02, Math.min(W / 2 - 0.02, p.wallThickness || 0.12));
    const lip = Math.max(0, Math.min(D - t, p.bottomLip || 0));
    const cutoff = Math.max(0, Math.min(H - t, p.cutoffHeight || 0));
    const yBottom = -H / 2;

    hwBracketClipPlane.constant = cutoff > 0 ? (H / 2 - cutoff) : 1e6;
    const group = new THREE.Group();
    const mat = getCachedMaterial('hw_bracket_solid_clip', () => new THREE.MeshStandardMaterial({
        color: 0xc2cdd8, metalness: 0.85, roughness: 0.32, side: THREE.DoubleSide,
        clippingPlanes: [hwBracketClipPlane], clipShadows: true
    }));
    const addBox = (w, h, d, x, y, z) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.position.set(x, y, z);
        group.add(m);
    };

    addBox(t, H, D, -W / 2 + t / 2, 0, 0);
    addBox(t, H, D,  W / 2 - t / 2, 0, 0);
    addBox(W, H, t, 0, 0, -D / 2 + t / 2);
    addBox(W, t, D, 0, H / 2 - t / 2, 0);
    if (lip > 0) addBox(W, t, lip, 0, yBottom + t / 2, D / 2 - lip / 2);

    group.userData.axialLength = H;
    group.userData.isBracket = true;
    return group;
}

function createHWBracketMesh(p) {
    const useGlb = p.useGlb !== false;
    if (useGlb && hwBracketGlb.loaded && hwBracketGlb.scene) {
        return buildGlbBracketMesh(p);
    }
    if (useGlb && !hwBracketGlb.error) {
        // Kick off async load; rebuild the scene once it's ready.
        loadHwBracketGlb(() => {
            if (document.getElementById('hardware-detail-modal')?.classList.contains('visible')) {
                buildHardwareAssemblyScene();
            }
            if (state.showHardwareFullDetail) {
                requestRender();
            }
        });
    }
    return buildParametricBracketMesh(p);
}

function createHardwarePartMesh(part) {
    let g;
    switch (part.type) {
        case 'bolt': g = createHWBoltMesh(part.params); break;
        case 'bushing': g = createHWBushingMesh(part.params); break;
        case 'washer': g = createHWWasherMesh(part.params); break;
        case 'lockWasher': g = createHWLockWasherMesh(part.params); break;
        case 'nut': g = createHWNutMesh(part.params); break;
        case 'bracket': g = createHWBracketMesh(part.params); break;
        case 'beam': g = createHWBeamMesh(part.params); break;
        default: g = new THREE.Group(); g.userData.axialLength = 0.1;
    }
    g.userData.partId = part.id;
    return g;
}

/** Beam rotDeg is applied in part-local space; mirrored axes flip stack direction, so reflect rotDeg about 90° on mirror.to. */
function hwCreatePartMeshForAxis(part, axisKey, assembly) {
    if (part.type === 'beam' && assembly && assembly.mirror && axisKey === assembly.mirror.to && part.params) {
        const rotDeg = part.params.rotDeg != null ? part.params.rotDeg : 90;
        const g = createHWBeamMesh(Object.assign({}, part.params, { rotDeg: 180 - rotDeg }));
        g.userData.partId = part.id;
        return g;
    }
    return createHardwarePartMesh(part);
}

// ---------------------------------------------------------------------------
// Detail scene / renderer / orbit controls
// ---------------------------------------------------------------------------

const hwDetail = {
    initialized: false,
    renderer: null,
    scene: null,
    camera: null,
    controls: null,
    assemblyGroup: null,
    raf: null,
    selectedPartId: null,
    dragPartId: null,
    dragCtx: null,
    pointerDown: null
};

function initHardwareDetailScene() {
    if (hwDetail.initialized) return;
    const canvas = document.getElementById('hw-detail-canvas');
    if (!canvas || typeof THREE === 'undefined') return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.localClippingEnabled = true; // for bracket cutoff clipping plane
    hwDetail.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1b1d22);
    hwDetail.scene = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 1000);
    camera.position.set(6, 4, 8);
    hwDetail.camera = camera;

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(5, 8, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-6, -3, -5);
    scene.add(fill);

    if (THREE.OrbitControls) {
        const controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        hwDetail.controls = controls;
    }

    hwDetail.assemblyGroup = new THREE.Group();
    scene.add(hwDetail.assemblyGroup);

    hwDetail.raycaster = new THREE.Raycaster();
    hwDetail.pointer = new THREE.Vector2();

    canvas.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !hwDetail.assemblyGroup || !hwDetail.camera) return;
        const partId = hwRaycastPartId(e);
        hwDetail.pointerDown = { x: e.clientX, y: e.clientY, partId, moved: false };
        if (partId) {
            const assembly = getActiveHardwareAssembly();
            const part = assembly && assembly.parts.find(p => p.id === partId);
            if (part && part.type !== 'bracket') {
                hwDetail.dragPartId = partId;
                hwDetail.dragCtx = hwGetPartStackContext(part, assembly, hwExplodeFactor());
                if (hwDetail.controls) hwDetail.controls.enabled = false;
                canvas.setPointerCapture(e.pointerId);
            }
        }
    });

    canvas.addEventListener('pointermove', (e) => {
        const pd = hwDetail.pointerDown;
        if (!pd || !hwDetail.dragPartId || !hwDetail.dragCtx) return;
        if (!pd.moved && (Math.abs(e.clientX - pd.x) > 3 || Math.abs(e.clientY - pd.y) > 3)) pd.moved = true;
        if (!pd.moved) return;
        const assembly = getActiveHardwareAssembly();
        const part = assembly && assembly.parts.find(p => p.id === hwDetail.dragPartId);
        if (!part) return;
        const axisPos = hwProjectPointerToAxisPos(e, hwDetail.dragCtx);
        if (axisPos == null) return;
        hwSetPartAxisPosFromWorld(part, hwDetail.dragCtx, axisPos);
        buildHardwareAssemblyScene();
    });

    canvas.addEventListener('pointerup', (e) => {
        const pd = hwDetail.pointerDown;
        if (hwDetail.controls) hwDetail.controls.enabled = true;
        if (pd && !pd.moved && pd.partId) {
            if (hwDetail.selectedPartId !== pd.partId) {
                hwDetail.selectedPartId = pd.partId;
                buildHardwareAssemblyScene();
                renderHardwareEditPanel();
                const card = document.querySelector('.hw-part-card.selected');
                if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        } else if (pd && pd.moved) {
            renderHardwareEditPanel();
            if (typeof updateHUD === 'function') { try { updateHUD(); } catch (err) {} }
        }
        hwDetail.dragPartId = null;
        hwDetail.dragCtx = null;
        hwDetail.pointerDown = null;
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointercancel', (e) => {
        if (hwDetail.controls) hwDetail.controls.enabled = true;
        hwDetail.dragPartId = null;
        hwDetail.dragCtx = null;
        hwDetail.pointerDown = null;
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    });

    hwDetail.initialized = true;

    const animate = () => {
        hwDetail.raf = requestAnimationFrame(animate);
        if (hwDetail.controls) hwDetail.controls.update();
        renderer.render(scene, camera);
    };
    animate();
}

function resizeHardwareDetail() {
    if (!hwDetail.initialized) return;
    const canvas = document.getElementById('hw-detail-canvas');
    const wrap = canvas ? canvas.parentElement : null;
    if (!wrap) return;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (w === 0 || h === 0) return;
    hwDetail.renderer.setSize(w, h, false);
    hwDetail.camera.aspect = w / h;
    hwDetail.camera.updateProjectionMatrix();
}

function getActiveHardwareAssembly() {
    ensureHardwareAssemblies();
    const ha = state.hardwareAssemblies;
    return ha.assemblies[ha.activeId];
}

function hwUseFullDetailAssemblies() {
    if (!state.showHardwareFullDetail) return false;
    ensureHardwareAssemblies();
    const asm = state.hardwareAssemblies.assemblies.outerVBeam;
    return !!(asm && asm.detailed && asm.parts && asm.parts.length);
}

function hwGetOuterVBeamAssembly() {
    ensureHardwareAssemblies();
    return state.hardwareAssemblies.assemblies.outerVBeam;
}

function hwAddOuterAssemblyPlacement(placements, bracketData, vBoltDir, vBoltPivot) {
    placements.push({
        assemblyId: 'outerVBeam',
        pos: { x: bracketData.pos.x, y: bracketData.pos.y, z: bracketData.pos.z },
        bottomY: bracketData.bottomY,
        isBottom: bracketData.isBottom,
        beamDir: { x: bracketData.beamDir.x, y: bracketData.beamDir.y, z: bracketData.beamDir.z },
        right: { x: bracketData.right.x, y: bracketData.right.y, z: bracketData.right.z },
        vBoltDir: { x: vBoltDir.x, y: vBoltDir.y, z: vBoltDir.z },
        sideHoleY: bracketData.sideHoleY,
        vBoltPivot: vBoltPivot ? { x: vBoltPivot.x, y: vBoltPivot.y, z: vBoltPivot.z } : null
    });
}

function hwComputeAssemblyQuaternion(placement) {
    const beamDir = vNorm(placement.beamDir);
    let right = vNorm(placement.right);
    if (vMag(right) < 0.001) right = vNorm(vCross(beamDir, { x: 0, y: 1, z: 0 }));

    let hwX, hwY, hwZ, quaternion;

    if (!placement.bottomPos && vMag(beamDir) > 0.001) {
        // Horizontal cylinder mode: match createBracketMesh Y-rotation, then map V-bolt axis to +X.
        const beamX = beamDir.x, beamZ = beamDir.z;
        const yRot = Math.hypot(beamX, beamZ) > 0.001 ? Math.atan2(beamX, beamZ) : 0;
        quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yRot);
        if (!placement.isBottom) {
            quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
        }
        const basis = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
        const legacyX = new THREE.Vector3(1, 0, 0).applyMatrix4(basis);
        const legacyY = new THREE.Vector3(0, 1, 0).applyMatrix4(basis);
        hwX = vNorm(placement.vBoltDir);
        if (vMag(hwX) < 0.001) hwX = { x: legacyX.x, y: legacyX.y, z: legacyX.z };
        if (hwX.x * legacyX.x + hwX.y * legacyX.y + hwX.z * legacyX.z < 0) hwX = vScale(hwX, -1);
        hwY = { x: legacyY.x, y: legacyY.y, z: legacyY.z };
        hwZ = vNorm(vCross(hwX, hwY));
        if (vMag(hwZ) < 0.001) hwZ = vNorm(beamDir);
        hwY = vNorm(vCross(hwZ, hwX));
    } else {
        // Arch / transformed mode: full 3D frame from bracket vectors.
        let up = vNorm(vCross(right, beamDir));
        if (!placement.isBottom) up = vScale(up, -1);
        hwX = vNorm(placement.vBoltDir);
        if (vMag(hwX) < 0.001) hwX = right;
        if (hwX.x * right.x + hwX.y * right.y + hwX.z * right.z < 0) hwX = vScale(hwX, -1);
        hwY = up;
        if (vMag(hwY) < 0.001) hwY = { x: 0, y: 1, z: 0 };
        hwZ = vNorm(vCross(hwX, hwY));
        if (vMag(hwZ) < 0.001) hwZ = beamDir;
        hwY = vNorm(vCross(hwZ, hwX));
    }

    const matrix = new THREE.Matrix4();
    matrix.set(
        hwX.x, hwY.x, hwZ.x, 0,
        hwX.y, hwY.y, hwZ.y, 0,
        hwX.z, hwY.z, hwZ.z, 0,
        0, 0, 0, 1
    );
    quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);

    const manualYRot = (state.bracketZRotation || 0) * (Math.PI / 180);
    if (Math.abs(manualYRot) > 0.001) {
        const yAxis = new THREE.Vector3(hwY.x, hwY.y, hwY.z);
        const manualQuat = new THREE.Quaternion().setFromAxisAngle(yAxis, manualYRot);
        quaternion.multiply(manualQuat);
    }

    return { quaternion, hwX, hwY, hwZ };
}

function hwComputeOuterAssemblyTransform(placement) {
    const asm = hwGetOuterVBeamAssembly();
    const bracketPart = asm && asm.parts.find(p => p.type === 'bracket');
    const bp = bracketPart && bracketPart.params ? bracketPart.params : {};
    const { quaternion } = hwComputeAssemblyQuaternion(placement);

    const applyLocalNudge = (posVec) => {
        const nudge = new THREE.Vector3(bp.posX || 0, bp.posY || 0, bp.posZ || 0);
        nudge.applyQuaternion(quaternion);
        posVec.add(nudge);
        return posVec;
    };

    // Anchor bracket side hole to the V-stack bolt pivot (exact horizontal stack alignment).
    if (placement.vBoltPivot) {
        const bracketHoleY = hwGetBracketHoleY(bracketPart);
        const sideHoleLocal = new THREE.Vector3(0, bracketHoleY, 0);
        sideHoleLocal.applyQuaternion(quaternion);
        const position = applyLocalNudge(new THREE.Vector3(
            placement.vBoltPivot.x - sideHoleLocal.x,
            placement.vBoltPivot.y - sideHoleLocal.y,
            placement.vBoltPivot.z - sideHoleLocal.z
        ));
        return { position: { x: position.x, y: position.y, z: position.z }, quaternion };
    }

    // Fallback: seat bracket base on the horizontal ring (matches createBracketMesh).
    const bracketH = bp.height || 3.77;
    const wallT = bp.wallThickness || 0.12;
    const centerOff = bracketH / 2 + wallT / 2;
    const { hwY } = hwComputeAssemblyQuaternion(placement);
    const up = new THREE.Vector3(hwY.x, hwY.y, hwY.z);
    let bottom;
    if (placement.bottomPos) bottom = placement.bottomPos;
    else {
        bottom = {
            x: placement.pos.x,
            y: placement.bottomY != null ? placement.bottomY : placement.pos.y,
            z: placement.pos.z
        };
    }
    const center = applyLocalNudge(new THREE.Vector3(
        bottom.x + up.x * centerOff,
        bottom.y + up.y * centerOff,
        bottom.z + up.z * centerOff
    ));
    return { position: { x: center.x, y: center.y, z: center.z }, quaternion };
}

function buildHardwareAssemblyGroup(assembly, options = {}) {
    const group = new THREE.Group();
    if (!assembly) return group;

    const explode = options.explode != null ? options.explode : 0;
    const gap = assembly.explodeGap || 1.4;
    const selectedPartId = options.selectedPartId || null;
    const syncFromState = options.syncFromState !== false;
    const excludeBeams = options.excludeBeams === true;

    if (syncFromState && !excludeBeams) {
        assembly.parts.filter(p => p.type === 'beam').forEach(p => {
            hwSyncBeamPartFromState(p);
            hwSyncHBeamPartFromState(p);
        });
    }

    const selectedMat = () => getCachedMaterial('hw_selected', () => new THREE.MeshStandardMaterial({ color: 0xffb347, metalness: 0.6, roughness: 0.35, emissive: 0x3a2400 }));

    const bracketPart = assembly.parts.find(p => p.type === 'bracket');
    const bracketHoleY = bracketPart ? hwGetBracketHoleY(bracketPart) : 0;

    const applySelection = (mesh, part) => {
        if (selectedPartId && part.id === selectedPartId) {
            mesh.traverse(ch => { if (ch.isMesh) ch.material = selectedMat(); });
        }
    };

    const shouldIncludePart = (part) => !(excludeBeams && part.type === 'beam');

    assembly.parts.filter(p => p.type === 'bracket').forEach(part => {
        const mesh = createHardwarePartMesh(part);
        const bp = part.params || {};
        mesh.position.set(bp.posX || 0, bp.posY || 0, bp.posZ || 0);
        hwTagPartMesh(mesh, part);
        applySelection(mesh, part);
        group.add(mesh);
    });

    const byAxis = {};
    assembly.parts.filter(p => p.type !== 'bracket' && shouldIncludePart(p)).forEach(part => {
        const ax = part.axis || 'right';
        (byAxis[ax] = byAxis[ax] || []).push(part);
    });

    if (assembly.mirror && byAxis[assembly.mirror.from] && !byAxis[assembly.mirror.to]) {
        byAxis[assembly.mirror.to] = byAxis[assembly.mirror.from];
    }

    Object.keys(byAxis).forEach(axisKey => {
        const dir = HW_AXIS_DIRS[axisKey] || HW_AXIS_DIRS.right;
        const dirVec = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
        const cross = HW_AXIS_CROSS[axisKey] || HW_AXIS_CROSS.right;
        const crossVec = new THREE.Vector3(cross.x, cross.y, cross.z).normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirVec);
        const flipEnd = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
        const parts = byAxis[axisKey].slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));

        const stackOrigin = hwGetBracketStackOrigin(bracketPart, axisKey);
        let stackPos = stackOrigin;
        let rank = 0;

        parts.forEach(part => {
            const qty = Math.max(1, part.qty || 1);
            const posAsm = part.posAssembled || 0;
            let crossPos = part.crossOffset || 0;
            if (HW_HORIZONTAL_AXES.indexOf(axisKey) >= 0 && bracketPart) {
                crossPos += bracketHoleY;
            }

            const partRank = rank;
            const partAssembledBase = stackPos;
            const len = hwGetPartAxialLength(part);
            for (let c = 0; c < qty; c++) {
                const mesh = hwCreatePartMeshForAxis(part, axisKey, assembly);
                const assembledPos = hwQtyCopyAssembledPos(partAssembledBase, posAsm, len, c);
                const explodedPos = qty > 1
                    ? hwPartCopyExplodedPos(part, stackOrigin, partRank, gap, c)
                    : hwExplodedAxisPos(part, stackOrigin, partRank, gap);
                const axisPos = (1 - explode) * assembledPos + explode * explodedPos;
                const worldPos = new THREE.Vector3();
                worldPos.addScaledVector(dirVec, axisPos);
                worldPos.addScaledVector(crossVec, crossPos);
                mesh.position.copy(worldPos);
                mesh.quaternion.copy(quat);
                if (part.flipAxis) mesh.quaternion.multiply(flipEnd);
                hwTagPartMesh(mesh, part);
                applySelection(mesh, part);
                group.add(mesh);
            }
            stackPos = partAssembledBase + hwQtyAssembledSpan(part) + 0.04;
            rank = partRank + 1;
        });
    });

    return group;
}

function buildHardwareAssemblyScene() {
    if (!hwDetail.initialized) return;
    const group = hwDetail.assemblyGroup;
    clearGroup(group);

    const assembly = getActiveHardwareAssembly();
    if (!assembly) return;
    hwDetail.assemblyGroup.add(buildHardwareAssemblyGroup(assembly, {
        explode: hwExplodeFactor(),
        selectedPartId: hwDetail.selectedPartId,
        syncFromState: true
    }));
    hwPersistHardwareConfig();
}

// ---------------------------------------------------------------------------
// Editor panel
// ---------------------------------------------------------------------------

const HW_PARAM_FIELDS = {
    bolt: [
        { key: 'diameter', label: 'Dia (in)' },
        { key: 'length', label: 'Length (in)' },
        { key: 'threadLength', label: 'Thread (in)' },
        { key: 'headDia', label: 'Head Dia (in)' },
        { key: 'headHeight', label: 'Head H (in)' }
    ],
    bushing: [
        { key: 'id', label: 'ID (in)' },
        { key: 'od', label: 'OD (in)' },
        { key: 'length', label: 'Length (in)' },
        { key: 'flangeOd', label: 'Flange OD (in)' },
        { key: 'flangeThickness', label: 'Flange T (in)' }
    ],
    washer: [
        { key: 'id', label: 'ID (in)' },
        { key: 'od', label: 'OD (in)' },
        { key: 'thickness', label: 'Thick (in)' }
    ],
    lockWasher: [
        { key: 'id', label: 'ID (in)' },
        { key: 'od', label: 'OD (in)' },
        { key: 'thickness', label: 'Thick (in)' }
    ],
    nut: [
        { key: 'id', label: 'ID (in)' },
        { key: 'od', label: 'OD (in)' },
        { key: 'length', label: 'Length (in)' },
        { key: 'flangeOd', label: 'Flange OD (in)' },
        { key: 'flangeThickness', label: 'Flange T (in)' }
    ],
    bracket: [
        { key: 'height', label: 'Height (in)' },
        { key: 'sideHoleFromTop', label: 'Side Hole (in)' },
        { key: 'cutoffHeight', label: 'Cutoff Top (in)' },
        { key: 'glbScaleMul', label: 'Scale x' },
        { key: 'glbRotX', label: 'Rot X (deg)' },
        { key: 'glbRotY', label: 'Rot Y (deg)' },
        { key: 'glbRotZ', label: 'Rot Z (deg)' },
        { key: 'posX', label: 'Pos X (in)' },
        { key: 'posY', label: 'Pos Y (in)' },
        { key: 'posZ', label: 'Pos Z (in)' }
    ],
    beam: [
        { key: 'width', label: 'Width (in)' },
        { key: 'thickness', label: 'Thick (in)' },
        { key: 'length', label: 'Length (in)' },
        { key: 'holeOffset', label: 'Hole Ext (in)' },
        { key: 'holeDiameter', label: 'Hole Dia (in)' },
        { key: 'rotDeg', label: 'Rot (deg)', step: 1, decimals: 2 }
    ]
};

const HW_TYPE_LABELS = { bolt: 'Bolt', bushing: 'Bushing', washer: 'Washer', lockWasher: 'Lock Washer', nut: 'Nut', rivetNut: 'Rivet Nut', bracket: 'Bracket', beam: 'Beam' };

function hwResolveAddPartType(selectValue) {
    if (selectValue === 'rivetNut') {
        return {
            type: 'nut',
            label: '1/2"-13 Rivet Nut',
            params: getRivetNutDefaults(),
            cost: 0.40,
            presetId: 'rivet-nut-half-13'
        };
    }
    return {
        type: selectValue,
        label: HW_TYPE_LABELS[selectValue] || selectValue,
        params: getHardwarePartDefaults(selectValue),
        cost: 0.10
    };
}

function hwEnsurePartBomKey(part) {
    if (!part.bomKey) part.bomKey = part.presetId || ('bom-' + part.id);
    return part.bomKey;
}

// ---------------------------------------------------------------------------
// Hardware preset library (hardware/registry.json + localStorage + assemblies)
// ---------------------------------------------------------------------------

const hwPresetCatalog = { loaded: false, loading: null, builtins: [] };
const HW_PRESET_STORAGE_KEY = 'linkageLab_hwPresetLibrary';

function hwShortHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
}

function hwSlugifyPresetId(name) {
    return String(name || 'preset').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'preset';
}

function hwPresetSignature(part) {
    const p = part.params || {};
    return [
        part.type,
        part.label || '',
        part.cost || 0,
        JSON.stringify(p),
        part.flipAxis ? 1 : 0,
        p.holeAlign || '',
        p.headAtInsert ? 1 : 0
    ].join('|');
}

function hwExtractPartExtras(part) {
    const extras = {};
    if (part.flipAxis) extras.flipAxis = true;
    if (part.params && part.params.holeAlign) extras.holeAlign = part.params.holeAlign;
    if (part.params && part.params.headAtInsert != null) extras.headAtInsert = part.params.headAtInsert;
    if (part.type === 'beam' && part.params && part.params.syncStructure != null) extras.syncStructure = part.params.syncStructure;
    return extras;
}

function hwLoadUserPresetsMap() {
    try {
        const raw = localStorage.getItem(HW_PRESET_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return (parsed && parsed.presets && typeof parsed.presets === 'object') ? parsed.presets : {};
    } catch (e) {
        return {};
    }
}

function hwSaveUserPreset(preset) {
    const map = hwLoadUserPresetsMap();
    map[preset.id] = preset;
    localStorage.setItem(HW_PRESET_STORAGE_KEY, JSON.stringify({ presets: map }));
}

function hwPartToPreset(part, id, sourceLabel) {
    return {
        id,
        name: part.label || HW_TYPE_LABELS[part.type] || part.type,
        type: part.type,
        label: part.label,
        cost: part.cost || 0,
        link: part.link || '',
        params: JSON.parse(JSON.stringify(part.params || {})),
        extras: hwExtractPartExtras(part),
        source: 'assembly',
        assemblyLabel: sourceLabel || ''
    };
}

function hwCollectAssemblyPresetsMap() {
    const map = new Map();
    ensureHardwareAssemblies();
    Object.values(state.hardwareAssemblies.assemblies).forEach(asm => {
        (asm.parts || []).forEach(part => {
            if (!part || !part.type) return;
            const sig = hwPresetSignature(part);
            const id = part.presetId || ('asm-' + hwShortHash(sig));
            if (!map.has(id)) map.set(id, hwPartToPreset(part, id, asm.label || asm.id));
        });
    });
    return map;
}

async function hwLoadPresetCatalog() {
    if (hwPresetCatalog.loaded) return hwPresetCatalog;
    if (hwPresetCatalog.loading) return hwPresetCatalog.loading;

    hwPresetCatalog.loading = (async () => {
        const builtins = [];
        try {
            const regResp = await fetch('hardware/registry.json');
            if (regResp.ok) {
                const registry = await regResp.json();
                if (Array.isArray(registry)) {
                    for (const entry of registry) {
                        if (!entry || !entry.file || !entry.id) continue;
                        try {
                            const fileResp = await fetch('hardware/' + entry.file);
                            if (!fileResp.ok) continue;
                            const data = await fileResp.json();
                            builtins.push(Object.assign({}, data, entry, { source: 'builtin' }));
                        } catch (e) { /* skip broken preset file */ }
                    }
                }
            }
        } catch (e) {
            console.warn('[HW] Could not load hardware/registry.json', e);
        }
        hwPresetCatalog.builtins = builtins;
        hwPresetCatalog.loaded = true;
        hwPresetCatalog.loading = null;
        return hwPresetCatalog;
    })();

    return hwPresetCatalog.loading;
}

function hwFindPresetById(id) {
    if (!id) return null;
    const user = hwLoadUserPresetsMap()[id];
    if (user) return user;
    const builtin = hwPresetCatalog.builtins.find(p => p.id === id);
    if (builtin) return builtin;
    return hwCollectAssemblyPresetsMap().get(id) || null;
}

function hwGetPresetsForType(type) {
    const byId = new Map();
    const add = (preset) => {
        if (!preset || preset.type !== type || !preset.id) return;
        if (!byId.has(preset.id)) byId.set(preset.id, preset);
    };
    hwPresetCatalog.builtins.forEach(add);
    Object.values(hwLoadUserPresetsMap()).forEach(add);
    hwCollectAssemblyPresetsMap().forEach(add);
    return Array.from(byId.values()).sort((a, b) => {
        const order = { builtin: 0, user: 1, assembly: 2 };
        const sa = order[a.source] != null ? order[a.source] : 1;
        const sb = order[b.source] != null ? order[b.source] : 1;
        if (sa !== sb) return sa - sb;
        return (a.name || '').localeCompare(b.name || '');
    });
}

function hwApplyPresetToPart(part, preset) {
    if (!part || !preset) return;
    part.presetId = preset.id;
    part.bomKey = preset.id;
    if (preset.label != null) part.label = preset.label;
    if (preset.cost != null) part.cost = preset.cost;
    if (preset.link != null) part.link = preset.link;
    if (preset.params) part.params = JSON.parse(JSON.stringify(preset.params));
    const extras = preset.extras || {};
    if (extras.flipAxis != null) part.flipAxis = !!extras.flipAxis;
    if (extras.holeAlign != null && part.params) part.params.holeAlign = extras.holeAlign;
    if (extras.headAtInsert != null && part.params) part.params.headAtInsert = extras.headAtInsert;
    if (part.type === 'beam' && extras.syncStructure != null && part.params) part.params.syncStructure = extras.syncStructure;
    if (part.type === 'beam' && part.params && part.params.syncStructure !== 'hBeam' && part.params.syncStructure !== false) {
        part.params.syncStructure = false;
    }
}

function hwMaybeAutoApplyPreset(part) {
    if (!part || part.presetId || part.presetManual) return;
    const presets = hwGetPresetsForType(part.type);
    if (presets.length !== 1) return;
    const preset = presets[0];
    // Do not force a rivet-nut preset onto a newly added standard hex nut.
    if (part.type === 'nut' && part.params && part.params.style === 'hex' && preset.params && preset.params.style === 'rivet') return;
    hwApplyPresetToPart(part, preset);
}

function hwLinkPartsToKnownPresets() {
    ensureHardwareAssemblies();
    const signatureToPreset = new Map();
    ['bolt', 'bushing', 'washer', 'lockWasher', 'nut', 'beam', 'bracket'].forEach(type => {
        hwGetPresetsForType(type).forEach(preset => {
            const fakePart = {
                type: preset.type,
                label: preset.label,
                cost: preset.cost,
                params: Object.assign({}, preset.params || {}),
                flipAxis: preset.extras && preset.extras.flipAxis
            };
            if (preset.extras && preset.extras.holeAlign) fakePart.params.holeAlign = preset.extras.holeAlign;
            if (preset.extras && preset.extras.headAtInsert != null) fakePart.params.headAtInsert = preset.extras.headAtInsert;
            signatureToPreset.set(hwPresetSignature(fakePart), preset);
        });
    });
    Object.values(state.hardwareAssemblies.assemblies).forEach(asm => {
        (asm.parts || []).forEach(part => {
            if (!part || part.presetId) return;
            const match = signatureToPreset.get(hwPresetSignature(part));
            if (match) {
                part.presetId = match.id;
                part.bomKey = match.id;
            }
        });
    });
}

function hwDownloadJsonFile(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function hwSavePartAsPreset(partId) {
    const assembly = getActiveHardwareAssembly();
    const part = assembly && assembly.parts.find(p => p.id === partId);
    if (!part) return;

    const defaultName = part.label || HW_TYPE_LABELS[part.type] || part.type;
    const name = prompt('Preset name (for library and BOM):', defaultName);
    if (!name) return;
    const link = prompt('Product link (optional, leave blank to skip):', part.link || '') || '';

    let id = hwSlugifyPresetId(name);
    const userMap = hwLoadUserPresetsMap();
    if (userMap[id]) id = id + '-' + Date.now().toString(36).slice(-4);

    const preset = {
        id,
        name,
        type: part.type,
        label: part.label || name,
        cost: part.cost || 0,
        link,
        params: JSON.parse(JSON.stringify(part.params || {})),
        extras: hwExtractPartExtras(part),
        source: 'user'
    };

    hwSaveUserPreset(preset);
    hwApplyPresetToPart(part, preset);
    hwDownloadJsonFile(id + '.json', preset);

    const registryEntry = { id, name, type: part.type, file: id + '.json', link };
    console.log('[HW] Add this entry to hardware/registry.json:', JSON.stringify(registryEntry, null, 2));
    if (typeof showToast === 'function') {
        showToast('Preset saved locally and downloaded. Add registry entry from console to ship via GitHub.', 'info');
    }
    hwRefreshAll();
}

function hwAppendPresetRow(card, part) {
    const presets = hwGetPresetsForType(part.type);
    const row = document.createElement('div');
    row.className = 'hw-preset-row';

    const label = document.createElement('span');
    label.className = 'hw-preset-label';
    label.textContent = 'Preset';
    row.appendChild(label);

    const sel = document.createElement('select');
    sel.className = 'hw-preset-select';
    const customOpt = document.createElement('option');
    customOpt.value = '';
    customOpt.textContent = presets.length ? 'Custom / manual…' : 'No presets yet';
    sel.appendChild(customOpt);

    const addGroup = (groupLabel, items) => {
        if (!items.length) return;
        const group = document.createElement('optgroup');
        group.label = groupLabel;
        items.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name || p.label || p.id;
            if (part.presetId === p.id) opt.selected = true;
            group.appendChild(opt);
        });
        sel.appendChild(group);
    };

    addGroup('Built-in Library', presets.filter(p => p.source === 'builtin'));
    addGroup('From Assemblies', presets.filter(p => p.source === 'assembly'));
    addGroup('My Presets', presets.filter(p => !p.source || p.source === 'user'));

    if (part.presetId && !presets.some(p => p.id === part.presetId)) {
        const missing = document.createElement('option');
        missing.value = part.presetId;
        missing.textContent = part.presetId + ' (missing)';
        missing.selected = true;
        sel.appendChild(missing);
    } else if (!part.presetId && presets.length === 1) {
        sel.value = presets[0].id;
    }

    sel.onchange = () => {
        if (!sel.value) {
            part.presetId = null;
            part.presetManual = true;
            part.bomKey = hwEnsurePartBomKey(part);
            return;
        }
        part.presetManual = false;
        const preset = hwFindPresetById(sel.value);
        if (preset) {
            hwApplyPresetToPart(part, preset);
            buildHardwareAssemblyScene();
            renderHardwareEditPanel();
        }
    };
    row.appendChild(sel);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'hw-mini-btn hw-preset-save';
    saveBtn.textContent = 'Save';
    saveBtn.title = 'Save as reusable preset (local + download for GitHub)';
    saveBtn.onclick = (e) => { e.stopPropagation(); hwSavePartAsPreset(part.id); };
    row.appendChild(saveBtn);

    if (part.link) {
        const link = document.createElement('a');
        link.className = 'hw-preset-link';
        link.href = part.link;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Link';
        link.onclick = (e) => e.stopPropagation();
        row.appendChild(link);
    }

    card.appendChild(row);
}

const hwPersistConfigDebounced = debounce(() => {
    try {
        localStorage.setItem('linkageLab_config', JSON.stringify(getConfigSnapshot()));
    } catch (e) {
        console.warn('[HW] Failed to persist hardware config:', e);
    }
}, 1500);

function hwPersistHardwareConfig() {
    hwPersistConfigDebounced();
}

function hwRefreshAll() {
    buildHardwareAssemblyScene();
    renderHardwareEditPanel();
    if (typeof updateHUD === 'function') { try { updateHUD(); } catch (e) {} }
    saveStateToHistory();
}

function renderHardwareEditPanel() {
    const panel = document.getElementById('hw-detail-parts');
    if (!panel) return;
    const assembly = getActiveHardwareAssembly();
    panel.innerHTML = '';
    if (!assembly) return;

    // Group by axis for display
    const byAxis = {};
    assembly.parts.forEach((part, idx) => {
        const ax = part.axis || 'right';
        (byAxis[ax] = byAxis[ax] || []).push({ part, idx });
    });

    const mirror = assembly.mirror;
    const axisOrder = ['center', 'right', 'left', 'up', 'down', 'front', 'back'];
    const axisLabels = { center: 'Bracket / Center', right: 'Right Axis', left: 'Left Axis', up: 'Up Axis', down: 'Down (Center) Axis', front: 'Front Axis', back: 'Back Axis' };
    if (mirror && mirror.from === 'right' && mirror.to === 'left') axisLabels.right = 'Right Axis (mirrored to Left)';

    axisOrder.forEach(axisKey => {
        if (!byAxis[axisKey]) return;
        const section = document.createElement('div');
        section.className = 'hw-axis-section';
        const title = document.createElement('div');
        title.className = 'hw-axis-title';
        title.textContent = axisLabels[axisKey] || axisKey;
        section.appendChild(title);

        byAxis[axisKey].sort((a, b) => (a.part.seq || 0) - (b.part.seq || 0)).forEach(({ part }) => {
            section.appendChild(buildHardwarePartCard(part));
        });
        panel.appendChild(section);
    });
}

function hwBindNumberInput(inp, onChange) {
    inp.oninput = () => onChange(parseFloat(inp.value) || 0);
    hwBindNumberScrub(inp, onChange);
}

function buildHardwarePartCard(part) {
    const card = document.createElement('div');
    card.className = 'hw-part-card' + (part.id === hwDetail.selectedPartId ? ' selected' : '');
    card.onclick = (e) => {
        if (e.target.closest('input, select, button, label, .hw-part-grip, a')) return;
        hwDetail.selectedPartId = (hwDetail.selectedPartId === part.id) ? null : part.id;
        hwRefreshAll();
    };

    // Drag-and-drop reordering via grip handle (brackets are fixed at center).
    const isBracket = part.type === 'bracket';
    if (!isBracket) {
        card.addEventListener('dragover', (e) => {
            if (!hwDrag.id || hwDrag.id === part.id) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            const rect = card.getBoundingClientRect();
            const after = (e.clientY - rect.top) > rect.height / 2;
            card.classList.toggle('hw-drop-after', after);
            card.classList.toggle('hw-drop-before', !after);
        });
        card.addEventListener('dragleave', () => card.classList.remove('hw-drop-before', 'hw-drop-after'));
        card.addEventListener('drop', (e) => {
            e.preventDefault();
            const rect = card.getBoundingClientRect();
            const after = (e.clientY - rect.top) > rect.height / 2;
            const draggedId = hwDrag.id;
            card.classList.remove('hw-drop-before', 'hw-drop-after');
            hwHandleDrop(draggedId, part.id, after);
        });
    }

    const head = document.createElement('div');
    head.className = 'hw-part-head';
    if (!isBracket) {
        const grip = document.createElement('span');
        grip.className = 'hw-part-grip';
        grip.textContent = '⠿';
        grip.title = 'Drag to reorder';
        grip.draggable = true;
        grip.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            hwDrag.id = part.id;
            if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', part.id); } catch (err) {} }
            card.classList.add('hw-dragging');
        });
        grip.addEventListener('dragend', () => {
            hwDrag.id = null;
            document.querySelectorAll('.hw-drop-before, .hw-drop-after').forEach(el => el.classList.remove('hw-drop-before', 'hw-drop-after'));
            card.classList.remove('hw-dragging');
        });
        head.appendChild(grip);
    }
    const typeSpan = document.createElement('span');
    typeSpan.className = 'hw-part-type';
    typeSpan.textContent = (part.type === 'nut' && part.params && part.params.style === 'rivet')
        ? 'Rivet Nut'
        : (HW_TYPE_LABELS[part.type] || part.type);
    head.appendChild(typeSpan);
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'hw-part-label';
    labelInput.value = part.label || '';
    labelInput.oninput = () => { part.label = labelInput.value; };
    head.appendChild(labelInput);
    if (!isBracket) {
        const dup = document.createElement('button');
        dup.className = 'hw-mini-btn hw-dup';
        dup.textContent = '⧉';
        dup.title = 'Duplicate part (same BOM item, independent placement)';
        dup.onclick = (e) => { e.stopPropagation(); hwDuplicatePart(part.id); };
        head.appendChild(dup);
    }
    const del = document.createElement('button');
    del.className = 'hw-mini-btn hw-del';
    del.textContent = '✕';
    del.title = 'Remove part';
    del.onclick = () => { hwRemovePart(part.id); };
    head.appendChild(del);
    card.appendChild(head);

    hwAppendPresetRow(card, part);

    // Param grid
    const grid = document.createElement('div');
    grid.className = 'hw-param-grid';
    let paramFields = HW_PARAM_FIELDS[part.type] || [];
    if (part.type === 'nut' && part.params.style !== 'rivet') {
        paramFields = [
            { key: 'id', label: 'ID (in)' },
            { key: 'widthAcrossFlats', label: 'Width A/F (in)' },
            { key: 'height', label: 'Height (in)' }
        ];
    }
    paramFields.forEach(f => {
        const cell = document.createElement('label');
        cell.className = 'hw-param';
        cell.innerHTML = `<span>${f.label}</span>`;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = String(f.step != null ? f.step : 0.01);
        const rawVal = part.params[f.key] != null ? part.params[f.key] : 0;
        const decimals = f.decimals != null ? f.decimals : null;
        if (decimals != null) inp.dataset.decimals = String(decimals);
        inp.value = decimals != null ? Number(rawVal).toFixed(decimals) : rawVal;
        hwBindNumberInput(inp, (val) => {
            part.params[f.key] = val;
            if (part.type === 'beam') part.params.syncStructure = false;
            if (decimals != null) inp.value = Number(val).toFixed(decimals);
            buildHardwareAssemblyScene();
        });
        cell.appendChild(inp);
        grid.appendChild(cell);
    });
    card.appendChild(grid);

    if (part.type === 'beam') {
        const isHBeam = part.params.syncStructure === 'hBeam' || /hbeam/i.test(part.id);
        const alignRow = document.createElement('label');
        alignRow.className = 'hw-param';
        alignRow.style.gridColumn = '1 / -1';
        alignRow.innerHTML = '<span>Bolt axis hole</span>';
        const alignSel = document.createElement('select');
        alignSel.innerHTML = [
            ['near', 'Near end (End Offset)'],
            ['center', 'Center'],
            ['far', 'Far end']
        ].map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
        alignSel.value = part.params.holeAlign || 'near';
        alignSel.onchange = () => {
            part.params.holeAlign = alignSel.value;
            buildHardwareAssemblyScene();
        };
        alignRow.appendChild(alignSel);
        card.appendChild(alignRow);

        const syncRow = document.createElement('label');
        syncRow.className = 'hw-param hw-check-row';
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = isHBeam ? part.params.syncStructure === 'hBeam' : part.params.syncStructure !== false;
        chk.onchange = () => {
            part.params.syncStructure = isHBeam ? (chk.checked ? 'hBeam' : false) : chk.checked;
            hwRefreshAll();
        };
        syncRow.appendChild(chk);
        const lbl = document.createElement('span');
        lbl.className = 'hw-check-label';
        lbl.textContent = isHBeam
            ? 'Sync dims from structure (H-beam W×T, pivot hole)'
            : 'Sync dims from structure (V-beam W×T, length, End Offset holes)';
        syncRow.appendChild(lbl);
        card.appendChild(syncRow);
    }

    if (part.type === 'bolt') {
        const headRow = document.createElement('label');
        headRow.className = 'hw-param hw-check-row';
        const headChk = document.createElement('input');
        headChk.type = 'checkbox';
        headChk.checked = !!part.params.headAtInsert;
        headChk.onchange = () => { part.params.headAtInsert = headChk.checked; buildHardwareAssemblyScene(); };
        headRow.appendChild(headChk);
        const headLbl = document.createElement('span');
        headLbl.className = 'hw-check-label';
        headLbl.textContent = 'Head at insert end (toward bracket)';
        headRow.appendChild(headLbl);
        card.appendChild(headRow);
    }

    // Position along insert axis (non-bracket parts)
    if (!isBracket) {
        const posGrid = document.createElement('div');
        posGrid.className = 'hw-param-grid';
        [
            { key: 'posAssembled', label: 'Asm Pos (in)' },
            { key: 'posExploded', label: 'Exp Pos (in)' },
            { key: 'crossOffset', label: 'Cross Off (in)' }
        ].forEach(f => {
            const cell = document.createElement('label');
            cell.className = 'hw-param';
            cell.innerHTML = `<span>${f.label}</span>`;
            const inp = document.createElement('input');
            inp.type = 'number';
            inp.step = '0.01';
            inp.value = (part[f.key] != null ? part[f.key] : 0);
            inp.title = f.key === 'crossOffset' ? 'Offset perpendicular to insert axis (added to auto hole alignment on horizontal axes)' : '';
            hwBindNumberInput(inp, (val) => { part[f.key] = val; buildHardwareAssemblyScene(); });
            cell.appendChild(inp);
            posGrid.appendChild(cell);
        });
        const flipRow = document.createElement('label');
        flipRow.className = 'hw-param hw-check-row';
        const flipChk = document.createElement('input');
        flipChk.type = 'checkbox';
        flipChk.checked = !!part.flipAxis;
        flipChk.onchange = () => { part.flipAxis = flipChk.checked; buildHardwareAssemblyScene(); };
        flipRow.appendChild(flipChk);
        const flipLbl = document.createElement('span');
        flipLbl.className = 'hw-check-label';
        flipLbl.textContent = 'Invert along stack axis (flip head/tail)';
        flipRow.appendChild(flipLbl);
        posGrid.appendChild(flipRow);
        card.appendChild(posGrid);
    }

    // Meta row: qty, perModule, cost
    const meta = document.createElement('div');
    meta.className = 'hw-param-grid';
    const mk = (labelTxt, key, step) => {
        const cell = document.createElement('label');
        cell.className = 'hw-param';
        cell.innerHTML = `<span>${labelTxt}</span>`;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = step;
        inp.value = (part[key] != null ? part[key] : 0);
        hwBindNumberInput(inp, (val) => {
            part[key] = val;
            if (key === 'qty') buildHardwareAssemblyScene();
            else if (typeof updateHUD === 'function') { try { updateHUD(); } catch (e) {} }
        });
        cell.appendChild(inp);
        return cell;
    };
    meta.appendChild(mk('Qty (stack)', 'qty', '1'));
    meta.appendChild(mk('Per Module', 'perModule', '1'));
    meta.appendChild(mk('Cost $', 'cost', '0.01'));
    card.appendChild(meta);

    if (hwIsQtyStackPart(part)) {
        const qtyGapRow = document.createElement('div');
        qtyGapRow.className = 'hw-param-grid';
        const cell = document.createElement('label');
        cell.className = 'hw-param';
        cell.style.gridColumn = '1 / -1';
        cell.innerHTML = '<span>Qty explode gap (in)</span>';
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = '0.01';
        inp.min = '0';
        inp.placeholder = hwGetQtyExplodeGap(part).toFixed(3);
        inp.value = (part.qtyExplodeGap != null ? part.qtyExplodeGap : '');
        inp.title = 'Exploded spacing between copies only (assembled stack stays flush). Leave blank for washer thickness.';
        const applyQtyGap = (raw) => {
            part.qtyExplodeGap = (raw == null || raw === '' || isNaN(raw)) ? null : Math.max(0, raw);
            buildHardwareAssemblyScene();
        };
        inp.oninput = () => applyQtyGap(parseFloat(inp.value));
        hwBindNumberScrub(inp, (val) => applyQtyGap(val));
        cell.appendChild(inp);
        qtyGapRow.appendChild(cell);
        card.appendChild(qtyGapRow);
    }

    return card;
}

function hwRemovePart(partId) {
    const assembly = getActiveHardwareAssembly();
    if (!assembly) return;
    assembly.parts = assembly.parts.filter(p => p.id !== partId);
    if (hwDetail.selectedPartId === partId) hwDetail.selectedPartId = null;
    hwRefreshAll();
}

function hwDuplicatePart(partId) {
    const assembly = getActiveHardwareAssembly();
    if (!assembly) return;
    const source = assembly.parts.find(p => p.id === partId);
    if (!source || source.type === 'bracket') return;

    const bomKey = hwEnsurePartBomKey(source);
    const id = 'part-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const copy = JSON.parse(JSON.stringify(source));
    copy.id = id;
    copy.bomKey = bomKey;
    copy.seq = (source.seq || 0) + 0.5;

    assembly.parts.push(copy);
    hwRenumberAxis(assembly, copy.axis);
    assembly.detailed = true;
    hwDetail.selectedPartId = id;
    hwRefreshAll();
}

// Drag-and-drop reorder state + helpers
const hwDrag = { id: null };

function hwRenumberAxis(assembly, axis) {
    assembly.parts.filter(p => p.axis === axis)
        .sort((a, b) => (a.seq || 0) - (b.seq || 0))
        .forEach((p, i) => { p.seq = i + 1; });
}

function hwHandleDrop(draggedId, targetId, after) {
    if (!draggedId || draggedId === targetId) return;
    const assembly = getActiveHardwareAssembly();
    if (!assembly) return;
    const dragged = assembly.parts.find(p => p.id === draggedId);
    const target = assembly.parts.find(p => p.id === targetId);
    if (!dragged || !target || dragged.type === 'bracket' || target.type === 'bracket') return;
    const fromAxis = dragged.axis;
    dragged.axis = target.axis;
    dragged.seq = (target.seq || 0) + (after ? 0.5 : -0.5);
    hwRenumberAxis(assembly, dragged.axis);
    if (fromAxis !== dragged.axis) hwRenumberAxis(assembly, fromAxis);
    hwRefreshAll();
}

function hwAddPart() {
    const assembly = getActiveHardwareAssembly();
    if (!assembly) return;
    const selectValue = document.getElementById('hw-add-type').value;
    const resolved = hwResolveAddPartType(selectValue);
    const type = resolved.type;
    // Brackets always live on the center axis (rendered at origin, not exploded).
    const axis = (type === 'bracket') ? 'center' : document.getElementById('hw-add-axis').value;
    const maxSeq = assembly.parts.filter(p => p.axis === axis).reduce((m, p) => Math.max(m, p.seq || 0), 0);
    const id = 'part-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    assembly.parts.push(Object.assign({
        id,
        type,
        label: resolved.label,
        axis,
        seq: maxSeq + 1,
        qty: 1,
        perModule: 1,
        cost: resolved.cost,
        params: JSON.parse(JSON.stringify(resolved.params)),
        presetId: resolved.presetId || null
    }, type !== 'bracket' ? hwDefaultPartPos() : {}));
    const newPart = assembly.parts[assembly.parts.length - 1];
    if (resolved.presetId) {
        const preset = hwFindPresetById(resolved.presetId);
        if (preset) hwApplyPresetToPart(newPart, preset);
        else {
            newPart.presetId = resolved.presetId;
            newPart.bomKey = resolved.presetId;
        }
    } else {
        hwMaybeAutoApplyPreset(newPart);
    }
    assembly.detailed = true;
    hwDetail.selectedPartId = id;
    hwRefreshAll();
}

function hwExplodedAxisPos(part, stackOrigin, rank, gap) {
    const posExp = part.posExploded || 0;
    const step = Math.max(gap * 2.5, 2.2);
    return stackOrigin + posExp + step * rank;
}

function hwIsQtyStackPart(part) {
    return part && (part.type === 'washer' || part.type === 'lockWasher');
}

function hwGetQtyExplodeGap(part) {
    if (part && part.qtyExplodeGap != null && !isNaN(part.qtyExplodeGap)) {
        return Math.max(0, part.qtyExplodeGap);
    }
    const p = (part && part.params) || {};
    if (hwIsQtyStackPart(part)) {
        return Math.max(0.02, p.thickness || 0.0625);
    }
    return 0.04;
}

function hwQtyAssembledSpan(part) {
    return hwGetPartAxialLength(part) * Math.max(1, part.qty || 1);
}

function hwQtyCopyAssembledPos(partAssembledBase, posAsm, len, copyIndex) {
    return partAssembledBase + posAsm + len * copyIndex;
}

function hwPartCopyExplodedPos(part, stackOrigin, partRank, gap, copyIndex) {
    return hwExplodedAxisPos(part, stackOrigin, partRank, gap) + hwGetQtyExplodeGap(part) * copyIndex;
}

function hwExplodeFactor() {
    ensureHardwareAssemblies();
    const v = state.hardwareAssemblies.explode;
    return typeof v === 'number' && !isNaN(v) ? Math.min(1, Math.max(0, v)) : 0;
}

let hwDetailControlsWired = false;

function wireHardwareDetailControls() {
    if (hwDetailControlsWired) return;

    const sel = document.getElementById('hw-assembly-select');
    if (sel) {
        sel.onchange = () => {
            ensureHardwareAssemblies();
            state.hardwareAssemblies.activeId = sel.value;
            hwDetail.selectedPartId = null;
            buildHardwareAssemblyScene();
            renderHardwareEditPanel();
            hwPersistHardwareConfig();
        };
    }

    const sl = document.getElementById('hw-explode-slider');
    if (sl) {
        const onExplodeInput = () => {
            ensureHardwareAssemblies();
            state.hardwareAssemblies.explode = (parseFloat(sl.value) || 0) / 100;
            const v = document.getElementById('hw-explode-value');
            if (v) v.textContent = Math.round(state.hardwareAssemblies.explode * 100) + '%';
            buildHardwareAssemblyScene();
        };
        sl.addEventListener('input', onExplodeInput);
        sl.addEventListener('change', onExplodeInput);
    }

    hwDetailControlsWired = true;
}

function openHardwareDetail() {
    ensureHardwareAssemblies();
    wireHardwareDetailControls();
    const modal = document.getElementById('hardware-detail-modal');
    if (!modal) return;
    modal.classList.add('visible');
    document.body.style.overflow = 'hidden';

    // Sync assembly selector + explode slider
    const sel = document.getElementById('hw-assembly-select');
    if (sel) sel.value = state.hardwareAssemblies.activeId;
    const sl = document.getElementById('hw-explode-slider');
    if (sl) sl.value = Math.round((state.hardwareAssemblies.explode || 0) * 100);
    const slv = document.getElementById('hw-explode-value');
    if (slv) slv.textContent = Math.round((state.hardwareAssemblies.explode || 0) * 100) + '%';

    initHardwareDetailScene();
    hwLoadPresetCatalog().then(() => {
        hwLinkPartsToKnownPresets();
        const assembly = getActiveHardwareAssembly();
        if (assembly) (assembly.parts || []).forEach(p => hwMaybeAutoApplyPreset(p));
        requestAnimationFrame(() => {
            resizeHardwareDetail();
            buildHardwareAssemblyScene();
            renderHardwareEditPanel();
        });
    });
}

function closeHardwareDetail() {
    const modal = document.getElementById('hardware-detail-modal');
    if (modal) modal.classList.remove('visible');
    document.body.style.overflow = '';
    try {
        localStorage.setItem('linkageLab_config', JSON.stringify(getConfigSnapshot()));
    } catch (e) {
        console.warn('[HW] Failed to persist hardware config on close:', e);
    }
}

// ---------------------------------------------------------------------------
// BOM contribution — adds the "extra" hardware types (bushings, lock washers,
// nuts) introduced by detailed assemblies. Bolts/washers continue to use the
// legacy formula lines for now. Parts share presetId/bomKey so identical extras
// roll up across assemblies.
// ---------------------------------------------------------------------------

function getAssemblyHardwareItems(moduleCount) {
    ensureHardwareAssemblies();
    const assemblyBomTypes = { bushing: 1, lockWasher: 1, nut: 1 };
    const agg = {};
    Object.values(state.hardwareAssemblies.assemblies).forEach(asm => {
        if (!asm.detailed) return;
        asm.parts.forEach(part => {
            if (!assemblyBomTypes[part.type]) return;
            const per = part.perModule || 0;
            if (per <= 0) return;
            const preset = part.presetId ? hwFindPresetById(part.presetId) : null;
            const key = part.presetId || part.bomKey || ((part.label || part.type) + '|' + (part.cost || 0));
            const stackQty = Math.max(1, part.qty || 1);
            const label = (preset && (preset.name || preset.label)) || part.label || HW_TYPE_LABELS[part.type];
            const unit = (preset && preset.cost != null) ? preset.cost : (part.cost || 0);
            if (!agg[key]) agg[key] = { label, qty: 0, unit };
            agg[key].qty += per * stackQty * moduleCount;
        });
    });
    return Object.values(agg).map(a => ({ qty: a.qty, item: a.label, unit: a.unit, total: a.qty * a.unit }));
}

const _moduleExports = {
    hwDetail,
    hwDefaultPartPos,
    hwBindNumberScrub,
    hwGetPartAxialLength,
    hwGetPartStackContext,
    hwAxisPosFromPart,
    hwSetPartAxisPosFromWorld,
    hwProjectPointerToAxisPos,
    hwRaycastPartId,
    hwGetBracketHoleY,
    hwGetBracketStackOrigin,
    getRivetNutDefaults,
    getHardwarePartDefaults,
    getDefaultHardwareAssemblies,
    ensureHardwareAssemblies,
    hwMaterial,
    hwAddHead,
    createHWBoltMesh,
    hwAnnulusGeometry,
    createHWBushingMesh,
    createHWWasherMesh,
    createHWLockWasherMesh,
    createHWNutMesh,
    createHWBeamMesh,
    hwGetBeamAlignHoleX,
    hwSyncBeamPartFromState,
    hwSyncHBeamPartFromState,
    hwTagPartMesh,
    loadHwBracketGlb,
    buildGlbBracketMesh,
    buildParametricBracketMesh,
    createHWBracketMesh,
    createHardwarePartMesh,
    hwCreatePartMeshForAxis,
    initHardwareDetailScene,
    resizeHardwareDetail,
    getActiveHardwareAssembly,
    hwUseFullDetailAssemblies,
    hwGetOuterVBeamAssembly,
    hwAddOuterAssemblyPlacement,
    hwComputeAssemblyQuaternion,
    hwComputeOuterAssemblyTransform,
    buildHardwareAssemblyGroup,
    buildHardwareAssemblyScene,
    hwResolveAddPartType,
    hwEnsurePartBomKey,
    hwShortHash,
    hwSlugifyPresetId,
    hwPresetSignature,
    hwExtractPartExtras,
    hwLoadUserPresetsMap,
    hwSaveUserPreset,
    hwPartToPreset,
    hwCollectAssemblyPresetsMap,
    hwLoadPresetCatalog,
    hwFindPresetById,
    hwGetPresetsForType,
    hwApplyPresetToPart,
    hwMaybeAutoApplyPreset,
    hwLinkPartsToKnownPresets,
    hwDownloadJsonFile,
    hwSavePartAsPreset,
    hwAppendPresetRow,
    hwPersistHardwareConfig,
    hwRefreshAll,
    renderHardwareEditPanel,
    hwBindNumberInput,
    buildHardwarePartCard,
    hwRemovePart,
    hwDuplicatePart,
    hwRenumberAxis,
    hwHandleDrop,
    hwAddPart,
    hwExplodedAxisPos,
    hwIsQtyStackPart,
    hwGetQtyExplodeGap,
    hwQtyAssembledSpan,
    hwQtyCopyAssembledPos,
    hwPartCopyExplodedPos,
    hwExplodeFactor,
    wireHardwareDetailControls,
    openHardwareDetail,
    closeHardwareDetail,
    getAssemblyHardwareItems,
};

bridgeGlobals(_moduleExports, 'hardwareDetail');

export { hwDetail, hwDefaultPartPos, hwBindNumberScrub, hwGetPartAxialLength, hwGetPartStackContext, hwAxisPosFromPart, hwSetPartAxisPosFromWorld, hwProjectPointerToAxisPos, hwRaycastPartId, hwGetBracketHoleY, hwGetBracketStackOrigin, getRivetNutDefaults, getHardwarePartDefaults, getDefaultHardwareAssemblies, ensureHardwareAssemblies, hwMaterial, hwAddHead, createHWBoltMesh, hwAnnulusGeometry, createHWBushingMesh, createHWWasherMesh, createHWLockWasherMesh, createHWNutMesh, createHWBeamMesh, hwGetBeamAlignHoleX, hwSyncBeamPartFromState, hwSyncHBeamPartFromState, hwTagPartMesh, loadHwBracketGlb, buildGlbBracketMesh, buildParametricBracketMesh, createHWBracketMesh, createHardwarePartMesh, hwCreatePartMeshForAxis, initHardwareDetailScene, resizeHardwareDetail, getActiveHardwareAssembly, hwUseFullDetailAssemblies, hwGetOuterVBeamAssembly, hwAddOuterAssemblyPlacement, hwComputeAssemblyQuaternion, hwComputeOuterAssemblyTransform, buildHardwareAssemblyGroup, buildHardwareAssemblyScene, hwResolveAddPartType, hwEnsurePartBomKey, hwShortHash, hwSlugifyPresetId, hwPresetSignature, hwExtractPartExtras, hwLoadUserPresetsMap, hwSaveUserPreset, hwPartToPreset, hwCollectAssemblyPresetsMap, hwLoadPresetCatalog, hwFindPresetById, hwGetPresetsForType, hwApplyPresetToPart, hwMaybeAutoApplyPreset, hwLinkPartsToKnownPresets, hwDownloadJsonFile, hwSavePartAsPreset, hwAppendPresetRow, hwPersistHardwareConfig, hwRefreshAll, renderHardwareEditPanel, hwBindNumberInput, buildHardwarePartCard, hwRemovePart, hwDuplicatePart, hwRenumberAxis, hwHandleDrop, hwAddPart, hwExplodedAxisPos, hwIsQtyStackPart, hwGetQtyExplodeGap, hwQtyAssembledSpan, hwQtyCopyAssembledPos, hwPartCopyExplodedPos, hwExplodeFactor, wireHardwareDetailControls, openHardwareDetail, closeHardwareDetail, getAssemblyHardwareItems };
