# CKEditor
## Editor core

The CKEditor is the WYSIWYG (standing for What You See Is What You Get) editor behind [Text](../../Note%20Types/Text.md) notes.

Their website is [ckeditor.com](https://ckeditor.com/).

CKEditor by itself is a commercial product, but the core is open-source. As described in [its documentation](https://ckeditor.com/docs/ckeditor5/latest/features/index.html), the editor supports quite a large number of features. Do note that not all the features are enabled in Trilium.

## Premium features

CKEditor ships some plugins as premium (slash commands, templates, AI integration). Initially Trilium (since v0.96.0) shipped some of them like slash commands as part of a license grant from CKEditor to the Trilium Notes developers.

In v0.105.0 we've decided to replace those premium plugins with our own open-source implementations. This also means that we can better tailor those plugins to the Trilium app.

## Plugins

The CKEditor ecosystem is quite extensible, in the sense that custom plugins can be written to extend the functionality of the editor beyond its original scope.

Trilium makes use of such features:

*   The math feature is added by a version of [isaul32/ckeditor5-math: Math feature for CKEditor 5.](https://github.com/isaul32/ckeditor5-math) modified by us to fit our needs.
*   We also make use of modified upstream plugins such as [ckeditor/ckeditor5-mermaid](https://github.com/ckeditor/ckeditor5-mermaid) to allow inline Mermaid code.
*   [mlewand/ckeditor5-keyboard-marker: Plugin adds support for the keyboard input element (`<kbd>`) to CKEditor 5.](https://github.com/mlewand/ckeditor5-keyboard-marker)
*   A modified version of [ThomasAitken/ckeditor5-footnotes: Footnotes plugin for CKEditor5](https://github.com/ThomasAitken/ckeditor5-footnotes) to allow footnotes.

Apart from that, Trilium also has its own set of specific plugins such as:

*   <a class="reference-link" href="../../Note%20Types/Text/Cut%20to%20subnote.md">Cut to subnote</a>
*   <a class="reference-link" href="../../Note%20Types/Text/Include%20Note.md">Include Note</a>
*   Mentions, for linking pages.
*   <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Import%20%26%20Export/Markdown.md">Markdown</a>
*   [Reference links](../../Note%20Types/Text/Links.md)
*   [Admonitions](../../Note%20Types/Text/Block%20quotes%20%26%20admonitions.md), we ended up creating our own plugin but [aarkue/ckeditor5-admonition](https://github.com/aarkue/ckeditor5-admonition) was a good inspiration (including the toolbar icon).