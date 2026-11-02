# Giving access to notes
On a server with <a class="reference-link" href="../Multiple%20users.md">Multiple users</a>, the owner of a note can give other users access to it, so that they can read it or work on it together. Access to a note also covers every note below it, including the ones added later.

This is not the same as [Sharing](../../../Advanced%20Usage/Sharing.md), which publishes notes to anyone with the link, without signing in.

## Giving access

1.  Open the _Access..._ dialog of the note in one of these ways:
    *   Right-click the note in the <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a> and select _Access..._ (see <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree/Note%20tree%20contextual%20menu.md">Note tree contextual menu</a>).
    *   Open the <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20menu.md">Note menu</a> and select _Access..._.
2.  Under _Give access_, pick a user. Type a few letters of the name to narrow the list.
3.  Choose _Can view_ or _Can edit_, and select _Add_.

Changes in the dialog apply at once. Under _People with access_, the dialog lists the owner of the note, then everyone who has access to it:

*   To change what someone can do, choose _Can view_ or _Can edit_ on their row.
*   To take the access away, select the <span class="tn-icon bx bx-x"></span> button on their row.

A note that others have access to shows a <span class="tn-icon bx bx-group"></span> icon after its title in the tree. Hovering it lists who has access.

### Who can give access

*   Only the owner of a note and administrators see _Access..._. A note belongs to the user who created it.
*   Administrators already see every note, so they aren't offered in the list, and neither is the owner.
*   _My notes_ as a whole, the _Users_ note and the notes of the system can't be shared. To share many notes at once, put them in a note of their own and give access to that note.

## Receiving access

A note someone gave you access to appears under _Shared with me_ at the top of your tree, together with the notes below it. Trilium updates the tree of everyone affected right away.

*   To keep a shared note among your own notes, [clone](../../../Basic%20Concepts%20and%20Features/Notes/Cloning%20Notes.md) it into _My notes_. It then leaves _Shared with me_. Deleting that clone removes it from _My notes_ only: the note stays with its owner.
*   A note you create inside a shared note belongs to you.
*   When your access is taken away, the shared note disappears from your tree, along with any clone of it. The notes you created inside it stay, under _Shared with me_.

_Can view_ doesn't prevent editing yet. For this and the other limitations, see _Limitations_ in <a class="reference-link" href="../Multiple%20users.md">Multiple users</a>.