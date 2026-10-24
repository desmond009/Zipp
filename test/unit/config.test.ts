import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env.js';

const REQUIRED = { MONGO_URI: 'mongodb://localhost:27017', REDIS_URL: 'redis://localhost:6379' };

describe('loadConfig', () => {
  it('uses BASE_URL when set', () => {
    const config = loadConfig({ ...REQUIRED, BASE_URL: 'https://zipp.example', RENDER_EXTERNAL_URL: 'https://zipp.onrender.com' });
    expect(config.BASE_URL).toBe('https://zipp.example');
  });

  it("falls back to Render's public URL when BASE_URL is not set", () => {
    const config = loadConfig({ ...REQUIRED, RENDER_EXTERNAL_URL: 'https://zipp.onrender.com' });
    expect(config.BASE_URL).toBe('https://zipp.onrender.com');
  });

  it('defaults to localhost for local development', () => {
    expect(loadConfig(REQUIRED).BASE_URL).toBe('http://localhost:3000');
  });

  it('parses "false" as false (z.coerce.boolean would read it as true)', () => {
    expect(loadConfig({ ...REQUIRED, CACHE_ENABLED: 'false', TRUST_PROXY: 'false' })).toMatchObject({
      CACHE_ENABLED: false,
      TRUST_PROXY: false,
    });
  });

  it('fails fast with a readable message when a required setting is missing', () => {
    expect(() => loadConfig({ REDIS_URL: 'redis://localhost:6379' })).toThrow(/Invalid environment configuration[\s\S]*MONGO_URI/);
  });
});
