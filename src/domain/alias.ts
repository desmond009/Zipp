import { GENERATED_CODE_PATTERN } from './short-code.js';

/** Any code we could ever have issued, generated or custom. */
const CODE_PATTERN = /^[A-Za-z0-9_-]{3,30}$/;

/** Paths the app uses (or will use) itself. Compared case-insensitively. */
const RESERVED_ALIASES = new Set(['api', 'health', 'stats', 'admin', 'static', 'assets', 'public', 'index']);

/**
 * Returns an error message if the alias is not allowed, otherwise null.
 *
 * Generated codes are always exactly 7 alphanumeric characters. Rejecting
 * aliases with that exact shape makes the two sets disjoint, so a custom alias
 * can never take a code the counter will hand out later.
 */
export function validateAlias(alias: string): string | null {
  if (!CODE_PATTERN.test(alias)) {
    return 'Alias must be 3-30 characters: letters, digits, "-" or "_"';
  }
  if (GENERATED_CODE_PATTERN.test(alias)) {
    return 'A 7-character alias must contain "-" or "_" (plain 7-character codes are reserved for generated links)';
  }
  if (RESERVED_ALIASES.has(alias.toLowerCase())) {
    return `"${alias}" is reserved`;
  }
  return null;
}

/** Cheap check to reject garbage paths before touching any storage. */
export function isPossibleCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}
