"use server";

import { auth } from "@clerk/nextjs/server";
import { getAuthorizedDbUser } from "@/lib/authz";
import { db } from "@repo/db";
import { creditLedger, projects } from "@repo/db/schema";
import { eq, desc, lt, and } from "drizzle-orm";
import { getSavedCard } from "@/lib/stripe";

export async function loadMoreTransactions(cursorDateStr: string) {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    throw new Error("Unauthorized");
  }

  const user = await getAuthorizedDbUser(clerkId);
  if (!user) {
    throw new Error("User not found");
  }

  const cursorDate = new Date(cursorDateStr);

  const [ledgerHistory, savedCard] = await Promise.all([
    db
      .select({
        id: creditLedger.id,
        reason: creditLedger.reason,
        deltaMicros: creditLedger.deltaMicros,
        createdAt: creditLedger.createdAt,
        fileName: projects.fileName,
        projectId: creditLedger.projectId,
      })
      .from(creditLedger)
      .leftJoin(projects, eq(creditLedger.projectId, projects.id))
      .where(
        and(
          eq(creditLedger.userId, user.id),
          lt(creditLedger.createdAt, cursorDate)
        )
      )
      .orderBy(desc(creditLedger.createdAt))
      .limit(50),
    getSavedCard(user.defaultPaymentMethodId),
  ]);

  const serializedHistory = ledgerHistory.map((entry) => ({
    id: entry.id,
    reason: entry.reason,
    deltaMicros: entry.deltaMicros,
    createdAt: entry.createdAt.toISOString(),
    fileName: entry.fileName,
    projectId: entry.projectId,
    cardInfo: savedCard ? `${savedCard.brand} ••••${savedCard.last4}` : null,
  }));

  return serializedHistory;
}
