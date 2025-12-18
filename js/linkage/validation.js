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

function showToast(message, type = 'info', duration = 3000) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

function isFormElement(el) {
    if (!el) return false;
    const tagName = el.tagName;
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || tagName === 'BUTTON';
}

// ============================================================================
