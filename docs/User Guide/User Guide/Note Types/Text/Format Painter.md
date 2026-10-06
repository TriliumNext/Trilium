# Format Painter
<figure class="image image-style-align-right"><img style="aspect-ratio:220/76;" src="Format Painter_image.png" width="220" height="76"></figure>

The Format Painter is a feature in text notes that allows users to copy the formatting of text (such as **bold**, _italic_, ~~Strikethrough~~, etc.) and apply it to other parts of the document. It helps maintain consistent formatting and accelerates the creation of rich content.

## Usage Instructions

Click the text that you want to copy the formatting from and use the paint formatting toolbar button (<span class="tn-icon cke cke-paint-roller"></span>) to copy the style. Then select the target text with your mouse to apply the formatting.

*   **To copy the formatting**: Place the cursor inside text with some formatting and click the paint formatting toolbar button. The mouse cursor changes to indicate the painter is armed.
*   **To paint with the copied formatting**: Select the target text with your mouse. The formatting is applied when you release the button, and the painter disarms — the cursor returns to normal.
*   **To cancel without painting**: Click the toolbar button again or press <kbd>Escape</kbd>.

## Limitations

1.  Painting with block-level formatting (like headings or image styles) is not supported yet. This is because, in <a class="reference-link" href="../../Advanced%20Usage/Technologies%20used/CKEditor.md">CKEditor</a>, they are considered a part of the content rather than text formatting.
2.  The painter applies to a selection, not to a word: clicking a single word does not format it. A click only primes the caret, so text you type there takes the copied formatting.
3.  The painter is one-shot; each paint requires copying the formatting again.