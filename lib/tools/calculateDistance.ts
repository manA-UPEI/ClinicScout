import { Coordinates } from "../types";

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance. This is straight-line, not routing distance — the
 * spec's `calculate_distance` ideally uses a routing engine, but no keyless
 * routing API exists, so we under-promise here rather than mislabel it.
 */
export function calculate_distance(
  user_location: Coordinates,
  clinic_location: Coordinates
): { distance_km: number } {
  const dLat = toRadians(clinic_location.lat - user_location.lat);
  const dLon = toRadians(clinic_location.lon - user_location.lon);
  const lat1 = toRadians(user_location.lat);
  const lat2 = toRadians(clinic_location.lat);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.asin(Math.sqrt(a));

  return { distance_km: Math.round(EARTH_RADIUS_KM * c * 10) / 10 };
}
