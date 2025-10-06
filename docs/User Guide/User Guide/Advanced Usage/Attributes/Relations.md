# Relations
A relation is similar to a [label](Labels.md), but instead of having a text value it refers to another note.

## Common use cases

*   **Metadata Relationships for personal use**: For example, linking a book note to an author note.  
    This can be combined with <a class="reference-link" href="Promoted%20Attributes.md">Promoted Attributes</a> to make their display more user-friendly.
*   **Configuration**: For configuring some notes such as <a class="reference-link" href="../../Note%20Types/Render%20Note.md">Render Note</a>, or configuring <a class="reference-link" href="../Sharing.md">Sharing</a> or <a class="reference-link" href="../Templates.md">Templates</a> (see the list below).
*   **Scripting**: Attaching scripts to events or conditions related to the note.

## Creating a relation using the visual editor

1.  Go to the _Owned Attributes_ section in the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Ribbon.md">Ribbon</a>.
2.  Press the + button (_Add new attribute_) to the right.
3.  Select _Add new relation_ for the relation.

> [!TIP]
> If you prefer keyboard shortcuts, press <kbd>Alt</kbd>+<kbd>L</kbd> while focused on a note or in the _Owned Attributes_ section to display the visual editor.

While in the visual editor:

*   Set the desired name
*   Set the Target note (the note to point to). Unlike labels, relations cannot exist with a target note.
*   Check _Inheritable_ if the label should be inherited by the child notes as well. See <a class="reference-link" href="Attribute%20Inheritance.md">Attribute Inheritance</a> for more information.

## Creating a relation manually

In the _Owned Attributes_ section in the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Ribbon.md">Ribbon</a>:

*   To create a relation called `myRelation`:
    *   First type `~myRelation=@` .
    *   After this, an autocompletion box should appear.
    *   Type the title of the note to point to and press <kbd>Enter</kbd> to confirm (or click the desired note).
    *   Alternatively copy a note from the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a> and paste it after the `=` sign (without the `@` , in this case).
*   To create an inheritable relation, follow the same steps as previously described but instead of `~myRelation` write `~myRelation(inheritable)`.

## Predefined relations

These relations are supported and used internally by Trilium.

> [!TIP]
> Some relations presented here end with a `*`. That means that there are multiple relations with the same prefix, consult the specific page linked in the description of that relation for more information.

| Label | Description |
| --- | --- |
| `runOn*` | See <a class="reference-link" href="../../Scripting/Events.md">Events</a> |
| `template` | note's attributes will be inherited even without a parent-child relationship, note's content and subtree will be added to instance notes if empty. See documentation for details. |
| `inherit` | note's attributes will be inherited even without a parent-child relationship. See <a class="reference-link" href="../Templates.md">Templates</a> for a similar concept. See <a class="reference-link" href="Attribute%20Inheritance.md">Attribute Inheritance</a> in the documentation. |
| `renderNote` | notes of type <a class="reference-link" href="../../Note%20Types/Render%20Note.md">Render Note</a> will be rendered using a code note (HTML or script) and it is necessary to point using this relation to which note should be rendered |
| `widget_relation` | target of this relation will be executed and rendered as a widget in the sidebar |
| `shareCss` | CSS note which will be injected into the share page. CSS note must be in the shared sub-tree as well. Consider using `share_hidden_from_tree` and `share_omit_default_css` as well. |
| `shareJs` | JavaScript note which will be injected into the share page. JS note must be in the shared sub-tree as well. Consider using `share_hidden_from_tree`. |
| `shareHtml` | HTML note which will be injected into the share page at locations specified by the `shareHtmlLocation` label. HTML note must be in the shared sub-tree as well. Consider using `share_hidden_from_tree`. |
| `shareTemplate` | Embedded JavaScript note that will be used as the template for displaying the shared note. Falls back to the default template. Consider using `share_hidden_from_tree`. |
| `shareFavicon` | Favicon note to be set in the shared page. Typically you want to set it to share root and make it inheritable. Favicon note must be in the shared sub-tree as well. Consider using `share_hidden_from_tree`. |