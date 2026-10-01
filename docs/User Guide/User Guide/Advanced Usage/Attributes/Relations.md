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

## Reifying a relation

A relation is one row: Note A `supports` Note B. Reifying it creates a note for that exact statement. The relation stays; the note is an extra token for it, created only when you ask.

That note can carry its own attributes — a confidence, a quote, a counter-argument — and other relations can point at it. A label can be reified the same way. The note is filed under Hidden → Reifications, so it does not appear among the notes you keep.

The title is the relation written as `R(A, B)`: `isChildOf(Prince Charles, Queen Elizabeth II)`. A label with a value takes the same shape (`confidence(Climate paper, 0.8)`); a label with no value has one argument (`reviewed(Climate paper)`). If you rename the note, that title is kept. Trilium rewrites it only while it is still the one it generated, including when you rename one of the notes the statement connects.

The relation name is a different note. `loves(John, Mary)` is one statement. `loves` is the concept of that relation. On a link map, right-click the line. If the concept already exists, _Go to loves_ opens it. Otherwise _Create loves in inbox_ files a new note in the inbox, and _Connect loves to a note_ points the name at a note you already have. In the attributes list, hover the row and press _Go to loves_. That opens the same note, creating it the first time. There is one concept per relation name. Beside its title, `loves'` opens the relation name one level up. `loves(John, Mary)'` is a different note: the statement one level up, reached by self-reifying that statement.

A label is that same statement with the other end left as text. `confidence(Climate paper, 0.8)` is an attribute; once `0.8` is a note, it is a relation. In the attributes list, hover a label and press _Make a relation_. _Create 0.8 in inbox_ files a note for that value, and _Connect to a note_ uses one you already have. Hover a relation and press _Make an attribute_ to put the other note's title back into a label. On a link map, the line's menu offers the same for a relation. Once the name is a concept, notes already used as its other end are offered as choices. Until then the name has no choices of its own.

A note can be reified itself: the statement about that statement. Right-click the note and choose _Self-reify as Mary'_. The next levels are `Mary''`, `Mary'''`, then `Mary(4)`. A note that is already a reification, or already one of these levels, shows that next title beside its name. `Mary'` does not take on Mary's relations. A relation of that higher note is written on it, as `R(Mary', Mark)`.

A concept can carry a formula. On the concept, choose _Define Hello_ and write `Hello(A, B) = R(A, B); B'`. Semicolons separate the notes it creates. _New Hello_ asks which note fills each place, and a place can stay empty. A relation with no formula is just that relation, `R(A, B)`. `B'` is B one level up. The formula does not expand another formula. On the note the formula made, _Specify B_ fills a place that was left empty, and leaving it empty is fine. Filling the same places again opens the note already made for them.

In the attributes list, hover a row and press the turn-into-note button. On a <a class="reference-link" href="../../Note%20Types/Relation%20Map.md">relation map</a>, click a relation. The two notes and the arrow become one circle, and clicking a relation of that circle folds it again. Right-click the circle to put the two notes back, then click either note to center the map on it. Click the circle and choose _Go to this relation_ to open that note; right-click it there to return to the two notes. _Back_ returns to the previous view. A reified label is drawn above its note.

That circle is the fact, so the map then shows relations of the fact. `loves(John, Mary)` does not love Mark, and Mary's other relations are not drawn on it. What is drawn is a relation of the fact itself, such as `cause(loves(John, Mary), Event X)`. Before the fact is opened, on the relation map, that cause is an arrow touching the loves arrow. Once the fact is what you are looking at, the cause is an arrow from that note.

Removing the reification deletes that note. The original relation or label stays. Deleting the original relation or label deletes the reification note as well.

## Predefined relations

These relations are supported and used internally by Trilium.

| Label | Description |
| --- | --- |
| `runOn*` | See <a class="reference-link" href="../../Scripting/Backend%20scripts/Backend%20Events.md">Events</a> |
| `template` | note's attributes will be inherited even without a parent-child relationship, note's content and subtree will be added to instance notes if empty. See documentation for details. |
| `template:newNoteDefaultParent` | set on a template note, points to the note under which notes created from the template are placed when no other location is picked; when set several times, the note is cloned into every target. See <a class="reference-link" href="../Templates.md">Templates</a>. |
| `inherit` | note's attributes will be inherited even without a parent-child relationship. See <a class="reference-link" href="../Templates.md">Templates</a> for a similar concept. See <a class="reference-link" href="Attribute%20Inheritance.md">Attribute Inheritance</a> in the documentation. |
| `renderNote` | notes of type <a class="reference-link" href="../../Note%20Types/Render%20Note.md">Render Note</a> will be rendered using a code note (HTML or script) and it is necessary to point using this relation to which note should be rendered |
| `widget` | Used in the context of custom <a class="reference-link" href="../../Scripting/Frontend%20Basics/Launch%20Bar%20Widgets.md">Launch Bar Widgets</a>, to refer to the widget that will be rendered. |
| `shareCss` | CSS note which will be injected into the share page. CSS note must be in the shared sub-tree as well. Consider using `shareHiddenFromTree` and `shareOmitDefaultCss` as well. |
| `shareJs` | JavaScript note which will be injected into the share page. JS note must be in the shared sub-tree as well. Consider using `shareHiddenFromTree`. |
| `shareHtml` | HTML note which will be injected into the share page at locations specified by the `shareHtmlLocation` label. HTML note must be in the shared sub-tree as well. Consider using `shareHiddenFromTree`. |
| `shareTemplate` | Embedded JavaScript note that will be used as the template for displaying the shared note. Falls back to the default template. Consider using `shareHiddenFromTree`. |
| `shareFavicon` | Favicon note to be set in the shared page. Typically you want to set it to share root and make it inheritable. Favicon note must be in the shared sub-tree as well. Consider using `shareHiddenFromTree`. |