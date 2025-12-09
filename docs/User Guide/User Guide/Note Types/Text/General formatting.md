# General formatting
## Headings

<figure class="image image-style-align-right"><img style="aspect-ratio:255/284;" src="3_General formatting_image.png" width="255" height="284"></figure>

Trilium provides headings to define sections within text. Headings are numbered from 2 to 6.

The reason why Heading 1 is missing from the list is that it is being reserved for the title of note.

To turn a heading back into a normal text, select _Paragraph_ from the list.

Apart from using the UI, it is also possible to quickly insert headings using the Markdown-like shortcuts:

*   `##` for Heading 2
*   `###` for Heading 3
*   `####` for Heading 4
*   `#####` for Heading 5
*   `######` for Heading 6

## Font size

<figure class="image image-style-align-right"><img style="aspect-ratio:363/249;" src="General formatting_image.png" width="363" height="249"></figure>

One way to highlight a portion of text is to increase the size of the font.

To do so, select some text and choose an option from the _Font size_ selector (as pictured to the right).

Unlike other text editors such as Microsoft Word, the font size is relative (i.e. “Tiny”, “Small” instead of a number like 12).

Avoid using this feature just to simply make all text bigger. In that case it's generally better to adjust the font size for all notes in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> or by zooming.

## Bold, italic, underline, strike-through

<figure class="image image-style-align-right"><img style="aspect-ratio:215/71;" src="4_General formatting_image.png" width="215" height="71"></figure>

Text can be formatted as **Bold,** _Italic,_ Underline or ~~Strike-through~~ via the dedicated buttons in the formatting toolbar.

This formatting can be easily removed using the _Remove formatting_ item.

The following keyboard shortcuts can be used here:

*   <kbd>Ctrl</kbd>+<kbd>B</kbd> for bold
*   <kbd>Ctrl</kbd>+<kbd>I</kbd> for italic
*   <kbd>Ctrl</kbd>+<kbd>U</kbd> for underline

Alternatively, Markdown-like formatting can be used:

*   **Bold**: Type `**text**` or `__text__`
*   _Italic_: Type `*text*` or `_text_`
*   ~~Strikethrough~~: Type `~~text~~`

## Superscript, subscript

This allows writing superscript or subscript text.

This is mostly useful for units of measure (e.g. cm3 for cubic centimeters) and chemical notations (e.g. NaHCO3)

For mathematical formulas, prefer the <a class="reference-link" href="Math%20Equations.md">Math Equations</a> feature instead.

## Font color and background color

<figure class="image image-style-align-right"><img style="aspect-ratio:167/204;" src="2_General formatting_image.png" width="167" height="204"></figure>

Selected text can be colored with one of the predefined colors from a palette or any color can be selected using the color picker.

Once there is at least one color defined in the document, it will appear in the list for easy reuse.

When selecting a foreground or a background color, consider the contrast if switching between a dark theme or a light [theme](../../Basic%20Concepts%20and%20Features/Themes.md).

To remove either the background or foreground color of a text, select the corresponding formatting button and press _Remove color_ or use the _Remove formatting_ toolbar item.

## Remove formatting

The <img src="1_General formatting_image.png" width="17" height="16"> _Remove formatting_ button is a quick way to eliminate the general formatting styling of a particular text.

Simply select the text and press the button to remove the formatting (bold, italic, colors, sizes, etc.). If the text does not have any removable formatting, the button will appear disabled.

Note that heading styles are not taken into consideration, these must be manually changed back to a paragraph according to the _Headings_ section.

When pasting content that comes with undesired formatting, an alternative to pasting and then removing formatting is pasting as plain text via <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>.

## Format painter

The <a class="reference-link" href="Premium%20features/Format%20Painter.md">Format Painter</a> allows users to copy the formatting of text (such as bold, italic, Strikethrough, etc.) and apply it to other parts of the document. It helps maintain consistent formatting and accelerates the creation of rich content.

## Support for Markdown

When exported to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Import%20%26%20Export/Markdown.md">Markdown</a>, most of the general formatting is maintained such as headings, bold, italic, underline, etc.