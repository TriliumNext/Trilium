# Markdown
Trilium has always supported Markdown through its [import feature](../Basic%20Concepts%20and%20Features/Import%20%26%20Export/Markdown.md), however the file was either transformed to a <a class="reference-link" href="Text.md">Text</a> note (converted to Trilium's internal HTML format) or saved as a <a class="reference-link" href="Code.md">Code</a> note with only syntax highlight.

This note type is a split view, meaning that both the source code and a preview of the document are displayed side-by-side. See <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20types%20with%20split%20view.md">Note types with split view</a> for more information.

## Rationale

The goal of this note type is to fill a gap: rendering Markdown but not altering its structure or its whitespace which would inevitably change otherwise through import/export.

Even if Markdown is now specially treated by having a preview mechanism, Trilium remains at its core a WYSWYG editor so Markdown will not replace text notes.

> [!NOTE]
> Feature requests regarding the Markdown implementation will be considered, but if they are outside the realm of Trilium they will not be implemented. One of the core aspects of the Markdown integration is that it reuses components that are already available through other features of the application.

## Features

### Source view pane

*   Syntax highlighting for the Markdown syntax.
*   Nested syntax highlighting for code inside code blocks.
*   When editing larger documents, the preview scrolls along with the source editor.

### Preview pane

The following features are supported by Trilium's Markdown format and will show up in the preview pane:

*   All standard and GitHub-flavored syntax (basic formatting, tables, blockquotes)
*   Code blocks with syntax highlight. Note that the language must be specified for syntax highlight to apply (e.g. ` ```js `).
*   <a class="reference-link" href="Text/Block%20quotes%20%26%20admonitions.md">Block quotes &amp; admonitions</a>
*   <a class="reference-link" href="Text/Math%20Equations.md">Math Equations</a> (both inline and block)
*   <a class="reference-link" href="Mermaid%20Diagrams.md">Mermaid Diagrams</a> using ` ```mermaid `
*   <a class="reference-link" href="Text/Include%20Note.md">Include Note</a> (no built-in Markdown syntax, but HTML syntax works just fine):
    
    ```
    <section class="include-note" data-note-id="vJDjQm0VK8Na" data-box-size="expandable">
        &nbsp;
    </section>n
    ```
*   <a class="reference-link" href="Text/Links/Internal%20(reference)%20links.md">Internal (reference) links</a> via its HTML syntax, or through a _Wikilinks_\-like format (only <a class="reference-link" href="../Advanced%20Usage/Note%20ID.md">Note ID</a>):
    
    ```
    [[Hg8TS5ZOxti6]]
    ```
*   <a class="reference-link" href="Text/Footnotes.md">Footnotes</a> are also supported via the corresponding Markdown syntax:
    
    ```
    This is [^1], while this is [^2].
    
    [^1]: the first footnote
    [^2]: the second footnote
    ```

### Other features

*   The <a class="reference-link" href="Text/Table%20of%20contents.md">Table of contents</a> will be displayed in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Right%20Sidebar.md">Right Sidebar</a> based on the Markdown-level headings.
    *   This feature is available only on the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/New%20Layout.md">New Layout</a>.

### Shared notes

When a Markdown note is [shared publicly](../Advanced%20Usage/Sharing.md), it will be rendered with extended formatting just like <a class="reference-link" href="Text.md">Text</a> notes.

Most of the features described previously should be supported. If you face any issues, feel free to [report it](../Troubleshooting/Reporting%20issues.md) alongside a sample Markdown file.

## Creating Markdown notes

There are two ways to create a Markdown note:

1.  Create a new note (e.g. in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>) and select the type _Markdown_, just like all the other note types.
2.  Create a note of type <a class="reference-link" href="Code.md">Code</a> and select as the language either _Markdown_ or _GitHub-Flavored Markdown_. This maintains compatibility with your existing notes prior to the introduction of this feature.

> [!NOTE]
> There is no distinction between the new Markdown note type and code notes of type Markdown; internally both are represented as <a class="reference-link" href="Code.md">Code</a> notes with the proper MIME type (e.g. `text/x-markdown`).

## Import/export

*   By default, when importing a single Markdown file it automatically gets converted to a <a class="reference-link" href="Text.md">Text</a> note. To avoid that and have it imported as a Markdown note instead:
    *   Right click the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a> and select _Import into note_.
    *   Select the file normally.
    *   Uncheck _Import HTML, Markdown and TXT as text notes if it's unclear from the metadata_.
*   When exporting Markdown files, the extension is preserved and the content remains the same as in the source view.
*   Once exported as a Trilium ZIP, the ZIP will preserve the Markdown type without converting to text notes thanks to the meta-information in it.

## Conversion between text notes and Markdown notes

Currently there is no built-in functionality to convert a <a class="reference-link" href="Text.md">Text</a> note into a Markdown note or vice-versa. We do have plans to address this in the future.

This can be achieved manually, for a single note:

1.  Export the file as Markdown, with single format.
2.  Import the file again, but unchecking _Import HTML, Markdown and TXT as text notes if it's unclear from the metadata_.

For multiple notes, the process is slightly more involved:

1.  Export the file as Markdown, ZIP.
2.  Extract the archive.
3.  Remove the `!!!meta.json` file.
4.  Compress the extracted files back into an archive.
5.  Import the newly create archive, but unchecking _Import HTML, Markdown and TXT as text notes if it's unclear from the metadata_.

## Sync-scrolling & block highlight

When scrolling through the editing pane, the preview pane will attempt to synchronize its position to make it easier to see the preview.

In addition, the block in the preview matching the position of the cursor in the source view will appear slightly highlighted.

The sync is currently one-way only, scrolling the preview will not synchronize the position of the editor.

This feature cannot be disabled as of now; if the scrolling feels distracting, consider temporarily switching to the editor mode and then switching to preview mode when ready.

> [!NOTE]
> This feature of synchronizing the scroll is based on blocks but it's provided on a best-effort basis since our underlying Markdown library doesn't support this feature natively, so we had to implement our own algorithm. Feel free to [report issues](../Troubleshooting/Reporting%20issues.md), but always provide a sample Markdown file to be able to reproduce it.