// ============================================================================ (ES module)

import { bridgeGlobals } from './global-bridge.js';
import { clamp } from './math.js';

    // ============================================================================
    // INPUT VALIDATION
    // ============================================================================
    
    /** Input validation rules mapping state keys to min/max values */
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
        hStackGap: { min: -2.0, max: 1 },
        vStackGap: { min: -2.0, max: 1 },
        bracketWidth: { min: 0.5, max: 6 },
        bracketDepth: { min: 0.5, max: 6 },
        bracketHeight: { min: 0.5, max: 12 },
        bracketWallThickness: { min: 0.1, max: 1 },
        bracketInnerWidth: { min: 0.5, max: 5 },
        bracketHoleDiameter: { min: 0.25, max: 0.75 },
        bracketHoleDistance: { min: 0.5, max: 12 },  // Distance from bracket base (closed end) to hole center
        bracketZRotation: { min: -180, max: 180 },
        hBeamW: { min: 0.5, max: 12 },
        hBeamT: { min: 0.5, max: 12 },
        vBeamW: { min: 0.5, max: 12 },
        vBeamT: { min: 0.5, max: 12 },
        vBeamInnerW: { min: 0.5, max: 12 },
        vBeamInnerT: { min: 0.5, max: 12 },
        vBeamOuterW: { min: 0.5, max: 12 },
        vBeamOuterT: { min: 0.5, max: 12 },
        costHBeam: { min: 0, max: 1000 },
        costVBeam: { min: 0, max: 1000 },
        costBolt: { min: 0, max: 1000 },
        costBracket: { min: 0, max: 1000 },
        costSolarPanel: { min: 0, max: 10000 },
        refBeamWidth: { min: 0.5, max: 12 },
        refBeamThick: { min: 0.5, max: 12 },
        refBeamLength: { min: 1, max: 24 },
        refBeamPrice: { min: 0.01, max: 1000 },
        foldAngle: { min: 5, max: 175 }
    };
    
    /**
     * Validates an input value against its rules
     * @param {string} key - State key to validate
     * @param {number} value - Value to validate
     * @returns {{valid: boolean, error: string, value: number}} Validation result
     */
    function validateInput(key, value) {
        const numVal = parseFloat(value);
        
        if (isNaN(numVal)) {
            return { valid: false, error: 'Invalid number', value: numVal };
        }
        
        const rule = VALIDATION_RULES[key];
        if (!rule) {
            return { valid: true, error: '', value: numVal };
        }
        
        if (numVal < rule.min || numVal > rule.max) {
            return {
                valid: false,
                error: `Value must be between ${rule.min} and ${rule.max}`,
                value: clamp(numVal, rule.min, rule.max)
            };
        }
        
        return { valid: true, error: '', value: numVal };
    }
    


const _moduleExports = {
    validateInput,
    VALIDATION_RULES,
};

bridgeGlobals(_moduleExports, 'validation');

export { validateInput, VALIDATION_RULES };
