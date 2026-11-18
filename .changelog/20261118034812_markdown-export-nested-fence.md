---
type: fix
area: Import and export
---

Exporting a code note or code block whose text contains a fenced block of its own (a Markdown example, for instance) to Markdown no longer ends the block early, so importing the file again keeps the code as it was.
