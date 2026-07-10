# Review, uncommitted, 2026-07-10

**Reviewed by**: Antigravity (author on Unknown)
**Scope**: 18 files, uncommitted
**Verdict**: Blocked

## Summary
This PR contains a dangerous scope creep and massive business logic changes. While the roadmap marks "Named/labeled AI Cut runs" as done, the code actually completely rips out the `accessCodes` system and sets `users.isMember` to default to `true`. This grants the Skool community credit benefits to any user who signs up, which is a major security risk if unintended. Furthermore, the webhook tests are broken due to mismatched mocks, and the newly added user provisioning logic is duplicated and untested. I am blocking this until the scope and authorization changes are clarified.

## Blockers
- **`packages/db/src/schema.ts:46`**: The `isMember` default was changed to `true` and the `access_codes` table was deleted. This gives every new signup immediate "Skool community member" privileges (monthly credits). This is a massive business logic change that contradicts the stated PR intent.
- **`docs/roadmap/rough-cut/roadmap.md:129`**: The roadmap claims the PR is for "Named/labeled AI Cut runs", but there are no code changes for that feature in this diff. The branch contains unrelated, destructive auth changes instead.

## Major
- **`apps/rough-cut/src/app/api/webhooks/clerk/route.test.ts:15`**: The test mocks `@/lib/rate-limit`, but the route implementation was updated to use `ipRateLimit` from `@/lib/ip-rate-limit`. The test is completely disconnected from reality and broken.
- **`apps/rough-cut/src/lib/users.ts:10`**: New `provisionUser` logic lacks any test coverage, violating the test adequacy rule. (The old `access-codes.test.ts` was deleted without a replacement).

## Minor
- **`apps/wallet/src/lib/users.ts:1`**: Exact duplicate of `apps/rough-cut/src/lib/users.ts`. Since both apps use `@repo/db`, this shared DB operation should live in `packages/db/src/users.ts` to avoid duplication.
- **`apps/rough-cut/src/app/api/webhooks/clerk/route.ts:42`**: Rate limiting the webhook by IP (`ipRateLimit`) means you are rate-limiting Clerk's outbound servers. If Clerk sends webhooks from a small pool of IPs, a moderate burst of signups will exceed 120/min and drop valid `user.created` events. Rely on the Svix signature for security and consider removing the IP limit.
- **`apps/rough-cut/src/app/api/webhooks/clerk/route.ts:83`**: If `email` resolves to an empty string `""` (e.g., if Clerk payload structure changes), it passes `""` to `provisionUser`. It would be safer to explicitly reject the webhook with a 400 response if no email is found.

## Nits
- **`apps/rough-cut/src/lib/users.ts:18`**: The `onConflictDoUpdate` uses `sql`${users.email}`` to perform a no-op update. This is good for avoiding write-amplification on every `authz.ts` check, but it's worth a comment to clarify this intent for future readers, as the old comment from `access-codes.ts` explaining it was lost.

## Strengths
- **Idempotency**: Moving the `provisionUser` logic to a single upsert ensures no race conditions between the Clerk webhook and the immediate post-signup redirect.
- **Clean UI refactor**: The removal of the access code UI state in `page.tsx` was done cleanly, leaving a standard email/password flow (assuming the access code removal is eventually authorized).

## Test coverage
- Tests for `provisionUser` are entirely missing.
- The webhook route tests are fundamentally broken because they mock the wrong rate limiter module.
