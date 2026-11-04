---
name: multi-user
description: Use when working on Trilium's multi-user support (#4956) — the `milestone/multi_user` branch, users/groups/note_permissions tables, `ownerId`/`userId` columns, note visibility over the single Becca, `permission_service`, `/api/users` and `/api/permissions`, session/CLS `userId`, admin seeding, or reviewing/merging a multi-user phase PR. Covers the data model, the planned per-user visibility filter, the rules for touching Becca from new code, migrations, testing, the phase roadmap, and the known gaps that are not bugs to rediscover.
---

# Multi-user support in Trilium

Multi-user (#4956) is built in **phases** that target `milestone/multi_user`, never `main`. Phases 1 (#10273) and 2 (#10348) are merged there; phase 3 exists only as a single commit on the contributor's fork (`sashank/phase3` ref). Before trusting anything below, re-check the phase state:

```bash
git log --oneline main..milestone/multi_user        # what has landed
git log --oneline milestone/multi_user..sashank/phase3   # phase 3 delta (if the ref is fetched)
```

The branch is shared with an external contributor (SashankBhamidi) whose next phase is stacked on it: **merge, never rebase**, and don't force-push.

## Mental model in one paragraph

Every authenticated request carries `session.userId`, which `route_api.ts` copies into CLS (`getUserId()`); `user_service.getCurrentUser()` resolves that user's row on first use and memoizes it in CLS, checked against the current `userId`, so `cls.set("userId", …)` stays the one way to act as a user. There is **one Becca**, the default export of `becca.ts`, and it is currently **unprotected**: every user reads every note. Phase 2's per-user Becca copies (`getBecca()`, `warmBeccaForUser`, `becca_cache`, `loadBeccaForUser`, Shared with me) were removed on 2026-11-04 in favour of a single Becca with a per-user visibility filter that reads the CLS `userId`; that filter is being built step by step and does not exist yet. The design it follows: the only per-user state is a visibility set (`Set<noteId>` for read and write), recomputed on branch, grant and `ownerId` changes; Becca's lookups and the BNote relationship getters (`parents`, `children`, `parentBranches`, `ownedAttributes`, `targetRelations`, backed by private fields) filter through it on read, while inheritance inside BNote walks the unfiltered graph. No `userId` in CLS (ETAPI, desktop/Electron without login, schedulers, `cls.init()` blocks, startup) means unfiltered.

**Homes.** Every user except the primary admin has a home note `home_<userId>` (`getHomeNoteId()`), owned by them, under the admin-only Users note (`USERS_NOTE_ID = "users"`, no `_` prefix because it holds user content). `user_homes.ensureUserHome()` runs when the Users API creates a user and `ensureUserHomes()` at startup; the Users note appears only once a second user exists, so single-user instances never see it. Until the visibility filter lands, a member sees the home in its stored place under the Users note; the filter is to show it under `root` and list unreachable shared notes under Shared with me, both as an overlay on `root`'s children. The primary admin's notes stay directly under `root`; for everyone else `createNewNote()` swaps a `root` parent for the home (`getActingUserHomeNoteId()`, an after/before target becomes "into"), and `validateParentChild()` refuses moves and clones to `root`. There is no relocation of older top-level notes: multi-user is unreleased, so only development databases have any.

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
| Users note and per-user homes | `packages/trilium-core/src/services/user_homes.ts` |
| Permission resolution / grant / revoke | `packages/trilium-core/src/services/permission_service.ts` |
| User CRUD, `isUserAdmin`, `getAdminUserId` | `packages/trilium-core/src/services/user_service.ts` |
| CLS `getUserId()` | `packages/trilium-core/src/services/context.ts` |
| Request → CLS userId | `apps/server/src/routes/route_api.ts` (`internalRoute`) |
| Admin-only REST | `apps/server/src/routes/api/users.ts`, `apps/server/src/routes/api/permissions.ts` (registered in `routes.ts`) |
| WS client → userId at handshake, `sendMessageToUserClients` | `apps/server/src/services/ws_messaging_provider.ts`, `packages/trilium-core/src/services/messaging/types.ts` |
| Admin seed + backfill | `packages/trilium-core/src/services/sql_init.ts` |
| OpenID enrollment storage | `apps/server/src/services/encryption/open_id_encryption.ts` |

## Rules for code you write on this branch

1. **Visibility belongs in the Becca layer, not at call sites.** Import the default `becca` as on `main`, and inside entities use `this.becca`; don't add per-route `canUserAccessNote()` filtering, which the visibility filter replaces. On the server a nested `cls.init(...)` copies the enclosing context (`cls_provider.ts`), so work a request starts keeps its `userId`; only contexts rooted outside a request (boot, timers set at startup, ETAPI, MCP, `/custom/*`) start without one and run unfiltered.
2. **Permission checks go through `permission_service`**, never ad-hoc SQL on `note_permissions`. Admin and owner short-circuit to full access; otherwise grants on the note *and every ancestor across all branches* are merged, highest privilege wins, write implies read.
3. **After any grant/revoke or group-membership change, clear caches**: `permission_service.clearPermissionCache()` plus `ws.reloadFrocaForUser()` for every affected user (`grantPermission`/`revokePermission` already do this — a new mutation path such as group membership must too).
4. **Admin gating**: today each admin-only handler checks `user_service.getCurrentUser()?.isAdmin` itself (never `req.session`, so a route spec puts the user in CLS the way `internalRoute` does) and returns `[403, { message }]`. Follow that shape until a central gate exists (see gaps).
5. **Ownership on creation**: create notes through `notes.createNewNote()` so `ownerId` gets stamped. Raw `new BNote({...}).save()` without `ownerId` ends up admin-owned after the next restart's backfill.
6. **Core must stay platform-agnostic** (CLAUDE.md rules). Anything in `becca/` that needs a user's role queries `users` via raw SQL instead of `user_service`, which would close an options→becca import cycle.

## Migrations

Branch migrations are 243 (identity + ownership columns + `oauth_enrollment`, drops `user_data`) and 244 (`note_permissions`). They were 239/240 until the 2026-11-01 merge of `main`, which already used 239–242. **Every time `main` is merged in, check whether it added migrations at or above ours and renumber again** so ours stay on top. Dev databases that ran an older numbering skip the main migrations that took those numbers; recreate them rather than patching. Both are `ignoreErrors: true` SQL migrations; data work (admin seed, backfill) intentionally lives in `seedAdminUser()` rather than the migration because the SQL instance/options aren't ready mid-chain.

Older JS migrations call `becca_loader.load()` / save notes before `ownerId` exists, which is why `becca_loader.ts` and `bnote.ts` probe `pragma_table_info('notes')` for `ownerId`. Keep those probes when touching load/save.

## Testing

- Core permission/Becca tests use a real in-memory DB inside `cls.init` and insert users/notes/branches/grants with raw SQL — see `packages/trilium-core/src/services/permission_service.spec.ts` for the helper set (`insertUser`, `insertNote`, `insertBranch`, `insertGroup`, ...). Set `cls.set("userId", ...)` to impersonate.
- Route tests: `apps/server/src/routes/api/users.spec.ts`, `permissions.spec.ts`.
- Run: core specs execute through the server's vitest config (core has no runner of its own): `pnpm --filter @triliumnext/server test ../../packages/trilium-core/src/services/permission_service.spec.ts`, `pnpm --filter @triliumnext/server test src/routes/api/permissions.spec.ts`.
- `notes` and `attachments` both have an `ownerId` column (on attachments it means the owning note, not a user). Qualify it in any SQL that joins the two, or it fails with "ambiguous column name". Follow the `writing-unit-tests` skill for harness details.

## Merging `main` into the milestone

Merge, never rebase. Render conflicts with `git checkout --conflict=zdiff3` and diff both sides against the base. Renumber migrations (above), check that `becca_loader` changes on `main` keep the `ownerId` column probe, run `pnpm typecheck`, and run the full `pnpm --filter @triliumnext/server test`.

## Phases and what is still open

See [roadmap-and-gaps.md](roadmap-and-gaps.md) for the per-phase scope, the phase 3 contents, and the list of **known, deliberate-or-deferred gaps** (no visibility filter yet, no write enforcement, no admin gate on dangerous routes, ...). Check it before reporting any of those as a new bug.
