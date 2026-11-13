import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

export interface ExplorePlace {
  placeId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

// Adapted from roshpat/quorum-travel-planner: share one loader across renders.
let loadPromise: Promise<void> | null = null;
let configured = false;

// Google requests cannot be aborted here; late responses after timeout are ignored.
export function withTimeout<T>(request: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Request timed out")), 15000);
    request.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}
export function loadGoogleMaps(apiKey: string): Promise<void> {
  if (!apiKey.trim()) return Promise.reject(new Error("Missing Maps key"));
  if (!loadPromise) {
    if (!configured) {
      setOptions({ key: apiKey, v: "weekly" });
      configured = true;
    }
    loadPromise = withTimeout(Promise.all([
      importLibrary("maps"), importLibrary("marker"), importLibrary("places"),
    ])).then(() => undefined).catch((error: unknown) => {
      loadPromise = null;
      throw error;
    });
  }
  return loadPromise;
}

export async function searchPlaces(query: string): Promise<ExplorePlace[]> {
  const { Place } = await withTimeout(importLibrary("places"));
  const { places } = await withTimeout(Place.searchByText({
    textQuery: query,
    fields: ["id", "displayName", "formattedAddress", "location"],
    maxResultCount: 6,
  }));
  return places.flatMap((place) => {
    if (!place.id || !place.displayName || !place.location) return [];
    return [{
      placeId: place.id,
      name: place.displayName,
      address: place.formattedAddress || "Address unavailable",
      latitude: place.location.lat(),
      longitude: place.location.lng(),
    }];
  });
}
