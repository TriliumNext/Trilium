# Mobile Frontend
<figure class="image image-style-align-right image_resized" style="width:33.52%;"><img style="aspect-ratio:1242/2688;" src="Mobile Frontend_IMG_1765.PNG" width="1242" height="2688"></figure>

Trilium has a mobile web frontend which is optimized for touch based devices - smartphones and tablets. It is activated automatically during login process based on browser detection.

Mobile frontend is limited in features compared to the full desktop version. See below for more details on this.

## Layout basics

Unlike the desktop version, the mobile version has a slightly different UI meant to better fit the constrained screens of a mobile phone.

Here is a non-exhaustive list of differences between the desktop version and the mobile one:

*   On a phone, the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a> lies under the note. The <span class="tn-icon bx bx-chevron-left"></span> button in the top-left of the screen slides the note away to reveal the tree, and opening a note from the tree slides it back in.
    *   A swipe from the left edge of the screen also reveals the tree, but the system's or the browser's back gesture can take it over, depending on the platform.
    *   Each tab remembers whether it was showing the tree or its note, and the folder its tree was showing. Switching tabs brings both back. Opening another note in the tab moves its tree to the folder holding that note.
    *   In the Android app, the system back gesture or button closes the menu or dialog on top first, then a settings page in <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a>, then slides the note away to reveal the tree, then goes up one level in the tree. At the top of the tree, it sends the app to the background.
    *   On wider screens, such as a tablet in landscape, the note tree is displayed as a sidebar next to the note instead. There, a <span class="tn-icon bx bx-sidebar"></span> button hides and shows it, and the choice is remembered together with the left pane of the desktop version.
    *   A note with children shows a <span class="tn-icon bx bx-chevron-right"></span> (on iOS, preceded by how many children it lists): tapping it lists its children, and tapping any other note opens it.
    *   Press and hold a note to display the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree/Note%20tree%20contextual%20menu.md">Note tree contextual menu</a>.
*   The <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Navigation/Quick%20search.md">Quick search</a> bar is also displayed at the top of the note tree.
*   The full <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Navigation/Search.md">Search</a> function can be triggered either from either the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Global menu</a> or from the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a>, if configured.
*   The <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Global menu</a> is shorter: _New window_ and _Keyboard shortcuts_ are left out, and _Switch to desktop version_ is under _Advanced_.
*   The <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a> is displayed at the bottom of the screen.
    *   The launch bar uses a different configuration for icons than the desktop version. See the dedicated page for more information on how to configure it.
*   Most of the note-related actions are grouped in the horizontal dots icon on the top-right of the note.
*   In a text note, the formatting toolbar sits at the bottom of the screen. See _Editing text notes_ below.
*   On iOS, the buttons of the title row, the launch bar, the formatting toolbar, the menus that open from the bottom of the screen and short dialogs are translucent panes that float clear of the screen's edges, and the note scrolls beneath the title row and the launch bar. A dialog taller than half the screen is opaque and attached to the bottom of the screen instead. To make the panes opaque, go to <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Appearance_ → _Performance_ and turn off _Background effects for menus, popups and panels_. On Android, the option is not shown and they are always opaque.
*   While the on-screen keyboard is open, a <span class="tn-icon bx bxs-keyboard"></span> button in the bottom-right corner, just above the keyboard, hides it. In a text note, the button is at the right end of the formatting toolbar. While a menu of the formatting toolbar is open in place of the keyboard, the button becomes a <span class="tn-icon bx bx-x"></span>, which closes the menu and brings the keyboard back. This works in every note type and in every text field, and is the only way to hide the keyboard in the iOS app, where the keyboard has no _Done_ button.
*   The <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Tabs.md">Tabs</a> are grouped under a tab switcher in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a>, where the tabs are displayed in a full-screen grid with preview for easy switching, as well as additional options such as reopening closed tabs. On a phone, a tab left on the note tree shows the folder it was on, with the tab's note highlighted, instead of a preview of the note.
    *   Swipe left or right across the tab switcher button to go to the next or previous tab without opening the switcher. The page follows your finger: let go less than a third of the way across to stay on the current tab, unless you flick.
*   Since v0.100.0, <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Split%20View.md">Split View</a> can also be used in mobile view, but with a maximum of two panes at once. The splits are displayed vertically instead of horizontally.

## Editing text notes

### The formatting toolbar

In a text note, the formatting toolbar sits at the bottom of the screen as a single row that scrolls sideways. It is shown only while you are editing the text, and hides when you hide the keyboard or move to another field, such as the note title. From left to right, it holds:

*   _Undo_ and _Redo_, since the on-screen keyboard has no keys for them.
*   A highlighted button naming the element the cursor is in, such as _Table ›_ or _List ›_, when it is in one. See _Tables, images and other elements_ and _Lists_ below.
*   The <span class="tn-icon cke cke-trilium-block-type"></span> block type button, <span class="tn-icon cke cke-plus"></span> to insert content, and <span class="tn-icon cke cke-text"></span> for the formatting applied to text.
*   <span class="tn-icon cke cke-link"></span> to add a link and <span class="tn-icon cke cke-paper-clip"></span> to attach a file.
*   The indentation buttons, then <span class="tn-icon cke cke-arrow-up"></span> and <span class="tn-icon cke cke-arrow-down"></span>, which move the current block, or the selected blocks, up or down, as <kbd>Alt</kbd>+<kbd>↑</kbd> and <kbd>Alt</kbd>+<kbd>↓</kbd> do on a keyboard. Inside a table they move the row instead.
*   The <span class="tn-icon cke cke-trilium-ai"></span> AI assistant button, shown once a provider is configured, which opens its quick actions as a menu at the bottom of the screen, with _Ask AI…_ at its top.

While the keyboard is open, the <span class="tn-icon bx bxs-keyboard"></span> button at the right end of the toolbar hides it.

The hints in the corner of the editor that explain the element under the cursor, such as a to-do item's state and its shortcut, are not shown, whatever the _Content hints_ setting under _Options_ → _Text Notes_ → _Features_.

### Inserting content

The <span class="tn-icon cke cke-plus"></span> button opens insertions as tiles at the bottom of the screen:

*   Image, table and to-do list.
*   Code block, block quote and admonition.
*   The less common collapsible, tabs, columns, horizontal line, page break, footnote, math, drawing canvas, Mermaid diagram, bookmark, link and content embeds, special characters, emoji, icon, date/time, template and Markdown import.

The image is also under the paperclip, and the to-do list, code block, block quote and admonition are also in the block type button.

The tiles marked with <span class="tn-icon bx bx-chevron-right"></span> open a list of choices:

*   _Code block_: the language.
*   _Admonition_: its type.
*   _Insert table_: the size of the table.
*   _Columns_: the number of columns.
*   _Footnote_: a new footnote or a reference to an existing one.
*   _Date/time_: the format of the date and time.
*   _Insert text snippet_: the template to insert. It is grayed out while there are none.

### Block types

The <span class="tn-icon cke cke-trilium-block-type"></span> block type button opens the block types as tiles at the bottom of the screen, with the current one highlighted:

*   Paragraph and heading 2 to 6.
*   Bulleted list, numbered list and to-do list.
*   Code block, block quote and admonition.

Picking a paragraph or a heading in a list turns the item back into plain text, and the same goes for a code block. Block quote and admonition wrap the current block rather than replace it, so they are highlighted alongside it; pick one again to remove it.

Typing `-` , `1.` or `[ ]` at the start of a line also starts a list.

### Lists

While the cursor is in a list, a _List ›_ button follows _Undo_ and _Redo_. Its row holds:

*   The indentation buttons and the buttons that move the item up or down, as on the main row.
*   _List type_, which opens the to-do list and the markers of bulleted and numbered lists (such as squares or roman numerals) as tiles, the markers under the kind of each, with the current one highlighted. Picking a tile of another kind also turns the list into that kind, such as a bulleted list into a numbered one or a to-do list back into a bulleted one.
*   In a numbered list, _Start at_, which asks for the number the list starts at, and <span class="tn-icon bx bx-sort-down"></span> _Reversed order_, which is highlighted while the list counts down.
*   In a to-do list, a button for each task state, followed by <span class="tn-icon bx bx-pencil"></span> to edit the states.

Starting a list, from the block type button, the insert menu or by typing `-` , `1.` or `[ ]`, shows this row right away. It stays closed once you tap the back button, until you start another list.

### Tables, images and other elements

While the cursor is in a table, an image, a code block, a link or another element that has a toolbar of its own on desktop, a highlighted button naming that element, such as _Table ›_, follows _Undo_ and _Redo_. It replaces the formatting toolbar with the element's toolbar, which starts with a back button that closes it again, followed by the element's name ahead of its tools. The button goes away when the cursor leaves the element.

Selecting an element as a whole, such as an image, or tapping a link shows its toolbar right away; tap the back button to return to the formatting toolbar.

Buttons of the element's toolbar with a list of choices, such as the column and row actions of a table, open that list as a menu at the bottom of the screen, where an option that is on or off, such as a table's header row, is a switch.

### Formatting text

The formatting applied to text (bold, italic, underline, strikethrough, inline code, superscript and subscript, keyboard shortcut, font size and colors, and removing formatting) is on a row of its own, followed by the left, center, right and justify alignments of the current block, with the current one highlighted. The row ends with <span class="tn-icon cke cke-trilium-scissors"></span> to cut the selection into a sub-note.

*   Tap <span class="tn-icon cke cke-text"></span> after the <span class="tn-icon cke cke-plus"></span> button to show it, and <span class="tn-icon cke cke-previous-arrow"></span> at its start to return to the main row.
*   Selecting text shows this row on its own, and it goes back to the main row once the selection is gone (for example as you start typing), unless you opened or closed the row yourself in the meantime.

The font size button opens the list of sizes as a menu at the bottom of the screen, each drawn at its size, with the current one checked.

A single color button replaces the separate text and background color buttons. It opens a menu with a row of colors for the text and one for its background, each with a cell that removes the color and one that opens the device's color picker.

### Links and attachments

The <span class="tn-icon cke cke-link"></span> link button replaces the separate link and internal link buttons. It opens the _Add link_ dialog, which links to a note or to a web address, or _Edit link_ when the cursor is inside a link. The dialog does not open the keyboard by itself; tap the note or address field to type. The same button is on the row of text formatting, after the inline styles, to turn selected text into a link.

The <span class="tn-icon cke cke-paper-clip"></span> button opens _Image_, _Camera_, _Attach and embed file_ and _Attach file as a link_ as a list: the menu of the desktop toolbar, with _Camera_ added. _Camera_ opens the device's camera and inserts the photo taken; the others open the device's file picker.

## Installing as a PWA

The mobile view can be set up as a PWA. While this does not offer any offline capabilities, it will display the application in full-screen and makes it easy to access via your mobile phone's home screen.

=== "<span class="tn-icon bx bxl-apple"></span> iOS with Safari"

    1.  Open your default web browser and access your Trilium instance.
    2.  Login.
    3.  Press the \[…\] button in the bottom-right of the screen and select Share.
    4.  Scroll down to reveal the full list of items and choose _Add to Home Screen_.
    5.  Press _Add_ and the web app will be available.

=== "<span class="tn-icon bx bxl-chrome"></span> Android with Google Chrome"

    > [!IMPORTANT]
    > Google Chrome requires the server to be served over HTTPS in order to display in full-screen. If using HTTP, the app will appear like a normal web page (similar to a bookmark).

    1.  Open your default web browser and access your Trilium instance.
    2.  Login.
    3.  Press the three vertical dots icon in the top-right of the screen and select _Add to Home screen._
    4.  Select the _Install_ option.
    5.  Select an appropriate name.
    6.  The web app will appear as an application, not on the home screen.

=== "Android with Brave"

    > [!IMPORTANT]
    > Brave requires the server to be served over HTTPS in order to display in full-screen. If using HTTP, the app will appear like a normal web page (similar to a bookmark).

    1.  Open your default web browser and access your Trilium instance.
    2.  Login.
    3.  Press the three vertical dots icon in the bottom-right of the screen and select _Add to Home screen_.
    4.  Press the _Install_ option.
    5.  The web app will appear as an application, not on the home screen.

=== "Samsung Browser"

    1.  Open your default web browser and access your Trilium instance.
    2.  Login.
    3.  Press the hamburger menu in the bottom-right of the screen.
    4.  Select _Add to_, followed by _Home screen_.
    5.  Press _Add_ and the web app will appear on the home page.

## Sharing to Trilium

Once installed as a PWA on Android, Trilium appears in the system's share menu, so links, text, images and other files can be sent to it from other apps. Shared content is saved to the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notes/Note%20Inbox.md">Note Inbox</a>, and Trilium opens the note it created:

*   Text or a link becomes a text note. A shared link is also stored in the `#pageUrl` label.
*   A single file becomes an image note or a file note, placed directly in the inbox.
*   Several files, or files shared together with text, are placed under a new text note that holds the text.

Every note created this way carries the `#clipType=share` label, which gives a shared text note the <span class="tn-icon bx bx-share"></span> icon unless the note has an `#iconClass` of its own. A single share can carry at most 20 files.

> [!NOTE]
> Sharing requires being logged in. If the session has expired, log in again and share once more.

## Testing via the desktop application

If you are running Trilium without a dedicated [server installation](Server%20Installation.md), you can still test the mobile application using the desktop application. For more information, see <a class="reference-link" href="Desktop%20Installation/Using%20the%20desktop%20application%20as%20a%20server.md">Using the desktop application as a server</a>. To access it go to `http://<ip>:37840/login?mobile` .

## Forcing mobile/desktop frontend

Trilium decides automatically whether to use mobile or desktop front-end. If this is not appropriate, you can use `?mobile` or `?desktop` query param on **login** page (Note: you might need to log out).

Alternatively, simply select _Switch to mobile version_ in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Global menu</a>. In the mobile version, select _Advanced_ → _Switch to desktop version_ there instead.

## Scripting

You can alter the behavior with <a class="reference-link" href="../Scripting.md">Scripting</a>, just like for normal frontend. For script notes to be executed, they need to have labeled `#run=mobileStartup`.

Custom <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a> widgets are also supported.