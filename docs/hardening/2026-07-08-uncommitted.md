# Hardening, uncommitted, 2026-07-08

**Analysed by**: systems-level review on sonnet
**Scope**: 9 files, uncommitted
**Risk posture**: Harden before merge

## Summary
The changes introduce new client-side UI components and a dashboard layout refactor. The primary exposure surfaces are the `fetch` calls in the `AutorechargePanel` which lack network resilience (timeouts) and proper error visibility, as well as minor UI state race conditions between independent asynchronous actions.

## Should-harden
### 🟠 Missing fetch timeouts and aborts, `apps/wallet/src/app/dashboard/autorecharge-panel.tsx:67`
**Scenario**: The user clicks "Save settings" or "Add card" on a flaky mobile connection. The request hangs indefinitely. Because there is no timeout or `AbortSignal`, the `saving` or `addingCard` state remains true forever, locking the UI until the user refreshes.
**Impact**: Poor user experience; UI gets stuck in a loading state.
**Mitigation**: Use an `AbortController` with `setTimeout` to abort the fetch if it takes longer than 10 seconds.
**Verify with**: Vitest test simulating a stalled response.

### 🟠 Swallowed network errors, `apps/wallet/src/app/dashboard/autorecharge-panel.tsx:91`
**Scenario**: The `fetch` call fails due to a CORS issue, DNS failure, or the user being entirely offline. The catch block simply sets a generic "Something went wrong." message, discarding the actual `Error` object. 
**Impact**: Production debugging is impossible for network-level failures since the original error isn't logged to the console or an observability tool.
**Mitigation**: Add `console.error(err)` inside the catch blocks before setting the generic user-facing message.
**Verify with**: Typecheck/`/verify` check.

## Watch / accept
- 🟡 `apps/wallet/src/app/dashboard/autorecharge-panel.tsx:162`, The "Save settings" and "Add card" actions track independent loading states (`saving` vs `addingCard`), meaning a user could click both concurrently. Accepted because the backend should handle concurrent requests safely.
- 🟡 `apps/wallet/src/app/dashboard/autorecharge-panel.tsx:55`, Input validation relies purely on the browser's `type="number"` and backend validation. Very large, negative, or fractional values might be sent. Accepted because the API is the source of truth for validation.

## Already covered
- Double-submit prevention: The save and add card buttons correctly disable themselves while their respective operations are in flight.
- Graceful degradation for unauthenticated users: The server component handles missing users correctly by returning an access denied message rather than throwing a 500.
