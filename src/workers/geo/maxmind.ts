import { Reader, type ReaderModel } from '@maxmind/geoip2-node';
import type { GeoLookup } from './geo-lookup.js';

/**
 * Looks up countries in a local GeoLite2 database file. The file is loaded
 * into memory once, so each lookup is a fast in-process tree search with no
 * network call.
 */
export class MaxMindGeoLookup implements GeoLookup {
  private constructor(private readonly reader: ReaderModel) {}

  static async open(databasePath: string): Promise<MaxMindGeoLookup> {
    return new MaxMindGeoLookup(await Reader.open(databasePath));
  }

  country(ip: string): string | null {
    try {
      return this.reader.country(ip).country?.isoCode ?? null;
    } catch {
      // AddressNotFoundError for private/unlisted IPs (e.g. 10.x, 192.168.x),
      // ValueError for malformed ones. Neither should stop the click being counted.
      return null;
    }
  }
}
