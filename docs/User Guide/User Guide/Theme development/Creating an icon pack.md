# Creating an icon pack
> [!NOTE]
> e This page describes how to create custom icon packs. For a general description of how to use already existing icon packs, see <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Themes/Icon%20Packs.md">Icon Packs</a>.

## Supported formats

The first step is to analyze if the icon set being packed can be integrated into Trilium.

Trilium only supports **font-based icon sets**, with the following formats:

| Extension | MIME type | Description |
| --- | --- | --- |
| `.woff2` | `font/woff2` | Recommended due to great compression (low size). |
| `.woff` | `font/woff` | Higher compatibility, but the font file is bigger. |
| `.ttf` | `font/ttf` | Most common, but highest font size. |

## Unsupported formats

Trilium **does not** support the following formats:

*   SVG-based fonts.
*   Individual SVGs.
*   `.eot` fonts (legacy and proprietary).
*   Duotone icons, since it requires a special CSS format that Trilium doesn't support.
*   Any other font format not specified in the _Supported formats_ section.

In this case, the font must be manually converted to one of the supported formats (ideally `.woff2`).

## Prerequisites

In order to create a new icon pack from a set of icons, it must meet the following criteria:

1.  It must have a web font of the supported format (see above).
2.  It must have some kind of list, containing the name of each icon and the corresponding Unicode code point. If this is missing, icon fonts usually ship with a `.css` file that can be used to extract the icon names from.

## Step-by-step process

As an example throughout this page, we are going to go through the steps of integrating [Phosphor Icons](https://phosphoricons.com/).

### Creating the manifest

This is the most difficult part of creating an icon pack, since it requires processing of the icon list to match Trilium's format.

The icon pack manifest is a JSON file with the following structure:

```json
{
	"icons": {
		"bx-ball": {
			"glyph": "\ue9c2",
			"terms": [ "ball" ]
		},		
		"bxs-party": {
			"glyph": "\uec92"
			"terms": [ "party" ]
		}
	}
}
```

*   The JSON example is a sample from the Boxicons font.
*   This is simply a mapping between the CSS classes (`bx-ball`), to its corresponding code point in the font (`\ue9c2`) and the terms/aliases used for search purposes.
*   Note that it's also possible to use the unescaped glyph inside the JSON. It will appear strange (e.g. ), but it will be rendered properly regardless.
*   The first term is also considered the “name” of the icon, which is displayed while hovering over it in the icon selector.

In order to generate this manifest, generally a script is needed that processes an already existing list. In the case of Phosphor Icons, the icon list comes in a file called `selection.json` with the following format:

```json
{
  "icons": [
    {
      "icon": {
        "paths": [ /* [...] */ ],
        "grid": 0,
        "attrs": [{}],
        "isMulticolor": false,
        "isMulticolor2": false,
        "tags": ["acorn"]
      },
      "attrs": [{}],
      "properties": {
        "id": 0,
        "order": 1513,
        "name": "acorn",
        "code": 60314,
        "ligatures": "acorn",
        "prevSize": 16
      },
      "setIdx": 0,
      "setId": 0,
      "iconIdx": 0
    },
    /* [...] */
  ]
}
```

As such, we can write a Node.js script to automatically process the manifest file:

```javascript
import { join } from "node:path";
import { readFileSync } from "node:fs";

function processIconPack(packName) {
    const path = join(packName);
    const selectionMeta = JSON.parse(readFileSync(join(path, "selection.json"), "utf-8"));
    const icons = {};

    for (const icon of selectionMeta.icons) {
        let name = icon.properties.name;
        if (name.endsWith(`-${packName}`)) {
            name = name.split("-").slice(0, -1).join("-");
        }

        const id = `ph-${name}`;
        icons[id] = {
            glyph: `${String.fromCharCode(icon.properties.code)}`,
            terms: [ name ]
        };
    }

    return JSON.stringify({
        icons
    }, null, 2);
}

console.log(processIconPack("light"));
```

> [!TIP]
> **Mind the escape format when processing CSS**
> 
> The Unicode escape syntax is different in CSS (`"\ea3f"`) when compared to JSON (`"\uea3f"`). Notice how the JSON escape is `\u` and not `\`.
> 
> As a more compact alternative, provide the un-escaped character directly, as UTF-8 is supported.

### Creating the icon pack

1.  Create a note of type _Code_.
2.  Set the language to _JSON_.
3.  Copy and paste the manifest generated in the previous step as the content of this note.
4.  Go to the [note attachment](../Basic%20Concepts%20and%20Features/Notes/Attachments.md) and upload the font file (in `.woff2`, `.woff`, `.ttf`) format.
    1.  Trilium identifies the font to use from attachments via the MIME type, make sure the MIME type is displayed correctly after uploading the attachment (for example `font/woff2`).
    2.  Make sure the `role` appears as `file`, otherwise the font will not be identified.
    3.  Multiple attachments are supported, but only one font will actually be used in Trilium's order of preference: `.woff2`, `.woff`, `.ttf`. As such, there's not much reason to upload more than one font per icon pack.
5.  Go back to the note and rename it. The name of the note will also be the name of the icon pack as displayed in the list of icons.

### Assigning the prefix

Before an icon pack can be used, it needs to have a prefix defined. This prefix uniquely identifies the icon pack so that it can be used throughout the application.

To do so, Trilium makes use of the same format that was used for the internal icon pack (Boxicons). For example, when an icon from Boxicons is set, it looks like this: `#iconClass="bx bxs-sushi"`. In this case, the icon pack prefix is `bx` and the icon class name is `bxs-sushi`.

In order for an icon pack to be recognized, the prefix must be specified in the `#iconPack` label. 

For our example with Phosphor Icons, we can use the `ph` prefix since it also matches the prefix set in the original CSS. So in this case it would be `#iconPack=ph`.

> [!IMPORTANT]
> The prefix must consist of only alphanumeric characters, hyphens and underscore. If the prefix doesn't match these constraints, the icon pack will be ignored and an error will be logged in <a class="reference-link" href="../Troubleshooting/Error%20logs/Backend%20(server)%20logs.md">Backend (server) logs</a>.

### Final steps

*   [Refresh the client](../Troubleshooting/Refreshing%20the%20application.md)
    *   Change the icon of the note and look for the _Filter_ icon in the top-right side.
    *   Check if the new icon pack is displayed there and click on it to see the full list of icons.
    *   Go through most of the items to look for issues such as missing icon, wrong names (some icons have aliases/terms that can cause issues).
*   Optionally, assign an icon from the new icon pack to this note. This icon will be used in the icon pack filter for a visual distinction.
*   The icon pack can then be [exported as ZIP](../Basic%20Concepts%20and%20Features/Import%20%26%20Export.md) in order to be distributed to other users.
    *   It's important to note that icon packs are considered “unsafe” by default, so “Safe mode” must be disabled when importing the ZIP.
    *   Consider linking new users to the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Themes/Icon%20Packs.md">Icon Packs</a> documentation in order to understand how to import and use an icon pack.

### Troubleshooting

If the icon pack doesn't show up, look through the <a class="reference-link" href="../Troubleshooting/Error%20logs/Backend%20(server)%20logs.md">Backend (server) logs</a> for clues.

*   One example is if the font could not be retrieved: `ERROR: Icon pack is missing WOFF/WOFF2/TTF attachment: Boxicons v3 400 (dup) (XRzqDQ67fHEK)`.
*   Make sure the prefix is unique and not already taken by some other icon pack. When there are two icon packs with the same prefix, only one is used. The server logs will indicate if this situation occurs.
*   Make sure the prefix consists only of alphanumeric characters, hyphens and underscore.