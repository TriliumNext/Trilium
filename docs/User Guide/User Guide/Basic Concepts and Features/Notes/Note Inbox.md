# Note Inbox
The inbox is the default destination for quickly captured notes. When a note is created without picking a location first, it lands in the inbox. This makes it easy to quickly capture notes and sort them later.

## Where the inbox is used

*   The _New note_ button in the <a class="reference-link" href="../UI%20Elements/Launch%20Bar.md">Launch Bar</a>.
*   The global _Create note into inbox_ shortcut (default <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>P</kbd>).
*   The _New note_ action in the [tray icon menu](../../Installation%20%26%20Setup/Desktop%20Installation/Tray%20icon%20%26%20automatic%20startup.md).
*   The <a class="reference-link" href="../../Installation%20%26%20Setup/Web%20Clipper.md">Web Clipper</a> extension.

## Setting a note inbox

To create a note inbox, apply the `#inbox` [label](../../Advanced%20Usage/Attributes/Labels.md) to it.

Only one note should carry this label. If there are multiple notes, only one will be used by the application.

> [!NOTE]
> If there is no inbox note, Trilium will fall back to today's [day note](../../Advanced%20Usage/Advanced%20Showcases/Day%20Notes.md) instead.

## Workspace inboxes

Each [workspace](../Navigation/Workspaces.md) can have its own inbox, set via the `#workspaceInbox` label.

When a new note is created while hoisted in a workspace, the location is determined in the following order:

*   A note carrying the `#workspaceInbox` label in that workspace.
*   A note carrying the `#inbox` within that workspace.
*   The workspace root note itself.