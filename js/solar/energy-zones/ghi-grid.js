/**
 * NASA POWER–style annual mean GHI grid (kWh/m²/day), bilinear sampling.
 * @typedef {{ source: string, period: string, parameter: string, nLat: number, nLng: number, values: (number|null)[] }} GhiGrid
 */

function clampLat(lat) {
    return Math.min(90, Math.max(-90, lat));
}

function wrapLng(lng) {
    let x = lng;
    while (x < -180) x += 360;
    while (x > 180) x -= 360;
    return x;
}

/** Bilinear sample; returns NaN if a corner is missing. */
export function sampleGhiGrid(grid, lat, lng) {
    const { nLat, nLng, values } = grid;
    const la = clampLat(lat);
    const lo = wrapLng(lng);

    const rowF = Math.min(nLat - 1, Math.max(0, ((90 - la) / 180) * (nLat - 1)));
    let colF = ((lo + 180) / 360) * nLng;
    if (colF >= nLng) colF = nLng - 1e-9;

    const r0 = Math.floor(rowF);
    const r1 = Math.min(nLat - 1, r0 + 1);
    const c0 = Math.floor(colF) % nLng;
    const c1 = (c0 + 1) % nLng;
    const tr = rowF - r0;
    const tc = colF - Math.floor(colF);

    const at = (r, c) => {
        const cc = ((c % nLng) + nLng) % nLng;
        const v = values[r * nLng + cc];
        return v == null || Number.isNaN(v) ? NaN : v;
    };

    const v00 = at(r0, c0);
    const v01 = at(r0, c1);
    const v10 = at(r1, c0);
    const v11 = at(r1, c1);

    if ([v00, v01, v10, v11].some((v) => Number.isNaN(v))) {
        return NaN;
    }

    const top = v00 * (1 - tc) + v01 * tc;
    const bot = v10 * (1 - tc) + v11 * tc;
    return top * (1 - tr) + bot * tr;
}

export function isValidGhi(v) {
    return Number.isFinite(v) && v >= 0 && v < 40;
}

let gridPromise = null;

/** Lazy-load bundled NASA POWER grid. */
export function loadGhiGrid() {
    if (!gridPromise) {
        gridPromise = fetch('data/ghi-grid.json', { cache: 'force-cache' })
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => (data?.values?.length ? data : null))
            .catch(() => null);
    }
    return gridPromise;
}
