// ============================================================================
// LINKAGE LAB - Canvas, idMap, inputs, and HUD element references
// Load after state-sync.js; calls initSliderBindings()
// ============================================================================

// Canvas setup - get references to both 2D overlay and WebGL canvases
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { alpha: true });
const canvasWebGL = document.getElementById('canvas-webgl');

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const inputs = {};
const idMap = {
    'mod': 'modules', 'piv': 'pivotPct', 'hob': 'hobermanAng', 'ang': 'pivotAng', 
    'fold': 'foldAngle', 'hgap': 'hStackGap', 'vgap': 'vStackGap',
    'hstack': 'hStackCount', 'vstack': 'vStackCount',
    'hbeam-w': 'hBeamW', 'hbeam-t': 'hBeamT', 'vbeam-w': 'vBeamW', 'vbeam-t': 'vBeamT',
    'vbeam-inner-w': 'vBeamInnerW', 'vbeam-inner-t': 'vBeamInnerT',
    'vbeam-outer-w': 'vBeamOuterW', 'vbeam-outer-t': 'vBeamOuterT',
    'len': 'hLengthFt', 'vlen': 'vLengthFt',
    'off-top': 'offsetTopIn', 'off-bot': 'offsetBotIn', 'vert-end': 'vertEndOffset',
    'bracket-width': 'bracketWidth', 'bracket-depth': 'bracketDepth', 'bracket-height': 'bracketHeight',
    'bracket-wall': 'bracketWallThickness', 'bracket-inner': 'bracketInnerWidth', 'bracket-hole-distance': 'bracketHoleDistance',
    'cost-hbeam': 'costHBeam', 'cost-vbeam': 'costVBeam', 'cost-brack': 'costBracket', 'cost-solar': 'costSolarPanel'
};

Object.keys(idMap).forEach(k => {
    inputs[k] = {
        sl: document.getElementById('sl-'+k), 
        nb: document.getElementById('nb-'+k)
    };
});
initSliderBindings();

const uiCol = document.getElementById('col-status');
const uiStats = {
    h: document.getElementById('stat-h'),
    d: document.getElementById('stat-d'),
    // Note: stroke, comHeight, and actuatorForce elements removed from HUD
    // These stats are now only shown in the actuator analysis section
    bh: document.getElementById('bom-h'), bv: document.getElementById('bom-v'),
    bu: document.getElementById('bom-u'), bb: document.getElementById('bom-b'),
    bhCost: document.getElementById('bom-h-cost'), bvCost: document.getElementById('bom-v-cost'),
    buCost: document.getElementById('bom-u-cost'), bbCost: document.getElementById('bom-b-cost'),
    bhCostUnit: document.getElementById('bom-h-cost-unit'), bvCostUnit: document.getElementById('bom-v-cost-unit'),
    buCostUnit: document.getElementById('bom-u-cost-unit'), bbCostUnit: document.getElementById('bom-b-cost-unit'),
    bSolar: document.getElementById('bom-solar'), bSolarCost: document.getElementById('bom-solar-cost'),
    bSolarCostUnit: document.getElementById('bom-solar-cost-unit'),
    bSolarRow: document.getElementById('bom-solar-row'),
    bStructureSubtotal: document.getElementById('bom-structure-subtotal'),
    bSolarSubtotal: document.getElementById('bom-solar-subtotal'),
    bSolarSubtotalRow: document.getElementById('bom-solar-subtotal-row'),
    bt: document.getElementById('bom-total'),
    // Weight display elements
    weightStructure: document.getElementById('stat-weight-structure'),
    weightSystem: document.getElementById('stat-weight-system'),
    weightTotal: document.getElementById('stat-weight-total'),
    weightH: document.getElementById('bom-weight-h'),
    weightV: document.getElementById('bom-weight-v'),
    weightU: document.getElementById('bom-weight-u'),
    weightHVal: document.getElementById('bom-weight-h-val'),
    weightVVal: document.getElementById('bom-weight-v-val'),
    weightUVal: document.getElementById('bom-weight-u-val'),
    weightHUnit: document.getElementById('bom-weight-h-unit'),
    weightVUnit: document.getElementById('bom-weight-v-unit'),
    weightUUnit: document.getElementById('bom-weight-u-unit'),
    weightSolar: document.getElementById('bom-weight-solar'),
    weightSolarVal: document.getElementById('bom-weight-solar-val'),
    weightSolarUnit: document.getElementById('bom-weight-solar-unit'),
    weightSolarRow: document.getElementById('bom-weight-solar-row'),
    weightStructureSubtotal: document.getElementById('bom-weight-structure-subtotal'),
    weightSystemSubtotal: document.getElementById('bom-weight-system-subtotal'),
    weightSystemRow: document.getElementById('bom-weight-system-row'),
    weightTotalBom: document.getElementById('bom-weight-total')
};


