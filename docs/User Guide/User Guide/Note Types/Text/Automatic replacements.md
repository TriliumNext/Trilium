# Automatic replacements
## Automatic replacements

As you type in a text note, certain character sequences are replaced with the typographic symbol they represent. Typing `(c)` gives you `©`, `...` gives you `…`, and `"quote"` gives you `“quote”`.

These replacements are not applied inside code blocks or inline code, and pasted text is never affected — only text you type. If you have pasted a code snippet, or written one inside a code block, its characters are left exactly as they are.

Once an automatic replacement takes place, it can be undone by:

*   Pressing <kbd>Backspace</kbd> immediately after a replacement undoes it and restores what you typed.
    *   Note that this consumes the undo, so a further <kbd>Ctrl</kbd>+<kbd>Z</kbd> might delete your typed text.
    *   Pressing <kbd>Space</kbd> or changing the cursor position disables this functionality.
*   Pressing <kbd>Ctrl</kbd>+<kbd>Z</kbd>, which works even after pressing space.

Each group can be turned off in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Text notes_ → _Automatic replacements_.

| Group | What it replaces |
| --- | --- |
| Punctuation | `...` with an ellipsis (`…`), and `--` and `---` _surrounded by spaces_ with an en dash (`–`) and an em dash (`—`) |
| Mathematical symbols | fractions such as `1/2` with `½`, and the operators `<=`, `>=`, `!=`, `<-` and `->` with `≤`, `≥`, `≠`, `←` and `→` |
| Copyright and trademark | `(c)`, `(r)` and `(tm)` with `©`, `®` and `™` |
| Quotation marks | straight quotes with typographic ones — see below |

## Quotation marks

Quotation marks are configured separately from the rest, with one setting for the **double** quote key and one for the **single** quote key, because which pair belongs on which key differs between conventions — British typography traditionally sets a quotation in `‘…’` where American sets it in `“…”`.

Each offers:

*   _Based on the note's content language_ (the default) — English gives `“quote”`, German `„quote“`, French `« quote »`, Japanese `「quote」`. See _Content language & Right-to-left support_ for how a note's language is decided.
*   _Disabled,_ straight quotes stay straight.
*   _A specific pair_ — `“…”`, `‘…’`, `„…“`, `„…”`, `«…»`, `« … »`, `‹…›`, `「…」`, `『…』`. Choosing one applies it to every note, whatever language it is written in.

## Custom replacements

You can add your own under <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Text notes_ → _Automatic replacements_ → _Custom replacements_. Type the text to replace and the replacement, then press Enter. Existing ones are shown as chips and removed with the × on each.

A custom replacement is applied when the text is typed as a whole word and followed by a space, so longer words that begin with it are left alone — a `TN` replacement does not rewrite the end of `BTN`, and `TNT` can still be typed.

Capitalisation follows what you type, unless the replacement has capitals of its own:

| **Replacement you defined** | **You type** | **You get** |
| --- | --- | --- |
| `teh` → `the` | `teh` / `Teh` / `TEH` | `the` / `The` / `THE` |
| `TN` → `Trilium Notes` | `TN` or `tn` | `Trilium Notes` (unchanged — it has capitals) |

The text to replace is matched literally; it is not a pattern. Typing a replacement whose "text to replace" already exists updates that entry rather than adding a second one.

## Characters that only look replaced (ligatures)

If you see `!=` displayed as `≠` or `->` as `→` inside a code block, that is not a replacement — replacements never run there. It is a _font ligature_: the default monospace font draws certain character pairs as a single symbol. The underlying text is unchanged, and copying it out gives you back `!=` and `->`.

This can be turned off with <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a>_→ Appearance → Fonts → Programming ligatures._