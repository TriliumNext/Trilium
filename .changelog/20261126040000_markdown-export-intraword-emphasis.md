---
type: fix
area: Import and export
---

Italic text inside a word, such as the "rd" in an italic 3rd, was exported to Markdown with underscores, which Markdown readers don't treat as italics inside a word. It showed up as plain text with underscores, also after importing the file back into Trilium.
