---
name: multi-user
description: Use when working on Trilium's multi-user support (#4956) — the `milestone/multi_user` branch, users/groups/note_permissions tables, `ownerId`/`userId` columns, per-user Becca (`getBecca()`, `warmBeccaForUser`, `becca_cache`), `permission_service`, `/api/users` and `/api/permissions`, session/CLS `userId`, admin seeding, or reviewing/merging a multi-user phase PR. Covers the data model, how a request picks its Becca, the rules for touching Becca from new code, migrations, testing, the phase roadmap, and the known gaps that are not bugs to rediscover.
---

# Multi-user support in Trilium

Multi-user (#4956) is built in **phases** that target `milestone/multi_user`, never `main`. Phases 1 (#10273) and 2 (#10348) are merged there; phase 3 exists only as a single commit on the contributor's fork (`sashank/phase3` ref). Before trusting anything below, re-check the phase state:

```bash
git log --oneline main..milestone/multi_user        # what has landed
git log --oneline milestone/multi_user..sashank/phase3   # phase 3 delta (if the ref is fetched)
```

The branch is shared with an external contributor (SashankBhamidi) whose next phase is stacked on it: **merge, never rebase**, and don't force-push.

## Mental model in one paragraph

Every authenticated request carries `session.userId`. `route_api.ts` copies it into CLS and, before the handler runs, calls `warmBeccaForUser(userId)`, which resolves either the global **admin Becca** (admins) or a **filtered per-user Becca** (non-admins) loaded by `loadBeccaForUser()` and cached for 30 min idle in `becca_cache.ts`. From then on, every `getBecca()` call in that request — including the `this.becca` getter on every entity — returns that resolved instance. No `userId` in CLS (ETAPI, desktop/Electron without login, schedulers, `cls.init()` blocks, startup) means **admin Becca**. Intended visibility = notes the user owns (`notes.ownerId`) plus anything reachable below a `note_permissions` grant (direct or via group). **In practice phase 2 does not isolate yet**: the loader also seeds `root`, so every user still sees every note — see the gaps file.

## Data model (schema.sql + migrations 239/240)

| Table / column | Purpose | Synced? |
|---|---|---|
| `users` (`userId`, `username`, `email`, `isAdmin`, `isDeleted`, `passwordHash/Salt`) | Identity. Soft delete; partial unique index on `username WHERE isDeleted = 0` so deleted names can be reused. `passwordHash` is unused so far (login still uses the instance password). | No (not an entity) |
| `user_groups`, `user_group_members` | Groups. No API/UI yet — only rows inserted in tests. | No |
| `note_permissions` (`noteId`, `userId` XOR-ish `groupId`, `canRead`, `canWrite`) | ACL grants. `CHECK (userId IS NOT NULL OR groupId IS NOT NULL)`. Inherited down the tree. | **No** — known gap |
| `oauth_enrollment` (single row `id = 0`) | Replaces old `user_data`: scrypt verification hash + encrypted data key for OpenID. Server-only, must never sync. | Never |
| `notes.ownerId` | Stamped in `notes.createNewNote()` from `cls.getUserId() ?? adminUserId`. | Yes (part of note row/hash) |
| `entity_changes.userId`, `etapi_tokens.userId` | Added in 239, backfilled to admin. **Not stamped on new rows** in phase 2 — phase 3 starts writing/filtering them. | — |
| option `adminUserId` (`isSynced = 0`) | The primary (seeded) admin. Cannot be deleted (`PrimaryAdminDeletionError`). | No |

`seedAdminUser()` (`packages/trilium-core/src/services/sql_init.ts`) runs on **every** `initDbConnection()`: ensures one admin exists (promotes an existing non-admin `admin` row if the insert collides), backfills NULL `ownerId`/`userId` to it, and writes `adminUserId`. So NULL `ownerId` is transient — anything created without it is reassigned to the admin on next boot.

Both login paths (`apps/server/src/routes/login.ts` password/TOTP, `apps/server/src/services/open_id.ts` SSO) set `req.session.userId = user_service.getAdminUserId()` — there is **no per-user login yet**; only the admin can actually sign in. Non-admin sessions exist only in tests or by hand-editing the session.

## Key files

| Concern | File |
|---|---|
| Becca selection (`getBecca`, `warmBeccaForUser`, `adminBecca`) | `packages/trilium-core/src/becca/becca.ts` |
| Per-user Becca cache (30 min idle TTL, `evictUser`, `evictIdle` every 5 min) | `packages/trilium-core/src/becca/becca_cache.ts` |
| Filtered load (`loadBeccaForUser`, recursive CTE) | `packages/trilium-core/src/becca/becca_loader.ts` |
| Permission resolution / grant / revoke | `packages/trilium-core/src/services/permission_service.ts` |
| User CRUD, `isUserAdmin`, `getAdminUserId` | `packages/trilium-core/src/services/user_service.ts` |
| CLS `getUserId()` | `packages/trilium-core/src/services/context.ts` |
| Request → CLS userId → warm Becca | `apps/server/src/routes/route_api.ts` (`internalRoute`) |
| Admin-only REST | `apps/server/src/routes/api/users.ts`, `apps/server/src/routes/api/permissions.ts` (registered in `routes.ts`) |
| WS client → userId at handshake, `sendMessageToUserClients` | `apps/server/src/services/ws_messaging_provider.ts`, `packages/trilium-core/src/services/messaging/types.ts` |
| Admin seed + backfill | `packages/trilium-core/src/services/sql_init.ts` |
| OpenID enrollment storage | `apps/server/src/services/encryption/open_id_encryption.ts` |

## Rules for code you write on this branch

1. **Never import the default `becca`** in new code. Use `getBecca()` (`import { getBecca } from "../becca/becca.js"` in core, `getBecca` from `@triliumnext/core` in server). The default export is the unfiltered admin Becca; ~25 server files (ETAPI, LLM tools, `files.ts`, OCR, share, OneNote import) still import it and leak every note — when you touch one, convert it. Inside entities use `this.becca`.
2. **`getBecca()` throws for a non-admin with no warmed Becca.** Any new entry point that runs with a non-admin `userId` in CLS (custom router, WS handler, background job) must `await warmBeccaForUser(userId)` first, the way `internalRoute` does. Conversely, `cls.init(...)` starts a fresh context with no `userId`, so code inside it silently runs as admin.
3. **Do not use `getBecca()` during load.** `loadBeccaForUser` sets CLS `loadingBecca` so entity constructors register into the Becca being built; anything that calls `getBecca()` mid-load gets that partial instance.
4. **Permission checks go through `permission_service`**, never ad-hoc SQL on `note_permissions`. Admin and owner short-circuit to full access; otherwise grants on the note *and every ancestor across all branches* are merged, highest privilege wins, write implies read.
5. **After any grant/revoke or group-membership change, clear caches**: `permission_service.clearPermissionCache()` plus `evictUser()` for every affected user (`grantPermission`/`revokePermission` already do this — a new mutation path such as group membership must too).
6. **Admin gating**: today each admin-only handler checks `user_service.getUserById(req.session.userId)?.isAdmin` itself and returns `[403, { message }]`. Follow that shape until a central gate exists (see gaps).
7. **Ownership on creation**: create notes through `notes.createNewNote()` so `ownerId` gets stamped. Raw `new BNote({...}).save()` without `ownerId` ends up admin-owned after the next restart's backfill.
8. **Core must stay platform-agnostic** (CLAUDE.md rules). `becca.ts` deliberately queries `users` via raw SQL instead of `user_service` to avoid an options→becca import cycle — keep that pattern if you add checks there.

## Migrations

Branch migrations are 239 (identity + ownership columns + `oauth_enrollment`, drops `user_data`) and 240 (`note_permissions`). **`main` already uses 239–242**, so the next merge of `main` into the milestone must renumber these (to 243/244 or whatever is next) and update `schema.sql`. Both are `ignoreErrors: true` SQL migrations; data work (admin seed, backfill) intentionally lives in `seedAdminUser()` rather than the migration because the SQL instance/options aren't ready mid-chain.

Older JS migrations call `becca_loader.load()` / save notes before `ownerId` exists, which is why `becca_loader.ts` and `bnote.ts` probe `pragma_table_info('notes')` for `ownerId`. Keep those probes when touching load/save.

## Testing

- Core permission/Becca tests use a real in-memory DB inside `cls.init` and insert users/notes/branches/grants with raw SQL — see `packages/trilium-core/src/services/permission_service.spec.ts` for the helper set (`insertUser`, `insertNote`, `insertBranch`, `insertGroup`, ...). Set `cls.set("userId", ...)` to impersonate.
- Route tests: `apps/server/src/routes/api/users.spec.ts`, `permissions.spec.ts`.
- Specs that previously imported default `becca` now import `getBecca` — follow suit in new specs.
- Run: `pnpm --filter @triliumnext/core test src/services/permission_service.spec.ts`, `pnpm --filter @triliumnext/server test src/routes/api/permissions.spec.ts`. Follow the `writing-unit-tests` skill for harness details.

## Phases and what is still open

See [roadmap-and-gaps.md](roadmap-and-gaps.md) for the per-phase scope, the phase 3 contents, and the list of **known, deliberate-or-deferred gaps** (no write enforcement, cross-Becca staleness, everyone sees the `_hidden` subtree, no admin gate on dangerous routes, ...). Check it before reporting any of those as a new bug.
