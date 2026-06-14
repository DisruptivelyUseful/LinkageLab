// ============================================================================
// Controller fault state — prevent Voc destruction loops after RESET
// ============================================================================

/**
 * @param {object} controller
 * @param {object} arraySpecs
 * @returns {boolean}
 */
export function shouldTriggerVocOverload(controller, arraySpecs) {
    if (!controller || !arraySpecs) return false;

    const maxVoc = controller.specs?.maxVoc ?? 0;
    if (arraySpecs.voc <= maxVoc) {
        controller.vocFaultSuppressed = false;
        return false;
    }

    if (controller.vocFaultSuppressed) return false;
    if (controller.destroyed) return false;
    return true;
}

/**
 * Restore controller after user clicks RESET — keep fault suppressed until wiring is safe.
 * @param {object} controller
 */
export function resetControllerFault(controller) {
    if (!controller) return;
    controller.destroyed = false;
    controller.batteryOvervoltage = false;
    controller.incompatibleVoltageShown = false;
    controller.reversedPolarityWarningShown = false;
    controller.vocFaultSuppressed = true;
}

/**
 * Pick smallest controller preset that meets string Voc (with cold-temp margin).
 * @param {object[]} presets
 * @param {number} stringVoc
 * @param {number} [margin]
 * @returns {object | null}
 */
export function pickControllerPresetForStringVoc(presets, stringVoc, margin = 1.05) {
    if (!presets?.length || !stringVoc) return null;

    const required = stringVoc * margin;
    const adequate = presets.filter((p) => (p.maxVoc || 0) >= required);
    if (adequate.length === 0) {
        return presets.reduce((best, p) => (
            (p.maxVoc || 0) > (best?.maxVoc || 0) ? p : best
        ), null);
    }

    return adequate.sort((a, b) => a.maxVoc - b.maxVoc)[0];
}

/**
 * Upgrade controller specs in place when the linked array exceeds max Voc.
 * @param {object} controller
 * @param {object} preset
 */
export function applyControllerPresetSpecs(controller, preset) {
    if (!controller || !preset) return;

    const scale = 0.12;
    controller.specs = {
        ...controller.specs,
        name: preset.name,
        type: preset.type,
        maxVoc: preset.maxVoc,
        maxIsc: Math.max(controller.specs.maxIsc || 0, preset.maxIsc || 0),
        maxWmp: Math.max(controller.specs.maxWmp || 0, preset.maxWmp || 0),
        ratedChargeCurrent: preset.ratedChargeCurrent ?? controller.specs.ratedChargeCurrent,
        supportedVoltages: preset.supportedVoltages ?? controller.specs.supportedVoltages,
        mpptCount: preset.mpptCount ?? controller.specs.mpptCount,
        mppVoltageMin: preset.mppVoltageMin ?? controller.specs.mppVoltageMin,
        mppVoltageMax: preset.mppVoltageMax ?? controller.specs.mppVoltageMax,
        maxACOutputW: preset.maxACOutputW ?? controller.specs.maxACOutputW,
        cost: preset.cost ?? controller.specs.cost,
    };

    if (preset.width) controller.width = preset.width * scale;
    if (preset.height) controller.height = preset.height * scale;
}

export default {
    shouldTriggerVocOverload,
    resetControllerFault,
    pickControllerPresetForStringVoc,
    applyControllerPresetSpecs,
};
