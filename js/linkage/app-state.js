// ============================================================================
// LINKAGE LAB - Application state object and light vector (ES module)
// Load after hardware-detail.js (getDefaultHardwareAssemblies)
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';

/** Application state object containing all configuration parameters */
export const state = {
    modules: 8,
    hLengthFt: 8.0, 
    vLengthFt: 8.0, 
    pivotPct: 41.5,
    hobermanAng: 0.0,
    pivotAng: 0.0,
    
    hStackCount: 2,
    vStackCount: 3,
    vStackReverse: false,
    
    offsetTopIn: 1.5,
    offsetBotIn: 1.5,
    vertEndOffset: 1.5, 
    hStackGap: 0.0,          // Gap between horizontal beam stacks
    vStackGap: 0.0,          // Gap between vertical beam stacks
    
    hBeamW: 3.5, 
    hBeamT: 1.5,
    vBeamW: 1.5,
    vBeamT: 3.5,
    vBeamDimensionsLinked: true,
    vBeamInnerW: 1.5,
    vBeamInnerT: 3.5,
    vBeamOuterW: 1.5,
    vBeamOuterT: 3.5,
    
    // Bracket configuration
    bracketWidth: 2.0,         // Width of U-bracket (inches)
    bracketDepth: 3.0,        // Depth of U-bracket (inches)
    bracketHeight: 3.0,       // Height of U-bracket (inches, auto-adjusts if needed)
    bracketWallThickness: 0.25, // Wall thickness (inches)
    bracketInnerWidth: 1.5,   // Inner width between legs (inches)
    bracketHoleDiameter: 0.375, // Hole diameter (inches, 3/8" default)
    bracketHoleDistance: 1.5,   // Distance from bracket base (closed end) to hole center (inches)
    bracketZRotation: 0,        // Manual Z-axis rotation adjustment (degrees)
    
    // Bolt configuration
    boltDiameter: 0.375,      // 3/8" default
    vBoltLength: 3.0,         // V-stack bolt length - full stack (auto-calculated if vBoltAuto is true)
    vBoltInnerLength: 3.0,    // V-stack inner bolt length (for odd stacks > 2, holds more beams)
    vBoltOuterLength: 2.0,    // V-stack outer bolt length (for odd stacks > 2, holds fewer beams)
    hBoltLength: 3.0,         // H-stack center bolt length (auto-calculated if hBoltAuto is true)
    hPivotBoltLength: 4.0,    // H-pivot bolt length (through H-beams into brackets)
    vBoltAuto: true,          // Auto-calculate V-stack bolt length based on stack
    hBoltAuto: true,          // Auto-calculate H-stack center bolt length based on stack
    hPivotBoltAuto: true,     // Auto-calculate H-pivot bolt length
    // Pricing per bolt size
    costBoltVInner: 0.75,     // Cost per inner V-stack bolt (longer)
    costBoltVOuter: 0.50,     // Cost per outer V-stack bolt (shorter)
    costBoltH: 0.75,          // Cost per H-stack center bolt
    costBoltHPivot: 0.75,     // Cost per H-pivot bolt (through H-beams into brackets)
    
    // Washer configuration
    vWasherEnabled: true,     // Enable washers for vertical stacks
    hWasherEnabled: true,     // Enable washers for horizontal stacks
    vWasherID: 0.4375,        // Vertical washer inner diameter (7/16" default, bolt + clearance)
    vWasherOD: 1.0,          // Vertical washer outer diameter (1" default)
    vWasherThickness: 0.0,   // Vertical washer thickness (auto-synced with vStackGap)
    vWasherAuto: true,        // Auto-sync washer thickness with stack gap
    hWasherID: 0.4375,        // Horizontal washer inner diameter (7/16" default)
    hWasherOD: 1.0,          // Horizontal washer outer diameter (1" default)
    hWasherThickness: 0.0,   // Horizontal washer thickness (auto-synced with hStackGap)
    hWasherAuto: true,        // Auto-sync washer thickness with stack gap
    costWasherV: 0.10,       // Cost per vertical washer
    costWasherH: 0.10,       // Cost per horizontal washer

    // Hardware Assembly Detail — parametric, editable hardware stacks per joint assembly.
    // Seeded from getDefaultHardwareAssemblies() (function-hoisted, defined below).
    hardwareAssemblies: getDefaultHardwareAssemblies(),

    // Lumber pricing - volume-based auto calculation
    autoLumberPricing: true,      // When true, beam costs scale by volume automatically
    // Reference beam for pricing: 2"x4" nominal (1.5"x3.5" actual) x 8' at typical price
    refBeamWidth: 3.5,            // Reference beam width (inches)
    refBeamThick: 1.5,            // Reference beam thickness (inches)
    refBeamLength: 8,             // Reference beam length (feet)
    refBeamPrice: 5.48,           // Reference beam price ($)
    
    costHBeam: 12.00,      // Cost per horizontal beam (manual override or calculated)
    costVBeam: 10.00,      // Cost per vertical beam (manual override or calculated)
    costBolt: 0.75,
    costBracket: 5.00,
    costSolarPanel: 150.00,

    // Weight constants (lbs)
    woodDensity: 0.018,     // Wood density in lbs per cubic inch (typical softwood: ~30-35 lbs/ft³ = ~0.017-0.020 lbs/in³)
    weightBracket: 0.5,     // Weight per bracket (estimated)
    weightBolt: 0.01,       // Weight per bolt (negligible, but included for completeness)

    foldAngle: 135.4 * Math.PI / 180,
    isRing: false,
    enforceCollision: false,
    hasCollision: false,
    
    showBrackets: true,
    showBolts: false,
    showHardwareFullDetail: false,
    
    // Orientation: 'horizontal' (cylinder standing up) or 'vertical' (arch/bridge mode)
    orientation: 'horizontal',
    
    // Cap uprights: add vertical uprights to open ends in arch mode for better ground tracking
    archCapUprights: false,
    
    // Fixed straight beams: add non-folding straight beams between horizontal rings
    // These maintain constant spacing and prevent panels from flipping
    useFixedBeams: false,
    fixedBeamLength: null,  // Calculated at reference angle, null = auto-calculate
    fixedBeamHeight: null,  // Constant height when using fixed beams, null = auto-calculate
    
    // Support beams (independent of solar panels). Defaults match StarShade 8m reference (see project defaults).
    supportBeams: {
        enabled: true,          // master toggle for ALL support + reciprocal beams
        showRadial: true,       // sub-toggle: show radial support (S) beams
        length: 120,            // inches
        width: 1.5,             // inches
        thickness: 3.5,         // inches
        rotation: 0,            // degrees - rotational offset around ring
        offsetH: -46.5,        // radial offset from top ring outer edge (inches)
        offsetV: -6.8,         // vertical offset above top ring (inches)
        foldAngle: 0,          // tilt from horizontal (degrees)
        parallelEnabled: true,
        parallelLength: 96,    // independent length for reciprocal beams (inches)
        parallelWidth: 2.5,    // independent width for reciprocal beams (inches)
        parallelThickness: 1.5, // independent thickness for reciprocal beams (inches)
        parallelFoldAngle: 0,  // up/down fold around anchor on top beam (degrees)
        parallelSwingAngle: 0, // side-to-side swing around anchor on top beam (degrees)
        parallelOverlap: 64,   // legacy (unused) — superseded by anchorDist
        parallelInset: -9.5,   // legacy (unused) — superseded by anchorDist
        parallelVOffset: -1.66,   // A/B vertical offset between the two beams (inches)
        parallelOffsetV: 4.5,  // vertical position offset for all reciprocal beams (inches)
        anchorDist: 20,         // distance of each anchor from the H-center pivot, along the top scissor beam (inches)
        rcpKinematicMode: true, // when true, the selected bolted pivot drives folding (stress/impossible states)
        rcpPivotHole: 0,        // legacy (unused)
        rcpPivotT: 0.5,         // legacy (unused) — superseded by rcpActiveHole
        rcpEndOffset: 0,        // how far the beam extends past the anchor bolt hole (inches, + = more overhang)
        rcpActiveHole: 1,       // which baked crossing hole (1..N) is the bolted folding pivot
        rcpMaxHoleCount: 1,     // number of baked crossing holes available per beam (set when seeding)
        rcpCrossings: null,     // legacy crossing refs (tA/tB along beam)
        rcpFinalTopology: null, // all crossing pairings from deployed closed-ring pattern
        rcpHoleTsByBeam: null,  // stackId → [tHole1, tHole2, tHole3] from deployed layout
        rcpDiagnostics: null,   // solver residual / gap readout
        _lastPhi: null          // continuation state for reciprocal swing solver
    },

    // Structure rotation (rotates structure only, not solar panels)
    structureRotation: 0,       // Rotation around vertical Y-axis (degrees)
    
    // Actuator selection for visualization
    selectedActuator: null,      // Currently selected actuator recommendation
    actuatorRecommendations: [], // List of actuator recommendations from analysis
    
    // Arch orientation controls
    archFlipVertical: false,    // Flip the arch upside down
    archRotation: 0,            // Rotation around vertical axis (degrees)
    
    // Array duplication for tunnel/tube mode
    arrayCount: 1,              // Number of structure copies in array (1 = single structure)
    
    // Actuator animation state
    actuatorAnimation: {
        enabled: false,
        type: 'piston', // 'piston' or 'actuator'
        speed: 1.0, // Animation speed multiplier
        isPlaying: false,
        currentAngle: null,
        targetAngle: null,
        direction: 1 // 1 = opening, -1 = closing
    },
    
    light: {x: 0.4, y: -0.8, z: 0.5},
    cam: { yaw: 0.4, pitch: 0.14, dist: DEFAULT_CAM_DIST, panX: 0, panY: 0 },
    view: { w: 0, h: 0, splitX: 0.7, orthoScale: 4.0 },

    // Hardware detail "part view": main canvas reparented into the modal,
    // framing a single real assembly instance head-on (explode + transparent beams).
    hwDetailMode: false,
    
    // Sun position for lighting simulation
    sunAzimuth: 135,    // Degrees from north (0=N, 90=E, 180=S, 270=W) - default: SE
    sunElevation: 45,   // Degrees above horizon (0-90)
    
    // New state properties
    measureMode: false,
    showHumanScale: false,
    /** IBC column: Just IBC.glb, stacked mirrored pair, structure-local placement */
    ibc: {
        enabled: false,
        count: 2,
        stackGapIn: 0,
        verticalOffsetAIn: 0,
        verticalOffsetBIn: 0,
        rotationYDeg: 0,
        scale: INCHES_PER_METER
    },
    measurePoints: [],
    collisions: [],
    animation: {
        playing: false,
        speed: 1.0,
        loop: false,
        pingPong: false,  // Alternate direction on each cycle
        direction: 1,     // 1 = expanding, -1 = collapsing
        frameId: null,
        lastTime: 0,      // For delta time calculation
        stopAngle: null,  // Stop angle in degrees (null = use closed angle)
        minFoldAngle: null,       // Minimum fold angle in degrees (null = auto: outer V-beam contact point)
        radialVisibleAngle: 90,   // Radial (S) beams appear above this fold angle (degrees)
        rcpVisibleAngle: 90,      // Reciprocal (R) beams appear above this fold angle (degrees)
        panelsVisibleAngle: null, // Solar panels appear only at/above this angle (null = at closed/deploy angle)
        cachedClosedAngle: undefined,  // Cached closed angle calculation
        fixedCenter: null,  // Fixed structure center during animation (prevents auto-repositioning)
        cachedModules: null,
        cachedPivotPct: null,
        foldingPanelsUnfoldPhase: false,
        foldingPanelPhase: 'idle',       // idle | stowed | structure_deploy | panel_deploy
        foldingPanelDeploy: 0,           // 0 = stowed, 1 = flat (animated independently of structure)
        foldingPanelDeployStart: 0       // rAF timestamp when panel_deploy phase began
    },
    
    // Solar panel configuration
    solarPanels: {
        enabled: false,
        
        // Top surface panel configuration (cylinder mode - rectangular/radial/spiral layouts)
        topPanels: {
            enabled: true,           // Enable top surface panels
            panelLength: 65,         // inches
            panelWidth: 39,          // inches
            panelThickness: 1.5,     // inches
            ratedWatts: 250,         // Wmp - Maximum power (watts)
            voc: 37.5,               // Open circuit voltage (V)
            vmp: 31.2,               // Voltage at max power (V)
            isc: 8.8,                // Short circuit current (A)
            imp: 8.1,                // Current at max power (A)
            paddingX: 2,             // inches between panels (X direction)
            paddingY: 2,             // inches between panels (Y direction)
            gridRows: 2,             // rows for top panels
            gridCols: 2,             // columns for top panels
            panelLift: 0,            // inches above closed structure
            weight: 45.0,            // Weight per panel in lbs (typical 250W panel)
            formFactor: 'framed',    // framed | flexible | folding
            foldCount: 4,
            foldDeploy: 1,           // 0 = stowed/folded, 1 = deployed flat
            foldedLength: 25.25,
            foldedWidth: 21.25,
            foldedThickness: 2.5
        },
        
        // Side/Arch panel configuration (arch mode or cylinder side walls)
        sidePanels: {
            enabled: false,          // Enable side wall panels in cylinder mode
            panelLength: 65,         // inches
            panelWidth: 39,          // inches
            panelThickness: 1.5,     // inches
            ratedWatts: 250,         // Wmp - Maximum power (watts)
            voc: 37.5,               // Open circuit voltage (V)
            vmp: 31.2,               // Voltage at max power (V)
            isc: 8.8,                // Short circuit current (A)
            imp: 8.1,                // Current at max power (A)
            paddingX: 2,             // inches between panels (X direction)
            paddingY: 2,             // inches between panels (Y direction)
            gridRows: 2,             // rows for side/arch panels
            gridCols: 2,             // columns for side/arch panels
            weight: 45.0,            // Weight per panel in lbs (typical 250W panel)
            formFactor: 'framed',
            foldCount: 4,
            foldDeploy: 1,
            foldedLength: 25.25,
            foldedWidth: 21.25,
            foldedThickness: 2.5
        },
        
        // Layout mode for top surface panels (cylinder mode)
        layoutMode: 'rectangular',  // 'rectangular', 'radial', 'spiral'
        gridRotation: 0,      // rotation angle in degrees for rectangular grid (top panels)
        
        // Radial/Pinwheel mode (top panels)
        radialCount: 8,       // number of panels in ring
        radialOffset: 0,      // offset from center (inches)
        radialRotation: 0,    // rotation of entire pattern (degrees)
        radialLateralOffset: 0, // lateral offset perpendicular to radial (inches)
        pinwheelAngle: 0,     // rotation angle per panel (degrees)
        
        // Spiral mode (top panels) - multi-panel radial arms
        spiralArmCount: 2,                        // number of panels per arm (>=2)
        spiralSecondaryEnabled: true,             // enable additional panels beyond primary
        spiralSecondaryRadialOffset: 24,          // base radial offset for panel #2 (inches)
        spiralSecondaryLateralOffset: 0,          // base lateral offset for panel #2 (inches)
        spiralSecondaryPinwheel: 0,               // base pinwheel delta for panel #2 (deg)
        spiralSecondaryRotation: 0,               // base rotation delta for panel #2 (deg)
        spiralArmRadialStep: 0,                   // radial increment per extra panel (panel #3+)
        spiralArmLateralStep: 0,                  // lateral increment per extra panel (panel #3+)
        spiralArmPinwheelStep: 0,                 // pinwheel increment per extra panel (deg)
        spiralArmRotationStep: 0,                 // rotation increment per extra panel (deg)
        
        // Arch mode wall faces - array of booleans for each wall face (2 per module)
        // null means "all enabled" (default), otherwise array like [true, false, true, ...]
        archWallFaces: null,
        
        // Arch mode panel positioning controls
        archPanelOffset: 2,       // inches - lift panels above roof surface
        archPanelSlide: 0.5,      // inches - A/B mirrored slide along tilt angle
        archPanelSeparation: 0    // inches - additional offset along slope
    },
    
    history: [],
    historyIndex: -1
};

// Normalize light vector
const lLen = Math.sqrt(state.light.x**2 + state.light.y**2 + state.light.z**2);
state.light.x /= lLen; state.light.y /= lLen; state.light.z /= lLen;

bridgeGlobals({ state }, 'appState');

