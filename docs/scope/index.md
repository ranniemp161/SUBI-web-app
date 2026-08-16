# Scope: SUBI ecosystem (monorepo)

Maps every workspace scope in this repo. Each app plans its own slices. Repo wide
concerns (the shared `packages/db`, the Wallet billing portal, cross app pricing)
live in `_root`.

**Build approach:** Tracer Bullet (vertical slices; each feature built end to end
through every layer, working).

| Workspace | Scope | Workflow | Status rollup |
|---|---|---|---|
| `_root` (ecosystem wide) | [_root/scope.md](_root/scope.md) | Beta | 1 done, 2 in-progress, 1 planned, 3 existing, 2 deferred, 1 open question |
| `apps/rough-cut` | [rough-cut/scope.md](rough-cut/scope.md) | Beta | 3 done, 2 in-progress, 13 existing, 5 deferred |
| `apps/founders-frame` | [founders-frame/scope.md](founders-frame/scope.md) | Alpha | 1 done, 1 planned, 2 existing |
| `apps/broll` | [broll/scope.md](broll/scope.md) | Beta | 2 done, 9 in-progress (all built, none verified), 1 planned |
| `apps/wallet` | tracked under `_root` | see `_root` | the Wallet app **is** the ecosystem wide billing feature |

## Notes

- `apps/broll` **is a real workspace now**, and this note used to say the opposite.
  It was scaffolded in PR #128 on 2026-08-08 and the line stayed stale for four
  days. As of 2026-08-11 the app has three phases of code in it: transcript
  intake, the scene planner, and the character pipeline. Its tier moved from
  Alpha to Beta on 2026-08-12, on the condition its own scope had already written
  down. Every in-progress feature is built, unit covered and **unverified**: no
  Gemini call made by this code had ever succeeded until the vendor was unblocked
  on 2026-08-12 (billing enabled, private Blob store created), and the live
  verification of Phases 2 and 3 is still owed. It also has no production
  deploy, which is now feature 8 there rather than a paragraph.
  **The rollup above went from "2 in-progress, 4 planned" to "6 in-progress, 1
  planned" on 2026-08-13**, and only one of those moves was new work: four rows
  had already shipped and the count here had not caught up. The one genuinely new
  row is feature 9, the Scene Studio screen design, enrolled that day and placed
  ahead of the owed verifications because those verifications need a human driving
  the very screen it is about to replace.
  **Reconciled again on 2026-08-16, and the count moved twice more**, to 9
  in-progress and 1 planned. Feature 11, character reuse, was enrolled on
  2026-08-14 and built almost to the end. Feature 12, the visual pass and the
  Renders view, was enrolled on 2026-08-16 out of work already sitting
  uncommitted in the tree. Neither count change is a verification: seven
  `Verify it` boxes are open across features 3, 4, 5, 6, 7, 9 and 11, and the two
  written verify sheets stand at 17 of 46 and 6 of 72 boxes ticked. Read the
  "landed" wording in that scope carefully, because **`main` stops at PR #143**
  and everything after it is in open pull requests #145 and #146.
- **One piece of work, three scopes, one set of boxes.** The transcript contract
  spans `_root` (a new shared package plus a shared schema migration),
  `apps/rough-cut` (a new export surface and route), and `apps/broll` (which drove
  it). Each scope carries a row so none of them understates its own workspace, but
  the tickable build boxes live **only** in b-roll feature 2. Tick there; the other
  two point at it.
- `apps/wallet` has no scope of its own. Its build is the `_root` scope's
  "USD denominated Wallet" feature, one ecosystem wide capability rather than a
  set of app local slices.
- **This replaced `docs/roadmap/`** on 2026-07-28. The roadmap files are frozen
  history now: they still hold the record of Rough Cut Slices 1 to 7 and the Wallet
  build, which is worth reading, but nothing new goes there. Every still open item
  moved into the scope files above, including Rough Cut's Slice 6, which was in
  flight and kept its number. New Rough Cut work resumes at Slice 8. See the header
  on each roadmap file.
- Specs live in `docs/specs/<workspace>/`, owned by `/architect`. The older
  `docs/adr/` tree is the same idea under the previous naming, still linked from
  the features it governs.
- **An architecture review on 2026-08-07 produced seven action items, and six of
  them shipped the same day** across both apps and two new shared packages
  (`@repo/billing`, `@repo/server-shared`). None of it had a scope row until
  2026-08-08. The rows are `_root` features B and C, rough-cut feature M, and
  `_root` feature 5 for what is left. The review document itself is not in the
  repo, which is the part worth fixing first: see `_root` feature 5.

_Drafted by /scope, worth a quick human pass._
