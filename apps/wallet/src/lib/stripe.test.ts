import { describe, it, expect } from "vitest";
import type Stripe from "stripe";
import { creditMicrosFromPrice, microsToStripeMinorUnit } from "./stripe";

// microsToStripeMinorUnit converts a USD-micros amount to the cents Stripe
// charges (ADR 0002/0002). Getting this wrong charges the wrong money, so pin it.
describe("microsToStripeMinorUnit", () => {
  it("converts whole-dollar bundle amounts to cents", () => {
    expect(microsToStripeMinorUnit(19_000_000)).toBe(1900); // $19.00
    expect(microsToStripeMinorUnit(95_000_000)).toBe(9500); // $95.00
    expect(microsToStripeMinorUnit(318_000_000)).toBe(31_800); // $318.00
  });

  it("rounds sub-cent micros to the nearest cent", () => {
    expect(microsToStripeMinorUnit(3_166_667)).toBe(317); // $3.166667 -> 317c
    expect(microsToStripeMinorUnit(4_900)).toBe(0); // below half a cent -> 0
    expect(microsToStripeMinorUnit(5_000)).toBe(1); // half a cent rounds up
  });
});

// creditMicrosFromPrice maps a Stripe Price to the USD-micros balance a bundle
// credits (ADR 0002/0001, AC-2). It prefers metadata.credit_micros, falls back
// to the legacy token/second count times the retail rate for un-migrated prices,
// and returns null when nothing usable is present (so getBundles skips it).

/** Build a minimal Stripe.Price with the given price + product metadata. */
function price(
  priceMetadata: Record<string, string> | null,
  productMetadata?: Record<string, string>
): Stripe.Price {
  return {
    id: "price_test",
    metadata: priceMetadata,
    product:
      productMetadata === undefined
        ? "prod_test"
        : { metadata: productMetadata },
  } as unknown as Stripe.Price;
}

describe("creditMicrosFromPrice", () => {
  // covers: AC-2 (bundle value comes from Stripe metadata.credit_micros, not code)
  it("reads an explicit credit_micros from price metadata", () => {
    expect(creditMicrosFromPrice(price({ credit_micros: "19000000" }))).toBe(
      19_000_000
    );
    expect(creditMicrosFromPrice(price({ credit_micros: "95000000" }))).toBe(
      95_000_000
    );
  });

  it("prefers credit_micros over a legacy token count when both are present", () => {
    expect(
      creditMicrosFromPrice(price({ credit_micros: "19000000", tokens: "3600" }))
    ).toBe(19_000_000);
  });

  it("falls back to legacy metadata.tokens (seconds) times the retail rate", () => {
    // chargeMicrosForSeconds(3600) = 19_000_020 at the default rate.
    expect(creditMicrosFromPrice(price({ tokens: "3600" }))).toBe(19_000_020);
  });

  it("falls back to legacy metadata.credit_seconds", () => {
    // chargeMicrosForSeconds(18000) = round(18000 * 316667 / 60) = 95_000_100.
    expect(creditMicrosFromPrice(price({ credit_seconds: "18000" }))).toBe(
      95_000_100
    );
  });

  it("reads from product metadata when price metadata has nothing usable", () => {
    expect(creditMicrosFromPrice(price({}, { credit_micros: "5000000" }))).toBe(
      5_000_000
    );
  });

  it("returns null for malformed or missing values", () => {
    expect(creditMicrosFromPrice(price({ credit_micros: "banana" }))).toBeNull();
    expect(creditMicrosFromPrice(price({}))).toBeNull();
    expect(creditMicrosFromPrice(price(null))).toBeNull();
  });

  it("rejects zero and negative amounts (not a usable balance)", () => {
    expect(creditMicrosFromPrice(price({ credit_micros: "0" }))).toBeNull();
    expect(creditMicrosFromPrice(price({ credit_micros: "-100" }))).toBeNull();
    expect(creditMicrosFromPrice(price({ tokens: "0" }))).toBeNull();
  });
});
