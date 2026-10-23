/**
 * Resolves an IP address to a country. An interface so the worker doesn't
 * depend on MaxMind directly: tests and local dev use StaticGeoLookup, and
 * swapping to a paid API or another database touches one file.
 */
export interface GeoLookup {
  /** ISO 3166-1 alpha-2 country code ("IN", "US"), or null if unknown. */
  country(ip: string): string | null;
}
