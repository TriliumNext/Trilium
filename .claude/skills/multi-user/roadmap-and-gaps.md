# Multi-user roadmap and known gaps

State as of 2026-11-01. Re-verify with `git log` before relying on it.

## Phases

| Phase | PR / ref | Scope |
|---|---|---|
| 1 — identity | #10273, merged into `milestone/multi_user` | `users`, `user_groups`, `user_group_members`, `oauth_enrollment` (split out of old `user_data`); nullable `notes.ownerId`, `entity_changes.userId`, `etapi_tokens.userId`; `seedAdminUser()`; `session.userId` on both login paths → CLS; `getUserId()`; admin-only `/api/users` (list/create/soft-delete). Migration 243 (was 239). |
| 2 — isolation | #10348, merged into `milestone/multi_user` | `ownerId` stamped on create; per-user Becca + cache; `getBecca()` replacing the default import across core; `note_permissions` + `permission_service` (ancestor inheritance across clones, write ⇒ read); admin-only `/api/permissions`; WS clients tagged with `userId`, `sendMessageToUserClients`. Migration 244 (was 240). |
| 3 — sync/ETAPI/protected | `sashank/phase3` (one commit, not a PR yet) | Stamps `entity_changes.userId`; filters sync pull and WS frontend updates by it; ETAPI tokens bound to a user (`etapi_tokens.userId`, `BEtapiToken`); per-user protected-session data keys. |

Agreed deferrals from #4956: attributes inherit their note's visibility (no per-attribute ACL); search-index filtering is phase 3+.

## Known gaps (do not rediscover as new bugs)

**Isolation is not effective yet.**
- `loadBeccaForUser()` seeds `visible_roots` with `noteId = 'root'` and every `_`-prefixed note, then recurses down branches — so the CTE reaches the entire tree and every non-admin sees every note. The `_hidden` subtree (options, launchers, LLM chats, …) is shared by design but needs per-user variants or explicit carve-outs.
- `export default adminBecca` in `becca.ts` lets unconverted call sites read unfiltered data: ETAPI (`apps/server/src/etapi/*`), LLM tools and chat title (`packages/trilium-core/src/services/llm/`), share (`packages/trilium-core/src/share/`, `services/export/zip/share_*`), board/spreadsheet/database_info/OCR routes, image services, `routes/custom.ts`, OneNote import, `space_usage.ts`. Fix: drop the default export and convert what the compiler flags. Run `grep -rlE "import becca from" apps/server/src packages/trilium-core/src` for the current list.
- Search, note map, similar notes, recent changes etc. run over whatever `getBecca()` returns, so they're only as filtered as the Becca is.

**No write enforcement.** `permission_service.canUserWriteNote()` is not called anywhere; a user with read access (or any note in their Becca) can modify it through normal routes.

**No admin gate on dangerous routes.** Script exec/run, SQL console, backup download, options, password change, ETAPI token management, and similar are reachable by any authenticated user. Planned fix: a non-admin route allowlist in `route_api.ts` rather than per-handler checks.

**Cross-Becca coherence.**
- The `ENTITY_CHANGED` / `ENTITY_CHANGE_SYNCED` / `ENTITY_DELETED` subscribers in `becca_loader.ts` update only the admin Becca (`becca` default import). An entity created in a user's request registers into that user's Becca (via `getBecca()` in the constructor) and the DB, but not into the admin Becca; other users' cached Beccas stay stale until evicted (30 min idle, or a grant/revoke touching them).
- Open decision: keep per-user Becca copies (memory × users, coherence fan-out) or move to a single Becca with a per-user visibility filter. Raise this rather than silently picking one.

**Not synced.** `note_permissions`, `users`, `user_groups` are plain tables, not Becca entities, so they produce no `EntityChange` and don't replicate to sync peers/desktop clients.

**Login is still single-identity.** Both password and SSO login map to `adminUserId`; `users.passwordHash` is unused; no per-user password/SSO binding, no user/group management UI, no group API.

**`entity_changes.userId` is only backfilled**, not written for new changes, until phase 3.

**Phase 3 caveats (from review of the fork commit).** It filters sync/WS by *who authored the change* rather than *who can see the entity*, so a user won't receive edits others make to notes shared with them, and will receive nothing about notes they lose access to. Its protected-session expiry only checks the `"__admin__"` key.

**Branch hygiene.** `main` was last merged in on 2026-11-01 (`e3237f2fbd`, about 10k commits). Keep merging regularly (never rebase, since phase 3 is stacked on the branch), and coordinate with the contributor before pushing to the milestone branch or their PRs. Phase 3 still targets migrations 239/240, so it has to be renumbered too.
