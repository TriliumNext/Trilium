# Multi-user roadmap and known gaps

State as of 2026-11-01. Re-verify with `git log` before relying on it.

## Phases

| Phase | PR / ref | Scope |
|---|---|---|
| 1 — identity | #10273, merged into `milestone/multi_user` | `users`, `user_groups`, `user_group_members`, `oauth_enrollment` (split out of old `user_data`); nullable `notes.ownerId`, `entity_changes.userId`, `etapi_tokens.userId`; `seedAdminUser()`; `session.userId` on both login paths → CLS; `getUserId()`; admin-only `/api/users` (list/create/soft-delete). Migration 243 (was 239). |
| 2 — isolation | #10348, merged into `milestone/multi_user` | `ownerId` stamped on create; per-user Becca + cache and `getBecca()` (both removed again on 2026-11-04, see below); `note_permissions` + `permission_service` (ancestor inheritance across clones, write ⇒ read); admin-only `/api/permissions`; WS clients tagged with `userId`, `sendMessageToUserClients`. Migration 244 (was 240). |
| 3 — sync/ETAPI/protected | `sashank/phase3` (one commit, not a PR yet) | Stamps `entity_changes.userId`; filters sync pull and WS frontend updates by it; ETAPI tokens bound to a user (`etapi_tokens.userId`, `BEtapiToken`); per-user protected-session data keys. |

Agreed deferrals from #4956: attributes inherit their note's visibility (no per-attribute ACL); search-index filtering is phase 3+.

## Known gaps (do not rediscover as new bugs)

**No isolation.** The per-user Becca copies were removed on 2026-11-04, so the single Becca serves every note to every user until the visibility filter (SKILL.md, "Mental model") lands. Homes and grants are still stored, and `permission_service` still resolves them, but nothing reads them to hide notes; Shared with me is gone with the per-user load and comes back as an overlay on `root`. Once the filter exists, these remain to decide: the `_hidden` subtree (options, launchers, LLM chats, …) is shared by all users and needs per-user variants or carve-outs, and raw SQL over `notes`/`blobs` (full-text content search, recent changes, revisions) needs the visibility set too.

**No write enforcement.** `permission_service.canUserWriteNote()` is not called anywhere; a user with read access can modify a note through normal routes.

**No admin gate on dangerous routes.** Script exec/run, SQL console, backup download, options, password change, ETAPI token management, and similar are reachable by any authenticated user. Planned fix: a non-admin route allowlist in `route_api.ts` rather than per-handler checks.

**Not synced.** `note_permissions`, `users`, `user_groups` are plain tables, not Becca entities, so they produce no `EntityChange` and don't replicate to sync peers/desktop clients.

**Login.** Members sign in with a username and the password they chose through a one-time setup link (#12423); the primary admin keeps the instance password, and SSO still signs in only as the primary admin. No per-user SSO binding, no group API or UI.

**`entity_changes.userId` is only backfilled**, not written for new changes, until phase 3.

**Phase 3 caveats (from review of the fork commit).** It filters sync/WS by *who authored the change* rather than *who can see the entity*, so a user won't receive edits others make to notes shared with them, and will receive nothing about notes they lose access to. Its protected-session expiry only checks the `"__admin__"` key.

**Branch hygiene.** `main` was last merged in on 2026-11-01 (`e3237f2fbd`, about 10k commits). Keep merging regularly (never rebase, since phase 3 is stacked on the branch), and coordinate with the contributor before pushing to the milestone branch or their PRs. Phase 3 still targets migrations 239/240, so it has to be renumbered too.
