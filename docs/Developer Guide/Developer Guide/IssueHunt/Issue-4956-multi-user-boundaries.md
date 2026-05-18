# Issue 4956 - Multi-User Boundaries

This note proposes a boundary-first rollout for issue [#4956](https://github.com/TriliumNext/Trilium/issues/4956).

## Problem Framing

Current architecture assumes a single trusted user for many scripting and UI behaviors. A direct jump to full multi-user support is high-risk without strict boundaries.

## Phase A - Identity and Session Foundations

- Define user identity model and stable user IDs.
- Isolate session state per authenticated user, with session records linked to user IDs.
- Add server-side guardrails for user-scoped resources.

## Phase B - Authorization Surface

- Define note access semantics:
  - owner
  - shared read
  - shared write
- Enforce authorization in core services first (note/resource services), then ETAPI and sync endpoints.

## Phase C - Script Safety

- Audit script execution surfaces.
- Gate or sandbox script APIs that can cross user boundaries.
- Document explicit trust assumptions for admin-only scripts.

## Phase D - UX and Migration

- Add user switch/account indicators in UI.
- Provide migration notes for existing single-user deployments.
- Keep default behavior unchanged for single-user mode.

## Acceptance Direction

- No cross-user data leak in note metadata, history, or attachments.
- Authorization checks are consistent across desktop and server APIs.
- Search results and search indexes remain fully isolated per authorized user scope.
- Backward compatibility for existing single-user setups.
