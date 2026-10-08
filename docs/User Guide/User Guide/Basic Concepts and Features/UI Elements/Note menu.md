# Note menu
<figure class="image image-style-align-right image_resized" style="width:25.95%;"><img style="aspect-ratio:402/988;" src="Note menu_image.png" width="402" height="988"></figure>

The note menu contains various actions and configurations for the current note. It can be found in the <a class="reference-link" href="Note%20buttons.md">Note buttons</a> area (to the right of the <a class="reference-link" href="../Notes/Title.md">Title</a>).

Every split has a note menu of its own, which acts on the note displayed in that split. Entries that don't apply to the current note are still listed but grayed out, while entries that only exist for some notes (described in _Note-specific entries_) appear only on those notes.

## Navigating the note

*   <span class="tn-icon bx bx-search"></span> _Search in note_ opens the <a class="reference-link" href="../Navigation/Search%20in%20note.md">Search in note</a> bar, to find and replace text inside the current note. On the desktop application, the same bar opens with <kbd>Ctrl</kbd>+<kbd>F</kbd>.
    *   It is available on <a class="reference-link" href="../../Note%20Types/Text.md">Text</a>, <a class="reference-link" href="../../Note%20Types/Code.md">Code</a>, <a class="reference-link" href="../../Note%20Types/Mind%20Map.md">Mind Map</a> and <a class="reference-link" href="../../Note%20Types/Spreadsheets.md">Spreadsheets</a> notes, <a class="reference-link" href="../../Collections.md">Collections</a>, PDF files, and any note displayed as <a class="reference-link" href="../../Advanced%20Usage/Note%20source.md">Note source</a>.
*   <span class="tn-icon bx bx-paperclip"></span> _Note attachments_ switches the note to the list of its <a class="reference-link" href="../Notes/Attachments.md">Attachments</a>, where they can be uploaded, opened, downloaded, renamed or deleted.
*   <span class="tn-icon bx bxs-network-chart"></span> _Note map_ opens the <a class="reference-link" href="Right%20Sidebar/Connections%20tab.md">Connections tab</a> of the <a class="reference-link" href="Right%20Sidebar.md">Right Sidebar</a>, which shows the <a class="reference-link" href="../../Advanced%20Usage/Note%20Map%20(Link%20map%2C%20Tree%20map).md">Note Map (Link map, Tree map)</a> centered on the current note.

## Note properties

The toggles in this section take effect immediately:

*   <span class="tn-icon bx bx-share-alt"></span> _Shared_ publishes the note via <a class="reference-link" href="../../Advanced%20Usage/Sharing.md">Sharing</a>, by cloning it into the _Shared Notes_ tree.
    *   Turning it off removes the clone from that tree. If the note exists only as a shared note, Trilium asks for confirmation, since unsharing it deletes it.
    *   The toggle is unavailable on the root note, on the _Shared Notes_ note itself, and on system notes.
*   <span class="tn-icon bx bx-lock-alt"></span> _Protect the note_ encrypts the note, turning it into one of the <a class="reference-link" href="../Notes/Protected%20Notes.md">Protected Notes</a>. If no protected session is active, Trilium asks for the password first. Only the current note is affected, not its children.
*   <span class="tn-icon bx bx-bookmark"></span> _Bookmark_ adds the note to the <a class="reference-link" href="../Navigation/Bookmarks.md">Bookmarks</a> that are displayed in the <a class="reference-link" href="Launch%20Bar.md">Launch Bar</a>, or removes it from them.
*   <span class="tn-icon bx bx-copy-alt"></span> _Template_ marks the note as one of the <a class="reference-link" href="../../Advanced%20Usage/Templates.md">Templates</a> (by adding the `#template` label), which makes it available when creating a new note.
*   <span class="tn-icon bx bx-expand-horizontal"></span> _Full width_ lets the note use the whole width of the window instead of the limit set in <a class="reference-link" href="Content%20width.md">Content width</a> by adding the `#fullContentWidth` label. It is not listed for note types that are always displayed at full width.

The two submenus in this section:

*   <span class="tn-icon bx bx-file"></span> _Note type_ changes the type of the note to any of the <a class="reference-link" href="../../Note%20Types.md">Note Types</a>; the current one is checked. If the note already has content, Trilium asks for confirmation first, since the content generally doesn't carry over. <a class="reference-link" href="../../Note%20Types/Converting%20between%20note%20types.md">Converting between note types</a>.
    *   For a <a class="reference-link" href="../../Note%20Types/Code.md">Code</a> note, the language is chosen in the <a class="reference-link" href="Status%20bar.md">Status bar</a> instead.
*   <span class="tn-icon bx bx-edit-alt"></span> _Editable_ controls when the note opens as read-only (see <a class="reference-link" href="../Notes/Read-Only%20Notes.md">Read-Only Notes</a>):
    *   _Auto_ (the default): the note is editable, unless it is long enough to be opened as read-only automatically.
    *   _Read-only_: the note always opens as read-only, but can still be edited after pressing _Edit note_.
    *   _Always Editable_: the note is always editable, regardless of its length.

## Importing, exporting and printing

*   <span class="tn-icon bx bx-import"></span> _Import files_ opens the import dialog, which imports files as children of the current note. See <a class="reference-link" href="../Import%20%26%20Export.md">Import &amp; Export</a>. It is unavailable on <a class="reference-link" href="../../Note%20Types/Saved%20Search.md">Saved Search</a> notes.
*   <span class="tn-icon bx bx-export"></span> _Export note_ opens the export dialog with _Only this note_ selected; select _This note & all descendants_ there to export the whole subtree.
*   <span class="tn-icon bx bx-printer"></span>_Print note…_ prints the note. On the desktop application this entry reads _Print/export to PDF…_ and can also save the note as a PDF file. See <a class="reference-link" href="../Notes/Printing%20%26%20Exporting%20as%20PDF.md">Printing &amp; Exporting as PDF</a>, including which note types and collections can be printed.

Some note types add their own export formats right below _Export note_:

*   <span class="tn-icon bx bxs-file-image"></span>_Export as image_, on <a class="reference-link" href="../../Note%20Types/Mermaid%20Diagrams.md">Mermaid Diagrams</a> and <a class="reference-link" href="../../Note%20Types/Mind%20Map.md">Mind Map</a> notes, downloads the diagram as _PNG (raster)_ or _SVG (vector)_.
*   <span class="tn-icon bx bxs-spreadsheet"></span>_Export to Excel (.xlsx)_ and _Export to CSV (.csv)_, on <a class="reference-link" href="../../Note%20Types/Spreadsheets.md">Spreadsheets</a>, download the spreadsheet in those formats.

## Revisions

These entries manage the <a class="reference-link" href="../Notes/Note%20Revisions.md">Note Revisions</a> of the note:

*   <span class="tn-icon bx bx-history"></span>_Note revisions…_ opens the revisions dialog, where previous versions can be previewed, compared with the current one, downloaded or restored.
*   <span class="tn-icon bx bx-save"></span>_Save revision_ saves a revision of the note right away, instead of waiting for the next automatic snapshot.
*   <span class="tn-icon bx bx-purchase-tag"></span>_Save named revision…_ also saves a revision right away, but first asks for a short description of the changes, which is shown in the revisions dialog.

## Note-specific entries

The following entries only appear on some notes:

*   <span class="tn-icon bx bx-pencil"></span>_Edit note_ appears at the top of the menu when the note is currently read-only. It enables editing until the note is closed.
*   <span class="tn-icon bx bx-align-justify"></span>_Word wrap_ appears at the top of the menu on <a class="reference-link" href="../../Note%20Types/Code.md">Code</a> notes, and sets whether long lines wrap in this note:
    *   _Auto_ (the default) follows <a class="reference-link" href="Options.md">Options</a> → _Code Notes_ → _Wrap lines in code notes_.
    *   _On_ and _Off_ override it for this note only, by setting the `#wrapLines` label.
*   <span class="tn-icon bx bx-paperclip"></span>_Convert into attachment_ appears on an image note that has no children and a single parent. After a confirmation, it turns the image into an attachment of its parent note and opens it there. See <a class="reference-link" href="../Notes/Attachments.md">Attachments</a>.
*   <span class="tn-icon bx bx-extension"></span>_Re-render note_ appears on a <a class="reference-link" href="../../Note%20Types/Render%20Note.md">Render Note</a>, and runs its script again to refresh the output.
*   <span class="tn-icon bx bx-cog"></span>_Board properties_ appears on a <a class="reference-link" href="../../Collections/Kanban%20Board.md">Kanban Board</a>, and configures its columns, card attributes and card templates.

## Advanced

The <span class="tn-icon bx bx-wrench"></span>_Advanced_ submenu groups the actions that are needed less often:

*   <span class="tn-icon bx bx-file-find"></span>_Open note externally_ (desktop application only) saves the note to a temporary file and opens it in the application that the operating system associates with it. Trilium watches the file, and offers to upload the modified version back into the note. It is unavailable on <a class="reference-link" href="../../Collections.md">Collections</a> and <a class="reference-link" href="../../Note%20Types/Saved%20Search.md">Saved Search</a> notes.
*   <span class="tn-icon bx bx-customize"></span>_Open note custom_ (desktop application only, Windows and Linux) works like _Open note externally_, but lets you pick the application to open the file with.
*   <span class="tn-icon bx bx-code"></span>_Note source_ shows the <a class="reference-link" href="../../Advanced%20Usage/Note%20source.md">Note source</a>, the content of the note exactly as it is stored.
*   <span class="tn-icon bx bxl-markdown"></span>_Convert to Markdown Note_ (on text notes) and _Convert to Text Note_ (on Markdown notes) switch the note between rich text and Markdown. After a confirmation, Trilium saves a revision and converts the content; the revision allows going back if some formatting was lost. See <a class="reference-link" href="../../Note%20Types/Converting%20between%20note%20types.md">Converting between note types</a>.
*   <span class="tn-icon bx bx-collapse-alt"></span>_Compress images_ opens a dialog that reduces the size of the images in the note. It lists the images found and how much space they take, and offers to:
    
    *   Resize the images larger than a chosen size.
    *   Keep, or compress, JPEG images.
    *   Keep, optimize, or convert to JPEG the PNG images.
    *   _Process child notes as well_, to include the images of the notes beneath this one.
    
    Compressing cannot be undone. Images can also be compressed automatically on upload, see <a class="reference-link" href="../../Note%20Types/Text/Images.md">Images</a>.
*   <span class="tn-icon bx bx-text"></span>_View OCR text_ (on image and file notes) shows the text extracted from the note via <a class="reference-link" href="../../Advanced%20Usage/Text%20Extraction%20(OCR).md">Text Extraction (OCR)</a>. If the note has not been processed yet, the dialog offers to _Process OCR_.
*   <span class="tn-icon bx bx-world"></span>_Open note on server_ (desktop application only, listed when <a class="reference-link" href="../../Installation%20%26%20Setup/Synchronization.md">Synchronization</a> is configured) opens the same note on the sync server, in the web browser.

## Deleting the note

<span class="tn-icon bx bx-trash"></span>_Delete note_ opens the deletion dialog for the current note and its subtree. The dialog lists the notes that will be deleted and the relations that will be broken, and offers to:

*   Also delete the other clones of the note, if it is cloned elsewhere. Otherwise, only the current placement is removed and the note stays in its other locations. See <a class="reference-link" href="../Notes/Cloning%20Notes.md">Cloning Notes</a>.
*   _Erase permanently_ instead of the usual soft deletion. This cannot be undone and reloads the application.

Notes deleted without erasing can be brought back, see <a class="reference-link" href="../Notes/Restoring%20Deleted%20Notes.md">Restoring Deleted Notes</a>.

## Limitations

*   The note menu is not available on launchers.
*   On the notes of <a class="reference-link" href="Options.md">Options</a> and of the in-app help, most entries are grayed out, since these notes cannot be imported into, exported, deleted or have revisions.
*   The [Note properties](#note-properties) section is only listed when the note itself is displayed, not its <a class="reference-link" href="../Notes/Attachments.md">Attachments</a> or its <a class="reference-link" href="../../Advanced%20Usage/Note%20source.md">Note source</a>.
*   In <a class="reference-link" href="../Navigation/Quick%20edit.md">Quick edit</a>, _Search in note_, _Note map_, _Full width_ and _Convert into attachment_ are not listed.

## Mobile support

On the <a class="reference-link" href="../../Installation%20%26%20Setup/Mobile%20Frontend.md">Mobile Frontend</a>, the note menu opens as a sheet from the bottom of the screen. Besides the entries above, it contains the items that the desktop layout places elsewhere:

*   _Backlinks_ and _Note paths_, at the top, which open the <a class="reference-link" href="../../Note%20Types/Text/Links/Backlinks.md">Backlinks</a> and the other locations of the note.
*   The custom buttons of the note type (such as <span class="tn-icon bx bx-download"></span>_Download_ on a <a class="reference-link" href="../../Note%20Types/File.md">File</a>).
*   _Insert child note_, which creates a note under the current one.
*   _Create new split_ and _Close this pane_, to manage the <a class="reference-link" href="Split%20View.md">Split View</a>.
*   _Note attributes_, which opens the attributes of the note.
*   On <a class="reference-link" href="../../Note%20Types/Text.md">Text</a> notes, the content language (see <a class="reference-link" href="../../Note%20Types/Text/Content%20language%20%26%20Right-to-left%20support.md">Content language &amp; Right-to-left support</a>); on <a class="reference-link" href="../../Note%20Types/Code.md">Code</a> notes, the language of the code.
*   _Note info_ and <a class="reference-link" href="../Navigation/Similar%20Notes.md">Similar Notes</a>.
*   _Note map_ opens the map in a popup instead of the right sidebar.