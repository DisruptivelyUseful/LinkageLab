const state = {
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
    bracketOffset: 3.0, 
    stackGap: 0.0,
    
    hBeamW: 3.5, 
    hBeamT: 1.5,
    vBeamW: 1.5,
    vBeamT: 3.5,

    costHBeam: 12.00,      // Cost per horizontal beam (based on length)
    costVBeam: 10.00,      // Cost per vertical beam (based on length)
    costBolt: 0.75,
    costBracket: 5.00,
    costSolarPanel: 150.00,

    foldAngle: 135.4 * Math.PI / 180,
    isRing: false,
    enforceCollision: false,
    hasCollision: false,
    
    showBrackets: true,
    showBolts: false,
    
    // Orientation: 'horizontal' (cylinder standing up) or 'vertical' (arch/bridge mode)
    orientation: 'horizontal',
    
    // Cap uprights: add vertical uprights to open ends in arch mode for better ground tracking
    archCapUprights: false,
    
    // Fixed straight beams: add non-folding straight beams between horizontal rings
    // These maintain constant spacing and prevent panels from flipping
    useFixedBeams: false,
    fixedBeamLength: null,  // Calculated at reference angle, null = auto-calculate
    fixedBeamHeight: null,  // Constant height when using fixed beams, null = auto-calculate
    
    // Arch orientation controls
    archFlipVertical: false,    // Flip the arch upside down
    archRotation: 0,            // Rotation around vertical axis (degrees)
    
    // Array duplication for tunnel/tube mode
    arrayCount: 1,              // Number of structure copies in array (1 = single structure)
    
    light: {x: 0.4, y: -0.8, z: 0.5},
    cam: { yaw: 0.4, pitch: -0.3, dist: DEFAULT_CAM_DIST, panX: 0, panY: 0 },
    view: { w: 0, h: 0, splitX: 0.7, orthoScale: 4.0 },
    
    // Sun position for lighting simulation
    sunAzimuth: 135,    // Degrees from north (0=N, 90=E, 180=S, 270=W) - default: SE
    sunElevation: 45,   // Degrees above horizon (0-90)
    
    // New state properties
    measureMode: false,
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
        cachedClosedAngle: undefined,  // Cached closed angle calculation
        fixedCenter: null,  // Fixed structure center during animation (prevents auto-repositioning)
        cachedModules: null,
        cachedPivotPct: null
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
            ratedWatts: 400,         // Wmp - Maximum power (watts)
            voc: 49.5,               // Open circuit voltage (V)
            vmp: 41.5,               // Voltage at max power (V)
            isc: 10.2,               // Short circuit current (A)
            imp: 9.65,               // Current at max power (A)
            paddingX: 2,             // inches between panels (X direction)
            paddingY: 2,             // inches between panels (Y direction)
            gridRows: 2,             // rows for top panels
            gridCols: 2,             // columns for top panels
            panelLift: 0             // inches above closed structure
        },
        
        // Side/Arch panel configuration (arch mode or cylinder side walls)
        sidePanels: {
            enabled: false,          // Enable side wall panels in cylinder mode
            panelLength: 65,         // inches
            panelWidth: 39,          // inches
            panelThickness: 1.5,     // inches
            ratedWatts: 400,         // Wmp - Maximum power (watts)
            voc: 49.5,               // Open circuit voltage (V)
            vmp: 41.5,               // Voltage at max power (V)
            isc: 10.2,               // Short circuit current (A)
            imp: 9.65,               // Current at max power (A)
            paddingX: 2,             // inches between panels (X direction)
            paddingY: 2,             // inches between panels (Y direction)
            gridRows: 2,             // rows for side/arch panels
            gridCols: 2              // columns for side/arch panels
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
        
        // Support beams
        showSupportBeams: false,
        supportBeamRotation: 0,   // degrees, 0 = aligned with vertical uprights
        supportBeamLength: 96,    // inches (8 feet default)
        supportBeamFoldAngle: 0,  // degrees from vertical (0 = horizontal, 90 = pointing down)
        supportBeamOffsetH: -120,    // horizontal offset from pivot (inches)
        supportBeamOffsetV: 0,    // vertical offset from pivot (inches)
        
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

// ============================================================================
// INPUT VALIDATION
// ============================================================================

const VALIDATION_RULES = {
    modules: { min: 3, max: 40 },
    hLengthFt: { min: 2, max: 24 },
    vLengthFt: { min: 2, max: 24 },
    pivotPct: { min: 0, max: 100 },
    hobermanAng: { min: -90, max: 90 },
    pivotAng: { min: -180, max: 180 },
    hStackCount: { min: 2, max: 6 },
    vStackCount: { min: 2, max: 6 },
    offsetTopIn: { min: 0, max: 48 },
    offsetBotIn: { min: 0, max: 48 },
    bracketOffset: { min: 0, max: 12 },
    stackGap: { min: -2.0, max: 1 },
    hBeamW: { min: 0.5, max: 12 },
    hBeamT: { min: 0.5, max: 12 },
    vBeamW: { min: 0.5, max: 12 },
    vBeamT: { min: 0.5, max: 12 },
    costHBeam: { min: 0, max: 1000 },
    costVBeam: { min: 0, max: 1000 },
    costBolt: { min: 0, max: 1000 },
    costBracket: { min: 0, max: 1000 },
    costSolarPanel: { min: 0, max: 10000 },
    foldAngle: { min: 5, max: 175 }
};

function validateInput(key, value) {
    const numVal = parseFloat(value);
    
    if (isNaN(numVal)) {
        return { valid: false, error: 'Invalid number', value: numVal };

const rule = VALIDATION_RULES[key];
    if (!rule) {
        return { valid: true, error: '', value: numVal };
    
    if (numVal < rule.min || numVal > rule.max) {
        return {
            valid: false,
            error: `Value must be between ${rule.min} and ${rule.max}`,
            value: clamp(numVal, rule.min, rule.max)
    
    return { valid: true, error: '', value: numVal };

function showToast(message, type = 'info', duration = 3000) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');