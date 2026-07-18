# Note Revisions
<figure class="image"><img style="aspect-ratio:2089/1515;" src="2_Note Revisions_image.png" width="2089" height="1515"></figure>

Trilium supports seamless versioning of notes by storing snapshots ("revisions") of notes at regular intervals.

## Displaying the revisions

*   On the <a class="reference-link" href="../UI%20Elements/New%20Layout.md">New Layout</a>, press the [note context menu](../UI%20Elements/Note%20buttons.md) and select _Note revisions…_
*   On the old layout, press directly the <img class="image_resized" style="aspect-ratio:27/25;width:2.32%;" src="1_Note Revisions_image.png" width="27" height="25"> button in the <a class="reference-link" href="../UI%20Elements/Note%20buttons.md">Note buttons</a> area.

## Interaction

> [!NOTE]
> This documentation matches the redesign of the note revisions dialog on v0.103.0, older versions have a similar dialog but with some differences.

*   The full list of revisions are displayed on the left in reverse chronological order.
    *   The revisions are grouped by the date the revision was taken.
    *   This list does not contain the _current state_ of the note, so it is possible to have notes with no revisions/snapshots saved.
*   The icon of a revision indicates the _source_ of that revision (e.g. a <img class="image_resized" style="aspect-ratio:20/21;width:2.49%;" src="Note Revisions_image.png" width="20" height="21"> icon for a manually saved revision).
*   Pressing the \[…\] on the top-right of the dialog displays multiple options, including:
    *   Saving a new revision now.
    *   Checking the interval and limit for this note (see below).
    *   Deleting all the revisions of this note.
*   For supported notes (text, code), changes are highlighted. This behavior can be toggled via the _Highlight changes_ at the top of the dialog.
    *   The highlighted changes are relative to the **current state of the note**, not to the revision prior to this one.
*   For any given revision, the buttons on the top-right allow operating on it:
    *   Deleting the revision.
    *   Downloading the revision locally.
    *   Restoring the revision, which replaces the current content of the note with the one from the revision. Another revision is saved containing the current content of the note.

## Named revisions

Named revisions are a new feature of Trilium v0.103.0 which allows adding a short description of what the changes in the snapshot contain.

In the list of note revisions:

*   The name of the revision is displayed underneath the time of the revision in the sidebar, as well as at the top of the dialog where it is displayed in full.
*   Clicking on the edit button near the name of the revision allows it to be changed.

To create a named revision, either:

*   Go to the <a class="reference-link" href="../UI%20Elements/Note%20buttons.md">Note buttons</a>, select _Save named revision…_, enter the name of revision and confirm.
*   Use the corresponding [keyboard shortcut](../Keyboard%20Shortcuts.md) or the <a class="reference-link" href="../Navigation/Jump%20to%20%26%20command%20palette.md">Jump to...</a> command with the same name.
*   Save a revision normally, and adjust the name afterwards from the note revision list.

## When revisions are saved

Revisions are saved:

*   Automatically at a fixed interval. This behavior can be configured (see below).
*   Manually, by:
    *   Going to the press the [note context menu](../UI%20Elements/Note%20buttons.md) and select _Save revision._
    *   Using the _Force Save Revision_ [keyboard shortcut](../Keyboard%20Shortcuts.md).
    *   In the _Revisions_ dialog, pressing the \[…\] button in the top-right and selecting _Save a revision now_.

Additionally, revisions can also come from somewhere else, and this is indicated via the icon of the revision:

*   Generated externally, by <a class="reference-link" href="../../Advanced%20Usage/ETAPI%20(REST%20API).md">ETAPI (REST API)</a>.
*   A modification created by <a class="reference-link" href="../../AI.md">AI</a>.
*   A revision is restored, causing the existing note content to be saved as a revision to prevent potential data loss.

#### Snapshot interval

Time interval of taking note snapshot is configurable in the Options -> Other dialog. This provides a trade-off between more revisions and more data to store.

To turn off note versioning for a particular note (or sub-tree), add `disableVersioning` [label](../../Advanced%20Usage/Attributes.md) to the note.

#### Maximum revisions

The limit on the number of note snapshots can be configured in the Options -> Other dialog. The note revision snapshot number limit refers to the maximum number of revisions that can be saved for each note. Where -1 means no limit, 0 means delete all revisions. You can set the maximum revisions for a single note through the `versioningLimit=X` label.

The note limit will not take effect immediately; it will only apply when the note is modified.

You can click the _Erase excess revision snapshots now_ button to apply the changes immediately.