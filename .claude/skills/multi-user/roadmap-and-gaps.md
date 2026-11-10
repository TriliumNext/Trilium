# Multi-user roadmap and known gaps

State as of 2026-11-04. Re-verify with `git log` before relying on it.

## Phases

| Phase | PR / ref | Scope |
|---|---|---|
| 1 — identity | #10273, merged into `milestone/multi_user` | `users`, `user_groups`, `user_group_members`, `oauth_enrollment` (split out of old `user_data`); nullable `notes.ownerId`, `entity_changes.userId`, `etapi_tokens.userId`; `seedAdminUser()`; `session.userId` on both login paths → CLS; `getUserId()`; admin-only `/api/users` (list/create/soft-delete). Migration 243 (was 239). |
| 2 — isolation | #10348, merged into `milestone/multi_user` | `ownerId` stamped on create; per-user Becca + cache and `getBecca()` (both removed again on 2026-11-04, see below); `note_permissions` + `permission_service` (ancestor inheritance across clones, write ⇒ read); admin-only `/api/permissions`; WS clients tagged with `userId`, `sendMessageToUserClients`. Migration 244 (was 240). |
| single filtered Becca | #12478, open against `milestone/multi_user` | Drops the per-user copies and `getBecca()`; `NoteView` filters the one Becca by the CLS user; `cls.initAsSystem()`/`isSystem()`; `getCurrentUser()` throws without a user; `auth.isSignedIn()` refuses a session without a user. |

Agreed deferrals from #4956: attributes inherit their note's visibility (no per-attribute ACL); search-index filtering comes later.

## Known gaps (do not rediscover as new bugs)

**Isolation is in the Becca only.** `NoteView` (see SKILL.md) filters what reads go through the Becca. Not yet covered: the `_hidden` subtree (options, launchers, LLM chats, …) is shared by all users and needs per-user variants or carve-outs; raw SQL over `notes`/`blobs` (full-text content search, recent changes, revisions, `getBlob()` by ID) bypasses the view; a scope without a user and outside a system scope still reads unfiltered, rather than failing closed; and deleting a note deletes its children and the relations targeting it, including ones the member cannot see, since there is no write enforcement yet. Performance: on a 22k-note document the single-user path measured within noise; an admin on an instance with members pays roughly 10–15% on broad searches for the scope lookups, and a member's own path is unmeasured.

**Token-authenticated entry points act for the instance.** ETAPI (`etapi_utils.ts`), MCP (`mcp_server.ts`) and `/custom/*` run in system scopes because an ETAPI token is not tied to a user, and `/api/etapi-tokens` has no admin check, so any member can create a token and reach every note through them. Fix: bind tokens to users (`etapi_tokens.userId`) and open a user scope for them; until then, make token management admin-only. Backend scripts are the same class: `#run=…` scripts run in the scheduler's system scope and `#customRequestHandler` scripts in `/custom/*`'s, whoever wrote them.

**No write enforcement.** `permission_service.canUserWriteNote()` is not called anywhere; a user with read access can modify a note through normal routes.

**No admin gate on dangerous routes.** Script exec/run, SQL console, backup download, options, password change, ETAPI token management, and similar are reachable by any authenticated user. Planned fix: a non-admin route allowlist in `route_api.ts` rather than per-handler checks.

**Not synced.** `note_permissions`, `users`, `user_groups` are plain tables, not Becca entities, so they produce no `EntityChange` and don't replicate to sync peers/desktop clients.

**Login.** Members sign in with a username and the password they chose through a one-time setup link (#12423); the primary admin keeps the instance password, and SSO still signs in only as the primary admin. No per-user SSO binding, no group API or UI.

**Sync and WebSocket pushes are unfiltered.** `ws.sendTransactionEntityChangesToAllClients()` attaches each changed entity (`fillInAdditionalProperties()`) and sends it to every client, so members receive changes to notes they cannot see, titles included; sync pull is likewise unfiltered. Filter by *who can see the entity*, not by *who authored the change* (`entity_changes.userId`): an author filter withholds edits others make to notes shared with the member, and says nothing about notes they lose access to. `entity_changes.userId` is only backfilled, not written for new changes.

**Protected notes have one data key.** There are no per-user protected-session data keys; a member who enters a protected session uses the instance's.

**Branch hygiene.** `main` was last merged in on 2026-11-01 (`e3237f2fbd`, about 10k commits). Keep merging regularly, and never rebase: the milestone branch is published and PRs target it.
