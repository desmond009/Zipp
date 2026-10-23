// ua-parser-js v1 ships no TypeScript types. This declares only the parts we use,
// instead of adding @types/ua-parser-js as another dependency.
declare module 'ua-parser-js' {
  interface UAResult {
    browser: { name?: string; version?: string };
    os: { name?: string; version?: string };
    /** type is "mobile", "tablet", "smarttv", ... and undefined for desktops. */
    device: { type?: string; vendor?: string; model?: string };
  }

  export default class UAParser {
    constructor(userAgent?: string);
    getResult(): UAResult;
  }
}
