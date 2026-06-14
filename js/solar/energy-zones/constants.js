/** @typedef {{ name: string, country: string, lat: number, lng: number, ghi: number }} City */

/** GHI kWh/m²/day: zones 1–5 are half-open [low, high); zone 6 is ≥ low. */
export const ZONES = Object.freeze([
    { id: 1, range: [0, 2], color: '#313695', label: 'Zone 1' },
    { id: 2, range: [2, 3], color: '#74add1', label: 'Zone 2' },
    { id: 3, range: [3, 4], color: '#fee090', label: 'Zone 3' },
    { id: 4, range: [4, 5], color: '#fdae61', label: 'Zone 4' },
    { id: 5, range: [5, 6], color: '#f46d43', label: 'Zone 5' },
    { id: 6, range: [6, Number.POSITIVE_INFINITY], color: '#a50026', label: 'Zone 6' },
]);

/** Reference cities for similar-city and sister-city hints. */
export const CITIES = Object.freeze([
    { name: 'Reykjavik', country: 'Iceland', lat: 64.1265, lng: -21.8174, ghi: 1.8 },
    { name: 'Helsinki', country: 'Finland', lat: 60.1695, lng: 24.9354, ghi: 2.1 },
    { name: 'Oslo', country: 'Norway', lat: 59.9139, lng: 10.7522, ghi: 2.2 },
    { name: 'Stockholm', country: 'Sweden', lat: 59.3293, lng: 18.0686, ghi: 2.3 },
    { name: 'London', country: 'UK', lat: 51.5074, lng: -0.1278, ghi: 2.6 },
    { name: 'Berlin', country: 'Germany', lat: 52.52, lng: 13.405, ghi: 2.8 },
    { name: 'Paris', country: 'France', lat: 48.8566, lng: 2.3522, ghi: 3.1 },
    { name: 'Vancouver', country: 'Canada', lat: 49.2827, lng: -123.1207, ghi: 3.2 },
    { name: 'Seattle', country: 'USA', lat: 47.6062, lng: -122.3321, ghi: 3.3 },
    { name: 'New York', country: 'USA', lat: 40.7128, lng: -74.006, ghi: 3.8 },
    { name: 'Beijing', country: 'China', lat: 39.9042, lng: 116.4074, ghi: 4.1 },
    { name: 'Tokyo', country: 'Japan', lat: 35.6762, lng: 139.6503, ghi: 3.6 },
    { name: 'Madrid', country: 'Spain', lat: 40.4168, lng: -3.7038, ghi: 4.5 },
    { name: 'Rome', country: 'Italy', lat: 41.9028, lng: 12.4964, ghi: 4.2 },
    { name: 'San Francisco', country: 'USA', lat: 37.7749, lng: -122.4194, ghi: 4.8 },
    { name: 'Los Angeles', country: 'USA', lat: 34.0522, lng: -118.2437, ghi: 5.2 },
    { name: 'Cairo', country: 'Egypt', lat: 30.0444, lng: 31.2357, ghi: 6.1 },
    { name: 'Dubai', country: 'UAE', lat: 25.2048, lng: 55.2708, ghi: 6.4 },
    { name: 'Riyadh', country: 'Saudi Arabia', lat: 24.7136, lng: 46.6753, ghi: 6.6 },
    { name: 'Mumbai', country: 'India', lat: 19.076, lng: 72.8777, ghi: 5.1 },
    { name: 'Bangkok', country: 'Thailand', lat: 13.7563, lng: 100.5018, ghi: 5.0 },
    { name: 'Nairobi', country: 'Kenya', lat: -1.2921, lng: 36.8219, ghi: 5.8 },
    { name: 'Singapore', country: 'Singapore', lat: 1.3521, lng: 103.8198, ghi: 4.5 },
    { name: 'Jakarta', country: 'Indonesia', lat: -6.2088, lng: 106.8456, ghi: 4.6 },
    { name: 'Brasilia', country: 'Brazil', lat: -15.7975, lng: -47.8919, ghi: 5.5 },
    { name: 'Sydney', country: 'Australia', lat: -33.8688, lng: 151.2093, ghi: 4.8 },
    { name: 'Cape Town', country: 'South Africa', lat: -33.9249, lng: 18.4241, ghi: 5.3 },
    { name: 'Santiago', country: 'Chile', lat: -33.4489, lng: -70.6693, ghi: 5.1 },
    { name: 'Buenos Aires', country: 'Argentina', lat: -34.6037, lng: -58.3816, ghi: 4.4 },
    { name: 'Melbourne', country: 'Australia', lat: -37.8136, lng: 144.9631, ghi: 4.1 },
    { name: 'Phoenix', country: 'USA', lat: 33.4484, lng: -112.074, ghi: 6.2 },
    { name: 'Las Vegas', country: 'USA', lat: 36.1699, lng: -115.1398, ghi: 6.0 },
    { name: 'Mexico City', country: 'Mexico', lat: 19.4326, lng: -99.1332, ghi: 5.6 },
    { name: 'Lima', country: 'Peru', lat: -12.0464, lng: -77.0428, ghi: 4.2 },
    { name: 'Bogota', country: 'Colombia', lat: 4.711, lng: -74.0721, ghi: 4.0 },
    { name: 'Lagos', country: 'Nigeria', lat: 6.5244, lng: 3.3792, ghi: 4.8 },
    { name: 'Johannesburg', country: 'South Africa', lat: -26.2041, lng: 28.0473, ghi: 5.6 },
    { name: 'Perth', country: 'Australia', lat: -31.9505, lng: 115.8605, ghi: 5.8 },
    { name: 'Alice Springs', country: 'Australia', lat: -23.698, lng: 133.8807, ghi: 6.8 },
    { name: 'Antofagasta', country: 'Chile', lat: -23.6509, lng: -70.3975, ghi: 7.2 },
]);

/** Baseline GHI (kWh/m²/day) where irradiance scale = 1.0 in the simulator. */
export const REFERENCE_GHI_KWH = 5.0;
