// DOM ELEMENTS
// ============================================================================

const inputs = {};
const idMap = {
    'mod': 'modules', 'piv': 'pivotPct', 'hob': 'hobermanAng', 'ang': 'pivotAng', 
    'fold': 'foldAngle', 'brack': 'bracketOffset', 'vgap': 'stackGap',
    'hstack': 'hStackCount', 'vstack': 'vStackCount',
    'hbeam-w': 'hBeamW', 'hbeam-t': 'hBeamT', 'vbeam-w': 'vBeamW', 'vbeam-t': 'vBeamT',
    'len': 'hLengthFt', 'vlen': 'vLengthFt',
    'off-top': 'offsetTopIn', 'off-bot': 'offsetBotIn',
    'cost-hbeam': 'costHBeam', 'cost-vbeam': 'costVBeam', 'cost-bolt': 'costBolt', 'cost-brack': 'costBracket', 'cost-solar': 'costSolarPanel'
};

Object.keys(idMap).forEach(k => {
    inputs[k] = {
        sl: document.getElementById('sl-'+k), 
        nb: document.getElementById('nb-'+k)
    };
});

const uiCol = document.getElementById('col-status');
const uiStats = {
    h: document.getElementById('stat-h'),
    d: document.getElementById('stat-d'),
    stroke: document.getElementById('stat-stroke'),
    bh: document.getElementById('bom-h'), bv: document.getElementById('bom-v'),
    bu: document.getElementById('bom-u'), bb: document.getElementById('bom-b'),
    bhCost: document.getElementById('bom-h-cost'), bvCost: document.getElementById('bom-v-cost'),
    buCost: document.getElementById('bom-u-cost'), bbCost: document.getElementById('bom-b-cost'),
    bSolar: document.getElementById('bom-solar'), bSolarCost: document.getElementById('bom-solar-cost'),
    bSolarRow: document.getElementById('bom-solar-row'),
    bStructureSubtotal: document.getElementById('bom-structure-subtotal'),
    bSolarSubtotal: document.getElementById('bom-solar-subtotal'),
    bSolarSubtotalRow: document.getElementById('bom-solar-subtotal-row'),
    bt: document.getElementById('bom-total')
};

// ============================================================================
// MATH UTILITIES - 3D Vector Operations
// ============================================================================

const v3 = (x, y, z) => ({x, y, z});

const vAdd = (a, b) => ({x: a.x + b.x, y: a.y + b.y, z: a.z + b.z});

const vSub = (a, b) => ({x: a.x - b.x, y: a.y - b.y, z: a.z - b.z});

const vScale = (a, s) => ({x: a.x * s, y: a.y * s, z: a.z * s});

const vMag = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);

const vNorm = (a) => {
    const m = vMag(a);
    return m === 0 ? {x: 0, y: 0, z: 0} : vScale(a, 1 / m);
};

const vCross = (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
});

const vDot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

// ============================================================================

const CONFIG_KEYS = [
    'modules', 'hLengthFt', 'vLengthFt', 'pivotPct', 'hobermanAng', 'pivotAng',
    'hStackCount', 'vStackCount', 'vStackReverse', 'offsetTopIn', 'offsetBotIn', 'vertEndOffset',
    'bracketOffset', 'stackGap', 'hBeamW', 'hBeamT', 'vBeamW', 'vBeamT',
    'costHBeam', 'costVBeam', 'costBolt', 'costBracket', 'costSolarPanel', 'orientation', 'archCapUprights',
    'archFlipVertical', 'archRotation', 'arrayCount', 'useFixedBeams'
];

const SOLAR_PANEL_KEYS = [
    'enabled', 'panelLength', 'panelWidth', 'panelThickness',
    'ratedWatts', 'voc', 'vmp', 'isc', 'imp', 'layoutMode',
    'paddingX', 'paddingY', 'gridRows', 'gridCols', 'gridRotation', 'radialCount', 'radialOffset',
    'radialRotation', 'radialLateralOffset', 'pinwheelAngle',
    'spiralArmCount', 'spiralSecondaryEnabled', 'spiralSecondaryRadialOffset', 'spiralSecondaryLateralOffset', 'spiralSecondaryPinwheel', 'spiralSecondaryRotation',
    'spiralArmRadialStep', 'spiralArmLateralStep', 'spiralArmPinwheelStep', 'spiralArmRotationStep',
    'showSupportBeams', 'supportBeamRotation', 'supportBeamLength', 'supportBeamFoldAngle',
    'supportBeamOffsetH', 'supportBeamOffsetV', 'panelLift',
    'archPanelOffset', 'archPanelSlide', 'archPanelSeparation',
    'archWallFaces', 'sideWallPanels', 'topPanels', 'topPanelRows', 'topPanelCols'
];

function applyV30Config(config) {
    // Structure parameters
    if (config.structure) {
        const s = config.structure;
        if (s.modules !== undefined) state.modules = s.modules;
        if (s.beamLengths) {
            if (s.beamLengths.horizontal !== undefined) state.hLengthFt = s.beamLengths.horizontal;
            if (s.beamLengths.vertical !== undefined) state.vLengthFt = s.beamLengths.vertical;
        if (s.pivotPercent !== undefined) state.pivotPct = s.pivotPercent;
        if (s.stackCounts) {
            if (s.stackCounts.horizontal !== undefined) state.hStackCount = s.stackCounts.horizontal;
            if (s.stackCounts.vertical !== undefined) state.vStackCount = s.stackCounts.vertical;
        if (s.beamDimensions) {
            if (s.beamDimensions.horizontalWidth !== undefined) state.hBeamW = s.beamDimensions.horizontalWidth;
            if (s.beamDimensions.horizontalThickness !== undefined) state.hBeamT = s.beamDimensions.horizontalThickness;
            if (s.beamDimensions.verticalWidth !== undefined) state.vBeamW = s.beamDimensions.verticalWidth;
            if (s.beamDimensions.verticalThickness !== undefined) state.vBeamT = s.beamDimensions.verticalThickness;
        if (s.offsets) {
            if (s.offsets.top !== undefined) state.offsetTopIn = s.offsets.top;
            if (s.offsets.bottom !== undefined) state.offsetBotIn = s.offsets.bottom;
            if (s.offsets.vertEnd !== undefined) state.vertEndOffset = s.offsets.vertEnd;
            if (s.offsets.bracket !== undefined) state.bracketOffset = s.offsets.bracket;
            if (s.offsets.stackGap !== undefined) state.stackGap = s.offsets.stackGap;
        if (s.hobermanAngle !== undefined) state.hobermanAng = s.hobermanAngle;
        if (s.pivotAngle !== undefined) state.pivotAng = s.pivotAngle;
        if (s.vStackReverse !== undefined) state.vStackReverse = s.vStackReverse;
    
    // Mode configuration
    if (config.mode) {
        const m = config.mode;
        if (m.type !== undefined) state.orientation = m.type === 'arch' ? 'vertical' : 'horizontal';
        if (m.flipVertical !== undefined) state.archFlipVertical = m.flipVertical;
        if (m.rotation !== undefined) state.archRotation = m.rotation;
        if (m.useFixedBeams !== undefined) state.useFixedBeams = m.useFixedBeams;
        if (m.capUprights !== undefined) state.archCapUprights = m.capUprights;
        if (m.arrayCount !== undefined) state.arrayCount = m.arrayCount;
    
    // Solar panel configuration
    if (config.panels) {
        const p = config.panels;
        const sp = state.solarPanels;
        
        if (p.enabled !== undefined) sp.enabled = p.enabled;
        
        // Load top panels configuration
        if (p.topPanels) {
            const tp = p.topPanels;
            if (tp.enabled !== undefined) sp.topPanels.enabled = tp.enabled;
            if (tp.size) {
                if (tp.size.width !== undefined) sp.topPanels.panelWidth = tp.size.width;
                if (tp.size.length !== undefined) sp.topPanels.panelLength = tp.size.length;
                if (tp.size.thickness !== undefined) sp.topPanels.panelThickness = tp.size.thickness;
            if (tp.electrical) {
                if (tp.electrical.ratedWatts !== undefined) sp.topPanels.ratedWatts = tp.electrical.ratedWatts;
                if (tp.electrical.voc !== undefined) sp.topPanels.voc = tp.electrical.voc;
                if (tp.electrical.vmp !== undefined) sp.topPanels.vmp = tp.electrical.vmp;
                if (tp.electrical.isc !== undefined) sp.topPanels.isc = tp.electrical.isc;
                if (tp.electrical.imp !== undefined) sp.topPanels.imp = tp.electrical.imp;
            if (tp.padding) {
                if (tp.padding.x !== undefined) sp.topPanels.paddingX = tp.padding.x;
                if (tp.padding.y !== undefined) sp.topPanels.paddingY = tp.padding.y;
            if (tp.grid) {
                if (tp.grid.rows !== undefined) sp.topPanels.gridRows = tp.grid.rows;
                if (tp.grid.cols !== undefined) sp.topPanels.gridCols = tp.grid.cols;
            if (tp.lift !== undefined) sp.topPanels.panelLift = tp.lift;
        
        // Load side panels configuration
        if (p.sidePanels) {
            const sidep = p.sidePanels;
            if (sidep.enabled !== undefined) sp.sidePanels.enabled = sidep.enabled;
            if (sidep.size) {
                if (sidep.size.width !== undefined) sp.sidePanels.panelWidth = sidep.size.width;
                if (sidep.size.length !== undefined) sp.sidePanels.panelLength = sidep.size.length;
                if (sidep.size.thickness !== undefined) sp.sidePanels.panelThickness = sidep.size.thickness;
            if (sidep.electrical) {
                if (sidep.electrical.ratedWatts !== undefined) sp.sidePanels.ratedWatts = sidep.electrical.ratedWatts;
                if (sidep.electrical.voc !== undefined) sp.sidePanels.voc = sidep.electrical.voc;
                if (sidep.electrical.vmp !== undefined) sp.sidePanels.vmp = sidep.electrical.vmp;
                if (sidep.electrical.isc !== undefined) sp.sidePanels.isc = sidep.electrical.isc;
                if (sidep.electrical.imp !== undefined) sp.sidePanels.imp = sidep.electrical.imp;
            if (sidep.padding) {
                if (sidep.padding.x !== undefined) sp.sidePanels.paddingX = sidep.padding.x;
                if (sidep.padding.y !== undefined) sp.sidePanels.paddingY = sidep.padding.y;
            if (sidep.grid) {
                if (sidep.grid.rows !== undefined) sp.sidePanels.gridRows = sidep.grid.rows;
                if (sidep.grid.cols !== undefined) sp.sidePanels.gridCols = sidep.grid.cols;
        
        // Layout mode (for top panels)
        if (p.layoutMode !== undefined) sp.layoutMode = p.layoutMode;
        if (p.gridRotation !== undefined) sp.gridRotation = p.gridRotation;
        
        if (p.positioning) {
            if (p.positioning.lift !== undefined) sp.archPanelOffset = p.positioning.lift;
            if (p.positioning.slide !== undefined) sp.archPanelSlide = p.positioning.slide;
            if (p.positioning.separation !== undefined) sp.archPanelSeparation = p.positioning.separation;
        
        if (p.radial) {
            if (p.radial.count !== undefined) sp.radialCount = p.radial.count;
            if (p.radial.offset !== undefined) sp.radialOffset = p.radial.offset;
            if (p.radial.rotation !== undefined) sp.radialRotation = p.radial.rotation;
            if (p.radial.lateralOffset !== undefined) sp.radialLateralOffset = p.radial.lateralOffset;
            if (p.radial.pinwheelAngle !== undefined) sp.pinwheelAngle = p.radial.pinwheelAngle;
        
        if (p.spiral) {
            if (p.spiral.armCount !== undefined) sp.spiralArmCount = p.spiral.armCount;
            if (p.spiral.secondaryEnabled !== undefined) sp.spiralSecondaryEnabled = p.spiral.secondaryEnabled;
            if (p.spiral.secondaryRadialOffset !== undefined) sp.spiralSecondaryRadialOffset = p.spiral.secondaryRadialOffset;
            if (p.spiral.secondaryLateralOffset !== undefined) sp.spiralSecondaryLateralOffset = p.spiral.secondaryLateralOffset;
            if (p.spiral.secondaryPinwheel !== undefined) sp.spiralSecondaryPinwheel = p.spiral.secondaryPinwheel;
            if (p.spiral.secondaryRotation !== undefined) sp.spiralSecondaryRotation = p.spiral.secondaryRotation;
            if (p.spiral.armRadialStep !== undefined) sp.spiralArmRadialStep = p.spiral.armRadialStep;
            if (p.spiral.armLateralStep !== undefined) sp.spiralArmLateralStep = p.spiral.armLateralStep;
            if (p.spiral.armPinwheelStep !== undefined) sp.spiralArmPinwheelStep = p.spiral.armPinwheelStep;
            if (p.spiral.armRotationStep !== undefined) sp.spiralArmRotationStep = p.spiral.armRotationStep;
        
        if (p.support) {
            if (p.support.show !== undefined) sp.showSupportBeams = p.support.show;
            if (p.support.rotation !== undefined) sp.supportBeamRotation = p.support.rotation;
            if (p.support.length !== undefined) sp.supportBeamLength = p.support.length;
            if (p.support.foldAngle !== undefined) sp.supportBeamFoldAngle = p.support.foldAngle;
            if (p.support.offsetH !== undefined) sp.supportBeamOffsetH = p.support.offsetH;
            if (p.support.offsetV !== undefined) sp.supportBeamOffsetV = p.support.offsetV;
        
        if (p.enabledFaces !== undefined) sp.archWallFaces = p.enabledFaces;
    
    // Costs
    if (config.costs) {
        const c = config.costs;
        if (c.hBeam !== undefined) state.costHBeam = c.hBeam;
        if (c.vBeam !== undefined) state.costVBeam = c.vBeam;
        if (c.bolt !== undefined) state.costBolt = c.bolt;
        if (c.bracket !== undefined) state.costBracket = c.bracket;
        if (c.solarPanel !== undefined) state.costSolarPanel = c.solarPanel;

function applyLegacyConfig(config) {
    CONFIG_KEYS.forEach(key => {
        if (config.hasOwnProperty(key) && config[key] !== undefined) {
            state[key] = config[key];
    
    // Load solar panel configuration
    if (config.hasOwnProperty('solarPanels') && config.solarPanels) {
        SOLAR_PANEL_KEYS.forEach(key => {
            if (config.solarPanels.hasOwnProperty(key) && config.solarPanels[key] !== undefined) {
                state.solarPanels[key] = config.solarPanels[key];

function getConfigSnapshot(includeMetadata = false) {
    // V30 Config Format: Cleaner structure with grouped properties
    const config = {
        // Structure parameters
        structure: {
            modules: state.modules,
            beamLengths: {
                horizontal: state.hLengthFt,
                vertical: state.vLengthFt
            },
            pivotPercent: state.pivotPct,
            stackCounts: {
                horizontal: state.hStackCount,
                vertical: state.vStackCount
            },
            beamDimensions: {
                horizontalWidth: state.hBeamW,
                horizontalThickness: state.hBeamT,
                verticalWidth: state.vBeamW,
                verticalThickness: state.vBeamT
            },
            offsets: {
                top: state.offsetTopIn,
                bottom: state.offsetBotIn,
                vertEnd: state.vertEndOffset,
                bracket: state.bracketOffset,
                stackGap: state.stackGap
            },
            hobermanAngle: state.hobermanAng,
            pivotAngle: state.pivotAng,
            vStackReverse: state.vStackReverse
        },
        
        // Mode configuration
        mode: {
            type: state.orientation === 'vertical' ? 'arch' : 'cylinder',
            flipVertical: state.archFlipVertical,
            rotation: state.archRotation,
            useFixedBeams: state.useFixedBeams,
            capUprights: state.archCapUprights,
            arrayCount: state.arrayCount
        },
        
        // Fold angle in degrees
        foldAngle: radToDeg(state.foldAngle),
        animationStopAngle: state.animation.stopAngle,
        
        // Solar panel configuration
        panels: {
            enabled: state.solarPanels.enabled,
            topPanels: {
                enabled: state.solarPanels.topPanels.enabled,
                size: {
                    width: state.solarPanels.topPanels.panelWidth,
                    length: state.solarPanels.topPanels.panelLength,
                    thickness: state.solarPanels.topPanels.panelThickness
                },
                electrical: {
                    ratedWatts: state.solarPanels.topPanels.ratedWatts,
                    voc: state.solarPanels.topPanels.voc,
                    vmp: state.solarPanels.topPanels.vmp,
                    isc: state.solarPanels.topPanels.isc,
                    imp: state.solarPanels.topPanels.imp
                },
                padding: {
                    x: state.solarPanels.topPanels.paddingX,
                    y: state.solarPanels.topPanels.paddingY
                },
                grid: {
                    rows: state.solarPanels.topPanels.gridRows,
                    cols: state.solarPanels.topPanels.gridCols
                },
                lift: state.solarPanels.topPanels.panelLift
            },
            sidePanels: {
                enabled: state.solarPanels.sidePanels.enabled,
                size: {
                    width: state.solarPanels.sidePanels.panelWidth,
                    length: state.solarPanels.sidePanels.panelLength,
                    thickness: state.solarPanels.sidePanels.panelThickness
                },
                electrical: {
                    ratedWatts: state.solarPanels.sidePanels.ratedWatts,
                    voc: state.solarPanels.sidePanels.voc,
                    vmp: state.solarPanels.sidePanels.vmp,
                    isc: state.solarPanels.sidePanels.isc,
                    imp: state.solarPanels.sidePanels.imp
                },
                padding: {
                    x: state.solarPanels.sidePanels.paddingX,
                    y: state.solarPanels.sidePanels.paddingY
                },
                grid: {
                    rows: state.solarPanels.sidePanels.gridRows,
                    cols: state.solarPanels.sidePanels.gridCols
                }
            },
            layoutMode: state.solarPanels.layoutMode,
            gridRotation: state.solarPanels.gridRotation,
            positioning: {
                lift: state.solarPanels.archPanelOffset,
                slide: state.solarPanels.archPanelSlide,
                separation: state.solarPanels.archPanelSeparation
            },
            radial: {
                count: state.solarPanels.radialCount,
                offset: state.solarPanels.radialOffset,
                rotation: state.solarPanels.radialRotation,
                lateralOffset: state.solarPanels.radialLateralOffset,
                pinwheelAngle: state.solarPanels.pinwheelAngle
            },
            spiral: {
                armCount: state.solarPanels.spiralArmCount,
                secondaryEnabled: state.solarPanels.spiralSecondaryEnabled,
                secondaryRadialOffset: state.solarPanels.spiralSecondaryRadialOffset,
                secondaryLateralOffset: state.solarPanels.spiralSecondaryLateralOffset,
                secondaryPinwheel: state.solarPanels.spiralSecondaryPinwheel,
                secondaryRotation: state.solarPanels.spiralSecondaryRotation,
                armRadialStep: state.solarPanels.spiralArmRadialStep,
                armLateralStep: state.solarPanels.spiralArmLateralStep,
                armPinwheelStep: state.solarPanels.spiralArmPinwheelStep,
                armRotationStep: state.solarPanels.spiralArmRotationStep
            },
            support: {
                show: state.solarPanels.showSupportBeams,
                rotation: state.solarPanels.supportBeamRotation,
                length: state.solarPanels.supportBeamLength,
                foldAngle: state.solarPanels.supportBeamFoldAngle,
                offsetH: state.solarPanels.supportBeamOffsetH,
                offsetV: state.solarPanels.supportBeamOffsetV
            },
            enabledFaces: state.solarPanels.archWallFaces
        },
        
        // Costs (optional)
        costs: {
            hBeam: state.costHBeam,
            vBeam: state.costVBeam,
            bolt: state.costBolt,
            bracket: state.costBracket,
            solarPanel: state.costSolarPanel
        }
    };
    
    if (includeMetadata) {
        config.version = 'v30';
        config.timestamp = new Date().toISOString();
        
        // Include 3D geometry snapshot for debugging panel/beam positions
        try {
            const data = solveLinkage(state.foldAngle);
            if (state.solarPanels.enabled) {
                const solarData = calculateSolarPanels(data);
                data.panels = solarData.panels;
            }
            
            // Extract essential geometry data for debugging
            config.geometrySnapshot = {
                // Key config parameters for debugging
                debugConfig: {
                    foldAngle: state.foldAngle ? +radToDeg(state.foldAngle).toFixed(1) : null,
                    archPanelSlide: state.solarPanels.archPanelSlide,
                    archPanelSeparation: state.solarPanels.archPanelSeparation,
                    archPanelOffset: state.solarPanels.archPanelOffset,
                    useFixedBeams: state.useFixedBeams,
                    archCapUprights: state.archCapUprights
                },
                // Horizontal beam positions (first and last module for reference)
                horizontalBeams: data.beams.filter(b => b.stackType && b.stackType.startsWith('horizontal')).slice(0, 4).map(b => ({
                    type: b.stackType,
                    center: {x: +b.center.x.toFixed(2), y: +b.center.y.toFixed(2), z: +b.center.z.toFixed(2)},
                    axisZ: b.axisZ ? {x: +b.axisZ.x.toFixed(3), y: +b.axisZ.y.toFixed(3), z: +b.axisZ.z.toFixed(3)} : null
                })),
                // Panel positions and orientations
                panels: data.panels ? data.panels.slice(0, 8).map((p, i) => ({
                    index: i,
                    center: {x: +p.center.x.toFixed(2), y: +p.center.y.toFixed(2), z: +p.center.z.toFixed(2)},
                    normal: p.axisY ? {x: +p.axisY.x.toFixed(3), y: +p.axisY.y.toFixed(3), z: +p.axisY.z.toFixed(3)} : null,
                    axisX: p.axisX ? {x: +p.axisX.x.toFixed(3), y: +p.axisX.y.toFixed(3), z: +p.axisX.z.toFixed(3)} : null
                })) : [],
                // Structure bounds
                maxRadius: +data.maxRad.toFixed(2),
                maxHeight: +data.maxHeight.toFixed(2),
                // Fixed beam info if enabled
                fixedBeams: state.useFixedBeams ? data.beams.filter(b => b.stackType === 'fixed').map(b => ({
                    type: b.stackType,
                    center: {x: +b.center.x.toFixed(2), y: +b.center.y.toFixed(2), z: +b.center.z.toFixed(2)},
                    length: b.corners ? +vMag(vSub(b.corners[0], b.corners[4])).toFixed(2) : 0
                })) : null
            };
        } catch (e) {
            config.geometrySnapshot = { error: e.message };
        }
    }
    
    return config;
}

function applyConfig(config, updateUI = true) {
    if (!config) return;
    
    // Detect config version
    const isV30 = config.version === 'v30' || config.structure !== undefined;
    
    if (isV30) {
        // V30 Format: New structured config
        applyV30Config(config);
    } else {
        // V29 or earlier: Legacy flat config
        applyLegacyConfig(config);
    }
    
    // Handle fold angle conversion from degrees to radians
    if (config.hasOwnProperty('foldAngle')) {
        state.foldAngle = degToRad(config.foldAngle);
    
    // Load animation stop angle (or default to closed angle)
    if (config.hasOwnProperty('animationStopAngle') && config.animationStopAngle !== null) {
        state.animation.stopAngle = config.animationStopAngle;
        // Default to closed angle
        const closedAngle = getOptimalClosedAngleForAnimation();
        state.animation.stopAngle = radToDeg(closedAngle);
    
    // Invalidate geometry cache
    invalidateGeometryCache();
    
    if (updateUI) {
        Object.keys(idMap).forEach(k => syncUI(idMap[k]));
        // Sync checkbox states
        const vstackReverseChk = document.getElementById('chk-vstack-reverse');
        if (vstackReverseChk) vstackReverseChk.checked = state.vStackReverse;
        // Sync orientation dropdown
        const orientationSel = document.getElementById('sel-orientation');
        if (orientationSel) orientationSel.value = state.orientation || 'horizontal';
        // Sync cap uprights checkbox and visibility
        const capUprightsChk = document.getElementById('chk-cap-uprights');
        if (capUprightsChk) capUprightsChk.checked = state.archCapUprights || false;
        const capUprightsRow = document.getElementById('cap-upright-row');
        if (capUprightsRow) capUprightsRow.style.display = state.orientation === 'vertical' ? 'flex' : 'none';
        
        // Sync fixed beams checkbox
        const fixedBeamsChk = document.getElementById('chk-fixed-beams');
        if (fixedBeamsChk) fixedBeamsChk.checked = state.useFixedBeams || false;
        // Sync arch orientation controls
        const isVertical = state.orientation === 'vertical';
        const archOrientGroup = document.getElementById('arch-orientation-group');
        if (archOrientGroup) archOrientGroup.style.display = isVertical ? 'block' : 'none';
        const archFlipChk = document.getElementById('chk-arch-flip');
        if (archFlipChk) archFlipChk.checked = state.archFlipVertical || false;
        const archRotSlider = document.getElementById('sl-arch-rotation');
        const archRotNumber = document.getElementById('nb-arch-rotation');
        if (archRotSlider) archRotSlider.value = state.archRotation || 0;
        if (archRotNumber) archRotNumber.value = state.archRotation || 0;
        const arrayCountSlider = document.getElementById('sl-array-count');
        const arrayCountNumber = document.getElementById('nb-array-count');
        if (arrayCountSlider) arrayCountSlider.value = state.arrayCount || 1;
        if (arrayCountNumber) arrayCountNumber.value = state.arrayCount || 1;
        // Sync animation stop angle
        const stopAngleSlider = document.getElementById('sl-anim-stop');
        const stopAngleNumber = document.getElementById('nb-anim-stop');
        if (stopAngleSlider) {
            const stopAngle = state.animation.stopAngle !== null ? state.animation.stopAngle : radToDeg(getOptimalClosedAngleForAnimation());
            stopAngleSlider.value = stopAngle;
        if (stopAngleNumber) {
            const stopAngle = state.animation.stopAngle !== null ? state.animation.stopAngle : radToDeg(getOptimalClosedAngleForAnimation());
            stopAngleNumber.value = stopAngle;
        
        // Sync solar panel controls
        const sp = state.solarPanels;
        const chkSolarPanels = document.getElementById('chk-solar-panels');
        if (chkSolarPanels) chkSolarPanels.checked = sp.enabled;
        // Solar panel controls are always visible now
        
        // ===== TOP PANEL CONTROLS =====
        const topCfg = sp.topPanels;
        // Dimensions
        const slPanelLengthTop = document.getElementById('sl-panel-length-top');
        const nbPanelLengthTop = document.getElementById('nb-panel-length-top');
        if (slPanelLengthTop) slPanelLengthTop.value = topCfg.panelLength;
        if (nbPanelLengthTop) nbPanelLengthTop.value = topCfg.panelLength;
        
        const slPanelWidthTop = document.getElementById('sl-panel-width-top');
        const nbPanelWidthTop = document.getElementById('nb-panel-width-top');
        if (slPanelWidthTop) slPanelWidthTop.value = topCfg.panelWidth;
        if (nbPanelWidthTop) nbPanelWidthTop.value = topCfg.panelWidth;
        
        const slPanelThickTop = document.getElementById('sl-panel-thick-top');
        const nbPanelThickTop = document.getElementById('nb-panel-thick-top');
        if (slPanelThickTop) slPanelThickTop.value = topCfg.panelThickness;
        if (nbPanelThickTop) nbPanelThickTop.value = topCfg.panelThickness;
        
        // Electrical
        const slPanelWattsTop = document.getElementById('sl-panel-watts-top');
        const nbPanelWattsTop = document.getElementById('nb-panel-watts-top');
        if (slPanelWattsTop) slPanelWattsTop.value = Math.min(800, topCfg.ratedWatts || 400);
        if (nbPanelWattsTop) nbPanelWattsTop.value = topCfg.ratedWatts || 400;
        
        const nbVocTop = document.getElementById('nb-panel-voc-top');
        const nbVmpTop = document.getElementById('nb-panel-vmp-top');
        const nbIscTop = document.getElementById('nb-panel-isc-top');
        const nbImpTop = document.getElementById('nb-panel-imp-top');
        if (nbVocTop) nbVocTop.value = topCfg.voc || 49.5;
        if (nbVmpTop) nbVmpTop.value = topCfg.vmp || 41.5;
        if (nbIscTop) nbIscTop.value = topCfg.isc || 10.2;
        if (nbImpTop) nbImpTop.value = topCfg.imp || 9.65;
        
        // ===== SIDE PANEL CONTROLS =====
        const sideCfg = sp.sidePanels;
        // Dimensions
        const slPanelLengthSide = document.getElementById('sl-panel-length-side');
        const nbPanelLengthSide = document.getElementById('nb-panel-length-side');
        if (slPanelLengthSide) slPanelLengthSide.value = sideCfg.panelLength;
        if (nbPanelLengthSide) nbPanelLengthSide.value = sideCfg.panelLength;
        
        const slPanelWidthSide = document.getElementById('sl-panel-width-side');
        const nbPanelWidthSide = document.getElementById('nb-panel-width-side');
        if (slPanelWidthSide) slPanelWidthSide.value = sideCfg.panelWidth;
        if (nbPanelWidthSide) nbPanelWidthSide.value = sideCfg.panelWidth;
        
        const slPanelThickSide = document.getElementById('sl-panel-thick-side');
        const nbPanelThickSide = document.getElementById('nb-panel-thick-side');
        if (slPanelThickSide) slPanelThickSide.value = sideCfg.panelThickness;
        if (nbPanelThickSide) nbPanelThickSide.value = sideCfg.panelThickness;
        
        // Electrical
        const slPanelWattsSide = document.getElementById('sl-panel-watts-side');
        const nbPanelWattsSide = document.getElementById('nb-panel-watts-side');
        if (slPanelWattsSide) slPanelWattsSide.value = Math.min(800, sideCfg.ratedWatts || 400);
        if (nbPanelWattsSide) nbPanelWattsSide.value = sideCfg.ratedWatts || 400;
        
        const nbVocSide = document.getElementById('nb-panel-voc-side');
        const nbVmpSide = document.getElementById('nb-panel-vmp-side');
        const nbIscSide = document.getElementById('nb-panel-isc-side');
        const nbImpSide = document.getElementById('nb-panel-imp-side');
        if (nbVocSide) nbVocSide.value = sideCfg.voc || 49.5;
        if (nbVmpSide) nbVmpSide.value = sideCfg.vmp || 41.5;
        if (nbIscSide) nbIscSide.value = sideCfg.isc || 10.2;
        if (nbImpSide) nbImpSide.value = sideCfg.imp || 9.65;
        
        // Layout mode
        const selPanelLayout = document.getElementById('sel-panel-layout');
        if (selPanelLayout) selPanelLayout.value = sp.layoutMode;
        const rectControls = document.getElementById('rect-mode-controls');
        const radialControls = document.getElementById('radial-mode-controls');
        const spiralControls = document.getElementById('spiral-mode-controls');
        if (rectControls) rectControls.style.display = sp.layoutMode === 'rectangular' ? 'block' : 'none';
        if (radialControls) radialControls.style.display = sp.layoutMode === 'radial' ? 'block' : 'none';
        if (spiralControls) spiralControls.style.display = sp.layoutMode === 'spiral' ? 'block' : 'none';
        
        // Cylinder mode panel options
        const chkSideWallPanels = document.getElementById('chk-side-wall-panels');
        if (chkSideWallPanels) chkSideWallPanels.checked = sp.sidePanels.enabled || false;
        const chkTopPanels = document.getElementById('chk-top-panels');
        if (chkTopPanels) chkTopPanels.checked = sp.topPanels.enabled !== false;  // Default to true
        
        // Side/Arch panel grid
        const nbGridRows = document.getElementById('nb-grid-rows');
        if (nbGridRows) nbGridRows.value = sp.sidePanels.gridRows;
        const nbGridCols = document.getElementById('nb-grid-cols');
        if (nbGridCols) nbGridCols.value = sp.sidePanels.gridCols;
        
        // Top panel grid (cylinder mode)
        const nbTopPanelRows = document.getElementById('nb-top-panel-rows');
        if (nbTopPanelRows) nbTopPanelRows.value = sp.topPanels.gridRows || 2;
        const nbTopPanelCols = document.getElementById('nb-top-panel-cols');
        if (nbTopPanelCols) nbTopPanelCols.value = sp.topPanels.gridCols || 2;
        
        const slGridRotation = document.getElementById('sl-grid-rotation');
        const nbGridRotation = document.getElementById('nb-grid-rotation');
        if (slGridRotation) slGridRotation.value = sp.gridRotation || 0;
        if (nbGridRotation) nbGridRotation.value = sp.gridRotation || 0;
        
        // Radial mode
        const slRadialCount = document.getElementById('sl-radial-count');
        const nbRadialCount = document.getElementById('nb-radial-count');
        if (slRadialCount) slRadialCount.value = sp.radialCount;
        if (nbRadialCount) nbRadialCount.value = sp.radialCount;
        const slRadialOffset = document.getElementById('sl-radial-offset');
        const nbRadialOffset = document.getElementById('nb-radial-offset');
        if (slRadialOffset) slRadialOffset.value = sp.radialOffset;
        if (nbRadialOffset) nbRadialOffset.value = sp.radialOffset;
        const slRadialRotation = document.getElementById('sl-radial-rotation');
        const nbRadialRotation = document.getElementById('nb-radial-rotation');
        if (slRadialRotation) slRadialRotation.value = sp.radialRotation || 0;
        if (nbRadialRotation) nbRadialRotation.value = sp.radialRotation || 0;
        const slRadialLateral = document.getElementById('sl-radial-lateral');
        const nbRadialLateral = document.getElementById('nb-radial-lateral');
        if (slRadialLateral) slRadialLateral.value = sp.radialLateralOffset || 0;
        if (nbRadialLateral) nbRadialLateral.value = sp.radialLateralOffset || 0;
        const slPinwheelAngle = document.getElementById('sl-pinwheel-angle');
        const nbPinwheelAngle = document.getElementById('nb-pinwheel-angle');
        if (slPinwheelAngle) slPinwheelAngle.value = sp.pinwheelAngle;
        if (nbPinwheelAngle) nbPinwheelAngle.value = sp.pinwheelAngle;
        
        // Spiral (dual-panel arms)
        const slSpiralArmCount = document.getElementById('sl-spiral-arm-count');
        const nbSpiralArmCount = document.getElementById('nb-spiral-arm-count');
        if (slSpiralArmCount) slSpiralArmCount.value = sp.spiralArmCount ?? 2;
        if (nbSpiralArmCount) nbSpiralArmCount.value = sp.spiralArmCount ?? 2;
        const chkSpiralSecondary = document.getElementById('chk-spiral-secondary');
        if (chkSpiralSecondary) chkSpiralSecondary.checked = sp.spiralSecondaryEnabled !== false;
        const slSpiralRadial = document.getElementById('sl-spiral-secondary-radial');
        const nbSpiralRadial = document.getElementById('nb-spiral-secondary-radial');
        if (slSpiralRadial) slSpiralRadial.value = sp.spiralSecondaryRadialOffset ?? 24;
        if (nbSpiralRadial) nbSpiralRadial.value = sp.spiralSecondaryRadialOffset ?? 24;
        const slSpiralLateral = document.getElementById('sl-spiral-secondary-lateral');
        const nbSpiralLateral = document.getElementById('nb-spiral-secondary-lateral');
        if (slSpiralLateral) slSpiralLateral.value = sp.spiralSecondaryLateralOffset ?? 0;
        if (nbSpiralLateral) nbSpiralLateral.value = sp.spiralSecondaryLateralOffset ?? 0;
        const slSpiralPinwheel = document.getElementById('sl-spiral-secondary-pinwheel');
        const nbSpiralPinwheel = document.getElementById('nb-spiral-secondary-pinwheel');
        if (slSpiralPinwheel) slSpiralPinwheel.value = sp.spiralSecondaryPinwheel ?? 0;
        if (nbSpiralPinwheel) nbSpiralPinwheel.value = sp.spiralSecondaryPinwheel ?? 0;
        const slSpiralRotation = document.getElementById('sl-spiral-secondary-rotation');
        const nbSpiralRotation = document.getElementById('nb-spiral-secondary-rotation');
        if (slSpiralRotation) slSpiralRotation.value = sp.spiralSecondaryRotation ?? 0;
        if (nbSpiralRotation) nbSpiralRotation.value = sp.spiralSecondaryRotation ?? 0;
        const slSpiralRadialStep = document.getElementById('sl-spiral-arm-radial-step');
        const nbSpiralRadialStep = document.getElementById('nb-spiral-arm-radial-step');
        if (slSpiralRadialStep) slSpiralRadialStep.value = sp.spiralArmRadialStep ?? 0;
        if (nbSpiralRadialStep) nbSpiralRadialStep.value = sp.spiralArmRadialStep ?? 0;
        const slSpiralLateralStep = document.getElementById('sl-spiral-arm-lateral-step');
        const nbSpiralLateralStep = document.getElementById('nb-spiral-arm-lateral-step');
        if (slSpiralLateralStep) slSpiralLateralStep.value = sp.spiralArmLateralStep ?? 0;
        if (nbSpiralLateralStep) nbSpiralLateralStep.value = sp.spiralArmLateralStep ?? 0;
        const slSpiralPinwheelStep = document.getElementById('sl-spiral-arm-pinwheel-step');
        const nbSpiralPinwheelStep = document.getElementById('nb-spiral-arm-pinwheel-step');
        if (slSpiralPinwheelStep) slSpiralPinwheelStep.value = sp.spiralArmPinwheelStep ?? 0;
        if (nbSpiralPinwheelStep) nbSpiralPinwheelStep.value = sp.spiralArmPinwheelStep ?? 0;
        const slSpiralRotationStep = document.getElementById('sl-spiral-arm-rotation-step');
        const nbSpiralRotationStep = document.getElementById('nb-spiral-arm-rotation-step');
        if (slSpiralRotationStep) slSpiralRotationStep.value = sp.spiralArmRotationStep ?? 0;
        if (nbSpiralRotationStep) nbSpiralRotationStep.value = sp.spiralArmRotationStep ?? 0;
        
        // Top panel padding
        const nbPaddingXTop = document.getElementById('nb-padding-x-top');
        const nbPaddingYTop = document.getElementById('nb-padding-y-top');
        if (nbPaddingXTop) nbPaddingXTop.value = (topCfg.paddingX ?? 2);
        if (nbPaddingYTop) nbPaddingYTop.value = (topCfg.paddingY ?? 2);
        
        // Side panel padding
        const nbPaddingXSide = document.getElementById('nb-padding-x-side');
        const nbPaddingYSide = document.getElementById('nb-padding-y-side');
        if (nbPaddingXSide) nbPaddingXSide.value = (sideCfg.paddingX ?? 2);
        if (nbPaddingYSide) nbPaddingYSide.value = (sideCfg.paddingY ?? 2);
        
        // Support beams
        const chkSupportBeams = document.getElementById('chk-support-beams');
        if (chkSupportBeams) chkSupportBeams.checked = sp.showSupportBeams;
        const supportBeamControls = document.getElementById('support-beam-controls');
        if (supportBeamControls) supportBeamControls.style.display = sp.showSupportBeams ? 'block' : 'none';
        
        const slSupportLength = document.getElementById('sl-support-length');
        const nbSupportLength = document.getElementById('nb-support-length');
        if (slSupportLength) slSupportLength.value = Math.min(240, sp.supportBeamLength || 96);
        if (nbSupportLength) nbSupportLength.value = sp.supportBeamLength || 96;
        
        const slSupportFold = document.getElementById('sl-support-fold');
        const nbSupportFold = document.getElementById('nb-support-fold');
        if (slSupportFold) slSupportFold.value = sp.supportBeamFoldAngle || 0;
        if (nbSupportFold) nbSupportFold.value = sp.supportBeamFoldAngle || 0;
        
        const slSupportRotation = document.getElementById('sl-support-rotation');
        const nbSupportRotation = document.getElementById('nb-support-rotation');
        if (slSupportRotation) slSupportRotation.value = Math.max(-45, Math.min(45, sp.supportBeamRotation || 0));
        if (nbSupportRotation) nbSupportRotation.value = sp.supportBeamRotation || 0;
        
        const slSupportOffsetH = document.getElementById('sl-support-offset-h');
        const nbSupportOffsetH = document.getElementById('nb-support-offset-h');
        if (slSupportOffsetH) slSupportOffsetH.value = Math.max(-120, Math.min(120, sp.supportBeamOffsetH || -120));
        if (nbSupportOffsetH) nbSupportOffsetH.value = sp.supportBeamOffsetH || -120;
        
        const slSupportOffsetV = document.getElementById('sl-support-offset-v');
        const nbSupportOffsetV = document.getElementById('nb-support-offset-v');
        if (slSupportOffsetV) slSupportOffsetV.value = sp.supportBeamOffsetV || 0;
        if (nbSupportOffsetV) nbSupportOffsetV.value = sp.supportBeamOffsetV || 0;
        
        // Panel lift (top panels)
        const slPanelLift = document.getElementById('sl-panel-lift');
        const nbPanelLift = document.getElementById('nb-panel-lift');
        if (slPanelLift) slPanelLift.value = Math.min(48, topCfg.panelLift || 0);
        if (nbPanelLift) nbPanelLift.value = topCfg.panelLift || 0;
        
        // Arch mode panel positioning (simplified: Lift and Slide)
        const slArchPanelOffset = document.getElementById('sl-arch-panel-offset');
        const nbArchPanelOffset = document.getElementById('nb-arch-panel-offset');
        if (slArchPanelOffset) slArchPanelOffset.value = sp.archPanelOffset ?? 2;
        if (nbArchPanelOffset) nbArchPanelOffset.value = sp.archPanelOffset ?? 2;
        
        const slArchPanelSlide = document.getElementById('sl-arch-panel-offset-y');
        const nbArchPanelSlide = document.getElementById('nb-arch-panel-offset-y');
        if (slArchPanelSlide) slArchPanelSlide.value = sp.archPanelSlide ?? 0.5;
        if (nbArchPanelSlide) nbArchPanelSlide.value = sp.archPanelSlide ?? 0.5;
        
        const slArchPanelSep = document.getElementById('sl-arch-panel-sep');
        const nbArchPanelSep = document.getElementById('nb-arch-panel-sep');
        if (slArchPanelSep) slArchPanelSep.value = sp.archPanelSeparation ?? 0;
        if (nbArchPanelSep) nbArchPanelSep.value = sp.archPanelSeparation ?? 0;
        
        // Update arch/side wall panel controls visibility
        updateArchWallFacesUI();
        
        requestRender();

function saveConfig() {
    const config = getConfigSnapshot();
    localStorage.setItem('linkageLab_config', JSON.stringify(config));
    showToast('Configuration saved', 'info');

function loadConfig() {
    const saved = localStorage.getItem('linkageLab_config');
    if (!saved) {
        showToast('No saved configuration found', 'error');
        return;
    
    try {
        const config = JSON.parse(saved);
        applyConfig(config);
        saveStateToHistory();
        showToast('Configuration loaded', 'info');
        showToast('Error loading configuration', 'error');

function getPresets() {
    const presets = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('linkageLab_preset_')) {
            try {
                const preset = JSON.parse(localStorage.getItem(key));
                presets.push({ name: preset.name, key: key });
    return presets;

function savePreset() {
    const name = prompt('Enter preset name:');
    if (!name) return;
    
    const sanitizedName = sanitize(name);
    const config = getConfigSnapshot();
    config.name = sanitizedName;
    
    localStorage.setItem(`linkageLab_preset_${sanitizedName}`, JSON.stringify(config));
    updatePresetSelect();
    showToast(`Preset "${sanitizedName}" saved`, 'info');

function loadPreset(name) {
    const preset = localStorage.getItem(`linkageLab_preset_${name}`);
    if (!preset) {
        showToast('Preset not found', 'error');
        return;
    
    try {
        const config = JSON.parse(preset);
        applyConfig(config);
        saveStateToHistory();
        showToast(`Preset "${config.name || name}" loaded`, 'info');
        showToast('Error loading preset', 'error');

function deletePreset() {
    const select = document.getElementById('preset-select');
    const name = select.value;
    if (!name) {
        showToast('No preset selected', 'error');
        return;
    
    if (confirm(`Delete preset "${name}"?`)) {
        localStorage.removeItem(`linkageLab_preset_${name}`);
        updatePresetSelect();
        showToast('Preset deleted', 'info');

function updatePresetSelect() {
    const select = document.getElementById('preset-select');
    const presets = getPresets();
    select.innerHTML = '<option value="">Select Preset...</option>';
    presets.forEach(p => {
        const option = document.createElement('option');
        option.value = p.key.replace('linkageLab_preset_', '');
        option.textContent = p.name;
        select.appendChild(option);

// ============================================================================
// ANIMATION SYSTEM
// ============================================================================

function updateAnimationStatus() {
    const statusEl = document.getElementById('anim-status');
    const statusTopEl = document.getElementById('anim-status-top');
    const directionEl = document.getElementById('anim-direction');
    
    const statusText = state.animation.playing ? 'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¶ Playing' : 'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ Stopped';
    const statusColor = state.animation.playing ? 'var(--clr-success)' : 'var(--text-muted)';
    const directionText = state.animation.direction > 0 ? 'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢' : 'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â';
    
    if (statusEl) {
        statusEl.textContent = state.animation.playing ? 'Playing' : 'Stopped';
        statusEl.style.color = statusColor;
    if (statusTopEl) {
        statusTopEl.textContent = statusText;
        statusTopEl.style.color = statusColor;
    if (directionEl) {
        directionEl.textContent = state.animation.direction > 0 ? 'Expanding' : 'Collapsing';

function getOptimalClosedAngleForAnimation() {
    // Cache the calculation as it's expensive
    if (state.animation.cachedClosedAngle !== undefined && 
        state.animation.cachedModules === state.modules &&
        state.animation.cachedPivotPct === state.pivotPct) {
        return state.animation.cachedClosedAngle;
    
    const targetRotation = Math.PI * 2; // 360 degrees
    const totalModules = state.modules;
    
    // Helper to calculate total rotation for a given fold angle
    const getTotalRotation = (foldAngle) => {
        const jointResult = calculateJointPositions(foldAngle, {
            hActiveIn: state.hLengthFt * INCHES_PER_FOOT - state.offsetTopIn - state.offsetBotIn,
            pivotPct: state.pivotPct,
            hobermanAng: state.hobermanAng,
            pivotAng: state.pivotAng
        });
        return Math.abs(jointResult.relativeRotation * totalModules);
    };
    
    // Search for the angle where rotation = 360ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°
    const stepSize = degToRad(1);
    let bestAngle = MAX_FOLD_ANGLE;
    let bestDiff = Infinity;
    
    for (let angle = MIN_FOLD_ANGLE; angle <= MAX_FOLD_ANGLE; angle += stepSize) {
        const rotation = getTotalRotation(angle);
        const diff = Math.abs(rotation - targetRotation);
        
        if (diff < bestDiff) {
            bestDiff = diff;
            bestAngle = angle;
        }
        
        // If we've passed 360ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â° and are getting worse, stop
        if (rotation > targetRotation && diff > bestDiff) {
            break;
        }
    }
    
    // Fine-tune with smaller steps around the best angle
    const fineStep = degToRad(0.1);
    for (let angle = bestAngle - degToRad(2); angle <= bestAngle + degToRad(2); angle += fineStep) {
        if (angle < MIN_FOLD_ANGLE || angle > MAX_FOLD_ANGLE) continue;
        const rotation = getTotalRotation(angle);
        const diff = Math.abs(rotation - targetRotation);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestAngle = angle;
        }
    }
    
    // Cache the result
    state.animation.cachedClosedAngle = bestAngle;
    state.animation.cachedModules = state.modules;
    state.animation.cachedPivotPct = state.pivotPct;
    
    return bestAngle;
}

function animateFold(timestamp) {
    if (!state.animation.playing) {
        updateAnimationStatus();
        return;
    }
    
    // Calculate delta time for smooth animation regardless of frame rate
    if (!state.animation.lastTime) {
        state.animation.lastTime = timestamp;
    }
    const deltaTime = timestamp - state.animation.lastTime;
    state.animation.lastTime = timestamp;
    
    // Min angle = fully unfolded, Max angle = stop angle or optimal closed
    const minAngle = degToRad(5);
    const closedAngle = getOptimalClosedAngleForAnimation();
    // Use stopAngle if set, otherwise use closed angle
    const stopAngleRad = state.animation.stopAngle !== null 
        ? degToRad(state.animation.stopAngle) 
        : closedAngle;
    const maxAngle = Math.min(stopAngleRad, closedAngle); // Don't exceed closed angle
    const speed = state.animation.speed;
    const direction = state.animation.direction;
    
    // Calculate step based on delta time (target ~60fps equivalent)
    // Full cycle should take about 3 seconds at speed 1.0
    const fullCycleMs = 3000 / speed;
    const angleRange = maxAngle - minAngle;
    const step = (angleRange / fullCycleMs) * deltaTime * direction;
    
    // Check if we're in a pause state
    if (state.animation.pauseUntil && timestamp < state.animation.pauseUntil) {
        // Still pausing, continue waiting
        state.animation.frameId = requestAnimationFrame(animateFold);
        return;
    }
    state.animation.pauseUntil = null; // Clear pause flag
    
    let currentAngle = state.foldAngle + step;
    let reachedEnd = false;
    let reachedClosed = false;
    
    // Check bounds - use stop angle as maximum
    if (direction > 0 && currentAngle >= maxAngle) {
        currentAngle = maxAngle;
        reachedEnd = true;
        reachedClosed = (maxAngle >= closedAngle - 0.01); // Reached fully closed if at closed angle
    } else if (direction < 0 && currentAngle <= minAngle) {
        currentAngle = minAngle;
        reachedEnd = true;
    }
    
    // Handle end of animation
    if (reachedEnd) {
        // Update angle first
        state.foldAngle = currentAngle;
        syncUI('foldAngle');
        requestRender();
        
        if (state.animation.pingPong || state.animation.loop) {
            // Pause for 1 second at fully closed position before continuing
            if (reachedClosed) {
                state.animation.pauseUntil = timestamp + 1000; // 1 second pause
            }
            
            if (state.animation.pingPong) {
                // Reverse direction for ping-pong mode
                state.animation.direction *= -1;
                updateAnimationStatus();
            } else {
                // Reset to beginning for loop mode
                state.foldAngle = direction > 0 ? minAngle : maxAngle;
                syncUI('foldAngle');
                requestRender();
            }
            
            // Continue animation (will pause if pauseUntil is set)
            state.animation.frameId = requestAnimationFrame(animateFold);
            return;
        } else {
            // Stop animation
            state.animation.playing = false;
            updateAnimationStatus();
            return;
        }
    }
    
    state.foldAngle = clamp(currentAngle, minAngle, maxAngle);
    syncUI('foldAngle');
    requestRender();
    
    // Continue animation
    if (state.animation.playing) {
        state.animation.frameId = requestAnimationFrame(animateFold);
    }
}

// ============================================================================
// MEASUREMENT TOOLS
// ============================================================================

function calculateMeasurements(data) {
    if (!data || !data.beams || data.beams.length === 0) {
        return { innerDia: 0, outerDia: 0, height: 0, span: 0, innerPoints: null, outerPoints: null };
    
    const hBeams = data.beams.filter(b => b.stackType && b.stackType.startsWith('horizontal'));
    
    // Find inner pivots (smallest radius) and outer pivots (largest radius)
    let minRad = Infinity, maxRad = -Infinity;
    let innerPoint1 = null, innerPoint2 = null;
    let outerPoint1 = null, outerPoint2 = null;
    let minY = Infinity, maxY = -Infinity;
    let minX = Infinity, maxX = -Infinity;
    
    // Collect all pivot points from horizontal beams
    const pivotPoints = [];
    hBeams.forEach(beam => {
        if (beam.p1) pivotPoints.push({...beam.p1, moduleIndex: beam.moduleIndex});
        if (beam.p2) pivotPoints.push({...beam.p2, moduleIndex: beam.moduleIndex});
    
    // Also check corners for more accurate measurements
    data.beams.forEach(beam => {
        if (beam.corners) {
            beam.corners.forEach(c => {
                if (c) {
                    if (c.y < minY) minY = c.y;
                    if (c.y > maxY) maxY = c.y;
                    if (c.x < minX) minX = c.x;
                    if (c.x > maxX) maxX = c.x;
    
    // For each pivot point, calculate radius from center
    pivotPoints.forEach(p => {
        const rad = Math.sqrt(p.x * p.x + (p.z || 0) * (p.z || 0));
        
        // Track inner (smallest radius) points
        if (rad < minRad) {
            minRad = rad;
            innerPoint1 = p;
        
        // Track outer (largest radius) points  
        if (rad > maxRad) {
            maxRad = rad;
            outerPoint1 = p;
    
    // Find the point on the opposite side for inner diameter (opposite X sign)
    if (innerPoint1) {
        let bestDist = -Infinity;
        pivotPoints.forEach(p => {
            // Must be on opposite side (different X sign or far apart)
            const dist = Math.sqrt(Math.pow(p.x - innerPoint1.x, 2) + Math.pow((p.z || 0) - (innerPoint1.z || 0), 2));
            if (dist > bestDist && p !== innerPoint1) {
                const rad = Math.sqrt(p.x * p.x + (p.z || 0) * (p.z || 0));
                // Only consider inner points (within 20% of min radius)
                if (rad < minRad * 1.2) {
                    bestDist = dist;
                    innerPoint2 = p;
    
    // Find the point on the opposite side for outer diameter
    if (outerPoint1) {
        let bestDist = -Infinity;
        pivotPoints.forEach(p => {
            const dist = Math.sqrt(Math.pow(p.x - outerPoint1.x, 2) + Math.pow((p.z || 0) - (outerPoint1.z || 0), 2));
            if (dist > bestDist && p !== outerPoint1) {
                const rad = Math.sqrt(p.x * p.x + (p.z || 0) * (p.z || 0));
                // Only consider outer points (within 20% of max radius)
                if (rad > maxRad * 0.8) {
                    bestDist = dist;
                    outerPoint2 = p;
    
    // Calculate measurements
    let innerDia = 0, outerDia = 0;
    
    if (innerPoint1 && innerPoint2) {
        innerDia = Math.sqrt(
            Math.pow(innerPoint2.x - innerPoint1.x, 2) +
            Math.pow((innerPoint2.y || 0) - (innerPoint1.y || 0), 2) +
            Math.pow((innerPoint2.z || 0) - (innerPoint1.z || 0), 2)
        );
    
    if (outerPoint1 && outerPoint2) {
        outerDia = Math.sqrt(
            Math.pow(outerPoint2.x - outerPoint1.x, 2) +
            Math.pow((outerPoint2.y || 0) - (outerPoint1.y || 0), 2) +
            Math.pow((outerPoint2.z || 0) - (outerPoint1.z || 0), 2)
        );
    
    const height = maxY - minY;
    const span = maxX - minX;
    
    return {
        innerDia,
        outerDia,
        height,
        span,
        innerPoints: innerPoint1 && innerPoint2 ? [innerPoint1, innerPoint2] : null,
        outerPoints: outerPoint1 && outerPoint2 ? [outerPoint1, outerPoint2] : null,
        heightPoints: [{x: 0, y: minY, z: 0}, {x: 0, y: maxY, z: 0}],
        spanPoints: [{x: minX, y: minY, z: 0}, {x: maxX, y: minY, z: 0}]
    };
}

function drawMeasurements(ctx, data) {
    const measurements = calculateMeasurements(data);
    
    // Update sidebar display
    const innerEl = document.getElementById('meas-inner-dia');
    const outerEl = document.getElementById('meas-outer-dia');
    const heightEl = document.getElementById('meas-height');
    const spanEl = document.getElementById('meas-span');
    
    if (innerEl) innerEl.textContent = `${formatNumber(measurements.innerDia / INCHES_PER_FOOT, 2)}' (${formatNumber(measurements.innerDia, 1)}")`;
    if (outerEl) outerEl.textContent = `${formatNumber(measurements.outerDia / INCHES_PER_FOOT, 2)}' (${formatNumber(measurements.outerDia, 1)}")`;
    if (heightEl) heightEl.textContent = `${formatNumber(measurements.height / INCHES_PER_FOOT, 2)}' (${formatNumber(measurements.height, 1)}")`;
    if (spanEl) spanEl.textContent = `${formatNumber(measurements.span / INCHES_PER_FOOT, 2)}' (${formatNumber(measurements.span, 1)}")`;
    
    // Calculate structure center (must match main render)
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    data.beams.forEach(beam => {
        beam.corners.forEach(c => {
            minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
            minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
            minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
    const sc = {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        z: (minZ + maxZ) / 2
    
    // Project 3D point to 2D screen coordinates (must match main renderer exactly)
    const project = (v) => {
        const cam = state.cam;
        const yawRad = cam.yaw;
        const pitchRad = cam.pitch;
        // Offset by structure center
        let x = (v.x || 0) - sc.x, y = (v.y || 0) - sc.y, z = (v.z || 0) - sc.z;
        
        // Rotate around Y axis (yaw)
        let x1 = x * Math.cos(-yawRad) - z * Math.sin(-yawRad);
        let z1 = x * Math.sin(-yawRad) + z * Math.cos(-yawRad);
        // Apply panX after yaw rotation
        x1 -= cam.panX;
        
        // Rotate around X axis (pitch)
        let y2 = y * Math.cos(pitchRad) - z1 * Math.sin(pitchRad);
        let z2 = y * Math.sin(pitchRad) + z1 * Math.cos(pitchRad);
        // Apply panY after pitch rotation
        y2 += cam.panY;
        
        // Perspective projection
        let depth = z2 + cam.dist;
        if (depth < MIN_CAM_DIST) depth = MIN_CAM_DIST;
        let scale = PERSPECTIVE_SCALE / depth;
        
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        return { x: cx + x1 * scale, y: cy - y2 * scale, depth };
    
    const drawMeasurementLine = (point1, point2, label, color, offset = 0) => {
        if (!point1 || !point2) return;
        
        const p1 = project(point1);
        const p2 = project(point2);
        
        // Draw dimension line
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        
        // Draw end markers
        const markerSize = 6;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, markerSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p2.x, p2.y, markerSize, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw label at midpoint
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2 + offset;
        
        // Background for readability
        ctx.font = 'bold 12px Arial';
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(21, 32, 43, 0.9)';
        ctx.fillRect(midX - textWidth / 2 - 6, midY - 14, textWidth + 12, 20);
        
        // Border
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(midX - textWidth / 2 - 6, midY - 14, textWidth + 12, 20);
        
        // Text
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, midX, midY - 4);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    
    // Draw inner diameter measurement (cyan)
    if (measurements.innerPoints) {
        const dist = measurements.innerDia;
        const label = `Inner: ${formatNumber(dist / INCHES_PER_FOOT, 1)}'`;
        drawMeasurementLine(measurements.innerPoints[0], measurements.innerPoints[1], label, '#00d2d3', -20);
    
    // Draw outer diameter measurement (orange)
    if (measurements.outerPoints) {
        const dist = measurements.outerDia;
        const label = `Outer: ${formatNumber(dist / INCHES_PER_FOOT, 1)}'`;
        drawMeasurementLine(measurements.outerPoints[0], measurements.outerPoints[1], label, '#f0ad4e', 20);
    
    // Draw height measurement (green) - vertical line on the side
    if (measurements.height > 0) {
        const heightPoint1 = {x: measurements.spanPoints[1].x + 10, y: measurements.heightPoints[0].y, z: 0};
        const heightPoint2 = {x: measurements.spanPoints[1].x + 10, y: measurements.heightPoints[1].y, z: 0};
        const label = `Height: ${formatNumber(measurements.height / INCHES_PER_FOOT, 1)}'`;
        drawMeasurementLine(heightPoint1, heightPoint2, label, '#2ecc71', 0);
    
    // Draw span measurement (purple) - horizontal line at bottom
    if (measurements.span > 0) {
        const spanPoint1 = {x: measurements.spanPoints[0].x, y: measurements.spanPoints[0].y - 10, z: 0};
        const spanPoint2 = {x: measurements.spanPoints[1].x, y: measurements.spanPoints[0].y - 10, z: 0};
        const label = `Span: ${formatNumber(measurements.span / INCHES_PER_FOOT, 1)}'`;
        drawMeasurementLine(spanPoint1, spanPoint2, label, '#9b59b6', 0);
    
    ctx.setLineDash([]);

function drawMeasurementsOverlay(data, structureCenter, w, h) {
    // Get or create the measurement overlay canvas
    let overlayCanvas = document.getElementById('measurement-overlay');
    const viewport = document.getElementById('viewport');
    if (!overlayCanvas && viewport) {
        overlayCanvas = document.createElement('canvas');
        overlayCanvas.id = 'measurement-overlay';
        overlayCanvas.style.position = 'absolute';
        overlayCanvas.style.top = '0';
        overlayCanvas.style.left = '0';
        overlayCanvas.style.pointerEvents = 'none';
        overlayCanvas.style.zIndex = '10';
        viewport.appendChild(overlayCanvas);
    
    if (!overlayCanvas) return;
    
    // Match canvas size
    overlayCanvas.width = w;
    overlayCanvas.height = h;
    overlayCanvas.style.width = w + 'px';
    overlayCanvas.style.height = h + 'px';
    
    const overlayCtx = overlayCanvas.getContext('2d');
    overlayCtx.clearRect(0, 0, w, h);
    
    // Use the existing drawMeasurements function but with the overlay context
    // We need to temporarily swap the ctx reference
    const originalCtx = ctx;
    const originalCanvas = canvas;
    
    // Create a temporary canvas reference that matches the overlay
    const tempCanvas = {
        width: w,
        height: h,
        clientWidth: w,
        clientHeight: h
    
    // Draw measurements using the projection logic
    const measurements = calculateMeasurements(data);
    
    // Update sidebar display
    const innerEl = document.getElementById('meas-inner-dia');
    const outerEl = document.getElementById('meas-outer-dia');
    const heightEl = document.getElementById('meas-height');
    const spanEl = document.getElementById('meas-span');
    
    if (innerEl) innerEl.textContent = `${formatNumber(measurements.innerDia / INCHES_PER_FOOT, 2)}' (${formatNumber(measurements.innerDia, 1)}")`;
    if (outerEl) outerEl.textContent = `${formatNumber(measurements.outerDia / INCHES_PER_FOOT, 2)}' (${formatNumber(measurements.outerDia, 1)}")`;
    if (heightEl) heightEl.textContent = `${formatNumber(measurements.height / INCHES_PER_FOOT, 2)}' (${formatNumber(measurements.height, 1)}")`;
    if (spanEl) spanEl.textContent = `${formatNumber(measurements.span / INCHES_PER_FOOT, 2)}' (${formatNumber(measurements.span, 1)}")`;
    
    const sc = structureCenter || { x: 0, y: 0, z: 0 };
    
    // Project function that matches Three.js camera
    const project = (v) => {
        const cam = state.cam;
        
        // Offset by structure center
        let x = (v.x || 0) - sc.x;
        let y = (v.y || 0) - sc.y;
        let z = (v.z || 0) - sc.z;
        
        // Rotate around Y axis (yaw)
        let x1 = x * Math.cos(-cam.yaw) - z * Math.sin(-cam.yaw);
        let z1 = x * Math.sin(-cam.yaw) + z * Math.cos(-cam.yaw);
        x1 -= cam.panX * 0.5;
        
        // Rotate around X axis (pitch)
        let y2 = y * Math.cos(cam.pitch) - z1 * Math.sin(cam.pitch);
        let z2 = y * Math.sin(cam.pitch) + z1 * Math.cos(cam.pitch);
        y2 += cam.panY * 0.5;
        
        // Perspective projection - match Three.js FOV
        let depth = z2 + cam.dist;
        if (depth < 1) depth = 1;
        const fov = 45 * Math.PI / 180;
        const scale = (h / 2) / Math.tan(fov / 2) / depth;
        
        return { 
            x: w / 2 + x1 * scale, 
            y: h / 2 - y2 * scale, 
            depth 
    
    // Draw measurement line helper
    const drawMeasurementLine = (point1, point2, label, color, offset = 0) => {
        if (!point1 || !point2) return;
        
        const p1 = project(point1);
        const p2 = project(point2);
        
        overlayCtx.strokeStyle = color;
        overlayCtx.lineWidth = 2;
        overlayCtx.setLineDash([]);
        overlayCtx.beginPath();
        overlayCtx.moveTo(p1.x, p1.y);
        overlayCtx.lineTo(p2.x, p2.y);
        overlayCtx.stroke();
        
        const markerSize = 6;
        overlayCtx.fillStyle = color;
        overlayCtx.beginPath();
        overlayCtx.arc(p1.x, p1.y, markerSize, 0, Math.PI * 2);
        overlayCtx.fill();
        overlayCtx.beginPath();
        overlayCtx.arc(p2.x, p2.y, markerSize, 0, Math.PI * 2);
        overlayCtx.fill();
        
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2 + offset;
        
        overlayCtx.font = 'bold 12px Arial';
        const textWidth = overlayCtx.measureText(label).width;
        overlayCtx.fillStyle = 'rgba(21, 32, 43, 0.9)';
        overlayCtx.fillRect(midX - textWidth / 2 - 6, midY - 14, textWidth + 12, 20);
        
        overlayCtx.strokeStyle = color;
        overlayCtx.lineWidth = 1;
        overlayCtx.strokeRect(midX - textWidth / 2 - 6, midY - 14, textWidth + 12, 20);
        
        overlayCtx.fillStyle = color;
        overlayCtx.textAlign = 'center';
        overlayCtx.textBaseline = 'middle';
        overlayCtx.fillText(label, midX, midY - 4);
        overlayCtx.textAlign = 'left';
        overlayCtx.textBaseline = 'alphabetic';
    
    // Draw measurements
    if (measurements.innerPoints) {
        const label = `Inner: ${formatNumber(measurements.innerDia / INCHES_PER_FOOT, 1)}'`;
        drawMeasurementLine(measurements.innerPoints[0], measurements.innerPoints[1], label, '#00d2d3', -20);
    
    if (measurements.outerPoints) {
        const label = `Outer: ${formatNumber(measurements.outerDia / INCHES_PER_FOOT, 1)}'`;
        drawMeasurementLine(measurements.outerPoints[0], measurements.outerPoints[1], label, '#f0ad4e', 20);
    
    if (measurements.height > 0 && measurements.spanPoints && measurements.heightPoints) {
        const heightPoint1 = {x: measurements.spanPoints[1].x + 10, y: measurements.heightPoints[0].y, z: 0};
        const heightPoint2 = {x: measurements.spanPoints[1].x + 10, y: measurements.heightPoints[1].y, z: 0};
        const label = `Height: ${formatNumber(measurements.height / INCHES_PER_FOOT, 1)}'`;
        drawMeasurementLine(heightPoint1, heightPoint2, label, '#2ecc71', 0);
    
    if (measurements.span > 0 && measurements.spanPoints) {
        const spanPoint1 = {x: measurements.spanPoints[0].x, y: measurements.spanPoints[0].y - 10, z: 0};
        const spanPoint2 = {x: measurements.spanPoints[1].x, y: measurements.spanPoints[0].y - 10, z: 0};
        const label = `Span: ${formatNumber(measurements.span / INCHES_PER_FOOT, 1)}'`;
        drawMeasurementLine(spanPoint1, spanPoint2, label, '#9b59b6', 0);

// ============================================================================
// UNDO/REDO SYSTEM
// ============================================================================

// Cache for performance optimization
let cachedLinkageData = null;
let cachedFoldAngle = null;
let cachedCollisions = null;
let cachedCollisionFoldAngle = null;
let cachedGeometryHash = null;

function computeGeometryHash() {
    const params = [
        state.modules,
        state.hLengthFt,
        state.vLengthFt,
        state.pivotPct,
        state.hobermanAng,
        state.pivotAng,
        state.hStackCount,
        state.vStackCount,
        state.vStackReverse,
        state.offsetTopIn,
        state.offsetBotIn,
        state.vertEndOffset,
        state.bracketOffset,
        state.stackGap,
        state.hBeamW,
        state.hBeamT,
        state.vBeamW,
        state.vBeamT,
        state.foldAngle.toFixed(6),
        state.orientation
    ];
    return params.join('|');

function isGeometryCacheValid() {
    if (!cachedLinkageData || !cachedGeometryHash) return false;
    return cachedGeometryHash === computeGeometryHash();

function invalidateGeometryCache() {
    cachedLinkageData = null;
    cachedGeometryHash = null;
    cachedCollisions = null;
    cachedCollisionFoldAngle = null;

function getLinkageData() {
    if (isGeometryCacheValid()) {
        return cachedLinkageData;
    
    cachedLinkageData = solveLinkage(state.foldAngle);
    cachedGeometryHash = computeGeometryHash();
    cachedFoldAngle = state.foldAngle;
    
    // Invalidate collision cache since geometry changed
    cachedCollisions = null;
    cachedCollisionFoldAngle = null;
    
    return cachedLinkageData;

const debouncedSaveHistory = debounce(() => {
    // Don't save history during active dragging
    if (drag.active) {
        return;
    
    try {
        // Create a shallow copy first, excluding problematic properties
        const stateToSerialize = {};
        for (const key of Object.keys(state)) {
            // Skip non-serializable and large properties
            if (['light', 'cam', 'view', 'animation', 'measurePoints', 'collisions', 'history', 'historyIndex'].includes(key)) {
                continue;
            stateToSerialize[key] = state[key];
        
        const stateCopy = JSON.parse(JSON.stringify(stateToSerialize));
        
        state.history = state.history.slice(0, state.historyIndex + 1);
        state.history.push(stateCopy);
        if (state.history.length > MAX_HISTORY_SIZE) {
            state.history.shift();
            state.historyIndex++;
        console.warn('Failed to save state to history:', e.message);

function saveStateToHistory() {
    debouncedSaveHistory();

function undo() {
    if (state.historyIndex > 0) {
        state.historyIndex--;
        const prevState = state.history[state.historyIndex];
        Object.keys(prevState).forEach(key => {
            if (state.hasOwnProperty(key) && key !== 'light' && key !== 'cam' && key !== 'view' && key !== 'animation') {
                state[key] = prevState[key];
        Object.keys(idMap).forEach(k => syncUI(idMap[k]));
        requestRender();
        showToast('Undone', 'info');

function redo() {
    if (state.historyIndex < state.history.length - 1) {
        state.historyIndex++;
        const nextState = state.history[state.historyIndex];
        Object.keys(nextState).forEach(key => {
            if (state.hasOwnProperty(key) && key !== 'light' && key !== 'cam' && key !== 'view' && key !== 'animation') {
                state[key] = nextState[key];
        Object.keys(idMap).forEach(k => syncUI(idMap[k]));
        requestRender();
        showToast('Redone', 'info');

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

function updateState(key, val) {
    try {
        const validation = validateInput(key, val);
        if (!validation.valid) {
            showToast(validation.error, 'error');
            const k = Object.keys(idMap).find(k => idMap[k] === key);
            if (k && inputs[k]) {
                inputs[k].nb?.classList.add('error');
                setTimeout(() => inputs[k].nb?.classList.remove('error'), 2000);
        
        const value = validation.value;
        const previousFoldAngle = state.foldAngle; // Store for collision limiting
        if (key === 'foldAngle') {
            state.foldAngle = degToRad(value);
            state[key] = value;
        
        syncUI(key);
        
        // Invalidate cache when geometry-changing parameters are updated
        const geometryKeys = ['modules', 'hLengthFt', 'vLengthFt', 'pivotPct', 'hobermanAng', 'pivotAng',
                              'hStackCount', 'vStackCount', 'vStackReverse', 'offsetTopIn', 'offsetBotIn', 'vertEndOffset',
                              'bracketOffset', 'stackGap', 'hBeamW', 'hBeamT', 'vBeamW', 'vBeamT', 'foldAngle', 'orientation', 
                              'archCapUprights', 'useFixedBeams', 'archFlipVertical', 'archRotation', 'arrayCount'];
        if (geometryKeys.includes(key)) {
            invalidateGeometryCache();
            
            // Regenerate roof face buttons when module count changes
            if (key === 'modules' && state.orientation === 'vertical' && state.solarPanels.enabled) {
                // Reset roof faces array to match new module count (2 faces per module)
                state.solarPanels.archWallFaces = new Array(state.modules * 2).fill(true);
                generateWallFaceButtons();
            
            // Also invalidate animation closed angle cache when relevant params change
            if (['modules', 'hLengthFt', 'pivotPct', 'hobermanAng', 'pivotAng', 'offsetTopIn', 'offsetBotIn'].includes(key)) {
                state.animation.cachedClosedAngle = undefined;
                // Update stop angle to closed angle when geometry changes
                const closedAngle = getOptimalClosedAngleForAnimation();
                state.animation.stopAngle = radToDeg(closedAngle);
                // Update UI
                const stopSlider = document.getElementById('sl-anim-stop');
                const stopNumber = document.getElementById('nb-anim-stop');
                if (stopSlider) stopSlider.value = state.animation.stopAngle;
                if (stopNumber) stopNumber.value = state.animation.stopAngle;
        
        // Check collisions if enabled and limit fold angle if needed
        if (state.enforceCollision) {
            const data = solveLinkage(state.foldAngle);
            state.collisions = detectCollisions(data);
            state.hasCollision = state.collisions.length > 0;
            
            // If there are collisions and we're changing foldAngle, find safe angle
            if (key === 'foldAngle' && state.hasCollision) {
                const safeAngle = findSafeFoldAngle(state.foldAngle, previousFoldAngle);
                if (safeAngle !== null && Math.abs(safeAngle - state.foldAngle) > 0.01) {
                    state.foldAngle = safeAngle;
                    invalidateGeometryCache();
                    syncUI('foldAngle');
        
        saveStateToHistory();
        requestRender();
        console.error('Update state error:', error);
        showToast('Error updating state', 'error');

function syncUI(key) {
    const k = Object.keys(idMap).find(k => idMap[k] === key);
    if (k && inputs[k]) {
        let v = state[key];
        if (key === 'foldAngle') v = radToDeg(v);
        if (inputs[k].sl) inputs[k].sl.value = v;
        if (inputs[k].nb) {
            inputs[k].nb.value = (key.startsWith('cost')) ? formatNumber(v, 2) : formatNumber(v, 1);

// Set up input event listeners with debouncing for sliders
Object.keys(idMap).forEach(k => {
