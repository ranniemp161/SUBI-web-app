# Scope: SUBI ecosystem (monorepo)

Maps every workspace scope in this repo. Each app plans its own slices. Repo wide
concerns (the shared `packages/db`, the Wallet billing portal, cross app pricing)
live in `_root`.

**Build approach:** Tracer Bullet (vertical slices; each feature built end to end
through every layer, working).

| Workspace | Scope | Workflow | Status rollup |
|---|---|---|---|
| `_root` (ecosystem wide) | [_root/scope.md](_root/scope.md) | Beta | 1 done, 1 in-progress, 1 existing, 2 deferred, 1 open question |
| `apps/rough-cut` | [rough-cut/scope.md](rough-cut/scope.md) | Beta | 1 done, 4 in-progress, 12 existing, 5 deferred |
| `apps/founders-frame` | [founders-frame/scope.md](founders-frame/scope.md) | Alpha | 1 done, 1 planned, 2 existing |
| `apps/broll` | [broll/scope.md](broll/scope.md) | Alpha | 1 done (Phase 0 spikes), 1 in-progress, 5 planned |
| `apps/wallet` | tracked under `_root` | see `_root` | the Wallet app **is** the ecosystem wide billing feature |

## Notes

- `apps/broll` has a scope but **still no workspace** — Phase 0 was a throwaway
  prototype outside this repo, and the `apps/broll` directory does not exist until
  Phase 1 scaffolds it. The scope is listed because the design is settled and the
  spikes are done, not because there is code. Phase 1 began anyway: the parts that
  do not need the workspace (the shared package, the schema migration, Rough Cut's
  export) are built, and the scaffold itself is blocked on a production domain.
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

_Drafted by /scope, worth a quick human pass._
