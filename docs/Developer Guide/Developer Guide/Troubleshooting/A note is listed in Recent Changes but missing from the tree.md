# A note is listed in Recent Changes but missing from the tree
## Symptom

A note that was definitely created does not appear in the tree. Recent Changes lists it, but shows it as **Deleted**, and hovering or trying to restore it fails with:

```
NotFoundError: Deleted note 'X' was not found.
```

The row is live in the database. Restarting the application makes the note appear normally.

This looks like Becca or Froca corruption. It usually is not.

## Cause: two processes on one data directory

Entity-change propagation is **in-process only**. A note created by process A goes into A's Becca and into the shared SQLite file — but process B's Becca never hears about it, because the notification never leaves A.

The two views then disagree, in a way that produces exactly the symptom above:

*   **Recent Changes reads the database directly.** `routes/api/recent_changes.ts` queries `notes` by raw SQL, so it sees the new row.
*   **The tree and `tree/load` read Becca**, which in process B has no such note. The client renders any entry it cannot resolve through Froca as a deleted-note link.
*   **Hovering that link calls `/api/deleted-notes/:noteId/metadata`**, which selects `... WHERE noteId = ? AND isDeleted = 1` and throws `NotFoundError` when it finds nothing — and it finds nothing precisely because the note is _alive_.

Restarting the second instance reloads Becca from disk, which is why the note then appears.

## Confirming it

Check for more than one Trilium process bound to the same data directory. On Windows:

```powershell
Get-NetTCPConnection -LocalPort 37840,37841 -State Listen | Select-Object LocalPort, OwningProcess
```

then match the owning PIDs against the running executables. An installed build and a locally built desktop app both default to `%APPDATA%\trilium-data`, so the two share `document.db` without either warning about it. They also share the daily log file, and log lines carry no PID — so one process's output is indistinguishable from the other's, which is worth knowing before reading the log for clues.

The same applies to any automation pointed at a running instance: a REST or MCP client talks to whichever process owns that port, and its writes land in that process's Becca — not in the window being watched.

## Avoiding it

Give each instance its own data directory (`TRILIUM_DATA_DIR`) whenever two are running at once. The development server already does this by default (`apps/server/data`); the installed application and a locally built desktop app do not.