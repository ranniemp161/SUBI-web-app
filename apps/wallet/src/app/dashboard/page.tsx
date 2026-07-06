import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getAuthorizedDbUser } from "@/lib/authz";
import { db } from "@repo/db";
import { creditLedger, users } from "@repo/db/schema";
import { eq, desc } from "drizzle-orm";
import { getBundles } from "@/lib/stripe";

export default async function DashboardPage() {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    redirect("/sign-in");
  }

  const user = await getAuthorizedDbUser(clerkId);
  if (!user) {
    // If not a member/no user, might want to show an error or redirect
    return <div>Access Denied. You do not have an account.</div>;
  }

  // Fetch ledger history
  const ledgerHistory = await db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.userId, user.id))
    .orderBy(desc(creditLedger.createdAt))
    .limit(50);

  const bundles = await getBundles();

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8">Wallet Dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Balance Card */}
        <div className="bg-white dark:bg-zinc-900 border dark:border-zinc-800 rounded-xl p-6 shadow-sm flex flex-col justify-center items-center">
          <h2 className="text-lg font-medium text-zinc-500 dark:text-zinc-400 mb-2">Available Tokens</h2>
          <div className="text-5xl font-extrabold text-blue-600 dark:text-blue-400 mb-4">{user.tokens}</div>
          <p className="text-sm text-zinc-400 text-center">Tokens are consumed across the SUBI ecosystem apps.</p>
        </div>

        {/* Top-up Card */}
        <div className="bg-white dark:bg-zinc-900 border dark:border-zinc-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">Add Tokens</h2>
          <div className="flex flex-col gap-3">
            {bundles.map((bundle) => (
              <form key={bundle.priceId} action="/api/billing/checkout" method="POST">
                <input type="hidden" name="priceId" value={bundle.priceId} />
                <button
                  type="submit"
                  className="w-full flex items-center justify-between p-3 rounded-lg border dark:border-zinc-700 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                >
                  <span className="font-medium">{bundle.tokens} Tokens</span>
                  <span className="text-zinc-600 dark:text-zinc-300 font-semibold">
                    {(bundle.amount / 100).toLocaleString("en-US", {
                      style: "currency",
                      currency: bundle.currency.toUpperCase(),
                    })}
                  </span>
                </button>
              </form>
            ))}
          </div>
        </div>
      </div>

      {/* Ledger */}
      <div className="mt-12">
        <h2 className="text-2xl font-bold mb-6">Transaction History</h2>
        <div className="bg-white dark:bg-zinc-900 border dark:border-zinc-800 rounded-xl overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50 border-b dark:border-zinc-800">
              <tr>
                <th className="px-6 py-4 text-sm font-semibold text-zinc-500">Date</th>
                <th className="px-6 py-4 text-sm font-semibold text-zinc-500">Description</th>
                <th className="px-6 py-4 text-sm font-semibold text-zinc-500 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-zinc-800">
              {ledgerHistory.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-zinc-500">
                    No transactions yet.
                  </td>
                </tr>
              ) : (
                ledgerHistory.map((entry) => (
                  <tr key={entry.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/20">
                    <td className="px-6 py-4 text-sm text-zinc-600 dark:text-zinc-300">
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium capitalize">
                      {entry.reason.replace('_', ' ')}
                    </td>
                    <td className={`px-6 py-4 text-sm font-bold text-right ${entry.deltaTokens > 0 ? 'text-green-600 dark:text-green-400' : 'text-zinc-900 dark:text-zinc-100'}`}>
                      {entry.deltaTokens > 0 ? '+' : ''}{entry.deltaTokens}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
