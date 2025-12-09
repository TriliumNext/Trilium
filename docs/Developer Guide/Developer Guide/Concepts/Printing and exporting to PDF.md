# Printing and exporting to PDF
Note printing is handled by `note_detail.js`, in the `printActiveNoteEvent` method. Exporting to PDF works similarly.

## How it works

Both printing and exporting as PDF use the same mechanism: a note is rendered individually in a separate webpage that is then sent to the browser or the Electron application either for printing or exporting as PDF.

The webpage that renders a single note can actually be accessed in a web browser. For example `http://localhost:8080/#root/WWRGzqHUfRln/RRZsE9Al8AIZ?ntxId=0o4fzk` becomes `http://localhost:8080/?print#root/WWRGzqHUfRln/RRZsE9Al8AIZ`.

Accessing the print note in a web browser allows for easy debugging to understand why a particular note doesn't render well. The mechanism for rendering is similar to the one used in <a class="reference-link" href="#root/0ESUbbAxVnoK">Note List</a>.

## Syntax highlighting

Syntax highlighting for code blocks is supported as well:

*   It works by injecting a Highlight.js stylesheet into the print.
*   The theme used is hard-coded (the _Visual Studio Light theme_, at the time of writing) in order not to have a dark background in print.
*   <a class="reference-link" href="Syntax%20highlighting.md">Syntax highlighting</a> is handled by the content renderer.