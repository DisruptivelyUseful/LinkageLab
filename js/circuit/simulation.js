// ============================================================================
// Time simulation engine (shared tick / solar position / battery SOC)
// ============================================================================

/**
 * Create a simulation engine instance.
 * @param {object} [options]
 */
export function createSimulationEngine(options = {}) {
    const state = {
        time: options.initialTime ?? 12 * 60,
        speed: options.speed ?? 60,
        isPlaying: false,
        batterySOC: options.batterySOC ?? {},
        solarIrradiance: 1.0,
        currentSolarWatts: 0,
        currentLoadWatts: 0,
        currentBatteryFlow: 0,
        latitude: options.latitude ?? 35,
        dayOfYear: options.dayOfYear ?? 172,
        animationFrameId: null,
        lastTick: 0,
    };

    const callbacks = {
        onTick: options.onTick ?? (() => {}),
        calculateSolarIrradiance: options.calculateSolarIrradiance ?? (() => 1.0),
        calculateSolarOutput: options.calculateSolarOutput ?? (() => 0),
        calculateLoadConsumption: options.calculateLoadConsumption ?? (() => 0),
        updateBatterySOC: options.updateBatterySOC ?? (() => {}),
    };

    function formatTime() {
        const hours = Math.floor(state.time / 60);
        const minutes = Math.floor(state.time % 60);
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        return `${displayHours}:${String(minutes).padStart(2, '0')} ${ampm}`;
    }

    function getHourOfDay() {
        return state.time / 60;
    }

    function tick(deltaSeconds) {
        if (!state.isPlaying) return;

        const deltaMinutes = deltaSeconds * state.speed;
        state.time += deltaMinutes;
        if (state.time >= 24 * 60) state.time -= 24 * 60;

        state.solarIrradiance = callbacks.calculateSolarIrradiance(state);
        state.currentSolarWatts = callbacks.calculateSolarOutput(state);
        state.currentLoadWatts = callbacks.calculateLoadConsumption(state);
        state.currentBatteryFlow = state.currentSolarWatts - state.currentLoadWatts;

        callbacks.updateBatterySOC(state, deltaMinutes);
        callbacks.onTick(state, deltaMinutes);
    }

    function _animate() {
        if (!state.isPlaying) {
            state.animationFrameId = null;
            return;
        }
        const now = performance.now();
        const deltaSeconds = (now - state.lastTick) / 1000;
        state.lastTick = now;
        tick(deltaSeconds);
        state.animationFrameId = requestAnimationFrame(_animate);
    }

    return {
        get state() {
            return state;
        },
        formatTime,
        getHourOfDay,
        tick,
        play() {
            if (state.isPlaying) return;
            state.isPlaying = true;
            state.lastTick = performance.now();
            _animate();
        },
        pause() {
            state.isPlaying = false;
            if (state.animationFrameId) {
                cancelAnimationFrame(state.animationFrameId);
                state.animationFrameId = null;
            }
        },
        setTime(minutes) {
            state.time = Math.max(0, Math.min(24 * 60 - 1, minutes));
        },
        setSpeed(speed) {
            state.speed = speed;
        },
        reset(initialTime = 12 * 60) {
            this.pause();
            state.time = initialTime;
            state.batterySOC = {};
        },
        setCallbacks(partial) {
            Object.assign(callbacks, partial);
        },
    };
}

export default createSimulationEngine;
