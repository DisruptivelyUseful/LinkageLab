// ============================================================================
// LINKAGE LAB â€” Constants & configuration (ES module)
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';

/** Build identifier â€” visible in console at startup */
export const LINKAGE_BUILD_ID = 'refactor/optimization-unified-app phase-4k';

/** Inches per foot conversion constant (deprecated - use unitConverter.feetToInches(1) instead) */
export const INCHES_PER_FOOT = 12;
export const INCHES_PER_METER = 39.37007874015748;

export const MIN_FOLD_ANGLE = 5 * Math.PI / 180;
export const MAX_FOLD_ANGLE = 175 * Math.PI / 180;
export const FOLDING_PANEL_DEPLOY_MS = 1500;

export const DEFAULT_CAM_DIST = 450;
export const MIN_CAM_DIST = 5;

export const GRID_SPACING = 200;
export const GRID_RANGE = 2000;
export const PERSPECTIVE_SCALE = 1000;

export const WOOD_COLOR = { r: 238, g: 191, b: 161 };

export const BRACKET_SIZE_MULT = 1.2;
export const BRACKET_DEPTH = 2.5;

export const BOLT_RADIUS = 0.25;
export const BOLT_HEAD_RADIUS = 0.4;
export const BOLT_HEAD_HEIGHT = 0.15;

export const MIN_SAFE_DIMENSION = 1;
export const DEBOUNCE_DELAY = 16;
export const MAX_HISTORY_SIZE = 50;
export const ANIM_FRAME_RATE = 16.67;

bridgeGlobals({
    LINKAGE_BUILD_ID,
    INCHES_PER_FOOT,
    INCHES_PER_METER,
    MIN_FOLD_ANGLE,
    MAX_FOLD_ANGLE,
    FOLDING_PANEL_DEPLOY_MS,
    DEFAULT_CAM_DIST,
    MIN_CAM_DIST,
    GRID_SPACING,
    GRID_RANGE,
    PERSPECTIVE_SCALE,
    WOOD_COLOR,
    BRACKET_SIZE_MULT,
    BRACKET_DEPTH,
    BOLT_RADIUS,
    BOLT_HEAD_RADIUS,
    BOLT_HEAD_HEIGHT,
    MIN_SAFE_DIMENSION,
    DEBOUNCE_DELAY,
    MAX_HISTORY_SIZE,
    ANIM_FRAME_RATE
}, 'constants');
