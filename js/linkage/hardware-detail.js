// ============================================================================ (ES module)

import { bridgeGlobals } from './global-bridge.js';
import { showToast } from '../core/feedback.js';
import { getConfigSnapshot } from './config-persistence.js';
import { patchProjectDocumentLinkageSlice, extractLinkageSliceFromConfig } from '../core/project-store.js';
import { radToDeg, degToRad } from './math.js';
import { MAX_FOLD_ANGLE } from './constants.js';
import { getEffectiveMinFoldAngle } from './solver.js';

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

const HW_SANDWICH_SIDE_AXES = ['up', 'down', 'left', 'right'];
const HW_SANDWICH_PAIRS = [
    { positive: 'up', negative: 'down' },
    { positive: 'right', negative: 'left' },
];

const HW_MM_TO_IN = 1 / 25.4;

/** Pull-to-flush distance (inches) when sliding a part near another face or bracket wall. */
const HW_SNAP_THRESHOLD = 0.18;

const HW_PART_TYPES = ['bolt', 'bushing', 'washer', 'lockWasher', 'nut', 'bracket', 'beam'];

// Default position fields added to every stack part.
function hwDefaultPartPos() {
    return { posAssembled: 0, posExploded: 0, crossOffset: 0, flipAxis: false };
}

/** Integer stack count for washers and other qty-stacked parts. */
function hwPartQty(part) {
    return Math.max(1, Math.round(Number(part?.qty) || 1));
}

const HW_HBEAM_GAP_WASHER_SHARED_KEY = 'hBeamGapWasher';
const HW_HBEAM_SANDWICH_ASSEMBLY_IDS = ['outerVBeam', 'innerVBeam', 'hCenter'];

function hwDefaultHBeamGapWasherPart(asmId) {
    return {
        id: `${asmId}-hbeam-gap-washer`,
        type: 'washer',
        label: 'H-Beam Gap Washer 1/2"ID 2"OD',
        axis: 'center',
        seq: 0,
        qty: 1,
        perModule: 0,
        cost: 0.10,
        sharedKey: HW_HBEAM_GAP_WASHER_SHARED_KEY,
        posAssembled: 0,
        posExploded: 0,
        crossOffset: 0,
        flipAxis: false,
        params: { id: 0.5, od: 2.0, thickness: 0.0625 },
    };
}

function hwDefaultHBeamPairParts() {
    const params = {
        width: 3.5, thickness: 1.5, length: 18, holeOffset: 9, holeDiameter: 0.5,
        rotDeg: 0, syncStructure: 'hBeam', color: 0x8B6914,
    };
    const pos = hwDefaultPartPos();
    return [
        { id: 'u-hbeam', type: 'beam', label: 'Horizontal H-Beam', axis: 'up', seq: 0, qty: 1, perModule: 0, cost: 0, ...pos, params: { ...params } },
        { id: 'd-hbeam', type: 'beam', label: 'Horizontal H-Beam', axis: 'down', seq: 0, qty: 1, perModule: 0, cost: 0, ...pos, params: { ...params } },
    ];
}

function hwSyncSharedPartFrom(sourcePart) {
    if (!sourcePart?.sharedKey) return;
    Object.values(state.hardwareAssemblies.assemblies).forEach((asm) => {
        (asm.parts || []).forEach((p) => {
            if (p.sharedKey !== sourcePart.sharedKey || p.id === sourcePart.id) return;
            p.label = sourcePart.label;
            p.cost = sourcePart.cost;
            p.qty = sourcePart.qty;
            p.params = JSON.parse(JSON.stringify(sourcePart.params || {}));
        });
    });
}

function hwReconcileSharedParts() {
    let canonical = null;
    let bestQty = 0;
    Object.values(state.hardwareAssemblies?.assemblies || {}).forEach((asm) => {
        (asm.parts || []).forEach((p) => {
            if (p.sharedKey !== HW_HBEAM_GAP_WASHER_SHARED_KEY) return;
            const qty = hwPartQty(p);
            if (!canonical || qty > bestQty || (qty === bestQty && asm.id === 'outerVBeam')) {
                canonical = p;
                bestQty = qty;
            }
        });
    });
    if (canonical) hwSyncSharedPartFrom(canonical);
}

// Every non-bracket part is anchored on its axial midpoint so it occupies
// [start, start+len] along the stack and rotating (flipAxis) never shifts it.
// Beam meshes are already centered by createHWBeamMesh; others get centered in
// createHardwarePartMesh via hwCenterMeshAxially.
function hwUsesAxialCenterPlacement(part) {
    return !!(part && part.type !== 'bracket');
}

function hwPartAxisPlacementPos(axisStart, part) {
    const len = hwGetPartAxialLength(part);
    return hwUsesAxialCenterPlacement(part) ? axisStart + len / 2 : axisStart;
}

function hwCenterMeshAxially(group) {
    const len = group.userData.axialLength;
    if (!len || group.userData.axialCentered) return;
    group.children.forEach(ch => { ch.position.y -= len / 2; });
    group.userData.axialCentered = true;
}

/**
 * Sandwich axes (center + side pairs) belong to an assembly whose stack is built
 * around a center slot: the 'center' axis is centered at 0, and side axes
 * (up/down or left/right) grow outward starting at the center slot's outer face.
 * The right/left axes of the V-beam horizontal stacks stay bracket-anchored chains.
 */
function hwUsesSandwichAxis(assembly, axisKey) {
    if (axisKey === 'center') return true;
    if (!HW_SANDWICH_SIDE_AXES.includes(axisKey)) return false;
    if (assembly?.id === 'outerVBeam' && (axisKey === 'right' || axisKey === 'left')) return false;
    if (assembly?.id === 'innerVBeam' && (axisKey === 'right' || axisKey === 'left')) return false;
    return true;
}

function hwIsCenterAxis(axisKey) {
    return axisKey === 'center';
}

function hwGetAssemblyMirrorPairs(assembly) {
    if (!assembly) return [];
    if (Array.isArray(assembly.mirrorPairs)) {
        return assembly.mirrorPairs.filter(p => p && p.from && p.to);
    }
    if (assembly.mirror && assembly.mirror.from && assembly.mirror.to) {
        return [assembly.mirror];
    }
    return [];
}

function hwMirrorPairEquals(a, b) {
    return !!(a && b && a.from === b.from && a.to === b.to);
}

function hwIsMirrorClonePart(part) {
    return !!(part && part.mirrorOf);
}

function hwRemoveMirroredPartsOnAxis(asm, axisKey) {
    if (!asm?.parts) return;
    asm.parts = asm.parts.filter(p => !(p.axis === axisKey && hwIsMirrorClonePart(p)));
    hwRenumberAxis(asm, axisKey);
}

function hwCreateMirroredPart(source, toAxis) {
    const copy = JSON.parse(JSON.stringify(source));
    copy.id = `mirror-${source.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    copy.axis = toAxis;
    copy.mirrorOf = source.id;
    delete copy.sharedKey;
    return copy;
}

function hwAssemblyUsesVirtualMirror(asm, pair) {
    if (!asm?.parts || !pair?.to) return false;
    return !asm.parts.some(p =>
        p.type !== 'bracket'
        && (p.axis || 'right') === pair.to
        && !hwIsMirrorClonePart(p)
    );
}

/** Copy current source-stack parts onto the mirror target axis as editable clones. */
function hwEnsureMirrorClonesForPair(asm, pair) {
    if (!asm?.parts || !pair?.from || !pair?.to) return;
    asm.parts.filter(p => p.mirrorOf && p.axis === pair.to).forEach(clone => {
        if (!asm.parts.some(s => s.id === clone.mirrorOf && s.axis === pair.from)) {
            asm.parts = asm.parts.filter(p => p.id !== clone.id);
        }
    });
    asm.parts
        .filter(p => p.axis === pair.from && !hwIsMirrorClonePart(p) && p.type !== 'bracket')
        .forEach(src => {
            if (hwIsSandwichBeamPart(src)) return;
            if (asm.parts.some(p => p.mirrorOf === src.id && p.axis === pair.to)) return;
            asm.parts.push(hwCreateMirroredPart(src, pair.to));
        });
    hwSyncMirrorClonesFromSources(asm, pair);
    hwRenumberAxis(asm, pair.to);
}

function hwSyncMirrorClonesFromSources(asm, pair) {
    if (!asm?.parts || !pair) return;
    asm.parts.filter(p => p.mirrorOf && p.axis === pair.to).forEach(clone => {
        const src = asm.parts.find(s => s.id === clone.mirrorOf && s.axis === pair.from);
        if (!src) return;
        clone.label = src.label;
        clone.type = src.type;
        clone.qty = src.qty;
        clone.perModule = src.perModule;
        clone.cost = src.cost;
        clone.params = JSON.parse(JSON.stringify(src.params || {}));
        clone.posAssembled = src.posAssembled;
        clone.posExploded = src.posExploded;
        clone.crossOffset = src.crossOffset;
        clone.flipAxis = src.flipAxis;
        clone.presetId = src.presetId || null;
        clone.bomKey = src.bomKey || null;
    });
}

function hwApplyMirrorPairChanges(asm, prevPairs, nextPairs) {
    if (!asm) return;
    prevPairs.forEach(pair => {
        if (!nextPairs.some(p => hwMirrorPairEquals(p, pair))) {
            hwRemoveMirroredPartsOnAxis(asm, pair.to);
        }
    });
    nextPairs.forEach(pair => {
        if (!prevPairs.some(p => hwMirrorPairEquals(p, pair))) {
            if (!hwAssemblyUsesVirtualMirror(asm, pair)) {
                hwEnsureMirrorClonesForPair(asm, pair);
            }
        } else if (!hwAssemblyUsesVirtualMirror(asm, pair)) {
            hwSyncMirrorClonesFromSources(asm, pair);
        }
    });
}

function hwSyncMirrorClonesFromPart(sourcePart) {
    if (!sourcePart || hwIsMirrorClonePart(sourcePart)) return;
    const asm = getActiveHardwareAssembly();
    if (!asm) return;
    hwGetAssemblyMirrorPairs(asm).forEach(pair => {
        if (sourcePart.axis !== pair.from) return;
        if (hwAssemblyUsesVirtualMirror(asm, pair)) return;
        hwSyncMirrorClonesFromSources(asm, pair);
    });
}

function hwReconcileMirrorParts(asm) {
    if (!asm?.parts) return;
    const pairs = hwGetAssemblyMirrorPairs(asm);
    asm.parts = asm.parts.filter(p => {
        if (!hwIsMirrorClonePart(p)) return true;
        return pairs.some(pair => pair.to === p.axis);
    });
    pairs.forEach(pair => {
        asm.parts = asm.parts.filter(p => !(p.axis === pair.to && p.id.startsWith('l-')));
    });
    if (pairs.length) asm.mirror = { ...pairs[0] };
    else delete asm.mirror;
}

function hwGetSandwichOppositeAxis(axisKey) {
    for (const pair of HW_SANDWICH_PAIRS) {
        if (axisKey === pair.positive) return pair.negative;
        if (axisKey === pair.negative) return pair.positive;
    }
    return null;
}

function hwIsSandwichBeamPart(part) {
    if (!part || part.type !== 'beam' || !part.params) return false;
    const sync = part.params.syncStructure;
    return sync === true || sync === 'hBeam';
}

/** Total thickness of the center-slot hardware (defines the inter-beam gap). */
function hwGetSandwichCenterSpan(assembly) {
    if (!assembly?.parts?.length) return 0;
    let span = 0;
    assembly.parts
        .filter(p => (p.axis || '') === 'center' && p.type !== 'bracket' && p.type !== 'beam')
        .forEach(p => { span += hwGetPartAxialLength(p) * hwPartQty(p); });
    return span;
}

function hwGetSandwichCenterHalfSpan(assembly) {
    return hwGetSandwichCenterSpan(assembly) / 2;
}

/** Back-compat alias kept for exports/consumers. */
function hwSumCenterAxisGap(assembly) {
    return hwGetSandwichCenterSpan(assembly);
}

/**
 * Local offset (inches, along the sandwich render axis) from the assembly group
 * origin to the sandwich pivot point (the bolt axis the H-beams share).
 *
 * For outerVBeam / innerVBeam the assembly group is placed so the bracket's
 * side hole is at the world bolt-pivot. The hole is `bracketHoleY` above the
 * bracket center, which IS the assembly group local origin. So the pivot lives
 * at +bracketHoleY in the group's up-axis.
 *
 * All other assemblies (hCenter, vCenter …) are anchored directly at the pivot,
 * so their offset is 0.
 */
function hwGetSandwichCenterOffset(assembly) {
    // Only vertical-sandwich assemblies that carry a U-bracket need the offset.
    const sandwichAxis = hwGetCenterRenderAxis(assembly);
    if (sandwichAxis === 'up') {
        const bracketPart = assembly.parts.find(p => p.type === 'bracket');
        if (bracketPart) return hwGetBracketHoleY(bracketPart);
    }
    return 0;
}

function hwGetAxisStackOrigin(assembly, axisKey, bracketPart) {
    if (hwIsCenterAxis(axisKey)) {
        // Center slot starts at pivotLocal − halfSpan so the stack is centered
        // on the bolt pivot.
        return hwGetSandwichCenterOffset(assembly) - hwGetSandwichCenterHalfSpan(assembly);
    }
    if (hwUsesSandwichAxis(assembly, axisKey)) {
        const pivotLocal = hwGetSandwichCenterOffset(assembly);
        const halfSpan = hwGetSandwichCenterHalfSpan(assembly);
        // POSITIVE axes (up, right): parts render in +dir, inner face starts at
        // pivotLocal + halfSpan (outer face of the center slot).
        // NEGATIVE axes (down, left): parts render in −dir.  We need the part's
        // first inner face to land at `pivotLocal − halfSpan` in local coords.
        // With dirVec = -1, worldPos_local = −baseStart, so
        //   baseStart = −(pivotLocal − halfSpan) = halfSpan − pivotLocal.
        const pair = HW_SANDWICH_PAIRS.find(p => p.positive === axisKey || p.negative === axisKey);
        if (pair && pair.negative === axisKey) return halfSpan - pivotLocal;
        return pivotLocal + halfSpan;
    }
    return hwGetBracketStackOrigin(bracketPart, axisKey);
}

/**
 * Sequential layout for one axis. Every part occupies [baseStart, baseStart+len].
 * - center axis: parts are flush-stacked symmetrically around the bolt pivot
 *   (their combined thickness equals the sandwich gap).
 * - side sandwich axes: parts grow outward from the outer face of the center
 *   slot.  Positive axes (up/right) start at pivotLocal+halfSpan; negative axes
 *   (down/left) start at halfSpan−pivotLocal so they too grow away from center.
 * - chain axes: parts grow outward from the bracket wall.
 * posAssembled is an additional per-part fine-tune offset on top of baseStart.
 */
function hwComputeAxisLayout(assembly, axisKey) {
    const bracketPart = assembly.parts.find(p => p.type === 'bracket');
    const parts = assembly.parts
        .filter(p => p.type !== 'bracket' && (p.axis || 'right') === axisKey)
        .sort((a, b) => (a.seq || 0) - (b.seq || 0));

    if (hwIsCenterAxis(axisKey)) {
        const span = hwGetSandwichCenterSpan(assembly);
        const pivotLocal = hwGetSandwichCenterOffset(assembly);
        const startPos = pivotLocal - span / 2;
        const items = [];
        let pos = startPos;
        let rank = 0;
        parts.forEach(p => {
            const len = hwGetPartAxialLength(p);
            const qty = hwPartQty(p);
            const posAsm = p.posAssembled || 0;
            for (let c = 0; c < qty; c++) {
                items.push({
                    part: p,
                    baseStart: pos + posAsm + len * c,
                    partBase: pos,
                    len,
                    rank,
                    copyIndex: c,
                });
                rank += 1;
            }
            pos += len * qty;
        });
        return { items, origin: startPos, span, center: true };
    }

    const origin = hwGetAxisStackOrigin(assembly, axisKey, bracketPart);
    const items = [];
    let pos = origin;
    let rank = 0;
    parts.forEach(p => {
        const len = hwGetPartAxialLength(p);
        const qty = hwPartQty(p);
        const partBase = pos;
        const posAsm = p.posAssembled || 0;
        for (let c = 0; c < qty; c++) {
            items.push({
                part: p,
                baseStart: partBase + posAsm + len * c,
                partBase,
                len,
                rank,
                copyIndex: c,
            });
            rank += 1;
        }
        pos = partBase + hwQtyAssembledSpan(p) + 0.04;
    });
    return { items, origin, span: Math.abs(pos - origin), center: false };
}

/** When one sandwich beam standoff moves, the opposite beam mirrors it. */
function hwApplySandwichBeamCoupling(assembly, part, newPosAsm) {
    if (!assembly || !part || !hwIsSandwichBeamPart(part)) return;
    const oppAxis = hwGetSandwichOppositeAxis(part.axis);
    if (!oppAxis) return;
    const opp = assembly.parts.find(p => p.axis === oppAxis && hwIsSandwichBeamPart(p));
    if (opp && opp.id !== part.id) opp.posAssembled = newPosAsm;
}

function hwGetSandwichSideBeamOffset(assembly, axisKey) {
    const beam = assembly?.parts?.find(p => p.axis === axisKey && hwIsSandwichBeamPart(p));
    return beam ? Math.max(0, beam.posAssembled || 0) : 0;
}

/** Distance between the two facing beams = center stack thickness + any standoffs. */
function hwGetAssemblySandwichGap(assembly) {
    if (!assembly) return 0;
    let total = hwGetSandwichCenterSpan(assembly);
    const plane = assembly.sandwichPlane || (assembly.id === 'vCenter' ? 'horizontal' : 'vertical');
    const sides = plane === 'horizontal' ? ['right', 'left'] : ['up', 'down'];
    sides.forEach(axisKey => { total += hwGetSandwichSideBeamOffset(assembly, axisKey); });
    return total;
}

/**
 * Lay out every part on one axis. center axis renders along the center render
 * axis (centered at 0); side/chain axes render along their own direction,
 * growing outward from the layout origin. All parts occupy [start, start+len].
 */
function hwLayoutAxisParts(group, renderAxisArg, partsAxisKey, assembly, opts) {
    const { bracketPart, bracketHoleY, explode, gap, flipEnd, applySelection, shouldRenderPart } = opts;
    const renderAxisKey = hwIsCenterAxis(renderAxisArg) ? hwGetCenterRenderAxis(assembly) : renderAxisArg;
    const dir = HW_AXIS_DIRS[renderAxisKey] || HW_AXIS_DIRS.right;
    const dirVec = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
    const cross = HW_AXIS_CROSS[renderAxisKey] || HW_AXIS_CROSS.right;
    const crossVec = new THREE.Vector3(cross.x, cross.y, cross.z).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirVec);
    const layout = hwComputeAxisLayout(assembly, partsAxisKey);

    layout.items.forEach(({ part, baseStart, len, rank, copyIndex = 0 }) => {
        // Excluded parts (e.g. beams represented by the real structure beams) still
        // occupy their slot in the layout so neighbors stack correctly, but no mesh
        // is drawn for them.
        if (shouldRenderPart && !shouldRenderPart(part)) return;
        let crossPos = part.crossOffset || 0;
        if (HW_HORIZONTAL_AXES.indexOf(renderAxisKey) >= 0 && bracketPart) crossPos += bracketHoleY;
        const mesh = hwCreatePartMeshForAxis(part, renderAxisKey, assembly);
        const qty = hwPartQty(part);
        const explodedStart = qty > 1
            ? hwPartCopyExplodedPos(part, layout.origin, rank, gap, copyIndex)
            : hwExplodedAxisPos(part, layout.origin, rank, gap);
        const axisStart = (1 - explode) * baseStart + explode * explodedStart;
        const axisPos = hwPartAxisPlacementPos(axisStart, part);
        const worldPos = new THREE.Vector3();
        worldPos.addScaledVector(dirVec, axisPos);
        worldPos.addScaledVector(crossVec, crossPos);
        mesh.position.copy(worldPos);
        mesh.quaternion.copy(quat);
        if (part.flipAxis) mesh.quaternion.multiply(flipEnd);
        hwTagPartMesh(mesh, part);
        applySelection(mesh, part);
        group.add(mesh);
    });
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
    const axisKey = part.axis || 'right';
    const renderAxis = hwIsCenterAxis(axisKey) ? hwGetCenterRenderAxis(assembly) : axisKey;
    const dir = HW_AXIS_DIRS[renderAxis] || HW_AXIS_DIRS.right;
    const dirVec = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
    const cross = HW_AXIS_CROSS[renderAxis] || HW_AXIS_CROSS.right;
    const crossVec = new THREE.Vector3(cross.x, cross.y, cross.z).normalize();
    const gap = assembly.explodeGap || 1.4;

    const layout = hwComputeAxisLayout(assembly, axisKey);
    const item = layout.items.find(it => it.part.id === part.id && (it.copyIndex || 0) === 0);
    if (!item) return null;

    return {
        stackBase: item.partBase != null ? item.partBase : item.baseStart,
        stackOrigin: layout.origin,
        rank: item.rank,
        copyIndex: item.copyIndex || 0,
        axisKey,
        renderAxis,
        dirVec,
        crossVec,
        gap,
        posExp: part.posExploded || 0,
        explode,
        center: layout.center,
    };
}

function hwGetCenterRenderAxis(assembly) {
    if (assembly?.sandwichPlane === 'horizontal') return 'right';
    if (assembly?.sandwichPlane === 'vertical') return 'up';
    if (assembly?.id === 'vCenter') return 'right';
    return 'up';
}

function hwAxisPosFromPart(part, ctx) {
    if (!ctx) return 0;
    const len = hwGetPartAxialLength(part);
    const copyIndex = ctx.copyIndex || 0;
    const assembledStart = ctx.stackBase + (part.posAssembled || 0) + len * copyIndex;
    const explodedStart = hwExplodedAxisPos(part, ctx.stackOrigin, ctx.rank, ctx.gap);
    const axisStart = (1 - ctx.explode) * assembledStart + ctx.explode * explodedStart;
    return hwPartAxisPlacementPos(axisStart, part);
}

function hwSetPartAxisPosFromWorld(part, ctx, axisPos) {
    if (!ctx) return;
    const len = hwGetPartAxialLength(part);
    const assembly = getActiveHardwareAssembly();
    const oldPos = part.posAssembled || 0;
    const placementOffset = hwUsesAxialCenterPlacement(part) ? len / 2 : 0;
    const explodedStart = hwExplodedAxisPos(part, ctx.stackOrigin, ctx.rank, ctx.gap);
    const explodedPlacement = hwPartAxisPlacementPos(explodedStart, part);
    const denom = Math.max(1 - ctx.explode, 0.001);
    const assembledPlacement = (axisPos - ctx.explode * explodedPlacement) / denom;
    const assembledStart = assembledPlacement - placementOffset;
    let posAsm = assembledStart - ctx.stackBase - len * (ctx.copyIndex || 0);
    if (assembly) posAsm = hwSnapPartAssembledPos(part, assembly, ctx, posAsm);
    part.posAssembled = posAsm;
    if (assembly && hwIsSandwichBeamPart(part)) hwApplySandwichBeamCoupling(assembly, part, posAsm);
    if (assembly && Math.abs(posAsm - oldPos) > 1e-5 && typeof invalidateGeometryCache === 'function') {
        invalidateGeometryCache();
    }
}

function hwIsSnapActive() {
    ensureHardwareAssemblies();
    if (state.hardwareAssemblies.snap === false) return false;
    return hwExplodeFactor() < 0.05;
}

/** Walk every instance on an axis stack and invoke fn({ part, copyIndex, start, end, partBase, len }). */
function hwForEachAxisPartInterval(assembly, axisKey, fn, skip) {
    const layout = hwComputeAxisLayout(assembly, axisKey);
    layout.items.forEach(({ part, baseStart, len, copyIndex = 0, partBase }) => {
        const skipSelf = skip && skip.partId === part.id && skip.copyIndex === copyIndex;
        if (!skipSelf) {
            fn({
                part,
                copyIndex,
                start: baseStart,
                end: baseStart + len,
                partBase: partBase != null ? partBase : baseStart,
                len,
                stackOrigin: layout.origin,
            });
        }
    });
}

/** Axis positions (inches along stack) that part faces may snap flush to. */
function hwCollectAxisSnapPlanes(assembly, axisKey, skipPartId, skipCopyIndex, editingPart) {
    const planes = [];
    const skip = skipPartId != null ? { partId: skipPartId, copyIndex: skipCopyIndex || 0 } : null;
    const layout = hwComputeAxisLayout(assembly, axisKey);
    planes.push(layout.origin);
    // Snap center-slot parts and beams to the bolt-pivot plane.
    const pivotLocal = hwGetSandwichCenterOffset(assembly);
    if (hwIsCenterAxis(axisKey) || (editingPart && hwIsSandwichBeamPart(editingPart))) {
        planes.push(pivotLocal);
    }
    hwForEachAxisPartInterval(assembly, axisKey, ({ start, end }) => {
        planes.push(start, end);
    }, skip);
    return planes;
}

/** Soft snap: if start or end is within threshold of a plane, sit flush on that plane. */
function hwSnapStartToPlanes(start, end, planes, threshold) {
    if (!planes.length || threshold <= 0) return start;
    const len = end - start;
    let bestStart = start;
    let bestDist = threshold;
    planes.forEach(T => {
        const ds = Math.abs(start - T);
        if (ds < bestDist) { bestDist = ds; bestStart = T; }
        const de = Math.abs(end - T);
        if (de < bestDist) { bestDist = de; bestStart = T - len; }
    });
    return bestStart;
}

function hwSnapPartAssembledPos(part, assembly, ctx, posAsm) {
    if (!hwIsSnapActive() || !part || !assembly || !ctx) return posAsm;
    const len = hwGetPartAxialLength(part);
    const copyIndex = ctx.copyIndex || 0;
    const start = ctx.stackBase + posAsm + len * copyIndex;
    const end = start + len;
    const planes = hwCollectAxisSnapPlanes(assembly, ctx.axisKey, part.id, copyIndex, part);
    const snappedStart = hwSnapStartToPlanes(start, end, planes, HW_SNAP_THRESHOLD);
    return +((snappedStart - ctx.stackBase - len * copyIndex).toFixed(4));
}

function hwApplyPartAssembledPos(part, assembly, posAsm) {
    const oldPos = part.posAssembled || 0;
    const ctx = hwGetPartStackContext(part, assembly, hwExplodeFactor());
    if (!ctx) {
        part.posAssembled = posAsm;
        return;
    }
    part.posAssembled = hwSnapPartAssembledPos(part, assembly, ctx, posAsm);
    if (hwIsSandwichBeamPart(part)) hwApplySandwichBeamCoupling(assembly, part, part.posAssembled);
    if (Math.abs(part.posAssembled - oldPos) > 1e-5 && typeof invalidateGeometryCache === 'function') {
        invalidateGeometryCache();
    }
}

function hwEnsureDetailRaycaster() {
    if (!hwDetail.raycaster && typeof THREE !== 'undefined') {
        hwDetail.raycaster = new THREE.Raycaster();
        hwDetail.pointer = new THREE.Vector2();
    }
}

function hwGetDetailCanvas() {
    if (state.hwDetailMode && hwDetail.embedded) return document.getElementById('canvas-webgl');
    if (hwDetail.initialized) return document.getElementById('hw-detail-canvas');
    return document.getElementById('canvas-webgl') || document.getElementById('hw-detail-canvas');
}

function hwGetDetailCamera() {
    if (state.hwDetailMode && hwDetail.embedded && typeof threeRenderer !== 'undefined' && threeRenderer.mainCamera) {
        return threeRenderer.mainCamera;
    }
    return hwDetail.camera;
}

function hwGetFocusAssemblyGroup() {
    if (!hwDetail.focusGroupUuid || typeof THREE === 'undefined') return null;
    if (typeof threeRenderer === 'undefined' || !threeRenderer.hardwareAssemblyGroup) return null;
    let found = null;
    threeRenderer.hardwareAssemblyGroup.traverse(obj => {
        if (obj.uuid === hwDetail.focusGroupUuid) found = obj;
    });
    return found;
}

function hwProjectPointerToAxisPos(event, ctx) {
    hwEnsureDetailRaycaster();
    const canvas = hwGetDetailCanvas();
    const camera = hwGetDetailCamera();
    if (!ctx || !hwDetail.raycaster || !camera || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    hwDetail.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    hwDetail.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    hwDetail.raycaster.setFromCamera(hwDetail.pointer, camera);

    let ray = hwDetail.raycaster.ray;
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    if (state.hwDetailMode && hwDetail.embedded) {
        const focusGroup = hwGetFocusAssemblyGroup();
        if (!focusGroup) return null;
        focusGroup.updateWorldMatrix(true, false);
        const inv = new THREE.Matrix4().copy(focusGroup.matrixWorld).invert();
        ray = hwDetail.raycaster.ray.clone().applyMatrix4(inv);
        camDir.transformDirection(inv).normalize();
    }

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
    if (!ray.intersectPlane(plane, hit)) return null;
    return hit.dot(ctx.dirVec);
}

function hwRaycastPartId(event) {
    hwEnsureDetailRaycaster();
    if (!hwDetail.raycaster) return null;
    const canvas = hwGetDetailCanvas();
    const camera = hwGetDetailCamera();
    if (!canvas || !camera) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    hwDetail.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    hwDetail.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    hwDetail.raycaster.setFromCamera(hwDetail.pointer, camera);

    const pickFrom = (root) => {
        const hits = hwDetail.raycaster.intersectObjects(root.children, true);
        for (let i = 0; i < hits.length; i++) {
            let node = hits[i].object;
            while (node) {
                if (node.userData && node.userData.partId) return node.userData.partId;
                node = node.parent;
            }
        }
        return null;
    };

    if (state.hwDetailMode && hwDetail.embedded) {
        const focusGroup = hwGetFocusAssemblyGroup();
        if (!focusGroup) return null;
        const partId = pickFrom(focusGroup);
        if (!partId) return null;
        const asm = getActiveHardwareAssembly();
        const part = asm && asm.parts.find(p => p.id === partId);
        return (part && part.type !== 'bracket') ? partId : null;
    }

    if (!hwDetail.assemblyGroup) return null;
    return pickFrom(hwDetail.assemblyGroup);
}

function hwGetBracketHoleY(bracketPart) {
    if (!bracketPart || !bracketPart.params) return 0;
    const H = bracketPart.params.height || 3.77;
    const fromTop = bracketPart.params.sideHoleFromTop != null ? bracketPart.params.sideHoleFromTop : 1.1875;
    // Hole position is fixed on the full bracket; cutoffHeight only clips the mesh visually.
    return (H / 2) - fromTop;
}

/** Local position of the side-wall hole on the +X (right stack) face, bracket origin at center. */
function hwGetBracketSideHoleLocal(bracketPart) {
    const bp = bracketPart && bracketPart.params ? bracketPart.params : {};
    const halfW = (bp.width || 2.15) / 2;
    const wallT = bp.wallThickness || 0.12;
    const sideHoleX = halfW - wallT / 2;
    return new THREE.Vector3(sideHoleX, hwGetBracketHoleY(bracketPart), 0);
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
        snap: true,
        assemblies: {
            outerVBeam: {
                id: 'outerVBeam',
                label: 'Outer V-Beam Assembly',
                detailed: true,
                explodeGap: 1.4,
                detailCam: { pitchDeg: 8, distMul: 2.0 },
                sandwichPlane: 'vertical',
                // Right and left horizontal stacks are identical and mirrored:
                // only the 'right' parts are stored; the 'left' side is rendered
                // (and edited) as a live mirror of 'right'.
                mirror: { from: 'right', to: 'left' },
                parts: [
                    // U-bracket sits in the UP stack, above the top H-beam (cylinder mode).
                    { id: 'bracket', type: 'bracket', label: 'U-Bracket (Unistrut Trolley)', axis: 'up', seq: 5, qty: 1, perModule: 4, cost: 5.0,
                      params: { useGlb: true, height: 3.77, width: 2.15, depth: 1.57, wallThickness: 0.12, holeDiameter: 0.41, bottomLip: 1.01, sideHoleFromTop: 1.1875, cutoffHeight: 0, glbScaleMul: 1, glbRotX: 0, glbRotY: 90, glbRotZ: 0, posX: 0, posY: 0, posZ: 0 } },
                    // Right horizontal stack (bracket wall -> outward); mirrored to left.
                    { id: 'r-beam', type: 'beam', label: 'Outer V-Beam', axis: 'right', seq: 1, qty: 1, perModule: 2, cost: 0, posAssembled: 0, posExploded: 0, crossOffset: 0, flipAxis: false,
                      params: { width: 3.5, thickness: 1.5, length: 96, holeOffset: 1.5, holeDiameter: 8 / 25.4, rotDeg: 90, syncStructure: true, color: 0x8B6914 } },
                    { id: 'r-bushing', type: 'bushing', label: 'Bushing 5/16"ID 5/8"OD 1.25"', axis: 'right', seq: 2, qty: 1, perModule: 2, cost: 0.85, posAssembled: 0, posExploded: 0, crossOffset: 0, params: bushingParams() },
                    { id: 'r-lock', type: 'lockWasher', label: '5/16" Split Lock Washer', axis: 'right', seq: 3, qty: 1, perModule: 2, cost: 0.06, posAssembled: 0, posExploded: 0, crossOffset: 0, params: lockParams() },
                    { id: 'r-bolt', type: 'bolt', label: 'Outer V-Beam Bolt (8x60mm button)', axis: 'right', seq: 4, qty: 1, perModule: 2, cost: 0.55, posAssembled: 0, posExploded: 0, crossOffset: 0, params: outerVBoltParams() },
                    // Horizontal H-beams at pivot (up/down); gap washer at center between them.
                    ...(() => {
                        const beams = hwDefaultHBeamPairParts();
                        beams[0].params = hBeamBeamParams();
                        beams[1].params = Object.assign({}, hBeamBeamParams());
                        return beams;
                    })(),
                    hwDefaultHBeamGapWasherPart('outerVBeam'),
                    { id: 'c-bolt', type: 'bolt', label: 'H-Pivot Bolt 1/2"x3" Hex', axis: 'down', seq: 2, qty: 1, perModule: 1, cost: 0.75, posAssembled: 0, posExploded: 0, crossOffset: 0, flipAxis: false,
                      params: { diameter: 0.5, length: 3.0, threadLength: 1.0, headType: 'hex', headDia: 0.75, headHeight: 0.3125, driveSize: 0, metric: '' } },
                    { id: 'c-outer-washer', type: 'washer', label: 'Outer Washer 5/16"ID 1.5"OD', axis: 'down', seq: 3, qty: 1, perModule: 1, cost: 0.08, posAssembled: 0, posExploded: 0, crossOffset: 0, params: { id: 0.3125, od: 1.5, thickness: 0.0625 } },
                    { id: 'c-nut', type: 'nut', label: '1/2"-13 Rivet Nut', axis: 'down', seq: 4, qty: 1, perModule: 1, cost: 0.40, posAssembled: 0, posExploded: 0, crossOffset: 0, params: { id: 0.5, od: 17 * HW_MM_TO_IN, length: 0.5, flangeOd: 18 * HW_MM_TO_IN, flangeThickness: HW_MM_TO_IN, style: 'rivet', thread: '1/2-13' } }
                ]
            },
            innerVBeam: {
                id: 'innerVBeam',
                label: 'Inner V-Beam Assembly',
                detailed: true,
                explodeGap: 1.4,
                detailCam: { pitchDeg: 8, distMul: 2.0 },
                sandwichPlane: 'vertical',
                parts: [
                    { id: 'r-beam', type: 'beam', label: 'Inner V-Beam', axis: 'right', seq: 1, qty: 1, perModule: 2, cost: 0, posAssembled: 0, posExploded: 0, crossOffset: 0, flipAxis: false,
                      params: { width: 3.5, thickness: 1.5, length: 96, holeOffset: 1.5, holeDiameter: 8 / 25.4, holeAlign: 'center', rotDeg: 90, syncStructure: true, color: 0x8B6914 } },
                    { id: 'r-washer', type: 'washer', label: 'Washer 5/8"ID 1-5/16"OD', axis: 'right', seq: 2, qty: 1, perModule: 2, cost: 0.08, posAssembled: 0, posExploded: 0, crossOffset: 0, params: { id: 0.625, od: 1.3125, thickness: 0.0625 } },
                    { id: 'r-lock', type: 'lockWasher', label: '5/16" Split Lock Washer', axis: 'right', seq: 3, qty: 1, perModule: 2, cost: 0.06, posAssembled: 0, posExploded: 0, crossOffset: 0, params: lockParams() },
                    { id: 'r-bolt', type: 'bolt', label: 'Inner V-Beam Bolt (8x60mm button)', axis: 'right', seq: 4, qty: 1, perModule: 2, cost: 0.55, posAssembled: 0, posExploded: 0, crossOffset: 0, flipAxis: true,
                      params: outerVBoltParams() },
                    ...hwDefaultHBeamPairParts(),
                    hwDefaultHBeamGapWasherPart('innerVBeam'),
                ]
            },
            hCenter:    { id: 'hCenter', label: 'H-Beam Center Linkage Assembly', detailed: true, explodeGap: 1.4, detailCam: { pitchDeg: 38, distMul: 2.2 }, sandwichPlane: 'vertical', mirrorPairs: [], parts: [...hwDefaultHBeamPairParts(), hwDefaultHBeamGapWasherPart('hCenter')] },
            vCenter:    { id: 'vCenter', label: 'V-Beam Center Assembly', detailed: true, explodeGap: 1.4, detailCam: { pitchDeg: 14, distMul: 1.9 }, sandwichPlane: 'horizontal', mirrorPairs: [], parts: [] }
        }
    };
}

function hwEnsureHBeamSandwichAssembly(asm) {
    if (!HW_HBEAM_SANDWICH_ASSEMBLY_IDS.includes(asm.id)) return;
    if (!asm.parts) asm.parts = [];
    if (!asm.sandwichPlane) asm.sandwichPlane = 'vertical';

    // The U-bracket belongs in the UP stack (above the top H-beam) in cylinder mode,
    // not on the center axis. Relocate legacy center/right brackets once.
    const bracket = asm.parts.find(p => p.type === 'bracket');
    if (bracket && (bracket.axis === 'center' || bracket.axis === 'right')) {
        bracket.axis = 'up';
        hwRenumberAxis(asm, 'up');
        if (bracket.axis === 'center') hwRenumberAxis(asm, 'center');
    }

    const legacyInner = asm.parts.find(p => p.id === 'c-inner-washer');
    if (legacyInner) {
        legacyInner.id = `${asm.id}-hbeam-gap-washer`;
        legacyInner.sharedKey = HW_HBEAM_GAP_WASHER_SHARED_KEY;
        legacyInner.label = 'H-Beam Gap Washer 1/2"ID 2"OD';
        legacyInner.axis = 'center';
        legacyInner.params = {
            id: 0.5,
            od: 2.0,
            thickness: legacyInner.params?.thickness || 0.0625,
        };
    }

    hwDefaultHBeamPairParts().forEach(defPart => {
        if (!asm.parts.some(p => p.id === defPart.id)) {
            asm.parts.push(JSON.parse(JSON.stringify(defPart)));
        }
    });

    if (!asm.parts.some(p => p.sharedKey === HW_HBEAM_GAP_WASHER_SHARED_KEY)) {
        asm.parts.push(JSON.parse(JSON.stringify(hwDefaultHBeamGapWasherPart(asm.id))));
    }

    hwRenumberAxis(asm, 'center');
    hwRenumberAxis(asm, 'up');
    hwRenumberAxis(asm, 'down');
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
    if (ha.snap == null) ha.snap = true;

    // Normalize per-assembly flags against defaults: all four assemblies are now
    // detailed-capable, and each carries a detail-view camera preset.
    Object.keys(defaults.assemblies).forEach(key => {
        const asm = ha.assemblies[key];
        const def = defaults.assemblies[key];
        if (!asm || !def) return;
        if (def.detailed && !asm.detailed) asm.detailed = true;
        if (!asm.detailCam && def.detailCam) asm.detailCam = { ...def.detailCam };
        if (!asm.sandwichPlane && def.sandwichPlane) asm.sandwichPlane = def.sandwichPlane;
        if (asm.mirrorPairs == null && def.mirrorPairs) asm.mirrorPairs = JSON.parse(JSON.stringify(def.mirrorPairs));
        if (asm.mirrorPairs == null && asm.mirror) asm.mirrorPairs = [JSON.parse(JSON.stringify(asm.mirror))];
    });

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
            const cNut = asm.parts.find(p => p.id === 'c-nut');
            if (cNut && cNut.params && cNut.params.style === 'rivet') {
                if (cNut.params.od == null) cNut.params.od = 17 * HW_MM_TO_IN;
                if (cNut.params.length == null && cNut.params.height == null) cNut.params.length = 0.5;
                if (cNut.params.flangeOd == null) cNut.params.flangeOd = 18 * HW_MM_TO_IN;
                if (cNut.params.flangeThickness == null) cNut.params.flangeThickness = HW_MM_TO_IN;
            }
        }
        hwEnsureHBeamSandwichAssembly(asm);
        hwReconcileMirrorParts(asm);
        if (asm.id === 'innerVBeam' && (!asm.parts || !asm.parts.length)) {
            const defParts = defaults.assemblies.innerVBeam.parts;
            if (defParts && defParts.length) {
                asm.parts = JSON.parse(JSON.stringify(defParts));
                if (asm.detailed == null) asm.detailed = true;
            }
        }
    });

    // One-time migration to the centered sandwich-stack model: clear legacy
    // posAssembled workarounds (auto-offsets and manual nudges that compensated
    // for the old layout) on center and sandwich-side parts so the new automatic
    // centering takes over. Intentional offsets made afterward are preserved.
    if (!ha.stackModelV2) {
        Object.values(ha.assemblies).forEach(asm => {
            (asm.parts || []).forEach(p => {
                if (p.type === 'bracket') return;
                const ax = p.axis || '';
                if (ax === 'center' || hwUsesSandwichAxis(asm, ax)) p.posAssembled = 0;
            });
        });
        ha.stackModelV2 = true;
    }

    // Center assemblies should not inherit legacy default mirror pairs; clear once.
    if (!ha.mirrorDefaultsV2) {
        ['hCenter', 'vCenter'].forEach(id => {
            const asm = ha.assemblies[id];
            if (!asm) return;
            asm.mirrorPairs = [];
            delete asm.mirror;
            asm.parts = (asm.parts || []).filter(p => !hwIsMirrorClonePart(p));
        });
        ha.mirrorDefaultsV2 = true;
    }

    hwReconcileSharedParts();
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
    const threadLen = Math.min(L, Math.max(0, p.threadLength || 0));
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
// Lazy-init: this module can load before the THREE CDN script, so do not construct at top level.
let hwBracketClipPlane = null;

function hwEnsureBracketClipPlane() {
    if (!hwBracketClipPlane && typeof THREE !== 'undefined') {
        hwBracketClipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
    }
    return hwBracketClipPlane;
}

function hwSetBracketClipCutoff(cutoff, halfHeight) {
    const plane = hwEnsureBracketClipPlane();
    if (!plane) return null;
    plane.constant = cutoff > 0 ? (halfHeight - cutoff) : 1e6;
    return plane;
}

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
    const clipPlane = hwSetBracketClipCutoff(cutoff, targetH / 2);
    const mat = getCachedMaterial('hw_bracket_glb_solid', () => new THREE.MeshStandardMaterial({
        color: 0xc2cdd8, metalness: 0.85, roughness: 0.32,
        side: THREE.DoubleSide,
        clippingPlanes: clipPlane ? [clipPlane] : [],
        clipShadows: true
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

    const clipPlane = hwSetBracketClipCutoff(cutoff, H / 2);
    const group = new THREE.Group();
    const mat = getCachedMaterial('hw_bracket_solid_clip', () => new THREE.MeshStandardMaterial({
        color: 0xc2cdd8, metalness: 0.85, roughness: 0.32, side: THREE.DoubleSide,
        clippingPlanes: clipPlane ? [clipPlane] : [],
        clipShadows: true
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
    if (part.type !== 'bracket' && part.type !== 'beam') hwCenterMeshAxially(g);
    g.userData.partId = part.id;
    return g;
}

/** Beam rotDeg is applied in part-local space; mirrored axes flip stack direction, so reflect rotDeg about 90° on mirror.to. */
function hwCreatePartMeshForAxis(part, axisKey, assembly) {
    const mirrorTo = hwGetAssemblyMirrorPairs(assembly).find(p => p.to === axisKey);
    if (part.type === 'beam' && mirrorTo && part.params) {
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
    pointerDown: null,
    // Part view (embedded in main canvas) bookkeeping
    embedded: false,
    needsRecenter: false,
    savedCam: null,
    originalCanvasParent: null,
    originalCanvasNext: null,
    focusGroupUuid: null,
    embeddedInteractionWired: false,
    /** When true (default in part view), camera stays head-on on the focused assembly. */
    lockRadialView: true,
};

// Move the main WebGL canvas into the hardware modal viewport so the detail
// editor shows the real structure assembly instead of a separate scene.
function hwEmbedMainCanvas() {
    const canvas = document.getElementById('canvas-webgl');
    const vp = document.querySelector('#hardware-detail-modal .hw-viewport');
    if (!canvas || !vp || hwDetail.embedded) return;
    hwDetail.originalCanvasParent = canvas.parentElement;
    hwDetail.originalCanvasNext = canvas.nextSibling;
    const placeholder = document.getElementById('hw-detail-canvas');
    if (placeholder) placeholder.style.display = 'none';
    vp.appendChild(canvas);
    hwDetail.embedded = true;
}

function hwRestoreMainCanvas() {
    const canvas = document.getElementById('canvas-webgl');
    if (!canvas || !hwDetail.embedded) return;
    const parent = hwDetail.originalCanvasParent;
    if (parent) {
        const next = hwDetail.originalCanvasNext;
        if (next && next.parentElement === parent) parent.insertBefore(canvas, next);
        else parent.appendChild(canvas);
    }
    const placeholder = document.getElementById('hw-detail-canvas');
    if (placeholder) placeholder.style.display = '';
    hwDetail.originalCanvasParent = null;
    hwDetail.originalCanvasNext = null;
    hwDetail.embedded = false;
}

function hwDetailPointerDown(e) {
    if (e.button !== 0) return;
    if (!state.hwDetailMode && !hwDetail.initialized) return;
    const canvas = hwGetDetailCanvas();
    if (!canvas || e.target !== canvas) return;
    const partId = hwRaycastPartId(e);
    hwDetail.pointerDown = { x: e.clientX, y: e.clientY, partId, moved: false };
    if (partId) {
        const assembly = getActiveHardwareAssembly();
        const part = assembly && assembly.parts.find(p => p.id === partId);
        if (part && part.type !== 'bracket') {
            e.stopPropagation();
            hwDetail.dragPartId = partId;
            hwDetail.dragCtx = hwGetPartStackContext(part, assembly, hwExplodeFactor());
            if (hwDetail.controls) hwDetail.controls.enabled = false;
            canvas.setPointerCapture(e.pointerId);
        }
    }
}

function hwDetailPointerMove(e) {
    const pd = hwDetail.pointerDown;
    if (!pd || !hwDetail.dragPartId || !hwDetail.dragCtx) return;
    if (!pd.moved && (Math.abs(e.clientX - pd.x) > 3 || Math.abs(e.clientY - pd.y) > 3)) pd.moved = true;
    if (!pd.moved) return;
    e.stopPropagation();
    const assembly = getActiveHardwareAssembly();
    const part = assembly && assembly.parts.find(p => p.id === hwDetail.dragPartId);
    if (!part) return;
    const axisPos = hwProjectPointerToAxisPos(e, hwDetail.dragCtx);
    if (axisPos == null) return;
    hwSetPartAxisPosFromWorld(part, hwDetail.dragCtx, axisPos);
    hwRebuildDetailView();
}

function hwDetailPointerUp(e) {
    const pd = hwDetail.pointerDown;
    const canvas = hwGetDetailCanvas();
    if (hwDetail.controls) hwDetail.controls.enabled = true;
    if (pd && !pd.moved && pd.partId) {
        if (hwDetail.selectedPartId !== pd.partId) {
            hwDetail.selectedPartId = pd.partId;
            hwRebuildDetailView();
            renderHardwareEditPanel();
            const card = document.querySelector('.hw-part-card.selected');
            if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    } else if (pd && pd.moved) {
        renderHardwareEditPanel();
        hwPersistHardwareConfig();
        if (typeof updateHUD === 'function') { try { updateHUD(); } catch (err) {} }
    }
    hwDetail.dragPartId = null;
    hwDetail.dragCtx = null;
    hwDetail.pointerDown = null;
    if (canvas && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
}

function hwWireEmbeddedDetailInteraction() {
    if (hwDetail.embeddedInteractionWired) return;
    const canvas = document.getElementById('canvas-webgl');
    if (!canvas) return;
    hwEnsureDetailRaycaster();
    canvas.addEventListener('pointerdown', hwDetailPointerDown);
    canvas.addEventListener('pointermove', hwDetailPointerMove);
    canvas.addEventListener('pointerup', hwDetailPointerUp);
    canvas.addEventListener('pointercancel', hwDetailPointerUp);
    hwDetail.embeddedInteractionWired = true;
}

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

    canvas.addEventListener('pointerdown', hwDetailPointerDown);
    canvas.addEventListener('pointermove', hwDetailPointerMove);
    canvas.addEventListener('pointerup', hwDetailPointerUp);
    canvas.addEventListener('pointercancel', hwDetailPointerUp);

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

// A detailed assembly emits placements when the main "full detail" toggle is on
// (and it has parts), or whenever part view is open (so even an empty assembly can
// be framed and built in the editor).
function hwAssemblyEnabled(assemblyId) {
    ensureHardwareAssemblies();
    const asm = state.hardwareAssemblies.assemblies[assemblyId];
    if (!asm || !asm.detailed) return false;
    if (state.hwDetailMode) return true;
    if (state.showHardwareFullDetail) return !!(asm.parts && asm.parts.length);
    return false;
}

function hwUseFullDetailAssemblies() {
    return hwAssemblyEnabled('outerVBeam');
}

function hwUseInnerDetailAssemblies() {
    return hwAssemblyEnabled('innerVBeam');
}

// True when any detailed assembly (V or center) wants placements this build — used
// to keep the solver's bracket/bolt block alive even with brackets/bolts toggled off.
function hwAnyAssemblyEnabled() {
    ensureHardwareAssemblies();
    return Object.keys(state.hardwareAssemblies.assemblies).some(id => hwAssemblyEnabled(id));
}

// True when an enabled assembly actually carries hardware (so the matching simple
// bolt/bracket can be suppressed to avoid drawing both).
function hwAssemblyHasParts(assemblyId) {
    if (!hwAssemblyEnabled(assemblyId)) return false;
    const asm = state.hardwareAssemblies.assemblies[assemblyId];
    return !!(asm && asm.parts && asm.parts.length);
}

function hwGetAssemblyById(assemblyId) {
    ensureHardwareAssemblies();
    return state.hardwareAssemblies.assemblies[assemblyId] || null;
}

function hwGetOuterVBeamAssembly() {
    return hwGetAssemblyById('outerVBeam');
}

function hwGetInnerVBeamAssembly() {
    return hwGetAssemblyById('innerVBeam');
}

function hwAddAssemblyPlacement(placements, assemblyId, bracketData, vBoltDir, vBoltPivot) {
    const pivotRole = assemblyId === 'innerVBeam' ? 'inner'
        : (assemblyId === 'vCenter' || assemblyId === 'hCenter') ? 'center'
        : 'outer';
    placements.push({
        assemblyId,
        pivotRole,
        moduleIndex: bracketData.moduleIndex != null ? bracketData.moduleIndex : null,
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

function hwAddOuterAssemblyPlacement(placements, bracketData, vBoltDir, vBoltPivot) {
    hwAddAssemblyPlacement(placements, 'outerVBeam', bracketData, vBoltDir, vBoltPivot);
}

function hwRoundVec3ForExport(v, places = 3) {
    if (!v || typeof v.x !== 'number') return null;
    const f = (n) => +Number(n).toFixed(places);
    return { x: f(v.x), y: f(v.y), z: f(v.z) };
}

function hwRoundQuatForExport(q, places = 4) {
    if (!q) return null;
    const f = (n) => +Number(n).toFixed(places);
    return { x: f(q.x), y: f(q.y), z: f(q.z), w: f(q.w) };
}

function hwApplyQuatToVec3(v, q) {
    if (typeof THREE === 'undefined') return v ? { ...v } : null;
    const out = new THREE.Vector3(v.x, v.y, v.z);
    out.applyQuaternion(q);
    return { x: out.x, y: out.y, z: out.z };
}

function hwFindOuterVBoltNearPivot(bolts, pivot, maxDistIn = 0.5) {
    if (!pivot || !Array.isArray(bolts)) return null;
    const maxD2 = maxDistIn * maxDistIn;
    let best = null;
    let bestD2 = maxD2;
    bolts.forEach(b => {
        if (b.boltType !== 'vstack' || b.boltSubType !== 'outer' || !b.center) return;
        const dx = b.center.x - pivot.x;
        const dy = b.center.y - pivot.y;
        const dz = b.center.z - pivot.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD2) {
            bestD2 = d2;
            best = b;
        }
    });
    return best;
}

/**
 * Debug snapshot of high-detail hardware assembly placements for JSON export.
 * Positions are in solver world space (same as geometrySnapshot); viewer positions
 * subtract structureCenter (same offset scene-render applies before drawing).
 *
 * @param {Object} data - buildLinkageGeometry() output
 * @param {{x:number,y:number,z:number}} [structureCenter]
 * @returns {Object}
 */
function buildHardwareAssemblyDebugSnapshot(data, structureCenter) {
    ensureHardwareAssemblies();
    const placements = (data && data.hardwareAssemblyPlacements) || [];
    const sc = structureCenter || data?.structureCenter || data?.structureBounds?.center || { x: 0, y: 0, z: 0 };
    const asm = hwGetOuterVBeamAssembly();
    const bracketPart = asm && asm.parts.find(p => p.type === 'bracket');
    const bracketHoleY = bracketPart ? hwGetBracketHoleY(bracketPart) : 0;
    const bp = bracketPart && bracketPart.params ? bracketPart.params : {};
    const bolts = (data && data.bolts) || [];

    const toViewer = (p) => {
        if (!p) return null;
        return hwRoundVec3ForExport({
            x: p.x - sc.x,
            y: p.y - sc.y,
            z: p.z - sc.z
        });
    };

    return {
        schemaVersion: 3,
        coordinateSystem: 'y-up-inches',
        note: 'world positions match geometrySnapshot. viewer positions subtract structureCenter. Outer V-beam assemblies alternate inner/outer radial pivots (crossing beams): normal = bottom inner + top outer; reversed = bottom outer + top inner.',
        foldAngleDeg: state.foldAngle != null ? +radToDeg(state.foldAngle).toFixed(2) : null,
        vStackReverse: !!state.vStackReverse,
        structureCenter: hwRoundVec3ForExport(sc),
        hardwareFullDetailEnabled: !!state.showHardwareFullDetail,
        bracketEditor: bracketPart ? {
            sideHoleFromTop: bp.sideHoleFromTop,
            sideHoleLocalY: +bracketHoleY.toFixed(4),
            sideHoleLocalX: +(hwGetBracketSideHoleLocal(bracketPart).x).toFixed(4),
            posNudge: hwRoundVec3ForExport({ x: bp.posX || 0, y: bp.posY || 0, z: bp.posZ || 0 }, 4),
            height: bp.height,
            width: bp.width,
            depth: bp.depth,
            wallThickness: bp.wallThickness
        } : null,
        placementCount: placements.length,
        placements: placements.map((pl, index) => {
            const plAsm = hwGetAssemblyById(pl.assemblyId || 'outerVBeam');
            const plBracket = plAsm && plAsm.parts.find(p => p.type === 'bracket');
            const plBracketHoleY = plBracket ? hwGetBracketHoleY(plBracket) : 0;
            const pivotRole = pl.pivotRole || (pl.assemblyId === 'innerVBeam' ? 'inner' : 'outer');
            let flipStackAxis;
            if (pivotRole === 'center') flipStackAxis = false;
            else if (pl.assemblyId === 'innerVBeam') flipStackAxis = (pivotRole === 'inner') !== !!state.vStackReverse;
            else flipStackAxis = pl.isBottom !== !!state.vStackReverse;
            const xf = hwComputeAssemblyTransform(pl);
            const quat = xf.quaternion;
            const toWorld = (local) => {
                const w = hwApplyQuatToVec3(local, quat);
                if (w) { w.x += xf.position.x; w.y += xf.position.y; w.z += xf.position.z; }
                return w;
            };
            const centerlineHoleWorld = plBracket
                ? toWorld({ x: 0, y: plBracketHoleY, z: 0 })
                : toWorld({ x: 0, y: 0, z: 0 });
            const sideHoleWorld = plBracket
                ? toWorld(hwGetBracketSideHoleLocal(plBracket))
                : null;
            const pivot = pl.vBoltPivot || pl.pos;
            const refBolt = hwFindOuterVBoltNearPivot(bolts, pivot);
            const anchorError = (centerlineHoleWorld && pivot) ? {
                x: centerlineHoleWorld.x - pivot.x,
                y: centerlineHoleWorld.y - pivot.y,
                z: centerlineHoleWorld.z - pivot.z
            } : null;

            return {
                index,
                assemblyId: pl.assemblyId || 'outerVBeam',
                pivotRole,
                flipStackAxis,
                moduleIndex: pl.moduleIndex != null ? pl.moduleIndex : null,
                isBottom: !!pl.isBottom,
                ring: pl.isBottom ? 'bottom' : 'top',
                inputs: {
                    bracketPivotPos: hwRoundVec3ForExport(pl.pos),
                    vBoltPivot: hwRoundVec3ForExport(pl.vBoltPivot),
                    bottomPos: hwRoundVec3ForExport(pl.bottomPos),
                    bottomY: pl.bottomY != null ? +pl.bottomY.toFixed(3) : null,
                    sideHoleY: pl.sideHoleY != null ? +pl.sideHoleY.toFixed(3) : null,
                    beamDir: hwRoundVec3ForExport(pl.beamDir, 4),
                    vBoltDir: hwRoundVec3ForExport(pl.vBoltDir, 4),
                    right: hwRoundVec3ForExport(pl.right, 4),
                    frame: pl.frame ? {
                        x: hwRoundVec3ForExport(pl.frame.x, 4),
                        y: hwRoundVec3ForExport(pl.frame.y, 4),
                        z: hwRoundVec3ForExport(pl.frame.z, 4)
                    } : null,
                    sideHoleLocal: plBracket
                        ? hwRoundVec3ForExport(hwGetBracketSideHoleLocal(plBracket), 4)
                        : null
                },
                computedTransform: {
                    world: {
                        position: hwRoundVec3ForExport(xf.position),
                        quaternion: hwRoundQuatForExport(quat),
                        centerlineHoleWorld: hwRoundVec3ForExport(centerlineHoleWorld),
                        sideHoleWorld: hwRoundVec3ForExport(sideHoleWorld),
                        bracketCenterWorld: hwRoundVec3ForExport(xf.position)
                    },
                    viewer: {
                        position: toViewer(xf.position),
                        centerlineHoleWorld: toViewer(centerlineHoleWorld),
                        sideHoleWorld: toViewer(sideHoleWorld),
                        bracketCenterWorld: toViewer(xf.position)
                    },
                    // anchorError = centerline hole vs V-bolt pivot (should be ~0).
                    anchorError: anchorError ? hwRoundVec3ForExport(anchorError, 4) : null,
                    anchorErrorLengthIn: anchorError
                        ? +Math.hypot(anchorError.x, anchorError.y, anchorError.z).toFixed(4)
                        : null
                },
                reference: {
                    outerVBoltCenter: refBolt && refBolt.center ? hwRoundVec3ForExport(refBolt.center) : null,
                    outerVBoltCenterViewer: refBolt && refBolt.center ? toViewer(refBolt.center) : null,
                    bracketCenterToPivot: pivot ? hwRoundVec3ForExport({
                        x: xf.position.x - pivot.x,
                        y: xf.position.y - pivot.y,
                        z: xf.position.z - pivot.z
                    }, 4) : null
                }
            };
        })
    };
}

function hwComputeAssemblyQuaternion(placement) {
    // Preferred path: consume the canonical frame the solver attached to this
    // placement (single source of truth shared with the simple bracket). Maps the
    // assembly's local axes (x = bolt/width, y = up, z = beam/depth) to world.
    if (placement.frame && placement.frame.x && placement.frame.y && placement.frame.z) {
        const fx = vNorm(placement.frame.x);
        const fy = vNorm(placement.frame.y);
        const fz = vNorm(placement.frame.z);
        const m = new THREE.Matrix4();
        m.set(
            fx.x, fy.x, fz.x, 0,
            fx.y, fy.y, fz.y, 0,
            fx.z, fy.z, fz.z, 0,
            0, 0, 0, 1
        );
        let q = new THREE.Quaternion().setFromRotationMatrix(m);
        const manualY = (state.bracketZRotation || 0) * (Math.PI / 180);
        if (Math.abs(manualY) > 0.001) {
            q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(fy.x, fy.y, fy.z), manualY));
        }
        return { quaternion: q, hwX: fx, hwY: fy, hwZ: fz };
    }

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

function hwComputeAssemblyTransform(placement) {
    const asm = hwGetAssemblyById(placement.assemblyId || 'outerVBeam');
    const bracketPart = asm && asm.parts.find(p => p.type === 'bracket');
    const bp = bracketPart && bracketPart.params ? bracketPart.params : {};
    const { quaternion } = hwComputeAssemblyQuaternion(placement);

    const applyLocalNudge = (posVec) => {
        const nudge = new THREE.Vector3(bp.posX || 0, bp.posY || 0, bp.posZ || 0);
        nudge.applyQuaternion(quaternion);
        posVec.add(nudge);
        return posVec;
    };

    // Anchor the bracket centerline at the hole height to the V-stack bolt pivot.
    // Bracketless inner assemblies anchor their local origin on the bolt axis at the pivot.
    if (placement.vBoltPivot) {
        if (bracketPart) {
            const bracketHoleY = hwGetBracketHoleY(bracketPart);
            const holeLocal = new THREE.Vector3(0, bracketHoleY, 0);
            holeLocal.applyQuaternion(quaternion);
            const position = applyLocalNudge(new THREE.Vector3(
                placement.vBoltPivot.x - holeLocal.x,
                placement.vBoltPivot.y - holeLocal.y,
                placement.vBoltPivot.z - holeLocal.z
            ));
            return { position: { x: position.x, y: position.y, z: position.z }, quaternion };
        }
        const position = applyLocalNudge(new THREE.Vector3(
            placement.vBoltPivot.x,
            placement.vBoltPivot.y,
            placement.vBoltPivot.z
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

function hwComputeOuterAssemblyTransform(placement) {
    return hwComputeAssemblyTransform(placement);
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

    // renderAxis -> partsAxis (mirror targets pull parts from their source axis)
    const axesToRender = new Map();
    assembly.parts.filter(p => p.type !== 'bracket' && shouldIncludePart(p)).forEach(part => {
        const ax = part.axis || 'right';
        if (!axesToRender.has(ax)) axesToRender.set(ax, ax);
    });
    hwGetAssemblyMirrorPairs(assembly).forEach(pair => {
        if (!axesToRender.has(pair.from) || axesToRender.has(pair.to)) return;
        const hasPhysicalClones = assembly.parts.some(p =>
            p.type !== 'bracket' && (p.axis || 'right') === pair.to && hwIsMirrorClonePart(p)
        );
        if (hasPhysicalClones) return;
        if (hwAssemblyUsesVirtualMirror(assembly, pair)) {
            axesToRender.set(pair.to, pair.from);
        }
    });

    const layoutOpts = {
        bracketPart,
        bracketHoleY,
        explode,
        gap,
        selectedPartId,
        flipEnd: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI),
        applySelection,
        shouldRenderPart: shouldIncludePart,
    };

    axesToRender.forEach((partsAxis, renderAxis) => {
        hwLayoutAxisParts(group, renderAxis, partsAxis, assembly, layoutOpts);
    });

    return group;
}

function buildHardwareAssemblyScene() {
    // Embedded part view: the main render loop draws the assembly in-structure.
    if (state.hwDetailMode) {
        hwPersistHardwareConfig();
        if (typeof requestRender === 'function') requestRender();
        return;
    }
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
        p.holeAlign || ''
    ].join('|');
}

function hwExtractPartExtras(part) {
    const extras = {};
    if (part.flipAxis) extras.flipAxis = true;
    if (part.params && part.params.holeAlign) extras.holeAlign = part.params.holeAlign;
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

/** Deep-clone hardware assemblies after normalization — used by config export/autosave. */
function serializeHardwareAssembliesForConfig() {
    ensureHardwareAssemblies();
    return JSON.parse(JSON.stringify(state.hardwareAssemblies || {}));
}

let hwPersistTimeoutId = null;

function hwFlushHardwareConfigSync() {
    if (hwPersistTimeoutId != null) {
        clearTimeout(hwPersistTimeoutId);
        hwPersistTimeoutId = null;
    }
    try {
        const snapshot = getConfigSnapshot();
        localStorage.setItem('linkageLab_config', JSON.stringify(snapshot));
        patchProjectDocumentLinkageSlice(extractLinkageSliceFromConfig(snapshot));
    } catch (e) {
        console.warn('[HW] Failed to persist hardware config:', e);
    }
}

function hwPersistHardwareConfig() {
    if (hwPersistTimeoutId != null) clearTimeout(hwPersistTimeoutId);
    hwPersistTimeoutId = setTimeout(hwFlushHardwareConfigSync, 800);
}

function hwInstallHardwarePersistFlush() {
    if (hwInstallHardwarePersistFlush.installed) return;
    hwInstallHardwarePersistFlush.installed = true;
    window.addEventListener('pagehide', hwFlushHardwareConfigSync);
    window.addEventListener('beforeunload', hwFlushHardwareConfigSync);
}
hwInstallHardwarePersistFlush.installed = false;

function hwRefreshAll() {
    buildHardwareAssemblyScene();
    renderHardwareEditPanel();
    if (typeof updateHUD === 'function') { try { updateHUD(); } catch (e) {} }
    if (typeof invalidateGeometryCache === 'function') invalidateGeometryCache();
    if (typeof hwUpdateStructureSpacingUI === 'function') hwUpdateStructureSpacingUI();
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

    // List stacks top-to-bottom around the center slot so the panel mirrors the
    // physical layout: UP parts above the center washer, DOWN parts below it.
    const plane = assembly.sandwichPlane || (assembly.id === 'vCenter' ? 'horizontal' : 'vertical');
    const axisOrder = plane === 'horizontal'
        ? ['left', 'center', 'right', 'up', 'down', 'front', 'back']
        : ['up', 'center', 'down', 'right', 'left', 'front', 'back'];
    const axisLabels = {
        center: 'Center (between beams · sets stack gap)',
        right: 'Right (+ from center)',
        left: 'Left (− from center)',
        up: 'Up (above center)',
        down: 'Down (below center)',
        front: 'Front Axis',
        back: 'Back Axis',
    };
    hwGetAssemblyMirrorPairs(assembly).forEach(pair => {
        if (pair.from === 'right' && pair.to === 'left') axisLabels.right = 'Right (+ from center, mirrored to Left)';
        if (pair.from === 'up' && pair.to === 'down') axisLabels.up = 'Up (above center, mirrored to Down)';
    });

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
    const isMirrorClone = hwIsMirrorClonePart(part);
    if (!isBracket && !isMirrorClone) {
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
    if (!isBracket && !isMirrorClone) {
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
    if (part.sharedKey === HW_HBEAM_GAP_WASHER_SHARED_KEY) {
        const sharedTag = document.createElement('span');
        sharedTag.className = 'hw-part-shared-tag';
        sharedTag.title = 'Synced across Outer V, Inner V, and H-Center assemblies';
        sharedTag.textContent = 'shared';
        head.appendChild(sharedTag);
    }
    if (hwIsMirrorClonePart(part)) {
        const mirrorTag = document.createElement('span');
        mirrorTag.className = 'hw-part-mirror-tag';
        mirrorTag.title = 'Mirrored copy — edits track the source part on the opposite stack';
        mirrorTag.textContent = 'mirrored';
        head.appendChild(mirrorTag);
    }
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
            hwSyncSharedPartFrom(part);
            hwSyncMirrorClonesFromPart(part);
            buildHardwareAssemblyScene();
            if (part.sharedKey) {
                if (typeof invalidateGeometryCache === 'function') invalidateGeometryCache();
                hwPersistHardwareConfig();
            }
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
            inp.title = f.key === 'posAssembled'
                ? (hwUsesSandwichAxis(getActiveHardwareAssembly(), part.axis || 'right')
                    ? 'Offset from sandwich center (0) along this axis; coupled beams on up/down or left/right move together'
                    : 'Offset along the stack from the preceding part; snaps flush to neighbors when Snap is on')
                : (f.key === 'crossOffset' ? 'Offset perpendicular to insert axis (added to auto hole alignment on horizontal axes)' : '');
            hwBindNumberInput(inp, (val) => {
                if (f.key === 'posAssembled') {
                    const assembly = getActiveHardwareAssembly();
                    if (assembly) hwApplyPartAssembledPos(part, assembly, val);
                    else part[f.key] = val;
                    hwSyncMirrorClonesFromPart(part);
                    buildHardwareAssemblyScene();
                    if (typeof invalidateGeometryCache === 'function') invalidateGeometryCache();
                    if (typeof hwUpdateStructureSpacingUI === 'function') hwUpdateStructureSpacingUI();
                    if (typeof updateHUD === 'function') { try { updateHUD(); } catch (e) {} }
                    hwPersistHardwareConfig();
                } else {
                    part[f.key] = val;
                    buildHardwareAssemblyScene();
                }
            });
            if (f.key === 'posAssembled') {
                inp.addEventListener('change', () => saveStateToHistory());
            }
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
        if (key === 'qty') {
            inp.min = '1';
            inp.step = '1';
        }
        inp.value = (part[key] != null ? part[key] : 0);
        hwBindNumberInput(inp, (val) => {
            const nextVal = key === 'qty'
                ? Math.max(1, Math.round(Number(val) || 1))
                : val;
            part[key] = nextVal;
            if (key === 'qty') {
                inp.value = String(nextVal);
                if (part.sharedKey) hwSyncSharedPartFrom(part);
                hwSyncMirrorClonesFromPart(part);
                if (typeof invalidateGeometryCache === 'function') invalidateGeometryCache();
                hwRebuildDetailView();
                if (typeof hwUpdateStructureSpacingUI === 'function') hwUpdateStructureSpacingUI();
                if (typeof updateHUD === 'function') { try { updateHUD(); } catch (e) {} }
                hwPersistHardwareConfig();
            } else if (typeof updateHUD === 'function') { try { updateHUD(); } catch (e) {} }
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
    // Every part (brackets included) is added to the currently-selected stack axis.
    const axis = document.getElementById('hw-add-axis').value || 'right';
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
    return hwGetPartAxialLength(part) * hwPartQty(part);
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

// Deep-copy the hardware parts (and layout config) from one assembly into another so
// similar assemblies (e.g. V-outer → V-inner) don't have to be rebuilt by hand.
function hwCopyPartsFromAssembly(sourceId, targetId) {
    ensureHardwareAssemblies();
    const asms = state.hardwareAssemblies.assemblies;
    const source = asms[sourceId];
    const target = asms[targetId];
    if (!source || !target) return false;
    if (sourceId === targetId) {
        if (typeof showToast === 'function') showToast('Pick a different source assembly to copy from.');
        return false;
    }
    if (!source.parts || !source.parts.length) {
        if (typeof showToast === 'function') showToast(`"${source.label || sourceId}" has no hardware to copy.`);
        return false;
    }
    if (target.parts && target.parts.length &&
        typeof confirm === 'function' &&
        !confirm(`Replace all hardware in "${target.label || targetId}" with a copy from "${source.label || sourceId}"?`)) {
        return false;
    }
    target.parts = JSON.parse(JSON.stringify(source.parts));
    target.detailed = true;
    target.explodeGap = source.explodeGap || target.explodeGap || 1.4;
    if (source.mirrorPairs) target.mirrorPairs = JSON.parse(JSON.stringify(source.mirrorPairs));
    else if (source.mirror) target.mirrorPairs = [JSON.parse(JSON.stringify(source.mirror))];
    else delete target.mirrorPairs;
    if (target.mirrorPairs?.length) target.mirror = { ...target.mirrorPairs[0] };
    else delete target.mirror;
    hwDetail.selectedPartId = null;
    hwDetail.needsRecenter = true;
    if (typeof showToast === 'function') showToast(`Copied hardware from "${source.label || sourceId}".`);
    return true;
}

// UI entry: copy from the dropdown source into the currently-edited assembly.
function hwCopyHardwareFromSelected() {
    const sel = document.getElementById('hw-copy-source');
    if (!sel) return;
    ensureHardwareAssemblies();
    const targetId = state.hardwareAssemblies.activeId;
    if (!hwCopyPartsFromAssembly(sel.value, targetId)) return;
    // Parts changed → solver suppression / detailed render must regenerate.
    if (typeof invalidateGeometryCache === 'function') invalidateGeometryCache();
    hwPersistHardwareConfig();
    hwRebuildDetailView();
    renderHardwareEditPanel();
}

// Refresh the detail preview: in embedded part view the main render loop draws it;
// otherwise fall back to the legacy standalone editor scene.
function hwRebuildDetailView() {
    if (state.hwDetailMode) {
        if (typeof requestRender === 'function') requestRender();
    } else {
        buildHardwareAssemblyScene();
    }
}

function hwSyncMirrorControlsFromAssembly() {
    const asm = getActiveHardwareAssembly();
    const pairs = hwGetAssemblyMirrorPairs(asm);
    const rl = document.getElementById('hw-mirror-right-left');
    const ud = document.getElementById('hw-mirror-up-down');
    if (rl) rl.checked = pairs.some(p => p.from === 'right' && p.to === 'left');
    if (ud) ud.checked = pairs.some(p => p.from === 'up' && p.to === 'down');
}

function hwApplyMirrorControlsToAssembly() {
    ensureHardwareAssemblies();
    const asm = getActiveHardwareAssembly();
    if (!asm) return;
    const prevPairs = hwGetAssemblyMirrorPairs(asm);
    const nextPairs = [];
    if (document.getElementById('hw-mirror-right-left')?.checked) nextPairs.push({ from: 'right', to: 'left' });
    if (document.getElementById('hw-mirror-up-down')?.checked) nextPairs.push({ from: 'up', to: 'down' });
    hwApplyMirrorPairChanges(asm, prevPairs, nextPairs);
    asm.mirrorPairs = nextPairs;
    if (nextPairs.length) asm.mirror = { ...nextPairs[0] };
    else delete asm.mirror;
    hwDetail.needsRecenter = true;
    hwRefreshAll();
    hwPersistHardwareConfig();
}

function wireHardwareDetailControls() {
    if (hwDetailControlsWired) return;
    hwInstallHardwarePersistFlush();

    const sel = document.getElementById('hw-assembly-select');
    if (sel) {
        sel.onchange = () => {
            ensureHardwareAssemblies();
            state.hardwareAssemblies.activeId = sel.value;
            hwDetail.selectedPartId = null;
            hwDetail.needsRecenter = true; // reframe camera on the newly selected assembly
            hwRebuildDetailView();
            renderHardwareEditPanel();
            hwSyncMirrorControlsFromAssembly();
            hwPersistHardwareConfig();
        };
    }

    ['hw-mirror-right-left', 'hw-mirror-up-down'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', hwApplyMirrorControlsToAssembly);
    });

    const sl = document.getElementById('hw-explode-slider');
    if (sl) {
        const onExplodeInput = () => {
            ensureHardwareAssemblies();
            state.hardwareAssemblies.explode = (parseFloat(sl.value) || 0) / 100;
            const v = document.getElementById('hw-explode-value');
            if (v) v.textContent = Math.round(state.hardwareAssemblies.explode * 100) + '%';
            hwRebuildDetailView();
        };
        sl.addEventListener('input', onExplodeInput);
        sl.addEventListener('change', () => {
            onExplodeInput();
            hwPersistHardwareConfig();
        });
    }

    const foldSl = document.getElementById('hw-fold-slider');
    if (foldSl) {
        const minDeg = radToDeg(getEffectiveMinFoldAngle());
        const maxDeg = radToDeg(MAX_FOLD_ANGLE);
        foldSl.min = String(minDeg);
        foldSl.max = String(maxDeg);
        const onFoldInput = () => {
            const deg = parseFloat(foldSl.value) || minDeg;
            state.foldAngle = Math.max(getEffectiveMinFoldAngle(), Math.min(MAX_FOLD_ANGLE, degToRad(deg)));
            const foldVal = document.getElementById('hw-fold-value');
            if (foldVal) foldVal.textContent = radToDeg(state.foldAngle).toFixed(1) + '°';
            hwDetail.lockRadialView = true;
            if (typeof invalidateGeometryCache === 'function') invalidateGeometryCache();
            if (typeof syncUI === 'function') syncUI('foldAngle');
            hwRebuildDetailView();
        };
        foldSl.addEventListener('input', onFoldInput);
        foldSl.addEventListener('change', () => {
            onFoldInput();
            if (typeof saveStateToHistory === 'function') saveStateToHistory();
            if (typeof autoSave === 'function') autoSave();
        });
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
    const foldSl = document.getElementById('hw-fold-slider');
    if (foldSl) {
        foldSl.value = radToDeg(state.foldAngle).toFixed(1);
        const foldVal = document.getElementById('hw-fold-value');
        if (foldVal) foldVal.textContent = radToDeg(state.foldAngle).toFixed(1) + '°';
    }

    // Embedded part view: reparent the main canvas, frame the assembly head-on,
    // and drive everything through the main render loop (no separate scene).
    state.hwDetailMode = true;
    hwDetail.needsRecenter = true;
    hwDetail.lockRadialView = true;
    hwDetail.savedCam = { ...state.cam };
    hwEmbedMainCanvas();
    hwWireEmbeddedDetailInteraction();
    hwSyncMirrorControlsFromAssembly();
    // Force the solver to (re)emit detailed placements for the focus instance.
    if (typeof invalidateGeometryCache === 'function') invalidateGeometryCache();

    hwLoadPresetCatalog().then(() => {
        hwLinkPartsToKnownPresets();
        const assembly = getActiveHardwareAssembly();
        if (assembly) (assembly.parts || []).forEach(p => hwMaybeAutoApplyPreset(p));
        renderHardwareEditPanel();
        requestAnimationFrame(() => {
            if (typeof requestRender === 'function') requestRender();
        });
    });
}

function closeHardwareDetail() {
    const modal = document.getElementById('hardware-detail-modal');
    if (modal) modal.classList.remove('visible');
    document.body.style.overflow = '';

    // Restore the main canvas + camera and re-render the structure normally.
    state.hwDetailMode = false;
    hwDetail.focusGroupUuid = null;
    hwRestoreMainCanvas();
    if (hwDetail.savedCam) { state.cam = hwDetail.savedCam; hwDetail.savedCam = null; }
    // Revert detailed placements to whatever the main toggle dictates.
    if (typeof invalidateGeometryCache === 'function') invalidateGeometryCache();
    if (typeof requestRender === 'function') requestRender();

    hwFlushHardwareConfigSync();
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
    hwApplyPartAssembledPos,
    hwSnapPartAssembledPos,
    hwIsSnapActive,
    hwRaycastPartId,
    hwGetBracketHoleY,
    hwGetBracketSideHoleLocal,
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
    hwAssemblyEnabled,
    hwAnyAssemblyEnabled,
    hwAssemblyHasParts,
    hwUseFullDetailAssemblies,
    hwUseInnerDetailAssemblies,
    hwGetAssemblySandwichGap,
    hwSumCenterAxisGap,
    hwGetAssemblyMirrorPairs,
    hwSyncMirrorControlsFromAssembly,
    hwApplyMirrorControlsToAssembly,
    hwGetCenterRenderAxis,
    hwGetAssemblyById,
    hwGetOuterVBeamAssembly,
    hwGetInnerVBeamAssembly,
    hwAddAssemblyPlacement,
    hwAddOuterAssemblyPlacement,
    hwComputeAssemblyQuaternion,
    hwComputeAssemblyTransform,
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
    hwFlushHardwareConfigSync,
    serializeHardwareAssembliesForConfig,
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
    hwCopyPartsFromAssembly,
    hwCopyHardwareFromSelected,
    wireHardwareDetailControls,
    openHardwareDetail,
    closeHardwareDetail,
    getAssemblyHardwareItems,
    buildHardwareAssemblyDebugSnapshot,
};

hwInstallHardwarePersistFlush();

bridgeGlobals(_moduleExports, 'hardwareDetail');

export { hwDetail, hwDefaultPartPos, hwBindNumberScrub, hwGetPartAxialLength, hwGetPartStackContext, hwAxisPosFromPart, hwSetPartAxisPosFromWorld, hwProjectPointerToAxisPos, hwRaycastPartId, hwGetBracketHoleY, hwGetBracketSideHoleLocal, hwGetBracketStackOrigin, getRivetNutDefaults, getHardwarePartDefaults, getDefaultHardwareAssemblies, ensureHardwareAssemblies, hwMaterial, hwAddHead, createHWBoltMesh, hwAnnulusGeometry, createHWBushingMesh, createHWWasherMesh, createHWLockWasherMesh, createHWNutMesh, createHWBeamMesh, hwGetBeamAlignHoleX, hwSyncBeamPartFromState, hwSyncHBeamPartFromState, hwTagPartMesh, loadHwBracketGlb, buildGlbBracketMesh, buildParametricBracketMesh, createHWBracketMesh, createHardwarePartMesh, hwCreatePartMeshForAxis, initHardwareDetailScene, resizeHardwareDetail, getActiveHardwareAssembly, hwAssemblyEnabled, hwAnyAssemblyEnabled, hwAssemblyHasParts, hwUseFullDetailAssemblies, hwUseInnerDetailAssemblies, hwGetAssemblySandwichGap, hwSumCenterAxisGap, hwGetAssemblyMirrorPairs, hwSyncMirrorControlsFromAssembly, hwApplyMirrorControlsToAssembly, hwGetCenterRenderAxis, hwGetAssemblyById, hwGetOuterVBeamAssembly, hwGetInnerVBeamAssembly, hwAddAssemblyPlacement, hwAddOuterAssemblyPlacement, hwComputeAssemblyQuaternion, hwComputeAssemblyTransform, hwComputeOuterAssemblyTransform, buildHardwareAssemblyGroup, buildHardwareAssemblyScene, hwResolveAddPartType, hwEnsurePartBomKey, hwShortHash, hwSlugifyPresetId, hwPresetSignature, hwExtractPartExtras, hwLoadUserPresetsMap, hwSaveUserPreset, hwPartToPreset, hwCollectAssemblyPresetsMap, hwLoadPresetCatalog, hwFindPresetById, hwGetPresetsForType, hwApplyPresetToPart, hwMaybeAutoApplyPreset, hwLinkPartsToKnownPresets, hwDownloadJsonFile, hwSavePartAsPreset, hwAppendPresetRow, hwPersistHardwareConfig, hwFlushHardwareConfigSync, serializeHardwareAssembliesForConfig, hwRefreshAll, renderHardwareEditPanel, hwBindNumberInput, buildHardwarePartCard, hwRemovePart, hwDuplicatePart, hwRenumberAxis, hwHandleDrop, hwAddPart, hwExplodedAxisPos, hwIsQtyStackPart, hwGetQtyExplodeGap, hwQtyAssembledSpan, hwQtyCopyAssembledPos, hwPartCopyExplodedPos, hwExplodeFactor, wireHardwareDetailControls, openHardwareDetail, closeHardwareDetail, getAssemblyHardwareItems, buildHardwareAssemblyDebugSnapshot };
