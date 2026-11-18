# Markdown-like formatting
Markdown-like formatting allows inserting some basic formatting by typing the Markdown equivalent. Note that this does not mean that <a class="reference-link" href="../Text.md">Text</a> notes supports Markdown, these are just some convenience shortcuts.

To import more complex formatting into text notes, consider using the [_Import from Markdown_](Other%20features.md) function. For fully-fleged Markdown notes imports, consider using the dedicated [import](../../Basic%20Concepts%20and%20Features/Import%20%26%20Export/Markdown.md) function.

*   For [headings:](General%20formatting.md)
    *   `##` for Heading 2 (the first-level heading is reserved for the note title).
    *   `###` for Heading 3
    *   `####` for Heading 4
    *   `#####` for Heading 5
    *   `######` for Heading 6
*   For <a class="reference-link" href="General%20formatting.md">General formatting</a>:
    *   **Bold**: Type `**text**` or `__text__`
    *   _Italic_: Type `*text*` or `_text_`
    *   ~~Strikethrough~~: Type `~~text~~`
*   For <a class="reference-link" href="Lists.md">Lists</a>:
    *   Bulleted list: Start a line with `*` or `-` followed by a space;
    *   Numbered list: Start a line with `1.` or `1)` followed by a space;
    *   To-do list: Start a line with `[ ]` for an unchecked item or `[x]` for a checked item.
*   For [block quotes](Block%20quotes%20%26%20admonitions.md), press `>`, followed by a space.
*   For <a class="reference-link" href="Developer-specific%20formatting/Code%20blocks.md">Code blocks</a>, type ` ``` `.
*   For a [horizontal line](Other%20features.md), type `---`.
*   For [admonitions](Block%20quotes%20%26%20admonitions.md):
    *   `!!! note`
    *   `!!! tip`
    *   `!!! important`
    *   `!!! caution`
    *   `!!! warning`
    *   Starting any other text with `!!!` will insert a note admonition with the text inside of it.
*   For [emojis](Insert%20buttons.md), type `:` followed by an emoji name to trigger an auto-completion.

If auto-formatting is not desirable, press <kbd>Ctrl</kbd> + <kbd>Z</kbd> to revert the text to its original form.