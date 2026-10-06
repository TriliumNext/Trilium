# Note contextual menu
<figure class="image image-style-align-right image_resized" style="width:44.65%;"><img style="aspect-ratio:514/291;" src="Note contextual menu_image.png" width="514" height="291"></figure>

Right-clicking the content of some note types such as <a class="reference-link" href="../../Note%20Types/Text.md">Text</a> or <a class="reference-link" href="../../Note%20Types/Code.md">Code</a> reveals a contextual menu.

## Features

*   On the <a class="reference-link" href="../../Installation%20%26%20Setup/Desktop%20Installation.md">Desktop Installation</a>, the <a class="reference-link" href="../../Note%20Types/Text/Spell%20Check.md">Spell Check</a> suggestions are shown when right clicking on a misspelled word.
*   The selected text can be searched either with a search engine (configured from <a class="reference-link" href="Options.md">Options</a>) or [inside Trilium](../Navigation/Search.md).
*   Basic clipboard functionality (cut, copy, paste).
*   Copying the selected text as <a class="reference-link" href="../Import%20%26%20Export/Markdown.md">Markdown</a>.
*   Performing quick operations using the <a class="reference-link" href="../../Note%20Types/Text/In-editor%20AI%20assistant.md">In-editor AI assistant</a>.

## Differences between desktop and web

The [web version](../../Installation%20%26%20Setup/Server%20Installation.md) behaves slightly different due to limitations imposed by web browsers:

*   When no text is selected or a word is right-clicked, the browser's default contextual menu is displayed.
    *   This is intentional since it preserves the <a class="reference-link" href="../../Note%20Types/Text/Spell%20Check.md">Spell Check</a> functionality.
*   When a text is selected, a reduced menu is displayed instead which features only the functionality that is available within the browser version
    *   _Paste_ is not available since the browser doesn't expose it, use <kbd>Ctrl</kbd>+<kbd>V</kbd> instead.
    *   The browser menu can be triggered anyway by pressing <kbd>Shift</kbd> + <kbd>Right click</kbd>.