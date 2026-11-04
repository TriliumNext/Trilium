---
name: multi-user
description: Use when working on Trilium's multi-user support (#4956) — the `milestone/multi_user` branch, users/groups/note_permissions tables, `ownerId`/`userId` columns, note visibility over the single Becca, `permission_service`, `/api/users` and `/api/permissions`, session/CLS `userId`, admin seeding, or reviewing/merging a multi-user phase PR. Covers the data model, the per-user visibility filter, the rules for touching Becca from new code, migrations, testing, the phase roadmap, and the known gaps that are not bugs to rediscover.
---

# Multi-user support in Trilium

Multi-user (#4956) is built in **phases** that target `milestone/multi_user`, never `main`. Phases 1 (#10273) and 2 (#10348) are merged there, and #12478 replaces phase 2's per-user Becca copies with the single filtered Becca described below. Before trusting anything below, re-check what has landed:

```bash
git log --oneline main..milestone/multi_user        # what has landed
```

The milestone branch is published and PRs target it: **merge, never rebase**, and don't force-push.

## Mental model in one paragraph

Every authenticated request carries `session.userId`, which `route_api.ts` copies into CLS (`getUserId()`); `user_service.getCurrentUser()` resolves that user's row on first use and memoizes it in CLS, checked against the current `userId`, so `cls.set("userId", …)` stays the one way to act as a user. It throws a `ForbiddenError` (a 403 from a route) when CLS holds no user or a deleted one; read `getUserId()` where no user is a valid state. There is **one Becca**, the default export of `becca.ts`, filtered per member by `becca/note_visibility.ts`. A member (a non-admin user in CLS, outside a system scope) sees `root`, the `_` system notes, the notes they own and everything below a grant to them or their group; owning a note grants nothing below it, as in `permission_service`. That set of note IDs is the only per-user state: `getNoteView()` builds a `NoteView` per member, cached under a counter that `invalidateNoteVisibility()` bumps when notes and branches come or go, an `ownerId` changes, grants change or users change. Shared with me exists only in the view, so `user_homes.ts` reloads a member's froca when one of their branch changes moves a note onto or off it. Admins, system scopes and scopes without a user get no view, and when no member exists at all `getNoteView()` returns before reading CLS, so a single-user instance pays nothing.

Through a view, `becca.notes`, `branches`, `attributes` and `childParentToBranch` are proxies that hide the rest, and BNote's `parents`, `children`, `parentBranches` and `targetRelations` are getters over the view. The Becca's own bookkeeping reads the unfiltered `becca.allNotes`/`allBranches`/`allAttributes`/`allChildParentToBranch` and BNote's `allParents`/`allChildren`/`allParentBranches`/`allTargetRelations`: entity `init()` and skeleton creation, the loader's event handlers, inheritance and templates, caches (`__ancestorCache`, flat text, the note-set cache), deletion (a member removing their copy of a shared note leaves the note) and the forced-note-ID check. `ownedAttributes` is unfiltered, since a visible note's attributes are visible. The view also overlays the member's home under `root` (a virtual branch) and `_sharedWithMe`, a virtual note listing visible notes none of whose parents they can see.

**Who a scope acts for.** Every scope acts for a user (`userId` in CLS), for the instance (`cls.isSystem()`), or for nobody, which the filter is to refuse. A system scope is opened with `cls.initAsSystem()` or `cls.wrapAsSystem()` (which drop any `userId` copied in) and is used for startup (`initializeDb`, `loadAtStartup`, the scheduler's subtree check), timers (scheduler, sync, erase, consistency checks, backups), the login password check, the desktop app's main-process work (tray, global shortcuts, custom dictionary, native import, transcripts), and the requests `auth.isSystemRequest()` trusts without a user: the desktop renderer, `noAuthentication`, an instance in setup and a sync peer (`session.isSyncPeer`, set by `/api/login/sync`). ETAPI, MCP and `/custom/*` are system scopes too, only because a token is not tied to a user yet; that is a gap, not a design. On standalone every scope is a system scope, since it has no users. A new root scope that is none of these must not be opened as a system scope: a plain `cls.init()` with no user is what fails closed.

**Homes.** Every user except the primary admin has a home note `home_<userId>` (`getHomeNoteId()`), owned by them, under the admin-only Users note (`USERS_NOTE_ID = "users"`, no `_` prefix because it holds user content). `user_homes.ensureUserHome()` runs when the Users API creates a user and `ensureUserHomes()` at startup; the Users note appears only once a second user exists, so single-user instances never see it. A member's view puts the home under `root` through a virtual branch (`NoteView`); admins see it in its stored place under the Users note. The primary admin's notes stay directly under `root`; for everyone else `createNewNote()` swaps a `root` parent for the home (`getActingUserHomeNoteId()`, an after/before target becomes "into"), and `validateParentChild()` refuses moves and clones to `root`. There is no relocation of older top-level notes: multi-user is unreleased, so only development databases have any.

## Data model (schema.sql + migrations 239/240)

| Table / column | Purpose | Synced? |
|---|---|---|
| `users` (`userId`, `username`, `email`, `isAdmin`, `isDeleted`, `passwordHash/Salt`) | Identity. Soft delete; partial unique index on `username WHERE isDeleted = 0` so deleted names can be reused. Members sign in with `username` and their own password; the primary admin keeps the instance password. | No (not an entity) |
| `user_groups`, `user_group_members` | Groups. No API/UI yet — only rows inserted in tests. | No |
| `note_permissions` (`noteId`, `userId` XOR-ish `groupId`, `canRead`, `canWrite`) | ACL grants. `CHECK (userId IS NOT NULL OR groupId IS NOT NULL)`. Inherited down the tree. | **No** — known gap |
| `oauth_enrollment` (single row `id = 0`) | Replaces old `user_data`: scrypt verification hash + encrypted data key for OpenID. Server-only, must never sync. | Never |
| `notes.ownerId` | Stamped in `notes.createNewNote()` from `cls.getUserId() ?? adminUserId`. | Yes (part of note row/hash) |
| `entity_changes.userId`, `etapi_tokens.userId` | Added in 239, backfilled to admin. **Not stamped on new rows** yet. | — |
| option `adminUserId` (`isSynced = 0`) | The primary (seeded) admin. Cannot be deleted (`PrimaryAdminDeletionError`). | No |

`seedAdminUser()` (`packages/trilium-core/src/services/sql_init.ts`) runs on **every** `initDbConnection()`: ensures one admin exists (promotes an existing non-admin `admin` row if the insert collides), backfills NULL `ownerId`/`userId` to it, and writes `adminUserId`. So NULL `ownerId` is transient — anything created without it is reassigned to the admin on next boot.

The password login (`apps/server/src/routes/login.ts`) sets `req.session.userId` to whoever signed in: a member by username and their own password, the primary admin by the instance password and TOTP. SSO (`apps/server/src/services/open_id.ts`) still signs in only as the primary admin. Every session check (`checkAuth`, `checkApiAuth`, `checkApiAuthOrElectron`, bootstrap, the WebSocket handshake) goes through `auth.isSignedIn()`, which needs `loggedIn` plus a `userId` or `isSyncPeer`: a session without either counts as logged out. A new session check must use it too. Routes without session auth (login, setup, health, and the clipper and sender, which take an ETAPI token) still run in a plain scope.

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

1. **Open a root scope deliberately.** Background work, timers and anything the instance does on its own use `cls.initAsSystem()` / `cls.wrapAsSystem()`; work a request starts stays nested in the request's scope and keeps its user. Raising a request's scope to system (as `database.ts` does through `initializeDb()`) is an escalation and belongs only behind an admin check.
2. **Visibility belongs in the Becca layer, not at call sites.** Import the default `becca` as on `main`, and inside entities use `this.becca`. Read through the filtered names (`becca.notes`, `note.children`, …) for anything a user is shown, and through the `all*` names only for bookkeeping that must see every note, such as keeping the Becca in step with the database or deciding whether a note still has a parent; don't add per-route `canUserAccessNote()` filtering, which the visibility filter replaces. A nested `cls.init(...)` copies the enclosing scope (`cls_provider.ts` on the server, the scope stack on standalone), so work a request starts keeps its `userId`.
3. **Permission checks go through `permission_service`**, never ad-hoc SQL on `note_permissions`. Admin and owner short-circuit to full access; otherwise grants on the note *and every ancestor across all branches* are merged, highest privilege wins, write implies read.
4. **After any grant/revoke or group-membership change, clear caches**: `permission_service.clearPermissionCache()` plus `ws.reloadFrocaForUser()` for every affected user (`grantPermission`/`revokePermission` already do this — a new mutation path such as group membership must too).
5. **Admin gating**: today each admin-only handler checks `user_service.getCurrentUser().isAdmin` itself (never `req.session`, so a route spec puts the user in CLS the way `internalRoute` does) and returns `[403, { message }]`. Follow that shape until a central gate exists (see gaps).
6. **Ownership on creation**: create notes through `notes.createNewNote()` so `ownerId` gets stamped. Raw `new BNote({...}).save()` without `ownerId` ends up admin-owned after the next restart's backfill.
7. **Core must stay platform-agnostic** (CLAUDE.md rules). Anything in `becca/` that needs a user's role queries `users` via raw SQL instead of `user_service`, which would close an options→becca import cycle.

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

See [roadmap-and-gaps.md](roadmap-and-gaps.md) for the per-phase scope and the list of **known, deliberate-or-deferred gaps** (no write enforcement, unfiltered sync and WebSocket pushes, no admin gate on dangerous routes, ...). Check it before reporting any of those as a new bug.
