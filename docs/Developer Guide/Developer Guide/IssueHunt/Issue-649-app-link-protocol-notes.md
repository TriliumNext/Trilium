# Issue 649 - App Link Protocol Notes

This document captures a practical implementation note for issue [#649](https://github.com/TriliumNext/Trilium/issues/649), focused on opening/focusing notes via desktop protocol links.

## Target URL Shape

- Canonical format: `trilium://note/<noteId>`
- Optional query extensions for future use:
  - `?focus=true`
  - `?newWindow=true`

## Entry Points

- Cold start (desktop app not running):
  - Parse command-line arguments and extract protocol URL.
- Running app:
  - Handle second-instance event and route to existing window.
- macOS:
  - Handle `open-url` event.

## Parsing Rules

- Accept only expected host/path variants.
- Keep note ID decoding strict (safe percent-decoding).
- Reject unsupported protocols and malformed URLs.

## Routing Behavior

- Resolve note ID and select note in tree.
- Activate existing tab if already open.
- Fallback:
  - show non-blocking warning when note cannot be resolved.

## Security Constraints

- No arbitrary command execution.
- No shell passthrough from protocol payload.
- Length limits for parsed URL and note ID.

