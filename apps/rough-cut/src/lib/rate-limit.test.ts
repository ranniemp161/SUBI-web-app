import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rateLimit } from './rate-limit';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(function() { return {}; }),
}));

const { mockLimit, mockFixedWindow } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockFixedWindow: vi.fn(),
}));

vi.mock('@upstash/ratelimit', () => {
  return {
    Ratelimit: class MockRatelimit {
      static fixedWindow = mockFixedWindow;
      limit = mockLimit;
    }
  };
});

describe('rateLimit', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('allows the request when KV is not configured', async () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;

    const result = await rateLimit('test:123', 10, 60);

    expect(result).toEqual({
      allowed: true,
      remaining: 10,
      limit: 10,
    });
  });

  it('calls the ratelimiter when KV is configured', async () => {
    process.env.KV_REST_API_URL = 'http://localhost';
    process.env.KV_REST_API_TOKEN = 'token';

    mockLimit.mockResolvedValueOnce({ success: true, remaining: 9 });

    const result = await rateLimit('test:123', 10, 60);

    expect(result).toEqual({
      allowed: true,
      remaining: 9,
      limit: 10,
    });
    expect(Redis).toHaveBeenCalled();
    expect(mockFixedWindow).toHaveBeenCalledWith(10, '60 s');
    expect(mockLimit).toHaveBeenCalledWith('test:123');
  });

  it('blocks the request when the rate limit is exceeded', async () => {
    process.env.KV_REST_API_URL = 'http://localhost';
    process.env.KV_REST_API_TOKEN = 'token';

    mockLimit.mockResolvedValueOnce({ success: false, remaining: 0 });

    const result = await rateLimit('test:123', 10, 60);

    expect(result).toEqual({
      allowed: false,
      remaining: 0,
      limit: 10,
    });
  });

  it('throws an error in production if KV_REST_API_URL or KV_REST_API_TOKEN is missing', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.KV_REST_API_URL;
    
    await expect(rateLimit('prod:key', 10, 60)).rejects.toThrow(
      'KV_REST_API_URL and KV_REST_API_TOKEN must be set in production.'
    );
  });

  it('fails open and allows the request if Redis throws an error', async () => {
    process.env.KV_REST_API_URL = 'http://localhost';
    process.env.KV_REST_API_TOKEN = 'token';

    mockLimit.mockRejectedValueOnce(new Error('Redis connection failed'));

    const result = await rateLimit('error:key', 10, 60);

    expect(result).toEqual({
      allowed: true,
      remaining: 10,
      limit: 10,
    });
  });
});
