/**
 * Forward geocode queries to Nominatim (OpenStreetMap).
 * @see https://operations.osmfoundation.org/policies/nominatim/
 */
export async function forwardNominatim(q) {
    const query = typeof q === 'string' ? q.trim() : '';
    if (!query) {
        return { status: 200, json: [] };
    }

    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('q', query);
    u.searchParams.set('format', 'json');
    u.searchParams.set('limit', '8');

    const r = await fetch(u, {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'LinkageLab/1.0 (solar site picker; educational)',
        },
    });

    if (!r.ok) {
        return { status: 502, json: { error: 'Geocoding service unavailable' } };
    }

    const json = await r.json();
    return { status: 200, json };
}
