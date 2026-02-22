# Default Note Title
## Default Note Title Templates

When a new note is created, Trilium Next assigns a default title (typically “new note”). You can customize this default title—either statically or dynamically—using **title template** labels. Two related labels exist, and they apply in different situations:

*   `#childTitleTemplate` — controls the **default title of newly created child notes** under a given parent note.
*   `#titleTemplate` — controls the **default title when creating a note from a chosen template note**.

Both labels support **dynamic evaluation** via JavaScript template-literal interpolation.

## Default Title for Child Notes

You can change the default title of child notes, by adding the label `#childTitleTemplate` to a parent note, and its value will be used as the initial title for any newly created child notes under that parent. As with other labels, you can make it inheritable to apply recursively, and you can even place it on the root note to have it applied globally everywhere.

### Example

As an example use case, imagine you collect books you've read in a given year like this:

*   **2022 Books**
    *   Neal Stephenson: Anathem, 2008
    *   Franz Kafka: Die Verwandlung, 1915

Now, to the parent note "2022 Books" you can assign label `#childTitleTemplate="[Author name]: [Book title], [Publication year]"`.

And all children of "2022 Books" will be created with initial title "\[Author name\]: \[Book title\], \[Publication year\]". There's no artificial intelligence here, the idea is to just prompt you to manually fill in the pieces of information into the note title by yourself.

## Default Title for Notes

When you create a new note and explicitly choose a template note via “New note from template", Trilium will check if that template note has a label `#titleTemplate` and if it does, the labels value will be used as the default title for the created note. This label is not taken from the parent note in that flow; it comes from the chosen template note.

## Precedence of the two titleTemplate labels

Both `#childTitleTemplate` and `#titleTemplate` can be added to a note. For example you might have `#childTitleTemplate` added to a parent note and then create a new child note via a template with the `#titleTemplate` label set. 

When the `#titleTemplate` is set, it takes precedence, then the `#childTitleTemplate` is checked and finally it falls back to the normal default title “new note”.

## Dynamic Values

The value of both labels is evaluated at the point of the note's creation as a JavaScript string, which means it can be enriched with the help of JS string interpolation with dynamic data.

Second variable injected is `parentNote` which gives access to the parent [`FNote`](../Scripting/Script%20API/Frontend%20API/FNote.dat).

See also <a class="reference-link" href="Templates.md">Templates</a> which provides similar capabilities, including default note's content.

#### Examples

*   Imagine you collect server outage incidents and write some notes. It looks like this:
    *   Incidents
        *   2022-05-09: System crash
        *   2022-05-15: Backup delay
    *   You can automatize the date assignment by assigning a label `#childTitleTemplate="${now.format('YYYY-MM-DD')}: "` to the parent note "Incidents". Whenever a new child note is created, the child title template is evaluated with the injected [now](https://day.js.org/docs/en/display/format) object.
*   To use a parent's attribute in the title of new notes: `#childTitleTemplate="${parentNote.getLabelValue('authorName')}'s literary works"`
*   To mirror the parent's note title: `${parentNote.title}`
*   Image you have a template for a food diary and you want to create a daily entry in the journal. You can add the label `#titleTemplate="${now.format('YYYY-MM-DD')} - Food Diary"` and the title template is evaluated with the injected [now](https://day.js.org/docs/en/display/format) object.