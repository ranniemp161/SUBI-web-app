import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('env.ts', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses devFallback in non-production when env var is missing', async () => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'development',
      writable: true,
      configurable: true,
    });
    delete process.env.NEXT_PUBLIC_ROUGH_CUT_URL;
    const { ROUGH_CUT_URL } = await import('./env');
    expect(ROUGH_CUT_URL).toBe('http://localhost:3000');
  });

  it('uses env var in non-production when provided', async () => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'development',
      writable: true,
      configurable: true,
    });
    process.env.NEXT_PUBLIC_ROUGH_CUT_URL = 'http://test.local/';
    const { ROUGH_CUT_URL } = await import('./env');
    expect(ROUGH_CUT_URL).toBe('http://test.local');
  });

  it('throws in production when missing required env var', async () => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'production',
      writable: true,
      configurable: true,
    });
    delete process.env.NEXT_PUBLIC_ROUGH_CUT_URL;
    await expect(import('./env')).rejects.toThrow('Missing required env var: NEXT_PUBLIC_ROUGH_CUT_URL');
  });

  it('removes trailing slashes in production', async () => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'production',
      writable: true,
      configurable: true,
    });
    process.env.NEXT_PUBLIC_ROUGH_CUT_URL = 'https://prod.example.com/';
    const { ROUGH_CUT_URL } = await import('./env');
    expect(ROUGH_CUT_URL).toBe('https://prod.example.com');
  });
});
