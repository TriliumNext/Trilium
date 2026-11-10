# Collaborative editing of notes (OT on CKEditor 5 and CodeMirror 6)

Status: implemented for text, code and Mermaid notes on a server with users, with cursors and presence. The other note types and the items under [Open work](#open-work) are not built.

**Goal:** several users edit one note at the same time on a multi-user server. The server only orders and relays edits; it never interprets the document, and saving keeps using the existing blob path.

**Why OT and not a CRDT (Yjs):** CKEditor 5 is built on OT and ships the transform functions in its open-source engine, including the hard ones for split, merge and move. A Yjs binding would need a model ↔ Y.XmlFragment mapping, a second persisted state next to the blob, and reconciliation with every write that bypasses the editor (ETAPI, scripts, import, sync). OT's one drawback, the need for a central server, does not apply: multi-user mode has one.

## Where it lives

| Part | File |
|---|---|
| Message types (`CollabClientMessage`, `CollabServerMessage`, `CollabSnapshot`) | `packages/commons/src/lib/collaboration.ts` |
| Session registry, pure logic | `packages/commons/src/lib/collaboration_sessions.ts`, a subpath module outside the barrel |
| Wiring to the messaging provider and the access check | `packages/trilium-core/src/services/collaboration.ts`, called from `ws.init()` |
| User of a connection, disconnect notification | `getClientUserId()` / `onClientDisconnected()` on `MessagingProvider`, implemented by `WebSocketMessagingProvider` only |
| Editor side: queues, transformation, snapshots, hashes, sending the selection | `Collaboration` plugin, `packages/ckeditor5/src/plugins/collaboration.ts` |
| Cursors of the other editors | `PeerCursors`, `packages/ckeditor5/src/plugins/collaboration_cursors.ts`, styled by `theme/collaboration.css` |
| Avatars of the other users in the title row | `CollaboratorsBadge` in `NoteBadges.tsx`, fed through the `collaborators` context data |
| Code editor side | `CodeCollaboration` and the `peerCursors` field, `packages/codemirror/src/collaboration.ts` and `collaboration_cursors.ts` |
| Client glue: joining, message dispatch, who saves | `apps/client/src/services/collaboration.ts`, used by `EditableText.tsx` and `Code.tsx` through the `CollabEditor` interface |

The editor specs (`collaboration.spec.ts` in `packages/ckeditor5` and in `packages/codemirror`) run real editors against the real `CollaborationSessions` over an in-memory network with random delivery, including the Trilium editor build. The registry lives in commons so those specs can load it; it stays out of the barrel, which the client imports.

## Protocol

One session per note, in memory. A session has an editor kind, `text` (CKEditor) or `code` (CodeMirror), which the join names and `EDITOR_KINDS` in core checks against the type of the note: operations, snapshots and selections are opaque to the server and only an editor of the same kind understands them. `version` counts the accepted batches since the session or its last reset started; `epoch` changes on every reset so older messages are dropped.

- **Editing.** An editor sends `collab-ops { baseVersion, ops }` with one batch in flight at a time. The server accepts it only when `baseVersion` is the current version, then broadcasts it to every member; the sender takes its own batch back as the acknowledgement. Otherwise it answers `collab-rejected`, and the editor, which has by then received and transformed over the batches it missed, sends again. The server never transforms.
- **Receiving.** The editor transforms the batch over its in-flight and pending operations with `transformOperationSets()` (`useRelations: false`, `forceWeakRemove: false`), keeps the transformed local operations, and applies the remote ones in a non-local, non-undoable batch. Undo of local edits keeps working through CKEditor's own history transformation.
- **Joining.** The first editor keeps the content it loaded. A later one waits: the server asks the writers for a `collab-snapshot`, which an editor sends once it is settled (nothing in flight or pending), so its model is exactly the model of a version. The joiner gets that snapshot plus the batches accepted after it. The snapshot is the model as JSON, not HTML: the list plugin gives items random IDs on load, so two editors loading the same HTML do not hold the same model.
- **The graveyard travels with the snapshot.** Undo and some transformations move nodes back out of the graveyard by offset. Every editor's graveyard also holds what it deleted outside the session (the editor is reused across notes), so the plugin keeps that at the end (`junkSize`) and snapshots only the part before it. Never send the whole graveyard: it contains other notes.
- **Divergence.** CKEditor's transformations do not always converge (see below). A settled editor sends `collab-hash` of its content 500 ms after the last batch; the server compares the hashes of one version. On a mismatch, or when an editor reports `collab-error` because a batch did not apply, the server asks the saver for an authoritative snapshot and sends `collab-reset`: a new epoch at version 0, the saver's model for everyone, undo stacks cleared. Unacknowledged edits of the other editors are lost.
- **Saving.** The saver is the writer that has been in the session the longest (`collab-saver`). It saves through the normal spaced update; the others skip their saves (`isSavedByAnotherEditor()`) and ignore the saved content that comes back (`isCollaboratingOn()`). An editor that becomes the saver schedules a save.
- **Access.** `collab-join` is refused unless `permission_service.canUserAccessNote()` passes and the note is an unprotected text note. Operations and snapshots are accepted only from members with `canUserWriteNote()`; the others follow along with a read-only editor. A snapshot from a reader is never used, since it becomes the content of everyone else.
- **Presence.** After every join and leave the server sends each member `collab-peers`: the other members with their user and avatar hue. A user with the note open twice is two peers; the badge shows them once.
- **Cursors.** A selection is paths, which only mean the same in the same model. So an editor sends `collab-selection` when it is settled, with its version, and the server relays it only while that version is current; otherwise it answers `collab-selection-rejected` and the editor sends again. The receiver holds that version plus its own unacknowledged operations, and transforms the ranges over them (`getTransformedByOperation()`). The cursor is two markers without operations, `collab-caret:<peerId>` and `collab-selection:<peerId>`, because `markerToElement` and `markerToHighlight` cannot both convert one marker. They follow later edits as live ranges, are dropped on a reset, and never reach the saved note.
- **Access changes.** A member keeps the `canWrite` it joined with, so `ws.reloadFrocaForUser()`, which every grant and revoke calls, also runs `recheckUser()`: an editor whose user lost access gets `collab-denied` and is removed, and one whose right to write changed gets `collab-rejoin` and joins again, dropping what it had not sent. A note that becomes protected, changes type or is deleted is not rechecked.
- **Log.** The session keeps the batches accepted after its snapshot, for the editors that join. After `LOG_LIMIT` batches it asks the writers for a snapshot and drops the batches before it.
- **Reconnecting.** The server drops a member when its connection closes. The client rejoins on every WebSocket open and takes the snapshot of the others, losing what it had not sent.

## Code notes

`CodeCollaboration` speaks the same protocol with `@codemirror/collab` doing the rebasing: `sendableUpdates()` is the batch, and every accepted batch, the editor's own included, goes through `receiveUpdates()`. The snapshot is the text, a selection is offsets, and `collab()` is taken out of its compartment and put back to start a session over. The session version counts batches while `collab()` counts updates, so the adapter keeps its own version.

Flat text converges: 40 random runs of three editors with insertions, deletions, undo and redo end equal without a single reset. A change set also carries the length of the document it applies to, so most divergence fails on the next batch and asks for a reset by itself; the hash only catches a divergence of the same length.

The component is shared: `EditableCode` joins a session for `noteType` `code` and `mermaid`, and `EDITOR_KINDS` maps both note types to the `code` kind. A code note includes Markdown notes (`Markdown.tsx`, a code note with a Markdown MIME type shown in a `SplitEditor`) and the SQL console.

A write that bypasses the session reaches a code editor through its saver: the saver's own saves are not echoed back to it, so content that arrives there was written by something else, and it types it in for everyone (`onContentChange` in `Code.tsx`). The sample diagrams of an empty Mermaid note depend on this, since `NoteContentSwitcher` saves them straight to the note. The text editor does not do this yet.

Every editor of a Mermaid note still saves the SVG attachment of the diagram it renders (`SvgSplitEditor.tsx`), so the same picture is posted once per editor.

## What the spike measured

Three stock editors, 30 random edits per run, 300 runs per cell; the columns are the chance that a simulation step is an edit and not a delivery, so higher means more unacknowledged edits at once.

| Edits | 0.05 | 0.1 | 0.2 | 0.3 |
|---|---|---|---|---|
| typing, Enter, deletion | 300 | 299 | 299 | 290 |
| + undo | 298 | 297 | 290 | 274 |
| + bold, italic, headings | 299 | 297 | 281 | 259 |
| lists | 300 | 300 | 297 | 292 |
| tables | 300 | 300 | 296 | 290 |
| everything | 299 | 294 | 285 | 243 |
| everything + undo | 299 | 294 | 269 | 253 |

- Single rounds of concurrency converge; failures need chains of unacknowledged edits. Most are exceptions on apply, some are silent, which is why the hash check exists.
- One traced cause is in CKEditor's transformations themselves: a merge followed by a split on one side against a split of the same paragraph on the other ends with different element names.
- Post-fixers that run on a remote batch produce operations no other editor receives. Sending them made the editors answer each other without end.
- `useRelations` changes nothing. `forceWeakRemove: true`, which the undo feature passes, is clearly worse.

## Open work

- **Trilium's plugins under load.** Only a smoke test covers the full editor build. Run the random spec on it and look at plugins with post-fixers (`registerPostFixer` under `packages/ckeditor5/src/plugins`) and at marker operations for local-only markers leaking into the stream.
- **Writes outside the session** (ETAPI, a script, an import, sync, a note edited inside another note) do not reach the editors of a text note; the saver's next save overwrites them. Code editors take them in through the saver (see above), unless the saver has unsaved changes at that moment.
- **Attachments edited by a member that is not the saver** are not saved, since its whole save is skipped.
- **Desktop and standalone** have no sessions: their providers do not know the user of a connection, and a join is refused.
- **Other note types**, each through its own adapter on the same session channel:

| Type | Approach |
|---|---|
| Canvas (Excalidraw) | Per element, newest `version` wins (unverified: whether 0.18 exports `reconcileElements`) |
| Relation map | Newest wins per box position; relations are already attributes |
| Mind map (mind-elixir) | Per node, newest wins, from its `operation` events; moves need a cycle check |
| Spreadsheet (Univer) | Row and column insertion shifts cells, so OT or a lock for structural edits (unverified: Univer's OT transforms are believed to be in its paid server) |
