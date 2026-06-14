import { CITIES, ZONES } from './constants.js';
import { isValidGhi, sampleGhiGrid } from './ghi-grid.js';

/** Synthetic GHI fallback when NASA POWER grid is unavailable. */
export function estimateGHISynthetic(lat, lng) {
    const absLat = Math.abs(lat);

    let base = 1.0 + 5.5 * Math.pow(Math.cos((absLat * Math.PI) / 180), 1.5);
    const subtropicalBoost = 2.5 * Math.exp(-Math.pow(absLat - 25, 2) / 200);
    const equatorialDip = 1.2 * Math.exp(-Math.pow(absLat, 2) / 100);
    let estimated = base + subtropicalBoost - equatorialDip;

    const hotspots = [
        { lat: 25, lng: 15, r: 30, boost: 2.0 },
        { lat: 23, lng: 45, r: 25, boost: 1.8 },
        { lat: -24, lng: -69, r: 15, boost: 3.0 },
        { lat: -25, lng: 135, r: 35, boost: 1.8 },
        { lat: 35, lng: -115, r: 20, boost: 1.6 },
        { lat: 33, lng: 85, r: 25, boost: 1.2 },
    ];

    hotspots.forEach((h) => {
        const dLat = lat - h.lat;
        const dLng = ((lng - h.lng + 180) % 360) - 180;
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);
        estimated += h.boost * Math.exp(-Math.pow(dist, 2) / (h.r * h.r));
    });

    const coldspots = [
        { lat: 0, lng: -65, r: 25, drop: 1.5 },
        { lat: 0, lng: 20, r: 20, drop: 1.4 },
        { lat: 5, lng: 110, r: 30, drop: 1.2 },
        { lat: 60, lng: 15, r: 30, drop: 1.0 },
        { lat: 50, lng: -125, r: 25, drop: 0.8 },
    ];

    coldspots.forEach((c) => {
        const dLat = lat - c.lat;
        const dLng = ((lng - c.lng + 180) % 360) - 180;
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);
        estimated -= c.drop * Math.exp(-Math.pow(dist, 2) / (c.r * c.r));
    });

    return Math.max(0, Math.min(10.0, estimated));
}

/** GHI (kWh/m²/day): NASA POWER annual grid when loaded, else synthetic fallback. */
export function ghiKwhPerM2Day(lat, lng, grid) {
    if (grid?.values?.length) {
        const v = sampleGhiGrid(grid, lat, lng);
        if (isValidGhi(v)) return v;
    }
    return estimateGHISynthetic(lat, lng);
}

export function getZone(ghi) {
    for (const z of ZONES) {
        const [lo, hi] = z.range;
        if (z.id === 6) {
            if (ghi >= lo) return z;
        } else if (ghi >= lo && ghi < hi) {
            return z;
        }
    }
    return ZONES[ZONES.length - 1];
}

function sameCity(a, b) {
    return a.name === b.name && a.country === b.country && a.lat === b.lat && a.lng === b.lng;
}

export function isOppositeHemisphere(userLat, cityLat) {
    if (userLat > 0) return cityLat < 0;
    if (userLat < 0) return cityLat > 0;
    return cityLat < 0;
}

export function findSisterCity(userLat, referenceGhi) {
    const pool = CITIES.filter((c) => isOppositeHemisphere(userLat, c.lat));
    if (pool.length === 0) return null;
    return pool.reduce((a, b) =>
        Math.abs(a.ghi - referenceGhi) <= Math.abs(b.ghi - referenceGhi) ? a : b,
    );
}

function zoneTypicalGhi(zone) {
    const [lo, hi] = zone.range;
    if (zone.id === 6) return lo + 0.75;
    return (lo + hi) / 2;
}

export function findCitiesInZone(zoneId, limit = 5) {
    const zone = ZONES.find((z) => z.id === zoneId);
    if (!zone || CITIES.length === 0) return [];

    const inZone = CITIES.filter((c) => getZone(c.ghi).id === zoneId);
    if (inZone.length === 0) return [];

    const target = zoneTypicalGhi(zone);
    const typical = inZone.reduce((a, b) =>
        Math.abs(a.ghi - target) <= Math.abs(b.ghi - target) ? a : b,
    );

    const sorted = [...inZone].sort((a, b) => b.ghi - a.ghi);
    const idx = sorted.findIndex((c) => sameCity(c, typical));
    const mid = Math.floor(limit / 2);
    let start = idx === -1 ? 0 : idx - mid;
    start = Math.max(0, Math.min(start, Math.max(0, sorted.length - limit)));
    const slice = sorted.slice(start, start + limit);
    const matchIndex = slice.findIndex((c) => sameCity(c, typical));

    return slice.map((c, i) => ({
        ...c,
        isClosestMatch: matchIndex === -1 ? i === Math.floor(slice.length / 2) : i === matchIndex,
    }));
}

export function findSimilarCities(ghi, limit = 5, exclude = null) {
    const pool = exclude ? CITIES.filter((c) => !sameCity(c, exclude)) : [...CITIES];
    if (pool.length === 0) return [];

    const sorted = [...pool].sort((a, b) => b.ghi - a.ghi);
    const closest = pool.reduce((a, b) =>
        Math.abs(a.ghi - ghi) <= Math.abs(b.ghi - ghi) ? a : b,
    );

    const idx = sorted.findIndex((c) => sameCity(c, closest));
    const mid = Math.floor(limit / 2);
    let start = idx === -1 ? 0 : idx - mid;
    start = Math.max(0, Math.min(start, Math.max(0, sorted.length - limit)));
    const slice = sorted.slice(start, start + limit);
    const matchIndex = slice.findIndex((c) => sameCity(c, closest));

    return slice.map((c, i) => ({
        ...c,
        isClosestMatch: matchIndex === -1 ? i === 0 && sameCity(c, closest) : i === matchIndex,
    }));
}

export function zoneGhiRangeLabel(zone) {
    const [lo, hi] = zone.range;
    if (zone.id === 6) return `${lo}+`;
    return `${lo}–${hi}`;
}

export function getZoneNarrative(zoneId) {
    const text = {
        1: 'This is the lowest band on the map: the sun is relatively weak year-round, so each panel produces less electricity than in sunnier regions.',
        2: 'Temperate solar band: useful sunshine, but winter months are noticeably weaker than summer.',
        3: 'Middle-of-the-road globally — rooftop solar is broadly viable; economics depend on electricity prices and net metering.',
        4: 'Solid solar resource: horizontal surfaces receive healthy energy over the year. PV tends to perform well here.',
        5: 'Strong solar band. The sun delivers plenty of energy on average; photovoltaic systems usually produce generously.',
        6: 'Among the strongest bands on Earth for horizontal sunshine. Yields per panel are high.',
    };
    return text[zoneId] ?? text[1];
}

export function formatLatLng(lat, lng) {
    const latStr = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`;
    const lngStr = `${Math.abs(lng).toFixed(2)}°${lng >= 0 ? 'E' : 'W'}`;
    return `${latStr}, ${lngStr}`;
}
