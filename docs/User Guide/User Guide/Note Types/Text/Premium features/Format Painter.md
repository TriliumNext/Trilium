# Format Painter
<figure class="image image-style-align-right"><img style="aspect-ratio:220/76;" src="Format Painter_image.png" width="220" height="76"></figure>

> [!NOTE]
> This is a premium feature of the editor we are using (CKEditor) and we benefit from it thanks to an written agreement with the team. See  <a class="reference-link" href="../Premium%20features.md">Premium features</a> for more information.

The Format Painter is a feature in text notes that allows users to copy the formatting of text (such as **bold**, _italic_, ~~Strikethrough~~, etc.) and apply it to other parts of the document. It helps maintain consistent formatting and accelerates the creation of rich content.

## Usage Instructions

Click the text that you want to copy the formatting from and use the paint formatting toolbar button (<img class="image_resized" style="aspect-ratio:150/150;width:2.7%;" src="Format Painter_746436a2e1.svg" alt="Format painter" width="150" height="150">) to copy the style. Then select the target text with your mouse to apply the formatting.

*   **To copy the formatting**: Place the cursor inside a text with some formatting and click the paint formatting toolbar button. Notice that the mouse cursor changes to the <img class="image_resized" style="aspect-ratio:30/20;width:3.64%;" src="Format Painter_e144e96df9.svg" alt="Format painter text cursor" width="30" height="20">.
*   **To paint with the copied formatting**: Click any word in the document and the new formatting will be applied. Alternatively, instead of clicking a single word, you can select a text fragment (like an entire paragraph). Notice that the cursor will go back to the default one after the formatting is applied.
*   **To keep painting using the same formatting**: Open the toolbar dropdown and enable the continuous painting mode. Once copied, the same formatting can be applied multiple times in different places until the paint formatting button is clicked (the cursor will then revert to the regular one).

## Limitations

1.  Painting with block-level formatting (like headings or image styles) is not supported yet. This is because, in <a class="reference-link" href="../../../Advanced%20Usage/Technologies%20used/CKEditor.md">CKEditor</a>, they are considered a part of the content rather than text formatting.
2.  When applying formatting to words, spaces or other Western punctuation are used as word boundaries, which prevents proper handling of languages that do not use space-based word segmentation.