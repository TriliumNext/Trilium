# Supported syntax
[GitHub-Flavored Markdown](https://github.github.com/gfm/) is the main syntax that Trilium is following.

## Images

When exporting, images are usually kept in the basic Markdown syntax but will use the HTML syntax if the image has a custom width. Figures are always embedded as HTML.

## Tables

Simple tables are supported with the Markdown syntax. If the table is too complex or contains elements that would render as HTML, the table is also rendered as HTML.

## Links

Standard Markdown links are supported.

Trilium internal links (that mirror a note's title and display its icon) are embedded as HTML in order to preserve the information on import.

## Math equations

Both inline and display equations are supported, using the `$` and `$$` syntaxes.

## Admonitions

The Markdown syntax for admonitions as supported by Trilium is the one that GitHub uses, which is as follows:

```
> [!NOTE]
> This is a note.

> [!TIP]
> This is a tip.

> [!IMPORTANT]
> This is a very important information.

> [!CAUTION]
> This is a caution.
```

There are currently no plans of supporting alternative admonition syntaxes such as `!!! note`.

## Wikilinks

Basic support for wikilinks has been added in v0.96.0:

*   `[[foo/bar]]` will look for the `bar.md` file in the `foo` directory and turn it into an internal link.
*   `![[foo/baz.png]]` will look for the `baz.png` file in the `foo` directory and turn it into an image.

This feature is import-only, which means that it will turn wikilinks into Trilium-compatible syntax, but it will not export Trilium Notes into Markdown files with this syntax.

> [!IMPORTANT]
> The path to pages in wikilinks is resolved relatively to the _import root_ and not the current directory of the note. This is to be inline with other platforms that use wikilinks such as SilverBullet.
> 
> The root path of the import is determined as follows:
> 
> *   If there is a single directory within the archive at root level, then that directory is considered the root.
> *   If there are multiple files & directories at root level, then the archive root (containing all of these items) is considered the root.

## Highlights

Background highlights are supported in two ways:

*   The Markdown `==` extension which is supported by other Markdown-based applications such as Obsidian:
    
    ```
    ==highlighted==
    ```
*   The canonical HTML representation of highlights, as supported by Trilium:
    
    ```html
    <span style="background-color:hsl(0,0%,100%);">Highlighted</span>
    ```

When the yellow highlight is used, import/export prefers the `==` syntax whereas the canonical HTML reprepresentation is used otherwise.