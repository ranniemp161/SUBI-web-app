import { describe, it, expect, vi, afterEach } from 'vitest';

describe('env.ts', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalUrl = process.env.NEXT_PUBLIC_ROUGH_CUT_URL;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    process.env.NEXT_PUBLIC_ROUGH_CUT_URL = originalUrl;
    vi.resetModules();
  });

  it('uses devFallback in non-production when env var is missing', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.NEXT_PUBLIC_ROUGH_CUT_URL;
    const { ROUGH_CUT_URL } = await import('./env');
    expect(ROUGH_CUT_URL).toBe('http://localhost:3000');
  });

  it('uses env var in non-production when provided', async () => {
    process.env.NODE_ENV = 'development';
    process.env.NEXT_PUBLIC_ROUGH_CUT_URL = 'http://test.local/';
    const { ROUGH_CUT_URL } = await import('./env');
    expect(ROUGH_CUT_URL).toBe('http://test.local');
  });

  it('throws in production when missing required env var', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.NEXT_PUBLIC_ROUGH_CUT_URL;
    await expect(import('./env')).rejects.toThrow('Missing required env var: NEXT_PUBLIC_ROUGH_CUT_URL');
  });

  it('removes trailing slashes in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_ROUGH_CUT_URL = 'https://prod.example.com/';
    const { ROUGH_CUT_URL } = await import('./env');
    expect(ROUGH_CUT_URL).toBe('https://prod.example.com');
  });
});
