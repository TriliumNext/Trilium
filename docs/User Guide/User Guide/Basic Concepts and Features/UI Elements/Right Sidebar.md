# Right Sidebar
<figure class="image"><img style="aspect-ratio:1990/1168;" src="Right Sidebar_image.png" width="1990" height="1168"></figure>

The right sidebar displays specific content for the current note. The sidebar is grouped into multiple tabs:

*   <a class="reference-link" href="Right%20Sidebar/Outline%20tab.md">Outline tab</a>, which displays the table of contents, highlights and other navigation-related sections depending on the note type.
*   <a class="reference-link" href="Right%20Sidebar/Attributes%20tab.md">Attributes tab</a>, which provides a visual editor for the current note's <a class="reference-link" href="../../Advanced%20Usage/Attributes.md">Attributes</a>.
*   <a class="reference-link" href="Right%20Sidebar/AI%20chat%20tab.md">AI chat tab</a>, which uses the <a class="reference-link" href="../../AI.md">AI</a> integration to chat, with optional access to the current note.
*   <a class="reference-link" href="Right%20Sidebar/Connections%20tab.md">Connections tab</a>, which groups together the note map, note paths, backlinks and similar notes.

Each window keeps its own selected tab, so switching tabs in one window does not affect the others. A newly opened window starts on the tab that was selected last.

## Toggling the right sidebar

There are two ways to toggle the right sidebar:

*   Via the <span class="tn-icon bx bx-sidebar bx-flip-horizontal"></span> icon near the title bar, which toggles whether the sidebar is docked.
*   Via the _Toggle right pane_ [keyboard shortcut](../Keyboard%20Shortcuts.md), which is not assigned by default.

## Peeking the sidebar

There is a small strip near the right edge of the app which shows an arrow icon.

*   When the sidebar is hidden, pressing the edge will _peek_ the sidebar.
    *   In this mode the sidebar is shown temporarily above the content, without shifting the content of your notes.
    *   Clicking outside the sidebar while in peek mode will simply hide the sidebar. Same goes for the X button and clicking on the right edge.
    *   Pressing the pin icon will dock the sidebar.
*   When the sidebar is docked, pressing the edge will hide the sidebar (similar to the toggle icon at the top).

The _Peek Right Pane_ [keyboard shortcut](../Keyboard%20Shortcuts.md), <kbd>Alt</kbd>+<kbd>]</kbd> by default, does the same as pressing the strip.

## Mobile support

On mobile, the right sidebar is replaced by the note panel, which opens as a sheet at the bottom of the screen from the <span class="tn-icon bx bx-dock-bottom"></span> button beside the <a class="reference-link" href="Note%20menu.md">Note menu</a>.

*   The tabs are switched from a bar at the bottom of the sheet. As on desktop, a tab with nothing to show for the current note is left out, and the _Widgets_ tab lists the [right pane widgets](../../Scripting/Frontend%20Basics/Custom%20Widgets/Right%20pane%20widget.md) of scripts.
*   The sections of a tab are displayed one after the other as cards, each with its name above it, instead of collapsible sections.
*   The header of the sheet shows the name of the tab, except in the _Attributes_ and _AI chat_ tabs, where it holds their buttons instead (see <a class="reference-link" href="Right%20Sidebar/Attributes%20tab.md">Attributes tab</a> and <a class="reference-link" href="Right%20Sidebar/AI%20chat%20tab.md">AI chat tab</a>).
*   Tapping a heading of the table of contents, or a page or an annotation of a PDF, closes the panel and scrolls the note to it.