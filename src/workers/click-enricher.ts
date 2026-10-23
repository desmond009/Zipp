import { createHmac } from 'node:crypto';
import UAParser from 'ua-parser-js';
import type { ClickEvent } from '../domain/click-event.js';
import type { ClickDocument } from '../repositories/click.repository.js';
import type { GeoLookup } from './geo/geo-lookup.js';

const UNKNOWN = 'unknown';

/** Turns a raw click event into the document we store: parsed UA, country, referrer host, hashed IP. */
export class ClickEnricher {
  constructor(
    private readonly geo: GeoLookup,
    private readonly ipHashSecret: string,
  ) {}

  enrich(event: ClickEvent): ClickDocument {
    const ua = new UAParser(event.userAgent).getResult();
    return {
      ts: new Date(event.timestamp),
      meta: { code: event.code },
      country: this.geo.country(event.ip) ?? UNKNOWN,
      device: deviceType(event.userAgent, ua.device.type),
      browser: ua.browser.name ?? UNKNOWN,
      os: ua.os.name ?? UNKNOWN,
      referrer: referrerHost(event.referrer),
      ipHash: this.hashIp(event.ip),
    };
  }

  /**
   * HMAC rather than a plain SHA-256: there are only ~4 billion IPv4
   * addresses, so plain hashes can be reversed by hashing every one of them.
   * Without the secret, that's impossible. Truncated: 64 bits is plenty to
   * tell visitors apart.
   */
  private hashIp(ip: string): string {
    return createHmac('sha256', this.ipHashSecret).update(ip).digest('hex').slice(0, 16);
  }
}

function deviceType(userAgent: string, parsedType: string | undefined): string {
  if (parsedType) return parsedType; // mobile, tablet, smarttv, ...
  // ua-parser leaves type empty for desktops, but also for an empty UA.
  return userAgent ? 'desktop' : UNKNOWN;
}

/** "https://www.google.com/search?q=x" -> "google.com"; no Referer header -> "direct". */
function referrerHost(referrer: string): string {
  if (!referrer) return 'direct';
  try {
    return new URL(referrer).hostname.replace(/^www\./, '') || UNKNOWN;
  } catch {
    return UNKNOWN;
  }
}
