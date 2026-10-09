# Content tabs
Content tabs group several titled panels of content into one block that shows a single panel at a time. They suit content that comes in variants (such as installation steps for each operating system or the same snippet in several programming languages).

A tabs block consists of:

*   **A row of tab titles.** The title of the panel that is showing is highlighted.
*   **The panel of the active tab**, below the titles. A panel can hold any kind of content (including nested tabs blocks).

## Inserting a tabs block

*   In the formatting bar, go to _Insert_ → _Tabs_.
*   Alternatively, type `/tabs` and press <kbd>Enter</kbd>, as described in <a class="reference-link" href="Slash%20Commands.md">Slash Commands</a>.

A new block contains two tabs, named “Tab 1” and “Tab 2”. The title of the first tab is selected, so typing replaces it.

## Editing tabs

*   To show a tab, click its title or move the cursor into it.
*   To move from a title into its panel, press <kbd>Enter</kbd>.
*   The label of a tab can be formatted just like normal text, including support for <a class="reference-link" href="Insert%20buttons/Icons.md">Icons</a>.

While the cursor is inside a tabs block, a toolbar appears above it with the following buttons:

*   <span class="tn-icon cke cke-plus"></span> _(Add tab)_ inserts a tab after the current one and selects its title.
*   <span class="tn-icon cke cke-remove"></span> _(Remove tab)_ removes the current tab. Removing the last tab removes the whole block.
*   <span class="tn-icon cke cke-chevron-right bx-flip-horizontal"></span> _(Move tab left)_ and <span class="tn-icon cke cke-chevron-right"></span> (_Move tab right)_ change the order of the tabs.
*   <span class="tn-icon cke cke-link"></span> _(Copy link to tab)_ copies a link to the current tab, as described below.

The tab that is showing is not saved with the note: every tabs block opens on its first tab.

## Reading tabs

In <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Read-Only%20Notes.md">Read-Only Notes</a> and on <a class="reference-link" href="../../Advanced%20Usage/Sharing.md">Sharing</a>, tabs blocks work as tabs as well:

*   To show a tab, click its title, or focus it and press <kbd>Enter</kbd> or <kbd>Space</kbd>.
*   To move between the titles of a block, use the arrow keys, <kbd>Home</kbd> and <kbd>End</kbd>.

A tab without a title shows “Tab title” in place of one.

## Linking to a tab

A link can point to a single tab, much like a link to a block (see <a class="reference-link" href="Block%20references.md">Block references</a>):

1.  Place the cursor in the tab, either in its title or in its panel.
2.  Press _Copy link to tab_ in the toolbar of the tabs block. Alternatively, right-click the text and select _Copy_ → _Copy link to this tab_. The tab flashes briefly.
3.  Go to the note where to insert the link and press <kbd>Ctrl</kbd>+<kbd>V</kbd>.

The link shows the title of the note, followed by the title of the tab. Clicking it opens the note, shows the tab and flashes it. As with any block reference, the link can be turned into an <a class="reference-link" href="Include%20Note.md">Include Note</a> that shows only that tab.

Links to a tab can be copied only from a note being edited. On a [shared page](../../Advanced%20Usage/Sharing.md), such a link opens the whole note.

## Content in hidden tabs

Content inside a tab that is not showing is still reachable (both while editing and while reading). The tab that holds it is shown when:

*   searching the note with <kbd>Ctrl</kbd>+<kbd>F</kbd> highlights a match inside it;
*   a link points to an anchor or a block inside it (see <a class="reference-link" href="Anchors.md">Anchors</a> and <a class="reference-link" href="Block%20references.md">Block references</a>);
*   an entry of the <a class="reference-link" href="Table%20of%20contents.md">Table of contents</a> or the <a class="reference-link" href="Highlights%20list.md">Highlights list</a> points inside it;
*   on a shared page, the address of the page points to a heading or an anchor inside it.

Tab titles are not headings, so they do not appear in the table of contents; headings inside a panel do.

## Printing and exporting

*   When printing or [exporting to PDF](../../Basic%20Concepts%20and%20Features/Notes/Printing%20%26%20Exporting%20as%20PDF.md), every tab is printed, one after another, each with its title above its panel.
*   Markdown export and import write tabs blocks in the content tabs syntax of Material for MkDocs, described in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Import%20%26%20Export/Markdown/Supported%20syntax.md">Supported syntax</a>. <a class="reference-link" href="../Markdown.md">Markdown</a> notes use the same syntax, show the blocks as tabs in their preview and insert them with `/tabs`.
*   Anywhere the tabs cannot work as tabs (such as an HTML export opened elsewhere), a tabs block reads as a sequence of titled sections.