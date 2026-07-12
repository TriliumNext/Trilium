# Google Keep
Trilium can import notes from Google Keep, preserving their structure and formatting.

## Import process

Google Keep has no native export process, but Google Takeout allows you to download a ZIP of all the notes.

The first step is to download your Google Keep information:

1.  Navigate to [takeout.google.com](https://takeout.google.com/).
2.  In the _Create a new export_ section, press _Deselect all._
3.  In the list of data to export, check _Keep_.
4.  Scroll all the way down and choose _Next step_.
5.  In _Choose file type, frequency & destination_ make sure the following options are set:
    1.  _Transfer to_ is set to _Send download link via email_.
    2.  _Frequency_ is set to _Export once_.
    3.  _File type_ is set to _.zip_.
    4.  _File size_ can remain set to _2 GB_.
6.  Press _Create export_ and wait for the export to finish.

Then in Trilium Notes:

1.  In the <a class="reference-link" href="../../UI%20Elements/Note%20Tree.md">Note Tree</a>, right click and select _Import into note_.
2.  In the _Import from_ section, select _Google Keep_.
3.  Upload the ZIP obtained in the previous step.

## Supported features

*   Basic formatting (bold, italic, underline)
*   [Note color](../../Notes/Note%20Icons%20%26%20Colors.md)
*   Note titles are maintained, if present.
    *   In Google Keep it's common for notes not to have a title, case in which the date and time of the note are used as a title.
*   To-do lists
*   <a class="reference-link" href="../../../Note%20Types/Text/Images.md">Images</a> and <a class="reference-link" href="../../Notes/Attachments.md">Attachments</a>.
*   Creation and modification dates are preserved.

## Limitations

Currently the following information is not imported:

*   Labels are disregarded.
*   Pinned, archived or trashed state is not preserved, all notes are treated the same.

## Reporting issues

When importing your notes from Google Keep, you might encounter some issues with how the notes are imported, or there might be some missing information. In this case, consider [reporting it](../../../Troubleshooting/Reporting%20issues.md).

When reporting such an issue make sure to provide the following information:

*   A sample of the note is required to better understand what happened.
    *   Because Google Keep has no per-note export, extract the Google Takeout ZIP and copy the files corresponding to the problematic note (`.html`, `.json` and any attachments if you are able to identify them).
*   A screenshot with how it originally looked like before the import and how it looks after the import.