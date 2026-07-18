# Obsidian
Although Obsidian was indirectly supported through the standard <a class="reference-link" href="../Markdown.md">Markdown</a> import, its vault structure is distinct enough to warrant its own dedicated import channel.

## Import process

The first step is to obtain a .zip of your Obsidian vault:

1.  First, identify where your Obsidian vault is located. The easiest way to do so is to open Obsidian and right clicking the name of the vault at the bottom of the left sidebar and then selecting _Show in system explorer_.
2.  In your system explorer, right click the directory containing your Obsidian vault and compress it to a ZIP file (e.g. on Windows, _Compress To_ → _ZIP_).

> [!TIP]
> When zipping, you can either ZIP the outer folder of the vault, or the contents of the vault as Trilium will automatically determine the position of the vault in the archive via the `.obsidian` directory.

Then, in Trilium Notes:

1.  In the <a class="reference-link" href="../../UI%20Elements/Note%20Tree.md">Note Tree</a>, right click and select _Import into note_.
2.  In the _Import from_ section, select _Obsidian_.
3.  Upload the ZIP obtained in the previous step.

## Supported features

The following features are preserved by Trilium during the import process:

*   Folder hierarchy is preserved.
*   Basic Markdown formatting (bold, italic, underline, strikethrough, headings).
*   Specific Obsidian formatting (highlighting).
*   <a class="reference-link" href="../../../Note%20Types/Text/Lists.md">Lists</a>
*   To-do lists
*   <a class="reference-link" href="../../../Note%20Types/Text/Images.md">Images</a> and <a class="reference-link" href="../../Notes/Attachments.md">Attachments</a>
    *   Non-Markdown files in the Vault are treated as attachments by default if they are referenced by at least one note.
    *   Otherwise, they will be imported as <a class="reference-link" href="../../../Note%20Types/File.md">File</a> notes.
*   Transclusions are converted to <a class="reference-link" href="../../../Note%20Types/Text/Include%20Note.md">Include Note</a> or <a class="reference-link" href="../../../Note%20Types/Text/Images.md">Images</a> (depending on type).
*   <a class="reference-link" href="../../../Note%20Types/Text/Math%20Equations.md">Math Equations</a> (inline or block)
*   <a class="reference-link" href="../../../Note%20Types/Text/Developer-specific%20formatting/Code%20blocks.md">Code blocks</a>, with a best-effort attempt to restore the language.
*   Links between pages are converted to <a class="reference-link" href="../../../Note%20Types/Text/Links/Internal%20(reference)%20links.md">Internal (reference) links</a>.
*   Callouts are converted to Trilium's [Admonitions](../../../Note%20Types/Text/Block%20quotes%20%26%20admonitions.md).
    *   Obsidian has many more types of callouts (`tldr`, `question`, `attention`), these are all mapped to one of Trilium's existing admonition types (e.g. Note, Tip, Important).
    *   Custom titles are kept and shown as a bold line at the top of the admonition, since there is no concept of admonition title in Trilium.
    *   Foldable callouts are imported expanded and without a fold marker.
*   Notes created by the [_Excalidraw_](https://github.com/zsviczian/obsidian-excalidraw-plugin) community plugin for Obsidian are converted to <a class="reference-link" href="../../../Note%20Types/Canvas.md">Canvas</a> (same underlying technology).
    *   Note that custom features introduced by that plugin will not be supported.
*   Modification date is preserved via the information obtained from the .zip archive, creation date is not recoverable so it's kept the same as the modification date.

## Properties

Properties are Obsidian's equivalent of <a class="reference-link" href="../../../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a>. One of the core differences between the two is where the property information is stored (i.e. name and type): in Obsidian everything is stored at vault level and shared across all notes, whereas in Trilium each page can have individual promoted attributes, shared through <a class="reference-link" href="../../../Advanced%20Usage/Templates.md">Templates</a> or <a class="reference-link" href="../../../Advanced%20Usage/Attributes/Attribute%20Inheritance.md">Attribute Inheritance</a>.

Another important difference is that promoted attributes in Trilium are always displayed, even if empty. In Obsidian, these are simply suggested when creating a new property.

To reconcile all these differences, properties are converted to <a class="reference-link" href="../../../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a> at note level.

The following note types are supported:

| Obsidian type | Trilium |
| --- | --- |
| Text or not defined | Single-valued `text` label |
| Number | Single-valued `number` label |
| Multitext | Multi-valued `text` label |
| Checkbox | `boolean` label (`true`/`false`). |
| Date | `date` |
| Date & Time | `datetime` |

### Special properties

Obsidian has a few reserved property names, which are treated differently in Trilium as well:

*   `tags`, where every tag is turned into its own [label](../../../Advanced%20Usage/Attributes/Labels.md) (e.g. `#one`, `#two` when `tags: [ one, two ]`).
*   `aliases` are simply mapped to individual `#alias` labels
*   `cssclasses`, `publish`, `permalink` are ignored.

## Limitations

*   Comments (`%%` syntax) are simply stripped.
*   Obsidian _bases_ functionality is not preserved.
    *   The closest equivalent in Trilium would be <a class="reference-link" href="../../../Collections.md">Collections</a> but they work fundamentally different because bases don't store particular notes, they act more like a <a class="reference-link" href="../../../Note%20Types/Saved%20Search.md">Saved Search</a> with a collection view.
    *   Since the base query format is quite different to Trilium's <a class="reference-link" href="../../Navigation/Search.md">Search</a> syntax, it's unlikely they'll ever be supported.
    *   When a base is encountered, it is simply ignored from the import.
*   Canvases are not imported.
    *   Theoretically they could map to either <a class="reference-link" href="../../../Note%20Types/Canvas.md">Canvas</a> or <a class="reference-link" href="../../../Note%20Types/Relation%20Map.md">Relation Map</a> but they are too different to reconcile.
*   Links
    *   Links to a specific heading in another note will still point to the right note, but the heading anchor will be dropped.
    *   Dangling links (pointing to a note that doesn't exist) and ambiguous links (same base name in 2+ notes) are unwrapped to plain text.