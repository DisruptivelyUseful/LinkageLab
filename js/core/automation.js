// ============================================================================
// SHARED AUTOMATION ENGINE
// Unified automation rules system for Solar Designer and Solar Simulator
// ============================================================================

/**
 * AutomationEngine - Shared automation rule engine
 * 
 * This module provides a context-independent automation system that can be used
 * by both the 2D Solar Designer and 3D Solar Simulator. The actual execution
 * of actions is delegated to context-specific callbacks.
 * 
 * Usage:
 *   // Initialize with context-specific callbacks
 *   AutomationEngine.init({
 *       getSimulationState: () => ({ time, batterySOC, solarWatts, ... }),
 *       executeAction: (action, targetIds) => { ... },
 *       showNotification: (message) => { ... }
 *   });
 *   
 *   // Evaluate rules (call from simulation tick)
 *   AutomationEngine.evaluate();
 */

const AutomationEngine = (function() {
    'use strict';
    
    // ========================================
    // TRIGGER TYPES (unified from both systems)
    // ========================================
    const TRIGGER_TYPES = {
        // Time-based
        TIME: 'time',                   // Trigger at specific time
        TIME_RANGE: 'time_range',       // Trigger during time range
        SUNRISE: 'sunrise',             // Trigger at sunrise (~6 AM)
        SUNSET: 'sunset',               // Trigger at sunset (~6 PM)
        
        // Battery-based
        BATTERY_ABOVE: 'battery_above', // Battery SOC > threshold
        BATTERY_BELOW: 'battery_below', // Battery SOC < threshold
        
        // Solar-based
        SOLAR_ABOVE: 'solar_above',     // Solar output > threshold (watts)
        SOLAR_BELOW: 'solar_below',     // Solar output < threshold (watts)
        SOLAR_PRODUCING: 'solar_producing', // Solar output > 0
        SOLAR_ZERO: 'solar_zero',       // Solar output = 0
        
        // Container/Resource-based (for simulator)
        CONTAINER_ABOVE: 'container_above', // Container level > threshold
        CONTAINER_BELOW: 'container_below'  // Container level < threshold
    };
    
    // ========================================
    // ACTION TYPES (unified from both systems)
    // ========================================
    const ACTION_TYPES = {
        TURN_ON: 'turn_on',
        TURN_OFF: 'turn_off',
        TOGGLE: 'toggle',
        START_RECIPE: 'start_recipe'    // For simulator recipe processing
    };
    
    // ========================================
    // INTERNAL STATE
    // ========================================
    let rules = [];
    let ruleIdCounter = 0;
    let lastTriggerTime = {};  // Prevent rapid re-triggering
    let isEnabled = true;
    
    // Context callbacks (set by init)
    let callbacks = {
        getSimulationState: null,   // Returns { time, batterySOC, solarWatts, containers }
        executeAction: null,         // (actionType, targetIds, options) => affectedCount
        showNotification: null,      // (message, type) => void
        getTargetItems: null         // (targetType) => items[]
    };
    
    // ========================================
    // INITIALIZATION
    // ========================================
    
    /**
     * Initialize the automation engine with context-specific callbacks
     * @param {Object} config - Configuration object with callbacks
     */
    function init(config) {
        if (config.getSimulationState) callbacks.getSimulationState = config.getSimulationState;
        if (config.executeAction) callbacks.executeAction = config.executeAction;
        if (config.showNotification) callbacks.showNotification = config.showNotification;
        if (config.getTargetItems) callbacks.getTargetItems = config.getTargetItems;
    }
    
    // ========================================
    // RULE MANAGEMENT
    // ========================================
    
    /**
     * Create a new automation rule
     * @param {string} name - Rule name
     * @param {Object} trigger - Trigger configuration
     * @param {Object} action - Action configuration
     * @returns {Object} Created rule
     */
    function createRule(name, trigger, action) {
        const rule = {
            id: `auto-${++ruleIdCounter}`,
            name: name || 'Unnamed Rule',
            enabled: true,
            trigger: {
                type: trigger.type,
                value: trigger.value,           // Primary value (time in minutes, percentage, watts)
                value2: trigger.value2,         // Secondary value (end time for ranges)
                targetId: trigger.targetId,     // Specific target (e.g., battery ID, container ID)
                targetLabel: trigger.targetLabel, // Human-readable target name
                condition: trigger.condition    // Additional condition info
            },
            action: {
                type: action.type,
                targetIds: action.targetIds || [],      // Specific item IDs to affect
                targetType: action.targetType || null,  // Type of items to target (e.g., 'acload')
                recipeIndex: action.recipeIndex,        // For START_RECIPE action
                options: action.options || {}           // Additional action options
            },
            lastTriggered: null,
            source: 'user'  // 'user', 'preset', 'imported'
        };
        rules.push(rule);
        return rule;
    }
    
    /**
     * Delete a rule by ID
     * @param {string} ruleId - Rule ID to delete
     * @returns {boolean} Success
     */
    function deleteRule(ruleId) {
        const idx = rules.findIndex(r => r.id === ruleId);
        if (idx !== -1) {
            rules.splice(idx, 1);
            delete lastTriggerTime[ruleId];
            return true;
        }
        return false;
    }
    
    /**
     * Toggle rule enabled state
     * @param {string} ruleId - Rule ID
     * @returns {boolean|null} New enabled state or null if not found
     */
    function toggleRule(ruleId) {
        const rule = rules.find(r => r.id === ruleId);
        if (rule) {
            rule.enabled = !rule.enabled;
            return rule.enabled;
        }
        return null;
    }
    
    /**
     * Get a rule by ID
     * @param {string} ruleId - Rule ID
     * @returns {Object|null} Rule or null
     */
    function getRule(ruleId) {
        return rules.find(r => r.id === ruleId) || null;
    }
    
    /**
     * Get all rules
     * @returns {Array} All rules
     */
    function getAllRules() {
        return [...rules];
    }
    
    /**
     * Clear all rules
     */
    function clearRules() {
        rules = [];
        lastTriggerTime = {};
        ruleIdCounter = 0;
    }
    
    // ========================================
    // TRIGGER EVALUATION
    // ========================================
    
    /**
     * Check if a trigger condition is currently met
     * @param {Object} rule - Rule to check
     * @param {Object} state - Current simulation state
     * @returns {boolean} Whether trigger condition is met
     */
    function checkTrigger(rule, state) {
        const t = rule.trigger;
        const time = state.time || 0;           // Time in minutes since midnight
        const hours = time / 60;
        const batterySOC = state.batterySOC || 0; // 0-100
        const solarWatts = state.solarWatts || 0;
        const containers = state.containers || {};
        
        switch (t.type) {
            case TRIGGER_TYPES.TIME:
                // Trigger at specific time (within 2 minute window)
                return Math.abs(time - t.value) < 2;
                
            case TRIGGER_TYPES.TIME_RANGE:
                // Trigger during time range
                const startMinutes = t.value;
                const endMinutes = t.value2;
                if (startMinutes < endMinutes) {
                    return time >= startMinutes && time < endMinutes;
                } else {
                    // Wraps around midnight
                    return time >= startMinutes || time < endMinutes;
                }
                
            case TRIGGER_TYPES.SUNRISE:
                // Trigger around 6 AM (within 10 minute window)
                return hours >= 5.83 && hours < 6.17;
                
            case TRIGGER_TYPES.SUNSET:
                // Trigger around 6 PM (within 10 minute window)
                return hours >= 17.83 && hours < 18.17;
                
            case TRIGGER_TYPES.BATTERY_ABOVE:
                return batterySOC > t.value;
                
            case TRIGGER_TYPES.BATTERY_BELOW:
                return batterySOC < t.value;
                
            case TRIGGER_TYPES.SOLAR_ABOVE:
                return solarWatts > t.value;
                
            case TRIGGER_TYPES.SOLAR_BELOW:
                return solarWatts < t.value;
                
            case TRIGGER_TYPES.SOLAR_PRODUCING:
                return solarWatts > 0;
                
            case TRIGGER_TYPES.SOLAR_ZERO:
                return solarWatts === 0;
                
            case TRIGGER_TYPES.CONTAINER_ABOVE:
                if (t.targetId && containers[t.targetId] !== undefined) {
                    return containers[t.targetId] > t.value;
                }
                return false;
                
            case TRIGGER_TYPES.CONTAINER_BELOW:
                if (t.targetId && containers[t.targetId] !== undefined) {
                    return containers[t.targetId] < t.value;
                }
                return false;
                
            default:
                return false;
        }
    }
    
    // ========================================
    // ACTION EXECUTION
    // ========================================
    
    /**
     * Execute a rule's action
     * @param {Object} rule - Rule to execute
     * @returns {number} Number of affected items
     */
    function executeAction(rule) {
        if (!callbacks.executeAction) {
            console.warn('AutomationEngine: No executeAction callback configured');
            return 0;
        }
        
        const action = rule.action;
        return callbacks.executeAction(action.type, action.targetIds, {
            targetType: action.targetType,
            recipeIndex: action.recipeIndex,
            options: action.options
        });
    }
    
    // ========================================
    // MAIN EVALUATION LOOP
    // ========================================
    
    /**
     * Evaluate all rules against current state
     * Call this from your simulation tick
     * @param {Object} stateOverride - Optional state override (otherwise uses callback)
     */
    function evaluate(stateOverride) {
        if (!isEnabled) return;
        
        // Get current state
        let state;
        if (stateOverride) {
            state = stateOverride;
        } else if (callbacks.getSimulationState) {
            state = callbacks.getSimulationState();
        } else {
            return; // No state available
        }
        
        const currentTime = state.time || 0;
        
        rules.forEach(rule => {
            if (!rule.enabled) return;
            
            const triggered = checkTrigger(rule, state);
            const lastTrigger = lastTriggerTime[rule.id] || 0;
            
            // Handle time difference considering midnight wrap
            let timeDiff = Math.abs(currentTime - lastTrigger);
            if (timeDiff > 720) { // More than 12 hours
                timeDiff = 1440 - timeDiff; // Wrap around
            }
            
            // Prevent re-triggering within 5 simulation minutes
            if (triggered && timeDiff > 5) {
                const affected = executeAction(rule);
                if (affected > 0) {
                    rule.lastTriggered = currentTime;
                    lastTriggerTime[rule.id] = currentTime;
                    
                    // Show notification
                    if (callbacks.showNotification) {
                        const actionText = getActionDescription(rule.action);
                        callbacks.showNotification(
                            `⚡ ${rule.name}: ${affected} device(s) ${actionText}`,
                            'info'
                        );
                    }
                }
            }
        });
    }
    
    // ========================================
    // SERIALIZATION
    // ========================================
    
    /**
     * Export rules for saving
     * @returns {Object} Serialized rules data
     */
    function serialize() {
        return {
            version: 1,
            rules: rules.map(r => ({
                id: r.id,
                name: r.name,
                enabled: r.enabled,
                trigger: { ...r.trigger },
                action: { ...r.action },
                source: r.source
            })),
            ruleIdCounter: ruleIdCounter
        };
    }
    
    /**
     * Import rules from saved data
     * @param {Object} data - Serialized rules data
     * @param {boolean} merge - If true, merge with existing rules; if false, replace
     */
    function deserialize(data, merge = false) {
        if (!data || !data.rules) return;
        
        if (!merge) {
            rules = [];
            lastTriggerTime = {};
        }
        
        data.rules.forEach(r => {
            // Avoid ID conflicts when merging
            if (merge && rules.find(existing => existing.id === r.id)) {
                r.id = `auto-${++ruleIdCounter}`;
            }
            rules.push({
                id: r.id,
                name: r.name,
                enabled: r.enabled !== false,
                trigger: { ...r.trigger },
                action: { ...r.action },
                lastTriggered: null,
                source: r.source || 'imported'
            });
        });
        
        if (data.ruleIdCounter && data.ruleIdCounter > ruleIdCounter) {
            ruleIdCounter = data.ruleIdCounter;
        }
    }
    
    // ========================================
    // UI HELPERS
    // ========================================
    
    /**
     * Get human-readable trigger description
     * @param {Object} trigger - Trigger object
     * @returns {string} Description
     */
    function getTriggerDescription(trigger) {
        switch (trigger.type) {
            case TRIGGER_TYPES.TIME:
                return `At ${formatTime(trigger.value)}`;
            case TRIGGER_TYPES.TIME_RANGE:
                return `${formatTime(trigger.value)} - ${formatTime(trigger.value2)}`;
            case TRIGGER_TYPES.SUNRISE:
                return 'At Sunrise';
            case TRIGGER_TYPES.SUNSET:
                return 'At Sunset';
            case TRIGGER_TYPES.BATTERY_ABOVE:
                return `Battery > ${trigger.value}%`;
            case TRIGGER_TYPES.BATTERY_BELOW:
                return `Battery < ${trigger.value}%`;
            case TRIGGER_TYPES.SOLAR_ABOVE:
                return `Solar > ${trigger.value}W`;
            case TRIGGER_TYPES.SOLAR_BELOW:
                return `Solar < ${trigger.value}W`;
            case TRIGGER_TYPES.SOLAR_PRODUCING:
                return 'Solar producing';
            case TRIGGER_TYPES.SOLAR_ZERO:
                return 'Solar at zero';
            case TRIGGER_TYPES.CONTAINER_ABOVE:
                return `${trigger.targetLabel || 'Container'} > ${trigger.value}`;
            case TRIGGER_TYPES.CONTAINER_BELOW:
                return `${trigger.targetLabel || 'Container'} < ${trigger.value}`;
            default:
                return 'Unknown trigger';
        }
    }
    
    /**
     * Get human-readable action description
     * @param {Object} action - Action object
     * @returns {string} Description
     */
    function getActionDescription(action) {
        switch (action.type) {
            case ACTION_TYPES.TURN_ON:
                return 'turned ON';
            case ACTION_TYPES.TURN_OFF:
                return 'turned OFF';
            case ACTION_TYPES.TOGGLE:
                return 'toggled';
            case ACTION_TYPES.START_RECIPE:
                return 'started recipe';
            default:
                return action.type;
        }
    }
    
    /**
     * Format time in minutes to readable string
     * @param {number} minutes - Minutes since midnight
     * @returns {string} Formatted time (e.g., "6:30 PM")
     */
    function formatTime(minutes) {
        const hours = Math.floor(minutes / 60);
        const mins = Math.floor(minutes % 60);
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        return `${displayHours}:${mins.toString().padStart(2, '0')} ${ampm}`;
    }
    
    /**
     * Parse time string to minutes
     * @param {string} timeStr - Time string (e.g., "18:30" or "6:30 PM")
     * @returns {number} Minutes since midnight
     */
    function parseTime(timeStr) {
        // Handle 24-hour format "HH:MM"
        const match24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
        if (match24) {
            return parseInt(match24[1]) * 60 + parseInt(match24[2]);
        }
        
        // Handle 12-hour format "H:MM AM/PM"
        const match12 = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
        if (match12) {
            let hours = parseInt(match12[1]);
            const mins = parseInt(match12[2]);
            const isPM = match12[3].toUpperCase() === 'PM';
            if (isPM && hours !== 12) hours += 12;
            if (!isPM && hours === 12) hours = 0;
            return hours * 60 + mins;
        }
        
        return 0;
    }
    
    // ========================================
    // PRESETS
    // ========================================
    
    const PRESETS = [
        {
            name: 'Night Lights',
            description: 'Turn on lights at sunset',
            trigger: { type: TRIGGER_TYPES.SUNSET },
            action: { type: ACTION_TYPES.TURN_ON, targetType: 'acload' }
        },
        {
            name: 'Morning Off',
            description: 'Turn off lights at sunrise',
            trigger: { type: TRIGGER_TYPES.SUNRISE },
            action: { type: ACTION_TYPES.TURN_OFF, targetType: 'acload' }
        },
        {
            name: 'Low Battery Saver',
            description: 'Turn off loads when battery < 20%',
            trigger: { type: TRIGGER_TYPES.BATTERY_BELOW, value: 20 },
            action: { type: ACTION_TYPES.TURN_OFF, targetType: 'acload' }
        },
        {
            name: 'High Solar Boost',
            description: 'Turn on loads when solar > 500W',
            trigger: { type: TRIGGER_TYPES.SOLAR_ABOVE, value: 500 },
            action: { type: ACTION_TYPES.TURN_ON, targetType: 'acload' }
        },
        {
            name: 'Evening Schedule',
            description: 'Turn on loads from 6-10 PM',
            trigger: { type: TRIGGER_TYPES.TIME_RANGE, value: 18 * 60, value2: 22 * 60 },
            action: { type: ACTION_TYPES.TURN_ON, targetType: 'acload' }
        },
        {
            name: 'Night Mode',
            description: 'Turn off loads from 11 PM - 6 AM',
            trigger: { type: TRIGGER_TYPES.TIME_RANGE, value: 23 * 60, value2: 6 * 60 },
            action: { type: ACTION_TYPES.TURN_OFF, targetType: 'acload' }
        },
        {
            name: 'Battery Full',
            description: 'Turn on loads when battery > 80%',
            trigger: { type: TRIGGER_TYPES.BATTERY_ABOVE, value: 80 },
            action: { type: ACTION_TYPES.TURN_ON, targetType: 'acload' }
        }
    ];
    
    /**
     * Create rule from preset
     * @param {number} presetIndex - Index in PRESETS array
     * @returns {Object|null} Created rule or null
     */
    function createFromPreset(presetIndex) {
        const preset = PRESETS[presetIndex];
        if (!preset) return null;
        const rule = createRule(preset.name, preset.trigger, preset.action);
        rule.source = 'preset';
        return rule;
    }
    
    // ========================================
    // PUBLIC API
    // ========================================
    
    return {
        // Constants
        TRIGGER_TYPES,
        ACTION_TYPES,
        PRESETS,
        
        // Initialization
        init,
        
        // Rule management
        createRule,
        deleteRule,
        toggleRule,
        getRule,
        getAllRules,
        clearRules,
        createFromPreset,
        
        // Evaluation
        evaluate,
        checkTrigger,
        
        // Serialization
        serialize,
        deserialize,
        
        // UI helpers
        getTriggerDescription,
        getActionDescription,
        formatTime,
        parseTime,
        
        // Enable/disable
        get enabled() { return isEnabled; },
        set enabled(val) { isEnabled = !!val; }
    };
})();

// Export for module systems (if used)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AutomationEngine;
}
