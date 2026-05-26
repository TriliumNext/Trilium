# Text Extraction (OCR)
Optical Character Recognition is the process in which the text from images or PDFs is extracted.

## Built-in support

Since v0.103.0, Trilium has built-in support for OCR. The extracted text can be:

*   Integrated with <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Navigation/Search.md">Search</a>, to quickly find the image or file based on snippets of text.
*   Integrated with the <a class="reference-link" href="../AI.md">AI</a> feature, which allows the agent to access the content of a non-text note.
*   Manually accessed for other purposes (e.g. copying into a note or sending it somewhere else).

## Supported formats

OCR in Trilium supports the following formats:

### Images

*   Both [individual image notes](../Note%20Types/File.md) and [attachments in text files](../Note%20Types/Text/Images.md) are supported.
*   Supported formats: JPEG, PNG, GIF, BMP, TIFF, WebP.
*   Currently only single-page TIFFs are supported. If you have multi-page TIFFs consider splitting them into individual images.
*   Note that this feature works best for computer-rendered text rather than handwriting.
*   The underlying technology is Tesseract.js.

### PDFs

Currently only text extraction is supported and not OCR.

*   This means that the PDF needs to have proper text information in it (i.e. the text can be selected in a PDF viewer), whereas scanned documents are not yet supported.
*   There are plans to integrate the same OCR-based recognition for PDFs used for images, but this is not yet implemented.

### Office documents

The text will be extracted from the following file formats:

*   Microsoft Word documents
*   Microsoft Excel documents (only the raw text information, the cell structure is not maintained).
*   Microsoft PowerPoint documents
*   The OpenDocument alternatives to the previous formats (Text, Spreadsheet, Presentation), created by editors such as LibreOffice and OpenOffice.

## Configuring and triggering OCR

The OCR can be configured by going to <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → <a class="reference-link" href="#root/_hidden/_options/_optionsMedia">Media</a> and looking for the _Text Extraction (OCR)_ section.

There are three ways to trigger the OCR:

*   By enabling _Auto-process new files_ which will process only the notes or attachments created after enabling the option, existing files will remain unprocessed.
*   By pressing _Start Batch Processing_ which will process all the existing notes.
*   By manually requesting for an image or file to have its text extracted, regardless of whether the automatic processing is enabled or not.

### Minimum confidence

When extracting text from an image, there is a certain level of confidence which indicates whether the extracted text appears relevant.

When the minimum confidence is set to a low percentage, the text extraction can interpret symbols and drawings incorrectly resulting in garbled text.

If the extracted text for a note or an attachment quality is lower than the minimum confidence, the OCR is disregarded.

## Language management

OCR needs to be aware of the language of the content in order for it to work correctly. The reason is that each language has its own data which needs to be downloaded, and accents or other symbols will not be supported by the default language.

To configure the languages that are supported by the OCR, simply go to <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → <a class="reference-link" href="#root/_hidden/_options/_optionsLocalization">Language &amp; Region</a> and adjust the _Content languages_.

When there are no content languages defined, the user interface _Language_ is used instead.

After making this change, the automatic processing or manual reprocessing will take into consideration the new languages.

To enforce the detection in a particular language for a given note, use the `language` [attribute](Attributes.md), similar to [text content language](../Note%20Types/Text/Content%20language%20%26%20Right-to-le.md). For <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notes/Attachments.md">Attachments</a>, it's not possible to manually adjust the language.

> [!NOTE]
> The trained data for each language is not packaged with Trilium, as that would require a significant amount of space that might not be otherwise needed. As such, when the trained data will be downloaded automatically via [Tesseract.js](https://github.com/naptha/tesseract.js/).
> 
> The downloaded trained data is located in the <a class="reference-link" href="../Installation%20%26%20Setup/Data%20directory.md">Data directory</a>, in the `ocr-cache` directory.

## Viewing extracted content for a single note

To access the extracted content of a note:

*   For <a class="reference-link" href="../Note%20Types/File.md">File</a> notes, go to the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20buttons.md">Note buttons</a> → _Advanced_ → _View OCR Text_.
*   For <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notes/Attachments.md">Attachments</a> (e.g. <a class="reference-link" href="../Note%20Types/Text/Images.md">Images</a> in <a class="reference-link" href="../Note%20Types/Text.md">Text</a> notes), double-click the attachment to view the details, press the \[…\] button at the left and select _View extracted text (OCR)_.

This section allows:

*   Viewing the extracted text, which can be copied elsewhere if needed or just to check the quality of the extraction.
*   If the note has not been extracted yet, pressing _Process OCR_ will process it in the background. If the extraction confidence is lower than the minimum confidence, there will be a notification.
*   Similarly, if the minimum confidence was changed in settings, it is possible to press the _Process OCR_ button again to extract the text again.