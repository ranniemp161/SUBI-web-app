import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getAuthorizedDbUser } from "@/lib/authz";
import { db } from "@repo/db";
import { creditLedger } from "@repo/db/schema";
import { eq, desc } from "drizzle-orm";
import { getBundles, getSavedCard } from "@/lib/stripe";

import { BalanceHero } from "./balance-hero";
import { LowBalanceBanner } from "./low-balance-banner";
import { BundleCards } from "./bundle-cards";
import { AutorechargePanel } from "./autorecharge-panel";
import { TransactionHistory } from "./transaction-history";

/**
 * Premium wallet billing dashboard (ADR 0002/0003, slice 3).
 *
 * Server component: fetches the user, bundles, ledger history, and saved card,
 * then renders the five client sections — balance hero, low-balance banner,
 * add-funds cards, auto-recharge panel, and transaction history.
 */
export default async function DashboardPage() {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    redirect("/sign-in");
  }

  const user = await getAuthorizedDbUser(clerkId);
  if (!user) {
    return (
      <div className="max-w-5xl mx-auto px-8 py-16 text-center">
        <p
          className="text-lg font-medium"
          style={{ color: "var(--wallet-text-secondary)" }}
        >
          Access denied. You do not have an account.
        </p>
      </div>
    );
  }

  // Fetch data concurrently.
  const [ledgerHistory, bundles, savedCard] = await Promise.all([
    db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.userId, user.id))
      .orderBy(desc(creditLedger.createdAt))
      .limit(50),
    getBundles(),
    getSavedCard(user.defaultPaymentMethodId),
  ]);

  // Serialize ledger entries for client components.
  const serializedHistory = ledgerHistory.map((entry) => ({
    id: entry.id,
    reason: entry.reason,
    deltaMicros: entry.deltaMicros,
    createdAt: entry.createdAt.toISOString(),
  }));

  return (
    <div className="max-w-5xl mx-auto px-8 py-10">
      <div className="flex flex-col gap-8">
        {/* 1. Balance hero */}
        <BalanceHero
          balanceMicros={user.balanceMicros}
          autorechargeEnabled={user.autorechargeEnabled}
          autorechargeThresholdMicros={user.autorechargeThresholdMicros}
        />

        {/* 2. Low-balance banner (only renders when relevant) */}
        <LowBalanceBanner
          balanceMicros={user.balanceMicros}
          autorechargeEnabled={user.autorechargeEnabled}
          autorechargeThresholdMicros={user.autorechargeThresholdMicros}
        />

        {/* 3. Add funds cards */}
        <BundleCards bundles={bundles} />

        {/* 4. Auto-recharge settings */}
        <AutorechargePanel
          enabled={user.autorechargeEnabled}
          thresholdMicros={user.autorechargeThresholdMicros}
          amountMicros={user.autorechargeAmountMicros}
          hasCard={Boolean(user.defaultPaymentMethodId)}
          savedCard={savedCard}
          failures={user.autorechargeFailures}
        />

        {/* 5. Transaction history */}
        <TransactionHistory entries={serializedHistory} />
      </div>
    </div>
  );
}
