# Converting between note types
A note's type may be converted to another:

*   <a class="reference-link" href="Text.md">Text</a> notes to <a class="reference-link" href="Markdown.md">Markdown</a> notes
*   Markdown notes to Text notes

Before conversion, a revision is saved automatically, so you can restore the original or recover any missing elements from it if the conversion produces undesired results. Read more about <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notes/Note%20Revisions.md">Note Revisions</a>.

## Converting individual notes

### Markdown to Text Note

Markdown notes can be converted to Text Notes with negligible loss of formatting fidelity.

To do so, go to the note menu → “**Advanced”** and select "**Convert to Text Note**".

### Text Note to Markdown

> [!WARNING]
> Since Markdown does not support all the capabilities of Text notes, this conversion is lossy in terms of formatting: some formatting may be lost, and some unsupported elements may even be dropped. It's strongly recommended that you inspect the content for any information that might have gone missing after the conversion.

To convert a text note to Markdown, go to the note menu → **“Advanced”** and select **"Convert to Markdown Note"**.

## Converting multiple notes

A note type conversion can also be performed on an entire subtree or a set of multiple notes using <a class="reference-link" href="../Advanced%20Usage/Bulk%20Actions.md">Bulk Actions</a>.