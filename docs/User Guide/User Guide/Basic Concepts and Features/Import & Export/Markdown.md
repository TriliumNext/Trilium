# Markdown
Trilium supports Markdown for both import and export, while trying to keep compatibility as high as possible.

## Import

### Clipboard import

If you want to import just a chunk of markdown from clipboard, you can do it from editor block menu:

![](Markdown_markdown-inline-import.gif)

### File import

You can also import Markdown files from files:

*   single markdown file (with .md extension)
*   whole tree of markdown files (packaged into [.zip](https://en.wikipedia.org/wiki/Tar_\(computing\)) archive)
    *   Markdown files need to be packaged into ZIP archive because browser can't read directories, only single files.
    *   You can use e.g. [7-zip](https://www.7-zip.org) to package directory of markdown files into the ZIP file

![](Markdown_markdown-file-import.gif)

## Export

### Subtree export

You can export whole subtree to ZIP archive which will have directory structured modelled after subtree structure:

![](Markdown_markdown-export-subtree.gif)

### Single note export

If you want to export just single note without its subtree, you can do it from Note actions menu:

![](Markdown_markdown-export-note.gif)

### Exporting protected notes

If you want to export protected notes, enter a protected session first! This will export the notes in an unencrypted form, so if you reimport into Trilium, make sure to re-protect these notes.

## Supported syntax

See the dedicated page: <a class="reference-link" href="Markdown/Supported%20syntax.md">Supported syntax</a>