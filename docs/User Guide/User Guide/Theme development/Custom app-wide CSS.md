# Custom app-wide CSS
It is possible to provide a CSS file to be used regardless of the theme set by the user.

|     |     |
| --- | --- |
| ![](Custom%20app-wide%20CSS_image.png) | Start by creating a new note and changing the note type to CSS |
| ![](2_Custom%20app-wide%20CSS_image.png) | In the ribbon, press the “Owned Attributes” section and type `#appCss`. |
| ![](3_Custom%20app-wide%20CSS_image.png) | Type the desired CSS.    <br>  <br>Generally it's a good idea to append `!important` for the styles that are being changed, in order to prevent other |

## Seeing the changes

Adding a new _app CSS note_ or modifying an existing one does not immediately apply changes. To see the changes, press Ctrl+Shift+R to refresh the page first.

## Sample use cases

### Customizing the printing stylesheet

When printing a document or exporting as PDF, it is possible to adjust the style by creating a CSS note that uses the `@media` selector.

For example, to change the font of the document from the one defined by the theme or the user to a serif one:

```
@media print {
	body {
        --main-font-family: serif !important;
        --detail-font-family: var(--main-font-family) !important;
    }
}
```

### Per-workspace styles

When using <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Navigation/Workspaces.md">Workspaces</a>, it can be helpful to create a visual distinction between notes in different workspaces.

To do so:

1.  In the note with `#workspace`, add an inheritable attribute `#cssClass(inheritable)` with a value that uniquely identifies the workspace (say `my-workspace`).
2.  Anywhere in the note structure, create a CSS note with `#appCss`.

#### Change the color of the icons in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>

```
.fancytree-node.my-workspace.fancytree-custom-icon {
    color: #ff0000;
}
```

#### Change the color of the note title and the icon

To change the color of the note title and the icon (above the content):

```
.note-split.my-workspace .note-icon-widget button.note-icon,
.note-split.my-workspace .note-title-widget input.note-title {
    color: #ff0000;
}
```

#### Add a watermark to the note content

<figure class="image image-style-align-right image_resized" style="width:39.97%;"><img style="aspect-ratio:641/630;" src="1_Custom app-wide CSS_image.png" width="641" height="630"></figure>

1.  Insert an image in any note and take the URL of the image.
2.  Use the following CSS, adjusting the `background-image` and `width` and `height` to the desired values.

```
.note-split.my-workspace .scrolling-container:after {
    position: fixed;
    content: "";
    background-image: url("/api/attachments/Rvm3zJNITQI1/image/logo.png");
    background-size: contain;
    background-position: center;
    background-repeat: no-repeat;
    width: 237px;
    height: 44px;
    bottom: 1em;
    right: 1em;
    opacity: 0.5;
    z-index: 0;
}
```

## Limitations

Some parts of the application can't be styled directly via custom CSS because they are rendered in an isolated mode (shadow DOM), more specifically:

*   The slides in a <a class="reference-link" href="../Note%20Types/Collections/Presentation%20View.md">Presentation View</a>.