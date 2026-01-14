# Evernote
Trilium can import ENEX files, which are used by Evernote for backup/export. One ENEX file represents the content (notes and resources) of one notebook.

## Export ENEX from Evernote

To export ENEX files from Evernote, you can use:

*   Evernote desktop application. See Evernote documentation. Note that the limitation of this method is that you can only export 100 notes at a time or one notebook at a time.
*   A third-party evernote-backup CLI tool. This tool can export all of your notebooks in bulk.

## Import ENEX in Trilium

Once you have your ENEX files, do the following to import them in Trilium:

1.  In the Trilium note tree, right-click the note under which you want to import one or more of your ENEX files. The notes in the files will be imported as child notes of the selected note.
2.  Click Import into note.
3.  Choose your ENEX file or files and click Import.
4.  During the import, you will see "Import in progress" message. If the import is successful, the message will change to “Import finished successfully” and then disappear.
5.  We recommend you to check the imported notes and their attachments to verify that you haven’t lost any data.

A non-exhaustive list of what the importer preserves:

*   Attachments
*   The hierarchy of headings (these are shifted to start with H2 because H1 is reserved for note title, see Headings)
*   Tables
*   Bulleted lists
*   Numbered lists
*   Bold
*   Italics
*   Strikethrough
*   Highlights
*   Font colors
*   Soft line breaks
*   External links

However, we do not guarantee that all of your formatting will be imported 100% correctly.

## Limitations

*   The size limit of one import is 250Mb. If the total size of your files is larger, you can increase the upload limit, or divide your files, and run the import as many times as necessary.
*   All resources (except for images) are created as notes’ attachments.
*   If you have HTML inside ENEX files, the HTML formatting may be broken or lost after import in Trilium. You can report major problems at Trilium issue tracker.

### Internal links

The importer cannot transform Evernote internal links into Trilium internal links because Evernote internal note IDs are not preserved in ENEX files.

If you want to restore the internal links in Trilium after you import all of your ENEX files, you can use or adapt this custom script: <a class="reference-link" href="Evernote/Process%20internal%20links%20by%20titl.js">Process internal links by title</a>

The script does the following:

1.  It finds all Evernote internal links.
2.  For each one, it checks if its link text matches a note title, and if yes, it replaces the Evernote link with an internal Trilium link. If not, it leaves the Evernote link in place.
3.  If it finds more than one note with a matching note title, it leaves the Evernote link in place.
4.  It outputs the results in a log that you can see in the respective code note in Trilium.

The script has the following limitations:

*   It will not fix links to anchors and links to notes that you renamed in Evernote after you created the links.
*   Some note titles might not be well identified, even if they exist. This is especially the case if the note title contains some special characters. Should this be problematic, consider <a class="reference-link" href="../../Troubleshooting/Reporting%20issues.md">Reporting issues</a>.