# Text Snippets
<figure class="image image-style-align-right"><img style="aspect-ratio:265/108;" src="Text Snippets_image.png" width="265" height="108"></figure>

> [!NOTE]
> This is a premium feature of the editor we are using (CKEditor) and we benefit from it thanks to a written agreement with the team. See  <a class="reference-link" href="../Premium%20features.md">Premium features</a> for more information.

Text Snippets are closely related to <a class="reference-link" href="../../../Advanced%20Usage/Templates.md">Templates</a>, but instead of defining the content of an entire note, text snippets are pieces of formatted text that can easily be inserted in a text note.

## Creating a text snippet

In the <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>: 

1.  Right click a note where to place the text snippet.
2.  Select _Insert child note_.
3.  Select _Text snippet_.

Afterwards, simply type in the content of the note the desired text. The text can be formatted in the same manner as a normal text note.

The title of the note will become the title of the template. Optionally, a description can be added in the <a class="reference-link" href="../../../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a> section.

## Inserting a snippet

Once a snippet is created, there are two options to insert it:

1.  From the <a class="reference-link" href="../Formatting%20toolbar.md">Formatting toolbar</a>, by looking for the <img src="1_Text Snippets_image.png" width="19" height="19">button.
2.  Using <a class="reference-link" href="Slash%20Commands.md">Slash Commands</a>: 
    1.  To look for a specific template, start typing the name of the template (its title).
    2.  To look for all the templates, type `template`.

> [!TIP]
> A newly created snippet doesn't appear? Generally it takes up to a few seconds to refresh the list of templates once you make a change.
> 
> If this doesn't happen, [reload the application](../../../Troubleshooting/Refreshing%20the%20application.md) and [report the issue](../../../Troubleshooting/Reporting%20issues.md)to us. 

## Limitations

*   Whenever a snippet is created, deleted or its title/description are modified, all the open text notes will need to be refreshed. This causes a slight flash for usually under a second, but it can cause some discomfort.
*   Unlike <a class="reference-link" href="../../../Advanced%20Usage/Templates.md">Templates</a>, the snippets cannot be limited to a particular [workspace](../../../Basic%20Concepts%20and%20Features/Navigation/Workspaces.md).