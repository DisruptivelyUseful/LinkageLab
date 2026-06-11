// ============================================================================
// LINKAGE LAB — Constants & configuration
// Loaded via js/linkage/module-loader.js (global scope).
// ============================================================================

/** Build identifier — visible in console at startup */
const LINKAGE_BUILD_ID = 'refactor/optimization-unified-app phase-3s';

/** Inches per foot conversion constant (deprecated - use unitConverter.feetToInches(1) instead) */
const INCHES_PER_FOOT = 12;
const INCHES_PER_METER = 39.37007874015748;

const MIN_FOLD_ANGLE = 5 * Math.PI / 180;
const MAX_FOLD_ANGLE = 175 * Math.PI / 180;
const FOLDING_PANEL_DEPLOY_MS = 1500;

const DEFAULT_CAM_DIST = 450;
const MIN_CAM_DIST = 5;

const GRID_SPACING = 200;
const GRID_RANGE = 2000;
const PERSPECTIVE_SCALE = 1000;

const WOOD_COLOR = { r: 238, g: 191, b: 161 };

const BRACKET_SIZE_MULT = 1.2;
const BRACKET_DEPTH = 2.5;

const BOLT_RADIUS = 0.25;
const BOLT_HEAD_RADIUS = 0.4;
const BOLT_HEAD_HEIGHT = 0.15;

const MIN_SAFE_DIMENSION = 1;
const DEBOUNCE_DELAY = 16;
const MAX_HISTORY_SIZE = 50;
const ANIM_FRAME_RATE = 16.67;

window.LinkageModules = window.LinkageModules || {};
window.LinkageModules.constants = {
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
};
