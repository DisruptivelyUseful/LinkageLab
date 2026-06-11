// ============================================================================
// LINKAGE LAB - Config persistence (save/load, presets, applyConfig)
// Depends on global: state, showToast, syncUI, linkage-geometry sp* helpers, unitConverter
// ============================================================================
(function (g) {
    'use strict';

    // ============================================================================
    // SAVE/LOAD & PRESETS
    // ============================================================================
    
    /** List of configuration keys that are saved/loaded */
    const CONFIG_KEYS = [
        'modules', 'hLengthFt', 'vLengthFt', 'pivotPct', 'hobermanAng', 'pivotAng',
        'hStackCount', 'vStackCount', 'vStackReverse', 'offsetTopIn', 'offsetBotIn', 'vertEndOffset',
        'hStackGap', 'vStackGap', 'hBeamW', 'hBeamT', 'vBeamW', 'vBeamT',
        'vBeamInnerW', 'vBeamInnerT', 'vBeamOuterW', 'vBeamOuterT', 'vBeamDimensionsLinked',
        'bracketWidth', 'bracketDepth', 'bracketHeight', 'bracketWallThickness', 'bracketInnerWidth', 'bracketHoleDistance',
        'costHBeam', 'costVBeam', 'costBolt', 'costBracket', 'costSolarPanel', 'orientation', 'archCapUprights',
        'archFlipVertical', 'archRotation', 'arrayCount', 'useFixedBeams'
    ];
    
    /** Solar panel configuration keys (saved separately as nested object) */
    const SOLAR_PANEL_KEYS = [
        'enabled', 'panelLength', 'panelWidth', 'panelThickness',
        'ratedWatts', 'voc', 'vmp', 'isc', 'imp', 'layoutMode',
        'paddingX', 'paddingY', 'gridRows', 'gridCols', 'gridRotation', 'radialCount', 'radialOffset',
        'radialRotation', 'radialLateralOffset', 'pinwheelAngle',
        'spiralArmCount', 'spiralSecondaryEnabled', 'spiralSecondaryRadialOffset', 'spiralSecondaryLateralOffset', 'spiralSecondaryPinwheel', 'spiralSecondaryRotation',
        'spiralArmRadialStep', 'spiralArmLateralStep', 'spiralArmPinwheelStep', 'spiralArmRotationStep',
        'panelLift',
        'archPanelOffset', 'archPanelSlide', 'archPanelSeparation',
        'archWallFaces', 'sideWallPanels', 'topPanels', 'topPanelRows', 'topPanelCols'
    ];
    
    /**
     * Applies a V30 (new structured) configuration
     * @param {Object} config - V30 configuration object
     */
    function applyV30Config(config) {
        // Structure parameters
        if (config.structure) {
            const s = config.structure;
            if (s.modules !== undefined) state.modules = s.modules;
            if (s.beamLengths) {
                if (s.beamLengths.horizontal !== undefined) state.hLengthFt = s.beamLengths.horizontal;
                if (s.beamLengths.vertical !== undefined) state.vLengthFt = s.beamLengths.vertical;
            }
            if (s.pivotPercent !== undefined) state.pivotPct = s.pivotPercent;
            if (s.stackCounts) {
                if (s.stackCounts.horizontal !== undefined) state.hStackCount = s.stackCounts.horizontal;
                if (s.stackCounts.vertical !== undefined) state.vStackCount = s.stackCounts.vertical;
            }
            if (s.beamDimensions) {
                if (s.beamDimensions.horizontalWidth !== undefined) state.hBeamW = s.beamDimensions.horizontalWidth;
                if (s.beamDimensions.horizontalThickness !== undefined) state.hBeamT = s.beamDimensions.horizontalThickness;
                if (s.beamDimensions.verticalWidth !== undefined) state.vBeamW = s.beamDimensions.verticalWidth;
                if (s.beamDimensions.verticalThickness !== undefined) state.vBeamT = s.beamDimensions.verticalThickness;
                if (s.beamDimensions.verticalInnerWidth !== undefined) state.vBeamInnerW = s.beamDimensions.verticalInnerWidth;
                if (s.beamDimensions.verticalInnerThickness !== undefined) state.vBeamInnerT = s.beamDimensions.verticalInnerThickness;
                if (s.beamDimensions.verticalOuterWidth !== undefined) state.vBeamOuterW = s.beamDimensions.verticalOuterWidth;
                if (s.beamDimensions.verticalOuterThickness !== undefined) state.vBeamOuterT = s.beamDimensions.verticalOuterThickness;
                if (s.beamDimensions.verticalDimensionsLinked !== undefined) state.vBeamDimensionsLinked = s.beamDimensions.verticalDimensionsLinked;
            }
            if (state.vBeamInnerW === undefined || state.vBeamInnerW === null) state.vBeamInnerW = state.vBeamW;
            if (state.vBeamInnerT === undefined || state.vBeamInnerT === null) state.vBeamInnerT = state.vBeamT;
            if (state.vBeamOuterW === undefined || state.vBeamOuterW === null) state.vBeamOuterW = state.vBeamW;
            if (state.vBeamOuterT === undefined || state.vBeamOuterT === null) state.vBeamOuterT = state.vBeamT;
            if (state.vBeamDimensionsLinked === undefined) state.vBeamDimensionsLinked = true;
            if (s.offsets) {
                if (s.offsets.top !== undefined) state.offsetTopIn = s.offsets.top;
                if (s.offsets.bottom !== undefined) state.offsetBotIn = s.offsets.bottom;
                if (s.offsets.vertEnd !== undefined) state.vertEndOffset = s.offsets.vertEnd;
                // Backward compatibility: old bracketOffset becomes bracketHeight
                if (s.offsets.bracket !== undefined) state.bracketHeight = s.offsets.bracket;
                // Support both old single stackGap and new separate gaps
                if (s.offsets.hStackGap !== undefined) state.hStackGap = s.offsets.hStackGap;
                else if (s.offsets.stackGap !== undefined) state.hStackGap = s.offsets.stackGap;
                if (s.offsets.vStackGap !== undefined) state.vStackGap = s.offsets.vStackGap;
                else if (s.offsets.stackGap !== undefined) state.vStackGap = s.offsets.stackGap;
            }
            if (s.brackets) {
                if (s.brackets.width !== undefined) state.bracketWidth = s.brackets.width;
                if (s.brackets.depth !== undefined) state.bracketDepth = s.brackets.depth;
                if (s.brackets.height !== undefined) state.bracketHeight = s.brackets.height;
                if (s.brackets.wallThickness !== undefined) state.bracketWallThickness = s.brackets.wallThickness;
                if (s.brackets.innerWidth !== undefined) state.bracketInnerWidth = s.brackets.innerWidth;
                if (s.brackets.holeDiameter !== undefined) state.bracketHoleDiameter = s.brackets.holeDiameter;
                if (s.brackets.zRotation !== undefined) state.bracketZRotation = s.brackets.zRotation;
                if (s.brackets.holeDistance !== undefined) state.bracketHoleDistance = s.brackets.holeDistance;
            }
            // Also support new bracketDimensions format
            if (s.bracketDimensions) {
                if (s.bracketDimensions.width !== undefined) state.bracketWidth = s.bracketDimensions.width;
                if (s.bracketDimensions.depth !== undefined) state.bracketDepth = s.bracketDimensions.depth;
                if (s.bracketDimensions.height !== undefined) state.bracketHeight = s.bracketDimensions.height;
                if (s.bracketDimensions.wallThickness !== undefined) state.bracketWallThickness = s.bracketDimensions.wallThickness;
                if (s.bracketDimensions.innerWidth !== undefined) state.bracketInnerWidth = s.bracketDimensions.innerWidth;
                if (s.bracketDimensions.holeDistance !== undefined) state.bracketHoleDistance = s.bracketDimensions.holeDistance;
            }
            if (s.bolts) {
                if (s.bolts.diameter !== undefined) state.boltDiameter = s.bolts.diameter;
                if (s.bolts.vStackLength !== undefined) state.vBoltLength = s.bolts.vStackLength;
                if (s.bolts.hStackLength !== undefined) state.hBoltLength = s.bolts.hStackLength;
                if (s.bolts.vStackAuto !== undefined) state.vBoltAuto = s.bolts.vStackAuto;
                if (s.bolts.hStackAuto !== undefined) state.hBoltAuto = s.bolts.hStackAuto;
                if (s.bolts.hPivotBoltLength !== undefined) state.hPivotBoltLength = s.bolts.hPivotBoltLength;
                if (s.bolts.hPivotBoltAuto !== undefined) state.hPivotBoltAuto = s.bolts.hPivotBoltAuto;
            }
            if (s.washers) {
                if (s.washers.vEnabled !== undefined) state.vWasherEnabled = s.washers.vEnabled;
                if (s.washers.vID !== undefined) state.vWasherID = s.washers.vID;
                if (s.washers.vOD !== undefined) state.vWasherOD = s.washers.vOD;
                if (s.washers.vThickness !== undefined) state.vWasherThickness = s.washers.vThickness;
                if (s.washers.vAuto !== undefined) state.vWasherAuto = s.washers.vAuto;
                if (s.washers.hEnabled !== undefined) state.hWasherEnabled = s.washers.hEnabled;
                if (s.washers.hID !== undefined) state.hWasherID = s.washers.hID;
                if (s.washers.hOD !== undefined) state.hWasherOD = s.washers.hOD;
                if (s.washers.hThickness !== undefined) state.hWasherThickness = s.washers.hThickness;
                if (s.washers.hAuto !== undefined) state.hWasherAuto = s.washers.hAuto;
            }
            if (s.hobermanAngle !== undefined) state.hobermanAng = s.hobermanAngle;
            if (s.pivotAngle !== undefined) state.pivotAng = s.pivotAngle;
            if (s.vStackReverse !== undefined) state.vStackReverse = s.vStackReverse;
        }
        
        // Hardware assembly detail
        if (config.hardwareAssemblies && typeof config.hardwareAssemblies === 'object') {
            state.hardwareAssemblies = config.hardwareAssemblies;
        }
        ensureHardwareAssemblies();
    
        // Mode configuration
        if (config.mode) {
            const m = config.mode;
            if (m.type !== undefined) state.orientation = m.type === 'arch' ? 'vertical' : 'horizontal';
            if (m.flipVertical !== undefined) state.archFlipVertical = m.flipVertical;
            if (m.rotation !== undefined) state.archRotation = m.rotation;
            if (m.useFixedBeams !== undefined) state.useFixedBeams = m.useFixedBeams;
            if (m.capUprights !== undefined) state.archCapUprights = m.capUprights;
            if (m.arrayCount !== undefined) state.arrayCount = m.arrayCount;
        }
        
        // Visibility settings
        if (config.visibility) {
            const v = config.visibility;
            if (v.brackets !== undefined) state.showBrackets = v.brackets;
            if (v.bolts !== undefined) state.showBolts = v.bolts;
            if (v.hardwareFullDetail !== undefined) state.showHardwareFullDetail = v.hardwareFullDetail;
            if (v.ibc !== undefined) state.ibc.enabled = v.ibc;
            // Solar panels visibility is handled in the panels section
        } else {
            // Default: show bolts when loading a config (user preference)
            state.showBolts = true;
        }
        
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
                }
                if (tp.electrical) {
                    if (tp.electrical.ratedWatts !== undefined) sp.topPanels.ratedWatts = tp.electrical.ratedWatts;
                    if (tp.electrical.voc !== undefined) sp.topPanels.voc = tp.electrical.voc;
                    if (tp.electrical.vmp !== undefined) sp.topPanels.vmp = tp.electrical.vmp;
                    if (tp.electrical.isc !== undefined) sp.topPanels.isc = tp.electrical.isc;
                    if (tp.electrical.imp !== undefined) sp.topPanels.imp = tp.electrical.imp;
                    if (tp.electrical.weight !== undefined) sp.topPanels.weight = tp.electrical.weight;
                }
                if (tp.padding) {
                    if (tp.padding.x !== undefined) sp.topPanels.paddingX = tp.padding.x;
                    if (tp.padding.y !== undefined) sp.topPanels.paddingY = tp.padding.y;
                }
                if (tp.grid) {
                    if (tp.grid.rows !== undefined) sp.topPanels.gridRows = tp.grid.rows;
                    if (tp.grid.cols !== undefined) sp.topPanels.gridCols = tp.grid.cols;
                }
                if (tp.lift !== undefined) sp.topPanels.panelLift = tp.lift;
                if (tp.presetId !== undefined) sp.topPanels.presetId = tp.presetId;
                if (tp.formFactor !== undefined) sp.topPanels.formFactor = tp.formFactor;
                if (tp.foldCount !== undefined) sp.topPanels.foldCount = tp.foldCount;
                if (tp.foldDeploy !== undefined) sp.topPanels.foldDeploy = tp.foldDeploy;
                if (tp.folded) {
                    if (tp.folded.length !== undefined) sp.topPanels.foldedLength = tp.folded.length;
                    if (tp.folded.width !== undefined) sp.topPanels.foldedWidth = tp.folded.width;
                    if (tp.folded.thickness !== undefined) sp.topPanels.foldedThickness = tp.folded.thickness;
                }
            }
            
            // Load side panels configuration
            if (p.sidePanels) {
                const sidep = p.sidePanels;
                if (sidep.enabled !== undefined) sp.sidePanels.enabled = sidep.enabled;
                if (sidep.size) {
                    if (sidep.size.width !== undefined) sp.sidePanels.panelWidth = sidep.size.width;
                    if (sidep.size.length !== undefined) sp.sidePanels.panelLength = sidep.size.length;
                    if (sidep.size.thickness !== undefined) sp.sidePanels.panelThickness = sidep.size.thickness;
                }
                if (sidep.electrical) {
                    if (sidep.electrical.ratedWatts !== undefined) sp.sidePanels.ratedWatts = sidep.electrical.ratedWatts;
                    if (sidep.electrical.voc !== undefined) sp.sidePanels.voc = sidep.electrical.voc;
                    if (sidep.electrical.vmp !== undefined) sp.sidePanels.vmp = sidep.electrical.vmp;
                    if (sidep.electrical.isc !== undefined) sp.sidePanels.isc = sidep.electrical.isc;
                    if (sidep.electrical.imp !== undefined) sp.sidePanels.imp = sidep.electrical.imp;
                    if (sidep.electrical.weight !== undefined) sp.sidePanels.weight = sidep.electrical.weight;
                }
                if (sidep.padding) {
                    if (sidep.padding.x !== undefined) sp.sidePanels.paddingX = sidep.padding.x;
                    if (sidep.padding.y !== undefined) sp.sidePanels.paddingY = sidep.padding.y;
                }
                if (sidep.grid) {
                    if (sidep.grid.rows !== undefined) sp.sidePanels.gridRows = sidep.grid.rows;
                    if (sidep.grid.cols !== undefined) sp.sidePanels.gridCols = sidep.grid.cols;
                }
                if (sidep.presetId !== undefined) sp.sidePanels.presetId = sidep.presetId;
                if (sidep.formFactor !== undefined) sp.sidePanels.formFactor = sidep.formFactor;
                if (sidep.foldCount !== undefined) sp.sidePanels.foldCount = sidep.foldCount;
                if (sidep.foldDeploy !== undefined) sp.sidePanels.foldDeploy = sidep.foldDeploy;
                if (sidep.folded) {
                    if (sidep.folded.length !== undefined) sp.sidePanels.foldedLength = sidep.folded.length;
                    if (sidep.folded.width !== undefined) sp.sidePanels.foldedWidth = sidep.folded.width;
                    if (sidep.folded.thickness !== undefined) sp.sidePanels.foldedThickness = sidep.folded.thickness;
                }
            }
            
            // Layout mode (for top panels)
            if (p.layoutMode !== undefined) sp.layoutMode = p.layoutMode;
            if (p.gridRotation !== undefined) sp.gridRotation = p.gridRotation;
            
            if (p.positioning) {
                if (p.positioning.lift !== undefined) sp.archPanelOffset = p.positioning.lift;
                if (p.positioning.slide !== undefined) sp.archPanelSlide = p.positioning.slide;
                if (p.positioning.separation !== undefined) sp.archPanelSeparation = p.positioning.separation;
            }
            
            if (p.radial) {
                if (p.radial.count !== undefined) sp.radialCount = p.radial.count;
                if (p.radial.offset !== undefined) sp.radialOffset = p.radial.offset;
                if (p.radial.rotation !== undefined) sp.radialRotation = p.radial.rotation;
                if (p.radial.lateralOffset !== undefined) sp.radialLateralOffset = p.radial.lateralOffset;
                if (p.radial.pinwheelAngle !== undefined) sp.pinwheelAngle = p.radial.pinwheelAngle;
            }
            
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
            }
            
            if (p.enabledFaces !== undefined) sp.archWallFaces = p.enabledFaces;
        }
    
        // Costs
        if (config.costs) {
            const c = config.costs;
            if (c.hBeam !== undefined) state.costHBeam = c.hBeam;
            if (c.vBeam !== undefined) state.costVBeam = c.vBeam;
            if (c.bolt !== undefined) state.costBolt = c.bolt;
            if (c.boltVInner !== undefined) state.costBoltVInner = c.boltVInner;
            if (c.boltVOuter !== undefined) state.costBoltVOuter = c.boltVOuter;
            if (c.boltH !== undefined) state.costBoltH = c.boltH;
            if (c.boltHPivot !== undefined) state.costBoltHPivot = c.boltHPivot;
            if (c.washerV !== undefined) state.costWasherV = c.washerV;
            if (c.washerH !== undefined) state.costWasherH = c.washerH;
            if (c.bracket !== undefined) state.costBracket = c.bracket;
            if (c.solarPanel !== undefined) state.costSolarPanel = c.solarPanel;
            // Volume-based auto pricing settings
            if (c.autoLumber !== undefined) state.autoLumberPricing = c.autoLumber;
            if (c.refBeam) {
                if (c.refBeam.width !== undefined) state.refBeamWidth = c.refBeam.width;
                if (c.refBeam.thickness !== undefined) state.refBeamThick = c.refBeam.thickness;
                if (c.refBeam.length !== undefined) state.refBeamLength = c.refBeam.length;
                if (c.refBeam.price !== undefined) state.refBeamPrice = c.refBeam.price;
            }
        }
    
        if ('supportBeams' in config) {
            if (config.supportBeams != null && typeof config.supportBeams === 'object') {
                applySupportBeamsConfig(config.supportBeams);
            } else {
                resetSupportBeamsToDefaults();
            }
        } else {
            resetSupportBeamsToDefaults();
            if (config.panels && config.panels.support) {
                applyLegacyPanelsSupport(config.panels.support);
            }
        }
    
        if (config.ibc) {
            const ib = config.ibc;
            if (ib.enabled !== undefined) state.ibc.enabled = ib.enabled;
            if (ib.count !== undefined) state.ibc.count = ib.count;
            if (ib.stackGapIn !== undefined) state.ibc.stackGapIn = ib.stackGapIn;
            if (ib.verticalOffsetAIn !== undefined) state.ibc.verticalOffsetAIn = ib.verticalOffsetAIn;
            if (ib.verticalOffsetBIn !== undefined) state.ibc.verticalOffsetBIn = ib.verticalOffsetBIn;
            if (ib.verticalSpacingIn !== undefined) state.ibc.stackGapIn = ib.verticalSpacingIn;
            if (ib.rotationYDeg !== undefined) state.ibc.rotationYDeg = ib.rotationYDeg;
            if (ib.modelScale !== undefined) state.ibc.scale = ib.modelScale;
            if (ib.scale !== undefined) state.ibc.scale = ib.scale;
            ibcStackLayoutCacheKey = '';
        }
    }
    
    /**
     * Applies a legacy (v29 and earlier) configuration
     * @param {Object} config - Legacy configuration object
     */
    function applyLegacyConfig(config) {
        CONFIG_KEYS.forEach(key => {
            if (config.hasOwnProperty(key) && config[key] !== undefined) {
                state[key] = config[key];
            }
        });
        
        // Load solar panel configuration
        if (config.hasOwnProperty('solarPanels') && config.solarPanels) {
            SOLAR_PANEL_KEYS.forEach(key => {
                if (config.solarPanels.hasOwnProperty(key) && config.solarPanels[key] !== undefined) {
                    state.solarPanels[key] = config.solarPanels[key];
                }
            });
        }
    
        if (config.supportBeams != null && typeof config.supportBeams === 'object') {
            applySupportBeamsConfig(config.supportBeams);
        } else if (config.panels && config.panels.support) {
            applyLegacyPanelsSupport(config.panels.support);
        }
    }
    
    /**
     * Creates a snapshot of current configuration
     * @param {boolean} includeMetadata - Whether to include version and other metadata
     * @returns {Object} Configuration object
     */
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
                    verticalThickness: state.vBeamT,
                    verticalInnerWidth: state.vBeamInnerW,
                    verticalInnerThickness: state.vBeamInnerT,
                    verticalOuterWidth: state.vBeamOuterW,
                    verticalOuterThickness: state.vBeamOuterT,
                    verticalDimensionsLinked: state.vBeamDimensionsLinked
                },
                offsets: {
                    top: state.offsetTopIn,
                    bottom: state.offsetBotIn,
                    vertEnd: state.vertEndOffset,
                    hStackGap: state.hStackGap,
                    vStackGap: state.vStackGap
                },
                bracketDimensions: {
                    width: state.bracketWidth,
                    depth: state.bracketDepth,
                    height: state.bracketHeight,
                    wallThickness: state.bracketWallThickness,
                    innerWidth: state.bracketInnerWidth,
                    holeDistance: state.bracketHoleDistance
                },
                brackets: {
                    width: state.bracketWidth,
                    depth: state.bracketDepth,
                    height: state.bracketHeight,
                    wallThickness: state.bracketWallThickness,
                    innerWidth: state.bracketInnerWidth,
                    holeDiameter: state.bracketHoleDiameter,
                    zRotation: state.bracketZRotation
                },
                bolts: {
                    diameter: state.boltDiameter,
                    vStackLength: state.vBoltLength,
                    hStackLength: state.hBoltLength,
                    vStackAuto: state.vBoltAuto,
                    hStackAuto: state.hBoltAuto,
                    hPivotBoltLength: state.hPivotBoltLength,
                    hPivotBoltAuto: state.hPivotBoltAuto
                },
                washers: {
                    vEnabled: state.vWasherEnabled,
                    vID: state.vWasherID,
                    vOD: state.vWasherOD,
                    vThickness: state.vWasherThickness,
                    vAuto: state.vWasherAuto,
                    hEnabled: state.hWasherEnabled,
                    hID: state.hWasherID,
                    hOD: state.hWasherOD,
                    hThickness: state.hWasherThickness,
                    hAuto: state.hWasherAuto
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
            
            // Hardware assembly detail (parametric editable hardware stacks)
            hardwareAssemblies: JSON.parse(JSON.stringify(state.hardwareAssemblies || {})),
    
            // Fold angle in degrees
            foldAngle: radToDeg(state.foldAngle),
            animationStopAngle: state.animation.stopAngle,
            minFoldAngle: state.animation.minFoldAngle,
            radialVisibleAngle: state.animation.radialVisibleAngle,
            rcpVisibleAngle: state.animation.rcpVisibleAngle,
            panelsVisibleAngle: state.animation.panelsVisibleAngle,
            
            ibc: {
                enabled: state.ibc.enabled,
                count: state.ibc.count,
                stackGapIn: state.ibc.stackGapIn,
                verticalOffsetAIn: state.ibc.verticalOffsetAIn,
                verticalOffsetBIn: state.ibc.verticalOffsetBIn,
                rotationYDeg: state.ibc.rotationYDeg,
                scale: state.ibc.scale
            },
            
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
                        imp: state.solarPanels.topPanels.imp,
                        weight: state.solarPanels.topPanels.weight
                    },
                    padding: {
                        x: state.solarPanels.topPanels.paddingX,
                        y: state.solarPanels.topPanels.paddingY
                    },
                    grid: {
                        rows: state.solarPanels.topPanels.gridRows,
                        cols: state.solarPanels.topPanels.gridCols
                    },
                    lift: state.solarPanels.topPanels.panelLift,
                    presetId: state.solarPanels.topPanels.presetId || null,
                    formFactor: state.solarPanels.topPanels.formFactor || 'framed',
                    foldCount: state.solarPanels.topPanels.foldCount || 4,
                    foldDeploy: state.solarPanels.topPanels.foldDeploy != null ? state.solarPanels.topPanels.foldDeploy : 1,
                    folded: {
                        length: state.solarPanels.topPanels.foldedLength,
                        width: state.solarPanels.topPanels.foldedWidth,
                        thickness: state.solarPanels.topPanels.foldedThickness
                    }
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
                        imp: state.solarPanels.sidePanels.imp,
                        weight: state.solarPanels.sidePanels.weight
                    },
                    padding: {
                        x: state.solarPanels.sidePanels.paddingX,
                        y: state.solarPanels.sidePanels.paddingY
                    },
                    grid: {
                        rows: state.solarPanels.sidePanels.gridRows,
                        cols: state.solarPanels.sidePanels.gridCols
                    },
                    presetId: state.solarPanels.sidePanels.presetId || null,
                    formFactor: state.solarPanels.sidePanels.formFactor || 'framed',
                    foldCount: state.solarPanels.sidePanels.foldCount || 4,
                    foldDeploy: state.solarPanels.sidePanels.foldDeploy != null ? state.solarPanels.sidePanels.foldDeploy : 1,
                    folded: {
                        length: state.solarPanels.sidePanels.foldedLength,
                        width: state.solarPanels.sidePanels.foldedWidth,
                        thickness: state.solarPanels.sidePanels.foldedThickness
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
                enabledFaces: state.solarPanels.archWallFaces
            },
    
            // Support beams (independent of solar panels)
            supportBeams: {
                enabled: state.supportBeams.enabled,
                showRadial: state.supportBeams.showRadial,
                length: state.supportBeams.length,
                width: state.supportBeams.width,
                thickness: state.supportBeams.thickness,
                rotation: state.supportBeams.rotation,
                offsetH: state.supportBeams.offsetH,
                offsetV: state.supportBeams.offsetV,
                foldAngle: state.supportBeams.foldAngle,
                parallelEnabled: state.supportBeams.parallelEnabled,
                parallelLength: state.supportBeams.parallelLength,
                parallelWidth: state.supportBeams.parallelWidth,
                parallelThickness: state.supportBeams.parallelThickness,
                parallelFoldAngle: state.supportBeams.parallelFoldAngle,
                parallelSwingAngle: state.supportBeams.parallelSwingAngle,
                parallelOverlap: state.supportBeams.parallelOverlap,
                parallelInset: state.supportBeams.parallelInset,
                parallelVOffset: state.supportBeams.parallelVOffset,
                parallelOffsetV: state.supportBeams.parallelOffsetV,
                anchorDist: state.supportBeams.anchorDist,
                rcpKinematicMode: state.supportBeams.rcpKinematicMode,
                rcpPivotHole: state.supportBeams.rcpPivotHole,
                rcpPivotT: state.supportBeams.rcpPivotT,
                rcpEndOffset: state.supportBeams.rcpEndOffset,
                rcpActiveHole: state.supportBeams.rcpActiveHole
                // rcpCrossings deliberately omitted — re-seeded on first render after load
            },
            
            // Costs (optional)
            costs: {
                hBeam: state.costHBeam,
                vBeam: state.costVBeam,
                bolt: state.costBolt,                  // Legacy - kept for backwards compatibility
                boltVInner: state.costBoltVInner,      // Inner/long V-stack bolts
                boltVOuter: state.costBoltVOuter,      // Outer/short V-stack bolts
                boltH: state.costBoltH,                // H-stack bolts
                boltHPivot: state.costBoltHPivot,      // H-pivot bolts
                washerV: state.costWasherV,            // V-stack washers
                washerH: state.costWasherH,            // H-stack washers
                bracket: state.costBracket,
                solarPanel: state.costSolarPanel,
                // Volume-based auto pricing settings
                autoLumber: state.autoLumberPricing,
                refBeam: {
                    width: state.refBeamWidth,
                    thickness: state.refBeamThick,
                    length: state.refBeamLength,
                    price: state.refBeamPrice
                }
            },
            
            // Visibility settings for components
            visibility: {
                brackets: state.showBrackets,
                bolts: state.showBolts,
                hardwareFullDetail: state.showHardwareFullDetail,
                solarPanels: state.solarPanels.enabled,
                ibc: state.ibc.enabled
            },
            
            // Camera/viewport state for debugging and default view in simulate mode
            cameraState: {
                yaw: state.cam.yaw,
                pitch: state.cam.pitch,
                dist: state.cam.dist,
                panX: state.cam.panX,
                panY: state.cam.panY,
                structureRotation: state.structureRotation || 0
            }
        };
        
        if (includeMetadata) {
            config.version = 'v30';
            config.timestamp = new Date().toISOString();
            
            // Full 3D geometry snapshot (same frame the viewer renders) for debugging and handoff
            try {
                const data = buildLinkageGeometry({ includeSupportBeams: true, includePanels: true, useCache: false });
                config.geometrySnapshot = buildGeometrySnapshot(data);
            } catch (e) {
                config.geometrySnapshot = { error: e.message };
            }
        }
        
        return config;
    }
    
    /**
     * Applies a configuration to the current state
     * Supports both v29 (legacy) and v30 (new) config formats
     * @param {Object} config - Configuration object to apply
     * @param {boolean} updateUI - Whether to update UI elements after applying
     */
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
        }
        
        // Load animation stop angle (or default to closed angle)
        if (config.hasOwnProperty('animationStopAngle') && config.animationStopAngle !== null) {
            state.animation.stopAngle = config.animationStopAngle;
        } else {
            // Default to closed angle
            const closedAngle = getOptimalClosedAngleForAnimation();
            state.animation.stopAngle = radToDeg(closedAngle);
        }
        // Load min fold angle
        if (config.hasOwnProperty('minFoldAngle'))
            state.animation.minFoldAngle = config.minFoldAngle; // null = auto
        // Load component appearance angles
        if (config.hasOwnProperty('radialVisibleAngle') && config.radialVisibleAngle !== null)
            state.animation.radialVisibleAngle = config.radialVisibleAngle;
        if (config.hasOwnProperty('rcpVisibleAngle') && config.rcpVisibleAngle !== null)
            state.animation.rcpVisibleAngle = config.rcpVisibleAngle;
        if (config.hasOwnProperty('panelsVisibleAngle'))
            state.animation.panelsVisibleAngle = config.panelsVisibleAngle;
        
        // Restore camera state if present (for debugging and default view)
        if (config.cameraState) {
            if (typeof config.cameraState.yaw === 'number') state.cam.yaw = config.cameraState.yaw;
            if (typeof config.cameraState.pitch === 'number') state.cam.pitch = config.cameraState.pitch;
            if (typeof config.cameraState.dist === 'number') state.cam.dist = config.cameraState.dist;
            // Reset pan to 0 so structures always start centered (pan values are not restored from config)
            state.cam.panX = 0;
            state.cam.panY = 0;
            if (typeof config.cameraState.structureRotation === 'number') state.structureRotation = config.cameraState.structureRotation;
            // Backward compatibility: also check for old globalRotation name
            if (typeof config.cameraState.globalRotation === 'number') state.structureRotation = config.cameraState.globalRotation;
            
            // Update camera position if renderer is initialized
            if (threeRenderer && threeRenderer.mainCamera) {
                updateMainCamera();
            }
        }
        
        // Invalidate geometry cache
        invalidateGeometryCache();
        
        if (updateUI) {
            Object.keys(idMap).forEach(k => syncUI(idMap[k]));
            // Sync checkbox states
            const vstackReverseChk = document.getElementById('chk-vstack-reverse');
            if (vstackReverseChk) vstackReverseChk.checked = state.vStackReverse;
            updateVBeamDimensionUIVisibility();
            
            // Sync visibility checkboxes
            const bracketsChk = document.getElementById('chk-brack');
            if (bracketsChk) bracketsChk.checked = state.showBrackets;
            const boltsChk = document.getElementById('chk-bolts');
            if (boltsChk) boltsChk.checked = state.showBolts;
            const hwFullChk = document.getElementById('chk-hw-full-detail');
            if (hwFullChk) hwFullChk.checked = state.showHardwareFullDetail;
            
            const ibc = state.ibc;
            const chkIbc = document.getElementById('chk-ibc-glb');
            if (chkIbc) chkIbc.checked = !!ibc.enabled;
            const selIbcCount = document.getElementById('sel-ibc-count');
            if (selIbcCount) selIbcCount.value = String(Math.min(2, Math.max(0, ibc.count | 0)));
            syncIbcStackControlsVisibility();
            const slGap = document.getElementById('sl-ibc-stack-gap');
            const nbGap = document.getElementById('nb-ibc-stack-gap');
            if (slGap) slGap.value = ibc.stackGapIn || 0;
            if (nbGap) nbGap.value = ibc.stackGapIn || 0;
            const slA = document.getElementById('sl-ibc-offset-a');
            const nbA = document.getElementById('nb-ibc-offset-a');
            if (slA) slA.value = ibc.verticalOffsetAIn || 0;
            if (nbA) nbA.value = ibc.verticalOffsetAIn || 0;
            const slB = document.getElementById('sl-ibc-offset-b');
            const nbB = document.getElementById('nb-ibc-offset-b');
            if (slB) slB.value = ibc.verticalOffsetBIn || 0;
            if (nbB) nbB.value = ibc.verticalOffsetBIn || 0;
            const slRot = document.getElementById('sl-ibc-rotation');
            const nbRot = document.getElementById('nb-ibc-rotation');
            if (slRot) slRot.value = ibc.rotationYDeg || 0;
            if (nbRot) nbRot.value = ibc.rotationYDeg || 0;
            const nbScale = document.getElementById('nb-ibc-scale');
            if (nbScale) nbScale.value = ibc.scale != null ? ibc.scale : INCHES_PER_METER;
            
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
            }
            if (stopAngleNumber) {
                const stopAngle = state.animation.stopAngle !== null ? state.animation.stopAngle : radToDeg(getOptimalClosedAngleForAnimation());
                stopAngleNumber.value = stopAngle;
            }
            // Sync component appearance angles
            const syncAnimAngle = (slId, nbId, val) => {
                const sl = document.getElementById(slId);
                const nb = document.getElementById(nbId);
                if (sl) sl.value = Math.max(5, Math.min(175, val));
                if (nb) nb.value = val;
            };
            syncAnimAngle('sl-anim-radial-angle', 'nb-anim-radial-angle', state.animation.radialVisibleAngle ?? 90);
            syncAnimAngle('sl-anim-rcp-angle',    'nb-anim-rcp-angle',    state.animation.rcpVisibleAngle    ?? 90);
            syncAnimAngle('sl-anim-panels-angle', 'nb-anim-panels-angle', state.animation.panelsVisibleAngle ?? 170);
            const minFoldVal = state.animation.minFoldAngle ?? radToDeg(computeMinFoldAngleVBeamOverlap());
            syncAnimAngle('sl-anim-min-fold', 'nb-anim-min-fold', Math.max(5, Math.min(90, minFoldVal)));
            if (window._refreshMinFoldAutoLabel) window._refreshMinFoldAutoLabel();
            
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
            const slPanelWeightTop = document.getElementById('sl-panel-weight-top');
            const nbPanelWeightTop = document.getElementById('nb-panel-weight-top');
            if (slPanelWeightTop) slPanelWeightTop.value = Math.min(150, topCfg.weight != null ? topCfg.weight : 45);
            if (nbPanelWeightTop) nbPanelWeightTop.value = topCfg.weight != null ? topCfg.weight : 45;
            
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
            const slPanelWeightSide = document.getElementById('sl-panel-weight-side');
            const nbPanelWeightSide = document.getElementById('nb-panel-weight-side');
            if (slPanelWeightSide) slPanelWeightSide.value = Math.min(150, sideCfg.weight != null ? sideCfg.weight : 45);
            if (nbPanelWeightSide) nbPanelWeightSide.value = sideCfg.weight != null ? sideCfg.weight : 45;
            
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
            
            // Support beams (independent from solar panels)
            syncSupportBeamsUIFromState();
            
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
            if (typeof spRefreshPresetDropdowns === 'function') spRefreshPresetDropdowns();
            if (typeof spSyncFormFactorControlsFromState === 'function') {
                spSyncFormFactorControlsFromState('top');
                spSyncFormFactorControlsFromState('side');
            }
            
            // Sync auto lumber pricing UI
            const autoLumberChk = document.getElementById('chk-auto-lumber-pricing');
            const refPricingDiv = document.getElementById('ref-beam-pricing');
            const pricingLabel = document.getElementById('pricing-mode-label');
            const hCostInput = document.getElementById('nb-cost-hbeam');
            const vCostInput = document.getElementById('nb-cost-vbeam');
            if (autoLumberChk) autoLumberChk.checked = state.autoLumberPricing;
            if (refPricingDiv) refPricingDiv.style.display = state.autoLumberPricing ? 'block' : 'none';
            if (pricingLabel) pricingLabel.textContent = state.autoLumberPricing ? '(auto-calculated)' : '(manual)';
            if (hCostInput) { hCostInput.readOnly = state.autoLumberPricing; hCostInput.style.opacity = state.autoLumberPricing ? '0.7' : '1'; }
            if (vCostInput) { vCostInput.readOnly = state.autoLumberPricing; vCostInput.style.opacity = state.autoLumberPricing ? '0.7' : '1'; }
            // Sync reference beam inputs
            const refWidthInput = document.getElementById('nb-ref-beam-w');
            const refThickInput = document.getElementById('nb-ref-beam-t');
            const refLengthInput = document.getElementById('nb-ref-beam-len');
            const refPriceInput = document.getElementById('nb-ref-beam-price');
            if (refWidthInput) refWidthInput.value = state.refBeamWidth;
            if (refThickInput) refThickInput.value = state.refBeamThick;
            if (refLengthInput) refLengthInput.value = state.refBeamLength;
            if (refPriceInput) refPriceInput.value = state.refBeamPrice;
            // Update auto-calculated prices
            if (state.autoLumberPricing) updateAutoBeamPricing();
            
            requestRender();
        }
        
        // Restore solar designer state if present (unified config format)
        if (config.solarDesigner && typeof SolarDesigner !== 'undefined') {
            try {
                // Need to expand compact format back to full format for loadSolarConfig
                const expandedItems = (config.solarDesigner.items || []).map(item => {
                    // Basic item structure
                    const expanded = {
                        id: item.id,
                        type: item.type,
                        x: item.x,
                        y: item.y,
                        specs: item.specs || {},
                        handles: {} // Will be recreated by SolarDesigner
                    };
                    return expanded;
                });
                
                // Expand connections back to full format
                const expandedConnections = (config.solarDesigner.connections || []).map(conn => ({
                    id: conn.id,
                    sourceItemId: conn.src,
                    sourceHandleKey: conn.srcH,
                    targetItemId: conn.tgt,
                    targetHandleKey: conn.tgtH
                }));
                
                // Initialize SolarDesigner if not already
                if (!SolarDesigner.isInitialized()) {
                    SolarDesigner.init();
                }
                
                // Load the expanded config
                SolarDesigner.loadSolarConfig({
                    items: expandedItems,
                    connections: expandedConnections
                });
                
                console.log(`Restored solar designer: ${expandedItems.length} items, ${expandedConnections.length} connections`);
            } catch (e) {
                console.warn('Could not restore solar designer state:', e);
            }
        }
    }
    
    /**
     * Saves current configuration to localStorage
     */
    function saveConfig() {
        const config = getConfigSnapshot();
        localStorage.setItem('linkageLab_config', JSON.stringify(config));
        showToast('Configuration saved', 'info');
    }
    
    /**
     * Loads configuration from localStorage
     */
    function loadConfig() {
        const saved = localStorage.getItem('linkageLab_config');
        if (!saved) {
            showToast('No saved configuration found', 'error');
            return;
        }
        
        try {
            const config = JSON.parse(saved);
            applyConfig(config);
            saveStateToHistory();
            showToast('Configuration loaded', 'info');
        } catch (error) {
            showToast('Error loading configuration', 'error');
        }
    }
    
    /**
     * Gets list of saved presets
     */
    function getPresets() {
        const presets = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('linkageLab_preset_')) {
                try {
                    const preset = JSON.parse(localStorage.getItem(key));
                    presets.push({ name: preset.name, key: key });
                } catch (e) {}
            }
        }
        return presets;
    }
    
    /**
     * Saves current configuration as a named preset
     */
    function savePreset() {
        const name = prompt('Enter preset name:');
        if (!name) return;
        
        const sanitizedName = sanitize(name);
        const config = getConfigSnapshot();
        config.name = sanitizedName;
        
        localStorage.setItem(`linkageLab_preset_${sanitizedName}`, JSON.stringify(config));
        updatePresetSelect();
        showToast(`Preset "${sanitizedName}" saved`, 'info');
    }
    
    /**
     * Loads a preset — handles both built-in file presets (value starts with "builtin:")
     * and user presets stored in localStorage.
     */
    function loadPreset(value) {
        if (value.startsWith('builtin:')) {
            const filename = value.slice('builtin:'.length);
            fetch(`configs/${filename}`)
                .then(r => {
                    if (!r.ok) throw new Error('Preset file not found');
                    return r.json();
                })
                .then(config => {
                    applyConfig(config);
                    saveStateToHistory();
                    const select = document.getElementById('preset-select');
                    const label = select.options[select.selectedIndex]
                        ? select.options[select.selectedIndex].textContent
                        : filename;
                    showToast(`Preset "${label}" loaded`, 'info');
                })
                .catch(() => showToast('Error loading preset', 'error'));
            return;
        }
    
        const preset = localStorage.getItem(`linkageLab_preset_${value}`);
        if (!preset) {
            showToast('Preset not found', 'error');
            return;
        }
        try {
            const config = JSON.parse(preset);
            applyConfig(config);
            saveStateToHistory();
            showToast(`Preset "${config.name || value}" loaded`, 'info');
        } catch (error) {
            showToast('Error loading preset', 'error');
        }
    }
    
    /**
     * Deletes a user preset. Built-in presets cannot be deleted.
     */
    function deletePreset() {
        const select = document.getElementById('preset-select');
        const value = select.value;
        if (!value) {
            showToast('No preset selected', 'error');
            return;
        }
    
        if (value.startsWith('builtin:')) {
            showToast('Built-in presets cannot be deleted', 'error');
            return;
        }
    
        const displayName = select.options[select.selectedIndex]
            ? select.options[select.selectedIndex].textContent
            : value;
        if (confirm(`Delete preset "${displayName}"?`)) {
            localStorage.removeItem(`linkageLab_preset_${value}`);
            updatePresetSelect();
            showToast('Preset deleted', 'info');
        }
    }
    
    /**
     * Rebuilds the preset dropdown. Built-in presets (from configs/presets.json) are listed
     * first in a dedicated optgroup; user presets follow in their own optgroup.
     */
    async function updatePresetSelect() {
        const select = document.getElementById('preset-select');
        select.innerHTML = '<option value="">Select Preset...</option>';
    
        // Built-in presets from the manifest
        try {
            const response = await fetch('configs/presets.json');
            if (response.ok) {
                const builtins = await response.json();
                if (Array.isArray(builtins) && builtins.length > 0) {
                    const group = document.createElement('optgroup');
                    group.label = 'Built-in Presets';
                    builtins.forEach(p => {
                        const option = document.createElement('option');
                        option.value = `builtin:${p.file}`;
                        option.textContent = p.name;
                        group.appendChild(option);
                    });
                    select.appendChild(group);
                }
            }
        } catch (e) {
            // No manifest found — built-in presets section simply omitted
        }
    
        // User presets from localStorage
        const userPresets = getPresets();
        if (userPresets.length > 0) {
            const group = document.createElement('optgroup');
            group.label = 'My Presets';
            userPresets.forEach(p => {
                const option = document.createElement('option');
                option.value = p.key.replace('linkageLab_preset_', '');
                option.textContent = p.name;
                group.appendChild(option);
            });
            select.appendChild(group);
        }
    }

    g.LinkageModules = g.LinkageModules || {};
    g.LinkageModules.configPersistence = {
        getConfigSnapshot, applyConfig, saveConfig, loadConfig, updatePresetSelect
    };

    g.applyConfig = applyConfig;
    g.applyLegacyConfig = applyLegacyConfig;
    g.applyV30Config = applyV30Config;
    g.deletePreset = deletePreset;
    g.getConfigSnapshot = getConfigSnapshot;
    g.getPresets = getPresets;
    g.loadConfig = loadConfig;
    g.loadPreset = loadPreset;
    g.saveConfig = saveConfig;
    g.savePreset = savePreset;
    g.updatePresetSelect = updatePresetSelect;

})(window);

