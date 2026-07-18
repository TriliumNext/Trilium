# Code Snippets
Code Snippets are closely related to <a class="reference-link" href="../Templates.md">Templates</a>, but instead of defining the content of an entire note, a snippet is a reusable piece of code that can easily be inserted into a <a class="reference-link" href="../../Note%20Types/Code.md">Code</a> note.

## Creating a Code snippet

In the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>: 

1.  Right-click the note where you want to place the snippet.
2.  Select **Insert child** _note_.
3.  Select _**Code snippet**_.

Then simply type the desired code into the note and set the correct language mode.

The note's title becomes the title of the snippet. Optionally, you can add a description in the <a class="reference-link" href="../Attributes/Promoted%20Attributes.md">Promoted Attributes</a> section.

## Inserting a snippet

To insert a snippet, type `/snippet` and select its title from the dropdown.

> [!IMPORTANT]
> Only code snippets whose language mode matches the current code note are listed. For example, a CSS code note shows only CSS snippets, not JavaScript ones. The exception is snippets set to "Plain text", which are available in <a class="reference-link" href="../../Note%20Types/Markdown.md">Markdown</a> notes and any code note regardless of its language mode.

## Limitations

*   Unlike <a class="reference-link" href="../Templates.md">Templates</a>, snippets cannot be limited to a particular [workspace](../../Basic%20Concepts%20and%20Features/Navigation/Workspaces.md).