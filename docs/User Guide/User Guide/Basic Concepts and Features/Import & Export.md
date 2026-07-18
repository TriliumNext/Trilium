# Import & Export
Trilium natively supports the following formats for both import and export.

## Supported formats

*   HTML:
    *   This is the main format used by Trilium, where standard tags are used to represent basic formatting and layout (e.g. `<strong>`, `<table>`, `<pre>`).
    *   Note that HTML is not a standardized format so some more specific features such as admonitions or <a class="reference-link" href="../Note%20Types/Text/Links/Internal%20(reference)%20links.md">Internal (reference) links</a> might not be supported by other applications.
    *   The notes can also be exported as [static HTML that can be used for web publishing](../Advanced%20Usage/Sharing/Exporting%20static%20HTML%20for%20web%20publishing.md).
*   <a class="reference-link" href="Import%20%26%20Export/Markdown.md">Markdown</a>
    *   Most of the formatting is preserved, see <a class="reference-link" href="Import%20%26%20Export/Markdown/Supported%20syntax.md">Supported syntax</a>.
*   OPML (Outliner Interchange Format)
    *   Supports both OPML v1.0 for plain text and v2.0 with HTML support.

To import from other applications such as OneNote, Notion and others, see <a class="reference-link" href="Import%20%26%20Export/Importing%20data%20from%20other%20applications.md">Importing data from other applications</a>.

## Maximum import size

Versions prior to v0.104.0 had an upload limit of 250 MiB that could be bypassed via a `TRILIUM_NO_UPLOAD_LIMIT` environment variable; with v0.104.0 this limit was removed.

Nevertheless, there is still a limit for the maximum size of a **single item** (whether it's a <a class="reference-link" href="../Note%20Types/File.md">File</a>, an <a class="reference-link" href="Notes/Attachments.md">Attachments</a> or even a <a class="reference-link" href="../Note%20Types/Text.md">Text</a> note). The limit is approximately 374 MiB and it's determined by the <a class="reference-link" href="../Installation%20%26%20Setup/Synchronization.md">Synchronization</a> protocol. Attempts to import such large files will be refused.

During large imports or exports, memory consumption might spike but it will remain somewhere around the 2 gigabyte mark. Tested with a 2.4 GB database with ~21k notes.

> [!IMPORTANT]
> For the <a class="reference-link" href="../Installation%20%26%20Setup/Desktop%20Installation.md">Desktop Installation</a>, there are two distinct import mechanisms:
> 
> *   A quick import, from the <a class="reference-link" href="UI%20Elements/Note%20Tree.md">Note Tree</a>.
> *   The import dialog (via right click in the note tree → _Import into note_ or from <a class="reference-link" href="UI%20Elements/Note%20buttons.md">Note buttons</a>).
> 
> When dealing with large files (multi-gigabyte), prefer using the import dialog as it has a special mechanism which makes sure that the file is read directly from disk rather than uploaded again.

## Exporting the root note

The root note is the top-most note. Exporting it behaves just like any other note: right click on it in the <a class="reference-link" href="UI%20Elements/Note%20Tree.md">Note Tree</a> and select _Export_.

Starting with v0.104.0, when a root note is imported, it will be imported as a child of your existing root note. This behavior makes sure that the import cannot change or overwrite your existing notes.

You can easily move the notes onto the root using the tree's <a class="reference-link" href="UI%20Elements/Note%20Tree/Multiple%20selection.md">Multiple selection</a> and delete the redundant root note.

<table>
    <thead>
        <tr>
            <th scope="col">Before</th>
            <th scope="col">After</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><ul><li>root<ul><li>one</li><li>two</li></ul></li></ul></td>
            <td><ul><li>root (existing)<ul><li>root (from import)<ul><li>one</li><li>two</li></ul></li></ul></li></ul></td>
        </tr>
    </tbody>
</table>

> [!TIP]
> Instead of exporting full ZIPs (including the root note), consider using [backups](../Installation%20%26%20Setup/Backup.md) instead. Backups always contain the entire structure, as well as additional information a ZIP export does not have: maintains note IDs, contains the options/tokens and handle <a class="reference-link" href="Notes/Protected%20Notes.md">Protected Notes</a> better.