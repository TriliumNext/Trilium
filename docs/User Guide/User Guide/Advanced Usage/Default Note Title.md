# Default Note Title
When a new note is created, its name is by default "new note". In some cases, it can be desirable to have a different or even a dynamic default note title.

For this use case, Trilium (since v0.52) supports `#titleTemplate` [label](Attributes.md). You can create such a label for a given note, assign it a value, and this value will be used as a default title when creating child notes. As with other labels, you can make it inheritable to apply recursively, and you can even place it on the root note to have it applied globally everywhere.

As an example use case, imagine you collect books you've read in a given year like this:

*   2022 Books
    *   Neal Stephenson: Anathem, 2008
    *   Franz Kafka: Die Verwandlung, 1915

Now, to the parent note "2022 Books" you can assign label `#titleTemplate="[Author name]: [Book title], [Publication year]"`.

And all children of "2022 Books" will be created with initial title "\[Author name\]: \[Book title\], \[Publication year\]". There's no artificial intelligence here, the idea is to just prompt you to manually fill in the pieces of information into the note title by yourself.

## Titles set by a template

A template can name the notes created from it, wherever they are created. To do so, add a `#template:titleTemplate` label to the template note, for example `#template:titleTemplate="Meeting ${now.format('YYYY-MM-DD')}"` on a _Meeting_ template.

*   It applies both when the template is picked explicitly and when it comes from a parent's `~child:template`. See <a class="reference-link" href="Templates.md">Templates</a>.
*   It takes precedence over the parent's `#titleTemplate`. A title typed in by the user always wins.
*   It can be inherited from the template's ancestors in the tree (for example, a folder holding several templates), in which case a label owned by the template itself takes precedence. A note created from a template and later marked as a template does not keep that template's title.
*   Its value is evaluated the same way as `#titleTemplate`, with `parentNote` being the parent of the new note.

## Dynamic value

The value of `#titleTemplate` is evaluated at the point of note's creation as a JavaScript string, which means it can be enriched with the help of JS string interpolation with dynamic data.

Second variable injected is `parentNote` which gives access to the parent [`FNote`](../Scripting/Script%20API/Frontend%20API.md).

See also <a class="reference-link" href="Templates.md">Templates</a> which provides similar capabilities, including default note's content.

### Examples

*   Imagine you collect server outage incidents and write some notes. It looks like this:
    *   Incidents
        *   2022-05-09: System crash
        *   2022-05-15: Backup delay
    *   You can automatize the date assignment by assigning a label `#titleTemplate="${now.format('YYYY-MM-DD')}: "` to the parent note "Incidents". Whenever a new child note is created, the title template is evaluated with the injected [now](https://day.js.org/docs/en/display/format) object.
*   To use a parent's attribute in the title of new notes: `#titleTemplate="${parentNote.getLabelValue('authorName')}'s literary works"`
*   To mirror the parent's note title: `${parentNote.title}`