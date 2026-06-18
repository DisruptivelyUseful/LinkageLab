// ============================================================================
// High-detail hardware → legacy structure spacing overrides (Phase 4)
// When full detail is enabled, stack gaps and bracket dimensions used by the
// linkage solver are derived from parametric assembly stacks (center-slot
// washers + coupled beam standoffs on sandwich axes).
// Legacy state values remain stored and apply when full detail is off.
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import {
    ensureHardwareAssemblies,
    hwAssemblyHasParts,
    hwGetAssemblyById,
    hwGetAssemblySandwichGap,
    hwGetOuterVBeamAssembly,
    hwUseFullDetailAssemblies,
} from './hardware-detail.js';

function hwAverageGapFromAssemblySpan(span, stackCount) {
    const n = stackCount || 1;
    if (n <= 1 || span <= 0) return null;
    return span / (n - 1);
}

function hwGapFromAssembly(assembly, stackCount) {
    if (!assembly?.parts?.length) return null;
    const span = hwGetAssemblySandwichGap(assembly);
    if (span <= 0) return null;
    return hwAverageGapFromAssemblySpan(span, stackCount);
}

/** Effective V-stack gap between vertical beams (inches). */
function hwGetEffectiveVStackGap() {
    if (!state.showHardwareFullDetail) return state.vStackGap || 0;
    const stackCount = state.vStackCount || 3;
    if (stackCount <= 1) return 0;

    if (hwAssemblyHasParts('vCenter')) {
        const gap = hwGapFromAssembly(hwGetAssemblyById('vCenter'), stackCount);
        if (gap != null) return gap;
    }

    return state.vStackGap || 0;
}

/** Effective H-stack gap between horizontal beams (inches). */
function hwGetEffectiveHStackGap() {
    if (!state.showHardwareFullDetail) return state.hStackGap || 0;
    const stackCount = state.hStackCount || 1;
    if (stackCount <= 1) return 0;

    if (hwAssemblyHasParts('hCenter')) {
        const gap = hwGapFromAssembly(hwGetAssemblyById('hCenter'), stackCount);
        if (gap != null) return gap;
    }

    if (hwUseFullDetailAssemblies()) {
        const gap = hwGapFromAssembly(hwGetOuterVBeamAssembly(), stackCount);
        if (gap != null) return gap;
    }

    return state.hStackGap || 0;
}

/** Bracket dimensions from the outer V-beam assembly bracket part, or null for legacy state. */
function hwGetEffectiveBracketParams() {
    if (!hwUseFullDetailAssemblies()) return null;
    ensureHardwareAssemblies();
    const bracketPart = hwGetOuterVBeamAssembly()?.parts?.find(p => p.type === 'bracket');
    if (!bracketPart?.params) return null;
    const bp = bracketPart.params;
    const height = bp.height ?? state.bracketHeight ?? 3.0;
    const wall = bp.wallThickness ?? state.bracketWallThickness ?? 0.25;
    const width = bp.width ?? state.bracketWidth ?? 2.0;
    const fromTop = bp.sideHoleFromTop != null ? bp.sideHoleFromTop : 1.1875;
    return {
        bracketWidth: width,
        bracketDepth: bp.depth ?? state.bracketDepth ?? 3.0,
        bracketHeight: height,
        bracketWallThickness: wall,
        bracketHoleDiameter: bp.holeDiameter ?? state.bracketHoleDiameter ?? 0.375,
        bracketHoleDistance: height - fromTop,
        bracketInnerWidth: bp.innerWidth ?? Math.max(0.25, width - 2 * wall),
    };
}

/** Resolved spacing values consumed by the linkage solver / geometry builders. */
function hwResolveStructureSpacing() {
    return {
        vStackGap: hwGetEffectiveVStackGap(),
        hStackGap: hwGetEffectiveHStackGap(),
        bracket: hwGetEffectiveBracketParams(),
    };
}

/** True when full detail is driving structure spacing instead of legacy sidebar values. */
function hwIsDetailStructureSpacingActive() {
    if (!state.showHardwareFullDetail) return false;
    if (hwUseFullDetailAssemblies()) return true;
    if (hwAssemblyHasParts('vCenter')) return true;
    if (hwAssemblyHasParts('hCenter')) return true;
    return false;
}

const SPACING_OVERRIDE_INPUT_IDS = [
    'nb-hgap', 'sl-hgap',
    'nb-vgap', 'sl-vgap',
    'nb-bracket-width', 'nb-bracket-depth', 'nb-bracket-height',
    'nb-bracket-wall', 'nb-bracket-inner', 'sel-bracket-hole-diameter',
    'nb-bracket-hole-distance',
];

function hwSetInputReadonly(id, readonly, title) {
    const el = document.getElementById(id);
    if (!el) return;
    el.readOnly = readonly;
    el.disabled = readonly && el.tagName === 'SELECT';
    el.style.opacity = readonly ? '0.55' : '';
    if (title != null) el.title = title;
}

/** Dim legacy stack/bracket inputs when assemblies own structure spacing. */
function hwUpdateStructureSpacingUI() {
    const active = hwIsDetailStructureSpacingActive();
    const hint = active
        ? 'Controlled by high-detail hardware assemblies while Full Detail is enabled'
        : '';
    SPACING_OVERRIDE_INPUT_IDS.forEach(id => hwSetInputReadonly(id, active, hint));

    const note = document.getElementById('hw-spacing-override-note');
    if (note) note.style.display = active ? 'block' : 'none';

    if (active) {
        const spacing = hwResolveStructureSpacing();
        const vGapIn = document.getElementById('nb-vgap');
        const hGapIn = document.getElementById('nb-hgap');
        if (vGapIn) vGapIn.value = spacing.vStackGap.toFixed(3);
        if (hGapIn) hGapIn.value = spacing.hStackGap.toFixed(3);
        const bp = spacing.bracket;
        if (bp) {
            const setVal = (id, v, dec = 2) => {
                const inp = document.getElementById(id);
                if (inp && v != null) inp.value = (+v).toFixed(dec);
            };
            setVal('nb-bracket-width', bp.bracketWidth);
            setVal('nb-bracket-depth', bp.bracketDepth);
            setVal('nb-bracket-height', bp.bracketHeight, 1);
            setVal('nb-bracket-wall', bp.bracketWallThickness);
            setVal('nb-bracket-inner', bp.bracketInnerWidth);
            setVal('nb-bracket-hole-distance', bp.bracketHoleDistance);
        }
    }
}

const _moduleExports = {
    hwGetEffectiveVStackGap,
    hwGetEffectiveHStackGap,
    hwGetEffectiveBracketParams,
    hwResolveStructureSpacing,
    hwIsDetailStructureSpacingActive,
    hwUpdateStructureSpacingUI,
};

bridgeGlobals(_moduleExports, 'hwStructureSpacing');

export {
    hwGetEffectiveVStackGap,
    hwGetEffectiveHStackGap,
    hwGetEffectiveBracketParams,
    hwResolveStructureSpacing,
    hwIsDetailStructureSpacingActive,
    hwUpdateStructureSpacingUI,
};
