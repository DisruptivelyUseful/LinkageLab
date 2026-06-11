// ============================================================================
// LINKAGE LAB — Undo / redo history (ES module)
// Depends on global: state, idMap, syncUI, requestRender, showToast, drag, debounce, MAX_HISTORY_SIZE
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';

const debouncedSaveHistory = debounce(() => {
    if (drag.active) {
        return;
    }

    try {
        const stateToSerialize = {};
        for (const key of Object.keys(state)) {
            if (['light', 'cam', 'view', 'animation', 'measurePoints', 'collisions', 'history', 'historyIndex'].includes(key)) {
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
            if (state.hasOwnProperty(key) && key !== 'light' && key !== 'cam' && key !== 'view' && key !== 'animation') {
                state[key] = prevState[key];
            }
        });
        Object.keys(idMap).forEach(k => syncUI(idMap[k]));
        requestRender();
        showToast('Undone', 'info');
    }
}

function redo() {
    if (state.historyIndex < state.history.length - 1) {
        state.historyIndex++;
        const nextState = state.history[state.historyIndex];
        Object.keys(nextState).forEach(key => {
            if (state.hasOwnProperty(key) && key !== 'light' && key !== 'cam' && key !== 'view' && key !== 'animation') {
                state[key] = nextState[key];
            }
        });
        Object.keys(idMap).forEach(k => syncUI(idMap[k]));
        requestRender();
        showToast('Redone', 'info');
    }
}

bridgeGlobals({ saveStateToHistory, undo, redo }, 'history');

export { saveStateToHistory, undo, redo };
