# Personalizing the font
## Using different fonts

Trilium comes by default with its own font (_Inter_), but the font can be adjusted in <a class="reference-link" href="../UI%20Elements/Options.md">Options</a> → _Appearance_, by checking _Use different fonts_ in the _Fonts_ section.

The font can be personalized for the following areas of the application:

*   Interface text, for most of the UI (menus, toolbars, dialogs).
*   <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a>.
*   Document text, for the actual content of the notes (especially for <a class="reference-link" href="../../Note%20Types/Text.md">Text</a> notes).
*   Monospace text, e.g. for <a class="reference-link" href="../../Note%20Types/Code.md">Code</a> notes and <a class="reference-link" href="../../Note%20Types/Text/Developer-specific%20formatting/Code%20blocks.md">Code blocks</a>.

Each area also has its own _Size_. The note tree and document sizes are relative to the interface size, so changing the interface size moves them along with it.

The list of fonts contains the following items:

*   **Generic fonts**
    *   _Theme defined_ which uses the font that is embedded with the current [theme](../Themes.md). For example on the default modern theme, the font is _Inter_. This does not require the font to be installed.
    *   _System default_ which uses a combination of fonts that works best for the [desktop app](../../Installation%20%26%20Setup/Desktop%20Installation.md). For example on Windows it will use _Segoe UI_.
    *   Generic font selections for fonts with serifs (e.g. _Times New Roman_\-like), no serifs and monospace.
*   **Web fonts** which appear on the <a class="reference-link" href="../../Installation%20%26%20Setup/Server%20Installation.md">Server Installation</a>, which is a predefined list of fonts and grouped into Sans-serif, serif, monospace and handwriting. The fonts that are not supported by your system (i.e. not installed) are not displayed.
*   **System fonts** which appear on the <a class="reference-link" href="../../Installation%20%26%20Setup/Desktop%20Installation.md">Desktop Installation</a>. Unlike the server fonts which are predefined, the system fonts are listed from your operating system.
*   **Custom fonts**, allowing any font to be used provided it's imported into Trilium. See the section below for more information.

Font changes take effect after a reload; the section offers a _Reload to apply changes_ button once something has been changed.

## Custom fonts

A font file imported into Trilium can be used by the application itself, without writing any CSS.

### Adding a font

1.  Import the font file, by dragging it into the <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a> or through _Import into note_. TrueType (`.ttf`), OpenType (`.otf`) and Web Open Font Format (`.woff`, `.woff2`) files are recognized; the note takes the font's name without its extension and is marked with a font icon (an “A” icon).
2.  Select the resulting note where a preview of a font will be displayed: a specimen line to type your own text into, a slider for its size, a preview in multiple sizes, and the Latin character set.
3.  Turn on _In font picker_ above the specimen.
4.  In <a class="reference-link" href="../UI%20Elements/Options.md">Options</a> → _Appearance_ → _Fonts_, the font is now offered under _Custom fonts_, ahead of the built-in families, and can be set for any of the four areas.

> [!NOTE]
> Embedded OpenType (`.eot`) files and TrueType collections (`.ttc`) cannot be drawn by the browser, so they are treated as ordinary files: no preview, and no entry in the picker.

### How custom fonts behave

*   Each entry is named after its note, so renaming the note renames the entry. The setting refers to the note itself rather than to its name, and keeps working across a rename.
*   The font file is an ordinary note, so <a class="reference-link" href="../../Installation%20%26%20Setup/Synchronization.md">Synchronization</a> carries it to your other devices. The choice of font is not synced: appearance settings are deliberately kept per-device, so on another device the font is already there and only needs to be selected again.
*   A font kept in a [protected note](../Notes/Protected%20Notes.md) can only be previewed and used while the protected session is open.

For theme authors, a font can also be embedded in a theme's CSS through <a class="reference-link" href="../../Advanced%20Usage/Custom%20Resource%20Providers.md">Custom Resource Providers</a>, which is the route to take when the font should come with the theme rather than be chosen in the settings.

### Downloading from Google Fonts

A large selection of fonts can be easily retrieved from Google Fonts, as follows:

1.  Go to [https://fonts.google.com](https://fonts.google.com).
2.  Search for a desired font.
3.  Press _Get font_ in the top right.
4.  Check that the list of fonts on the left side corresponds to your selection.
5.  Press _Download all_.
6.  In the <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a>, create a note where to store the new fonts.
7.  In the <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a>, drag-and-drop the .zip file directly onto the newly created note and follow the steps from the previous section.