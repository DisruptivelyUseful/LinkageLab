/**
 * Unit Conversion Utility
 * Provides consistent unit conversion between metric and imperial systems
 * Uses convert-units library (loaded via CDN)
 */

// Check if convert-units is available (loaded via CDN)
let convertUnits = null;

// Initialize convert-units when available
// The CDN version may expose it differently, so we'll try multiple approaches
function initializeConvertUnits() {
    // Try window.convertUnits first (if library exposes it globally)
    if (typeof window !== 'undefined' && window.convertUnits) {
        convertUnits = window.convertUnits;
        console.log('[unit-converter] convert-units library initialized from window.convertUnits');
        return;
    }
    
    // Try configureMeasurements (ES6 module style)
    if (typeof configureMeasurements !== 'undefined') {
        try {
            // Import measures if available as global variables
            const measures = {};
            if (typeof length !== 'undefined') measures.length = length;
            if (typeof mass !== 'undefined') measures.mass = mass;
            if (typeof volume !== 'undefined') measures.volume = volume;
            
            if (Object.keys(measures).length > 0) {
                convertUnits = configureMeasurements(measures);
                console.log('[unit-converter] convert-units library initialized with measures:', Object.keys(measures));
            } else {
                // Fallback: try with empty config (library might handle it)
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

// Try to initialize after scripts load
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
    
    // Try to detect from browser locale
    const locale = navigator.language || navigator.userLanguage;
    if (locale) {
        // Countries that primarily use metric
        const metricCountries = ['en-AU', 'en-CA', 'en-NZ', 'en-ZA', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'ru', 'ja', 'ko', 'zh'];
        const isMetric = metricCountries.some(country => locale.startsWith(country.split('-')[0]));
        return isMetric ? 'metric' : 'imperial';
    }
    
    // Default to imperial (current system)
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

/**
 * Convert length between units
 * @param {number} value - Value to convert
 * @param {string} fromUnit - Source unit (e.g., 'in', 'ft', 'm', 'cm', 'mm')
 * @param {string} toUnit - Target unit
 * @returns {number} Converted value
 */
function convertLength(value, fromUnit, toUnit) {
    if (value === null || value === undefined || isNaN(value)) {
        return 0;
    }
    
    if (fromUnit === toUnit) {
        return value;
    }
    
    if (convertUnits) {
        try {
            return convertUnits(value).from(fromUnit).to(toUnit);
        } catch (e) {
            console.warn(`[unit-converter] Conversion failed (${fromUnit} to ${toUnit}):`, e);
            return fallbackLengthConversion(value, fromUnit, toUnit);
        }
    }
    
    return fallbackLengthConversion(value, fromUnit, toUnit);
}

/**
 * Fallback length conversion (basic conversions)
 */
function fallbackLengthConversion(value, fromUnit, toUnit) {
    // Convert to meters first, then to target
    const toMeters = {
        'mm': 0.001,
        'cm': 0.01,
        'm': 1,
        'km': 1000,
        'in': 0.0254,
        'ft': 0.3048,
        'yd': 0.9144,
        'mi': 1609.344
    };
    
    const fromMeters = {
        'mm': 1000,
        'cm': 100,
        'm': 1,
        'km': 0.001,
        'in': 39.3701,
        'ft': 3.28084,
        'yd': 1.09361,
        'mi': 0.000621371
    };
    
    if (!toMeters[fromUnit] || !fromMeters[toUnit]) {
        console.warn(`[unit-converter] Unsupported units: ${fromUnit} to ${toUnit}`);
        return value;
    }
    
    const meters = value * toMeters[fromUnit];
    return meters * fromMeters[toUnit];
}

/**
 * Convert mass between units
 * @param {number} value - Value to convert
 * @param {string} fromUnit - Source unit (e.g., 'kg', 'g', 'lb', 'oz')
 * @param {string} toUnit - Target unit
 * @returns {number} Converted value
 */
function convertMass(value, fromUnit, toUnit) {
    if (value === null || value === undefined || isNaN(value)) {
        return 0;
    }
    
    if (fromUnit === toUnit) {
        return value;
    }
    
    if (convertUnits) {
        try {
            return convertUnits(value).from(fromUnit).to(toUnit);
        } catch (e) {
            console.warn(`[unit-converter] Mass conversion failed:`, e);
            return value;
        }
    }
    
    return value;
}

/**
 * Convert volume between units
 * @param {number} value - Value to convert
 * @param {string} fromUnit - Source unit (e.g., 'L', 'mL', 'gal', 'fl-oz')
 * @param {string} toUnit - Target unit
 * @returns {number} Converted value
 */
function convertVolume(value, fromUnit, toUnit) {
    if (value === null || value === undefined || isNaN(value)) {
        return 0;
    }
    
    if (fromUnit === toUnit) {
        return value;
    }
    
    if (convertUnits) {
        try {
            return convertUnits(value).from(fromUnit).to(toUnit);
        } catch (e) {
            console.warn(`[unit-converter] Volume conversion failed:`, e);
            return value;
        }
    }
    
    return value;
}

/**
 * Format length with appropriate unit label
 * @param {number} value - Value in source unit
 * @param {string} sourceUnit - Source unit (e.g., 'in', 'ft', 'm')
 * @param {number} precision - Decimal places (default: 2)
 * @returns {string} Formatted string with unit
 */
function formatLength(value, sourceUnit, precision = 2) {
    const system = getPreferredUnitSystem();
    let displayValue = value;
    let displayUnit = sourceUnit;
    
    // Convert to preferred system if needed
    if (system === 'metric') {
        if (sourceUnit === 'in' || sourceUnit === 'ft') {
            displayValue = convertLength(value, sourceUnit, 'm');
            displayUnit = 'm';
            // Use cm for small values
            if (displayValue < 1) {
                displayValue = convertLength(value, sourceUnit, 'cm');
                displayUnit = 'cm';
            }
        }
    } else {
        if (sourceUnit === 'm' || sourceUnit === 'cm' || sourceUnit === 'mm') {
            displayValue = convertLength(value, sourceUnit, 'ft');
            displayUnit = 'ft';
            // Use inches for small values
            if (displayValue < 1) {
                displayValue = convertLength(value, sourceUnit, 'in');
                displayUnit = 'in';
            }
        }
    }
    
    const unitLabels = {
        'm': 'm',
        'cm': 'cm',
        'mm': 'mm',
        'ft': 'ft',
        'in': 'in',
        'yd': 'yd'
    };
    
    return `${displayValue.toFixed(precision)} ${unitLabels[displayUnit] || displayUnit}`;
}

// Convenience wrapper functions for common conversions
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
    convertLength: convertLength,
    convertMass: convertMass,
    convertVolume: convertVolume,
    formatLength: formatLength,
    
    // User preferences
    getPreferredUnitSystem: getPreferredUnitSystem,
    setPreferredUnitSystem: setPreferredUnitSystem
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = unitConverter;
}

