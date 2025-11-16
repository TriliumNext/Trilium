# Export diagram as SVG
This mechanism is handled by `src/public/app/widgets/floating_buttons/svg_export_button.js`.

## Step 1. Enable the button

Modify the  `isEnabled` method in `svg_export_button.js` to add support for the new note type.

## Step 2. Add support for exporting the image

The SVG export needs to be handled inside the note type implementation. 

The first goal is to create a method to handle the <a class="reference-link" href="SVG%20rendering.md">SVG rendering</a>. Make sure to deduplicate the code if the SVG rendering is already handled.

```
async renderSvg() {
    return await this.mind.exportSvg().text();
}
```

Then create an event handler to manage the SVG export:

```
async exportSvgEvent({ntxId}) {
    if (!this.isNoteContext(ntxId) || this.note.type !== "mindMap") {
        return;
    }

    const svg = await this.renderSvg();
    utils.downloadSvg(this.note.title, svg);
}
```

Make sure to modify the note type assertion at the beginning of the method. This is very important, otherwise there can be errors when navigating through multiple note types that support this button.