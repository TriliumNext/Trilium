# Bookmarks
Frequently used notes can be bookmarked, which will make them appear in the <a class="reference-link" href="../UI%20Elements/Launch%20Bar.md">Launch Bar</a> for easy access.

## Configuring the launch bar

If bookmarks don't appear in the launch bar, then most likely the bookmark section has been hidden. Go to the <a class="reference-link" href="../UI%20Elements/Launch%20Bar.md">Launch Bar</a> configuration from the <a class="reference-link" href="../UI%20Elements/Global%20menu.md">Global menu</a> and ensure _Bookmarks_ is in the _Visible Launchers_ section.

## Bookmark folder

Space in the left panel is limited, and you might want to bookmark many items. One possible solution is to bookmark a folder, so it shows its children:

To do this, bookmark a folder, then right click its button in the <a class="reference-link" href="../UI%20Elements/Launch%20Bar.md">Launch Bar</a> and check _Folder_. The button then opens a menu instead of the note itself: the note is at the top, followed by its children. Uncheck _Folder_ to turn it back into a regular bookmark.

A child that has children of its own shows an arrow at the end of its row. Click the arrow to list its children in a submenu, or click the rest of the row to open the note. Submenus nest up to four levels deep. A menu that lists more than 15 children shows a filter field above them: type part of a title to list only the notes that match. A note whose subtree is hidden (see <a class="reference-link" href="../UI%20Elements/Note%20Tree/Hiding%20the%20subtree.md">Hiding the subtree</a>) doesn't list its children here either.

The notes in the menu open the way links do: a middle click or <kbd>Ctrl</kbd>+click opens a note in a new tab, <kbd>Shift</kbd>+click opens it in a new window, and a right click lists the other places it can be opened in.

_Folder_ assigns the `#bookmarkFolder` label to the note, so adding the label by hand works as well. Because the label belongs to the note, a note that is both bookmarked and dropped onto the launch bar shows its children in both places.

## Mobile

On mobile, bookmarks are only displayed starting with v0.102.0. Because of the more constrained screen size, the bookmarks are grouped under a single icon instead of displaying them as separate icons.

When pressed, a menu will appear listing all the bookmarks. Bookmark folders are also supported and will appear as submenus. Each submenu starts with its own note, so a note with children can be opened as well as browsed.

On a phone, the bookmarks are also listed at the top of the <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a> while it shows the root of a tab that is not hoisted, below the <a class="reference-link" href="Workspaces.md">Workspaces</a>. Tap a bookmark to open it, or, for one with children, to list them, as with the other notes of the tree.