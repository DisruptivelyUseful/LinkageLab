import { describe, expect, it } from 'vitest';
import { validateInput, VALIDATION_RULES } from '../js/linkage/validation.js';

describe('validation', () => {
    it('exposes rules for core structure keys', () => {
        expect(VALIDATION_RULES.modules).toEqual({ min: 3, max: 40 });
        expect(VALIDATION_RULES.hLengthFt).toEqual({ min: 2, max: 24 });
    });

    it('accepts in-range values', () => {
        const result = validateInput('modules', 12);
        expect(result.valid).toBe(true);
        expect(result.value).toBe(12);
        expect(result.error).toBe('');
    });

    it('rejects out-of-range values and clamps', () => {
        const result = validateInput('modules', 99);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('between 3 and 40');
        expect(result.value).toBe(40);
    });

    it('rejects non-numeric input', () => {
        const result = validateInput('modules', 'abc');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid number');
    });

    it('passes through unknown keys without rules', () => {
        const result = validateInput('customKey', 42);
        expect(result.valid).toBe(true);
        expect(result.value).toBe(42);
    });
});
