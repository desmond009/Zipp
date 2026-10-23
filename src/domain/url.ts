import { ValidationError } from '../errors.js';

export const MAX_URL_LENGTH = 2048;

/**
 * Validates a user-supplied URL and returns its normalized form.
 *
 * The WHATWG URL parser does most of the normalization: lowercases the scheme
 * and host, removes default ports (:80, :443), and percent-encodes the path.
 *
 * @param ownHost host of this service, rejected to prevent redirect loops
 */
export function normalizeUrl(input: string, ownHost: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) {
    throw new ValidationError(`URL must be 1-${MAX_URL_LENGTH} characters`);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ValidationError('URL is not valid');
  }

  // Blocks javascript:, data:, file:, ftp: and friends.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError('Only http and https URLs are allowed');
  }
  // https://google.com@evil.com looks like Google but goes to evil.com.
  if (url.username || url.password) {
    throw new ValidationError('URLs with embedded credentials are not allowed');
  }
  if (url.host === ownHost) {
    throw new ValidationError('Cannot shorten a link that points to this service');
  }

  return url.href;
}
