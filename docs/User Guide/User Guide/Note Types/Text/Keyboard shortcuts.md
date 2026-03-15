# Keyboard shortcuts
## Trilium-specific shortcuts

| Action | PC | Mac |
| --- | --- | --- |
| Bring up inline formatting toolbar (arrow keys <kbd><span>←</span></kbd>,<kbd><span>→</span></kbd> to navigate, <kbd>Enter</kbd> to apply) | <kbd>Alt</kbd>+<kbd>F10</kbd> | <kbd>⌥</kbd>+<kbd>F10</kbd> |
| Bring up block formatting toolbar | <kbd>Alt</kbd>+<kbd>F10</kbd> | <kbd>⌥</kbd>+<kbd>F10</kbd> |
| Create [external link](Links.md) | <kbd>Ctrl</kbd>+<kbd>K</kbd> | <kbd>⌘</kbd>+<kbd>K</kbd> |
| Create [internal (note) link](Links.md) | <kbd>Ctrl</kbd>+<kbd>L</kbd> | <kbd>⌘</kbd>+<kbd>L</kbd> |
| Inserts current date and time at caret position | <kbd>Alt</kbd>+<kbd>T</kbd> | <kbd>⌥</kbd>+<kbd>T</kbd> |
| Increase paragraph indentation | <kbd>Tab</kbd> | <kbd>⇥</kbd> |
| Decrease paragraph indentation | <kbd>Shift</kbd> + <kbd>Tab</kbd> | <kbd>⇧</kbd> + <kbd>⇥</kbd> |
| Mark selected text as [keyboard shortcut](Developer-specific%20formatting.md) | <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>K</kbd> | <kbd>⌘</kbd>\+ <kbd>⌥</kbd>\+ <kbd>K</kbd> |
| Insert <a class="reference-link" href="Math%20Equations.md">Math Equations</a> | <kbd>Ctrl</kbd> + <kbd>M</kbd> | <kbd>⌘</kbd>\+ <kbd>M</kbd> |
| Move blocks (lists, paragraphs, etc.) up | <kbd>Ctrl</kbd>+<kbd>↑</kbd> | <kbd>⌘</kbd>+<kbd>↑</kbd> |
| <kbd>Alt</kbd>+<kbd>↑</kbd> | <kbd>⌥</kbd>+<kbd>↑</kbd> |  |
| Move blocks (lists, paragraphs, etc.) down | <kbd>Ctrl</kbd>+<kbd>↑</kbd> | <kbd>⌘</kbd>+<kbd>↑</kbd> |
| <kbd>Alt</kbd>+<kbd>↓</kbd> | <kbd>⌥</kbd>+<kbd>↓</kbd> |  |

## Common shortcuts

> [!TIP]
> This section of keyboard shortcuts presents a subset of the keyboard shortcuts as supported by the editor technology we are using, <a class="reference-link" href="../../Advanced%20Usage/Technologies%20used/CKEditor.md">CKEditor</a>. The shortcuts were taken from the [official documentation](https://ckeditor.com/docs/ckeditor5/latest/features/accessibility.html#keyboard-shortcuts). Note that not all the shortcuts in the original documentation are applicable (due to using a different configuration).

### Content editing

| Action | PC | Mac |
| --- | --- | --- |
| Insert a hard break (a new paragraph) | <kbd>Enter</kbd> |  |
| Insert a soft break (a `<br>` element) | <kbd>Shift</kbd>+<kbd>Enter</kbd> | <kbd>⇧Enter</kbd> |
| Copy selected content | <kbd>Ctrl</kbd>+<kbd>C</kbd> | <kbd>⌘C</kbd> |
| Paste content | <kbd>Ctrl</kbd>+<kbd>V</kbd> | <kbd>⌘V</kbd> |
| Paste content as plain text | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> | <kbd>⌘⇧V</kbd> |
| Undo | <kbd>Ctrl</kbd>+<kbd>Z</kbd> | <kbd>⌘Z</kbd> |
| Redo | <kbd>Ctrl</kbd>+<kbd>Y</kbd>, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | <kbd>⌘Y</kbd>, <kbd>⌘⇧Z</kbd> |
| Bold text | <kbd>Ctrl</kbd>+<kbd>B</kbd> | <kbd>⌘B</kbd> |
| Change text case | <kbd>Shift</kbd>+<kbd>F3</kbd> | <kbd>⇧F3</kbd> (may require <kbd>Fn</kbd>) |
| Create link | <kbd>Ctrl</kbd>+<kbd>K</kbd> | <kbd>⌘K</kbd> |
| Move out of a link | <kbd>←←</kbd>, <kbd>→→</kbd> |  |
| Move out of an inline code style | <kbd>←←</kbd>, <kbd>→→</kbd> |  |
| Select all | <kbd>Ctrl</kbd>+<kbd>A</kbd> | <kbd>⌘A</kbd> |
| Find in the document | <kbd>Ctrl</kbd>+<kbd>F</kbd> | <kbd>⌘F</kbd> |
| Copy text formatting | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> | <kbd>⌘⇧C</kbd> |
| Paste text formatting | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> | <kbd>⌘⇧V</kbd> |
| Italic text | <kbd>Ctrl</kbd>+<kbd>I</kbd> | <kbd>⌘I</kbd> |
| Strikethrough text | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> | <kbd>⌘⇧X</kbd> |
| Underline text | <kbd>Ctrl</kbd>+<kbd>U</kbd> | <kbd>⌘U</kbd> |
| Revert autoformatting action | <kbd>Backspace</kbd> |  |

### Interacting with blocks

Blocks are images, tables, blockquotes, annotations.

| Action | PC | Mac |
| --- | --- | --- |
| Insert a new paragraph directly after a widget | <kbd>Enter</kbd> |  |
| Insert a new paragraph directly before a widget | <kbd>Shift</kbd>+<kbd>Enter</kbd> | <kbd>⇧Enter</kbd> |
| Move the caret to allow typing directly before a widget | <kbd>↑</kbd>, <kbd>←</kbd> |  |
| Move the caret to allow typing directly after a widget | <kbd>↓</kbd>, <kbd>→</kbd> |  |
| After entering a nested editable, move the selection to the closest ancestor widget. For example: move from an image caption to the whole image widget. | <kbd>Tab</kbd> then <kbd>Esc</kbd> |  |

Specifically for lists:

| Action | PC | Mac |
| --- | --- | --- |
| Increase list item indent | <kbd>⇥</kbd> |  |
| Decrease list item indent | <kbd>Shift</kbd>+<kbd>⇥</kbd> | <kbd>⇧⇥</kbd> |

In tables:

| Action | PC | Mac |
| --- | --- | --- |
| Move the selection to the next cell | <kbd>⇥</kbd> |  |
| Move the selection to the previous cell | <kbd>Shift</kbd>+<kbd>⇥</kbd> | <kbd>⇧⇥</kbd> |
| Insert a new table row (when in the last cell of a table) | <kbd>⇥</kbd> |  |
| Navigate through the table | <kbd>↑</kbd>, <kbd>→</kbd>, <kbd>↓</kbd>, <kbd>←</kbd> |  |

### General UI shortcuts

| Action | PC | Mac |
| --- | --- | --- |
| Close contextual balloons, dropdowns, and dialogs | <kbd>Esc</kbd> |  |
| Open the accessibility help dialog | <kbd>Alt</kbd>+<kbd>0</kbd> | <kbd>⌥0</kbd> |
| Move focus between form fields (inputs, buttons, etc.) | <kbd>⇥</kbd>, <kbd>Shift</kbd>+<kbd>⇥</kbd> | <kbd>⇥</kbd>, <kbd>⇧⇥</kbd> |
| Move focus to the toolbar, navigate between toolbars | <kbd>Alt</kbd>+<kbd>F10</kbd> | <kbd>⌥F10</kbd> (may require <kbd>Fn</kbd>) |
| Navigate through the toolbar or menu bar | <kbd>↑</kbd>, <kbd>→</kbd>, <kbd>↓</kbd>, <kbd>←</kbd> |  |
| Navigate to the next focusable field or an element outside the editor | <kbd>Tab</kbd>, <kbd>Shift</kbd>+<kbd>Tab</kbd> |  |
| Execute the currently focused button. Executing buttons that interact with the editor content moves the focus back to the content. | <kbd>Enter</kbd>, <kbd>Space</kbd> |  |
| Move focus in and out of an active dialog window | <kbd>Ctrl</kbd>+<kbd>F6</kbd> | <kbd>⌘F6</kbd> (may require <kbd>Fn</kbd>) |