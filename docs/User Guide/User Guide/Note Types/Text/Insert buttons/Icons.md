# Icons
Icons just like the [note icons](Icons.md) can be inserted in the content of a note, including from any other [custom icon packs](../../../Basic%20Concepts%20and%20Features/Themes/Icon%20Packs.md).

## Features

*   The icon can be formatted through the<a class="reference-link" href="../General%20formatting.md">General formatting</a> tools of the <a class="reference-link" href="../Formatting%20toolbar.md">Formatting toolbar</a>:
    *   Foreground/icon color
    *   Background color/highlight
    *   Font size
*   Custom <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/Themes/Icon%20Packs.md">Icon Packs</a> are also supported.
    *   For emojis, prefer the Emoji functionality from <a class="reference-link" href="../Insert%20buttons.md">Insert buttons</a>.
*   When an icon is clicked a floating toolbar appears with the following functions:
    *   <span class="tn-icon bx bx-sticker"></span> which changes the icon.
    *   <span class="tn-icon bx bx-reflect-horizontal"></span> which applies transforms: rotate (90 / 180 / 270) and flip horizontal/vertical. Only one transform can be used per icon.

## Usage

*   The in-app help/user guide makes use of these icons in order to illustrate buttons in the UI.
*   The <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/Import%20%26%20Export/Importing%20data%20from%20other%20applications/Microsoft%20OneNote.md">Microsoft OneNote</a> importer also makes use of them for the <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/Import%20%26%20Export/Importing%20data%20from%20other%20applications/Microsoft%20OneNote/Tags.md">Tags</a>.

## Inserting an icon

There are two ways to insert an icon:

*   Via the <a class="reference-link" href="../Formatting%20toolbar.md">Formatting toolbar</a> look for the <span class="tn-icon bx bx-plus"></span> icon and then the <span class="tn-icon bx bx-sticker"></span> icon.
*   Via <a class="reference-link" href="../Slash%20Commands.md">Slash Commands</a>, type `/icon`.

An icon picker will appear, search for an icon and click it to insert it in the document.

## Finding notes by their icons

An icon can be [searched](../../../Basic%20Concepts%20and%20Features/Navigation/Search.md). A note containing a <span class="tn-icon bx bx-star"></span> icon can be found by searching for `star`, or its `iconClass` (`bx-star`).

To find the name of the icon, hover the mouse over an icon while in the icon picker.

## Markdown rendering

When exporting to <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/Import%20%26%20Export/Markdown.md">Markdown</a>, the item will render as raw HTML representation of the icon as is used by Trilium:

```html
<span class="tn-icon bx bx-star"></span>
```