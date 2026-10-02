// ============================================================================
// LINKAGE LAB â€” Undo / redo history (ES module)
// Depends on global: state, idMap, syncUI, requestRender, showToast, drag, debounce, MAX_HISTORY_SIZE
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { MAX_HISTORY_SIZE } from './constants.js';
import { debounce } from './math.js';

// View / session state that undo must neither record nor restore.
// hwDetailMode: restoring it would toggle part view without moving the canvas.
const HISTORY_SKIP_KEYS = ['light', 'cam', 'view', 'animation', 'buildPlayback', 'measurePoints', 'collisions', 'history', 'historyIndex', 'hwDetailMode'];
const RESTORE_SKIP_KEYS = ['light', 'cam', 'view', 'animation', 'buildPlayback', 'hwDetailMode'];

const debouncedSaveHistory = debounce(() => {
    if (drag.active) {
        return;
    }

    try {
        const stateToSerialize = {};
        for (const key of Object.keys(state)) {
            if (HISTORY_SKIP_KEYS.includes(key)) {
                continue;
            }
            stateToSerialize[key] = state[key];
        }

        const stateCopy = JSON.parse(JSON.stringify(stateToSerialize));

        state.history = state.history.slice(0, state.historyIndex + 1);
        state.history.push(stateCopy);
        if (state.history.length > MAX_HISTORY_SIZE) {
            state.history.shift();
        } else {
            state.historyIndex++;
        }
    } catch (e) {
        console.warn('Failed to save state to history:', e.message);
    }
}, 2000);

function saveStateToHistory() {
    debouncedSaveHistory();
}

function undo() {
    if (state.historyIndex > 0) {
        state.historyIndex--;
        const prevState = state.history[state.historyIndex];
        Object.keys(prevState).forEach(key => {
            if (state.hasOwnProperty(key) && !RESTORE_SKIP_KEYS.includes(key)) {
                // Deep copy so later in-place edits never mutate the history entry
                state[key] = JSON.parse(JSON.stringify(prevState[key]));
            }
        });
        if (typeof globalThis.hwAfterHistoryRestore === 'function') globalThis.hwAfterHistoryRestore();
        Object.keys(idMap).forEach(k => syncUI(idMap[k]));
        if (typeof globalThis.syncCoveringsUIFromState === 'function') globalThis.syncCoveringsUIFromState();
        if (typeof globalThis.syncFloorUIFromState === 'function') globalThis.syncFloorUIFromState();
        if (typeof globalThis.syncShadeUIFromState === 'function') globalThis.syncShadeUIFromState();
        if (typeof globalThis.syncActuationUIFromState === 'function') globalThis.syncActuationUIFromState();
        requestRender();
        showToast('Undone', 'info');
    }
}

function redo() {
    if (state.historyIndex < state.history.length - 1) {
        state.historyIndex++;
        const nextState = state.history[state.historyIndex];
        Object.keys(nextState).forEach(key => {
            if (state.hasOwnProperty(key) && !RESTORE_SKIP_KEYS.includes(key)) {
                // Deep copy so later in-place edits never mutate the history entry
                state[key] = JSON.parse(JSON.stringify(nextState[key]));
            }
        });
        if (typeof globalThis.hwAfterHistoryRestore === 'function') globalThis.hwAfterHistoryRestore();
        Object.keys(idMap).forEach(k => syncUI(idMap[k]));
        if (typeof globalThis.syncCoveringsUIFromState === 'function') globalThis.syncCoveringsUIFromState();
        if (typeof globalThis.syncFloorUIFromState === 'function') globalThis.syncFloorUIFromState();
        if (typeof globalThis.syncShadeUIFromState === 'function') globalThis.syncShadeUIFromState();
        if (typeof globalThis.syncActuationUIFromState === 'function') globalThis.syncActuationUIFromState();
        requestRender();
        showToast('Redone', 'info');
    }
}

bridgeGlobals({ saveStateToHistory, undo, redo }, 'history');

export { saveStateToHistory, undo, redo };
