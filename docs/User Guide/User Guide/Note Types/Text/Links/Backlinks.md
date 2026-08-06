# Backlinks
A link points from one note to another; a _backlink_ is that same connection seen from the other end: the list of notes that refer to the current one.

Backlinks are maintained automatically and are read-only from this side. A backlink disappears when the note that created it removes the link; it cannot be deleted from the note being pointed at.

## What counts as a backlink

Any r<a class="reference-link" href="Internal%20(reference)%20links.md">Internal (reference) links</a> pointing at the current note, which covers two rather different cases:

*   Relations that Trilium maintains on your behalf.
    *   The most common is `internalLink`, created whenever a note refers to another one through <a class="reference-link" href="Internal%20(reference)%20links.md">Internal (reference) links</a> in its text.
    *   Embedded images (`imageLink`), relation map connections (`relationMapLink`) and note inclusions (`includeNoteLink`) work the same way.
*   Relations you define yourself.
    *   If another note carries `~author` pointing at the current note, that note is listed here as well.

Relations coming from a <a class="reference-link" href="../../Saved%20Search.md">Saved Search</a> are excluded, since a search stores an `ancestor` relation that would otherwise list every one of its results as a backlink.

> [!NOTE]
> Only some note types have their content scanned for links: <a class="reference-link" href="../../Text.md">Text</a>, <a class="reference-link" href="../../Markdown.md">Markdown</a>, <a class="reference-link" href="../../Relation%20Map.md">Relation Map</a> and <a class="reference-link" href="../../../AI.md">AI</a> chats. A link written inside a <a class="reference-link" href="../../Code.md">Code</a> note is not registered and will not appear as a backlink on the target note. A relation set manually on a code note does still count.

## How entries are displayed

Each entry names the note the reference comes from, followed by one of:

*   **An excerpt** of the surrounding content, with the link itself highlighted. This is available for <a class="reference-link" href="../../Text.md">Text</a> notes and for <a class="reference-link" href="../../../AI.md">AI</a> chat notes. Roughly 200 characters of context are quoted around the link, trimmed with an ellipsis where the surrounding text is longer, and images are left out.
*   **The name of the relation**, for every other note type where the source cannot be quoted. This is the case for <a class="reference-link" href="../../Relation%20Map.md">Relation Map</a> notes and for any note carrying a relation you defined yourself.

A note is listed once per reference it makes, so a note that links to the current one three times occupies three rows.

Of note:

*   For AI chat notes, only the assistant's own prose is quoted. A chat that reached the note purely through tool calls has nothing to quote and is listed by relation name instead.
*   Excerpts are only generated for roughly the first 50 sources. On a heavily referenced note, the remaining entries fall back to showing the relation name.

## Where backlinks are shown

*   In the <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Right%20Sidebar/Connections%20tab.md">Connections tab</a> of the <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Right%20Sidebar.md">Right Sidebar</a>, as a dedicated section.
*   As a badge in the <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/New%20Layout/Status%20bar.md">Status bar</a> showing the number of backlinks. The badge only appears when the note is being read normally (not in a revision or attachment view) and when there is at least one backlink; pressing it opens the section above.
*   Incoming links are also drawn on the link map, see <a class="reference-link" href="../../../Advanced%20Usage/Note%20Map%20(Link%20map%2C%20Tree%20map).md">Note Map (Link map, Tree map)</a>.
*   On the old layout, backlinks are showed as a dedicated button in the <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Floating%20buttons.md">Floating buttons</a> area.