// ============================================================================
// LINKAGE LAB — Sky / lighting model (pure, no THREE, no DOM)
//
// Ports the StarShade viewer's day-night lighting: everything is blended from
// the sun's elevation so dawn and dusk crossfade instead of switching. Colours
// go in as sRGB hex and come out as linear 0..1 triples (three r128 has no
// colour management, so hex literals would otherwise render washed out under
// sRGB output) plus CSS hex strings for the sky gradient.
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';

// --- colour helpers ----------------------------------------------------------

function srgbChannelToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearChannelToSrgb(c) {
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** '#rrggbb' or 0xrrggbb → { r, g, b } in sRGB 0..1 */
function hexToRgb(hex) {
    const n = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex;
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** { r, g, b } sRGB 0..1 → '#rrggbb' */
function rgbToHex(c) {
    const h = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
    return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** sRGB hex → linear { r, g, b } (what a three r128 Color wants under sRGB output) */
function hexToLinear(hex) {
    const c = hexToRgb(hex);
    return { r: srgbChannelToLinear(c.r), g: srgbChannelToLinear(c.g), b: srgbChannelToLinear(c.b) };
}

function linearToHex(c) {
    return rgbToHex({ r: linearChannelToSrgb(c.r), g: linearChannelToSrgb(c.g), b: linearChannelToSrgb(c.b) });
}

function lerpRgb(a, b, t) {
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/** Hermite smoothstep on [0,1] */
function smooth(u) {
    u = Math.min(1, Math.max(0, u));
    return u * u * (3 - 2 * u);
}

// --- palette (sRGB, from the StarShade viewer) --------------------------------

const PALETTE = Object.freeze({
    skyDay:   { top: '#163463', bottom: '#4d84cf' },
    skyDawn:  { top: '#1a2447', bottom: '#c2683f' },
    skyNight: { top: '#04060f', bottom: '#0b1226' },
    sunWarm: '#ffb36b',
    sunWhite: '#fff6e8',
    studioKey: '#fff2dc',
    moon: '#8fa8ff',
    hemiDay: '#dfe9ff',
    hemiNight: '#2a3f72',
    hemiGround: '#1a2238',
    fill: '#22d3ee',
    ground: '#141c30',
    gridCenter: '#22d3ee',
    gridLine: '#253152',
    glow: '#22e07a',
});

// --- solar position (unclamped) ----------------------------------------------

/**
 * Sun elevation/azimuth for a latitude, day of year and local solar hour.
 * Unlike the renderer's legacy helper this does NOT clamp below the horizon,
 * so night is representable (negative elevation).
 * @returns {{ elevationDeg: number, azimuthDeg: number }} azimuth 0=N, 90=E, 180=S, 270=W
 */
function solarPosition(latitudeDeg, dayOfYear, hourOfDay) {
    const declination = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * Math.PI / 180);
    const lat = latitudeDeg * Math.PI / 180;
    const dec = declination * Math.PI / 180;
    const hourAngle = (hourOfDay - 12) * 15 * Math.PI / 180;
    const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
    const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
    const cosEl = Math.max(1e-6, Math.cos(el));
    const sinAz = Math.sin(hourAngle) * Math.cos(dec) / cosEl;
    const cosAz = (Math.sin(dec) - Math.sin(lat) * sinEl) / (Math.cos(lat) * cosEl);
    let az = Math.atan2(sinAz, cosAz) * 180 / Math.PI;
    if (az < 0) az += 360;
    return { elevationDeg: el * 180 / Math.PI, azimuthDeg: az };
}

/** state.sunTime (0..100) → hour of day on a 24 h clock (0 = midnight, 50 = noon). */
function hourOfDayFromSunTime(sunTime) {
    const t = Math.min(100, Math.max(0, Number(sunTime) || 0));
    return (t / 100) * 24;
}

/** 13.5 → "1:30 PM" */
function formatClock(hourOfDay) {
    const h24 = ((hourOfDay % 24) + 24) % 24;
    let hours = Math.floor(h24);
    let minutes = Math.round((h24 - hours) * 60);   // nearest minute (slider steps are not whole minutes)
    if (minutes === 60) { minutes = 0; hours = (hours + 1) % 24; }
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 === 0 ? 12 : hours % 12;
    return `${displayHours}:${String(minutes).padStart(2, '0')} ${ampm}`;
}

// --- the model ----------------------------------------------------------------

// StarShade drives its key at 2.3 with a low-albedo grey structure; LinkageLab's
// tan lumber and white backsheets blow out at that level under ACES, so the
// rig runs a little cooler (tuned against side-by-side renders at noon).
const KEY_DAY_MAX = 1.5;
const HEMI_DAY_MAX = 0.75;

/**
 * Neutral studio light (used when no time of day applies, e.g. part view).
 */
function studioModel() {
    return {
        neutral: true,
        daylight: 1,
        night: 0,
        key: { intensity: KEY_DAY_MAX * 0.87, color: hexToLinear(PALETTE.studioKey) },
        moon: { intensity: 0, color: hexToLinear(PALETTE.moon), opacity: 0 },
        hemi: { intensity: HEMI_DAY_MAX, color: hexToLinear(PALETTE.hemiDay), ground: hexToLinear(PALETTE.hemiGround) },
        fill: { intensity: 0.4, color: hexToLinear(PALETTE.fill) },
        envScale: 1,
        exposure: 1.0,
        skyTop: null,
        skyBottom: null,
        starOpacity: 0,
    };
}

/**
 * Lighting for a sun elevation (degrees above the horizon; negative at night).
 * The moon follows the opposite arc.
 */
function skyModel({ sunElevationDeg }) {
    const sunElev = Math.sin((Number(sunElevationDeg) || 0) * Math.PI / 180); // height fraction, −1..1
    const moonElev = -sunElev;
    const daylight = smooth((sunElev + 0.06) / 0.32);
    const night = 1 - daylight;

    const sunUp = smooth((sunElev + 0.02) / 0.3);
    const keyColor = lerpRgb(hexToLinear(PALETTE.sunWarm), hexToLinear(PALETTE.sunWhite), smooth(sunElev / 0.35));

    const moonUp = smooth((moonElev + 0.02) / 0.2);
    const moonIntensity = 0.55 * moonUp * night;

    const t1 = smooth((sunElev + 0.16) / 0.24);
    const t2 = smooth((sunElev - 0.03) / 0.3);
    const skyTop = lerpRgb(lerpRgb(hexToRgb(PALETTE.skyNight.top), hexToRgb(PALETTE.skyDawn.top), t1), hexToRgb(PALETTE.skyDay.top), t2);
    const skyBottom = lerpRgb(lerpRgb(hexToRgb(PALETTE.skyNight.bottom), hexToRgb(PALETTE.skyDawn.bottom), t1), hexToRgb(PALETTE.skyDay.bottom), t2);

    return {
        neutral: false,
        daylight,
        night,
        sunUp,
        sunElev,
        moonElev,
        key: { intensity: KEY_DAY_MAX * sunUp, color: keyColor },
        moon: { intensity: moonIntensity, color: hexToLinear(PALETTE.moon), opacity: 0.95 * moonUp * (0.35 + 0.65 * night) },
        hemi: {
            intensity: 0.18 + (HEMI_DAY_MAX - 0.18) * daylight,
            color: lerpRgb(hexToLinear(PALETTE.hemiNight), hexToLinear(PALETTE.hemiDay), daylight),
            ground: hexToLinear(PALETTE.hemiGround),
        },
        fill: { intensity: 0.1 + 0.3 * daylight, color: hexToLinear(PALETTE.fill) },
        envScale: 0.08 + 0.92 * daylight,
        exposure: 0.88 + 0.12 * daylight,
        skyTop: rgbToHex(skyTop),
        skyBottom: rgbToHex(skyBottom),
        starOpacity: (1 - smooth((sunElev + 0.05) / 0.2)) * 0.95,
        // Sun/moon shadow ownership: only one casts at a time (texture budget)
        moonCastsShadows: KEY_DAY_MAX * sunUp < 0.15,
    };
}

/**
 * Full model for a state: 24 h clock from state.sunTime plus real solar geometry.
 * @returns model + { hourOfDay, clock, elevationDeg, azimuthDeg }
 */
function skyModelForState(s) {
    const hourOfDay = hourOfDayFromSunTime(s && s.sunTime !== undefined ? s.sunTime : 50);
    const latitude = (s && s.simulationLatitude) || 35;
    const dayOfYear = (s && s.simulationDayOfYear) || 172;
    const pos = solarPosition(latitude, dayOfYear, hourOfDay);
    const model = skyModel({ sunElevationDeg: pos.elevationDeg });
    return { ...model, hourOfDay, clock: formatClock(hourOfDay), elevationDeg: pos.elevationDeg, azimuthDeg: pos.azimuthDeg };
}

const _moduleExports = {
    SKY_PALETTE: PALETTE,
    hexToRgb,
    rgbToHex,
    hexToLinear,
    linearToHex,
    lerpRgb,
    smoothstep01: smooth,
    solarPosition,
    hourOfDayFromSunTime,
    formatClock,
    studioModel,
    skyModel,
    skyModelForState,
};

bridgeGlobals(_moduleExports, 'skyModel');

export {
    PALETTE as SKY_PALETTE,
    hexToRgb,
    rgbToHex,
    hexToLinear,
    linearToHex,
    lerpRgb,
    smooth as smoothstep01,
    solarPosition,
    hourOfDayFromSunTime,
    formatClock,
    studioModel,
    skyModel,
    skyModelForState,
};
