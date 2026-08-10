# Images
Trilium supports storing and displaying images. Supported formats are PNG, JPEG, GIF, BMP, WebP, AVIF and SVG.

An image can be uploaded in the form of note's [attachment](../../Basic%20Concepts%20and%20Features/Notes/Attachments.md) or as a standalone [note](../../Basic%20Concepts%20and%20Features/Navigation/Tree%20Concepts.md) placed into the [note tree](../../Basic%20Concepts%20and%20Features/Navigation/Tree%20Concepts.md). Its reference can be copied into a text note, in order to display it in the text itself.

## Uploading images

To add an image to the note:

*   Simply drag it from file explorer onto the note editor inside Trilium and the image will be uploaded.
*   Alternatively, from the <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a> look for the _Insert image_ icon.
*   You can also copy and paste an image from web (see section below).

## Clipboard & automatic download of images

Trilium has a special handling for images copied to and pasted from the clipboard.

*   For a mix of text and images, the images are downloaded automatically by the server (or desktop app, depending on what is being used).
    
    *   This means that the image must be publicly accessible and reachable from wherever Trilium is running. Inaccessible images will end up as broken images.
*   If a single image is pasted into Trilium, it will prefer the image that comes in the clipboard. This makes it possible to copy images that Trilium would not otherwise be able to reach, such as Google Chat, Slack, etc.
*   When a text with images is copied from Trilium and pasted in another app (such as Microsoft Word or LibreOffice Writer), the images will be preserved.

The automatic download of images is enabled by default and can be toggled from <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Media_ → _Download images automatically._

## Configuring the images

Clicking on an image will reveal a popup with multiple options:  
![](7_Images_image.png)

### Alignment

The first set of options configure the alignment are, in order:

| Icon | Option | Preview | Description |
| --- | --- | --- | --- |
| ![](5_Images_image.png) | Inline | ![](1_Images_image.png) | As the name suggests, the name can be put inside a paragraph and moved around similarly as if it was a block of text. Use drag & drop or cut-paste to move it around. |
| ![](8_Images_image.png) | Centered image | ![](2_Images_image.png) | The image will be displayed as a block and centered, not allowing text in either the left or right of it. |
| ![](4_Images_image.png) | Wrap text | ![](6_Images_image.png) | The image will be displayed to the left or the right of the text. |
| ![](Images_image.png) | Block align | ![](3_Images_image.png) | Similarly to _Centered image_, the image will be displayed as a block and aligned either to the left or to the right, but not allowing text to flow on either of its sides. |

## Compression

Since Trilium isn't really meant to be primary storage for image data, it attempts to compress and resize (with pretty aggressive settings) uploaded images before storing them to the database. You may then notice some quality degradation. Basic quality settings is available in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Media_.

If you want to save images in their original resolution, it is recommended to save them as attachment to note (look for the contextual menu in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20buttons.md">Note buttons</a> → _Import files_).

## Aligning images side-by-side

There are generally two ways to display images side by side:

*   If they are roughly the same size, simply make the two images in-line, according to the alignment section above. The images can be dragged & dropped onto the same line.
*   If they are on different size, create a [table](Tables.md) with invisible borders.