# Content language & Right-to-left support
![](Content%20language%20&%20Right-to-left%20support_image.jpg)

The content language determines:

*   The spell-checking of the note, when in a browser. The desktop installation has a dedicated spellchecking section.
*   Whether the text is displayed from right-to-left, for languages such as Arabic, Hebrew, etc.
*   How typed quotes are [automatically replaced](Automatic%20replacements.md) (e.g. English uses `“text”`, whereas some languages use `«text»`). This applies only if <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Text_ → _Single/Double quotation marks_ is set to _Based on note's content language_.
*   Which languages are offered by the <a class="reference-link" href="In-editor%20AI%20assistant.md">In-editor AI assistant</a> for translation.
*   The language and the text direction the content is marked with on a [shared page](../../Advanced%20Usage/Sharing.md), which screen readers and browsers follow.

## Setting the language of a single note

To set the language of the content of a <a class="reference-link" href="../Text.md">Text</a> note, there is a language selector in the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Status%20bar.md">Status bar</a> indicated by a <span class="tn-icon bx bx-globe"></span> icon.

## Adjusting the list of languages

By default, no language is configured. To configure them, go to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Language & Region_ → _Content languages_, or select the _Configure languages..._ item when setting the language. The enabled languages are listed by their native names, sorted alphabetically, which is also the order the language selector shows them in. Here you can:

*   Add a language by pressing the <span class="tn-icon bx bx-plus"></span> _Add a language_ button (_Add another language_ once one is enabled), which also shows how many languages are left, and then selecting it.
*   Press the <span class="tn-icon bx bx-x"></span> button beside a language to remove it from the list.

## Default content language

Notes that do not have a language of their own follow <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Language & Region_ → _Default content language_. It is set to English initially, and can be set to any content language, or to _Based on the application's language_.

If a note has a language set, it always takes precedence over the default.