# Issue 7447 - Mobile App Readiness

This note outlines a readiness checklist for issue [#7447](https://github.com/TriliumNext/Trilium/issues/7447), focused on an official mobile app path.

## Scope Clarification

- Distinguish between:
  - mobile web frontend improvements
  - packaged native mobile app strategy
- Preserve sync compatibility with existing server/desktop clients.

## Readiness Checklist

### 1. API and Sync Stability

- Freeze and document mobile-critical endpoints.
- Validate sync conflict behavior under intermittent connectivity.
- Define minimum supported sync protocol version.

### 2. Offline and Storage

- Define offline cache boundaries.
- Document attachment download policy for low-storage devices.
- Add explicit recovery path for corrupted local cache.

### 3. UX Baseline

- Note tree navigation parity targets.
- Editor behavior constraints on touch keyboards.
- Search and launch bar workflows on narrow screens.

### 4. Security and Auth

- Session/token refresh behavior for long-lived mobile sessions.
- Optional biometric gate hooks (platform-dependent).
- Safe handling of exported/shared note links.

### 5. Release Process

- Beta channel with opt-in telemetry for crash and sync health.
- Versioned migration notes for mobile users.
- Rollback plan for incompatible sync/client changes.
