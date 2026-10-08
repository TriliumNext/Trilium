# Relations
A relation is similar to a [label](Labels.md), but instead of having a text value it refers to another note.

## Common use cases

*   **Metadata Relationships for personal use**: For example, linking a book note to an author note.  
    This can be combined with <a class="reference-link" href="Promoted%20Attributes.md">Promoted Attributes</a> to make their display more user-friendly.
*   **Configuration**: For configuring some notes such as <a class="reference-link" href="../../Note%20Types/Render%20Note.md">Render Note</a>, or configuring <a class="reference-link" href="../Sharing.md">Sharing</a> or <a class="reference-link" href="../Templates.md">Templates</a> (see the list below).
*   **Scripting**: Attaching scripts to events or conditions related to the note.

## Creating a relation using the visual editor

1.  Go to the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Right%20Sidebar/Attributes%20tab.md">Attributes tab</a> in the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Right%20Sidebar.md">Right Sidebar</a>.
2.  Press the <span class="tn-icon bx bx-plus"></span> button (_Add a new attribute_) to the right of the _Owned attributes_ section.
3.  Select _Add new relation_ for the relation.

While in the visual editor, set the desired name and the _Target note_ (the note to point to). Unlike labels, relations cannot exist with a target note.

Children can inherit this relation, click the relation and check _Inheritable_. See <a class="reference-link" href="Attribute%20Inheritance.md">Attribute Inheritance</a> for more information.

> [!TIP]
> Alternatively, press <kbd>Alt</kbd>+<kbd>L</kbd> which will open the attribute details (same view as when an existing attribute is clicked) in the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/New%20Layout/Status%20bar.md">Status bar</a>.

## Creating a relation manually

In the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/New%20Layout/Status%20bar.md">Status bar</a>, press the <span class="tn-icon bx bx-list-check"></span> button to show the list of the attributes.

*   To create a relation called `myRelation`:
    1.  Click the input box to focus it.
    2.  Type `~myRelation=@` .
    3.  After this, an autocompletion box should appear.
    4.  Type the title of the note to point to and press <kbd>Enter</kbd> to confirm (or click the desired note).
    5.  Alternatively copy a note from the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a> and paste it after the `=` sign (without the `@` , in this case).
*   To create an inheritable relation, follow the same steps as previously described but instead of `~myRelation` write `~myRelation(inheritable)`.

## Predefined relations

These relations are supported and used internally by Trilium.

| Label | Description |
| --- | --- |
| `runOn*` | See <a class="reference-link" href="../../Scripting/Backend%20scripts/Backend%20Events.md">Backend Events</a> |
| `template` | note's attributes will be inherited even without a parent-child relationship, note's content and subtree will be added to instance notes if empty. See documentation for details. |
| `template:newNoteDefaultParent` | set on a template note, points to the note under which notes created from the template are placed when no other location is picked; when set several times, the note is cloned into every target. See <a class="reference-link" href="../Templates.md">Templates</a>. |
| `inherit` | note's attributes will be inherited even without a parent-child relationship. See <a class="reference-link" href="../Templates.md">Templates</a> for a similar concept. See <a class="reference-link" href="Attribute%20Inheritance.md">Attribute Inheritance</a> in the documentation. |
| `renderNote` | notes of type <a class="reference-link" href="../../Note%20Types/Render%20Note.md">Render Note</a> will be rendered using a code note (HTML or script) and it is necessary to point using this relation to which note should be rendered |
| `widget` | Used in the context of custom <a class="reference-link" href="../../Scripting/Frontend%20Basics/Launch%20Bar%20Widgets.md">Launch Bar Widgets</a>, to refer to the widget that will be rendered. |
| `shareCss` | CSS note which will be injected into the share page. CSS note must be in the shared sub-tree as well. Consider using `shareHiddenFromTree` and `shareOmitDefaultCss` as well. |
| `shareJs` | JavaScript note which will be injected into the share page. JS note must be in the shared sub-tree as well. Consider using `shareHiddenFromTree`. |
| `shareHtml` | HTML note which will be injected into the share page at locations specified by the `shareHtmlLocation` label. HTML note must be in the shared sub-tree as well. Consider using `shareHiddenFromTree`. |
| `shareTemplate` | Embedded JavaScript note that will be used as the template for displaying the shared note. Falls back to the default template. Consider using `shareHiddenFromTree`. |
| `shareFavicon` | Favicon note to be set in the shared page. Typically you want to set it to share root and make it inheritable. Favicon note must be in the shared sub-tree as well. Consider using `shareHiddenFromTree`. |