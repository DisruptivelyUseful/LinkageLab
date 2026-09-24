// ============================================================================ (ES module)
//
// Stable part identity for build steps.
//
// The solver rebuilds every beam, bolt, washer, bracket and hardware placement
// on each solve, so object references are useless as identifiers. Instead,
// every part carries a small set of semantic fields (module index, stack type,
// ring, role, ...) and this module turns those into deterministic string keys.
// Build steps store *selectors* (partial key fields, with wildcards) rather
// than keys, so a step such as "all top H-beams of module 3" keeps working
// after the design changes.
//
// This module is intentionally free of THREE and DOM so it runs in unit tests.

import { bridgeGlobals } from './global-bridge.js';

/** Part kinds this module understands. */
export const PART_KINDS = ['beam', 'bolt', 'washer', 'bracket', 'placement', 'hwpart', 'panel'];

const STACK_TYPE_LABELS = {
    'horizontal-bottom': 'Bottom H-beam',
    'horizontal-top': 'Top H-beam',
    'vertical': 'V-beam',
    'vertical-cap': 'Cap V-beam',
    'fixed-beam': 'Fixed beam',
    'fixed-beam-cap': 'Cap fixed beam',
    'support-beam': 'Radial support beam',
    'support-beam-reciprocal': 'Reciprocal beam',
};

const BOLT_TYPE_LABELS = {
    vstack: 'V-stack bolt',
    hstack: 'H-center bolt',
    hpivot: 'H-pivot bolt',
    'rcp-ring': 'Reciprocal ring bolt',
    'rcp-cross': 'Reciprocal cross bolt',
};

/** Order joints are worked in: pivots with brackets first, then centre links. */
export const JOINT_ROLE_RANK = { outer: 0, inner: 1, center: 2 };
export function jointRoleRank(role) {
    return role in JOINT_ROLE_RANK ? JOINT_ROLE_RANK[role] : 3;
}
export function placementRole(pl) {
    return (pl && (ASSEMBLY_ROLES[pl.assemblyId] || pl.pivotRole)) || '-';
}

const ASSEMBLY_ROLES = {
    outerVBeam: 'outer',
    innerVBeam: 'inner',
    vCenter: 'center',
    hCenter: 'center',
};

function num(v, fallback = 0) {
    return (v === undefined || v === null || Number.isNaN(v)) ? fallback : v;
}

function arrayIdx(obj) {
    return num(obj.arrayIndex, 0);
}

function moduleIdx(obj) {
    return num(obj.moduleIndex, -1);
}

/**
 * Detects the kind of a geometry object produced by the solver / renderer.
 * @returns {string|null}
 */
export function partKind(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.__partKind) return obj.__partKind;
    if (obj.type === 'beam' || obj.stackType) return 'beam';
    if (obj.boltType) return 'bolt';
    if (obj.washerType) return 'washer';
    if (obj.assemblyId && obj.partId) return 'hwpart';
    if (obj.assemblyId) return 'placement';
    if (obj.holeDistance !== undefined && obj.pos) return 'bracket';
    if (obj.type === 'panel' || (obj.width !== undefined && obj.length !== undefined && obj.center && obj.axisX)) return 'panel';
    return null;
}

/**
 * Deterministic key for one solver/renderer object.
 * Returns null for objects that are not parts.
 * @param {Object} obj
 * @param {string} [kind] - override auto-detection
 * @returns {string|null}
 */
export function partKey(obj, kind = partKind(obj)) {
    if (!obj || !kind) return null;
    const a = `a${arrayIdx(obj)}`;
    const m = `m${moduleIdx(obj)}`;
    const cap = obj.cap ? ':cap' : '';
    switch (kind) {
        case 'beam':
            return `beam:${obj.stackType || 'unknown'}:${a}:${m}:s${num(obj.stackId, -1)}:${obj.patternId || '-'}:L${num(obj.layerIndex, 0)}`;
        case 'bolt':
            if (obj.boltType === 'rcp-ring') return `bolt:rcp-ring:r${num(obj.rcpStackId, -1)}:${a}`;
            if (obj.boltType === 'rcp-cross') return `bolt:rcp-cross:r${num(obj.rcpStackA, -1)}-${num(obj.rcpStackB, -1)}:${obj.boltSubType || '-'}:${a}`;
            return `bolt:${obj.boltType}:${a}:${m}:${obj.ring || '-'}:${obj.role || obj.boltSubType || '-'}${cap}`;
        case 'washer':
            return `washer:${obj.washerType}:${a}:${m}:${obj.ring || '-'}:${obj.role || obj.boltSubType || '-'}${cap}:g${num(obj.gapIndex, 0)}`;
        case 'bracket':
            return `bracket:${a}:${m}:${obj.ring || (obj.isBottom ? 'bottom' : 'top')}:${obj.pivotRole || 'outer'}${cap}`;
        case 'placement':
            return `hwpl:${obj.assemblyId}:${a}:${m}:${obj.ring || (obj.isBottom ? 'bottom' : 'top')}${cap}`;
        case 'hwpart': {
            // obj: { placement, partId, copyIndex, renderAxisKey }
            const pl = obj.placement ? partKey(obj.placement, 'placement') : `hwpl:${obj.assemblyId}:${a}:${m}:${obj.ring || '-'}`;
            return `hwpart:${pl}:${obj.partId}:${obj.renderAxisKey || '-'}:c${num(obj.copyIndex, 0)}`;
        }
        case 'panel':
            return `panel:${num(obj.index, num(obj.panelIndex, 0))}`;
        default:
            return null;
    }
}

/**
 * Canonical key of the *joint* a fastener belongs to. A legacy solver bolt and
 * the hardware placement that replaces it in Full Detail mode share the same
 * joint key, so a fasten step keeps its target when the representation switches.
 * @returns {string|null}
 */
export function jointKey(obj, kind = partKind(obj)) {
    if (!obj || !kind) return null;
    const a = `a${arrayIdx(obj)}`;
    const m = `m${moduleIdx(obj)}`;
    const cap = obj.cap ? ':cap' : '';
    switch (kind) {
        case 'bolt':
            if (obj.boltType === 'rcp-ring' || obj.boltType === 'rcp-cross') return partKey(obj, kind);
            return `joint:${a}:${m}:${obj.ring || '-'}:${obj.role || obj.boltSubType || '-'}${cap}`;
        case 'washer':
            return `joint:${a}:${m}:${obj.ring || '-'}:${obj.role || obj.boltSubType || '-'}${cap}`;
        case 'bracket':
            return `joint:${a}:${m}:${obj.ring || (obj.isBottom ? 'bottom' : 'top')}:${obj.pivotRole || 'outer'}${cap}`;
        case 'placement':
            return `joint:${a}:${m}:${obj.ring || (obj.isBottom ? 'bottom' : 'top')}:${ASSEMBLY_ROLES[obj.assemblyId] || obj.pivotRole || '-'}${cap}`;
        case 'hwpart':
            return obj.placement ? jointKey(obj.placement, 'placement') : null;
        default:
            return null;
    }
}

/**
 * Human readable label for a part (used in the step editor and guide).
 */
export function describePart(obj, kind = partKind(obj)) {
    if (!obj || !kind) return 'Unknown part';
    const mod = moduleIdx(obj) >= 0 ? `, module ${moduleIdx(obj) + 1}` : '';
    const arr = arrayIdx(obj) > 0 ? `, array ${arrayIdx(obj) + 1}` : '';
    const cap = obj.cap ? ' (cap)' : '';
    switch (kind) {
        case 'beam': {
            const base = STACK_TYPE_LABELS[obj.stackType] || obj.stackType || 'Beam';
            const layer = obj.layerIndex !== undefined ? `, layer ${num(obj.layerIndex, 0) + 1}` : '';
            const pat = obj.patternId ? ` (${obj.patternId})` : '';
            if (obj.stackType === 'support-beam' || obj.stackType === 'support-beam-reciprocal') {
                return `${base} ${num(obj.stackId, 0) + 1}${arr}`;
            }
            return `${base}${mod}${layer}${pat}${arr}`;
        }
        case 'bolt': {
            const base = BOLT_TYPE_LABELS[obj.boltType] || 'Bolt';
            if (obj.boltType === 'rcp-ring') return `${base} (beam ${num(obj.rcpStackId, 0) + 1})${arr}`;
            if (obj.boltType === 'rcp-cross') return `${base} (beams ${num(obj.rcpStackA, 0) + 1}/${num(obj.rcpStackB, 0) + 1})${arr}`;
            const where = [obj.ring, obj.role || obj.boltSubType].filter(Boolean).join(' ');
            return `${base}${where ? ` (${where})` : ''}${cap}${mod}${arr}`;
        }
        case 'washer': {
            const where = [obj.ring, obj.role || obj.boltSubType].filter(Boolean).join(' ');
            return `Washer${where ? ` (${where}` : ''}${where ? `, gap ${num(obj.gapIndex, 0) + 1})` : ''}${cap}${mod}${arr}`;
        }
        case 'bracket':
            return `Bracket (${obj.ring || (obj.isBottom ? 'bottom' : 'top')} ${obj.pivotRole || 'outer'})${cap}${mod}${arr}`;
        case 'placement':
            return `${obj.assemblyId} assembly (${obj.ring || (obj.isBottom ? 'bottom' : 'top')})${cap}${mod}${arr}`;
        case 'hwpart':
            return `${obj.partLabel || obj.partId} in ${describePart(obj.placement, 'placement')}`;
        case 'panel':
            return `Solar panel ${num(obj.index, 0) + 1}`;
        default:
            return 'Part';
    }
}

/**
 * Builds an exact selector matching only this part.
 */
export function selectorForPart(obj, kind = partKind(obj)) {
    if (!obj || !kind) return null;
    const sel = { kind };
    const copy = (field, value) => { if (value !== undefined && value !== null) sel[field] = value; };
    switch (kind) {
        case 'beam':
            copy('stackType', obj.stackType);
            copy('moduleIndex', moduleIdx(obj));
            copy('stackId', num(obj.stackId, -1));
            copy('patternId', obj.patternId || undefined);
            copy('layerIndex', num(obj.layerIndex, 0));
            copy('arrayIndex', arrayIdx(obj));
            return sel;
        case 'bolt':
            copy('boltType', obj.boltType);
            if (obj.boltType === 'rcp-ring') { copy('rcpStackId', obj.rcpStackId); copy('arrayIndex', arrayIdx(obj)); return sel; }
            if (obj.boltType === 'rcp-cross') { copy('rcpStackA', obj.rcpStackA); copy('rcpStackB', obj.rcpStackB); copy('boltSubType', obj.boltSubType); copy('arrayIndex', arrayIdx(obj)); return sel; }
            copy('moduleIndex', moduleIdx(obj));
            copy('ring', obj.ring);
            copy('role', obj.role || obj.boltSubType);
            copy('cap', obj.cap ? true : undefined);
            copy('arrayIndex', arrayIdx(obj));
            return sel;
        case 'washer':
            copy('washerType', obj.washerType);
            copy('moduleIndex', moduleIdx(obj));
            copy('ring', obj.ring);
            copy('role', obj.role || obj.boltSubType);
            copy('gapIndex', num(obj.gapIndex, 0));
            copy('cap', obj.cap ? true : undefined);
            copy('arrayIndex', arrayIdx(obj));
            return sel;
        case 'bracket':
            copy('moduleIndex', moduleIdx(obj));
            copy('ring', obj.ring || (obj.isBottom ? 'bottom' : 'top'));
            copy('pivotRole', obj.pivotRole || 'outer');
            copy('cap', obj.cap ? true : undefined);
            copy('arrayIndex', arrayIdx(obj));
            return sel;
        case 'placement':
            copy('assemblyId', obj.assemblyId);
            copy('moduleIndex', moduleIdx(obj));
            copy('ring', obj.ring || (obj.isBottom ? 'bottom' : 'top'));
            copy('cap', obj.cap ? true : undefined);
            copy('arrayIndex', arrayIdx(obj));
            return sel;
        case 'hwpart':
            Object.assign(sel, selectorForPart(obj.placement, 'placement'), { kind: 'hwpart' });
            copy('partId', obj.partId);
            copy('copyIndex', num(obj.copyIndex, 0));
            copy('renderAxisKey', obj.renderAxisKey);
            return sel;
        case 'panel':
            copy('index', num(obj.index, 0));
            return sel;
        default:
            return null;
    }
}

/**
 * Selector for "every part of this kind in the same module / ring" as obj.
 */
export function groupSelectorForPart(obj, kind = partKind(obj)) {
    const exact = selectorForPart(obj, kind);
    if (!exact) return null;
    const sel = { kind: exact.kind };
    if (kind === 'beam') {
        sel.stackType = exact.stackType;
        sel.moduleIndex = exact.moduleIndex;
        if (exact.arrayIndex) sel.arrayIndex = exact.arrayIndex;
    } else if (kind === 'bolt' || kind === 'washer') {
        if (exact.boltType) sel.boltType = exact.boltType;
        if (exact.washerType) sel.washerType = exact.washerType;
        if (exact.moduleIndex !== undefined) sel.moduleIndex = exact.moduleIndex;
        if (exact.ring) sel.ring = exact.ring;
    } else if (kind === 'bracket' || kind === 'placement') {
        sel.moduleIndex = exact.moduleIndex;
        if (exact.assemblyId) sel.assemblyId = exact.assemblyId;
    } else {
        return exact;
    }
    return sel;
}

// Fields of an object that a selector may constrain, by kind.
const SELECTOR_FIELDS = {
    beam: ['stackType', 'moduleIndex', 'stackId', 'patternId', 'layerIndex', 'arrayIndex'],
    bolt: ['boltType', 'boltSubType', 'moduleIndex', 'ring', 'role', 'cap', 'arrayIndex', 'rcpStackId', 'rcpStackA', 'rcpStackB'],
    washer: ['washerType', 'boltSubType', 'moduleIndex', 'ring', 'role', 'gapIndex', 'cap', 'arrayIndex'],
    bracket: ['moduleIndex', 'ring', 'pivotRole', 'cap', 'arrayIndex'],
    placement: ['assemblyId', 'moduleIndex', 'ring', 'cap', 'arrayIndex'],
    hwpart: ['assemblyId', 'moduleIndex', 'ring', 'cap', 'arrayIndex', 'partId', 'copyIndex', 'renderAxisKey'],
    panel: ['index'],
};

function fieldValue(obj, kind, field) {
    switch (field) {
        case 'moduleIndex': return moduleIdx(obj);
        case 'arrayIndex': return arrayIdx(obj);
        case 'layerIndex': return num(obj.layerIndex, 0);
        case 'gapIndex': return num(obj.gapIndex, 0);
        case 'copyIndex': return num(obj.copyIndex, 0);
        case 'index': return num(obj.index, num(obj.panelIndex, 0));
        case 'cap': return !!obj.cap;
        case 'ring': return obj.ring || (obj.isBottom !== undefined ? (obj.isBottom ? 'bottom' : 'top') : undefined);
        case 'role': return obj.role || obj.boltSubType;
        case 'pivotRole': return obj.pivotRole || 'outer';
        case 'patternId': return obj.patternId || null;
        default:
            if (kind === 'hwpart' && obj.placement && obj[field] === undefined) return fieldValue(obj.placement, 'placement', field);
            return obj[field];
    }
}

function valueMatches(actual, wanted) {
    if (wanted === undefined || wanted === null || wanted === '*') return true;
    if (Array.isArray(wanted)) return wanted.some(w => valueMatches(actual, w));
    if (typeof wanted === 'object' && wanted !== null) {
        // range: { min, max } for numeric fields
        if (typeof actual !== 'number') return false;
        if (wanted.min !== undefined && actual < wanted.min) return false;
        if (wanted.max !== undefined && actual > wanted.max) return false;
        return true;
    }
    return actual === wanted;
}

/**
 * Tests whether a part matches a selector.
 * Selector: `{ kind, ...fields }`. A field may be a value, an array of values,
 * `{min,max}`, or '*' / undefined for "any". `kind: 'joint'` matches any
 * fastener-side object (bolt, washer, bracket, placement) whose joint fields
 * match `{ moduleIndex, ring, role, cap, arrayIndex }`. `kind: '*'` matches any kind.
 */
export function matchSelector(obj, selector, kind = partKind(obj)) {
    if (!obj || !selector || !kind) return false;
    if (selector.key) return selector.key === partKey(obj, kind);
    if (selector.kind === 'joint') {
        if (!['bolt', 'washer', 'bracket', 'placement', 'hwpart'].includes(kind)) return false;
        const jk = jointKey(obj, kind);
        if (!jk || !jk.startsWith('joint:')) return false;
        const [, a, m, ring, roleAndCap] = jk.split(':');
        const role = roleAndCap;
        const cap = jk.endsWith(':cap');
        return valueMatches(parseInt(a.slice(1), 10), selector.arrayIndex)
            && valueMatches(parseInt(m.slice(1), 10), selector.moduleIndex)
            && valueMatches(ring, selector.ring)
            && valueMatches(role, selector.role)
            && (selector.cap === undefined || selector.cap === '*' || !!selector.cap === cap)
            && (selector.boltType === undefined || kind !== 'bolt' || valueMatches(obj.boltType, selector.boltType))
            && (selector.assemblyId === undefined || kind !== 'placement' || valueMatches(obj.assemblyId, selector.assemblyId));
    }
    if (selector.kind && selector.kind !== '*' && selector.kind !== kind) return false;
    const fields = SELECTOR_FIELDS[kind] || [];
    for (const field of fields) {
        if (selector[field] === undefined) continue;
        if (!valueMatches(fieldValue(obj, kind, field), selector[field])) return false;
    }
    return true;
}

/**
 * Flattens solver output into tagged part records.
 * @param {Object} data - result of buildLinkageGeometry / solveLinkage
 * @returns {Array<{kind:string, obj:Object, key:string}>}
 */
export function collectParts(data) {
    const out = [];
    const push = (kind, list) => {
        if (!Array.isArray(list)) return;
        list.forEach((obj, index) => {
            if (!obj) return;
            if (kind === 'panel' && obj.index === undefined) obj.index = index;
            const key = partKey(obj, kind);
            if (key) out.push({ kind, obj, key });
        });
    };
    push('beam', data && data.beams);
    push('bolt', data && data.bolts);
    push('washer', data && data.washers);
    push('bracket', data && data.brackets);
    push('placement', data && data.hardwareAssemblyPlacements);
    push('panel', data && data.panels);
    return out;
}

/**
 * Resolves a list of selectors against geometry data.
 * @returns {{items:Array, keys:Set<string>, beams:Array, bolts:Array, washers:Array, brackets:Array, placements:Array, panels:Array}}
 */
export function resolveTargets(data, selectors, parts = null) {
    const all = parts || collectParts(data);
    const sels = Array.isArray(selectors) ? selectors : (selectors ? [selectors] : []);
    const result = { items: [], keys: new Set(), beams: [], bolts: [], washers: [], brackets: [], placements: [], panels: [] };
    if (!sels.length) return result;
    for (const rec of all) {
        if (result.keys.has(rec.key)) continue;
        if (sels.some(sel => matchSelector(rec.obj, sel, rec.kind))) {
            result.items.push(rec);
            result.keys.add(rec.key);
            const bucket = rec.kind === 'placement' ? 'placements' : `${rec.kind}s`;
            if (result[bucket]) result[bucket].push(rec.obj);
        }
    }
    return result;
}

/**
 * Representative world-space points of a part (for framing / bounding boxes).
 * @returns {Array<{x:number,y:number,z:number}>}
 */
export function partPoints(obj, kind = partKind(obj)) {
    if (!obj) return [];
    switch (kind) {
        case 'beam':
            if (Array.isArray(obj.corners) && obj.corners.length) return obj.corners;
            return [obj.p1, obj.p2].filter(Boolean);
        case 'bolt':
            return [obj.start, obj.end, obj.center].filter(Boolean);
        case 'washer':
            return obj.center ? [obj.center] : [];
        case 'bracket':
            return [obj.pos, obj.bottomPos].filter(Boolean);
        case 'placement':
            return [obj.pos, obj.vBoltPivot].filter(Boolean);
        case 'hwpart':
            return obj.worldPos ? [obj.worldPos] : partPoints(obj.placement, 'placement');
        case 'panel':
            if (Array.isArray(obj.corners) && obj.corners.length) return obj.corners;
            return obj.center ? [obj.center] : [];
        default:
            return [];
    }
}

/**
 * Axis-aligned bounds of a set of part records (from resolveTargets().items).
 * @returns {{min:{x,y,z}, max:{x,y,z}, center:{x,y,z}, radius:number}|null}
 */
export function partsBounds(items) {
    let min = null, max = null;
    for (const rec of items || []) {
        for (const p of partPoints(rec.obj, rec.kind)) {
            if (!p) continue;
            if (!min) { min = { x: p.x, y: p.y, z: p.z }; max = { x: p.x, y: p.y, z: p.z }; continue; }
            min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z);
            max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z);
        }
    }
    if (!min) return null;
    const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
    const dx = max.x - min.x, dy = max.y - min.y, dz = max.z - min.z;
    const radius = Math.max(0.5, Math.sqrt(dx * dx + dy * dy + dz * dz) / 2);
    return { min, max, center, radius };
}

/**
 * Short label for a selector (for the step list).
 */
export function selectorLabel(sel) {
    if (!sel) return '';
    if (sel.key) return sel.key;
    const parts = [];
    const kind = sel.kind || '*';
    if (kind === 'beam') parts.push(STACK_TYPE_LABELS[sel.stackType] || (sel.stackType ? String(sel.stackType) : 'Beams'));
    else if (kind === 'bolt') parts.push(BOLT_TYPE_LABELS[sel.boltType] || 'Bolts');
    else if (kind === 'joint') parts.push('Joint');
    else if (kind === 'placement') parts.push(`${sel.assemblyId || 'Hardware'} assembly`);
    else if (kind === 'hwpart') parts.push(`${sel.partId || 'part'} (${sel.assemblyId || 'assembly'})`);
    else if (kind === 'panel') parts.push(sel.index !== undefined && sel.index !== '*' ? `Solar panel ${sel.index + 1}` : 'Solar panels');
    else parts.push(kind === '*' ? 'All parts' : kind.charAt(0).toUpperCase() + kind.slice(1) + 's');
    if (sel.ring && sel.ring !== '*') parts.push(sel.ring);
    if (sel.role && sel.role !== '*') parts.push(sel.role);
    if (sel.pivotRole && sel.pivotRole !== '*') parts.push(sel.pivotRole);
    if (sel.moduleIndex !== undefined && sel.moduleIndex !== '*') {
        parts.push(Array.isArray(sel.moduleIndex)
            ? `modules ${sel.moduleIndex.map(i => i + 1).join(',')}`
            : (typeof sel.moduleIndex === 'object' ? `modules ${sel.moduleIndex.min + 1}-${sel.moduleIndex.max + 1}` : `module ${sel.moduleIndex + 1}`));
    } else if (kind !== 'panel' && kind !== '*') {
        parts.push('all modules');
    }
    if (sel.layerIndex !== undefined && sel.layerIndex !== '*') parts.push(`layer ${sel.layerIndex + 1}`);
    if (sel.patternId && sel.patternId !== '*') parts.push(`pattern ${sel.patternId}`);
    if (sel.cap) parts.push('cap');
    return parts.join(' · ');
}

const _moduleExports = {
    PART_KINDS,
    partKind,
    partKey,
    jointKey,
    describePart,
    selectorForPart,
    groupSelectorForPart,
    matchSelector,
    collectParts,
    resolveTargets,
    partPoints,
    partsBounds,
    selectorLabel,
};

bridgeGlobals(_moduleExports, 'partKeys');
