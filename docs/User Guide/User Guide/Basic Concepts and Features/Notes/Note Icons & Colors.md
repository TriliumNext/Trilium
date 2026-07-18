# Note Icons & Colors
## Icons

<figure class="image image-style-align-right image_resized" style="width:48.4%;"><img style="aspect-ratio:1089/995;" src="Note Icons &amp; Colors_image.png" width="1089" height="995"></figure>

Icons are useful for distinguishing notes and are displayed near the note title, as well as in various places such as the <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a>, <a class="reference-link" href="../../Note%20Types/Text/Links/Internal%20(reference)%20links.md">Internal (reference) links</a> or the <a class="reference-link" href="../Navigation/Jump%20to%20%26%20command%20palette.md">Jump to &amp; command palette</a>.

While editing a note, click on the icon next to the title to bring up a chooser gallery.

Icons can be inherited through the use of <a class="reference-link" href="../../Advanced%20Usage/Templates.md">Templates</a>, or <a class="reference-link" href="../../Advanced%20Usage/Attributes/Attribute%20Inheritance.md">Attribute Inheritance</a>.

> [!NOTE]
> At the technical level, they are set by the `iconClass` attribute which adds a CSS class to the note. For example `#iconClass="bx bx-calendar"` will show a calendar instead of the default page or folder icon. Looking up and remembering the CSS class names is not necessary.

## Colors

Notes can also carry a custom color. Similar to the note icon, this color will be shown in various places such as the <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a> and <a class="reference-link" href="../../Note%20Types/Text/Links/Internal%20(reference)%20links.md">Internal (reference) links</a>.

To set a custom color, right click on the note in the <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a> and select a predefined color from there or use the color picker (last option).

Alternatively, a custom color can be set manually through the `#color` [label](../../Advanced%20Usage/Attributes/Labels.md), whose value must be a valid hex color including the leading `#` (e.g. `#ff0000` for red). This color can be carried over across multiple notes via <a class="reference-link" href="../../Advanced%20Usage/Attributes/Attribute%20Inheritance.md">Attribute Inheritance</a>.