# Scope: SUBI ecosystem (monorepo)

Maps every workspace scope in this repo. Each app plans its own slices. Repo wide
concerns (the shared `packages/db`, the Wallet billing portal, cross app pricing)
live in `_root`.

**Build approach:** Tracer Bullet (vertical slices; each feature built end to end
through every layer, working).

| Workspace | Scope | Workflow | Status rollup |
|---|---|---|---|
| `_root` (ecosystem wide) | [_root/scope.md](_root/scope.md) | Beta | 1 done, 1 existing, 2 deferred, 1 open question |
| `apps/rough-cut` | [rough-cut/scope.md](rough-cut/scope.md) | Beta | 1 done, 3 in-progress, 12 existing, 5 deferred |
| `apps/founders-frame` | [founders-frame/scope.md](founders-frame/scope.md) | Alpha | 1 done, 1 planned, 2 existing |
| `apps/wallet` | tracked under `_root` | see `_root` | the Wallet app **is** the ecosystem wide billing feature |

## Notes

- `apps/wallet` has no scope of its own. Its build is the `_root` scope's
  "USD denominated Wallet" feature, one ecosystem wide capability rather than a
  set of app local slices.
- **This replaced `docs/roadmap/`** on 2026-07-28. The roadmap files are frozen
  history now: they still hold the full record of Rough Cut slices 1 to 8 and the
  Wallet build, which is worth reading, but nothing new goes there. Every still
  open item was moved into the scope files above. See the header on each roadmap
  file.
- Specs live in `docs/specs/<workspace>/`, owned by `/architect`. The older
  `docs/adr/` tree is the same idea under the previous naming, still linked from
  the features it governs.

_Drafted by /scope, worth a quick human pass._
