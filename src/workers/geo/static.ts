import type { GeoLookup } from './geo-lookup.js';

/**
 * Fallback when no GeoLite2 file is configured, and a fake for tests: only
 * knows the IPs it is given.
 */
export class StaticGeoLookup implements GeoLookup {
  constructor(private readonly knownIps: Record<string, string> = {}) {}

  country(ip: string): string | null {
    return this.knownIps[ip] ?? null;
  }
}
