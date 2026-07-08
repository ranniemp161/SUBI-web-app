import { describe, it, expect } from "vitest";
import {
  MICROS_PER_USD,
  RETAIL_MICROS_PER_MINUTE,
  chargeMicrosForSeconds,
  formatUsd,
} from "./money";

// These pure money helpers are the shared display + metering edge for the USD
// wallet (ADR 0002/0001). They are the single place micros become dollars and
// the single place billable seconds become a retail charge, so they are worth
// pinning exactly.

describe("constants", () => {
  it("MICROS_PER_USD is one million (1,000,000 micros = $1)", () => {
    expect(MICROS_PER_USD).toBe(1_000_000);
  });

  it("default retail rate is the rounded $19 / 60 min rate", () => {
    // covers: AC-3 (the configured retail rate the whole slice meters at)
    expect(RETAIL_MICROS_PER_MINUTE).toBe(316_667);
  });
});

describe("formatUsd", () => {
  // covers: AC-1 (balance is shown as US dollars formatted $X.XX)
  it("formats a whole-dollar bundle value", () => {
    expect(formatUsd(19_000_000)).toBe("$19.00");
    expect(formatUsd(95_000_000)).toBe("$95.00");
    expect(formatUsd(318_000_000)).toBe("$318.00");
  });

  it("formats zero", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("rounds sub-cent micros to two decimals at the display edge", () => {
    // 3_166_667 micros = $3.166667 -> shown as $3.17
    expect(formatUsd(3_166_667)).toBe("$3.17");
    // 5_277 micros = $0.005277 -> shown as $0.01
    expect(formatUsd(5_277)).toBe("$0.01");
  });

  it("formats a negative delta (a charge) with a leading minus", () => {
    expect(formatUsd(-5_000_000)).toBe("-$5.00");
  });
});

describe("chargeMicrosForSeconds", () => {
  // covers: AC-3 (transcribe/AI Cut deduct real dollars at the retail rate)
  it("charges one minute at exactly the per-minute rate", () => {
    expect(chargeMicrosForSeconds(60)).toBe(316_667);
    expect(chargeMicrosForSeconds(120)).toBe(633_334);
  });

  it("rounds the per-second charge to whole micros", () => {
    // 1s = 316667/60 = 5277.78 -> 5278 ; 30s = 158333.5 -> 158334
    expect(chargeMicrosForSeconds(1)).toBe(5_278);
    expect(chargeMicrosForSeconds(30)).toBe(158_334);
  });

  it("is zero for zero seconds", () => {
    expect(chargeMicrosForSeconds(0)).toBe(0);
  });

  it("uses the rounded rate, so an hour is not identical to the exact bundle conversion", () => {
    // The metering rate (316_667/min) differs by design from the exact bundle
    // conversion (19_000_000 / 3600s) used in migration 0003; that is why an
    // hour meters to 19_000_020, not 19_000_000. Documented, not a bug.
    expect(chargeMicrosForSeconds(3600)).toBe(19_000_020);
  });

  it("honors an explicit rate override (the server's env-tuned rate)", () => {
    expect(chargeMicrosForSeconds(60, 500_000)).toBe(500_000);
    expect(chargeMicrosForSeconds(30, 500_000)).toBe(250_000);
  });
});
