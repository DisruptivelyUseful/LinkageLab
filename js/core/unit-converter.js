/**
 * Unit Conversion Utility
 * Provides consistent unit conversion between metric and imperial systems
 * State always remains in imperial (inches/feet/lbs). The UI layer converts
 * to/from metric for display and input when metric mode is active.
 */

// Check if convert-units is available (loaded via CDN)
let convertUnits = null;

function initializeConvertUnits() {
    if (typeof window !== 'undefined' && window.convertUnits) {
        convertUnits = window.convertUnits;
        console.log('[unit-converter] convert-units library initialized from window.convertUnits');
        return;
    }
    if (typeof configureMeasurements !== 'undefined') {
        try {
            const measures = {};
            if (typeof length !== 'undefined') measures.length = length;
            if (typeof mass !== 'undefined') measures.mass = mass;
            if (typeof volume !== 'undefined') measures.volume = volume;
            if (Object.keys(measures).length > 0) {
                convertUnits = configureMeasurements(measures);
                console.log('[unit-converter] convert-units library initialized with measures:', Object.keys(measures));
            } else {
                try {
                    convertUnits = configureMeasurements({ length: {} });
                    console.log('[unit-converter] convert-units library initialized (minimal config)');
                } catch (e2) {
                    console.warn('[unit-converter] Could not initialize convert-units, using fallback conversions');
                }
            }
        } catch (e) {
            console.warn('[unit-converter] Failed to initialize convert-units:', e);
        }
    }
}

if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(initializeConvertUnits, 200);
        });
    } else {
        setTimeout(initializeConvertUnits, 200);
    }
}

/**
 * Get user's preferred unit system
 * @returns {string} 'metric' or 'imperial'
 */
function getPreferredUnitSystem() {
    const stored = localStorage.getItem('preferredUnitSystem');
    if (stored === 'metric' || stored === 'imperial') {
        return stored;
    }
    const locale = navigator.language || navigator.userLanguage;
    if (locale) {
        const metricCountries = ['en-AU', 'en-CA', 'en-NZ', 'en-ZA', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'ru', 'ja', 'ko', 'zh'];
        const isMetric = metricCountries.some(country => locale.startsWith(country.split('-')[0]));
        return isMetric ? 'metric' : 'imperial';
    }
    return 'imperial';
}

/**
 * Set user's preferred unit system
 * @param {string} system - 'metric' or 'imperial'
 */
function setPreferredUnitSystem(system) {
    if (system === 'metric' || system === 'imperial') {
        localStorage.setItem('preferredUnitSystem', system);
        console.log('[unit-converter] Preferred unit system set to:', system);
    } else {
        console.warn('[unit-converter] Invalid unit system:', system);
    }
}

// ============================================================================
// CORE CONVERSION FUNCTIONS
// ============================================================================

function convertLength(value, fromUnit, toUnit) {
    if (value === null || value === undefined || isNaN(value)) return 0;
    if (fromUnit === toUnit) return value;
    if (convertUnits) {
        try { return convertUnits(value).from(fromUnit).to(toUnit); }
        catch (e) { return fallbackLengthConversion(value, fromUnit, toUnit); }
    }
    return fallbackLengthConversion(value, fromUnit, toUnit);
}

function fallbackLengthConversion(value, fromUnit, toUnit) {
    const toMeters = {
        'mm': 0.001, 'cm': 0.01, 'm': 1, 'km': 1000,
        'in': 0.0254, 'ft': 0.3048, 'yd': 0.9144, 'mi': 1609.344
    };
    const fromMeters = {
        'mm': 1000, 'cm': 100, 'm': 1, 'km': 0.001,
        'in': 39.3701, 'ft': 3.28084, 'yd': 1.09361, 'mi': 0.000621371
    };
    if (!toMeters[fromUnit] || !fromMeters[toUnit]) {
        console.warn(`[unit-converter] Unsupported units: ${fromUnit} to ${toUnit}`);
        return value;
    }
    return value * toMeters[fromUnit] * fromMeters[toUnit];
}

function convertMass(value, fromUnit, toUnit) {
    if (value === null || value === undefined || isNaN(value)) return 0;
    if (fromUnit === toUnit) return value;
    if (convertUnits) {
        try { return convertUnits(value).from(fromUnit).to(toUnit); }
        catch (e) { return value; }
    }
    return value;
}

function convertVolume(value, fromUnit, toUnit) {
    if (value === null || value === undefined || isNaN(value)) return 0;
    if (fromUnit === toUnit) return value;
    if (convertUnits) {
        try { return convertUnits(value).from(fromUnit).to(toUnit); }
        catch (e) { return value; }
    }
    return value;
}

function formatLength(value, sourceUnit, precision = 2) {
    const system = getPreferredUnitSystem();
    let displayValue = value;
    let displayUnit = sourceUnit;
    if (system === 'metric') {
        if (sourceUnit === 'in' || sourceUnit === 'ft') {
            displayValue = convertLength(value, sourceUnit, 'm');
            displayUnit = 'm';
            if (displayValue < 1) {
                displayValue = convertLength(value, sourceUnit, 'cm');
                displayUnit = 'cm';
            }
        }
    } else {
        if (sourceUnit === 'm' || sourceUnit === 'cm' || sourceUnit === 'mm') {
            displayValue = convertLength(value, sourceUnit, 'ft');
            displayUnit = 'ft';
            if (displayValue < 1) {
                displayValue = convertLength(value, sourceUnit, 'in');
                displayUnit = 'in';
            }
        }
    }
    const unitLabels = { 'm': 'm', 'cm': 'cm', 'mm': 'mm', 'ft': 'ft', 'in': 'in', 'yd': 'yd' };
    return `${displayValue.toFixed(precision)} ${unitLabels[displayUnit] || displayUnit}`;
}

// ============================================================================
// UI UNIT SYSTEM - State ↔ Display Conversion Layer
// ============================================================================

const FT_TO_M = 0.3048;
const M_TO_FT = 1 / FT_TO_M;
const IN_TO_MM = 25.4;
const MM_TO_IN = 1 / IN_TO_MM;
const LBS_TO_KG = 0.453592;
const KG_TO_LBS = 1 / LBS_TO_KG;

/** Imperial unit for each state key that has a physical unit */
const STATE_UNIT_MAP = {
    hLengthFt: 'ft', vLengthFt: 'ft',
    hBeamW: 'in', hBeamT: 'in', vBeamW: 'in', vBeamT: 'in',
    offsetTopIn: 'in', offsetBotIn: 'in', vertEndOffset: 'in',
    hStackGap: 'in', vStackGap: 'in',
    bracketWidth: 'in', bracketDepth: 'in', bracketHeight: 'in',
    bracketWallThickness: 'in', bracketInnerWidth: 'in',
    bracketHoleDiameter: 'in', bracketHoleDistance: 'in',
};

/** Imperial unit for each input element ID (covers inputs outside idMap too) */
const INPUT_UNIT_MAP = {
    'sl-len': 'ft', 'nb-len': 'ft',
    'sl-vlen': 'ft', 'nb-vlen': 'ft',
    'nb-ref-beam-len': 'ft',
    'nb-hbeam-w': 'in', 'nb-hbeam-t': 'in',
    'nb-vbeam-w': 'in', 'nb-vbeam-t': 'in',
    'sl-off-top': 'in', 'nb-off-top': 'in',
    'sl-off-bot': 'in', 'nb-off-bot': 'in',
    'sl-vert-end': 'in', 'nb-vert-end': 'in',
    'sl-hgap': 'in', 'nb-hgap': 'in',
    'sl-vgap': 'in', 'nb-vgap': 'in',
    'nb-bracket-width': 'in', 'nb-bracket-depth': 'in',
    'nb-bracket-height': 'in', 'nb-bracket-wall': 'in',
    'nb-bracket-inner': 'in', 'nb-bracket-hole-distance': 'in',
    'nb-vbolt-length': 'in', 'nb-vbolt-inner-length': 'in',
    'nb-vbolt-outer-length': 'in', 'nb-hbolt-length': 'in',
    'nb-hpivot-bolt-length': 'in',
    'nb-vwasher-id': 'in', 'nb-vwasher-od': 'in', 'nb-vwasher-thickness': 'in',
    'nb-hwasher-id': 'in', 'nb-hwasher-od': 'in', 'nb-hwasher-thickness': 'in',
    'nb-ref-beam-w': 'in', 'nb-ref-beam-t': 'in',
};

/** Metric equivalent for imperial units */
const METRIC_EQUIVALENT = { 'ft': 'm', 'in': 'mm' };

/** Conversion factor from imperial to metric display unit */
const TO_METRIC_FACTOR = { 'ft': FT_TO_M, 'in': IN_TO_MM };

/** Conversion factor from metric display unit back to imperial */
const FROM_METRIC_FACTOR = { 'm': M_TO_FT, 'mm': MM_TO_IN };

/**
 * Convert imperial state value to display value
 * @param {number} imperialValue - Value in imperial units
 * @param {string} imperialUnit - 'ft' or 'in'
 * @returns {number} Display value (metric or imperial depending on current system)
 */
function imperialToDisplay(imperialValue, imperialUnit) {
    if (getPreferredUnitSystem() !== 'metric') return imperialValue;
    return imperialValue * (TO_METRIC_FACTOR[imperialUnit] || 1);
}

/**
 * Convert display value back to imperial state value
 * @param {number} displayValue - Value as shown in UI
 * @param {string} imperialUnit - The imperial unit this control natively uses ('ft' or 'in')
 * @returns {number} Imperial value for state storage
 */
function displayToImperial(displayValue, imperialUnit) {
    if (getPreferredUnitSystem() !== 'metric') return displayValue;
    const metricUnit = METRIC_EQUIVALENT[imperialUnit];
    return displayValue * (FROM_METRIC_FACTOR[metricUnit] || 1);
}

/** Get display unit label string */
function getDisplayUnit(imperialUnit) {
    if (getPreferredUnitSystem() !== 'metric') return imperialUnit;
    return METRIC_EQUIVALENT[imperialUnit] || imperialUnit;
}

/** Get imperial unit for a state key, or null */
function getUnitForStateKey(key) {
    return STATE_UNIT_MAP[key] || null;
}

/** Get imperial unit for an input element ID, or null */
function getUnitForInput(inputId) {
    return INPUT_UNIT_MAP[inputId] || null;
}

/**
 * Convert state value → display value for a given state key.
 * Returns the original value if the key has no unit mapping.
 */
function stateToDisplay(key, value) {
    const unit = STATE_UNIT_MAP[key];
    if (!unit) return value;
    return imperialToDisplay(value, unit);
}

/**
 * Convert display value → imperial state value for a given state key.
 * Returns the original value if the key has no unit mapping.
 */
function displayToState(key, value) {
    const unit = STATE_UNIT_MAP[key];
    if (!unit) return value;
    return displayToImperial(value, unit);
}

/**
 * Convert an input element value (by its ID) from display to imperial.
 */
function inputDisplayToImperial(inputId, value) {
    const unit = INPUT_UNIT_MAP[inputId];
    if (!unit) return value;
    return displayToImperial(value, unit);
}

// ============================================================================
// FORMATTING HELPERS (unit-aware)
// ============================================================================

/**
 * Trim trailing zeros from a fixed-decimal numeric string (e.g. "1.750" → "1.75", "3.00" → "3").
 * @param {string} s
 * @returns {string}
 */
function trimTrailingZerosFromDecimalString(s) {
    if (typeof s !== 'string' || s.indexOf('.') < 0) return s;
    return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/**
 * Format a decimal inch value for display with enough precision for shop dims (e.g. 1.75" not 1.8").
 * @param {number} inches
 * @param {number} maxDecimals - cap on toFixed (default 4)
 */
function formatDecimalInchesTrimmed(inches, maxDecimals) {
    if (inches === null || inches === undefined || isNaN(inches)) return '—';
    const md = typeof maxDecimals === 'undefined' ? 4 : Math.min(8, Math.max(0, maxDecimals));
    const fn = (typeof formatNumber === 'function') ? formatNumber : (v, d) => Number(v).toFixed(d);
    return trimTrailingZerosFromDecimalString(fn(inches, md));
}

/**
 * Format a weight in lbs to the current display system.
 * Requires formatNumber to be available globally.
 */
function formatWeightWithUnit(lbs, precision) {
    if (typeof precision === 'undefined') precision = 1;
    const fn = (typeof formatNumber === 'function') ? formatNumber : (v, d) => v.toFixed(d);
    if (getPreferredUnitSystem() === 'metric') {
        return fn(lbs * LBS_TO_KG, precision) + ' kg';
    }
    return fn(lbs, precision) + ' lbs';
}

/**
 * Format a dimension in inches to the current display system.
 * Imperial: uses at least 2 decimal places when precision is below 2 so values like 1.75" do not round to 1.8".
 */
function formatDimensionWithUnit(inches, precision) {
    if (inches === null || inches === undefined || isNaN(inches)) return '—';
    const fn = (typeof formatNumber === 'function') ? formatNumber : (v, d) => v.toFixed(d);
    if (getPreferredUnitSystem() === 'metric') {
        if (typeof precision === 'undefined') precision = 1;
        return fn(inches * IN_TO_MM, precision) + ' mm';
    }
    const dec = typeof precision === 'undefined' ? 2 : (precision < 2 ? 2 : precision);
    return trimTrailingZerosFromDecimalString(fn(inches, dec)) + '"';
}

/**
 * Format a length in feet to the current display system.
 */
function formatFeetWithUnit(feet, precision) {
    if (typeof precision === 'undefined') precision = 2;
    const fn = (typeof formatNumber === 'function') ? formatNumber : (v, d) => v.toFixed(d);
    if (getPreferredUnitSystem() === 'metric') {
        return fn(feet * FT_TO_M, precision) + ' m';
    }
    return fn(feet, precision) + "'";
}

/**
 * Format inches as feet or meters (for height/diameter stats).
 */
function formatInchesAsLargeUnit(inches, precision) {
    if (typeof precision === 'undefined') precision = 2;
    const fn = (typeof formatNumber === 'function') ? formatNumber : (v, d) => v.toFixed(d);
    if (getPreferredUnitSystem() === 'metric') {
        return fn(inches * 0.0254, precision) + ' m';
    }
    return fn(inches / 12, precision) + "'";
}

// ============================================================================
// UI UPDATE HELPERS
// ============================================================================

/**
 * Round a value to a "nice" metric step.
 */
function niceMetricStep(rawStep) {
    if (rawStep <= 0.01) return 0.01;
    if (rawStep <= 0.025) return 0.02;
    if (rawStep <= 0.075) return 0.05;
    if (rawStep <= 0.15) return 0.1;
    if (rawStep <= 0.35) return 0.25;
    if (rawStep <= 0.75) return 0.5;
    if (rawStep <= 1.5) return 1;
    if (rawStep <= 3.5) return 2;
    if (rawStep <= 7.5) return 5;
    if (rawStep <= 15) return 10;
    if (rawStep <= 35) return 25;
    return Math.round(rawStep / 10) * 10;
}

/**
 * Store original imperial input properties before any conversion.
 * Called once at startup.
 */
function storeOriginalInputProps() {
    Object.keys(INPUT_UNIT_MAP).forEach(inputId => {
        const el = document.getElementById(inputId);
        if (!el) return;
        if (el._imperialProps) return; // already stored
        el._imperialProps = {
            min: el.min !== '' ? parseFloat(el.min) : null,
            max: el.max !== '' ? parseFloat(el.max) : null,
            step: el.step !== '' ? parseFloat(el.step) : null,
        };
    });
}

/**
 * Update the min/max/step of all unit-bearing inputs for the current unit system.
 */
function updateInputRanges() {
    const isMetric = getPreferredUnitSystem() === 'metric';

    Object.keys(INPUT_UNIT_MAP).forEach(inputId => {
        const el = document.getElementById(inputId);
        if (!el) return;
        const props = el._imperialProps;
        if (!props) return;
        const impUnit = INPUT_UNIT_MAP[inputId];
        const factor = TO_METRIC_FACTOR[impUnit] || 1;

        if (isMetric) {
            if (props.min !== null) el.min = +(props.min * factor).toPrecision(6);
            if (props.max !== null) el.max = +(props.max * factor).toPrecision(6);
            if (props.step !== null) el.step = niceMetricStep(props.step * factor);
        } else {
            if (props.min !== null) el.min = props.min;
            if (props.max !== null) el.max = props.max;
            if (props.step !== null) el.step = props.step;
        }
    });
}

/**
 * Update all unit label text in .ctrl-head spans throughout the sidebar.
 * Also updates standalone unit labels (ref beam section, etc.).
 */
function updateAllUnitLabels() {
    const isMetric = getPreferredUnitSystem() === 'metric';

    // Update ctrl-head unit labels (the last <span> in each .ctrl-head)
    document.querySelectorAll('.ctrl-head').forEach(head => {
        const spans = head.querySelectorAll('span');
        if (spans.length < 2) return;
        const unitSpan = spans[spans.length - 1];
        const text = unitSpan.textContent.trim();
        if (text === 'ft' || text === 'm') {
            unitSpan.textContent = isMetric ? 'm' : 'ft';
        } else if (text === 'in' || text === 'mm') {
            unitSpan.textContent = isMetric ? 'mm' : 'in';
        }
    });

    // Update ref beam section inline unit labels
    document.querySelectorAll('#ref-beam-pricing span').forEach(span => {
        const t = span.textContent.trim();
        if (t === 'in' || t === 'mm') span.textContent = isMetric ? 'mm' : 'in';
        if (t === 'ft' || t === 'm') span.textContent = isMetric ? 'm' : 'ft';
    });

    // Update weight total label ("lbs" / "kg" after bom-weight-total)
    const weightTotalWrapper = document.getElementById('bom-weight-total');
    if (weightTotalWrapper && weightTotalWrapper.parentNode) {
        const parent = weightTotalWrapper.parentNode;
        // The text node after the span says " lbs" or " kg"
        for (let node of parent.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                const t = node.textContent.trim();
                if (t === 'lbs' || t === 'kg') {
                    node.textContent = isMetric ? ' kg' : ' lbs';
                }
            }
        }
    }

    // Update Human for Scale label
    const humanLabel = document.querySelector('#chk-human-scale')?.parentElement;
    if (humanLabel) {
        const labelText = humanLabel.childNodes;
        for (let node of labelText) {
            if (node.nodeType === Node.TEXT_NODE && (node.textContent.includes("6'") || node.textContent.includes('1.83m'))) {
                node.textContent = isMetric ? ' Show Human for Scale (1.83m)' : " Show Human for Scale (6')";
            }
        }
    }
}

/**
 * Update select dropdown labels for bolt/hole diameter.
 */
function updateSelectLabels() {
    const isMetric = getPreferredUnitSystem() === 'metric';

    const imperialFractions = {
        0.25: '1/4"', 0.3125: '5/16"', 0.375: '3/8"',
        0.5: '1/2"', 0.625: '5/8"', 0.75: '3/4"'
    };
    const metricLabels = {
        0.25: '6.4 mm', 0.3125: '7.9 mm', 0.375: '9.5 mm',
        0.5: '12.7 mm', 0.625: '15.9 mm', 0.75: '19.1 mm'
    };

    ['sel-bracket-hole-diameter', 'sel-bolt-diameter'].forEach(selId => {
        const sel = document.getElementById(selId);
        if (!sel) return;
        for (const opt of sel.options) {
            const val = parseFloat(opt.value);
            if (isMetric && metricLabels[val]) {
                opt.textContent = metricLabels[val];
            } else if (!isMetric && imperialFractions[val]) {
                opt.textContent = imperialFractions[val];
            }
        }
    });
}

/**
 * Refresh all special (non-idMap) input values for the current unit system.
 * Call this after toggling units. It reads the imperial state values and writes
 * the display values to the input elements.
 */
function refreshSpecialInputValues() {
    const isMetric = getPreferredUnitSystem() === 'metric';

    const specialInputs = {
        'nb-vbolt-length': () => typeof state !== 'undefined' ? state.vBoltLength : null,
        'nb-vbolt-inner-length': () => typeof state !== 'undefined' ? state.vBoltInnerLength : null,
        'nb-vbolt-outer-length': () => typeof state !== 'undefined' ? state.vBoltOuterLength : null,
        'nb-hbolt-length': () => typeof state !== 'undefined' ? state.hBoltLength : null,
        'nb-hpivot-bolt-length': () => typeof state !== 'undefined' ? state.hPivotBoltLength : null,
        'nb-vwasher-id': () => typeof state !== 'undefined' ? state.vWasherID : null,
        'nb-vwasher-od': () => typeof state !== 'undefined' ? state.vWasherOD : null,
        'nb-vwasher-thickness': () => typeof state !== 'undefined' ? state.vWasherThickness : null,
        'nb-hwasher-id': () => typeof state !== 'undefined' ? state.hWasherID : null,
        'nb-hwasher-od': () => typeof state !== 'undefined' ? state.hWasherOD : null,
        'nb-hwasher-thickness': () => typeof state !== 'undefined' ? state.hWasherThickness : null,
        'nb-ref-beam-w': () => typeof state !== 'undefined' ? state.refBeamWidth : null,
        'nb-ref-beam-t': () => typeof state !== 'undefined' ? state.refBeamThick : null,
        'nb-ref-beam-len': () => typeof state !== 'undefined' ? state.refBeamLength : null,
    };

    Object.keys(specialInputs).forEach(inputId => {
        const el = document.getElementById(inputId);
        if (!el) return;
        const imperialVal = specialInputs[inputId]();
        if (imperialVal === null || imperialVal === undefined) return;
        const impUnit = INPUT_UNIT_MAP[inputId];
        if (!impUnit) return;
        const displayVal = imperialToDisplay(imperialVal, impUnit);
        const decimals = impUnit === 'ft' ? 2 : (displayVal < 10 ? 2 : 1);
        el.value = +displayVal.toFixed(decimals);
    });
}

/**
 * Format a bolt spec string respecting the current unit system.
 * @param {number} diameterInches - Bolt diameter in inches
 * @param {number} lengthInches - Bolt length in inches
 * @returns {string} Formatted spec like '(3/8" × 3.00")' or '(9.5mm × 76.2mm)'
 */
function formatBoltSpec(diameterInches, lengthInches) {
    if (getPreferredUnitSystem() === 'metric') {
        const dMm = (diameterInches * IN_TO_MM).toFixed(1);
        const lMm = (lengthInches * IN_TO_MM).toFixed(1);
        return `(${dMm}mm × ${lMm}mm)`;
    }
    const fractions = {
        0.25: '1/4', 0.3125: '5/16', 0.375: '3/8',
        0.5: '1/2', 0.625: '5/8', 0.75: '3/4'
    };
    const fn = (typeof formatNumber === 'function') ? formatNumber : (v, d) => v.toFixed(d);
    const dFrac = fractions[diameterInches] || fn(diameterInches, 3);
    return `(${dFrac}" × ${fn(lengthInches, 2)}")`;
}

/**
 * Format beam dimensions for cost section display.
 * @param {number} lengthFt - Beam length in feet
 * @param {number} widthIn - Beam width in inches
 * @param {number} thickIn - Beam thickness in inches
 * @returns {string} e.g. "8' × 3.5×1.5"" or "2.44m × 89×38mm"
 */
/**
 * Format a force in lbs to the current display system.
 * @param {number} lbs - Force in pound-force
 * @param {number} precision
 * @returns {string} e.g. "450 lbs" or "2,002 N"
 */
function formatForceWithUnit(lbs, precision) {
    if (typeof precision === 'undefined') precision = 0;
    const fn = (typeof formatNumber === 'function') ? formatNumber : (v, d) => v.toFixed(d);
    if (getPreferredUnitSystem() === 'metric') {
        return fn(lbs * 4.44822, precision) + ' N';
    }
    return fn(lbs, precision) + ' lbs';
}

function formatBeamSpecForCost(lengthFt, widthIn, thickIn) {
    const fn = (typeof formatNumber === 'function') ? formatNumber : (v, d) => v.toFixed(d);
    if (getPreferredUnitSystem() === 'metric') {
        const lM = fn(lengthFt * FT_TO_M, 2);
        const wMm = fn(widthIn * IN_TO_MM, 0);
        const tMm = fn(thickIn * IN_TO_MM, 0);
        return `${lM}m × ${wMm}×${tMm}mm`;
    }
    const w = trimTrailingZerosFromDecimalString(fn(widthIn, 2));
    const t = trimTrailingZerosFromDecimalString(fn(thickIn, 2));
    const lf = trimTrailingZerosFromDecimalString(fn(lengthFt, 2));
    return `${lf}' × ${w}×${t}"`;
}

/**
 * Master function to apply the current unit system to the entire UI.
 * Call this after toggling the unit system preference.
 */
function applyUnitSystemToUI() {
    storeOriginalInputProps();
    updateInputRanges();
    updateAllUnitLabels();
    updateSelectLabels();
    refreshSpecialInputValues();
}

// ============================================================================
// CONVENIENCE WRAPPER
// ============================================================================

const unitConverter = {
    // Length conversions
    inchesToMeters: (inches) => convertLength(inches, 'in', 'm'),
    metersToInches: (meters) => convertLength(meters, 'm', 'in'),
    feetToMeters: (feet) => convertLength(feet, 'ft', 'm'),
    metersToFeet: (meters) => convertLength(meters, 'm', 'ft'),
    inchesToFeet: (inches) => convertLength(inches, 'in', 'ft'),
    feetToInches: (feet) => convertLength(feet, 'ft', 'in'),
    centimetersToInches: (cm) => convertLength(cm, 'cm', 'in'),
    inchesToCentimeters: (inches) => convertLength(inches, 'in', 'cm'),

    // Generic conversions
    convertLength, convertMass, convertVolume, formatLength,

    // UI unit system
    getPreferredUnitSystem, setPreferredUnitSystem,
    imperialToDisplay, displayToImperial, getDisplayUnit,
    getUnitForStateKey, getUnitForInput,
    stateToDisplay, displayToState,
    inputDisplayToImperial,
    formatWeightWithUnit, formatDimensionWithUnit, formatForceWithUnit,
    trimTrailingZerosFromDecimalString, formatDecimalInchesTrimmed,
    formatFeetWithUnit, formatInchesAsLargeUnit,
    formatBoltSpec, formatBeamSpecForCost,
    applyUnitSystemToUI, storeOriginalInputProps,
    updateInputRanges, updateAllUnitLabels,
    updateSelectLabels, refreshSpecialInputValues,

    // Constants
    FT_TO_M, M_TO_FT, IN_TO_MM, MM_TO_IN, LBS_TO_KG, KG_TO_LBS,
    STATE_UNIT_MAP, INPUT_UNIT_MAP,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = unitConverter;
}
