# Code blocks
![](1_Code%20blocks_image.png)

The code blocks feature allows entering pieces of code in text notes.

Note that this feature is meant for generally small snippets of code. For larger files such as an entire log, see the <a class="reference-link" href="../../Code.md">Code</a> note type instead.

## Inserting a code block

*   Via the <a class="reference-link" href="../Formatting%20toolbar.md">Formatting toolbar</a>, look for the ![](Code%20blocks_image.png) button.
    *   Pressing directly on the icon will insert a code block with the language that was selected most recently. If this is the first time a code block is inserted, the language will be “Auto-detected” by default.
    *   Pressing the arrow next to the icon, which will show a popup with the available languages.
*   Type ` ``` ` (as in Markdown).
    *   Note that it's not possible to specify the language, as it will default to the last selected language.

## Exiting out of the code block

*   To exit out of a code block and enter a normal paragraph, move the cursor at the end of the code block and press <kbd>Enter</kbd> twice.
*   Similarly, to insert a paragraph above the note block, move the cursor at the beginning of the code block and press <kbd>Enter</kbd> twice.

> [!NOTE]
> If you've pasted a code block with a more complex HTML structure, exiting out of the code block by pressing <kbd>Enter</kbd> multiple times might not work. In that case the best approach is to delete the code block entirely and use <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> (paste as plain text).

## Syntax highlighting & color schemes

Since TriliumNext v0.90.12, Trilium will try to offer syntax highlighting to the code block. Note that the syntax highlighting mechanism is slightly different than the one in <a class="reference-link" href="../../Code.md">Code</a> notes as different technologies are involved.

Interaction:

*   When the language is set to _Auto-detected_ (by default), Trilium will try to identify the programming language (or similar) that corresponds to the given snippet of text and highlight it. If this is problematic, consider changing the language of the code block manually.
*   When the language is set to _Plain text_, there will be no syntax highlighting.

Note that when editing a text note, syntax highlighting is automatically disabled if the code block is too big (somewhere around 500 lines). This value is currently not configurable. For <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/Notes/Read-Only%20Notes.md">Read-Only Notes</a>, this limitation is not applied.

In order to configure this new feature, a section has been added in Options → Appearance to control the syntax highlighting. There the color scheme can be chosen, from a builtin selection of themes from Highlight.js.

*   It is possible to disable the syntax highlighting for all the notes by selecting “No syntax highlighting” in the “Color scheme” option.
*   Word wrapping is disabled by default, but can be configured from the same section.

> [!NOTE]
> **Context regarding syntax highlighting**
> 
> In order to achieve the syntax highlight, the Highlight.js library is being used. Do note that support for syntax highlighting in code blocks is not a supported feature of the text editor we are using CKEditor), but rather a hack which makes use of the highlights API (used for highlighting search results for example). Nevertheless, we haven't noticed any major issues during the development of the feature, but feel free to report any issues you might have.
> 
> Most of the work to achieve the syntax highlight itself was already done by [antoniotejada](https://github.com/antoniotejada) in [https://github.com/antoniotejada/Trilium-SyntaxHighlightWidget](https://github.com/antoniotejada/Trilium-SyntaxHighlightWidget). On our side we added customization but also additional functionality.

### Migrating from existing syntax highlight plugins

If you are already using a syntax highlighting plugin such as the [Trilium-SyntaxHighlightWidget](https://github.com/antoniotejada/Trilium-SyntaxHighlightWidget) we are basing off of, it is important to disable that plugin before upgrading in order for it not to conflict with our implementation.

Should you encounter any issues after the migration, try running Trilium in safe mode.

## Changing the language of a code block

Simply click anywhere inside the code block and press again the code block button in the <a class="reference-link" href="../Formatting%20toolbar.md">Formatting toolbar</a>:  
![](2_Code%20blocks_image.png)

## Adjusting the list of languages

The code blocks feature shares the list of languages with the <a class="reference-link" href="../../Code.md">Code</a> note type.

The supported languages can be adjusted by going to <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a>, then _Code Notes_ and looking for the _Available MIME types in the dropdown_ section. Simply check any of the items to add them to the list, or uncheck them to remove them from the list.

Note that the list of languages is not immediately refreshed, you'd have to manually [refresh the application](../../../Troubleshooting/Refreshing%20the%20application.md).