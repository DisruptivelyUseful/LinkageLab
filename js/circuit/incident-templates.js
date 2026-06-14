// ============================================================================
// Incident report templates (Phase 11 — shared designer/simulator)
// ============================================================================

export const INCIDENT_TEMPLATES = {
    controllerOvervoltage: (controller, actualVoltage, maxVoltage) => ({
        type: 'critical',
        icon: '💥',
        category: 'CRITICAL FAILURE',
        title: 'Controller Destroyed — Overvoltage',
        description: `Array Voc (${actualVoltage.toFixed(1)}V) exceeded the controller limit (${maxVoltage}V).`,
        math: [
            { label: 'Array Voc', value: `${actualVoltage.toFixed(1)}V`, status: 'danger' },
            { label: 'Max Voc', value: `${maxVoltage}V`, status: 'good' },
            { label: 'Over by', value: `${(actualVoltage - maxVoltage).toFixed(1)}V`, status: 'danger' },
        ],
        realworld: 'Exceeding rated Voc can destroy internal MOSFETs and capacitors instantly.',
        solutions: [
            'Reduce series panel count or use a higher-voltage controller',
            'Confirm array Voc is below the controller rating before connecting',
        ],
        learnMoreTopic: 'voltage-ratings',
    }),

    controllerReversPolarity: (controller, battery) => ({
        type: 'critical',
        icon: '⚡',
        category: 'CRITICAL FAILURE',
        title: 'Controller Destroyed — Reverse Polarity',
        description: 'Battery positive and negative are swapped at the controller.',
        math: [
            { label: 'Battery +', value: 'On BATT−', status: 'danger' },
            { label: 'Battery −', value: 'On BATT+', status: 'danger' },
        ],
        realworld: 'Reverse polarity can cause immediate, violent failure of protection components.',
        solutions: [
            'Double-check polarity before connecting (red = +, black = −)',
        ],
        learnMoreTopic: 'polarity-safety',
    }),

    wireBurned: (wireGauge, currentAmps, wireRating) => ({
        type: 'critical',
        icon: '🔥',
        category: 'WIRE FIRE',
        title: 'Wire Burned Out',
        description: `${wireGauge} AWG wire carried ${currentAmps.toFixed(1)}A — above its ${wireRating}A rating.`,
        math: [
            { label: 'Gauge', value: `${wireGauge} AWG`, status: '' },
            { label: 'Current', value: `${currentAmps.toFixed(1)}A`, status: 'danger' },
            { label: 'Rating', value: `${wireRating}A`, status: 'good' },
        ],
        realworld: 'Overloaded conductors overheat and can melt insulation or start fires.',
        solutions: [
            'Use heavier wire or add a breaker below wire ampacity',
        ],
        learnMoreTopic: 'wire-sizing',
    }),

    breakerTripped: (breakerRating, currentAmps, circuitName) => ({
        type: 'warning',
        icon: '⚡',
        category: 'PROTECTION ACTIVATED',
        title: 'Circuit Breaker Tripped',
        description: `${breakerRating}A breaker${circuitName ? ` (${circuitName})` : ''} opened at ${currentAmps.toFixed(1)}A.`,
        math: [
            { label: 'Breaker', value: `${breakerRating}A`, status: 'good' },
            { label: 'Load', value: `${currentAmps.toFixed(1)}A`, status: 'warning' },
        ],
        solutions: [
            'Reduce load or split across more circuits before resetting',
        ],
        learnMoreTopic: 'breakers',
    }),

    loadExplosion: (loadName, requiredVoltage, actualVoltage) => ({
        type: 'critical',
        icon: '💥',
        category: 'APPLIANCE DESTROYED',
        title: `${loadName} Destroyed — Wrong Voltage`,
        description: `${requiredVoltage}V appliance on a ${actualVoltage}V circuit.`,
        math: [
            { label: 'Appliance', value: `${requiredVoltage}V`, status: 'good' },
            { label: 'Circuit', value: `${actualVoltage}V`, status: 'danger' },
        ],
        realworld: '240V on a 120V device delivers 4× rated power — instant failure.',
        solutions: [
            'Match appliance voltage to the circuit before connecting',
        ],
        learnMoreTopic: 'voltage-matching',
    }),

    batteryShort: (battery) => ({
        type: 'critical',
        icon: '🔋💥',
        category: 'CRITICAL FAILURE',
        title: 'Battery Short Circuit',
        description: 'Positive and negative battery terminals are directly shorted.',
        math: [
            { label: 'Battery', value: `${battery.specs.voltage}V`, status: '' },
            { label: 'Short current', value: 'Extremely high', status: 'danger' },
        ],
        realworld: 'Battery shorts can cause fire, gas release, and thermal runaway.',
        solutions: [
            'Remove the short; use fused battery cables',
        ],
        learnMoreTopic: 'battery-safety',
    }),

    reversedPanelPolarity: (controller, panel) => ({
        type: 'warning',
        icon: '☀️⚠️',
        category: 'WIRING ERROR',
        title: 'Panel Polarity Reversed',
        description: 'Panel +/− are swapped at the controller PV inputs — no power will flow.',
        math: [
            { label: 'Panel +', value: 'On PV−', status: 'danger' },
            { label: 'Panel −', value: 'On PV+', status: 'danger' },
        ],
        solutions: [
            'Swap so + goes to PV+ and − to PV−',
        ],
        learnMoreTopic: 'panel-wiring',
    }),

    batteryReversedPolarity: (controller, battery) => ({
        type: 'critical',
        icon: '🔋💥',
        category: 'CRITICAL FAILURE',
        title: 'Battery Polarity Reversed',
        description: 'Battery terminals are swapped at the controller.',
        math: [
            { label: 'Battery +', value: 'On BATT−', status: 'danger' },
            { label: 'Battery −', value: 'On BATT+', status: 'danger' },
        ],
        realworld: 'Reverse battery polarity can destroy a controller instantly.',
        solutions: [
            'Verify polarity with a multimeter before connecting',
        ],
        learnMoreTopic: 'battery-safety',
    }),

    parallelStringAdded: (arraySpecs, controller, batteryVoltage, maxWattsAtBattery, hasHeadroom, panelWattage = null) => {
        const remainingWatts = maxWattsAtBattery - arraySpecs.wmp;
        const singlePanelWatts = panelWattage || 250;
        const isMaximized = hasHeadroom && remainingWatts < singlePanelWatts && remainingWatts >= 0;

        return {
            type: isMaximized ? 'success' : (hasHeadroom ? 'info' : 'warning'),
            icon: isMaximized ? '🏆' : (hasHeadroom ? '📋' : '⚡'),
            category: isMaximized ? 'ARRAY MAXIMIZED' : (hasHeadroom ? 'ARRAY EXPANDED' : 'CONTROLLER LIMIT'),
            title: isMaximized
                ? `${arraySpecs.wmp}W Array Optimized`
                : (hasHeadroom ? `${arraySpecs.wmp}W Array Added` : `Array Capped at ${maxWattsAtBattery}W`),
            description: isMaximized
                ? `${arraySpecs.config} array fits this controller at ${batteryVoltage}V.`
                : (hasHeadroom
                    ? `Parallel string added — now ${arraySpecs.wmp}W.`
                    : `Array exceeds what this controller can use at ${batteryVoltage}V.`),
            math: [
                { label: 'Array', value: `${arraySpecs.wmp}W`, status: '' },
                { label: 'Max @ voltage', value: `${maxWattsAtBattery}W`, status: hasHeadroom ? 'good' : 'warning' },
            ],
            solutions: hasHeadroom
                ? ['Keep Voc and Isc within controller limits']
                : ['Remove panels or upgrade the controller'],
            learnMoreTopic: 'array-sizing',
        };
    },
};

export default INCIDENT_TEMPLATES;
