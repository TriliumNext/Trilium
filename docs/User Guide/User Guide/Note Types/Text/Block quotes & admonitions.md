# Block quotes & admonitions
## Block quotes

As the name suggests, block quotes can be useful to cite one or more paragraphs.

To create a block quote, press <img src="Block quotes &amp; admonitions_image.png" width="15" height="12"> from the <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a>. It's also possible to type <kbd>&gt;</kbd>, followed by a space to create one (but only if the cursor is at the beginning of a line).

Inside the quote block, other block items can be inserted such as tables, images, or even other block quotes or admonitions.

## Admonitions

Admonitions are a way to highlight information to the reader. Other names for it include _call-outs_ and _info/warning/alert boxes_.

<figure class="image image-style-align-center"><img style="aspect-ratio:959/547;" src="2_Block quotes &amp; admonitions_image.png" width="959" height="547"></figure>

From a functional point of view, admonitions act very similarly to a block quote, just with different styling. This includes the ability to insert other elements in it such as headings, tables, images, etc.

### Inserting a new admonition

In the <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a>:

![](1_Block%20quotes%20&%20admonitions_image.png)

It's possible to insert an admonition simply by typing:

*   `!!! note`
*   `!!! tip`
*   `!!! important`
*   `!!! caution`
*   `!!! warning`

In addition to that, it's also possible to type `!!!`  followed by any text, case in which a default admonition type will appear (note) with the entered text inside it.

### Interaction

By design, admonitions act very similar to block quotes.

*   Selecting a text and pressing the admonition button will turn that text into an admonition.
*   If selecting multiple admonitions, pressing the admonition button will automatically merge them into one.

Inside an admonition:

*   Pressing <kbd>Backspace</kbd> while the admonition is empty will remove it.
*   Pressing <kbd>Enter</kbd> will start a new paragraph. Pressing it twice will exit out of the admonition.
*   Headings and other block content including tables can be inserted inside the admonition.

### Types of admonitions

There are currently five types of admonitions: _Note_, _Tip_, _Important_, _Caution_, _Warning_.

These types were inspired by GitHub's support for this feature and there are currently no plans for adjusting it or allowing the user to customize them.

### Markdown support

See <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Import%20%26%20Export/Markdown/Supported%20syntax.md">Supported syntax</a>.