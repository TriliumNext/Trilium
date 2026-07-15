# Evernote
Trilium can import ENEX files, which are used by Evernote for backup/export. One ENEX file represents the content (notes and resources) of one notebook.

## Import process

The first step is to export the data from Evernote:

*   To export a single notebook:
    *   In the left sidebar, select _Notebooks_.
    *   If you have a notebook stack, expand it.
    *   Right click on a notebook and select _Export notebook_.
    *   Make sure the following options are set:
        *   File format is set to _ENEX format_.
        *   All the options in _Export note attributes_ are checked.
*   To export a bunch of notes (up to 100 notes):
    *   In the left sidebar, select _Notes_.
    *   In the list of notes, <kbd>Ctrl</kbd>\-click individual notes to select them. Alternatively, click on a note and then <kbd>Shift</kbd>\-click a more distant note to select all the notes in between.
    *   At the bottom there should be a floating bar with some options. Select \[…\] → _Export._
    *   Make sure the following options are set:
        *   File format is set to _ENEX format_.
        *   All the options in _Export note attributes_ are checked.
*   To export a single note:
    *   Select the note.
    *   In the top-right, press the \[…\] button and select _Export_.
    *   Make sure the following options are set:
        *   File format is set to _ENEX format_.
        *   All the options in _Export note attributes_ are checked.

> [!TIP]
> To export multiple notebooks in bulk, consider using a third-party CLI tool called [evernote-backup](https://github.com/vzhd1701/evernote-backup)

Once you have your ENEX files, do the following to import them in Trilium:

1.  In the <a class="reference-link" href="../../UI%20Elements/Note%20Tree.md">Note Tree</a>, right click and select _Import into note_.
2.  In the _Import from_ section, select _Evernote_.
3.  During the import, you will see "Import in progress" message. If the import is successful, the message will change to “Import finished successfully” and then disappear.
4.  We recommend you to check the imported notes and their attachments to verify that you haven’t lost any data.

## Supported features

The following features are preserved by Trilium during the import process:

*   Basic formatting (bold, italic, underline, strikethrough, colors, highlights, superscript, subscript, text alignment, inline code).
*   The hierarchy of headings (these are shifted to start with H2 because H1 is reserved for note title, see [Headings](../../../Note%20Types/Text/General%20formatting.md))
*   To-do lists. The new task format is collapsed to standard to-do lists
*   <a class="reference-link" href="../../../Note%20Types/Text/Images.md">Images</a> and <a class="reference-link" href="../../Notes/Attachments.md">Attachments</a>
*   <a class="reference-link" href="../../../Note%20Types/Text/Lists.md">Lists</a> (with bullets or with numbers)
*   <a class="reference-link" href="../../../Note%20Types/Text/Tables.md">Tables</a>
*   Block quotes
*   [Admonitions](../../../Note%20Types/Text/Block%20quotes%20%26%20admonitions.md) are preserved, including its emoji (added as part of the content).
*   <a class="reference-link" href="../../../Note%20Types/Text/Developer-specific%20formatting/Code%20blocks.md">Code blocks</a>, with a best-effort attempt to restore the language.
*   <a class="reference-link" href="../../../Note%20Types/Mermaid%20Diagrams.md">Mermaid Diagrams</a>
*   <a class="reference-link" href="../../../Note%20Types/Text/Math%20Equations.md">Math Equations</a>
*   Toggle sections
*   External links
*   Internal links are re-written to <a class="reference-link" href="../../../Note%20Types/Text/Links/Internal%20(reference)%20links.md">Internal (reference) links</a> if the target note is part of the same import.

## Limitations

*   The size limit of one import is 250Mb. If the total size of your files is larger, you can increase the [upload limit](../../../Installation%20%26%20Setup/Server%20Installation.md), or divide your files, and run the import as many times as necessary.
*   All resources (except for images) are created as notes’ attachments.
*   If you have HTML inside ENEX files, the HTML formatting may be broken or lost after import in Trilium. See <a class="reference-link" href="../../../Troubleshooting/Reporting%20issues.md">Reporting issues</a>.

### Links to other notes

Since v0.104.0, the ENEX importer tries to recreate links to other notes automatically by converting their Evernote-specific URLs to Trilium's <a class="reference-link" href="../../../Note%20Types/Text/Links/Internal%20(reference)%20links.md">Internal (reference) links</a>.

Since the ENEX format does not provide the unique ID of notes, the note references are determined via their note title.

Limitations:

*   Only notes that are part of the same import will have their links rewritten to reference links, to avoid linking to the wrong note.
*   If there are to notes with the same name, internal links will not be created to avoid pointing to the wrong note.
*   Links that couldn't be rewritten (e.g. referring to a missing/duplicate note) will be kept with their original `evernote://` URL.
*   It will not fix links to anchors and links to notes that you renamed in Evernote after you created the links.

#### Post-processing notes

> [!TIP]
> This script allows rewriting links after the import has been done, and it should also allow finding links between two different imports.

If you want to restore the internal links in Trilium after you import all of your ENEX files, you can use or adapt this custom script: <a class="reference-link" href="Evernote/Process%20internal%20links%20by%20title.js">Process internal links by title</a>

The script does the following:

1.  It finds all Evernote internal links.
2.  For each one, it checks if its link text matches a note title, and if yes, it replaces the Evernote link with an internal Trilium link. If not, it leaves the Evernote link in place.
3.  If it finds more than one note with a matching note title, it leaves the Evernote link in place.
4.  It outputs the results in a log that you can see in the respective code note in Trilium.

The script has the following limitations:

*   It will not fix links to anchors and links to notes that you renamed in Evernote after you created the links.
*   Some note titles might not be well identified, even if they exist. This is especially the case if the note title contains some special characters. Should this be problematic, consider <a class="reference-link" href="../../../Troubleshooting/Reporting%20issues.md">Reporting issues</a>.

## Reporting issues

When importing your Evernote notebooks, you might find issues in how a note is imported; in that case consider [reporting](../../../Troubleshooting/Reporting%20issues.md) it.

When reporting such an issue make sure to provide the following information:

*   A `.enex` export of the original note. This allows us to reproduce the issue.
*   A screenshot with how it originally looked like before the import and how it looks after the import.