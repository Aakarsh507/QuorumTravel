/**
 * Bundled IATA airport list (FR-102: "IATA codes checked against a bundled
 * airport list"). Prototype scope: major US airports plus every destination
 * the solver can recommend. Coordinates are used to estimate flight cost.
 */
export interface Airport {
  code: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
}

export const AIRPORTS: readonly Airport[] = [
  { code: "ATL", city: "Atlanta", state: "GA", lat: 33.64, lon: -84.43 },
  { code: "AUS", city: "Austin", state: "TX", lat: 30.19, lon: -97.67 },
  { code: "AVL", city: "Asheville", state: "NC", lat: 35.44, lon: -82.54 },
  { code: "BNA", city: "Nashville", state: "TN", lat: 36.12, lon: -86.68 },
  { code: "BOS", city: "Boston", state: "MA", lat: 42.36, lon: -71.01 },
  { code: "CHS", city: "Charleston", state: "SC", lat: 32.9, lon: -80.04 },
  { code: "CLE", city: "Cleveland", state: "OH", lat: 41.41, lon: -81.85 },
  { code: "CLT", city: "Charlotte", state: "NC", lat: 35.21, lon: -80.94 },
  { code: "CMH", city: "Columbus", state: "OH", lat: 39.998, lon: -82.89 },
  { code: "CVG", city: "Cincinnati", state: "OH", lat: 39.05, lon: -84.66 },
  { code: "DCA", city: "Washington", state: "DC", lat: 38.85, lon: -77.04 },
  { code: "DEN", city: "Denver", state: "CO", lat: 39.86, lon: -104.67 },
  { code: "DFW", city: "Dallas", state: "TX", lat: 32.9, lon: -97.04 },
  { code: "DTW", city: "Detroit", state: "MI", lat: 42.21, lon: -83.35 },
  { code: "EWR", city: "Newark", state: "NJ", lat: 40.69, lon: -74.17 },
  { code: "IAH", city: "Houston", state: "TX", lat: 29.98, lon: -95.34 },
  { code: "IND", city: "Indianapolis", state: "IN", lat: 39.72, lon: -86.29 },
  { code: "JFK", city: "New York", state: "NY", lat: 40.64, lon: -73.78 },
  { code: "LAS", city: "Las Vegas", state: "NV", lat: 36.08, lon: -115.15 },
  { code: "LAX", city: "Los Angeles", state: "CA", lat: 33.94, lon: -118.41 },
  { code: "MCO", city: "Orlando", state: "FL", lat: 28.43, lon: -81.31 },
  { code: "MDW", city: "Chicago (Midway)", state: "IL", lat: 41.79, lon: -87.75 },
  { code: "MIA", city: "Miami", state: "FL", lat: 25.79, lon: -80.29 },
  { code: "MSP", city: "Minneapolis", state: "MN", lat: 44.88, lon: -93.22 },
  { code: "MSY", city: "New Orleans", state: "LA", lat: 29.99, lon: -90.26 },
  { code: "ORD", city: "Chicago", state: "IL", lat: 41.98, lon: -87.9 },
  { code: "PDX", city: "Portland", state: "OR", lat: 45.59, lon: -122.6 },
  { code: "PHL", city: "Philadelphia", state: "PA", lat: 39.87, lon: -75.24 },
  { code: "PHX", city: "Phoenix", state: "AZ", lat: 33.43, lon: -112.01 },
  { code: "PIT", city: "Pittsburgh", state: "PA", lat: 40.49, lon: -80.23 },
  { code: "SAN", city: "San Diego", state: "CA", lat: 32.73, lon: -117.19 },
  { code: "SAV", city: "Savannah", state: "GA", lat: 32.13, lon: -81.2 },
  { code: "SDF", city: "Louisville", state: "KY", lat: 38.17, lon: -85.74 },
  { code: "SEA", city: "Seattle", state: "WA", lat: 47.45, lon: -122.31 },
  { code: "SFO", city: "San Francisco", state: "CA", lat: 37.62, lon: -122.38 },
  { code: "SLC", city: "Salt Lake City", state: "UT", lat: 40.79, lon: -111.98 },
  { code: "STL", city: "St. Louis", state: "MO", lat: 38.75, lon: -90.37 },
  { code: "TPA", city: "Tampa", state: "FL", lat: 27.98, lon: -82.53 },
];

const BY_CODE = new Map(AIRPORTS.map((a) => [a.code, a]));

export const findAirport = (code: string): Airport | undefined => BY_CODE.get(code.trim().toUpperCase());
export const isKnownAirport = (code: string): boolean => BY_CODE.has(code.trim().toUpperCase());

/** Great-circle distance in miles. */
export function milesBetween(a: Airport, b: Airport): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}
