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

  it("default retail rate is the rounded $5 / 60 min rate", () => {
    // covers: AC-3 (the configured retail rate the whole slice meters at)
    expect(RETAIL_MICROS_PER_MINUTE).toBe(83_333);
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
    expect(chargeMicrosForSeconds(60)).toBe(83_333);
    expect(chargeMicrosForSeconds(120)).toBe(166_666);
  });

  it("rounds the per-second charge to whole micros", () => {
    // 1s = 83333/60 = 1388.88... -> 1389 ; 30s = 83333 * 30 / 60 = 41666.5 -> 41667
    expect(chargeMicrosForSeconds(1)).toBe(1_389);
    expect(chargeMicrosForSeconds(30)).toBe(41_667);
  });

  it("is zero for zero seconds", () => {
    expect(chargeMicrosForSeconds(0)).toBe(0);
  });

  it("uses the rounded rate, so an hour is not identical to the exact bundle conversion", () => {
    // The metering rate (83_333/min) differs by design from the exact bundle
    // conversion (5_000_000 / 3600s); that is why an
    // hour meters to 4_999_980, not 5_000_000. Documented, not a bug.
    expect(chargeMicrosForSeconds(3600)).toBe(4_999_980);
  });

  it("honors an explicit rate override (the server's env-tuned rate)", () => {
    expect(chargeMicrosForSeconds(60, 500_000)).toBe(500_000);
    expect(chargeMicrosForSeconds(30, 500_000)).toBe(250_000);
  });
});
