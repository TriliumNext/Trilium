# Creating an icon pack
> [!NOTE]
> This page explains, step‑by‑step, how to create a custom icon pack. For a general description of how to use already existing icon packs, see <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Themes/Icon%20Packs.md">Icon Packs</a>.

First read the quick flow to get the overall steps. After that there is a concrete example (Phosphor) with a small Node.js script you can run to generate the manifest.

## Quick flow (what you need to do)

1.  Verify the icon set is a font (one of: .woff2, .woff, .ttf).
2.  Obtain a list that maps icon names to Unicode code points (often provided as a JSON like `selection.json` or a CSS file).
3.  Create a manifest JSON that maps icon ids to glyphs and search terms.
4.  Create a Trilium note of type Code, set language to JSON, paste the manifest as the note content.
5.  Upload the font file as an attachment to the same note (MIME type must be `font/woff2`, `font/woff`, or `font/ttf` and role `file`).
6.  Add the label `#iconPack=<prefix>` to the note (prefix: alphanumeric, hyphen, underscore only).
7.  Refresh the client and verify the icon pack appears in the icon selector.

## Verify the icon set

The first step is to analyze if the icon set being packed can be integrated into Trilium.

Trilium only supports **font-based icon sets**, with the following formats:

| Extension | MIME type | Description |
| --- | --- | --- |
| `.woff2` | `font/woff2` | Recommended due to great compression (low size). |
| `.woff` | `font/woff` | Higher compatibility, but the font file is bigger. |
| `.ttf` | `font/ttf` | Most common, but highest font size. |

Trilium **does not** support the following formats:

*   SVG-based fonts.
*   Individual SVGs.
*   `.eot` fonts (legacy and proprietary).
*   Duotone icons, since it requires a special CSS format that Trilium doesn't support.
*   Any other font format not specified in the _Supported formats_ section.

In this case, the font must be manually converted to one of the supported formats (ideally `.woff2`).

## Manifest format

The manifest is a JSON object with an `icons` map. Each entry key is the CSS/class id you will use (Trilium uses the CSS class when rendering). Value object:

*   glyph: the single character (the glyph) — can be the escaped Unicode (e.g. "\\ue9c2") or the literal character.
*   terms: array of search aliases; the first term is used as display name in the selector.

Example minimal manifest:

```
{
  "icons": {
    "ph-acorn": {
      "glyph": "\uea3f",
      "terms": ["acorn", "nut"]
    },
    "ph-book": {
      "glyph": "\uea40",
      "terms": ["book", "read"]
    }
  }
}
```

> [!NOTE]
> *   You can supply glyph as the escaped `\uXXXX` sequence or as the actual UTF‑8 character.
> *   It is also possible to use the unescaped glyph inside the JSON. It will appear strange (e.g. ), but it will be rendered properly regardless.
> *   The manifest keys (e.g. `ph-acorn`) should match the class names used by the font (prefix + name is a common pattern).

## Concrete example: Phosphor Icons

[Phosphor Icons](https://phosphoricons.com/) provide a `selection.json` that includes `properties.code` (the codepoint) and `properties.name` (the icon name). The goal: convert that into Trilium's manifest.

Sample `selection.json` excerpt:

```
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

A tiny Node.js script to produce the manifest (place `selection.json` in the same directory and run with Node 20+):

```javascript
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

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

    writeFileSync("manifest.json", JSON.stringify(icons, null, 2), "utf8");
    console.log("manifest.json created");
}

processIconPack("light");
```

What to do with the script:

*   Put `selection.json` and `build-manifest.js` in a folder.
*   Run: node build-manifest.js
*   The script writes `manifest.json` — open it, verify contents, then copy into a Trilium Code note (language: JSON).

> [!TIP]
> **Mind the escape format when processing CSS**
> 
> The Unicode escape syntax is different in CSS (`"\ea3f"`) when compared to JSON (`"\uea3f"`). Notice how the JSON escape is `\u` and not `\`.
> 
> As a more compact alternative, provide the un-escaped character directly, as UTF-8 is supported.

### Assigning the prefix

Before an icon pack can be used, it needs to have a prefix defined. This prefix uniquely identifies the icon pack so that it can be used throughout the application.

To do so, Trilium makes use of the same format that was used for the internal icon pack (Boxicons). For example, when an icon from Boxicons is set, it looks like this: `#iconClass="bx bxs-sushi"`. In this case, the icon pack prefix is `bx` and the icon class name is `bxs-sushi`.

In order for an icon pack to be recognized, the prefix must be specified in the `#iconPack` label. 

For our example with Phosphor Icons, we can use the `ph` prefix since it also matches the prefix set in the original CSS. So in this case it would be `#iconPack=ph`.

> [!IMPORTANT]
> The prefix must consist of only alphanumeric characters, hyphens and underscore. If the prefix doesn't match these constraints, the icon pack will be ignored and an error will be logged in <a class="reference-link" href="../Troubleshooting/Error%20logs/Backend%20(server)%20logs.md">Backend (server) logs</a>.

## Creating the Trilium icon pack note

1.  Create a note of type _Code_.
2.  Set the language to _JSON_.
3.  Rename the note. The name of the note will also be the name of the icon pack as displayed in the list of icons.
4.  Copy and paste the manifest generated in the previous step as the content of this note.
5.  Go to the [note attachment](../Basic%20Concepts%20and%20Features/Notes/Attachments.md) and upload the font file (in `.woff2`, `.woff`, `.ttf`) format.
    1.  Trilium identifies the font to use from attachments via the MIME type, make sure the MIME type is displayed correctly after uploading the attachment (for example `font/woff2`).
    2.  Make sure the `role` appears as `file`, otherwise the font will not be identified.
    3.  Multiple attachments are supported, but only one font will actually be used in Trilium's order of preference: `.woff2`, `.woff`, `.ttf`. As such, there's not much reason to upload more than one font per icon pack.
6.  Add label: `#iconPack=<prefix>` (for Phosphor example: `#iconPack=ph`).

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