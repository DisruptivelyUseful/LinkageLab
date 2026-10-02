// ============================================================================
// LINKAGE LAB — Bill of materials (ES module, pure)
//
// One place for the per-structure quantities, costs and weights that the HUD
// drawer, the build guide, the PDF/CSV exports and the solar-designer handoff
// used to compute separately. With a radial array and/or an arch module array
// on, `copies` says how many structures the design holds and `total` is the
// per-structure set scaled by that count (unit prices unchanged).
//
// Panels are the one quantity that comes from assembled geometry; the base
// (lowest arrayIndex) group is one structure's worth.
//
// No DOM, no THREE. Helpers that live in modules this one must not import
// (support BOM, panel config, hardware extras) are reached through
// `helpers` / globalThis so unit tests can stub them.
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { INCHES_PER_FOOT } from './constants.js';
import {
    needsSplitVBolts,
    getVBeamCountsByType,
    calculateVBeamTotalWeight,
    getVBeamWeightPerBeam,
} from './beam-bolt-helpers.js';
import { calculateBeamCostByVolume } from './solver.js';
import { computeFloorBomContribution } from './floor-geometry.js';
import { PLACEMENTS, normalizeActuation, driveModuleIndices } from './actuation.js';
import { computeCoveringCutPlan, coveringBomItems } from './coverings-plan.js';
import { shadeBomItems } from './shade-cloth.js';
import { calculateSolarPanelArrayWeight } from './geometry-classes.js';

/** How many structures the current design holds (radial visible copies × arch tunnel segments). */
function countStructureCopies(data, s = globalThis.state) {
    const plan = data && data.radialArray;
    const radial = plan ? Math.max(1, plan.visibleCount || (plan.slots ? plan.slots.filter(sl => !sl.hidden).length : 1)) : 1;
    const linear = (s && s.orientation === 'vertical' && (s.arrayCount | 0) > 1) ? (s.arrayCount | 0) : 1;
    const total = radial * linear;
    return { radial, linear, total, label: total === 1 ? '1 structure' : `${total} structures` };
}

/** Panels belonging to one structure: the lowest arrayIndex group present. */
function countBasePanels(panels) {
    if (!Array.isArray(panels) || panels.length === 0) return 0;
    let min = Infinity;
    panels.forEach(p => { const a = (p && p.arrayIndex) | 0; if (a < min) min = a; });
    return panels.filter(p => ((p && p.arrayIndex) | 0) === min).length;
}

function scaleNumbers(obj, k) {
    const out = {};
    Object.keys(obj).forEach(key => {
        const v = obj[key];
        out[key] = typeof v === 'number' ? v * k : v;
    });
    return out;
}

function scaleItems(items, k) {
    return items.map(it => ({ ...it, qty: it.qty * k, total: it.total * k }));
}

/**
 * Computes the bill of materials for the current state and assembled geometry.
 * @param {object} data   buildLinkageGeometry() output (panels, coverings, floor, shade, radialArray)
 * @param {object} s      app state
 * @param {object} [helpers] { computeSupportBomContribution, getActivePanelConfig, getAssemblyHardwareItems }
 */
function computeBillOfMaterials(data, s = globalThis.state, helpers = {}) {
    const g = globalThis;
    const supportBom = helpers.computeSupportBomContribution || g.computeSupportBomContribution || (() => ({ structureItems: [], supportBeamCost: 0, supportBeamWeight: 0, radialQty: 0, reciprocalQty: 0, sbBolts: 0, sbThrough: 0, sbWashers: 0 }));
    const activePanelConfig = helpers.getActivePanelConfig || g.getActivePanelConfig || (() => (s.solarPanels && (s.solarPanels.topPanels || s.solarPanels.sidePanels)) || {});
    const assemblyItemsFor = helpers.getAssemblyHardwareItems || g.getAssemblyHardwareItems || (() => []);

    const copies = countStructureCopies(data, s);
    const moduleCount = s.modules | 0;
    const splitBolts = needsSplitVBolts();

    // --- counts (one structure) ---------------------------------------------------
    const hBeams = moduleCount * 2 * s.hStackCount;
    const vBeams = moduleCount * s.vStackCount;
    const uBrackets = moduleCount * 4;
    const vBoltsInner = moduleCount * 2;
    const vBoltsOuter = moduleCount * 2;
    const vBoltsCenter = moduleCount;
    const hCenterBolts = moduleCount * 2;
    const hPivotBolts = moduleCount * 4;
    const totalVBolts = vBoltsInner + vBoltsOuter + vBoltsCenter;
    const totalHBolts = hCenterBolts + hPivotBolts;
    const nBolts = totalVBolts + totalHBolts;
    const vWashersPerBolt = s.vStackCount > 1 ? (s.vStackCount - 1) : 0;
    const vWasherCount = s.vWasherEnabled ? (totalVBolts * vWashersPerBolt) : 0;
    const hWashersPerBolt = s.hStackCount > 1 ? (s.hStackCount - 1) : 0;
    const hWasherCount = s.hWasherEnabled ? (totalHBolts * hWashersPerBolt) : 0;

    // --- unit prices ------------------------------------------------------------------
    const costBoltVInner = s.costBoltVInner || 0.75;
    const costBoltVOuter = splitBolts ? (s.costBoltVOuter || 0.50) : costBoltVInner;
    const costBoltH = s.costBoltH || 0.75;
    const costBoltHPivot = s.costBoltHPivot || 0.75;
    const costWasherV = s.costWasherV || 0.10;
    const costWasherH = s.costWasherH || 0.10;

    // --- structure costs ---------------------------------------------------------------
    const vBeamCounts = getVBeamCountsByType();
    let vBeamCost, vBeamInnerUnit = s.costVBeam, vBeamOuterUnit = s.costVBeam;
    if (!vBeamCounts.linked) {
        vBeamInnerUnit = s.autoLumberPricing ? calculateBeamCostByVolume(s.vBeamInnerW, s.vBeamInnerT, s.vLengthFt) : s.costVBeam;
        vBeamOuterUnit = s.autoLumberPricing ? calculateBeamCostByVolume(s.vBeamOuterW, s.vBeamOuterT, s.vLengthFt) : s.costVBeam;
        vBeamCost = vBeamCounts.inner * vBeamInnerUnit + vBeamCounts.outer * vBeamOuterUnit;
    } else {
        vBeamCost = vBeams * s.costVBeam;
    }
    const hBeamCost = hBeams * s.costHBeam;
    const bracketCost = uBrackets * s.costBracket;
    const vBoltInnerCost = vBoltsInner * costBoltVInner;
    const vBoltOuterCost = vBoltsOuter * costBoltVOuter;
    const vBoltCenterCost = vBoltsCenter * costBoltVInner;   // centre bolts use the full-length (inner) price
    const hCenterBoltCost = hCenterBolts * costBoltH;
    const hPivotBoltCost = hPivotBolts * costBoltHPivot;
    const boltCost = vBoltInnerCost + vBoltOuterCost + vBoltCenterCost + hCenterBoltCost + hPivotBoltCost;
    const vWasherCost = vWasherCount * costWasherV;
    const hWasherCost = hWasherCount * costWasherH;
    const washerCost = vWasherCost + hWasherCost;

    const sbBom = supportBom(moduleCount, costBoltVInner);
    const floorBom = computeFloorBomContribution(s.floor, moduleCount, s);
    // Deployment drives (Actuation group)
    let driveQty = 0, driveUnit = 0, driveLabel = '';
    if (s.actuation && s.actuation.enabled && s.orientation !== 'vertical') {
        const a = normalizeActuation(s.actuation);
        driveQty = driveModuleIndices(moduleCount, a.drives).length;
        driveUnit = a.motor.costEach || 0;
        driveLabel = `Deployment drives (${(PLACEMENTS[a.placement] || PLACEMENTS.hScissor).short})`;
    }
    const driveCost = driveQty * driveUnit;
    let assemblyHardwareItems = [];
    try { assemblyHardwareItems = assemblyItemsFor(moduleCount) || []; } catch (e) { assemblyHardwareItems = []; }
    const assemblyHardwareCost = assemblyHardwareItems.reduce((a, it) => a + (it.total || 0), 0);

    const structureCost = hBeamCost + vBeamCost + bracketCost + boltCost + washerCost
        + sbBom.supportBeamCost + floorBom.floorBeamCost + assemblyHardwareCost + driveCost;

    // --- power -----------------------------------------------------------------------------
    const solarEnabled = !!(s.solarPanels && s.solarPanels.enabled);
    const panelConfig = activePanelConfig() || {};
    const panelsAll = solarEnabled && data && data.panels ? data.panels.length : 0;
    const panels = solarEnabled ? countBasePanels(data && data.panels) : 0;
    const solarCost = panels * (s.costSolarPanel || 0);
    const totalKw = (panels * (panelConfig.ratedWatts || 0)) / 1000;

    // --- enclosure (coverings / floor deck / shade are already per structure) -------------
    let coveringPlan = null;
    let enclosureItems = [];
    if (data && s.coverings) {
        const covData = data.coverings && data.coverings.supported && s.coverings.enabled ? data.coverings : null;
        const deck = data.floor && data.floor.deck ? data.floor.deck : null;
        if (covData || deck) {
            try {
                const plan = computeCoveringCutPlan(covData, s.coverings, deck);
                if (plan && (plan.walls.length + plan.tables.length + plan.fabric.length + (plan.floor ? 1 : 0)) > 0) {
                    coveringPlan = plan;
                    enclosureItems = coveringBomItems(plan, s);
                }
            } catch (e) { coveringPlan = null; }
        }
    }
    try { shadeBomItems(data && data.shade, s).forEach(it => enclosureItems.push(it)); } catch (e) { /* readout only */ }
    const enclosureCost = enclosureItems.reduce((a, it) => a + (it.total || 0), 0);

    // --- weights (lb) ---------------------------------------------------------------------
    const hBeamWeightPerFoot = (s.hBeamW * s.hBeamT * INCHES_PER_FOOT) * s.woodDensity;
    const hBeamWeightPerBeam = s.hLengthFt * hBeamWeightPerFoot;
    const hBeamWeight = hBeams * hBeamWeightPerBeam;
    const vBeamWeight = calculateVBeamTotalWeight();
    const bracketWeight = uBrackets * (s.weightBracket || 0);
    const boltWeight = nBolts * (s.weightBolt || 0);
    const structureWeight = hBeamWeight + vBeamWeight + bracketWeight + boltWeight + sbBom.supportBeamWeight + floorBom.floorBeamWeight;
    let solarPerUnit = panelConfig.weight != null ? panelConfig.weight : 0;
    if (panelsAll > 0) {
        const allWeight = calculateSolarPanelArrayWeight(data.panels);
        if (allWeight > 0) solarPerUnit = allWeight / panelsAll;
    }
    const solarWeight = panels * solarPerUnit;

    // --- itemised list (one structure), same order as the guide -------------------------------
    const items = [];
    const push = (section, id, qty, label, unit, extra = {}) => items.push({ section, id, qty, label, unit, total: qty * unit, ...extra });
    push('structure', 'hBeams', hBeams, 'H-Beams', s.costHBeam, { stateKey: 'costHBeam', sidebarId: 'nb-cost-hbeam', weightTotal: hBeamWeight });
    if (!vBeamCounts.linked) {
        push('structure', 'vBeamsInner', vBeamCounts.inner, 'V-Inner Beams', vBeamInnerUnit, { weightTotal: 0 });
        push('structure', 'vBeamsOuter', vBeamCounts.outer, 'V-Outer Beams', vBeamOuterUnit, { weightTotal: vBeamWeight });
    } else {
        push('structure', 'vBeams', vBeams, 'V-Beams', s.costVBeam, { stateKey: 'costVBeam', sidebarId: 'nb-cost-vbeam', weightTotal: vBeamWeight });
    }
    push('structure', 'uBrackets', uBrackets, 'U-Brackets', s.costBracket, { stateKey: 'costBracket', sidebarId: 'nb-cost-brack', weightTotal: bracketWeight });
    if (splitBolts) {
        push('structure', 'vBoltsInner', vBoltsInner, 'Inner Bolts', costBoltVInner, { stateKey: 'costBoltVInner', sidebarId: 'nb-cost-bolt-vinner' });
        push('structure', 'vBoltsOuter', vBoltsOuter, 'Outer Bolts', costBoltVOuter, { stateKey: 'costBoltVOuter', sidebarId: 'nb-cost-bolt-vouter' });
        push('structure', 'vBoltsCenter', vBoltsCenter, 'Center Bolts', costBoltVInner, { editable: false });
    } else {
        push('structure', 'vBolts', totalVBolts, 'V-Stack Bolts', costBoltVInner, { stateKey: 'costBoltVInner', sidebarId: 'nb-cost-bolt-v' });
    }
    push('structure', 'hCenterBolts', hCenterBolts, 'H-Center Bolts', costBoltH, { stateKey: 'costBoltH', sidebarId: splitBolts ? 'nb-cost-bolt-h2' : 'nb-cost-bolt-h' });
    push('structure', 'hPivotBolts', hPivotBolts, 'H-Pivot Bolts', costBoltHPivot, { stateKey: 'costBoltHPivot', sidebarId: splitBolts ? 'nb-cost-bolt-hpivot2' : 'nb-cost-bolt-hpivot' });
    if (vWasherCount > 0) push('structure', 'vWashers', vWasherCount, 'V-Stack Washers', costWasherV, { stateKey: 'costWasherV', sidebarId: 'nb-cost-washer-v' });
    if (hWasherCount > 0) push('structure', 'hWashers', hWasherCount, 'H-Stack Washers', costWasherH, { stateKey: 'costWasherH', sidebarId: 'nb-cost-washer-h' });
    (sbBom.structureItems || []).forEach((it, i) => items.push({ section: 'structure', id: `support-${i}`, qty: it.qty, label: it.item, unit: it.unit, total: it.total, editable: false }));
    (floorBom.structureItems || []).forEach((it, i) => items.push({ section: 'structure', id: `floor-${i}`, qty: it.qty, label: it.item, unit: it.unit, total: it.total, editable: false }));
    if (driveQty > 0) push('structure', 'drives', driveQty, driveLabel, driveUnit, { editable: false });
    assemblyHardwareItems.forEach((it, i) => items.push({ section: 'structure', id: `hw-${i}`, qty: it.qty, label: it.item, unit: it.unit, total: it.total, editable: false }));
    if (solarEnabled && panels > 0) push('power', 'panels', panels, `Solar Panels (${panelConfig.ratedWatts || 0}W)`, s.costSolarPanel || 0, { stateKey: 'costSolarPanel', sidebarId: 'nb-cost-solar', weightTotal: solarWeight });
    enclosureItems.forEach((it, i) => items.push({ section: 'enclosure', id: `enc-${i}`, qty: it.qty, label: it.item, unit: it.unit, total: it.total, stateKey: it.stateKey, sidebarId: it.sidebarId }));

    const perStructure = {
        counts: {
            hBeams, vBeams, vBeamsInner: vBeamCounts.inner, vBeamsOuter: vBeamCounts.outer, uBrackets,
            vBoltsInner, vBoltsOuter, vBoltsCenter, hCenterBolts, hPivotBolts, totalVBolts, totalHBolts, nBolts,
            vWasherCount, hWasherCount, panels,
            supportRadial: sbBom.radialQty || 0, supportReciprocal: sbBom.reciprocalQty || 0,
            supportBolts: sbBom.sbBolts || 0, supportThrough: sbBom.sbThrough || 0, supportWashers: sbBom.sbWashers || 0,
        },
        cost: {
            hBeam: hBeamCost, vBeam: vBeamCost, bracket: bracketCost,
            vBoltInner: vBoltInnerCost, vBoltOuter: vBoltOuterCost, vBoltCenter: vBoltCenterCost,
            hCenterBolt: hCenterBoltCost, hPivotBolt: hPivotBoltCost, bolt: boltCost,
            vWasher: vWasherCost, hWasher: hWasherCost, washer: washerCost,
            support: sbBom.supportBeamCost, floor: floorBom.floorBeamCost, assemblyHardware: assemblyHardwareCost, drives: driveCost,
            structure: structureCost, solar: solarCost, enclosure: enclosureCost,
            total: structureCost + solarCost + enclosureCost,
        },
        weight: {
            hBeam: hBeamWeight, vBeam: vBeamWeight, bracket: bracketWeight, bolt: boltWeight,
            support: sbBom.supportBeamWeight, floor: floorBom.floorBeamWeight,
            structure: structureWeight, solar: solarWeight, total: structureWeight + solarWeight,
        },
        items,
    };
    const k = copies.total;
    const total = k === 1 ? perStructure : {
        counts: scaleNumbers(perStructure.counts, k),
        cost: scaleNumbers(perStructure.cost, k),
        weight: scaleNumbers(perStructure.weight, k),
        items: scaleItems(items, k),
    };

    return {
        copies,
        moduleCount,
        splitBolts,
        prices: {
            costBoltVInner, costBoltVOuter, costBoltH, costBoltHPivot, costWasherV, costWasherH,
            vBeamInnerUnit, vBeamOuterUnit, hBeamWeightPerFoot, hBeamWeightPerBeam,
            vBeamWeightPerBeam: getVBeamWeightPerBeam(), solarPerUnit,
        },
        vBeamCounts,
        sbBom,
        floorBom,
        assemblyHardwareItems,
        coveringPlan,
        enclosureItems,
        solarEnabled,
        panelConfig,
        panelsAll,
        totalKw,
        totalKwAll: totalKw * k,
        perStructure,
        total,
    };
}

const _moduleExports = { countStructureCopies, countBasePanels, computeBillOfMaterials };
bridgeGlobals(_moduleExports, 'bom');
export { countStructureCopies, countBasePanels, computeBillOfMaterials };
