# Printing & Exporting as PDF
<figure class="image"><img style="aspect-ratio:951/432;" src="Printing &amp; Exporting as PD.png" width="951" height="432"><figcaption>Screenshot of the note contextual menu indicating the “Export as PDF” option.</figcaption></figure>

## Printing

This feature allows printing of notes. It works on both the desktop client, but also on the web.

Note that not all note types are printable as of now. We do plan to increase the coverage of supported note types in the future.

To print a note, select the <img src="1_Printing &amp; Exporting as PD.png" width="29" height="31"> button to the right of the note and select _Print note_. Depending on the size and type of the note, this can take up to a few seconds. Afterwards you will be redirected to the system/browser printing dialog.

> [!NOTE]
> Printing and exporting as PDF are not perfect. Due to technical limitations, and sometimes even browser glitches the text might appear cut off in some circumstances. 

## Reporting issues with the rendering

Should you encounter any visual issues in the resulting PDF file (e.g. a table does not fit properly, there is cut off text, etc.) feel free to [report the issue](../../Troubleshooting/Reporting%20issues.md). In this case, it's best to offer a sample note (click on the <img src="1_Printing &amp; Exporting as PD.png" width="29" height="31"> button, select Export note → This note and all of its descendants → HTML in ZIP archive). Make sure not to accidentally leak any personal information.

Consider adjusting font sizes and using [page breaks](../../Note%20Types/Text/Insert%20buttons.md) to work around the layout.

## Exporting as PDF

On the desktop application of Trilium it is possible to export a note as PDF. On the server or PWA (mobile), the option is not available due to technical constraints and it will be hidden.

To print a note, select the ![](1_Printing%20&%20Exporting%20as%20PD.png) button to the right of the note and select _Export as PDF_. Afterwards you will be prompted to select where to save the PDF file.

> [!TIP]
> Although direct export as PDF is not available in the browser version of the application, it's still possible to generate a PDF by selecting the _Print_ option instead and selecting “Save to PDF” as the printer (depending on the browser). Generally, Mozilla Firefox has better printing capabilities.

### Automatic opening of the file

When the PDF is exported, it is automatically opened with the system default application for easy preview.

Note that if you are using Linux with the GNOME desktop environment, sometimes the default application might seem incorrect (such as opening in GIMP). This is because it uses Gnome's “Recommended applications” list.

To solve this, you can change the recommended application for PDFs via this command line. First, list the available applications via `gio mime application/pdf` and then set the desired one. For example to use GNOME's Evince:

```
gio mime application/pdf
```

### Customizing exporting as PDF

When exporting to PDF, there are no customizable settings such as page orientation, size. However, there are a few <a class="reference-link" href="../../Advanced%20Usage/Attributes.md">Attributes</a> to adjust some of the settings:

*   To print in landscape mode instead of portrait (useful for big diagrams or slides), add `#printLandscape`.
*   By default, the resulting PDF will be in Letter format. It is possible to adjust it to another page size via the `#printPageSize` attribute, with one of the following values: `A0`, `A1`, `A2`, `A3`, `A4`, `A5`, `A6`, `Legal`, `Letter`, `Tabloid`, `Ledger`.

> [!NOTE]
> These options have no effect when used with the printing feature, since the user-defined settings are used instead.

## Printing multiple notes

Since v0.100.0, it is possible to print more than one note at the time by using <a class="reference-link" href="../../Collections.md">Collections</a>:

1.  First create a collection.
2.  Configure it to use <a class="reference-link" href="../../Collections/List%20View.md">List View</a>.
3.  Print the collection note normally.

The resulting collection will contain all the children of the collection, while maintaining the hierarchy.

> [!NOTE]
> Not all note types are supported when printing or exporting to PDF. When an unsupported note is encountered, it is skipped. At the end, if any of the notes were skipped, a message will be displayed with the possibility of viewing the full list of skipped notes. The same limitations as the ones described in _Constraints & limitations_ apply.

## Keyboard shortcut

It's possible to trigger both printing and export as PDF from the keyboard by going to _Keyboard shortcuts_ in <a class="reference-link" href="../UI%20Elements/Options.md">Options</a> and assigning a key combination for:

*   _Print Active Note_
*   _Export Active Note as PDF_

## Constraints & limitations

Not all <a class="reference-link" href="../../Note%20Types.md">Note Types</a> are supported when printing, in which case the _Print_ and _Export as PDF_ options will be disabled.

*   For <a class="reference-link" href="../../Note%20Types/Code.md">Code</a> notes:
    *   Line numbers are not printed.
    *   Syntax highlighting is enabled, however a default theme (Visual Studio) is enforced.
*   For <a class="reference-link" href="../../Collections.md">Collections</a>, the following are supported:
    *   <a class="reference-link" href="../../Collections/List%20View.md">List View</a>, allowing to print multiple notes at once while preserving hierarchy (similar to a book).
    *   <a class="reference-link" href="../../Collections/Presentation.md">Presentation</a>, where each slide/sub-note is displayed.
        *   Most note types are supported, especially the ones that have an image representation such as <a class="reference-link" href="../../Note%20Types/Canvas.md">Canvas</a> and <a class="reference-link" href="../../Note%20Types/Mind%20Map.md">Mind Map</a>.
    *   <a class="reference-link" href="../../Collections/Table.md">Table</a>, where the table is rendered in a print-friendly way.
        *   Tables that are too complex (especially if they have multiple columns) might not fit properly, however tables with a large number of rows are supported thanks to pagination.
        *   Consider printing in landscape mode, or using `#printLandscape` if exporting to PDF.
    *   The rest of the collections are not supported, but we plan to add support for all the collection types at some point.
*   Using <a class="reference-link" href="../../Theme%20development/Custom%20app-wide%20CSS.md">Custom app-wide CSS</a> for printing is no longer supported, instead a custom `printCss` relation needs to be used (see below).

## Customizing the print CSS

As an advanced use case, it's possible to customize the CSS used for printing such as adjusting the fonts, sizes or margins. Note that <a class="reference-link" href="../../Theme%20development/Custom%20app-wide%20CSS.md">Custom app-wide CSS</a> will not work for printing.

To do so:

*   Create a CSS [code note](../../Note%20Types/Code.md).
*   On the note being printed, apply the `~printCss` relation to point to the newly created CSS code note.
*   To apply the CSS to multiple notes, consider using [inheritable attributes](../../Advanced%20Usage/Attributes/Attribute%20Inheritance.md) or <a class="reference-link" href="../../Advanced%20Usage/Templates.md">Templates</a>.

For example, to change the font of the document from the one defined by the theme or the user to a serif one:

```
body {
	--main-font-family: serif !important;
    --detail-font-family: var(--main-font-family) !important;
}
```

To remark:

*   Multiple CSS notes can be add by using multiple `~printCss` relations.
*   If the note pointing to the `printCss` doesn't have the right note type or mime type, it will be ignored.
*   If migrating from a previous version where <a class="reference-link" href="../../Theme%20development/Custom%20app-wide%20CSS.md">Custom app-wide CSS</a>, there's no need for `@media print {`  since the style-sheet is used only for printing.

## Under the hood

Both printing and exporting as PDF use the same mechanism: a note is rendered individually in a separate webpage that is then sent to the browser or the Electron application either for printing or exporting as PDF.

The webpage that renders a single note can actually be accessed in a web browser. For example `http://localhost:8080/#root/WWRGzqHUfRln/RRZsE9Al8AIZ?ntxId=0o4fzk` becomes `http://localhost:8080/?print#root/WWRGzqHUfRln/RRZsE9Al8AIZ`.

Accessing the print note in a web browser allows for easy debugging to understand why a particular note doesn't render well. The mechanism for rendering is similar to the one used in <a class="reference-link" href="Note%20List.md">Note List</a>.