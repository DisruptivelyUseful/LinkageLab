/**
 * Geocode a free-text address via `/api/geocode` (Nominatim proxy).
 * @typedef {{ lat: number, lng: number, label: string }} GeocodeHit
 */

export async function searchAddress(query) {
    const q = query.trim();
    if (!q) return [];

    const params = new URLSearchParams({ q });
    const res = await fetch(`/api/geocode?${params}`);

    if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = typeof errBody?.error === 'string' ? errBody.error : `Request failed (${res.status})`;
        throw new Error(msg);
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
        throw new Error('Unexpected geocode response');
    }

    return data
        .map((row) => ({
            lat: parseFloat(row.lat),
            lng: parseFloat(row.lon),
            label: row.display_name,
        }))
        .filter((h) => !Number.isNaN(h.lat) && !Number.isNaN(h.lng));
}
