// ============================================================================
// LINKAGE LAB - Numeric input binding (ES module)
//
// Number boxes commit on `change` only: blur, Enter, arrow-key stepping and the
// custom spin buttons. Typing never commits and never rewrites the field, so a
// user can enter "12.35" without the app snapping the value mid-keystroke.
// Escape restores the last committed value.
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';

function parseNumber(raw) {
    const v = typeof raw === 'number' ? raw : parseFloat(raw);
    return Number.isFinite(v) ? v : null;
}

/**
 * @param {HTMLInputElement|null} input
 * @param {object} options
 * @param {(value:number, input:HTMLInputElement)=>void} [options.commit] called with the parsed, clamped value
 * @param {number|(()=>number)} [options.fallback] used when the field is empty or not a number
 * @param {number} [options.min]
 * @param {number} [options.max]
 * @param {(value:number)=>string} [options.format] how to write the committed value back
 */
function bindNumericInput(input, options = {}) {
    if (!input || input.dataset.numericBound === 'true') return;
    input.dataset.numericBound = 'true';
    const { commit, fallback, min, max, format } = options;
    let lastCommitted = input.value;

    const clamp = (v) => {
        let out = v;
        if (Number.isFinite(min)) out = Math.max(min, out);
        if (Number.isFinite(max)) out = Math.min(max, out);
        return out;
    };

    input.addEventListener('input', () => {
        // Only mark as editing while the user is actually typing in the field;
        // programmatic input events (spin buttons) do not leave a stale flag.
        if (document.activeElement === input) input.classList.add('editing');
    });

    input.addEventListener('change', () => {
        let v = parseNumber(input.value);
        if (v === null) {
            const fb = typeof fallback === 'function' ? fallback() : fallback;
            v = parseNumber(fb);
            if (v === null) v = parseNumber(lastCommitted);
        }
        input.classList.remove('editing');
        if (v === null) {
            input.value = lastCommitted;
            return;
        }
        v = clamp(v);
        input.value = format ? format(v) : String(v);
        lastCommitted = input.value;
        if (commit) commit(v, input);
        // The commit handler may have re-synced the field (syncUI); adopt that as the baseline.
        lastCommitted = input.value;
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (e.key === 'Escape') {
            e.preventDefault();
            input.value = lastCommitted;
            input.classList.remove('editing');
            input.blur();
        }
    });

    input.addEventListener('blur', () => input.classList.remove('editing'));

    // Code that writes the field directly (syncUI) calls this so Escape restores the right value.
    input._numericSetBaseline = () => { lastCommitted = input.value; };
}

/** True while the user is typing in this field (so sync code must not overwrite it). */
function isEditingNumericInput(el) {
    return !!el && el === document.activeElement && el.classList.contains('editing');
}

/** Write a value into a bound number input without disturbing an in-progress edit. */
function setNumericInputValue(el, value, { force = false } = {}) {
    if (!el) return false;
    if (!force && isEditingNumericInput(el)) return false;
    el.value = value;
    if (typeof el._numericSetBaseline === 'function') el._numericSetBaseline();
    return true;
}

const _moduleExports = { bindNumericInput, isEditingNumericInput, setNumericInputValue };
bridgeGlobals(_moduleExports, 'numericInput');

export { bindNumericInput, isEditingNumericInput, setNumericInputValue };
