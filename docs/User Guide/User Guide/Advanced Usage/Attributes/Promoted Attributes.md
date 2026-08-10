# Promoted Attributes
<figure class="image image_resized" style="width:61.4%;"><img style="aspect-ratio:938/368;" src="Promoted Attributes_image.png" width="938" height="368"></figure>

Promoted attributes are [attributes](../Attributes.md) which are displayed prominently in the UI which allow them to be easily viewed and edited.

One way of seeing promoted attributes is as a kind of form with several fields. Each field is just regular attribute, the only difference is that they appear on the note itself.

Attributes can be pretty useful since they allow for querying and script automation etc. but they are also inconveniently hidden. This allows you to select few of the important ones and push them to the front of the user.

## Attribute definition

<figure class="image image-style-align-right image_resized" style="width:50%;"><img style="aspect-ratio:885/742;" src="2_Promoted Attributes_image.png" width="885" height="742"></figure>

In order to have promoted attributes, there needs to be a way to define them.

Technically, attributes are only name-value pairs where both name and value are strings.

The _Attribute definition_ specifies how should this value be interpreted:

*   Is it just string, or is it a date?
*   Should we allow multiple values or note?
*   Should we _promote_ the attribute or not?

## Types of attributes

Attribute definitions have a dedicated type field which will change how the value will be edited in the promoted attributes section.

The following types are supported:

*   _Text_, the default option which allows any type of text to be edited, similar to normal labels that don't have a type associated.
*   _Multi-line text_, similar to a normal text field, but rendered in a bigger text box that also supports writing on multiple lines.
*   _Number_, will display as a number input field with up/down arrows.
    *   Optionally a _precision_ which sets how many decimals the value steps by and is displayed with.
*   _Boolean_, which renders as a checkbox for a true/false value.
*   _Select,_ which provides a list of user-defined options when editing.
    *   The list is not fixed, meaning that new options can be easily added from the promoted attribute.
    *   Renaming an option does not change the existing values since the value is stored as text. Consider a [bulk rename](../Bulk%20Actions.md).
    *   The items do not have a custom color or icon. This is intentional as selects are meant to be light-weight. For a more customizable option, consider using <a class="reference-link" href="Relations.md">Relations</a> instead which use notes as items and those notes can be colorized and also carry an icon.
*   _Date,_ which provides a date picker.
*   _Date & Time,_ which provides a date & time picker.
*   _Time,_ which provides a time picker.
*   _URL,_ which provides a button to open the web address in a new window.
*   _Email_, which provides a button to quickly send an email to that address using your operating system's default app.
*   _Phone_, which provides a button to quickly call that number using your operating system's default app.
*   _Color_, which provides a color picker and a way to remove the value.
*   _Relation_, which points to another note and uses <a class="reference-link" href="Relations.md">Relations</a> instead of <a class="reference-link" href="Labels.md">Labels</a>.

> [!NOTE]
> For label-based attributes, these types are not enforced by the attribute system, meaning that changing the type afterwards does not guarantee that the values in it correspond to the type (e.g. turning a text into a number).

## Creating a new promoted attribute definition

To create a new promoted attribute:

1.  Go to a note.
2.  Go to _Owned Attributes_ in the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Ribbon.md">Ribbon</a>.
3.  Press the + button.
4.  Select either _Add new label definition_ or _Add new relation definition_.
5.  Select the name which will be name of the label or relation that will be created when the promoted attribute is edited.
6.  Ensure _Promoted_ is checked in order to display it at the top of notes.
7.  Optionally, choose an _Alias_ which will be displayed next to the promoted attribute instead of the attribute name. Generally it's best to choose a “user-friendly” name since it can contain spaces and other characters which are not supported as attribute names.
8.  Check _Inheritable_ to apply it to this note and all its descendants. To keep it only for the current note, un-check it.
9.  Press “Save & Close” to apply the changes.

## How attribute definitions actually work

When a new promoted attribute definition is created, it creates a corresponding label prefixed with either `label` or `relation`, depending on the definition type:

```
#label:myColor(inheritable)="promoted,alias=Color,multi,color"
```

The only purpose of the attribute definition is to set up a template. If the attribute was marked as promoted, then it's also displayed to the user for easy editing.

|  |  |
| --- | --- |
| <figure class="image"><img style="aspect-ratio:495/157;" src="1_Promoted Attributes_image.png" width="495" height="157"></figure> | Notice how the promoted attribute definition only creates a “Due date” box above the text content. |
| <figure class="image"><img style="aspect-ratio:663/160;" src="3_Promoted Attributes_image.png" width="663" height="160"></figure> | Once a value is set by the user, a new label (or relation, depending on the type) is created. The name of the attribute matches one set when creating the promoted attribute. |

So there's one attribute for value and one for definition. But notice how an definition attribute can be made [Inheritable](Attribute%20Inheritance.md), meaning that it's also applied to all descendant notes. In this case, the definition used for the whole sub-tree while "value" attributes are for each not individually.

## Using system attributes

It's possible to create promoted attributes out of system attributes, to be able to easily alter them.

Here are a few practical examples:

*   <a class="reference-link" href="../../Collections.md">Collections</a> already make use of this practice, for example:
    *   Calendars add “Start Date”, “End Date”, “Start Time” and “End Time” as promoted attributes. These map to system attributes such as `startDate` which are then interpreted by the calendar view.
    *   <a class="reference-link" href="../../Collections/Presentation.md">Presentation</a> adds a “Background” promoted attribute for each of the slide to easily be able to customize.
*   The Trilium documentation (which is edited in Trilium) uses a promoted attribute to be able to easily edit the `#shareAlias` (see <a class="reference-link" href="../Sharing.md">Sharing</a>) in order to form clean URLs.
*   If you always edit a particular system attribute such as `#color`, simply create a promoted attribute for it to make it easier.

### Inverse relation

Some relations always occur in pairs - my favorite example is on the family. If you have a note representing husband and note representing wife, then there might be a relation between those two of `isPartnerOf`. This is bidirectional relationship - meaning that if a relation is pointing from husband to wife then there should be always another relation pointing from wife to husband.

Another example is with parent-child relationship. Again these always occur in pairs, but in this case it's not exact same relation - the one going from parent to child might be called `isParentOf` and the other one going from child to parent might be called `isChildOf`.

Relation definition allows you to specify such "inverse relation" - for the relation you just define you specify which is the inverse relation. Note that in the second example we should have two relation definitions - one for `isParentOf` which defines `isChildOf` as inverse relation and then second relation definition for `isChildOf` which defines `isParentOf` as inverse relation.

What this does internally is that whenever we save a relation which has defined inverse relation, we check that this inverse relation exists on the relation target note. Similarly, when we delete relation, we also delete inverse relation on the target note.

## See also

*   The <a class="reference-link" href="../../Collections/Table.md">Table</a> collection makes heavy use of promoted attributes to define the columns of the table, since they already carry the type information. When made inheritable, it's also easy to change those fields when the child notes are opened.