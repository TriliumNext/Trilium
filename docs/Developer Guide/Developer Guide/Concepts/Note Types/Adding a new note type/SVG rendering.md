# SVG rendering
For diagrams and similar note types, it makes sense to cache an SVG rendering of the content so that it can be used for:

*   Content preview in note lists (when viewing the list of notes from the parent note).
*   Note inclusion
*   Share

## Step 1. Save the SVG content as an attachment

The first step is to obtain the SVG from the custom widget used. For example, for Mind Elixir there is an `exportSvg` method.

If the returned value is a `Blob`, then the underlying text can be obtained via `await blob.text()`.

To save the SVG as an attachment alongside the content, simply modify `getData()`:

```
async getData() {
    const mind = this.mind;
    if (!mind) {
        return;
    }

    const svgContent = await this.mind.exportSvg().text();   
    return {
        content: mind.getDataString(),
        attachments: [
            {
                role: "image",
                title: "mindmap-export.svg",
                mime: "image/svg+xml",
                content: svgContent,
                position: 0
            }
        ]
    };
}
```

You can test this step by making a change to the note and then using the “Note attachments” option from the note menu.

## Step 2. Adapting the server to serve SVG attachment

The `src/routes/api/image.ts` route is in charge for serving the image previews of image notes, but also of custom note types such as canvases.

Alter the `returnImageInt` method as follows:

1.  Add the image type to the guard condition which returns 400 for unsupported note types.
2.  Add an `if` statement to render the attachment using the correct name:

```
if (image.type === "mindMap") {
	renderSvgAttachment(image, res, 'mindmap-export.svg');
}
```

## Step 3. Serve the SVG attachment for note preview

The client also needs tweaking to allow it to render SVG attachments by calling the previously modified server route.

The `src/public/app/services/content_renderer.js` file is in charge of handling the previews. To render using the image route, modify `getRenderedContent` to add the new note type to the `if` which calls `renderImage`.

## Step 4. Serve SVG for share

By default, `Note type cannot be displayed` will be displayed when trying to access the given note via a share.

To serve the SVG, open `src/share/content_renderer.ts` and look for `getContent`. Then add to the `if` containing `renderImage` the new note type.

This is not enough, as attempting to access the shared note will result in a broken image that fails with `Requested note is not a shareable image`. To solve this one, go to `src/share/routes.ts` and add a `renderImageAttachment` statement to `router.get('/share/api/images/[…])`.

## Step 5. Serve SVG for revisions

In the revisions list, to display the SVG, go to `src/public/app/widgets/dialogs/revisions.js` and look for the `renderContent` method. Simply add the note type to one of the already existing `if`s, such as the one for `canvas` and `mindMap` or `mermaid` (if the text content of the diagram should also be displayed).