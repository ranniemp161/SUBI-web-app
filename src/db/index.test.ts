// Regression guard: the AbortSignal created per withDbRetry attempt must reach
// the Neon driver's fetch (via AsyncLocalStorage + neonConfig.fetchFunction)
// and actually fire on timeout — otherwise timed-out attempts leave stalled
// fetches in flight alongside their retries.
import { describe, it, expect, vi } from "vitest";

describe("withDbRetry abort wiring", () => {
  it("aborts the in-flight fetch when an attempt times out", async () => {
    const capturedSignals: (AbortSignal | undefined)[] = [];

    // Capture the signal each driver-level fetch receives; never resolve, so
    // only the timeout path can end the attempt.
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: unknown, init?: RequestInit) => {
        capturedSignals.push(init?.signal ?? undefined);
        return new Promise<Response>(() => {});
      })
    );

    process.env.DATABASE_URL = "postgresql://user:pass@db.example.test/neondb";
    const { db, withDbRetry } = await import("./index");
    const { users } = await import("./schema");

    await expect(
      withDbRetry(() => db.select().from(users).limit(1), {
        attempts: 2,
        timeoutMs: 100,
        baseDelayMs: 10,
      })
    ).rejects.toThrow(/exceeded 100ms/);

    // One fetch per attempt, each carrying its own signal, each aborted.
    expect(capturedSignals).toHaveLength(2);
    for (const signal of capturedSignals) {
      expect(signal).toBeDefined();
      expect(signal!.aborted).toBe(true);
    }
    // Distinct controllers per attempt — not one shared signal.
    expect(capturedSignals[0]).not.toBe(capturedSignals[1]);

    vi.unstubAllGlobals();
  });
});
